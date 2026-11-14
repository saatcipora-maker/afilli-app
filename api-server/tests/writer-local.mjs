import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { transform } from 'esbuild';

const memory = new Map(), lockTails = new Map();
let failKey = null;
const storage = {
  getItem: async key => memory.get(key) ?? null,
  setItem: async (key, value) => { if (key === failKey) { failKey = null; throw new Error('Disk full'); } memory.set(key, value); },
  removeItem: async key => { memory.delete(key); },
  getAllKeys: async () => [...memory.keys()],
};
const locks = { request(name, callback) {
  const next = (lockTails.get(name) ?? Promise.resolve()).catch(() => {}).then(callback);
  lockTails.set(name, next); return next;
} };
const crypto = { randomUUID, CryptoDigestAlgorithm: { SHA256: 'SHA-256' }, digestStringAsync: async (_, text) => createHash('sha256').update(text).digest('hex') };
async function load(file, dependencies) {
  const source = await readFile(new URL('../../afilli/' + file, import.meta.url), 'utf8');
  const code = (await transform(source, { loader: 'ts', format: 'cjs' })).code;
  const module = { exports: {} };
  vm.runInNewContext(code, { module, exports: module.exports, navigator: { locks }, require: name => {
    if (!(name in dependencies)) throw new Error('Unexpected import: ' + name);
    return dependencies[name];
  } }, { filename: file });
  return module.exports;
}
const dependencies = { '@/lib/writer-storage': storage, 'expo-crypto': crypto };
const a = await load('lib/writer-store.ts', dependencies), b = await load('lib/writer-store.ts', dependencies);
const key = (owner, id) => `afilli:writer:v1:book:${owner}:${id}`;
const document = (html = '<p>Kaybolmayacak yazı.</p>') => ({ title: 'Yazı', description: '', cover: null, genres: ['Roman'], ageRating: 'all', language: 'Türkçe', completion: 'ongoing', chapters: [{ id: randomUUID(), title: 'Bölüm', html, status: 'draft' }] });
const create = async (owner, doc = document()) => {
  const id = randomUUID(); await a.updateRecord(owner, id, () => a.newRecord(owner, id, randomUUID(), doc)); return id;
};
const id = await create('A');
await Promise.all(Array.from({ length: 40 }, (_, i) => (i % 2 ? a : b).updateRecord('A', id, r => ({
  ...r, version: r.version + 1, editStamp: a.newStamp(), doc: { ...r.doc, description: r.doc.description + 'x' },
}))));
assert.equal((await a.readRecord('A', id)).doc.description.length, 40);
const bytes = memory.get(key('A', id));
memory.set(key('B', id), bytes);
await assert.rejects(a.readRecord('B', id), /sahip/);
await assert.rejects(a.updateRecord('B', id, () => a.newRecord('B', id, id, document())), /sahip/);
assert.equal(memory.get(key('B', id)), bytes);
for (const mutation of [
  r => ({ ...r, doc: { ...r.doc, ageRating: 'invalid' } }),
  r => ({ ...r, doc: { ...r.doc, completion: null } }),
  r => ({ ...r, pending: { saveId: 'not-a-uuid' } }),
  r => ({ ...r, cloudSavedAt: 'not-a-date' }),
]) assert.throws(() => a.decodeRecord(JSON.stringify(mutation(JSON.parse(bytes)))), /bozuk/);
const corrupt = randomUUID(); memory.set(key('A', corrupt), '{broken');
await assert.rejects(a.updateRecord('A', corrupt, () => a.newRecord('A', corrupt, corrupt, document())), /bozuk/);
assert.equal(memory.get(key('A', corrupt)), '{broken');
assert.ok((await a.listRecords('A')).broken.includes(corrupt));
const long = await create('A', document('<p>' + 'x'.repeat(50_001) + '</p>'));
assert.equal((await a.readRecord('A', long)).doc.chapters[0].html.length, 50_008);
console.log('PASS two-context locks, strict owner/metadata restoration, corrupt-byte preservation and recoverable over-limit text');

