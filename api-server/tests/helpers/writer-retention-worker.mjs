// Private IPC worker: never invoke against the application's normal search_path.
import assert from 'node:assert/strict';
import { appendFile, readFile, unlink } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pool } from '@workspace/db';
import { transaction } from '../../src/lib/community.ts';
import { applyWriterCleanup, setMediaReservation } from '../../src/lib/writer-retention.ts';
import { saveWriter } from '../../src/lib/writer-service.ts';

const config = JSON.parse(process.argv[2]);
assert.ok(process.send, 'Worker requires IPC');
assert.match(config.schema, /^retention_process_test_[a-f0-9]{32}$/);
assert.equal(process.env.PGOPTIONS, `-c search_path=${config.schema}`);
pool.options.options = process.env.PGOPTIONS;
pool.options.application_name = config.name;
assert.equal((await pool.query('SELECT current_schema() AS name')).rows[0].name, config.schema);
const root = resolve(config.root);
const manifest = JSON.parse(await readFile(join(root, 'manifest.json'), 'utf8'));
assert.equal(manifest.schema, config.schema);
const allowed = new Set(manifest.ids.flatMap(id => [`${id}/source`, `${id}/image`]));
// No provider, signed URL or network storage is needed by these tests.
globalThis.fetch = async () => { throw new Error('Network calls forbidden in retention process tests'); };

const gates = new Map();
process.on('message', async message => {
  if (message.type === 'continue') {
    gates.get(message.id)?.();
    return;
  }
  const { id, command, args = {} } = message;
  const event = (type, extra = {}) => process.send({ id, type, ...extra });
  try {
    let value;
    if (command === 'cleanup') {
      value = await applyWriterCleanup(100, async key => {
        assert.ok(allowed.has(key), `Refusing non-fixture key: ${key}`);
        assert.match(key, /^[a-f0-9-]{36}\/(source|image)$/);
        await appendFile(join(root, 'attempts.jsonl'), `${JSON.stringify({ worker: config.name, key })}\n`);
        let existed = true;
        try { await unlink(join(root, key)); }
        catch (error) { if (error.code !== 'ENOENT') throw error; existed = false; }
        if (args.pauseAfterSource === key) {
          // Register the gate before notifying the parent. SIGKILL must happen
          // after actual unlink, but before image deletion / DB row deletion.
          await new Promise(resume => {
            gates.set(id, resume);
            event('source-deleted', { key, existed });
          });
          gates.delete(id);
        }
      });
    } else if (command === 'reserve') {
      value = await setMediaReservation(manifest.owner, args.media, args.reservation, true);
    } else if (command === 'save') {
      value = await transaction(db => saveWriter(db, args.book, manifest.owner, {
        expectedRevision: 0, saveId: args.saveId, localId: args.book,
        document: {
          title: 'Retention fixture', description: '', genres: [], ageRating: 'all',
          language: 'Türkçe', completion: 'ongoing', cover: `/api/writer-media/${args.media}`,
          chapters: [],
        },
      }));
    } else {
      throw new Error(`Unknown worker command: ${command}`);
    }
    event('result', { ok: true, value });
  } catch (error) {
    event('result', { ok: false, status: error.status, error: error.message });
  }
});
process.on('disconnect', () => { void pool.end().finally(() => process.exit(0)); });
process.send({ type: 'ready', pid: process.pid });
