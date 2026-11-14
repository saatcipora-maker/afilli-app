import { pool } from '@workspace/db';

export const CLEANUP_STALE_HOURS = 48;
export const STORAGE_FAILURE_RUNS = 3;
const LOCK_KEY = 17423005;
const countKeys = ['processed', 'observed', 'deleted', 'expired', 'skipped', 'waiting',
  'retry_required', 'storage_retry_required'] as const;
type Counts = Record<typeof countKeys[number], number>;
export type CleanupResult = {
  outcome: 'observed' | 'deleted' | 'expired' | 'skipped' | 'waiting' | 'retry_required';
  retryReason?: 'storage' | 'database';
};
export const emptyCleanupCounts = (): Counts => ({
  processed: 0, observed: 0, deleted: 0, expired: 0, skipped: 0,
  waiting: 0, retry_required: 0, storage_retry_required: 0,
});

// Explicit projection even at the DB boundary; do not serialize arbitrary JSON.
function safeCounts(value: unknown): Counts {
  const counts = emptyCleanupCounts();
  for (const key of countKeys) {
    const n = (value as Partial<Counts> | null)?.[key];
    if (!Number.isSafeInteger(n) || Number(n) < 0) throw new Error('Invalid cleanup counters');
    counts[key] = Number(n);
  }
  return counts;
}

export async function getWriterCleanupHealth(now = new Date()) {
  const row = (await pool.query(`SELECT started_at,finished_at,last_success_at,
    outcome,counts,storage_failure_runs FROM writer_cleanup_health WHERE id=1`)).rows[0];
  const warnings: string[] = [];
  const date = (value: unknown) => value ? new Date(String(value)).toISOString() : null;
  const lastSuccessAt = date(row?.last_success_at);
  if (!lastSuccessAt) warnings.push('never_succeeded');
  else if (now.getTime() - Date.parse(lastSuccessAt) >= CLEANUP_STALE_HOURS * 3600000) warnings.push('cleanup_overdue');
  const allowed = ['running', 'succeeded', 'retry_required', 'failed'] as const;
  const outcome = row ? allowed.find(v => v === row.outcome) : null;
  if (row && !outcome) throw new Error('Invalid cleanup outcome');
  if (outcome === 'retry_required') warnings.push('retry_required');
  if (outcome === 'failed') warnings.push('last_run_failed');
  if (outcome === 'running' && now.getTime() - new Date(row.started_at).getTime() >= 3600000) {
    warnings.push('run_incomplete');
  }
  const storageFailureRuns = row ? Number(row.storage_failure_runs) : 0;
  if (!Number.isSafeInteger(storageFailureRuns) || storageFailureRuns < 0) throw new Error('Invalid cleanup counter');
  if (storageFailureRuns >= STORAGE_FAILURE_RUNS) warnings.push('persistent_storage_failure');
  return {
    lastSuccessAt, lastStartedAt: date(row?.started_at), lastFinishedAt: date(row?.finished_at),
    outcome, counts: row ? safeCounts(row.counts) : emptyCleanupCounts(),
    consecutiveStorageFailureRuns: storageFailureRuns,
    thresholds: { staleHours: CLEANUP_STALE_HOURS, storageFailureRuns: STORAGE_FAILURE_RUNS },
    warnings,
  };
}

export async function monitorWriterCleanup<T>(
  work: (record: (result: CleanupResult) => void) => Promise<T>,
): Promise<T> {
  const db = await pool.connect();
  let locked = false;
  const counts = emptyCleanupCounts();
  const record = (result: CleanupResult) => {
    counts.processed++;
    counts[result.outcome]++;
    if (result.retryReason === 'storage') counts.storage_retry_required++;
  };
  const finish = async (outcome: string) => {
    await db.query(`UPDATE writer_cleanup_health SET finished_at=now(),outcome=$1,counts=$2,
      last_success_at=CASE WHEN $1='succeeded' THEN now() ELSE last_success_at END,
      storage_failure_runs=CASE WHEN $3 THEN storage_failure_runs+1
        WHEN $1='succeeded' THEN 0 ELSE storage_failure_runs END WHERE id=1`,
    [outcome, JSON.stringify(counts), counts.storage_retry_required > 0]);
  };
  try {
    // Prevent concurrent runs from replacing each other's aggregate status.
    locked = (await db.query('SELECT pg_try_advisory_lock($1) AS locked', [LOCK_KEY])).rows[0].locked;
    if (!locked) throw new Error('Cleanup already running');
    // Fail closed before touching retained data if monitoring cannot be persisted.
    await db.query(`INSERT INTO writer_cleanup_health(id,started_at,outcome,counts)
      VALUES(1,now(),'running',$1) ON CONFLICT(id) DO UPDATE
      SET started_at=now(),finished_at=NULL,outcome='running',counts=excluded.counts`,
    [JSON.stringify(counts)]);
    let result: T;
    try { result = await work(record); }
    catch (error) {
      await finish('failed');
      throw error;
    }
    await finish(counts.retry_required ? 'retry_required' : 'succeeded');
    return result;
  } finally {
    // On an interrupted connection the server releases its session lock. A
    // persisted "running" state remains visible, never counted as success.
    if (locked) {
      try { await db.query('SELECT pg_advisory_unlock($1)', [LOCK_KEY]); }
      catch { db.release(true); throw new Error('Cleanup monitoring unavailable'); }
    }
    db.release();
  }
}
