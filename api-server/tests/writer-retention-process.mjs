import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { fork } from 'node:child_process';
import { once } from 'node:events';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { pool } from '@workspace/db';

// Real PostgreSQL and real unlink; no application tables, user files, cloud
// storage, authentication accounts, transcription or paid providers are used.
const schema = `retention_process_test_${randomUUID().replaceAll('-', '')}`;
const guardSchema = `${schema}_guard`;
pool.options.options = `-c search_path=${schema}`;
pool.options.application_name = schema;
const workspace = fileURLToPath(new URL('../../../', import.meta.url));
await mkdir(join(workspace, 'generated-artifacts'), { recursive: true });
const root = await mkdtemp(join(workspace, 'generated-artifacts/retention-process-'));
const owner = 'process-test-owner';
const workers = [];
const locks = new Set();
let sequence = 0;
const timeout = 20_000;

function startWorker(label) {
  // PostgreSQL truncates application_name to 63 bytes; keep lock probes exact.
  const name = `rtp_${schema.slice(-32)}_${label}`;
  const child = fork(fileURLToPath(new URL('./helpers/writer-retention-worker.mjs', import.meta.url)),
    [JSON.stringify({ schema, root, name })], {
      execArgv: ['--import', 'tsx'],
      env: { ...process.env, PGOPTIONS: `-c search_path=${schema}` },
      stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    });
  const messages = [], waiters = new Set();
  let diagnostic = '', exited = false;
  child.stdout.on('data', data => { diagnostic += data; });
  child.stderr.on('data', data => { diagnostic += data; });
  child.on('message', message => {
    messages.push(message);
    for (const waiter of waiters) if (waiter.match(message)) waiter.finish(null, message);
  });
  child.on('error', error => {
    for (const waiter of waiters) waiter.finish(error);
  });
  const exit = once(child, 'exit').then(([code, signal]) => {
    exited = true;
    for (const waiter of waiters) waiter.finish(new Error(`Worker ${label} exited (${code}/${signal}): ${diagnostic}`));
    return { code, signal };
  });
  // Attach a rejection handler immediately, even if startup itself fails.
  exit.catch(() => {});
  function wait(match) {
    const found = messages.find(match);
    if (found) return Promise.resolve(found);
    if (exited) return Promise.reject(new Error(`Worker ${label} already exited: ${diagnostic}`));
    return new Promise((res, rej) => {
      const waiter = {
        match,
        finish(error, message) {
          clearTimeout(timer); waiters.delete(waiter);
          if (error) rej(error); else res(message);
        },
      };
      const timer = setTimeout(() => waiter.finish(new Error(`Worker ${label} timed out: ${diagnostic}`)), timeout);
      waiters.add(waiter);
    });
  }
  const worker = {
    name, child, exit, ready: wait(m => m.type === 'ready'),
    request(command, args = {}) {
      const id = ++sequence;
      const result = wait(m => m.id === id && m.type === 'result');
      result.catch(() => {}); // A deliberately killed request has no result.
      child.send({ id, command, args });
      return { id, result, event: type => wait(m => m.id === id && m.type === type) };
    },
  };
  workers.push(worker);
  return worker;
}
async function ok(request) {
  const result = await request.result;
  assert.equal(result.ok, true, JSON.stringify(result));
  return result.value;
}
async function rejected(request, status) {
  const result = await request.result;
  assert.equal(result.ok, false, JSON.stringify(result));
  assert.equal(result.status, status, JSON.stringify(result));
}
async function eventually(check, description) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await check()) return;
    await delay(20);
  }
  assert.fail(`Timed out waiting for ${description}`);
}
async function waitingOn(worker, blocker) {
  // A later FOR UPDATE can wait on the first waiter's tuple lock rather than
  // directly on the barrier transaction. Follow the real wait chain.
  await eventually(async () => (await pool.query(`WITH RECURSIVE blockers(pid) AS (
    SELECT unnest(pg_blocking_pids(pid)) FROM pg_stat_activity WHERE application_name=$1
    UNION SELECT unnest(pg_blocking_pids(pid)) FROM blockers)
    SELECT 1 FROM blockers WHERE pid=$2`, [worker.name, blocker])).rowCount > 0,
  `${worker.name} to wait on PostgreSQL row lock ${blocker}`);
}
async function lockImage(id) {
  const client = await pool.connect();
  locks.add(client);
  await client.query('BEGIN');
  const pid = (await client.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
  await client.query('SELECT id FROM writer_uploads WHERE id=$1 FOR UPDATE', [id]);
  return {
    pid,
    async release() { await client.query('COMMIT'); client.release(); locks.delete(client); },
  };
}
const has = async id => (await pool.query('SELECT * FROM writer_uploads WHERE id=$1', [id])).rows[0];
async function snapshot(directory = root, prefix = '') {
  const result = {};
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const key = `${prefix}${entry.name}`;
    if (entry.isDirectory()) Object.assign(result, await snapshot(join(directory, entry.name), `${key}/`));
    else if (key !== 'attempts.jsonl') result[key] = (await readFile(join(directory, entry.name))).toString('base64');
  }
  return result;
}
async function fixtureFile(key) {
  const path = join(root, key);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `isolated retention fixture: ${key}`);
}

