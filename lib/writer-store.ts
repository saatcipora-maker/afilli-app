import AsyncStorage from '@/lib/writer-storage';
import { randomUUID, digestStringAsync, CryptoDigestAlgorithm } from 'expo-crypto';
import type { WriterDocument, WriterDeltaInput, WriterMetadata } from '@workspace/api-client-react';

/**
 * Durable per-owner, per-book manuscript store.
 * - Every write is a serialized read-modify-write (module queue + navigator.locks across browser contexts).
 * - A record that cannot be strictly decoded is NEVER overwritten or replaced by a blank one: it raises.
 * - Deletions write a tombstone BEFORE removal; tombstoned ids can never be written again.
 * - Guest -> account claims go through a global, never-removed claim ledger per guest book id.
 */
export type LocalImage = { key: string; uri: string; mimeType: 'image/jpeg' | 'image/png' | 'image/webp'; size: number; width: number; height: number };
export type Pending = { saveId: string; baseRevision: number; snapshot: WriterDocument; version: number; createdAt: number; delta?: WriterDeltaInput };
/** Fingerprints describe the acknowledged client snapshot, not newer edits or server-normalized text. */
export type SyncBase = { revision: number; metadata: string; chapters: { id: string; hash: string }[] };
export type RecordSource =
  | { kind: 'legacy-draft'; draftId: string } | { kind: 'guest-claim'; from: string } | { kind: 'conflict-copy'; from: string } | null;
export type WriterRecord = {
  v: 1; id: string; localId: string; owner: string;
  doc: WriterDocument; version: number; ackedVersion: number;
  /** Changes on every persisted CONTENT edit only (never on cloud/metadata acks). Used as a CAS baseline. */
  editStamp: string;
  baseRevision: number; cloud: boolean;
  syncBase?: SyncBase | null;
  publication: 'draft' | 'published'; publishedAt: string | null;
  localSavedAt: number; cloudSavedAt: string | null;
  pending: Pending | null; conflict: { at: number } | null;
  coverLocal: LocalImage | null; lastError: string | null;
  source: RecordSource;
};
export class WriterStoreError extends Error {}
/** The record was deleted (tombstoned) or claimed away; writing it again is refused. */
export class WriterDeletedError extends WriterStoreError {}

const PREFIX = 'afilli:writer:v1:';
const bookKey = (owner: string, id: string) => PREFIX + 'book:' + owner + ':' + id;
const tombKey = (owner: string, id: string) => PREFIX + 'tomb:' + owner + ':' + id;
const ledgerKey = (guestId: string) => PREFIX + 'gclaim:' + guestId;
export const isDirty = (r: Pick<WriterRecord, 'version' | 'ackedVersion'>) => r.version !== r.ackedVersion;
export const newStamp = () => randomUUID();

type LockManager = { request: (name: string, cb: () => Promise<unknown>) => Promise<unknown> };
function lockManager(): LockManager | null {
  const n = (globalThis as { navigator?: { locks?: LockManager } }).navigator;
  return n?.locks && typeof n.locks.request === 'function' ? n.locks : null;
}
const queues = new Map<string, Promise<unknown>>();
/** Module queue (same context) + Web Locks (other tabs/windows). Lock names never nest cyclically. */
function serial<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const prev = queues.get(key) ?? Promise.resolve();
  const run = (): Promise<T> => { const m = lockManager(); return m ? (m.request('afilli-writer:' + key, fn) as Promise<T>) : fn(); };
  const next = prev.catch(() => undefined).then(run);
  queues.set(key, next);
  void next.finally(() => { if (queues.get(key) === next) queues.delete(key); }).catch(() => undefined);
  return next;
}

// ---------- strict decoding ----------
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isStr = (x: unknown): x is string => typeof x === 'string';
const isNonEmpty = (x: unknown): x is string => typeof x === 'string' && x.length > 0;
const isNat = (x: unknown): x is number => typeof x === 'number' && Number.isInteger(x) && x >= 0;
const isTime = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x) && x >= 0;
const strOrNull = (x: unknown) => x === null || typeof x === 'string';
const dateOrNull = (x: unknown) => x === null || typeof x === 'string' && Number.isFinite(Date.parse(x));
const genres = new Set(['Roman', 'Hikaye', 'Şiir', 'Fantastik', 'Bilim Kurgu', 'Korku', 'Aşk', 'Tarihi', 'Kişisel Gelişim']);
const optional = <T>(x: unknown, ok: (v: unknown) => boolean, dflt: T): T | false => x === undefined ? dflt : ok(x) ? x as T : false;

