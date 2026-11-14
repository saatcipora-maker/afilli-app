import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { pool } from '@workspace/db';
import { transaction } from '../src/lib/community.ts';
import { setMediaReservation, previewWriterCleanup, applyWriterCleanup } from '../src/lib/writer-retention.ts';
import { syncMediaRefs } from '../src/lib/writer-service.ts';
import { transcribeVoice } from '../src/lib/writer-voice.ts';
import { writerObject } from '../src/lib/bulletin-storage.ts';
import { getWriterCleanupHealth, monitorWriterCleanup } from '../src/lib/writer-cleanup-health.ts';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

// Real PostgreSQL locks/transactions; isolated tables, no customer data or paid calls.
const schema = `retention_test_${randomUUID().replaceAll('-', '')}`;
pool.options.options = `-c search_path=${schema}`;
const admin = await pool.connect();
await admin.query(`CREATE SCHEMA ${schema}`);
await admin.query(`SET search_path TO ${schema}`);
admin.release();
const owner = 'retention-owner', foreign = 'retention-other';
const deleted = [];
const remove = async path => { deleted.push(path); };
const ids = new Set();
async function image(fields = '') {
  const id = randomUUID(); ids.add(id);
  await pool.query(`INSERT INTO writer_uploads(id,owner_id,ready,created_at,released_at,orphaned_at)
    VALUES($1,$2,true,now()-interval '120 days',now()-interval '90 days',now()-interval '31 days')`, [id, owner]);
  if (fields) await pool.query(`UPDATE writer_uploads SET ${fields} WHERE id=$1`, [id]);
  return id;
}
const has = async id => !!(await pool.query('SELECT id FROM writer_uploads WHERE id=$1', [id])).rowCount;
const document = id => ({ cover: `/api/writer-media/${id}`, chapters: [] });
async function expectStatus(promise, status) {
  await assert.rejects(promise, error => error.status === status);
}
try {
  await pool.query(`CREATE TABLE writer_uploads (
    id uuid PRIMARY KEY, owner_id text NOT NULL, ready boolean NOT NULL DEFAULT false,
    created_at timestamptz NOT NULL DEFAULT now(), released_at timestamptz,
    orphaned_at timestamptz, deleting_at timestamptz);
    CREATE TABLE authored_books (
      id uuid PRIMARY KEY, writer_data jsonb, published_data jsonb, cover text, body text);
    CREATE TABLE writer_media_refs (
      media_id uuid REFERENCES writer_uploads(id) ON DELETE CASCADE,
      book_id uuid REFERENCES authored_books(id) ON DELETE CASCADE, version text,
      PRIMARY KEY(media_id,book_id,version));
    CREATE TABLE writer_media_reservations (
      media_id uuid REFERENCES writer_uploads(id) ON DELETE CASCADE,
      reservation_id uuid, released_at timestamptz, PRIMARY KEY(media_id,reservation_id));
    CREATE TABLE writer_voice_requests (
      id uuid PRIMARY KEY,owner_id text,audio_hash text,status text,text text,seconds int,
      created_at timestamptz DEFAULT now(),result_expires_at timestamptz);
    CREATE TABLE writer_voice_usage (user_id text,day date DEFAULT CURRENT_DATE,seconds int);
    CREATE TABLE writer_cleanup_health (
      id int PRIMARY KEY CHECK(id=1),started_at timestamptz NOT NULL,finished_at timestamptz,
      last_success_at timestamptz,outcome text NOT NULL,counts jsonb NOT NULL,
      storage_failure_runs int NOT NULL DEFAULT 0);`);
  assert.deepEqual((await getWriterCleanupHealth()).warnings, ['never_succeeded']);
  const legacy = await image('released_at=NULL,orphaned_at=NULL');
  const offline = await image(), device = randomUUID();
  await setMediaReservation(owner, offline, device, true);
  // Releasing the initial hold does not release another offline device.
  await setMediaReservation(owner, offline, offline, false);
  const draft = await image(), published = await image(), missingRef = await image(), legacyBody = await image();
  for (const [id, version] of [[draft, 'draft'], [published, 'published']]) {
    const book = randomUUID();
    await pool.query('INSERT INTO authored_books(id) VALUES($1)', [book]);
    await pool.query('INSERT INTO writer_media_refs VALUES($1,$2,$3)', [id, book, version]);
  }
  await pool.query('INSERT INTO authored_books(id,published_data) VALUES($1,$2)', [randomUUID(), document(missingRef)]);
  await pool.query('INSERT INTO authored_books(id,body) VALUES($1,$2)', [randomUUID(), `<img src="/api/writer-media/${legacyBody}">`]);
  const justReleased = await image("released_at=now(),orphaned_at=NULL");
  const observe = await image('orphaned_at=NULL'), eligible = await image();
  const pending = await image('ready=false,released_at=NULL');
  const recent = await image("created_at=now()-interval '1 day'");
  const snapshotBefore = (await pool.query('SELECT * FROM writer_uploads ORDER BY id')).rows;
  const preview = await previewWriterCleanup(100);
  assert.equal((await pool.query('SELECT count(*)::int AS n FROM writer_cleanup_health')).rows[0].n, 0);
  assert.deepEqual((await pool.query('SELECT * FROM writer_uploads ORDER BY id')).rows, snapshotBefore);
  assert.deepEqual(new Set(preview.map(row => row.id)), new Set([observe, eligible]));
  assert.equal(preview.find(row => row.id === observe).action, 'observe');
  assert.equal(deleted.length, 0);
  await assert.rejects(previewWriterCleanup(101));
  await assert.rejects(applyWriterCleanup(0, remove));
  await expectStatus(setMediaReservation(foreign, eligible, eligible, false), 404);
  const outcomes = await applyWriterCleanup(100, remove);
  assert.equal(outcomes.find(row => row.id === observe).outcome, 'observed');
  assert.equal(outcomes.find(row => row.id === eligible).outcome, 'deleted');
  assert.deepEqual(new Set(deleted), new Set([`${eligible}/source`, `${eligible}/image`]));
  for (const id of [legacy, offline, draft, published, missingRef, legacyBody, justReleased, observe, pending, recent]) assert.ok(await has(id));
  assert.ok(!(await previewWriterCleanup(100)).some(row => row.id === observe), 'Waiting media cannot starve later batches');
  console.log('PASS read-only preview, bounded batches, indefinite legacy/offline protection, draft/published/raw-document references, grace period and private ownership');

  // Reservation is a row-lock barrier, not a timing-dependent preview promise.
  const racing = await image();
  const lock = await pool.connect();
  await lock.query('BEGIN');
  await lock.query('SELECT id FROM writer_uploads WHERE id=$1 FOR UPDATE', [racing]);
  const apply = applyWriterCleanup(100, remove);
  await lock.query('UPDATE writer_uploads SET released_at=NULL,orphaned_at=NULL WHERE id=$1', [racing]);
  await lock.query('COMMIT'); lock.release();
  await apply;
  assert.ok(await has(racing));
  assert.ok(!deleted.some(path => path.startsWith(racing)));
  const saved = await image(), savedBook = randomUUID();
  await pool.query('INSERT INTO authored_books(id) VALUES($1)', [savedBook]);
  await transaction(db => syncMediaRefs(db, savedBook, owner, 'draft', document(saved)));
  await applyWriterCleanup(100, remove);
  assert.ok(await has(saved));
  assert.equal((await pool.query('SELECT orphaned_at FROM writer_uploads WHERE id=$1', [saved])).rows[0].orphaned_at, null);

  const failed = await image();
  let attempted = 0;
  const firstTry = await applyWriterCleanup(100, async path => {
    attempted++; if (path.endsWith('/image')) throw new Error('storage_unavailable');
  });
  assert.equal(firstTry.find(row => row.id === failed).outcome, 'retry_required');
  assert.equal(attempted, 2);
  assert.ok((await pool.query('SELECT deleting_at FROM writer_uploads WHERE id=$1', [failed])).rows[0].deleting_at);
  await expectStatus(setMediaReservation(owner, failed, randomUUID(), true), 410);
  await expectStatus(transaction(db => syncMediaRefs(db, savedBook, owner, 'draft', document(failed))), 403);
  for (let i = 0; i < 2; i++) await applyWriterCleanup(100, async () => {
    throw new Error('PRIVATE_TRANSCRIPT owner-private https://private.example/signed?token=private');
  });
  let health = await getWriterCleanupHealth();
  assert.equal(health.consecutiveStorageFailureRuns, 3);
  assert.ok(health.warnings.includes('persistent_storage_failure'));
  assert.equal(health.counts.retry_required, 1);
  assert.equal(health.counts.storage_retry_required, 1);
  assert.equal(health.counts.deleted, 0);
  const lastSuccess = health.lastSuccessAt;
  const runCLI = async args => {
    try {
      const result = await promisify(execFile)(process.execPath, ['--import', 'tsx', 'tools/writer-cleanup.ts', ...args], {
        cwd: process.cwd(), env: { ...process.env, PGOPTIONS: `-c search_path=${schema}` },
      });
      return { ...result, code: 0 };
    } catch (error) {
      if (typeof error.code !== 'number') throw error;
      return { stdout: error.stdout, stderr: error.stderr, code: error.code };
    }
  };
  const cliStatus = await runCLI(['--status']);
  assert.equal(cliStatus.code, 2);
  assert.ok(JSON.parse(cliStatus.stdout).health.warnings.includes('persistent_storage_failure'));
  for (const value of [failed, owner, 'PRIVATE_TRANSCRIPT', 'owner-private', 'private.example']) {
    assert.ok(!`${cliStatus.stdout}${cliStatus.stderr}`.includes(value));
  }
  // A preview must not reset the last applied result, success time or retry streak.
  const cliPreview = await runCLI(['--limit=100']);
  assert.equal(cliPreview.code, 2);
  assert.deepEqual(await getWriterCleanupHealth(), health);
  assert.equal(JSON.parse(cliPreview.stdout).preview.delete, 1);
  for (const args of [['--status', '--apply'], ['--limit=101'], ['--apply', '--limit=0'], ['--unknown']]) {
    assert.equal((await runCLI(args)).code, 1);
    assert.deepEqual(await getWriterCleanupHealth(), health);
  }
  // Concurrent apply must not overwrite the active run's status.
  await monitorWriterCleanup(async () => {
    await assert.rejects(applyWriterCleanup(100, remove));
    assert.equal((await getWriterCleanupHealth()).outcome, 'running');
  });
  await applyWriterCleanup(100, remove);
  health = await getWriterCleanupHealth();
  assert.equal(health.outcome, 'succeeded');
  assert.equal(health.counts.deleted, 1);
  assert.equal(health.consecutiveStorageFailureRuns, 0);
  assert.deepEqual(health.warnings, []);
  assert.ok(health.lastSuccessAt >= lastSuccess);
  await pool.query("UPDATE writer_cleanup_health SET last_success_at=now()-interval '49 hours'");
  assert.ok((await getWriterCleanupHealth()).warnings.includes('cleanup_overdue'));
  assert.equal((await runCLI(['--status'])).code, 2);
  console.log('PASS durable aggregate health, repeated storage alerts, read-only status/preview, overdue warnings, concurrency and recovery');
  assert.equal(await has(failed), false);
  // Active holds can be released independently, with a fresh orphan observation.
  await setMediaReservation(owner, offline, device, false);
  assert.equal((await pool.query('SELECT orphaned_at FROM writer_uploads WHERE id=$1', [offline])).rows[0].orphaned_at, null);
  console.log('PASS reservation/save lock barriers, durable deletion claims, partial storage failure retry and independent offline-device release');

  const audio = Buffer.from('no decoding or paid provider call may happen');
  const hash = createHash('sha256').update(audio).digest('hex');
  const voice = randomUUID(), uncertain = randomUUID(), fresh = randomUUID(), lateCompletion = randomUUID();
  await pool.query(`INSERT INTO writer_voice_requests(id,owner_id,audio_hash,status,text,seconds,created_at,result_expires_at)
    VALUES($1,$2,$3,'completed','eski özel metin',30,now()-interval '8 days',NULL),
    ($4,$2,$3,'uncertain',NULL,30,now()-interval '90 days',NULL),
    ($5,$2,$3,'completed','yeni özel metin',30,now(),now()+interval '7 days'),
    ($6,$2,$3,'completed','geç tamamlanan',30,now()-interval '8 days',now()+interval '6 days')`,
  [voice, owner, hash, uncertain, fresh, lateCompletion]);
  await expectStatus(transcribeVoice(foreign, voice, audio), 404);
  await expectStatus(transcribeVoice(owner, voice, audio), 410);
  assert.equal(await transcribeVoice(owner, fresh, audio), 'yeni özel metin');
  assert.equal(await transcribeVoice(owner, lateCompletion, audio), 'geç tamamlanan');
  const voicePreview = await previewWriterCleanup(100);
  assert.ok(voicePreview.some(row => row.id === voice && row.action === 'expire'));
  assert.equal((await pool.query('SELECT text FROM writer_voice_requests WHERE id=$1', [voice])).rows[0].text, 'eski özel metin');
  await applyWriterCleanup(100, remove);
  const trace = (await pool.query('SELECT * FROM writer_voice_requests WHERE id=$1', [voice])).rows[0];
  health = await getWriterCleanupHealth();
  assert.equal(health.counts.expired, 1);
  assert.equal(trace.text, null); assert.equal(trace.audio_hash, null); assert.equal(trace.seconds, 0);
  assert.equal(trace.status, 'expired'); assert.equal(trace.owner_id, owner);
  await expectStatus(transcribeVoice(owner, voice, audio), 410);
  await expectStatus(transcribeVoice(owner, voice, Buffer.from('different audio')), 410);
  await expectStatus(transcribeVoice(foreign, voice, audio), 404);
  await expectStatus(transcribeVoice(owner, uncertain, audio), 409);
  assert.equal((await pool.query('SELECT count(*)::int AS n FROM writer_voice_usage')).rows[0].n, 0);
  assert.ok(!(await previewWriterCleanup(100)).some(row => row.id === voice));
  console.log('PASS voice TTL before/after physical erasure, minimal permanent tombstones, cross-owner privacy and zero paid retries/usage');

  // Each apply handles at most the shared limit, not N per media/voice type.
  await image(); await image(); await image();
  assert.equal((await applyWriterCleanup(2, remove)).length, 2);
  console.log('PASS shared maximum batch size');
  await applyWriterCleanup(100, remove);
  // Raw DB errors must not reach CLI output or the aggregate telemetry row.
  await pool.query(`CREATE FUNCTION reject_cleanup() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN RAISE EXCEPTION 'PRIVATE_TRANSCRIPT owner-private https://private.example/signed?token=private'; END $$;
    CREATE TRIGGER reject_cleanup BEFORE UPDATE ON writer_voice_requests
    FOR EACH ROW EXECUTE FUNCTION reject_cleanup();`);
  await pool.query(`INSERT INTO writer_voice_requests(id,owner_id,status,text,seconds,created_at)
    VALUES($1,$2,'completed','PRIVATE_TRANSCRIPT',1,now()-interval '8 days')`, [randomUUID(), owner]);
  const dbFailure = await runCLI(['--apply']);
  assert.equal(dbFailure.code, 1);
  for (const value of ['PRIVATE_TRANSCRIPT', 'owner-private', 'private.example', owner]) {
    assert.ok(!`${dbFailure.stdout}${dbFailure.stderr}`.includes(value));
    assert.ok(!JSON.stringify((await pool.query('SELECT * FROM writer_cleanup_health')).rows).includes(value));
  }
  assert.ok((await getWriterCleanupHealth()).warnings.includes('last_run_failed'));
  await pool.query('DROP TRIGGER reject_cleanup ON writer_voice_requests; DROP FUNCTION reject_cleanup()');
  await applyWriterCleanup(100, remove);
  assert.equal((await runCLI(['--status'])).code, 0);
  await pool.query("UPDATE writer_cleanup_health SET outcome='running',started_at=now()-interval '2 hours'");
  assert.ok((await getWriterCleanupHealth()).warnings.includes('run_incomplete'));
  await applyWriterCleanup(100, remove);
  console.log('PASS private DB error suppression, persisted failure status, incomplete-run alert and healthy CLI status');
  if (process.argv.includes('--storage')) {
    const real = await image();
    try {
      for (const suffix of ['source', 'image']) await writerObject(`${real}/${suffix}`).save(
        Buffer.from('retention test fixture'), { resumable: false, contentType: 'application/octet-stream' });
      const result = await applyWriterCleanup(100);
      assert.equal(result.find(row => row.id === real).outcome, 'deleted');
      for (const suffix of ['source', 'image']) assert.equal((await writerObject(`${real}/${suffix}`).exists())[0], false);
      assert.equal(await has(real), false);
      console.log('PASS real App Storage exact-key deletion of isolated test objects');
    } finally {
      for (const suffix of ['source', 'image']) await writerObject(`${real}/${suffix}`).delete({ ignoreNotFound: true });
    }
  }
} finally {
  await pool.query(`DROP SCHEMA ${schema} CASCADE`);
  await pool.end();
}
