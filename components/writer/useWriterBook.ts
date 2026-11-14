import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { randomUUID } from 'expo-crypto';
import type { WriterDocument, WriterPublicationInputAction } from '@workspace/api-client-react';
import { useCommunity } from '@/context/CommunityContext';
import { guestClaimOwner, isDirty, newRecord, newStamp, readRecord, recoverLateGuestText, updateRecord, WriterDeletedError, type LocalImage, type WriterRecord } from '@/lib/writer-store';
import { adoptRemote, deleteBook, fetchRemote, publicationAction, pushBook, resolveConflict, type PushResult } from '@/lib/writer-sync';
import { restoreImage, uploadImage } from '@/lib/writer-media';
import { apiError } from '@/components/bulletins/common';
import { clockTR } from '@/lib/writer-text';

export type SyncView = { kind: 'local' | 'saving' | 'saved' | 'dirty' | 'offline' | 'error' | 'conflict' | 'storage'; text: string };
/** null = editable; drain = editor read-only but final flush events accepted; lock = no edits accepted. */
export type Freeze = null | 'drain' | 'lock';
const AUTOSAVE_MS = 5000;
const FLUSH_TIMEOUT_MS = 6000;

/** Server-owned chapter statuses are taken from `from`; text stays from `doc`. */
function withStatuses(doc: WriterDocument, from: WriterDocument): WriterDocument {
  const st = new Map(from.chapters.map((c) => [c.id, c.status]));
  return { ...doc, chapters: doc.chapters.map((c) => st.has(c.id) ? { ...c, status: st.get(c.id)! } : c) };
}

/**
 * Live manuscript state for one book (owner-bound). Typing goes to memory, then to durable storage
 * within ~350ms via an editStamp CAS (flushed on unmount/background), then to the cloud every 5s.
 * If another tab changed the stored content since our baseline, our text is saved as a NEW local
 * copy and editing freezes until the writer chooses; nothing is silently dropped.
 */
