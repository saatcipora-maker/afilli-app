import { pool } from '@workspace/db';
import { transaction, fail, type Transaction } from './community';
import { writerObject } from './bulletin-storage';
import { monitorWriterCleanup, type CleanupResult } from './writer-cleanup-health';

export const MEDIA_GRACE_DAYS = 30;
export const VOICE_RESULT_DAYS = 7;
export const MAX_CLEANUP_BATCH = 100;

// Never infer abandonment from elapsed time or a successful save. Offline
// devices can hold already-uploaded media for an unbounded period.
export async function setMediaReservation(owner: string, id: string, reservation: string, hold: boolean) {
  await transaction(async db => {
    const row = (await db.query<{ owner_id: string; deleting_at: Date | null }>(
      'SELECT owner_id,deleting_at FROM writer_uploads WHERE id=$1 FOR UPDATE', [id])).rows[0];
    if (!row || row.owner_id !== owner) return fail(404, 'Görsel bulunamadı.');
    if (row.deleting_at) return fail(410, 'Bu görsel temizlenmek üzere ayrılmış.');
    if (reservation === id) {
      await db.query(`UPDATE writer_uploads SET released_at=${hold ? 'NULL' : 'coalesce(released_at,now())'},
        orphaned_at=NULL WHERE id=$1`, [id]);
    } else {
      await db.query(`INSERT INTO writer_media_reservations(media_id,reservation_id,released_at)
        VALUES($1,$2,${hold ? 'NULL' : 'now()'}) ON CONFLICT(media_id,reservation_id) DO UPDATE
        SET released_at=${hold ? 'NULL' : 'coalesce(writer_media_reservations.released_at,excluded.released_at)'}`, [id, reservation]);
      // Release retries do not restart the clock, but cannot shorten it either.
      await db.query('UPDATE writer_uploads SET orphaned_at=NULL WHERE id=$1', [id]);
    }
  });
}

// Check both indexed references and the actual durable documents. An absent or
// stale reference row must never be sufficient evidence for deleting a book image.
// UUID substring matching deliberately errs on the side of retaining data.
const unused = `NOT EXISTS (SELECT 1 FROM writer_media_refs r WHERE r.media_id=m.id)
  AND NOT EXISTS (SELECT 1 FROM authored_books b WHERE
    position(m.id::text in coalesce(b.writer_data::text,''))>0 OR
    position(m.id::text in coalesce(b.published_data::text,''))>0 OR
    position(m.id::text in coalesce(b.cover,''))>0 OR
    position(m.id::text in coalesce(b.body,''))>0)`;
const released = `m.released_at IS NOT NULL AND NOT EXISTS
  (SELECT 1 FROM writer_media_reservations r WHERE r.media_id=m.id AND r.released_at IS NULL)`;
const eligible = `${released} AND ${unused}
  AND m.created_at < now()-interval '${MEDIA_GRACE_DAYS} days'
  AND m.released_at < now()-interval '15 minutes'`;
const expiredVoice = `text IS NOT NULL AND
  coalesce(result_expires_at,created_at+interval '${VOICE_RESULT_DAYS} days') <= now()`;

export type CleanupItem = { kind: 'media'; id: string; action: 'observe' | 'delete' }
  | { kind: 'voice'; id: string; action: 'expire' };