function validDoc(d: unknown): d is WriterDocument {
  const x = d as WriterDocument;
  // Lengths are deliberately NOT checked: over-limit local text must stay recoverable.
  return !!x && typeof x === 'object' && isStr(x.title) && isStr(x.description) && Array.isArray(x.genres) && x.genres.every(g => isStr(g) && genres.has(g))
    && ['all', '13', '18'].includes(x.ageRating) && ['ongoing', 'completed'].includes(x.completion)
    && isStr(x.language) && strOrNull(x.cover) && Array.isArray(x.chapters)
    && x.chapters.every((c) => !!c && typeof c === 'object' && isNonEmpty(c.id) && isStr(c.title) && isStr(c.html) && (c.status === 'draft' || c.status === 'published'));
}
function validImage(i: unknown): i is LocalImage {
  const x = i as LocalImage;
  return !!x && typeof x === 'object' && isNonEmpty(x.key) && isNonEmpty(x.uri) && ['image/jpeg', 'image/png', 'image/webp'].includes(x.mimeType)
    && isTime(x.size) && isTime(x.width) && isTime(x.height);
}
function validPending(p: unknown): p is Pending {
  const x = p as Pending;
  return !!x && typeof x === 'object' && isStr(x.saveId) && UUID.test(x.saveId) && isNat(x.baseRevision) && validDoc(x.snapshot) && isNat(x.version) && isTime(x.createdAt)
    && (x.delta === undefined || validDelta(x.delta, x));
}
function validDelta(d: WriterDeltaInput, p: Pending): boolean {
  return !!d && d.saveId === p.saveId && d.expectedRevision === p.baseRevision && d.expectedRevision > 0
    && Array.isArray(d.upserts) && validDoc({ ...p.snapshot, chapters: d.upserts })
    && (d.metadata === undefined || validDoc({ ...d.metadata, chapters: [] }))
    && Array.isArray(d.deletedChapterIds) && d.deletedChapterIds.every(id => isStr(id) && UUID.test(id))
    && (d.chapterOrder === undefined || Array.isArray(d.chapterOrder) && d.chapterOrder.every(id => isStr(id) && UUID.test(id)));
}
function validBase(b: unknown): b is SyncBase {
  const x = b as SyncBase;
  const hash = (h: unknown) => typeof h === 'string' && /^[0-9a-f]{64}$/.test(h);
  return !!x && isNat(x.revision) && hash(x.metadata) && Array.isArray(x.chapters)
    && x.chapters.every(c => !!c && isNonEmpty(c.id) && hash(c.hash))
    && new Set(x.chapters.map(c => c.id)).size === x.chapters.length;
}
export function documentMetadata(doc: WriterDocument): WriterMetadata {
  return { title: doc.title, description: doc.description, genres: doc.genres, ageRating: doc.ageRating,
    language: doc.language, completion: doc.completion, cover: doc.cover };
}
export async function fingerprintDocument(doc: WriterDocument, revision: number): Promise<SyncBase> {
  const hash = (value: unknown) => digestStringAsync(CryptoDigestAlgorithm.SHA256, JSON.stringify(value));
  return { revision, metadata: await hash(documentMetadata(doc)), chapters: await Promise.all(doc.chapters.map(async c => ({
    id: c.id, hash: await hash([c.id, c.title, c.html, c.status]),
  }))) };
}
export function chapterDelta(doc: WriterDocument, base: SyncBase, next: SyncBase, saveId: string): WriterDeltaInput {
  const old = new Map(base.chapters.map(c => [c.id, c.hash]));
  const fresh = new Map(next.chapters.map(c => [c.id, c.hash]));
  const order = next.chapters.map(c => c.id);
  return { expectedRevision: base.revision, saveId,
    ...(base.metadata !== next.metadata ? { metadata: documentMetadata(doc) } : {}),
    upserts: doc.chapters.filter(c => old.get(c.id) !== fresh.get(c.id)),
    deletedChapterIds: base.chapters.filter(c => !fresh.has(c.id)).map(c => c.id),
    ...(JSON.stringify(base.chapters.map(c => c.id)) !== JSON.stringify(order) ? { chapterOrder: order } : {}),
  };
}
function validSource(s: unknown): boolean {
  if (s === null) return true;
  const x = s as { kind?: string; draftId?: unknown; from?: unknown };
  if (!x || typeof x !== 'object') return false;
  if (x.kind === 'legacy-draft') return isStr(x.draftId);
  return (x.kind === 'guest-claim' || x.kind === 'conflict-copy') && isStr(x.from);
}
const corrupt = (why: string) => new WriterStoreError('Kitap kaydı okunamadı (bozuk veri: ' + why + '). Kayıt silinmedi veya değiştirilmedi.');