try {
  await pool.query(`CREATE SCHEMA ${schema}; CREATE SCHEMA ${guardSchema}`);
  assert.equal((await pool.query('SELECT current_schema() AS name')).rows[0].name, schema);
  await pool.query(`
    CREATE TABLE writer_uploads (
      id uuid PRIMARY KEY,owner_id text NOT NULL,ready boolean NOT NULL DEFAULT true,
      created_at timestamptz NOT NULL DEFAULT now()-interval '120 days',
      released_at timestamptz DEFAULT now()-interval '90 days',
      orphaned_at timestamptz DEFAULT now()-interval '31 days',deleting_at timestamptz);
    CREATE TABLE authored_books (
      id uuid PRIMARY KEY,author_id text,local_id text,title text,body text,cover text,genre text,
      created_at timestamptz,writer_data jsonb,published_data jsonb,
      writer_revision int NOT NULL DEFAULT 0,publication text NOT NULL DEFAULT 'draft',
      published_at timestamptz,writer_updated_at timestamptz,last_save_id uuid,last_save_hash text);
    CREATE TABLE bulletins (book_id uuid);
    CREATE TABLE writer_book_deletions (book_id uuid PRIMARY KEY,owner_id text);
    CREATE TABLE writer_media_refs (
      media_id uuid REFERENCES writer_uploads(id) ON DELETE CASCADE,
      book_id uuid REFERENCES authored_books(id) ON DELETE CASCADE,version text,
      PRIMARY KEY(media_id,book_id,version));
    CREATE TABLE writer_media_reservations (
      media_id uuid REFERENCES writer_uploads(id) ON DELETE CASCADE,
      reservation_id uuid,released_at timestamptz,PRIMARY KEY(media_id,reservation_id));
    CREATE TABLE writer_voice_requests (
      id uuid PRIMARY KEY,text text,audio_hash text,seconds int,status text,
      created_at timestamptz,result_expires_at timestamptz);
    CREATE TABLE writer_cleanup_health (
      id int PRIMARY KEY CHECK(id=1),started_at timestamptz NOT NULL,finished_at timestamptz,
      last_success_at timestamptz,outcome text NOT NULL,counts jsonb NOT NULL,
      storage_failure_runs int NOT NULL DEFAULT 0);
    CREATE TABLE ${guardSchema}.writer_uploads (LIKE writer_uploads INCLUDING ALL);`);

  // Only activate the next eligible fixture after the previous race finishes.
  const saved = randomUUID(), reserved = randomUUID(), crashed = randomUUID(), untouched = randomUUID();
  const ids = [saved, reserved, crashed, untouched];
  await writeFile(join(root, 'manifest.json'), JSON.stringify({ schema, owner, ids }));
  for (const id of ids) {
    for (const suffix of ['source', 'image', 'thumbnail', 'source.backup']) await fixtureFile(`${id}/${suffix}`);
  }
  await fixtureFile(`public/${randomUUID()}/image`);
  await fixtureFile(`other-owner/${randomUUID()}/source`);
  await pool.query('INSERT INTO writer_uploads(id,owner_id,released_at) VALUES($1,$2,NULL)', [untouched, 'another-test-owner']);
  await pool.query(`INSERT INTO ${guardSchema}.writer_uploads(id,owner_id) VALUES($1,$2)`, [crashed, owner]);
  const guardBefore = (await pool.query(`SELECT * FROM ${guardSchema}.writer_uploads`)).rows;
  const before = await snapshot();
  const a = startWorker('operator_a'), b = startWorker('operator_b');
  await Promise.all([a.ready, b.ready]);
  assert.notEqual(a.child.pid, b.child.pid);

  // Save/reservation wins: queue the real writer operation first, then prove
  // cleanup is blocked on the same row before releasing the barrier.
  for (const [command, media] of [['save', saved], ['reserve', reserved]]) {
    await pool.query('INSERT INTO writer_uploads(id,owner_id) VALUES($1,$2)', [media, owner]);
    const barrier = await lockImage(media);
    const book = randomUUID(), reservation = randomUUID();
    const protect = b.request(command, { media, book, saveId: randomUUID(), reservation });
    await waitingOn(b, barrier.pid);
    const cleanup = a.request('cleanup');
    await waitingOn(a, barrier.pid);
    await barrier.release();
    await ok(protect);
    const outcomes = await ok(cleanup);
    assert.equal(outcomes.find(row => row.id === media)?.outcome, 'skipped');
    assert.equal((await has(media)).deleting_at, null);
    if (command === 'save') {
      const row = (await pool.query('SELECT writer_data,writer_revision FROM authored_books WHERE id=$1', [book])).rows[0];
      assert.equal(row.writer_data.cover, `/api/writer-media/${media}`);
      assert.equal(row.writer_revision, 1);
      assert.equal((await pool.query('SELECT 1 FROM writer_media_refs WHERE media_id=$1 AND book_id=$2', [media, book])).rowCount, 1);
    } else {
      assert.equal((await pool.query('SELECT released_at FROM writer_media_reservations WHERE media_id=$1 AND reservation_id=$2',
        [media, reservation])).rows[0].released_at, null);
    }
  }
  assert.deepEqual(await snapshot(), before);
  console.log('PASS separate-process save/reservation wins against cleanup, verified PostgreSQL lock barriers and intact files');

  await pool.query('INSERT INTO writer_uploads(id,owner_id) VALUES($1,$2)', [crashed, owner]);
  const interrupted = a.request('cleanup', { pauseAfterSource: `${crashed}/source` });
  assert.equal((await interrupted.event('source-deleted')).existed, true);
  const claim = await has(crashed);
  assert.ok(claim.deleting_at, 'Claim must commit before the first physical unlink');
  await assert.rejects(readFile(join(root, crashed, 'source')), { code: 'ENOENT' });
  await readFile(join(root, crashed, 'image'));
  const running = (await pool.query('SELECT * FROM writer_cleanup_health')).rows;
  assert.equal(running[0].outcome, 'running');
  // The second independent operator must not delete anything or overwrite health.
  const competing = await b.request('cleanup').result;
  assert.equal(competing.ok, false);
  assert.equal(competing.error, 'Cleanup already running');
  assert.deepEqual((await pool.query('SELECT * FROM writer_cleanup_health')).rows, running);
  const attempts = await readFile(join(root, 'attempts.jsonl'), 'utf8');
  assert.equal(attempts.trim().split('\n').length, 1);
  const failedBook = randomUUID();
  const attemptReuse = async worker => {
    await Promise.all([
      rejected(worker.request('reserve', { media: crashed, reservation: randomUUID() }), 410),
      rejected(worker.request('save', { media: crashed, book: failedBook, saveId: randomUUID() }), 403),
    ]);
    assert.equal((await pool.query('SELECT 1 FROM authored_books WHERE id=$1', [failedBook])).rowCount, 0);
    assert.equal((await pool.query('SELECT 1 FROM writer_media_refs WHERE media_id=$1', [crashed])).rowCount, 0);
    assert.equal((await pool.query('SELECT 1 FROM writer_media_reservations WHERE media_id=$1', [crashed])).rowCount, 0);
    assert.deepEqual(await has(crashed), claim);
  };
  await attemptReuse(b);
  assert.equal(a.child.kill('SIGKILL'), true);
  assert.deepEqual(await a.exit, { code: null, signal: 'SIGKILL' });
  await eventually(async () => !(await pool.query('SELECT 1 FROM pg_stat_activity WHERE application_name=$1', [a.name])).rowCount,
    'killed worker database sessions to close');
  assert.deepEqual((await pool.query('SELECT * FROM writer_cleanup_health')).rows, running);
  await attemptReuse(b);
  console.log('PASS competing operator exclusion, SIGKILL after source unlink, durable claim and rejected save/reservation reuse before/after death');

  const restarted = startWorker('operator_a_restarted');
  await restarted.ready;
  assert.notEqual(restarted.child.pid, a.child.pid);
  await attemptReuse(restarted);
  const recovered = await ok(restarted.request('cleanup'));
  assert.equal(recovered.find(row => row.id === crashed)?.outcome, 'deleted');
  assert.equal(await has(crashed), undefined);
  const health = (await pool.query('SELECT * FROM writer_cleanup_health')).rows[0];
  assert.equal(health.outcome, 'succeeded');
  assert.equal(health.counts.deleted, 1);
  assert.equal(health.counts.retry_required, 0);
  assert.ok(health.finished_at && health.last_success_at);
  assert.deepEqual(await ok(b.request('cleanup')), []);
  // Absence after completed cleanup must not permit UUID resurrection either.
  await rejected(b.request('reserve', { media: crashed, reservation: randomUUID() }), 404);
  await rejected(b.request('save', { media: crashed, book: failedBook, saveId: randomUUID() }), 403);
  const expected = { ...before };
  delete expected[`${crashed}/source`]; delete expected[`${crashed}/image`];
  assert.deepEqual(await snapshot(), expected, 'Only the two eligible fixture files may change');
  const deletes = (await readFile(join(root, 'attempts.jsonl'), 'utf8')).trim().split('\n').map(JSON.parse);
  assert.deepEqual(deletes.map(row => row.key), [`${crashed}/source`, `${crashed}/source`, `${crashed}/image`]);
  assert.deepEqual(deletes.map(row => row.worker), [a.name, restarted.name, restarted.name]);
  assert.deepEqual((await pool.query(`SELECT * FROM ${guardSchema}.writer_uploads`)).rows, guardBefore);
  for (const id of [saved, reserved, untouched]) assert.ok(await has(id));
  console.log('PASS fresh-process recovery, idempotent missing-source deletion, only exact fixture keys removed and guard schema/files untouched');
} finally {
  // Stop every child before dropping its isolated tables, including failures.
  for (const worker of workers) if (worker.child.exitCode === null && worker.child.signalCode === null) worker.child.kill('SIGKILL');
  await Promise.allSettled(workers.map(worker => worker.exit));
  for (const client of locks) {
    try { await client.query('ROLLBACK'); } finally { client.release(); }
  }
  try { await pool.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE; DROP SCHEMA IF EXISTS ${guardSchema} CASCADE`); }
  finally { await pool.end(); await rm(root, { recursive: true, force: true }); }
}
