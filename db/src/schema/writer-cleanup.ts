import { sql } from 'drizzle-orm';
import { pgTable, integer, timestamp, text, jsonb, check } from 'drizzle-orm/pg-core';

// One aggregate row only: never store record IDs, owners, paths or errors.
export const writerCleanupHealth = pgTable('writer_cleanup_health', {
  id: integer('id').primaryKey().default(1),
  startedAt: timestamp('started_at', { withTimezone: true }).notNull(),
  finishedAt: timestamp('finished_at', { withTimezone: true }),
  lastSuccessAt: timestamp('last_success_at', { withTimezone: true }),
  outcome: text('outcome').notNull(),
  counts: jsonb('counts').notNull(),
  storageFailureRuns: integer('storage_failure_runs').notNull().default(0),
}, t => [check('writer_cleanup_singleton', sql`${t.id}=1`)]);
