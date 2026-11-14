import { randomUUID } from 'expo-crypto';
import { saveWriterBook, patchWriterBook, getWriterBook, changeWriterPublication, deleteWriterBook, type WriterBook, type WriterPublicationInputAction } from '@workspace/api-client-react';
import { chapterDelta, fingerprintDocument, isDirty, readRecord, removeRecord, updateRecord, newRecord, newStamp, backupAndReplace, WriterDeletedError, type WriterRecord } from '@/lib/writer-store';
import { apiError, OFFLINE } from '@/components/bulletins/common';

const actor = (owner: string) => ({ headers: { 'X-Afilli-Actor': owner } });
export type PushResult = 'saved' | 'clean' | 'conflict' | 'offline' | 'error' | 'stale';

function status(e: unknown): number | undefined { return (e as { status?: number } | null)?.status; }
export function isOffline(e: unknown) {
  const s = status(e);
  return s === 0 || s === undefined && /network|fetch|failed|abort/i.test(String((e as Error)?.message ?? ''));
}

/** Applies server publication meta + chapter statuses without touching newer typed text. */
function absorb(r: WriterRecord, book: WriterBook): WriterRecord {
  const statuses = new Map(book.document.chapters.map((c) => [c.id, c.status]));
  return {
    ...r, baseRevision: book.revision, cloud: true, publication: book.publication, publishedAt: book.publishedAt, cloudSavedAt: book.updatedAt,
    doc: { ...r.doc, chapters: r.doc.chapters.map((c) => statuses.has(c.id) ? { ...c, status: statuses.get(c.id)! } : c) },
  };
}

/**
 * One durable cloud save step. Pending {saveId, baseRevision, snapshot} is persisted
 * BEFORE the request; the same pending is retried after offline/reload (idempotent).
 */
export async function pushBook(owner: string, id: string, live: () => boolean): Promise<PushResult> {
  if (owner === 'guest') return 'clean';
  if (!live()) return 'stale';
  const prepared = await updateRecord(owner, id, async (r) => {
    if (!r || r.conflict || r.pending || !isDirty(r)) return null;
    const saveId = randomUUID();
    const delta = r.cloud && r.baseRevision > 0 && r.syncBase?.revision === r.baseRevision
      ? chapterDelta(r.doc, r.syncBase, await fingerprintDocument(r.doc, r.baseRevision), saveId) : undefined;
    return { ...r, pending: { saveId, baseRevision: r.baseRevision, snapshot: r.doc, version: r.version, createdAt: Date.now(), ...(delta ? { delta } : {}) } };
  });
  if (!prepared) return 'clean';
  if (prepared.conflict) return 'conflict';
  const p = prepared.pending;
  if (!p) return 'clean';
  if (!live()) return 'stale';
  try {
    const book = p.delta
      ? await patchWriterBook(id, p.delta, actor(owner))
      : await saveWriterBook(id, { document: p.snapshot, expectedRevision: p.baseRevision, saveId: p.saveId, localId: prepared.localId.slice(0, 200) }, actor(owner));
    if (book.id !== id || ('saveId' in book && book.saveId !== p.saveId)) throw new Error('Kayıt yanıtı doğrulanamadı.');
    const syncBase = await fingerprintDocument(p.snapshot, book.revision);
    await updateRecord(owner, id, (r) => {
      if (!r || r.pending?.saveId !== p.saveId) return null;
      const saved = 'document' in book ? absorb(r, book) : { ...r, baseRevision: book.revision, cloud: true, cloudSavedAt: book.updatedAt };
      return { ...saved, syncBase, pending: null, ackedVersion: Math.max(r.ackedVersion, p.version), lastError: null };
    });
    return 'saved';
  } catch (e) {
    if (e instanceof WriterDeletedError) return 'stale';
    const s = status(e);
    if (s === 409) {
      await updateRecord(owner, id, (r) => r?.pending?.saveId === p.saveId ? { ...r, conflict: { at: Date.now() }, lastError: 'Bu kitap başka bir cihazda değişti.' } : null);
      return 'conflict';
    }
    if (isOffline(e)) { await updateRecord(owner, id, (r) => r?.pending?.saveId === p.saveId ? { ...r, lastError: OFFLINE } : null); return 'offline'; }
    const msg = apiError(e, 'Buluta kaydedilemedi.');
    // A rejected payload will never succeed with the same id: drop it, keep the text dirty.
    const drop = s !== undefined && s >= 400 && s < 500;
    await updateRecord(owner, id, (r) => r?.pending?.saveId === p.saveId ? { ...r, pending: drop ? null : r.pending, lastError: msg } : null);
    return 'error';
  }
}

