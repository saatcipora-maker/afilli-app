import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import { clerkClient } from '@clerk/express';
import sharp from 'sharp';
import { writerObject } from '../src/lib/bulletin-storage.ts';
import { plain, cleanHtml, legacyDocument } from '../src/lib/writer-document.ts';

const requireDb = createRequire(new URL('../../../lib/db/package.json', import.meta.url));
const { Pool } = requireDb('pg'), pool = new Pool(), actors = [], images = [];
async function actor(label) {
  const user = await clerkClient.users.createUser({ emailAddress: [`writer-check-${randomUUID()}@example.com`], firstName: label, skipPasswordRequirement: true });
  const value = { id: user.id, session: null }; actors.push(value);
  value.session = (await clerkClient.sessions.createSession({ userId: value.id })).id;
  return value;
}
async function token(who) { return (await clerkClient.sessions.getToken(who.session)).jwt; }
async function api(who, path, method = 'GET', body, expected = 200, headers = {}) {
  if (who) headers = { Authorization: `Bearer ${await token(who)}`, 'X-Afilli-Actor': who.id, ...headers };
  const response = await fetch('http://localhost:80/api' + path, { method, headers: { 'Content-Type': 'application/json', ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
  const value = response.status === 204 ? null : await response.json();
  assert.equal(response.status, expected, `${method} ${path}: ${value?.error ?? response.status}`);
  return value;
}
const chapter = (html = '<p>İlk bölüm, gerçek bir yazı.</p>') => ({ id: randomUUID(), title: 'Birinci bölüm', html, status: 'draft' });
const doc = () => ({ title: 'Kalıcı Kitap', description: 'Deneme açıklaması', genres: ['Roman'], ageRating: 'all', language: 'Türkçe', completion: 'ongoing', cover: null, chapters: [chapter()] });
const save = (who, id, document, expectedRevision, saveId = randomUUID(), expected = 200) =>
  api(who, `/writer-books/${id}`, 'PUT', { document, expectedRevision, saveId, localId: 'check-' + id }, expected);
const publish = (who, book, action = 'publish', chapterId, expected = 200) =>
  api(who, `/writer-books/${book.id}/publication`, 'POST', { expectedRevision: book.revision, action, ...(chapterId ? { chapterId } : {}) }, expected);
async function upload(who, bytes) {
  const image = await api(who, '/writer-uploads', 'POST', { contentType: 'image/png', size: bytes.length }); images.push(image.id);
  assert.equal((await fetch(image.uploadUrl, { method: 'PUT', headers: { 'Content-Type': 'image/png' }, body: bytes })).status, 200);
  await api(who, `/writer-uploads/${image.id}/complete`, 'POST', {});
  return image;
}
async function verify() {
try {
  const [a, b] = await Promise.all([actor('Yazar Kontrol'), actor('Okur Kontrol')]);
  await Promise.all(actors.map(who => api(who, '/my-profile')));
  if (!process.argv.includes('--tools-only')) {
  await api(b, `/profiles/${a.id}/follow`, 'PUT', { following: true });
  await api(null, '/writer-books', 'GET', undefined, 401);
  const id = randomUUID(), document = doc();
  await api(b, `/writer-books/${id}`, 'PUT', { document, expectedRevision: 0, saveId: randomUUID() }, 401, { 'X-Afilli-Actor': a.id });
  let book = await save(a, id, document, 0);
  assert.equal(book.revision, 1); assert.equal(book.publication, 'draft');
  assert.equal((await api(a, '/writer-books')).find(row => row.id === id).chapterCount, 1);
  await api(null, `/authored-books/${id}`, 'GET', undefined, 404);
  await api(b, `/writer-books/${id}`, 'GET', undefined, 404);
  await api(b, `/writer-books/${id}`, 'DELETE', { expectedRevision: 1 }, 404);
  await publish(a, book, 'publish', undefined, 400);
  await api(a, '/bulletins', 'POST', { clientId: randomUUID(), body: '', photoIds: [], bookId: id }, 400);
  await save(a, id, { ...document, chapters: [chapter('<p>' + 'x'.repeat(50_001) + '</p>')] }, 1, randomUUID(), 400);
  const limit = await save(a, id, { ...document, chapters: [chapter('<p>' + 'x'.repeat(50_000) + '</p>')] }, 1);
  book = await save(a, id, document, limit.revision);
  const key = randomUUID(), payload = { ...document, description: 'Cihaz A' };
  book = await save(a, id, payload, book.revision, key);
  const repeated = await save(a, id, payload, book.revision - 1, key);
  assert.equal(repeated.revision, book.revision);
  await save(a, id, { ...payload, description: 'Çakışan içerik' }, book.revision - 1, key, 409);
  await save(a, id, { ...payload, description: 'Cihaz B eski sürüm' }, book.revision - 1, randomUUID(), 409);
  assert.equal((await api(a, `/writer-books/${id}`)).document.description, 'Cihaz A');
  console.log('PASS private drafts, exact chapter limit, owner/actor gates, durable revision CAS and idempotent saves');

  const deltaId = randomUUID(), deltaDoc = { ...doc(), cover: 'preset:forest',
    chapters: Array.from({ length: 100 }, (_, i) => ({ ...chapter('<p>' + 'x'.repeat(40_000) + '</p>'), title: `Bölüm ${i}` })) };
  let deltaBook = await save(a, deltaId, deltaDoc, 0);
  deltaBook = await publish(a, deltaBook);
  const releasedRevision = deltaBook.revision;
  const deltaInput = { expectedRevision: deltaBook.revision, saveId: randomUUID(),
    upserts: [{ ...deltaBook.document.chapters[50], html: '<p>Yalnızca değişen metin<script>bad()</script></p>' }], deletedChapterIds: [] };
  const patch = (who, input, expected = 200, headers = {}) => api(who, `/writer-books/${deltaId}`, 'PATCH', input, expected, headers);
  await patch(null, deltaInput, 401);
  await patch(b, deltaInput, 404);
  await patch(b, deltaInput, 401, { 'X-Afilli-Actor': a.id });
  const receipt = await patch(a, deltaInput);
  assert.equal(receipt.revision, releasedRevision + 1);
  assert.equal(receipt.saveId, deltaInput.saveId); assert.equal(receipt.document, undefined);
  assert.ok(Buffer.byteLength(JSON.stringify(receipt)) < 250);
  assert.deepEqual(await patch(a, deltaInput), receipt); // Response lost after commit.
  await patch(a, { ...deltaInput, upserts: [] }, 409);
  await patch(a, { ...deltaInput, saveId: randomUUID() }, 409);
  await save(a, deltaId, deltaDoc, releasedRevision, randomUUID(), 409); // Old full client cannot overwrite newer delta.
  const raced = await Promise.all([0, 1].map(() => patch(a, { ...deltaInput, expectedRevision: receipt.revision, saveId: randomUUID() })
    .then(value => ({ ok: true, value })).catch(error => ({ ok: false, error }))));
  assert.equal(raced.filter(r => r.ok).length, 1);
  assert.equal(raced.find(r => !r.ok).error.actual, 409);
  const privateDelta = await api(a, `/writer-books/${deltaId}`);
  assert.equal(privateDelta.revision, receipt.revision + 1);
  assert.equal(privateDelta.document.chapters[49].html, deltaDoc.chapters[49].html);
  assert.ok(!privateDelta.document.chapters[50].html.includes('bad'));
  assert.equal((await api(null, `/authored-books/${deltaId}`)).chapters[50].html, deltaDoc.chapters[50].html);
  let revisionDelta = privateDelta.revision;
  const modify = async (fields, expected = 200) => {
    const result = await patch(a, { expectedRevision: revisionDelta, saveId: randomUUID(), upserts: [], deletedChapterIds: [], ...fields }, expected);
    if (expected === 200) revisionDelta = result.revision;
    else assert.equal((await api(a, `/writer-books/${deltaId}`)).revision, revisionDelta);
    return result;
  };
  const ids = deltaDoc.chapters.map(c => c.id);
  await modify({ upserts: [deltaDoc.chapters[0], deltaDoc.chapters[0]] }, 400);
  await modify({ deletedChapterIds: [ids[0]] }, 400);
  await modify({ deletedChapterIds: [randomUUID()], chapterOrder: ids }, 400);
  await modify({ deletedChapterIds: [ids[0]], upserts: [deltaDoc.chapters[0]], chapterOrder: ids }, 400);
  await modify({ chapterOrder: [ids[0], ...ids.slice(0, -1)] }, 400);
  await modify({ chapterOrder: ids.slice(1) }, 400);
  await modify({ upserts: [{ ...deltaDoc.chapters[0], html: '<p>' + 'x'.repeat(50_001) + '</p>' }] }, 400);
  await modify({ upserts: [{ ...deltaDoc.chapters[0], html: `<p><img src="/api/writer-media/${randomUUID()}"></p>` }] }, 403);
  const extra = chapter();
  await modify({ upserts: [extra] }, 400);
  await modify({ deletedChapterIds: [ids[0]], upserts: [extra], chapterOrder: [extra.id, ...ids.slice(1).reverse()] });
  let ordered = await api(a, `/writer-books/${deltaId}`);
  assert.deepEqual(ordered.document.chapters.map(c => c.id), [extra.id, ...ids.slice(1).reverse()]);
  const { chapters: _chapters, ...meta } = ordered.document;
  await modify({ metadata: { ...meta, description: '', title: 'Yeni özel ad', cover: null } });
  ordered = await api(a, `/writer-books/${deltaId}`);
  assert.equal(ordered.document.cover, null); assert.equal(ordered.document.description, '');
  assert.equal((await api(null, `/authored-books/${deltaId}`)).title, deltaDoc.title);
  // The old full-save route remains usable after deltas, with the current revision.
  const fullAgain = await save(a, deltaId, ordered.document, revisionDelta);
  await patch(a, { ...deltaInput, expectedRevision: revisionDelta, saveId: randomUUID() }, 409);
  await api(a, `/writer-books/${deltaId}`, 'DELETE', { expectedRevision: fullAgain.revision }, 204);
  await patch(a, deltaInput, 410);
  await patch(b, deltaInput, 404);
  await save(a, deltaId, deltaDoc, 0, randomUUID(), 410);
  console.log('PASS real 100-chapter delta save, compact ack, same-ID replay, concurrent CAS, actor isolation, sanitization, immutable publication, structural validation, full-client compatibility and delete tombstone');
  if (process.argv.includes('--delta-only')) return;

  const photo = await sharp({ create: { width: 64, height: 96, channels: 3, background: '#a47249' } }).png().toBuffer();
  const image = await upload(a, photo), media = `/api/writer-media/${image.id}`;
  assert.equal((await fetch('http://localhost:80' + media)).status, 404);
  const privateImage = await fetch('http://localhost:80' + media, { headers: { Authorization: `Bearer ${await token(a)}` } });
  assert.equal(privateImage.status, 200);
  const sealed = Buffer.from(await privateImage.arrayBuffer());
  assert.equal((await sharp(sealed).metadata()).width, 64);
  await api(b, `/writer-media/${image.id}/access`, 'GET', undefined, 404);
  const reservation = randomUUID(), reservationPath = `/writer-uploads/${image.id}/reservations/${reservation}`;
  await api(null, reservationPath, 'PUT', undefined, 401);
  await api(null, reservationPath, 'DELETE', undefined, 401);
  await api(b, reservationPath, 'PUT', undefined, 404);
  await api(b, reservationPath, 'DELETE', undefined, 404);
  await api(b, reservationPath, 'PUT', undefined, 401, { 'X-Afilli-Actor': a.id });
  await api(a, reservationPath, 'PUT', undefined, 204);
  await api(a, reservationPath, 'PUT', undefined, 204);
  await api(a, reservationPath, 'DELETE', undefined, 204);
  await api(a, reservationPath, 'DELETE', undefined, 204);
  await pool.query('UPDATE writer_uploads SET deleting_at=now() WHERE id=$1', [image.id]);
  await api(a, `/writer-media/${image.id}/access`, 'GET', undefined, 404);
  await api(a, `/writer-uploads/${image.id}/complete`, 'POST', {}, 410);
  await api(b, `/writer-uploads/${image.id}/complete`, 'POST', {}, 404);
  await api(a, reservationPath, 'PUT', undefined, 410);
  await api(a, reservationPath, 'DELETE', undefined, 410);
  assert.equal((await fetch('http://localhost:80' + media, { headers: { Authorization: `Bearer ${await token(a)}` } })).status, 404);
  await pool.query('UPDATE writer_uploads SET deleting_at=NULL WHERE id=$1', [image.id]);
  await save(b, randomUUID(), { ...doc(), cover: media }, 0, randomUUID(), 403);
  book = await save(a, id, { ...payload, cover: media }, book.revision);
  book = await publish(a, book);
  assert.equal(book.publication, 'published');
  assert.equal((await api(null, '/published-books')).find(row => row.id === id).body, '');
  assert.equal((await fetch('http://localhost:80' + media)).status, 200);
  await api(b, `/writer-media/${image.id}/access`, 'GET', undefined, 404);
  // A still-valid source PUT cannot alter the sealed published image.
  await fetch(image.uploadUrl, { method: 'PUT', headers: { 'Content-Type': 'image/png' }, body: await sharp(photo).negate().png().toBuffer() });
  await api(a, `/writer-uploads/${image.id}/complete`, 'POST', {});
  assert.deepEqual(Buffer.from(await (await fetch('http://localhost:80' + media)).arrayBuffer()), sealed);
  const publicBefore = await api(null, `/authored-books/${id}`);
  const privateDoc = { ...book.document, title: 'Henüz duyurulmamış yeni ad', chapters: book.document.chapters.map(ch => ({ ...ch, html: '<p>GİZLİ YENİ METİN</p>' })) };
  book = await save(a, id, privateDoc, book.revision);
  assert.equal((await api(null, `/authored-books/${id}`)).title, publicBefore.title);
  assert.equal((await api(a, `/authored-books/${id}`)).title, publicBefore.title);
  assert.equal((await api(a, `/writer-books/${id}`)).document.title, privateDoc.title);
  console.log('PASS actual image upload/sealing, private media ACL and immutable last-published reader/feed snapshots');

  await api(b, `/authored-books/${id}/like`, 'PUT', { liked: true });
  await api(b, `/authored-books/${id}/like`, 'PUT', { liked: true });
  const commentId = randomUUID(), first = await api(b, `/authored-books/${id}/comments`, 'POST', { clientId: commentId, body: 'Gerçek yorum', chapterId: book.document.chapters[0].id });
  assert.equal((await api(b, `/authored-books/${id}/comments`, 'POST', { clientId: commentId, body: 'Gerçek yorum', chapterId: book.document.chapters[0].id })).id, first.id);
  let read = await api(b, `/authored-books/${id}`);
  assert.equal(read.readCount, 1); assert.equal(read.likeCount, 1); assert.equal(read.commentCount, 1); assert.equal(read.liked, true);
  const post = await api(a, '/bulletins', 'POST', { clientId: randomUUID(), body: '', photoIds: [], bookId: id }, 201);
  await api(b, `/bulletins/${post.id}/like`, 'PUT', { liked: true });
  await api(b, `/bulletins/${post.id}/comments`, 'POST', { body: 'Bülten yorumu korunmalı' }, 201);
  assert.equal((await api(b, '/social-notifications')).filter(row => row.bookId === id).length, 1);
  const second = chapter('<p>İkinci bölüm, ayrı yayın.</p>'); second.title = 'İkinci bölüm';
  book = await save(a, id, { ...book.document, chapters: [second, ...book.document.chapters] }, book.revision);
  book = await publish(a, book, 'publishChapter', second.id);
  read = await api(null, `/authored-books/${id}`);
  assert.equal(read.title, publicBefore.title);
  assert.deepEqual(read.chapters.map(ch => ch.id), [second.id, document.chapters[0].id]);
  assert.equal(read.chapters[1].html, publicBefore.chapters[0].html);
  assert.equal((await api(b, '/social-notifications')).filter(row => row.bookId === id).length, 2);
  book = await publish(a, book, 'draftChapter', document.chapters[0].id);
  assert.equal((await api(null, `/authored-books/${id}/comments`)).length, 0);
  assert.equal((await api(a, `/authored-books/${id}/comments`)).length, 1);
  book = await publish(a, book, 'unpublish');
  await api(null, `/authored-books/${id}`, 'GET', undefined, 404);
  assert.equal((await fetch('http://localhost:80' + media)).status, 404);
  const feed = await api(null, '/bulletins');
  assert.equal(feed.items.find(row => row.id === post.id).book, null);
  book = await publish(a, book);
  read = await api(b, `/authored-books/${id}`);
  assert.equal(read.likeCount, 1); assert.equal(read.commentCount, 1);
  await api(a, `/writer-books/${id}`, 'DELETE', { expectedRevision: book.revision - 1 }, 409);
  await api(a, `/writer-books/${id}`, 'DELETE', { expectedRevision: book.revision }, 204);
  await save(a, id, document, 0, randomUUID(), 410);
  const deletedPost = (await api(null, '/bulletins')).items.find(row => row.id === post.id);
  assert.equal(deletedPost.book, null); assert.equal(deletedPost.likeCount, 1); assert.equal(deletedPost.commentCount, 1);
  const neverCreated = randomUUID();
  await api(a, `/writer-books/${neverCreated}`, 'DELETE', { expectedRevision: 0 }, 204);
  await save(a, neverCreated, document, 0, randomUUID(), 410);
  console.log('PASS real reads/likes/comments/notifications, chapter ordering/privacy, unpublish/release and deletion without resurrection');

  const legacyId = randomUUID(), legacyBody = 'a'.repeat(49_999) + '😀' + '\n<& son satır';
  await pool.query('INSERT INTO authored_books(id,author_id,local_id,title,body) VALUES($1,$2,$3,$4,$5)', [legacyId, a.id, 'legacy-' + legacyId, 'Eski kitap', legacyBody]);
  const legacy = await api(a, `/writer-books/${legacyId}`);
  assert.equal(legacy.updatedAt, null);
  assert.equal(legacy.document.chapters.map(ch => plain(ch.html)).join(''), legacyBody);
  assert.ok(legacy.document.chapters.every(ch => plain(ch.html).length <= 50_000));
  assert.equal((await api(a, `/writer-books/${legacyId}`)).document.chapters[0].id, legacy.document.chapters[0].id);
  assert.ok(!cleanHtml('<p onclick="alert(1)">Güvenli <strong>metin</strong><script>alert(1)</script><a href="javascript:alert(1)">bağlantı</a></p>').includes('alert'));
  console.log('PASS lossless stable legacy chapter conversion and unsafe markup sanitization');
  }
  const spelling = await api(a, '/writer-spelling', 'POST', { text: 'Merhaba dünya. Kitpa okumayı seviyorum.' });
  assert.ok(spelling.some(issue => issue.word === 'Kitpa' && issue.suggestions.length > 0));
  await api(null, '/writer-spelling', 'POST', { text: 'merhaba' }, 401);
  const voiceId = randomUUID();
  await api(a, '/writer-voice', 'POST', { clientId: voiceId, audioBase64: 'AAAA', mimeType: 'audio/wav', consent: false }, 400);
  const voice = await api(null, '/writer-voice');
  assert.equal(voice.available, true, 'Configured voice decoder must be available');
  const wave = Buffer.alloc(44 + 32_000); wave.write('RIFF'); wave.writeUInt32LE(wave.length - 8, 4); wave.write('WAVEfmt ', 8); wave.writeUInt32LE(16, 16); wave.writeUInt16LE(1, 20); wave.writeUInt16LE(1, 22); wave.writeUInt32LE(16000, 24); wave.writeUInt32LE(32000, 28); wave.writeUInt16LE(2, 32); wave.writeUInt16LE(16, 34); wave.write('data', 36); wave.writeUInt32LE(32000, 40);
  await api(a, '/writer-voice', 'POST', { clientId: voiceId, audioBase64: wave.toString('base64'), mimeType: 'audio/wav', consent: true }, 400);
  assert.equal(Number((await pool.query('SELECT count(*) FROM writer_voice_requests WHERE owner_id=$1', [a.id])).rows[0].count), 0);
  if (process.argv.includes('--paid-voice')) {
    const input = { clientId: randomUUID(), audioBase64: (await readFile(new URL('../../../generated-artifacts/writer-voice.wav', import.meta.url))).toString('base64'), mimeType: 'audio/wav', consent: true };
    const transcript = await api(a, '/writer-voice', 'POST', input);
    assert.ok(transcript.text.trim().length > 0);
    assert.deepEqual(await api(a, '/writer-voice', 'POST', input), transcript);
    assert.equal(Number((await pool.query('SELECT count(*) FROM writer_voice_requests WHERE owner_id=$1', [a.id])).rows[0].count), 1);
    console.log('PASS actual approved transcription roundtrip and cached same-recording replay without another transcription request');
  }
  console.log('PASS real Turkish dictionary, microphone consent and pre-billing silence rejection');
} finally {
  const ids = actors.map(value => value.id);
  for (const id of images) for (const suffix of ['source', 'image']) await writerObject(`${id}/${suffix}`).delete({ ignoreNotFound: true }).catch(() => {});
  for (const [table, condition] of [
    ['social_notifications', 'recipient_id=ANY($1) OR actor_id=ANY($1)'], ['profile_follows', 'follower_id=ANY($1) OR followed_id=ANY($1)'],
    ['bulletin_notifications', 'recipient_id=ANY($1) OR actor_id=ANY($1)'], ['bulletin_likes', 'user_id=ANY($1)'],
    ['bulletins', 'author_id=ANY($1)'], ['writer_likes', 'user_id=ANY($1)'], ['writer_comments', 'author_id=ANY($1)'],
    ['book_reads', 'reader_id=ANY($1)'], ['authored_books', 'author_id=ANY($1)'], ['writer_uploads', 'owner_id=ANY($1)'],
    ['writer_voice_requests', 'owner_id=ANY($1)'], ['writer_voice_usage', 'user_id=ANY($1)'], ['writer_book_deletions', 'owner_id=ANY($1)'],
    ['community_users', 'id=ANY($1)'],
  ]) await pool.query(`DELETE FROM ${table} WHERE ${condition}`, [ids]);
  for (const who of actors) await clerkClient.users.deleteUser(who.id).catch(() => {});
  await pool.end();
}
}
await verify();
