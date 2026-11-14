import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { pool } from '@workspace/db';
import { saveWriter, patchWriter, publishWriter, writerRow, authoredBook } from '../src/lib/writer-service.ts';
import { deltaMediaIds, normalizeDocument } from '../src/lib/writer-document.ts';

// Exercise the real service/SQL in rolled-back isolated tables, without paid
// services, object deletion, or any reads/writes to customer records.
const db = await pool.connect(), owner = 'storage-owner', other = 'storage-other';
const schema = `writer_storage_${randomUUID().replaceAll('-', '')}`;
const chapter = html => ({ id: randomUUID(), title: 'Bölüm', html, status: 'draft' });
const document = chapters => ({ title: 'Taslak kitap', description: '', genres: ['Roman'],
  ageRating: 'all', language: 'Türkçe', completion: 'ongoing', cover: 'preset:forest', chapters });
const imageHtml = id => `<p>Görsel içeren bölüm<img src="/api/writer-media/${id}"></p>`;
const save = (id, doc, rev) => saveWriter(db, id, owner, { document: doc, expectedRevision: rev, saveId: randomUUID() });
const patch = (id, rev, fields) => patchWriter(db, id, owner, { expectedRevision: rev, saveId: randomUUID(),
  upserts: [], deletedChapterIds: [], ...fields });
