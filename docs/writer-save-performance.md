# Long-book save measurements

## Method

Measured on the same development PostgreSQL instance on 2026-11-14, immediately
before and after the optimization. No production/customer records were used.

`artifacts/api-server/tests/writer-performance.mjs` calls the real `patchWriter`
service against isolated **logged** tables copied from the current schema.
The schema, fixtures and all writes roll back at the end, including on error.
The benchmark uses 100 and 200 chapters, each with 40,000 characters of seeded,
varied alphanumeric text. This avoids unrealistic compression from repeating one
character. Each case changes chapter 50, keeps its length roughly constant, runs
eight saves, discards the first, and reports the median of seven.

- **Service time:** wall time from entering `patchWriter` to receiving its result;
  excludes fixture setup, HTTP, authentication and the post-save assertion.
- **SQL parameters:** UTF-8 bytes of the serialized parameters sent to the
  `authored_books` UPDATE, not client-to-API request bytes.
- **WAL:** actual PostgreSQL `EXPLAIN (ANALYZE, BUFFERS, WAL, FORMAT JSON)` root-plan
  `WAL Bytes` for that UPDATE, including its TOAST work. EXPLAIN executes the
  statement once; the harness substitutes the revision acknowledgement and
  separately verifies the actual persisted revision outside the timer.
- **Media scan:** average of 30 pure extraction calls on the same fixture. The
  incremental case scans the changed chapter before/after, not all chapter HTML.

Absolute latency depends on database/network load and EXPLAIN overhead; these
are comparative development measurements, not production latency guarantees.

## Results

Decimal MB; each row compares the same chapter count and publication state.

| Chapters | State | Service ms before → after | SQL parameter MB before → after | WAL MB before → after |
| --- | --- | ---: | ---: | ---: |
| 100 | Private draft | 436.800 → 181.169 | 8.011 → 0.040 | 8.764 → 4.388 |
| 100 | Published | 726.523 → 214.968 | 12.022 → 0.040 | 13.153 → 4.389 |
| 200 | Private draft | 894.329 → 354.335 | 16.022 → 0.040 | 17.529 → 8.777 |
| 200 | Published | 1717.960 → 416.137 | 24.044 → 0.040 | 26.306 → 8.777 |

For 200 chapters: service time fell **60.4%** for drafts and **75.8%** for
published books; measured WAL fell **49.9%** and **66.6%** respectively.
SQL parameter bytes fell **99.75%** and **99.83%** respectively.

| Chapters | Full media scan ms | Incremental scan ms | Untouched chapter HTML inspected |
| --- | ---: | ---: | --- |
| 100 | 1.708 | 0.041 | No |
| 200 | 3.562 | 0.046 | No |

The media benchmark isolates the scan rather than claiming it is the dominant
save cost. Upload authorization queries/locks are still required when changed
chapters or the cover reference images. Removing an image deliberately falls
back to scanning remaining chapters before removing a possibly shared reference.

## Changes and invariants

- Ordinary saves omit `published_data`, publication state, release timestamp and
  public display fields from UPDATE for published books.
- On first migration of a legacy public book, its original release and media
  references are still frozen before adopting the new private document.
- Draft body is no longer duplicated into legacy `body`. Draft readers already
  derive body from `writer_data`; publishing still builds the release projection.
  Small draft card fields are updated only when changed.
- Nonstructural deltas of up to eight chapters use bounded `jsonb_set` expressions
  plus normalized metadata when supplied. Structural/reordered/bulk saves and old
  PUT clients use the full-draft replacement path.
- The normalized in-memory draft plus UPDATE RETURNING replaces the second full
  row read, avoiding another transfer/parse of private and public documents.
- Incremental media updates validate/lock changed uploads, insert refs
  idempotently, retain shared references, and remove only the last private use.
  Published refs and offline reservations are not released by draft edits.
- Existing book advisory lock, row lock, revision check, deletion tombstone,
  normalized full-save identity and raw delta identity remain unchanged.

## Chapter storage decision

No schema migration or separate chapter table is needed to meet this task's
measured success criteria: both draft and published 100–200-chapter saves now
have substantially lower service time and real WAL volume.

This is **not** an O(changed-chapter) physical storage implementation.
PostgreSQL `jsonb_set` still rewrites the entire private JSONB TOAST value, and
the initial locked read still loads the book. At 200 chapters this remains about
8.8 MB WAL per text save in this workload. A no-change/metadata-only patch avoids
sending chapter HTML; structural and bulk edits deliberately remain full-draft
operations.

If further physical-write reduction is needed, use a separate private chapter
table keyed by `(book_id, chapter_id)` with chapter HTML and per-chapter media
references; keep metadata/order, save identity and the **shared revision lock**
on the book. All PUT, PATCH and publication operations must acquire that same
lock, and any lazy legacy backfill must be in that transaction. Assemble owner
documents for existing clients and create explicit immutable release snapshots
only on publication. Do not introduce dual independent revision counters or
replace the release snapshot with live chapter joins. Such a change also needs
a publish-compatible schema rollout and retention/raw-document fallback review;
adding that migration without a demonstrated need would increase this task's
compatibility and media-retention risk.

## Reproduce and regressions

From the repository root:

```sh
pnpm exec tsc -b lib/api-zod lib/db lib/integrations-openai-ai-server
pnpm --filter @workspace/api-server run typecheck
pnpm --filter @workspace/api-server run bench:writer
pnpm --filter @workspace/api-server run test:writer-storage
pnpm --filter @workspace/api-server run test:writer
pnpm --filter @workspace/api-server run test:writer-delta
pnpm --filter @workspace/api-server run test:writer-local
pnpm --filter @workspace/api-server run test:writer-retention
```

The before numbers were captured with the same benchmark against the pre-change
service. To retain a fresh run's raw JSON, invoke the benchmark directly with
`--out=../../generated-artifacts/writer-performance-after.json` (relative to the
API package). Generated output is excluded from Git and deployment.

The storage suite verifies actual SQL/media state, unchanged publication,
legacy full/delta migration, private reader freshness, media ownership/readiness
and deletion gates, shared/last/cover references, exact retry without writes,
revision conflicts, full PUT compatibility, reordering, bulk saves and no
untouched HTML reads in the normal media scan.

The existing HTTP writer/delta suites passed against the restarted API,
including concurrent revision conflicts, sanitization, immutable reader/feed
snapshots, old-client compatibility and deletion without resurrection. Local
writer and retention suites passed as well. No frontend or authentication flow
was changed; HTTP and direct PostgreSQL tests cover the changed paths without
requiring a browser sign-in.