function bounded(limit: number) {
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_CLEANUP_BATCH) {
    throw new Error(`Temizlik sınırı 1–${MAX_CLEANUP_BATCH} arasında tam sayı olmalı.`);
  }
}
export async function previewWriterCleanup(limit = 25): Promise<CleanupItem[]> {
  bounded(limit);
  const db = await pool.connect();
  try {
    await db.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const media = (await db.query<{ id: string; action: 'observe' | 'delete' }>(`SELECT m.id,
      CASE WHEN m.deleting_at IS NOT NULL OR m.orphaned_at < now()-interval '${MEDIA_GRACE_DAYS} days'
        THEN 'delete' ELSE 'observe' END AS action
      FROM writer_uploads m WHERE m.deleting_at IS NOT NULL OR (${eligible}
        AND (m.orphaned_at IS NULL OR m.orphaned_at < now()-interval '${MEDIA_GRACE_DAYS} days'))
      ORDER BY m.deleting_at NULLS LAST,m.orphaned_at NULLS FIRST,m.created_at,m.id LIMIT $1`, [limit])).rows;
    const voice = (await db.query<{ id: string }>(`SELECT id FROM writer_voice_requests WHERE ${expiredVoice}
      ORDER BY created_at,id LIMIT $1`, [limit - media.length])).rows;
    await db.query('COMMIT');
    return [...media.map(row => ({ kind: 'media' as const, ...row })),
      ...voice.map(row => ({ kind: 'voice' as const, id: row.id, action: 'expire' as const }))];
  } catch (error) { await db.query('ROLLBACK'); throw error; }
  finally { db.release(); }
}

async function claimMedia(db: Transaction, id: string) {
  const row = (await db.query<{ deleting_at: Date | null }>(
    'SELECT deleting_at FROM writer_uploads WHERE id=$1 FOR UPDATE', [id])).rows[0];
  if (!row) return 'skipped' as const;
  // Durable deletion claim: failed object deletion/DB commit can safely retry;
  // no new reservation, save, completion or access may use a claimed upload.
  if (row.deleting_at) return 'delete' as const;
  const result = (await db.query<{ orphaned_at: Date | null; mature: boolean }>(`SELECT m.orphaned_at,
    m.orphaned_at < now()-interval '${MEDIA_GRACE_DAYS} days' AS mature
    FROM writer_uploads m WHERE m.id=$1 AND ${eligible}`, [id])).rows[0];
  if (!result) return 'skipped' as const;
  if (!result.orphaned_at) {
    await db.query('UPDATE writer_uploads SET orphaned_at=now() WHERE id=$1', [id]);
    return 'observed' as const;
  }
  if (!result.mature) return 'waiting' as const;
  await db.query('UPDATE writer_uploads SET deleting_at=now() WHERE id=$1', [id]);
  return 'delete' as const;
}
type DeleteObject = (path: string) => Promise<unknown>;
export async function applyWriterCleanup(limit = 25, deleteObject: DeleteObject = path =>
  writerObject(path).delete({ ignoreNotFound: true })) {
  bounded(limit);
  return monitorWriterCleanup(record => applyCleanupBatch(limit, deleteObject, record));
}

async function applyCleanupBatch(limit: number, deleteObject: DeleteObject, record: (result: CleanupResult) => void) {
  const preview = await previewWriterCleanup(limit);
  const results: (CleanupResult & { id: string; kind: string })[] = [];
  const add = (item: typeof results[number]) => { results.push(item); record(item); };
  for (const item of preview) {
    if (item.kind === 'voice') {
      const result = await pool.query(`UPDATE writer_voice_requests SET text=NULL,audio_hash=NULL,
        seconds=0,status='expired',result_expires_at=NULL WHERE id=$1 AND ${expiredVoice}`, [item.id]);
      add({ id: item.id, kind: item.kind, outcome: result.rowCount ? 'expired' : 'skipped' });
      continue;
    }
    const claimed = await transaction(db => claimMedia(db, item.id));
    if (claimed !== 'delete') {
      add({ id: item.id, kind: item.kind, outcome: claimed });
      continue;
    }
    try {
      // Signed PUT URLs last 15 minutes; eligibility waits longer than that.
      // Delete exact keys only, never prefixes or shared/public asset folders.
      await deleteObject(`${item.id}/source`);
      await deleteObject(`${item.id}/image`);
    } catch {
      add({ id: item.id, kind: item.kind, outcome: 'retry_required', retryReason: 'storage' });
      continue;
    }
    try {
      await pool.query('DELETE FROM writer_uploads WHERE id=$1 AND deleting_at IS NOT NULL', [item.id]);
      add({ id: item.id, kind: item.kind, outcome: 'deleted' });
    } catch {
      add({ id: item.id, kind: item.kind, outcome: 'retry_required', retryReason: 'database' });
    }
  }
  return results;
}