const guest = await create('guest'), guestDoc = (await a.readRecord('guest', guest)).doc;
failKey = key('A', guest);
await assert.rejects(a.claimGuestRecord('A', guest), /Disk full/);
assert.equal(await a.readRecord('guest', guest), null);
await assert.rejects(b.claimGuestRecord('B', guest), /başka/);
assert.ok((await a.listRecords('A')).records.some(r => r.id === guest));
assert.equal(await a.recoverLateGuestText(guest, guestDoc, null), 'discarded');
assert.equal(await a.recoverLateGuestText(guest, { ...guestDoc, description: 'Son anda eklenen yazı' }, null), 'recovered');
assert.equal((await a.listRecords('guest')).records.length, 0);
assert.ok((await a.listRecords('A')).records.some(r => r.doc.description === 'Son anda eklenen yazı'));
const newGuest = await create('guest');
await b.claimGuestRecord('B', newGuest);
assert.ok(await b.readRecord('B', newGuest));
const race = await create('guest');
const claims = await Promise.allSettled([a.claimGuestRecord('A', race), b.claimGuestRecord('B', race)]);
assert.equal(claims.filter(result => result.status === 'fulfilled').length, 1);
assert.equal(await a.readRecord('guest', race), null);
await a.removeRecord('A', id);
await assert.rejects(b.updateRecord('A', id, () => a.newRecord('A', id, id, document())), /silinmiş/);
assert.equal(await a.readRecord('A', id), null);
console.log('PASS atomic/recoverable guest claims, cross-account exclusion, late guest privacy and local deletion tombstones');

let networkCalls = 0, online = false, server = null, firstSave = null;
const api = {
  async saveWriterBook(bookId, input, request) {
    networkCalls++; assert.equal(request.headers['X-Afilli-Actor'], 'A');
    if (!server) { firstSave = input.saveId; server = { id: bookId, localId: input.localId, document: structuredClone(input.document), revision: 1, publication: 'draft', publishedAt: null, updatedAt: new Date().toISOString() }; }
    if (!online) throw new TypeError('Network failed after server commit');
    if (input.saveId !== firstSave) server = { ...server, document: structuredClone(input.document), revision: server.revision + 1 };
    return server;
  },
  async getWriterBook() { return server; },
  async patchWriterBook(bookId, input, request) {
    networkCalls++; assert.equal(request.headers['X-Afilli-Actor'], 'A');
    assert.equal(input.expectedRevision, server.revision);
    const chapters = new Map(server.document.chapters.filter(c => !input.deletedChapterIds.includes(c.id)).map(c => [c.id, c]));
    input.upserts.forEach(c => chapters.set(c.id, structuredClone(c)));
    server = { ...server, document: { ...server.document, ...input.metadata,
      chapters: (input.chapterOrder ?? server.document.chapters.map(c => c.id)).map(id => chapters.get(id)) }, revision: server.revision + 1 };
    return { id: bookId, saveId: input.saveId, revision: server.revision, updatedAt: server.updatedAt };
  },
  async changeWriterPublication() { return server; },
  async deleteWriterBook() { if (!online) throw new TypeError('Network failed'); },
};
const sync = await load('lib/writer-sync.ts', { 'expo-crypto': crypto, '@workspace/api-client-react': api, '@/lib/writer-store': a, '@/components/bulletins/common': { apiError: (e, fallback) => e.message ?? fallback, OFFLINE: 'Bağlantı yok.' } });
const syncId = await create('A');
assert.equal(await sync.pushBook('A', syncId, () => true), 'offline');
const pendingId = (await a.readRecord('A', syncId)).pending.saveId;
await a.updateRecord('A', syncId, r => ({ ...r, version: r.version + 1, editStamp: a.newStamp(), doc: { ...r.doc, description: 'Daha yeni yazı' } }));
online = true;
assert.equal(await sync.pushBook('A', syncId, () => true), 'saved');
let current = await a.readRecord('A', syncId);
assert.equal(firstSave, pendingId); assert.equal(current.doc.description, 'Daha yeni yazı'); assert.equal(current.ackedVersion, 1); assert.equal(current.version, 2);
await sync.pushBook('A', syncId, () => true);
assert.equal((await a.readRecord('A', syncId)).ackedVersion, 2); assert.equal(server.revision, 2);
await a.updateRecord('A', syncId, r => ({ ...r, version: r.version + 1, doc: { ...r.doc, title: 'x'.repeat(100) } }));
const callsBefore = networkCalls;
assert.equal(await sync.pushBook('A', syncId, () => false), 'stale'); assert.equal(networkCalls, callsBefore);
const copy = await sync.resolveConflict('A', syncId);
assert.equal((await a.readRecord('A', copy)).doc.title.length, 100);
assert.equal((await a.readRecord('A', syncId)).cloud, true);
online = false;
await assert.rejects(sync.deleteBook('A', copy), /Network/);
assert.ok(await a.readRecord('A', copy));
online = true;
await sync.deleteBook('A', copy);
assert.equal(await a.readRecord('A', copy), null);
console.log('PASS lost-response replay, newer-text preservation, live-owner guard, full conflict backup and honest uncertain deletion');