export function useWriterBook(owner: string, id: string, offline: boolean) {
  const { userId } = useCommunity();
  const signed = owner !== 'guest';
  const [rec, setRec] = useState<WriterRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [storageError, setStorageError] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [coverBusy, setCoverBusy] = useState(false);
  const [coverError, setCoverError] = useState<string | null>(null);
  const [unsaved, setUnsaved] = useState(false);
  const [frozen, setFrozenState] = useState<Freeze>(null);
  const [localConflict, setLocalConflictState] = useState<string | null>(null);
  const [epoch, setEpoch] = useState(0);
  const [claimedAway, setClaimedAway] = useState(false);
  const claimedRef = useRef(false);
  const live = useRef<WriterRecord | null>(null);
  const mounted = useRef(true);
  const deleted = useRef(false);
  const busy = useRef(false);
  const frozenRef = useRef<Freeze>(null);
  const localConflictRef = useRef<string | null>(null);
  const baseline = useRef('');
  const editSeq = useRef(0);
  const savedSeq = useRef(0);
  const chain = useRef<Promise<unknown>>(Promise.resolve());
  /** Registered by the editor: asks the engine to emit its final content now. */
  const flushRef = useRef<null | ((timeoutMs?: number, lock?: boolean) => Promise<void>)>(null);
  const persistT = useRef<ReturnType<typeof setTimeout> | null>(null);
  const viewer = useRef(userId ?? 'guest'); viewer.current = userId ?? 'guest';
  const offlineRef = useRef(offline); offlineRef.current = offline;
  const isLive = useCallback(() => mounted.current && viewer.current === owner && !deleted.current, [owner]);
  const commit = (r: WriterRecord) => { live.current = r; if (mounted.current) setRec(r); };
  const setFrozen = (f: Freeze) => { frozenRef.current = f; if (mounted.current) setFrozenState(f); };
  const setLocalConflict = (c: string | null) => { localConflictRef.current = c; if (mounted.current) setLocalConflictState(c); };

  /** Serialized; resolves true only after the bytes are actually in storage (or nothing was pending). */
  const persistNow = useCallback((): Promise<boolean> => {
    const once = async (): Promise<boolean> => {
      if (persistT.current) { clearTimeout(persistT.current); persistT.current = null; }
      const l = live.current;
      if (localConflictRef.current || claimedRef.current) return false;
      if (!l || deleted.current) return true;
      if (editSeq.current === savedSeq.current) return true;
      const seq = editSeq.current;
      let clash = false;
      let saved: WriterRecord | null = null;
      try {
        saved = await updateRecord(owner, id, (r) => {
          if (!r || r.editStamp !== baseline.current) { clash = true; return null; }
          return { ...r, doc: withStatuses(l.doc, r.doc), coverLocal: l.coverLocal, version: r.version + 1, editStamp: newStamp(), localSavedAt: Date.now() };
        });
      } catch (e) {
        if (!(e instanceof WriterDeletedError)) {
          if (mounted.current) setStorageError('Cihaza kaydedilemedi: ' + ((e as Error)?.message || 'depolama hatası') + ' Metnin ekranda duruyor; kopyalamadan kapatma.');
          throw e;
        }
        clash = true;
        if (owner === 'guest' && (await guestClaimOwner(id).catch(() => 'unknown'))) {
          // Claimed by an account: never fork into the guest namespace (privacy).
          claimedRef.current = true;
          frozenRef.current = 'lock'; if (mounted.current) { setFrozenState('lock'); setClaimedAway(true); }
          const latest = live.current ?? l;
          const latestSeq = editSeq.current;
          await recoverLateGuestText(id, latest.doc, latest.coverLocal);
          savedSeq.current = latestSeq;
          if (mounted.current) { setUnsaved(false); setStorageError(null); }
          return false;
        }
      }
      if (clash || !saved) {
        // Retain both: our latest text becomes a new local book; the stored one is untouched.
        // Lock first, then copy the very latest memory (including text typed during the await).
        const prevFreeze = frozenRef.current;
        frozenRef.current = 'lock'; if (mounted.current) setFrozenState('lock');
        const latest = live.current ?? l;
        const latestSeq = editSeq.current;
        const copyId = randomUUID();
        const doc = { ...latest.doc, chapters: latest.doc.chapters.map((c) => ({ ...c, id: randomUUID(), status: 'draft' as const })) };
        try {
          await updateRecord(owner, copyId, (c) => c ? null : { ...newRecord(owner, copyId, randomUUID(), doc, { kind: 'conflict-copy', from: id }), coverLocal: latest.coverLocal });
        } catch (e) {
          frozenRef.current = prevFreeze; if (mounted.current) setFrozenState(prevFreeze);
          if (mounted.current) setStorageError('Bu kitap başka bir sekmede değişti ve metnin ayrı kopya olarak kaydedilemedi: ' + ((e as Error)?.message || '') + ' Metnin ekranda duruyor.');
          throw e;
        }
        savedSeq.current = latestSeq;
        setLocalConflict(copyId);
        if (mounted.current) { setUnsaved(false); setStorageError(null); }
        return false;
      }
      baseline.current = saved.editStamp;
      savedSeq.current = seq;
      const cur = live.current ?? saved;
      commit({ ...saved, doc: withStatuses(cur.doc, saved.doc), coverLocal: cur.coverLocal });
      if (mounted.current) { setUnsaved(editSeq.current !== seq); setStorageError(null); }
      return true;
    };
    const p = chain.current.catch(() => undefined).then(once);
    chain.current = p;
    return p;
  }, [owner, id]);
  const schedule = useCallback(() => {
    if (persistT.current) clearTimeout(persistT.current);
    persistT.current = setTimeout(() => { void persistNow().catch(() => undefined); }, 350);
  }, [persistNow]);

  /** Metadata only (cloud ack, publication, pending): never replaces newer typed text. */
  const refreshMeta = useCallback(async () => {
    const r = await readRecord(owner, id);
    const l = live.current;
    if (!r || !l || !isLive()) return;
    commit({ ...l, version: r.version, ackedVersion: r.ackedVersion, baseRevision: r.baseRevision, cloud: r.cloud, pending: r.pending, conflict: r.conflict, lastError: r.lastError,
      publication: r.publication, publishedAt: r.publishedAt, cloudSavedAt: r.cloudSavedAt, localSavedAt: r.localSavedAt, doc: withStatuses(l.doc, r.doc) });
  }, [owner, id, isLive]);

  const load = useCallback(async () => {
    setLoading(true); setLoadError(null);
    try {
      let r = await readRecord(owner, id);
      if (!r && signed) r = await adoptRemote(owner, await fetchRemote(owner, id));
      else if (r && signed && r.cloud && !offlineRef.current && !isDirty(r) && !r.pending && !r.conflict) {
        try { r = (await adoptRemote(owner, await fetchRemote(owner, id))) ?? r; } catch { /* keep local */ }
      }
      if (!r) throw new Error('Bu kitap bu cihazda bulunamadı.');
      const stamp = r.editStamp;
      if (r.coverLocal) {
        try { r = { ...r, coverLocal: await restoreImage(r.coverLocal) }; } catch (e) { setCoverError((e as Error).message); }
      }
      if (!isLive()) return;
      baseline.current = stamp;
      editSeq.current = 0; savedSeq.current = 0;
      setLocalConflict(null); setFrozen(null); setUnsaved(false);
      commit(r);
      setEpoch((e) => e + 1);
    } catch (e) {
      if (isLive()) setLoadError((e as Error)?.message && !(e as { status?: number }).status ? (e as Error).message : apiError(e, 'Kitap açılamadı.'));
    } finally { if (mounted.current) setLoading(false); }
  }, [owner, id, signed, isLive]);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { mounted.current = true; void load(); return () => { mounted.current = false; }; }, []);

  const accepting = () => isLive() && frozenRef.current !== 'lock' && !localConflictRef.current && !claimedRef.current;
  const touch = (r: WriterRecord) => { editSeq.current++; commit(r); if (mounted.current) setUnsaved(true); };

  const edit = useCallback((fn: (d: WriterDocument) => WriterDocument) => {
    if (!accepting()) return;
    const l = live.current;
    if (!l) return;
    const d = fn(l.doc);
    if (d === l.doc) return;
    touch({ ...l, doc: d });
    schedule();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [schedule, isLive]);

  const setCoverLocal = useCallback((img: LocalImage | null, clearCover = false) => {
    if (!accepting()) return;
    const l = live.current;
    if (!l) return;
    setCoverError(null);
    touch({ ...l, coverLocal: img, doc: clearCover ? { ...l.doc, cover: null } : l.doc });
    void persistNow().catch(() => undefined);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [persistNow, isLive]);

  const sync = useCallback(async (): Promise<PushResult> => {
    if (!signed || busy.current || !live.current || localConflictRef.current) return 'clean';
    busy.current = true; setSyncing(true);
    try {
      await persistNow();
      const res = await pushBook(owner, id, isLive);
      await refreshMeta();
      return res;
    } finally { busy.current = false; if (mounted.current) setSyncing(false); }
  }, [signed, owner, id, persistNow, refreshMeta, isLive]);

  const uploadCover = useCallback(async () => {
    const img = live.current?.coverLocal;
    if (!img || !signed) return false;
    setCoverBusy(true); setCoverError(null);
    try {
      const url = await uploadImage(img, owner);
      const cur = live.current;
      if (!accepting() || !cur || cur.coverLocal?.key !== img.key) return false;
      touch({ ...cur, coverLocal: null, doc: { ...cur.doc, cover: url } });
      return await persistNow();
    } catch (e) {
      if (isLive()) setCoverError((e as Error)?.message && !(e as { status?: number }).status ? (e as Error).message : apiError(e, 'Kapak yüklenemedi. Cihazda saklı.'));
      return false;
    } finally { if (mounted.current) setCoverBusy(false); }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signed, owner, isLive, persistNow]);

  // 5s cloud autosave.
  useEffect(() => {
    if (!signed || offline) return;
    const t = setInterval(() => {
      const l = live.current;
      if (l && !l.conflict && !frozenRef.current && (isDirty(l) || l.pending || editSeq.current !== savedSeq.current)) void sync().catch(() => undefined);
    }, AUTOSAVE_MS);
    return () => clearInterval(t);
  }, [signed, offline, sync]);

  // Pending local cover uploads when a connection exists.
  const coverKey = rec?.coverLocal?.key;
  useEffect(() => { if (coverKey && signed && !offline) void uploadCover(); }, [coverKey, signed, offline, uploadCover]);

  // Flush on background/hidden page + intentional captured-owner unmount persistence.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => { if (s !== 'active') { void flushRef.current?.(1500).catch(() => undefined); void persistNow().catch(() => undefined); } });
    const w = (globalThis as { window?: { addEventListener?: (n: string, f: () => void) => void; removeEventListener?: (n: string, f: () => void) => void } }).window;
    const onHide = () => { void flushRef.current?.(1500).catch(() => undefined); void persistNow().catch(() => undefined); };
    w?.addEventListener?.('pagehide', onHide);
    w?.addEventListener?.('blur', onHide);
    return () => { sub.remove(); w?.removeEventListener?.('pagehide', onHide); w?.removeEventListener?.('blur', onHide); void persistNow().catch(() => undefined); };
  }, [persistNow]);

  /** Freeze editor, collect its final event, then lock edits for a critical operation. */
  const freeze = useCallback(async () => {
    if (frozenRef.current || localConflictRef.current) throw new Error('Başka bir işlem sürüyor veya çözülmemiş bir çakışma var.');
    setFrozen('drain'); // editor receives readOnly first; its final events are still accepted
    try {
      const f = flushRef.current;
      if (!f) throw new Error('Editör hazır değil; son yazılanlar doğrulanamadı.');
      await f(FLUSH_TIMEOUT_MS, true);
    } catch (e) {
      setFrozen(null);
      throw new Error(((e as Error)?.message || 'Editör yanıt vermedi.') + ' İşlem yapılmadı; metnin olduğu gibi duruyor, tekrar dene.');
    }
    setFrozen('lock');
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const unfreeze = () => { if (!localConflictRef.current) setFrozen(null); };

  /** Flush local + cloud until clean, or explain why not. */
  const ensureClean = useCallback(async () => {
    if (!(await persistNow())) throw new Error('Bu kitap başka bir sekmede değişti; önce yerel çakışmayı çöz.');
    if (live.current?.coverLocal) { if (!(await uploadCover())) throw new Error('Kapak henüz yüklenmedi.'); }
    for (let i = 0; i < 4; i++) {
      const l = live.current!;
      if (l.conflict) throw new Error('Önce sürüm çakışmasını çöz.');
      if (!isDirty(l) && !l.pending) return;
      const r = await sync();
      if (r === 'offline') throw new Error('Bağlantı yok. Değişikliklerin cihazda saklı.');
      if (r === 'error') throw new Error(live.current?.lastError || 'Buluta kaydedilemedi.');
      if (r === 'conflict') throw new Error('Bu kitap başka bir cihazda değişti.');
    }
    if (isDirty(live.current!) || live.current!.pending) throw new Error('Kaydetme tamamlanamadı, tekrar dene.');
  }, [persistNow, uploadCover, sync]);

  const act = useCallback(async (action: WriterPublicationInputAction, chapterId?: string) => {
    await freeze();
    try {
      // uploadCover is refused while locked, so it runs before the lock-sensitive part.
      setFrozen('drain');
      await ensureClean();
      setFrozen('lock');
      await publicationAction(owner, id, action, chapterId);
      await refreshMeta();
    } finally { unfreeze(); }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [freeze, ensureClean, owner, id, refreshMeta]);

  const resolve = useCallback(async () => {
    await freeze();
    try {
      if (!(await persistNow())) throw new Error('Bu kitap başka bir sekmede de değişti; önce o çakışmayı çöz.');
      const copyId = await resolveConflict(owner, id);
      await load();
      return copyId;
    } finally { unfreeze(); }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [freeze, persistNow, owner, id, load]);

  /** Local-conflict: open the stored (other tab's) version here. Our text is already in the copy. */
  const reloadAfterLocalConflict = useCallback(async () => { await load(); }, [load]);

  const remove = useCallback(async () => {
    const hadLocalConflict = !!localConflictRef.current;
    if (!hadLocalConflict) await freeze();
    try { if (!hadLocalConflict) await persistNow(); } catch { /* deleting anyway is the explicit intent */ }
    deleted.current = true;
    if (persistT.current) { clearTimeout(persistT.current); persistT.current = null; }
    try { await deleteBook(owner, id); }
    catch (e) { deleted.current = false; unfreeze(); throw e; }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [freeze, persistNow, owner, id]);

  const view: SyncView = (() => {
    const r = rec;
    if (storageError) return { kind: 'storage', text: 'Cihaza kaydedilemedi' };
    if (!r) return { kind: 'dirty', text: '' };
    if (claimedAway) return { kind: 'conflict', text: 'Hesaba aktarıldı' };
    if (localConflict) return { kind: 'conflict', text: 'Başka bir sekmede değişti' };
    if (unsaved) return { kind: 'saving', text: 'Cihaza kaydediliyor…' };
    if (!signed) return { kind: 'local', text: 'Cihaza kaydedildi · ' + clockTR(r.localSavedAt) };
    if (r.conflict) return { kind: 'conflict', text: 'Sürüm çakışması' };
    if (syncing) return { kind: 'saving', text: 'Kaydediliyor…' };
    const dirty = isDirty(r) || !!r.pending;
    if (dirty && offline) return { kind: 'offline', text: 'Çevrimdışı · cihazda saklı ' + clockTR(r.localSavedAt) };
    if (dirty && r.lastError) return { kind: 'error', text: 'Buluta kaydedilemedi' };
    if (dirty) return { kind: 'dirty', text: 'Cihazda saklı · buluta gönderilecek' };
    return { kind: 'saved', text: 'Kaydedildi ' + clockTR(r.cloudSavedAt ?? r.localSavedAt) };
  })();

  return { rec, loading, loadError, storageError, syncing, coverBusy, coverError, view, signed, unsaved,
    frozen: frozen !== null || !!localConflict || claimedAway, claimedAway, localConflict, epoch, flushRef,
    reload: load, reloadAfterLocalConflict, edit, setCoverLocal, uploadCover, sync, persistNow, ensureClean, act, resolve, remove, liveRef: live };
}
export type WriterBookApi = ReturnType<typeof useWriterBook>;