/** Strict: every field is checked; when owner/id are given they must match the storage key. */
export function decodeRecord(raw: string, owner?: string, id?: string): WriterRecord {
  let r: Record<string, unknown>;
  try { r = JSON.parse(raw) as Record<string, unknown>; } catch { throw corrupt('JSON'); }
  if (!r || typeof r !== 'object' || r.v !== 1) throw corrupt('sürüm');
  if (!isNonEmpty(r.id) || !isStr(r.localId) || !isNonEmpty(r.owner)) throw corrupt('kimlik');
  if (owner !== undefined && r.owner !== owner) throw corrupt('sahip uyuşmuyor');
  if (id !== undefined && r.id !== id) throw corrupt('kitap kimliği uyuşmuyor');
  if (!validDoc(r.doc)) throw corrupt('belge');
  if (!isNat(r.version) || !isNat(r.ackedVersion) || !isNat(r.baseRevision)) throw corrupt('sürüm numaraları');
  if (typeof r.cloud !== 'boolean' || (r.publication !== 'draft' && r.publication !== 'published')) throw corrupt('yayın durumu');
  if (!dateOrNull(r.publishedAt) || !dateOrNull(r.cloudSavedAt) || !isTime(r.localSavedAt)) throw corrupt('zaman');
  if (!(r.pending === null || validPending(r.pending))) throw corrupt('bekleyen kayıt');
  if (r.syncBase !== undefined && r.syncBase !== null && (!validBase(r.syncBase) || r.syncBase.revision !== r.baseRevision)) throw corrupt('kayıt tabanı');
  const conflict = optional<{ at: number } | null>(r.conflict, (c) => c === null || (!!c && isTime((c as { at: unknown }).at)), null);
  const coverLocal = optional<LocalImage | null>(r.coverLocal, (c) => c === null || validImage(c), null);
  const lastError = optional<string | null>(r.lastError, strOrNull, null);
  const source = optional<RecordSource>(r.source, validSource, null);
  const editStamp = optional<string>(r.editStamp, isStr, '');
  if (conflict === false || coverLocal === false || lastError === false || source === false || editStamp === false) throw corrupt('ek alanlar');
  return { ...(r as unknown as WriterRecord), conflict, coverLocal, lastError, source, editStamp };
}

// ---------- unlocked internals (call only inside serial(bookKey)) ----------
async function rawGet(owner: string, id: string): Promise<WriterRecord | null> {
  const raw = await AsyncStorage.getItem(bookKey(owner, id));
  return raw == null ? null : decodeRecord(raw, owner, id);
}
async function isTomb(owner: string, id: string) { return (await AsyncStorage.getItem(tombKey(owner, id))) != null; }
async function guestClaimed(owner: string, id: string) { return owner === 'guest' && (await AsyncStorage.getItem(ledgerKey(id))) != null; }
async function rawPut(owner: string, id: string, next: WriterRecord) {
  if (next.owner !== owner || next.id !== id) throw new WriterStoreError('Kayıt sahibi veya kimliği uyuşmuyor; hiçbir şey yazılmadı.');
  if (await isTomb(owner, id)) throw new WriterDeletedError('Bu kitap silinmiş; yeniden yazılmadı.');
  if (await guestClaimed(owner, id)) throw new WriterDeletedError('Bu misafir taslağı bir hesaba aktarılmış; yeniden yazılmadı.');
  await AsyncStorage.setItem(bookKey(owner, id), JSON.stringify(next));
}

export function readRecord(owner: string, id: string): Promise<WriterRecord | null> {
  return serial(bookKey(owner, id), async () => {
    if (await isTomb(owner, id)) {
      if (await AsyncStorage.getItem(bookKey(owner, id)) != null) await AsyncStorage.removeItem(bookKey(owner, id));
      return null;
    }
    if (await guestClaimed(owner, id)) return null;
    return rawGet(owner, id);
  });
}

