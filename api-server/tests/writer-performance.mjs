import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { pool } from '@workspace/db';
import { patchWriter } from '../src/lib/writer-service.ts';
import { plain, mediaIds, deltaMediaIds } from '../src/lib/writer-document.ts';

// Real logged PostgreSQL tables, never customer rows. All DDL/data rolls back.
// EXPLAIN ANALYZE executes each UPDATE exactly once and reports its actual WAL.
const client = await pool.connect();
const schema = `writer_perf_${randomUUID().replaceAll('-', '')}`;
const results = [];
const median = values => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
let seed = 42;
function text(length) {
  let value = '';
  while (value.length < length) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    value += seed.toString(36) + ' ';
  }
  return value.slice(0, length);
}
try {
  await client.query('BEGIN');
  await client.query(`CREATE SCHEMA ${schema}`);
  await client.query(`SET LOCAL search_path TO ${schema},public`);
  for (const table of ['authored_books', 'writer_uploads', 'writer_media_refs', 'writer_book_deletions', 'bulletins']) {
    await client.query(`CREATE TABLE ${table} (LIKE public.${table} INCLUDING ALL)`);
  }
  for (const count of [100, 200]) {
    const document = { title: 'Large book', description: '', genres: ['Roman'], ageRating: 'all',
      language: 'Türkçe', completion: 'ongoing', cover: 'preset:forest',
      chapters: Array.from({ length: count }, (_, i) => ({ id: randomUUID(), title: `Chapter ${i}`,
        html: `<p>${text(40_000)}</p>`, status: 'published' })) };
    const scanStart = performance.now();
    for (let i = 0; i < 30; i++) mediaIds(document);
    const fullMediaScanMs = (performance.now() - scanStart) / 30;
    const deltaScanStart = performance.now();
    for (let i = 0; i < 30; i++) deltaMediaIds(document, document, [document.chapters[50].id], []);
    const deltaMediaScanMs = (performance.now() - deltaScanStart) / 30;
    for (const published of [false, true]) {
      const id = randomUUID(), owner = 'performance-owner';
      await client.query(`INSERT INTO authored_books(id,author_id,local_id,title,body,cover,genre,writer_data,published_data,publication,writer_revision)
        VALUES($1::uuid,$2,$1::text,$3,$4,$5,'Roman',$6,$7,$8,1)`,
      [id, owner, document.title, document.chapters.map(c => plain(c.html)).join('\n\n'),
        document.cover, document, published ? document : null, published ? 'published' : 'draft']);
      const samples = [];
      for (let iteration = 0; iteration < 8; iteration++) {
        let walBytes = 0, updateParamBytes = 0, updateMs = 0, updateSql = '';
        const db = { query: async (sql, params = []) => {
          if (/^UPDATE authored_books SET/.test(sql)) {
            updateSql = sql;
            updateParamBytes += Buffer.byteLength(JSON.stringify(params));
            const result = await client.query(`EXPLAIN (ANALYZE, BUFFERS, WAL, FORMAT JSON) ${sql}`, params);
            const plan = result.rows[0]['QUERY PLAN'][0];
            walBytes += plan.Plan['WAL Bytes'] ?? 0;
            updateMs += plan['Execution Time'];
            return { rows: [{ writer_revision: iteration + 2, writer_updated_at: new Date() }], rowCount: 1 };
          }
          return client.query(sql, params);
        } };
        const start = performance.now();
        const receipt = await patchWriter(db, id, owner, { expectedRevision: iteration + 1, saveId: randomUUID(),
          upserts: [{ ...document.chapters[50], html: document.chapters[50].html.replace('</p>', ` edit-${iteration}</p>`) }],
          deletedChapterIds: [] });
        const elapsedMs = performance.now() - start;
        assert.equal(receipt.revision, iteration + 2);
        assert.equal((await client.query('SELECT writer_revision FROM authored_books WHERE id=$1', [id])).rows[0].writer_revision, receipt.revision);
        if (iteration > 0) samples.push({ elapsedMs, walBytes, updateParamBytes, updateMs });
        if (process.argv.includes('--assert-optimized') && published) {
          assert.ok(!/\b(?:published_data|body|title|cover|genre|publication)=/.test(updateSql),
            'Normal published-book autosave must not rewrite the release or display columns');
        }
        if (process.argv.includes('--assert-optimized')) {
          assert.ok(updateParamBytes < 50_000, 'Single-chapter SQL payload must not grow with book size');
          assert.ok(!/\bbody=/.test(updateSql), 'Autosave must not duplicate the private manuscript in legacy body');
          assert.ok(walBytes > 0, 'Use real logged tables, not a zero-WAL temporary-table benchmark');
        }
      }
      results.push({ chapters: count, published, manuscriptBytes: Buffer.byteLength(JSON.stringify(document)),
        fullMediaScanMs, deltaMediaScanMs, samples: samples.length,
        ...Object.fromEntries(['elapsedMs', 'walBytes', 'updateParamBytes', 'updateMs'].map(key =>
          [key, Number(median(samples.map(s => s[key])).toFixed(3))])) });
    }
  }
  console.table(results);
  const out = process.argv.find(a => a.startsWith('--out='))?.slice(6);
  if (out) await writeFile(out, JSON.stringify(results, null, 2) + '\n');
} finally {
  await client.query('ROLLBACK');
  client.release();
  await pool.end();
}