/** Remote can only replace a clean local record. */
export async function adoptRemote(owner: string, book: WriterBook): Promise<WriterRecord | null> {
  const syncBase = await fingerprintDocument(book.document, book.revision);
  return updateRecord(owner, book.id, (r) => {
    if (!r) {
      const fresh = newRecord(owner, book.id, book.localId, book.document);
      return { ...fresh, syncBase, version: 1, ackedVersion: 1, baseRevision: book.revision, cloud: true, publication: book.publication, publishedAt: book.publishedAt, cloudSavedAt: book.updatedAt, localSavedAt: Date.now() };
    }
    if (isDirty(r) || r.pending || r.conflict || book.revision <= r.baseRevision) return null;
    return { ...r, syncBase, doc: book.document, editStamp: newStamp(), baseRevision: book.revision, cloud: true, publication: book.publication, publishedAt: book.publishedAt, cloudSavedAt: book.updatedAt };
  });
}

export async function fetchRemote(owner: string, id: string) { return getWriterBook(id, actor(owner)); }

/**
 * Conflict: the remote is fetched first; then, under the source lock, the LATEST local record is
 * backed up in full as a new local book (marked conflict-copy) and only after that verified backup
 * is the source replaced by the cloud version. Callers must freeze + flush the editor first.
 */
export async function resolveConflict(owner: string, id: string): Promise<string> {
  const remote = await getWriterBook(id, actor(owner));
  const syncBase = await fingerprintDocument(remote.document, remote.revision);
  const copyId = randomUUID();
  await backupAndReplace(owner, id, copyId,
    (cur) => ({ ...newRecord(owner, copyId, randomUUID(), { ...cur.doc, chapters: cur.doc.chapters.map((c) => ({ ...c, id: randomUUID(), status: 'draft' as const })) },
      { kind: 'conflict-copy', from: id }), coverLocal: cur.coverLocal }),
    (r) => ({ ...r, syncBase, doc: remote.document, cloud: true, editStamp: newStamp(), version: r.version + 1, ackedVersion: r.version + 1, baseRevision: remote.revision,
      pending: null, conflict: null, lastError: null, publication: remote.publication, publishedAt: remote.publishedAt, cloudSavedAt: remote.updatedAt,
      // The local image file stays on disk and is referenced by the copy.
      coverLocal: null }));
  return copyId;
}

export async function publicationAction(owner: string, id: string, action: WriterPublicationInputAction, chapterId?: string) {
  const r = await readRecord(owner, id);
  if (!r) throw new Error('Kitap bulunamadı.');
  if (r.conflict) throw new Error('Önce sürüm çakışmasını çöz.');
  if (r.pending || isDirty(r)) throw new Error('Değişiklikler henüz buluta kaydedilmedi.');
  const book = await changeWriterPublication(id, { expectedRevision: r.baseRevision, action, ...(chapterId ? { chapterId } : {}) }, actor(owner));
  return updateRecord(owner, id, async (cur) => {
    if (!cur || cur.baseRevision !== r.baseRevision || cur.pending) return null;
    const next = absorb(cur, book);
    // Publication only changes statuses in the local text. Fingerprint the acknowledged
    // pre-request content with those statuses, never edits typed during the request.
    return { ...next, syncBase: await fingerprintDocument(absorb(r, book).doc, book.revision) };
  });
}

/**
 * Signed: the backend DELETE is always attempted (also for never-acked local books whose create may be
 * in flight; the backend records a tombstone so a late create returns 410). Only a confirmed delete
 * (or 404/410) removes local data. 409 or an uncertain network result throws and keeps everything.
 */
export async function deleteBook(owner: string, id: string) {
  if (owner !== 'guest') {
    const r = await readRecord(owner, id);
    let rev: number;
    if (r?.cloud) rev = r.baseRevision;
    else {
      try { rev = (await getWriterBook(id, actor(owner))).revision; }
      catch (e) { if (status(e) === 404) rev = 0; else throw e; }
    }
    try { await deleteWriterBook(id, { expectedRevision: rev }, actor(owner)); }
    catch (e) { const s = status(e); if (s !== 404 && s !== 410) throw e; }
  }
  await removeRecord(owner, id);
}