/** fn returns the new record, or null to leave storage untouched. Throws WriterDeletedError for tombstoned/claimed ids. */
export function updateRecord(owner: string, id: string, fn: (r: WriterRecord | null) => WriterRecord | null | Promise<WriterRecord | null>): Promise<WriterRecord | null> {
  return serial(bookKey(owner, id), async () => {
    if (await isTomb(owner, id)) throw new WriterDeletedError('Bu kitap silinmiş; yeniden yazılmadı.');
    if (await guestClaimed(owner, id)) throw new WriterDeletedError('Bu misafir taslağı bir hesaba aktarılmış; yeniden yazılmadı.');
    const cur = await rawGet(owner, id);
    const next = await fn(cur);
    if (!next) return cur;
    await rawPut(owner, id, next);
    return next;
  });
}

/** Tombstone first (atomic marker), then remove. A delayed save can never resurrect it. */
export function removeRecord(owner: string, id: string): Promise<void> {
  return serial(bookKey(owner, id), async () => {
    await AsyncStorage.setItem(tombKey(owner, id), JSON.stringify({ at: Date.now() }));
    await AsyncStorage.removeItem(bookKey(owner, id));
  });
}

/**
 * Atomic conflict backup: under the source lock, the LATEST source record is copied in full
 * (no truncation; a source marker identifies it) to copyId, and only then the source is replaced.
 * Any failure leaves the original untouched or a complete copy beside it.
 */
export function backupAndReplace(owner: string, id: string, copyId: string,
  toCopy: (cur: WriterRecord) => WriterRecord, replace: (cur: WriterRecord) => WriterRecord): Promise<WriterRecord> {
  return serial(bookKey(owner, id), async () => {
    if (await isTomb(owner, id)) throw new WriterDeletedError('Bu kitap silinmiş.');
    const cur = await rawGet(owner, id);
    if (!cur) throw new WriterStoreError('Yerel kayıt bulunamadı.');
    const copy = toCopy(cur);
    await updateRecord(owner, copyId, (c) => { if (c) throw new WriterStoreError('Yedek kimliği çakıştı; hiçbir şey değişmedi.'); return copy; });
    const verify = await readRecord(owner, copyId);
    if (!verify || JSON.stringify(verify) !== JSON.stringify(copy)) throw new WriterStoreError('Yedek doğrulanamadı; asıl kayıt değiştirilmedi.');
    const next = replace(cur);
    await rawPut(owner, id, next);
    return next;
  });
}

export type Listing = { records: WriterRecord[]; broken: string[] };
export async function listRecords(owner: string): Promise<Listing> {
  await recoverClaims();
  const prefix = PREFIX + 'book:' + owner + ':';
  const keys = (await AsyncStorage.getAllKeys()).filter((k) => k.startsWith(prefix));
  const records: WriterRecord[] = [], broken: string[] = [];
  for (const k of keys) {
    const id = k.slice(prefix.length);
    try { const r = await readRecord(owner, id); if (r) records.push(r); } catch { broken.push(id); }
  }
  records.sort((a, b) => b.localSavedAt - a.localSavedAt);
  return { records, broken };
}

export function newRecord(owner: string, id: string, localId: string, doc: WriterDocument, source: RecordSource = null): WriterRecord {
  return {
    v: 1, id, localId, owner, doc, version: 1, ackedVersion: 0, editStamp: newStamp(), baseRevision: 0, cloud: false,
    publication: 'draft', publishedAt: null, localSavedAt: Date.now(), cloudSavedAt: null,
    pending: null, conflict: null, coverLocal: null, lastError: null, source,
  };
}

// ---------- guest claim ledger ----------
type ClaimLedger = { v: 1; guestId: string; owner: string; at: number; done: boolean; snapshot: WriterRecord | null; docHash?: string };
/** Non-reversible fingerprint (kept forever, unlike the plaintext snapshot) to recognize identical stale text. */
function docHash(d: WriterDocument): Promise<string> {
  return digestStringAsync(CryptoDigestAlgorithm.SHA256, JSON.stringify(d));
}
async function readLedger(guestId: string): Promise<ClaimLedger | null> {
  const raw = await AsyncStorage.getItem(ledgerKey(guestId));
  if (raw == null) return null;
  let l: ClaimLedger;
  try { l = JSON.parse(raw) as ClaimLedger; } catch { throw new WriterStoreError('Aktarım kaydı bozuk.'); }
  if (!l || l.v !== 1 || l.guestId !== guestId || !isNonEmpty(l.owner) || typeof l.done !== 'boolean' || !isTime(l.at)) throw new WriterStoreError('Aktarım kaydı bozuk.');
  const snapshot = l.snapshot == null ? null : decodeRecord(JSON.stringify(l.snapshot), l.owner, guestId);
  if (!l.done && !snapshot) throw new WriterStoreError('Aktarım kaydı eksik.');
  return { ...l, snapshot };
}
/** Idempotent completion. Never overwrites an existing account record (newer edits there win). */
async function finishClaim(led: ClaimLedger) {
  if (led.snapshot) {
    try { await updateRecord(led.owner, led.guestId, (cur) => cur ? null : led.snapshot); }
    catch (e) { if (!(e instanceof WriterDeletedError)) throw e; /* claimed copy was deleted by its owner */ }
  }
  await serial(bookKey('guest', led.guestId), () => AsyncStorage.removeItem(bookKey('guest', led.guestId)));
  // The ownership marker is never removed; only the plaintext recovery snapshot is dropped.
  await AsyncStorage.setItem(ledgerKey(led.guestId), JSON.stringify({ ...led, done: true, snapshot: null }));
}

