import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { clerkClient } from '@clerk/express';
import { bulletinObject } from '../src/lib/bulletin-storage.ts';

const requireDb = createRequire(new URL('../../../lib/db/package.json', import.meta.url));
const { Pool } = requireDb('pg');
const pool = new Pool();
const actors = [], posts = [], uploads = [];
const base = 'http://localhost:80/api';
async function actor(label) {
  const user = await clerkClient.users.createUser({
    emailAddress: [`afilli-check-${randomUUID()}@example.com`],
    firstName: label, skipPasswordRequirement: true,
  });
  const value = { userId: user.id, sessionId: null };
  actors.push(value);
  const session = await clerkClient.sessions.createSession({ userId: user.id });
  value.sessionId = session.id;
  return value;
}
async function api(who, route, method = 'GET', body, expected = 200) {
  const headers = { 'Content-Type': 'application/json' };
  if (who) headers.Authorization = `Bearer ${(await clerkClient.sessions.getToken(who.sessionId)).jwt}`;
  const response = await fetch(base + route, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const result = response.status === 204 ? null : await response.json();
  assert.equal(response.status, expected, `${method} ${route}: ${result?.error ?? response.status}`);
  return result;
}
async function create(who, input) {
  const post = await api(who, '/bulletins', 'POST', {
    clientId: randomUUID(), body: '', photoIds: [], ...input,
  }, 201);
  if (!posts.includes(post.id)) posts.push(post.id);
  return post;
}
try {
  const a = await actor('Yazar Kontrol'), b = await actor('Okur Kontrol');
  await api(a, '/community-profile', 'POST', { nickname: 'Yazar Kontrol' });
  await api(b, '/community-profile', 'POST', { nickname: 'Okur Kontrol' });
  await api(null, '/bulletins', 'POST', { clientId: randomUUID(), body: 'İzinsiz', photoIds: [] }, 401);
  await api(a, '/bulletins', 'POST', { clientId: randomUUID(), body: ' ', photoIds: [] }, 400);
  await api(a, '/bulletins', 'POST', { clientId: randomUUID(), body: 'x'.repeat(1001), photoIds: [] }, 400);
  await api(a, '/bulletins', 'POST', { clientId: randomUUID(), body: '', photoIds: Array.from({ length: 5 }, () => randomUUID()) }, 400);
  const key = randomUUID(), input = { clientId: key, body: 'Kalıcı bülten denetimi', photoIds: [] };
  const p = await create(a, input);
  assert.equal((await create(a, input)).id, p.id);
  assert.equal((await api(b, `/bulletins/${p.id}`)).body, p.body);
  await api(b, `/bulletins/${p.id}`, 'PATCH', { ...input, body: 'Başkasının değişikliği' }, 403);
  await api(b, `/bulletins/${p.id}`, 'DELETE', undefined, 403);
  console.log('PASS: authentication, 1000-character/four-photo limits, persistence, ownership and idempotent posting');

  await Promise.all([api(b, `/bulletins/${p.id}/like`, 'PUT', { liked: true }), api(b, `/bulletins/${p.id}/like`, 'PUT', { liked: true })]);
  assert.equal((await api(a, `/bulletins/${p.id}`)).likeCount, 1);
  assert.ok((await api(a, `/bulletins/${p.id}/likes`)).some((person) => person.id === b.userId));
  assert.equal((await api(b, `/bulletins/${p.id}/like`, 'PUT', { liked: false })).likeCount, 0);
  await api(b, `/bulletins/${p.id}/like`, 'PUT', { liked: true });
  console.log('PASS: concurrent repeated likes cannot inflate counts; liker list and unlike are real');

  await api(b, `/bulletins/${p.id}/comments`, 'POST', { body: ' ' }, 400);
  const comment = await api(b, `/bulletins/${p.id}/comments`, 'POST', { body: 'İlk yorum' }, 201);
  const reply = await api(a, `/bulletins/${p.id}/comments`, 'POST', { body: 'İlk cevap', parentId: comment.id }, 201);
  const third = await api(b, `/bulletins/${p.id}/comments`, 'POST', { body: 'Üçüncü katman', parentId: reply.id }, 201);
  assert.equal(third.depth, 3);
  await api(a, `/bulletins/${p.id}/comments`, 'POST', { body: 'Dördüncü katman yasak', parentId: third.id }, 400);
  await api(a, `/bulletin-comments/${comment.id}`, 'PATCH', { body: 'Başkasının yorumunu düzenleyemem' }, 403);
  await api(b, `/bulletin-comments/${comment.id}`, 'PATCH', { body: 'Kendi yorumum güncellendi' });
  assert.equal((await api(a, `/bulletins/${p.id}`)).commentCount, 3);
  console.log('PASS: persistent comments, own edit, reply threading and server-enforced maximum depth');

  const target = { targetType: 'post', targetId: p.id };
  await api(b, '/bulletin-reactions', 'PUT', { ...target, emoji: '❤️' });
  const changed = await api(b, '/bulletin-reactions', 'PUT', { ...target, emoji: '😂' });
  assert.equal(changed.length, 1); assert.equal(changed[0].count, 1); assert.equal(changed[0].emoji, '😂');
  await api(a, '/bulletin-reactions', 'PUT', { ...target, emoji: '👏' });
  assert.equal((await api(a, `/bulletin-reactions?targetType=post&targetId=${p.id}`)).length, 2);
  await api(b, '/bulletin-reactions', 'PUT', { targetType: 'comment', targetId: reply.id, emoji: '📖' });
  await api(b, '/bulletin-reactions', 'PUT', { ...target, emoji: 'invalid' }, 400);
  const notes = await api(a, '/bulletin-notifications');
  assert.ok(notes.some((note) => note.postId === p.id && !note.read));
  await api(b, `/bulletin-notifications/${notes[0].id}`, 'PATCH', undefined, 404);
  await api(a, `/bulletin-notifications/${notes[0].id}`, 'PATCH', undefined, 204);
  assert.equal((await api(a, '/bulletin-notifications')).find((note) => note.id === notes[0].id).read, true);
  await api(a, `/bulletin-comments/${comment.id}`, 'DELETE', undefined, 204);
  const thread = await api(a, `/bulletins/${p.id}/comments`);
  assert.equal(thread.find((row) => row.id === comment.id).deleted, true);
  assert.equal(thread.find((row) => row.id === third.id).parentId, reply.id);
  assert.equal((await api(a, `/bulletins/${p.id}`)).commentCount, 2);
  console.log('PASS: replacement reactions, real people lists, private notifications, moderation and preserved child threads');

  const ownBook = await api(a, '/authored-books', 'POST', { localId: randomUUID(), title: 'Yazarın kitabı', body: 'Birinci bölüm.' });
  const otherBook = await api(b, '/authored-books', 'POST', { localId: randomUUID(), title: 'Başka yazarın kitabı', body: 'Özel taslak.' });
  assert.ok(!(await api(a, '/authored-books')).some((book) => book.id === otherBook.id));
  await api(a, `/authored-books/${otherBook.id}`, 'GET', undefined, 404);
  await api(a, '/bulletins', 'POST', { clientId: randomUUID(), body: '', photoIds: [], bookId: otherBook.id }, 403);
  const bookPost = await create(a, { bookId: ownBook.id });
  assert.equal((await api(null, `/authored-books/${ownBook.id}`)).title, ownBook.title);
  console.log('PASS: only own books can be listed/shared and the real book detail becomes readable after sharing');

  const photo = await readFile(new URL('../../afilli/assets/images/magazine/autumn-cover.webp', import.meta.url));
  const upload = await api(a, '/bulletin-uploads', 'POST', { contentType: 'image/webp', size: photo.length });
  uploads.push(upload.id);
  const put = await fetch(upload.uploadURL, { method: 'PUT', headers: { 'Content-Type': 'image/webp' }, body: photo });
  assert.equal(put.ok, true, 'Direct App Storage upload succeeded');
  const photoPost = await create(a, { photoIds: [upload.id] });
  assert.equal(photoPost.photos.length, 1);
  const media = await fetch('http://localhost:80' + photoPost.photos[0].url);
  assert.equal(media.status, 200);
  assert.deepEqual(Buffer.from(await media.arrayBuffer()), photo);
  await api(b, '/bulletins', 'POST', { clientId: randomUUID(), body: '', photoIds: [upload.id] }, 403);
  console.log('PASS: real direct image upload, verified raster data and full-quality bytes served from App Storage');

  for (let i = 0; i < 16; i++) await create(a, { body: `Sayfalama kontrolü ${i}` });
  const first = await api(a, '/bulletins');
  assert.ok(first.nextCursor);
  const second = await api(a, '/bulletins?cursor=' + encodeURIComponent(first.nextCursor));
  assert.equal(first.items.some((post) => second.items.some((other) => other.id === post.id)), false);
  await api(a, `/bulletins/${p.id}`, 'PATCH', { ...input, body: 'Düzenlenmiş bülten' });
  const edited = await api(b, `/bulletins/${p.id}`);
  assert.equal(edited.likeCount, 1); assert.equal(edited.commentCount, 2);
  await api(a, `/bulletins/${p.id}`, 'DELETE', undefined, 204);
  await api(b, `/bulletins/${p.id}`, 'GET', undefined, 404);
  console.log('PASS: stable pagination, editing preserves interactions, deletion applies to other users');
  console.log('All real two-user bulletin API checks passed.');
} finally {
  for (const id of posts) {
    await pool.query(`DELETE FROM bulletin_reactions WHERE (target_type='post' AND target_id=$1)
      OR (target_type='comment' AND target_id IN (SELECT id FROM bulletin_comments WHERE post_id=$1))`, [id]).catch(() => {});
    await pool.query('DELETE FROM bulletins WHERE id=$1', [id]).catch(() => {});
  }
  const users = actors.map((actor) => actor.userId);
  if (users.length) {
    for (const table of ['bulletin_uploads', 'authored_books', 'community_users']) {
      const column = table === 'community_users' ? 'id' : table === 'authored_books' ? 'author_id' : 'owner_id';
      await pool.query(`DELETE FROM ${table} WHERE ${column}=ANY($1::text[])`, [users]);
    }
  }
  for (const id of uploads) await bulletinObject(id).delete({ ignoreNotFound: true }).catch(() => {});
  for (const actor of actors) await clerkClient.users.deleteUser(actor.userId).catch(() => {});
  await pool.end();
}