// Real sync/store code, durable restart and adversarial request timing; transport only is simulated.
const large = document();
large.chapters = Array.from({ length: 100 }, (_, i) => ({
  id: randomUUID(), title: `Bölüm ${i}`, html: '<p>' + 'ş'.repeat(40_000) + '</p>', status: 'draft',
}));
const deltaId = randomUUID(), remote = { id: deltaId, localId: deltaId, document: large, revision: 10,
  publication: 'published', publishedAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
await sync.adoptRemote('A', remote);
let lastInput, loseResponse = true, accepted = null, revision = 10, duringRequest = null;
const deltaApi = { ...api, async patchWriterBook(id, input, request) {
  assert.equal(id, deltaId); assert.equal(request.headers['X-Afilli-Actor'], 'A');
  lastInput = structuredClone(input);
  if (accepted?.saveId === input.saveId) assert.equal(JSON.stringify(input), accepted.payload);
  else {
    assert.equal(input.expectedRevision, revision);
    revision++;
    accepted = { saveId: input.saveId, payload: JSON.stringify(input) };
  }
  if (duringRequest) await duringRequest();
  if (loseResponse) throw new TypeError('Network failed after delta commit');
  return { id, saveId: input.saveId, revision, updatedAt: remote.updatedAt };
} };
const loadSync = () => load('lib/writer-sync.ts', { 'expo-crypto': crypto, '@workspace/api-client-react': deltaApi,
  '@/lib/writer-store': a, '@/components/bulletins/common': { apiError: (e, fallback) => e.message ?? fallback, OFFLINE: 'Bağlantı yok.' } });
let ds = await loadSync();
const editLarge = fn => a.updateRecord('A', deltaId, r => ({ ...r, doc: fn(r.doc), version: r.version + 1, editStamp: a.newStamp() }));
await editLarge(d => ({ ...d, chapters: d.chapters.map((c, i) => i === 51 ? { ...c, html: c.html.replace('</p>', 'yeni</p>') } : c) }));
assert.equal(await ds.pushBook('A', deltaId, () => true), 'offline');
assert.equal(lastInput.upserts.length, 1); assert.equal(lastInput.metadata, undefined); assert.equal(lastInput.chapterOrder, undefined);
const fullBytes = Buffer.byteLength(JSON.stringify({ document: large, expectedRevision: 10, saveId: lastInput.saveId }));
const deltaBytes = Buffer.byteLength(JSON.stringify(lastInput));
assert.ok(deltaBytes < fullBytes * .02);
const durable = (await a.readRecord('A', deltaId)).pending;
await editLarge(d => ({ ...d, title: 'Daha yeni başlık', chapters: d.chapters.map((c, i) => i === 52 ? { ...c, html: '<p>Yeni metin</p>' } : c) }));
ds = await loadSync(); loseResponse = false; // Reload must replay the exact persisted delta, not recompute.
assert.equal(await ds.pushBook('A', deltaId, () => true), 'saved');
assert.equal(JSON.stringify(lastInput), JSON.stringify(durable.delta)); assert.equal(revision, 11);
current = await a.readRecord('A', deltaId);
assert.equal(current.doc.title, 'Daha yeni başlık'); assert.ok(a.isDirty(current));
assert.equal(current.syncBase.revision, 11);
await ds.pushBook('A', deltaId, () => true);
assert.equal(lastInput.upserts.length, 1); assert.equal(lastInput.upserts[0].id, large.chapters[52].id);
assert.equal(lastInput.metadata.title, 'Daha yeni başlık');
assert.equal(a.isDirty(await a.readRecord('A', deltaId)), false);
await editLarge(d => ({ ...d, chapters: [...d.chapters].reverse().slice(1) }));
await ds.pushBook('A', deltaId, () => true);
assert.equal(lastInput.upserts.length, 0); assert.equal(lastInput.deletedChapterIds.length, 1); assert.equal(lastInput.chapterOrder.length, 99);
const added = document().chapters[0];
await editLarge(d => ({ ...d, chapters: [added, ...d.chapters] }));
await ds.pushBook('A', deltaId, () => true);
assert.equal(lastInput.upserts.length, 1); assert.equal(lastInput.chapterOrder.length, 100);
// A late acknowledgement is allowed only in its captured owner namespace.
const other = await create('B'), otherBytes = memory.get(key('B', other));
let liveOwner = true;
await editLarge(d => ({ ...d, description: 'Hesap değişmeden önce' }));
duringRequest = async () => { liveOwner = false; };
await ds.pushBook('A', deltaId, () => liveOwner);
assert.equal(memory.get(key('B', other)), otherBytes);
assert.equal(await ds.pushBook('A', deltaId, () => false), 'stale');
// Failed durable outbox write must not start any network request.
await editLarge(d => ({ ...d, description: 'Diskte tutulacak' }));
const beforeFailure = JSON.stringify(lastInput);
failKey = key('A', deltaId);
await assert.rejects(ds.pushBook('A', deltaId, () => true), /Disk full/);
assert.equal(JSON.stringify(lastInput), beforeFailure); assert.equal((await a.readRecord('A', deltaId)).pending, null);
// Deleting locally while awaiting the response must never recreate the book.
duringRequest = () => a.removeRecord('A', deltaId);
await ds.pushBook('A', deltaId, () => true);
assert.equal(await a.readRecord('A', deltaId), null);
// Existing v1 records/outboxes without sync fingerprints still use the full-save route.
const oldId = await create('A');
await a.updateRecord('A', oldId, r => ({ ...r, pending: { saveId: randomUUID(), baseRevision: 0,
  snapshot: r.doc, version: r.version, createdAt: Date.now() } }));
server = null; online = true;
assert.equal(await sync.pushBook('A', oldId, () => true), 'saved');
const badBase = await a.readRecord('A', oldId);
assert.throws(() => a.decodeRecord(JSON.stringify({ ...badBase, syncBase: { ...badBase.syncBase, revision: 999 } })), /bozuk/);
const conflictId = await create('A');
await a.updateRecord('A', conflictId, r => ({ ...r, cloud: true, baseRevision: 3, ackedVersion: 1,
  syncBase: null }));
const rawDoc = document('<p style="unknown: value">Ham metin</p>');
await sync.adoptRemote('A', { ...remote, id: conflictId, document: rawDoc, revision: 4 });
await a.updateRecord('A', conflictId, r => ({ ...r, version: r.version + 1, doc: { ...r.doc, description: 'Yerel ve korunacak' } }));
const conflictApi = { ...api, async patchWriterBook() { throw { status: 409 }; } };
const cs = await load('lib/writer-sync.ts', { 'expo-crypto': crypto, '@workspace/api-client-react': conflictApi,
  '@/lib/writer-store': a, '@/components/bulletins/common': { apiError: () => 'hata', OFFLINE: 'Bağlantı yok.' } });
assert.equal(await cs.pushBook('A', conflictId, () => true), 'conflict');
const clashed = await a.readRecord('A', conflictId);
assert.ok(clashed.pending && clashed.conflict && a.isDirty(clashed));
assert.equal(clashed.doc.description, 'Yerel ve korunacak');
assert.equal(clashed.pending.delta.upserts.length, 0);
assert.equal(clashed.baseRevision, 4);
// Server-normalized HTML must not become the comparison baseline for untouched editor HTML.
server = null; online = true;
const normalizedApi = { ...api, async saveWriterBook(id, input, request) {
  const book = await api.saveWriterBook(id, input, request);
  return { ...book, document: { ...book.document, chapters: book.document.chapters.map(c => ({ ...c, html: '<p>Ham metin</p>' })) } };
} };
const ns = await load('lib/writer-sync.ts', { 'expo-crypto': crypto, '@workspace/api-client-react': normalizedApi,
  '@/lib/writer-store': a, '@/components/bulletins/common': { apiError: () => 'hata', OFFLINE: 'Bağlantı yok.' } });
const rawId = await create('A', rawDoc);
await ns.pushBook('A', rawId, () => true);
const normalizedRecord = await a.readRecord('A', rawId);
const fingerprints = await a.fingerprintDocument(normalizedRecord.doc, normalizedRecord.baseRevision);
assert.equal(a.chapterDelta(normalizedRecord.doc, normalizedRecord.syncBase, fingerprints, randomUUID()).upserts.length, 0);
console.log(`PASS chapter deltas: ${fullBytes} → ${deltaBytes} request bytes (${(100 * (1 - deltaBytes / fullBytes)).toFixed(1)}% less), durable replay, structural edits, account switch, storage failure, delete race and v1 migration`);

// Exercise the native adapter against real files, including File.move's URI mutation.
const tempRoot = await mkdtemp(fileURLToPath(new URL('../../../generated-artifacts/writer-storage-', import.meta.url)));
let failMove = false;
class Entry {
  constructor(...parts) { this.uri = path.join(...parts.map(part => typeof part === 'string' ? part : part.uri)); }
  get name() { return path.basename(this.uri); }
  get exists() { return fs.existsSync(this.uri); }
  delete() { fs.rmSync(this.uri, { recursive: true }); }
}
class Directory extends Entry {
  create() { fs.mkdirSync(this.uri, { recursive: true }); }
  list() { return fs.readdirSync(this.uri).map(name => fs.statSync(path.join(this.uri, name)).isDirectory() ? new Directory(this, name) : new File(this, name)); }
}
class File extends Entry {
  write(value) { fs.writeFileSync(this.uri, value); }
  async text() { return fs.readFileSync(this.uri, 'utf8'); }
  move(target) { if (failMove) throw new Error('Interrupted commit'); fs.renameSync(this.uri, target.uri); this.uri = target.uri; }
}
try {
  const native = (await load('lib/writer-storage.ts', { '@react-native-async-storage/async-storage': storage, 'expo-crypto': crypto, 'expo-file-system': { File, Directory, Paths: { document: tempRoot } } })).default;
  for (const unsafe of ['../escape', 'afilli:writer:bad/escape', 'afilli:writer:%2fescape', ':'.repeat(100)])
    await assert.rejects(native.setItem(unsafe, 'never write'), /kimliği geçersiz/);
  const nativeKey = 'afilli:writer:large-check', large = 'ş'.repeat(4_000_000);
  await native.setItem(nativeKey, large);
  assert.equal(await native.getItem(nativeKey), large);
  failMove = true;
  await assert.rejects(native.setItem(nativeKey, 'not committed'), /Interrupted/);
  assert.equal(await native.getItem(nativeKey), large);
  failMove = false;
  await native.setItem(nativeKey, 'new committed text');
  assert.equal(await native.getItem(nativeKey), 'new committed text');
  const files = new Directory(tempRoot, 'afilli-writer-v1', encodeURIComponent(nativeKey)).list().filter(file => file.name.endsWith('.json')).sort((x, y) => y.name.localeCompare(x.name));
  files[0].write('{broken');
  await assert.rejects(native.getItem(nativeKey), /okunamadı/);
  assert.equal(await files[0].text(), '{broken');
  await native.removeItem(nativeKey); assert.equal(await native.getItem(nativeKey), null);
  console.log('PASS native file adapter: 8 MB text, committed generations, interrupted rename, corruption detection and durable removal');
} finally { await rm(tempRoot, { recursive: true, force: true }); }