/** Explicit guest -> account claim. One owner per guest id, forever; crash-safe and recoverable. */
export function claimGuestRecord(owner: string, id: string): Promise<void> {
  if (owner === 'guest') return Promise.reject(new WriterStoreError('Önce giriş yap.'));
  return serial('gclaim:' + id, async () => {
    const existing = await readLedger(id);
    if (existing) {
      if (existing.owner !== owner) throw new WriterStoreError('Bu taslak bu cihazda başka bir hesaba aktarılmış.');
      if (!existing.done) await finishClaim(existing);
      return;
    }
    // Hold the guest book lock while the ledger (with the recovery snapshot) is written:
    // from this moment the guest copy is hidden and can't be written again.
    const led = await serial(bookKey('guest', id), async () => {
      const guest = await rawGet('guest', id);
      if (!guest) throw new WriterStoreError('Misafir taslağı bulunamadı.');
      const moved: WriterRecord = { ...guest, owner, cloud: false, baseRevision: 0, ackedVersion: 0, version: Math.max(1, guest.version), editStamp: newStamp(),
        syncBase: null, pending: null, conflict: null, publication: 'draft', publishedAt: null, cloudSavedAt: null, source: { kind: 'guest-claim', from: 'guest' } };
      const l: ClaimLedger = { v: 1, guestId: id, owner, at: Date.now(), done: false, snapshot: moved, docHash: await docHash(guest.doc) };
      await AsyncStorage.setItem(ledgerKey(id), JSON.stringify(l));
      return l;
    });
    await finishClaim(led);
  });
}

/** Completes any interrupted claim (any owner on this device); guest plaintext stays hidden meanwhile. */
async function recoverClaims() {
  const prefix = PREFIX + 'gclaim:';
  const keys = (await AsyncStorage.getAllKeys()).filter((k) => k.startsWith(prefix));
  for (const k of keys) {
    const gid = k.slice(prefix.length);
    try {
      await serial('gclaim:' + gid, async () => {
        const led = await readLedger(gid);
        if (led && !led.done) await finishClaim(led);
      });
    } catch { /* stays hidden; retried on next listing */ }
  }
}

/** Owner that claimed this guest id on this device, or null. */
export async function guestClaimOwner(guestId: string): Promise<string | null> {
  const led = await readLedger(guestId);
  return led ? led.owner : null;
}

/**
 * A late guest save for an already-claimed guest id. The text NEVER goes back to the guest namespace:
 * identical/stale text is discarded; genuinely newer text is recovered privately into the CLAIM OWNER'S
 * namespace as a new local copy. Returns 'discarded' | 'recovered'.
 */
export function recoverLateGuestText(guestId: string, doc: WriterDocument, coverLocal: LocalImage | null): Promise<'discarded' | 'recovered'> {
  return serial('gclaim:' + guestId, async () => {
    const led = await readLedger(guestId);
    if (!led) throw new WriterStoreError('Aktarım kaydı bulunamadı.');
    const h = await docHash(doc);
    if (led.docHash === h) return 'discarded';
    const ownerCopy = await readRecord(led.owner, guestId).catch(() => null);
    if (ownerCopy && await docHash(ownerCopy.doc) === h) return 'discarded';
    const copyId = randomUUID();
    const copyDoc = { ...doc, chapters: doc.chapters.map((c) => ({ ...c, id: randomUUID(), status: 'draft' as const })) };
    await updateRecord(led.owner, copyId, (c) => c ? null : { ...newRecord(led.owner, copyId, randomUUID(), copyDoc, { kind: 'guest-claim', from: guestId }), coverLocal });
    return 'recovered';
  });
}