const refs = async (id, version) => (await db.query('SELECT media_id FROM writer_media_refs WHERE book_id=$1 AND version=$2 ORDER BY media_id', [id, version])).rows.map(r => r.media_id);
async function rejected(fn, status) {
  await db.query('SAVEPOINT rejected');
  await assert.rejects(fn(), error => error.status === status);
  await db.query('ROLLBACK TO SAVEPOINT rejected');
}
try {
  await db.query('BEGIN');
  await db.query(`CREATE SCHEMA ${schema}`);
  await db.query(`SET LOCAL search_path TO ${schema},public`);
  for (const table of ['authored_books', 'writer_uploads', 'writer_media_refs', 'writer_book_deletions', 'bulletins',
    'community_users', 'profile_follows', 'social_notifications', 'book_reads', 'writer_likes', 'writer_comments']) {
    await db.query(`CREATE TABLE ${table} (LIKE public.${table} INCLUDING ALL)`);
  }
  await db.query('INSERT INTO community_users(id,nickname) VALUES($1,$1)', [owner]);
  const shared = randomUUID(), unique = randomUUID(), foreign = randomUUID(), unready = randomUUID(), deleting = randomUUID();
  for (const id of [shared, unique, foreign, unready, deleting]) {
    await db.query(`INSERT INTO writer_uploads(id,owner_id,content_type,size,ready,deleting_at)
      VALUES($1,$2,'image/png',100,$3,$4)`,
    [id, id === foreign ? other : owner, id !== unready, id === deleting ? new Date() : null]);
  }
  const id = randomUUID(), doc = document([chapter(imageHtml(shared)), chapter(imageHtml(shared)), chapter(imageHtml(unique))]);
  let book = await save(id, doc, 0);
  assert.deepEqual(book.document, normalizeDocument(doc));
  const oldBody = (await writerRow(id, db)).body;
  const edit = { ...doc.chapters[0], html: '<p>Yeni özel metin</p>' };
  let receipt = await patch(id, book.revision, { upserts: [edit] });
  assert.equal((await writerRow(id, db)).body, oldBody, 'Draft body is not duplicated on autosave');
  assert.ok((await authoredBook(id, owner, db)).body.includes('Yeni özel metin'), 'Private reader uses the current draft');
  assert.deepEqual(await refs(id, 'draft'), [shared, unique].sort(), 'Unchanged chapter retains shared image');
  book = await publishWriter(db, id, owner, { expectedRevision: receipt.revision, action: 'publish' });
  const released = await writerRow(id, db);
  const releasedFields = row => [row.published_data, row.title, row.body, row.cover, row.genre, row.publication, row.published_at];
  const queries = [];
  const traced = { query: (sql, params) => { queries.push(sql); return db.query(sql, params); } };
  const next = { ...book.document.chapters[1], html: '<p>Artık görselsiz</p>' };
  const input = { expectedRevision: book.revision, saveId: randomUUID(), upserts: [next], deletedChapterIds: [] };
  receipt = await patchWriter(traced, id, owner, input);
  const updated = await writerRow(id, db);
  assert.deepEqual(releasedFields(updated), releasedFields(released));
  assert.deepEqual(await refs(id, 'draft'), [unique]);
  assert.deepEqual(await refs(id, 'published'), [shared, unique].sort());
  const update = queries.find(sql => sql.startsWith('UPDATE authored_books SET'));
  assert.ok(update.includes('jsonb_set'), 'Single-chapter saves send only the changed chapter');
  assert.ok(!/\b(?:published_data|title|body|cover|genre|publication)=/.test(update));
  queries.length = 0;
  assert.deepEqual(await patchWriter(traced, id, owner, input), receipt);
  assert.ok(!queries.some(sql => /^(UPDATE|INSERT|DELETE)/.test(sql)), 'Exact retry performs no writes');
  await rejected(() => patchWriter(db, id, owner, { ...input, upserts: [] }), 409);
  await rejected(() => save(id, doc, book.revision), 409);
  await rejected(() => patchWriter(db, id, other, { ...input, expectedRevision: receipt.revision }), 404);
  for (const media of [foreign, unready, deleting, randomUUID()]) {
    await rejected(() => patch(id, receipt.revision, { upserts: [{ ...next, html: imageHtml(media) }] }), 403);
    assert.equal((await writerRow(id, db)).writer_revision, receipt.revision);
    assert.deepEqual(await refs(id, 'draft'), [unique]);
  }
  // Cover and chapter share an image: changing the cover must retain the chapter.
  receipt = await patch(id, receipt.revision, { metadata: { ...doc, chapters: undefined, cover: `/api/writer-media/${unique}` } });
  receipt = await patch(id, receipt.revision, { metadata: { ...doc, chapters: undefined, cover: null } });
  assert.deepEqual(await refs(id, 'draft'), [unique]);
  receipt = await patch(id, receipt.revision, { deletedChapterIds: [doc.chapters[2].id],
    chapterOrder: [doc.chapters[1].id, doc.chapters[0].id] });
  assert.deepEqual(await refs(id, 'draft'), []);
  const reordered = (await writerRow(id, db)).writer_data;
  assert.deepEqual(reordered.chapters.map(ch => ch.id), [doc.chapters[1].id, doc.chapters[0].id]);
  assert.equal(reordered.cover, null);
  // Full clients still work after optimized deltas and preserve the release.
  book = await save(id, { ...reordered, title: 'PUT özel adı' }, receipt.revision);
  assert.equal(book.document.title, 'PUT özel adı');
  assert.deepEqual(releasedFields(await writerRow(id, db)), releasedFields(released));
  // More than eight upserts and structural changes use the bounded bulk path.
  const bulk = Array.from({ length: 10 }, () => chapter('<p>Toplu bölüm</p>'));
  receipt = await patch(id, book.revision, { upserts: bulk, chapterOrder: [...reordered.chapters.map(ch => ch.id), ...bulk.map(ch => ch.id)] });
  const changedBulk = bulk.map(ch => ({ ...ch, html: '<p>Toplu güncelleme</p>' }));
  receipt = await patch(id, receipt.revision, { upserts: changedBulk });
  assert.deepEqual((await writerRow(id, db)).writer_data.chapters.slice(-10), changedBulk);
  console.log('PASS delta SQL, release immutability, current draft reader, media ownership/readiness/deletion gates, shared/last/cover references, retry, revision conflicts, full PUT, reorder, bulk saves');

  // Legacy public books freeze their original release on first full OR delta save.
  for (const full of [false, true]) {
    const legacyId = randomUUID();
    await db.query(`INSERT INTO authored_books(id,author_id,local_id,title,body,cover)
      VALUES($1::uuid,$2,$1::text,'Eski yayın','Eski okur metni',$3)`, [legacyId, owner, `/api/writer-media/${shared}`]);
    await db.query('INSERT INTO bulletins(author_id,client_id,body,book_id) VALUES($1,$2,\'Eski paylaşım\',$3)', [owner, randomUUID(), legacyId]);
    const legacy = await authoredBook(legacyId, null, db);
    if (full) await save(legacyId, document([chapter('<p>Yeni özel sürüm</p>')]), 0);
    else await patch(legacyId, 0, { metadata: { ...doc, chapters: undefined, title: 'Yeni özel ad' } });
    const migrated = await writerRow(legacyId, db);
    assert.equal(migrated.publication, 'published');
    assert.equal(migrated.published_data.title, legacy.title);
    assert.equal((await authoredBook(legacyId, null, db)).body, legacy.body);
    assert.deepEqual(await refs(legacyId, 'published'), [shared]);
  }
  // Deterministic proof that text edits never inspect untouched chapter HTML.
  let untouchedReads = 0;
  const untouched = { ...chapter(''), get html() { untouchedReads++; return '<p>Untouched</p>'; } };
  const before = document([edit, untouched]), after = { ...before, chapters: [next, untouched] };
  deltaMediaIds(before, after, [edit.id, next.id], []);
  assert.equal(untouchedReads, 0);
  console.log('PASS legacy full/delta migration keeps the public release and refs; text-only media scans skip untouched chapters');
} finally {
  await db.query('ROLLBACK');
  db.release();
  await pool.end();
}
