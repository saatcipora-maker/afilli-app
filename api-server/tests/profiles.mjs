import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import { clerkClient } from '@clerk/express';
import { profileObject } from '../src/lib/bulletin-storage.ts';

const requireDb = createRequire(new URL('../../../lib/db/package.json', import.meta.url));
const { Pool } = requireDb('pg'), pool = new Pool(), actors = [], images = [];
let originalSettings;
async function actor(label) {
  const user = await clerkClient.users.createUser({ emailAddress: [`profile-check-${randomUUID()}@example.com`], firstName: label, skipPasswordRequirement: true });
  const value = { id: user.id, session: null }; actors.push(value);
  value.session = (await clerkClient.sessions.createSession({ userId: value.id })).id;
  return value;
}
async function api(who, path, method = 'GET', body, expected = 200, extraHeaders = {}) {
  const headers = { 'Content-Type': 'application/json', ...extraHeaders };
  if (who) headers.Authorization = `Bearer ${(await clerkClient.sessions.getToken(who.session)).jwt}`;
  const response = await fetch('http://localhost:80/api' + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const value = response.status === 204 ? null : await response.json();
  assert.equal(response.status, expected, `${method} ${path}: ${value?.error ?? response.status}`);
  return value;
}
const input = (name) => ({ nickname: name, handle: 'check_' + randomUUID().replaceAll('-', '').slice(0, 12), bio: 'Gerçek hesap kontrolü', quote: 'Bir satır daha.', instagram: null });
try {
  const [a, b, c] = await Promise.all([actor('Profil Kontrol'), actor('Okur Kontrol'), actor('Gizlilik Kontrol')]);
  await Promise.all(actors.map((who) => api(who, '/my-profile')));
  originalSettings = await api(null, '/social-settings');
  assert.equal(originalSettings.instagramHandle.length > 0, true);
  await api(null, '/my-profile', 'GET', undefined, 401);
  const profileInput = input('Kalıcı Yazar');
  const profile = await api(a, '/my-profile', 'PATCH', { ...profileInput, isAdmin: true, premium: true });
  assert.equal(profile.nickname, profileInput.nickname); assert.equal(profile.premium, false); assert.equal(profile.isAdmin, false);
  assert.equal((await api(null, '/profiles/' + a.id)).bio, profileInput.bio);
  await api(b, '/my-profile', 'PATCH', { ...input('Başka Okur'), handle: profileInput.handle }, 409);
  await api(a, '/my-profile', 'PATCH', { ...profileInput, handle: 'invalid/<script>' }, 400);
  await api(b, '/my-profile', 'PATCH', profileInput, 401, { 'X-Afilli-Actor': a.id });
  await api(a, '/social-settings', 'PUT', originalSettings, 403);
  console.log('PASS profile persistence, unique handles, trusted roles, no premium spoofing and account-switch actor rejection');

  await Promise.all([api(b, `/profiles/${a.id}/follow`, 'PUT', { following: true }), api(b, `/profiles/${a.id}/follow`, 'PUT', { following: true })]);
  const followed = await api(b, '/profiles/' + a.id);
  assert.equal(followed.followersCount, 1); assert.equal(followed.following, true);
  assert.equal((await api(b, '/my-profile')).followingCount, 1);
  assert.ok((await api(null, `/profiles/${a.id}/connections?kind=followers`)).items.some((p) => p.id === b.id));
  assert.ok((await api(null, '/profiles?search=' + encodeURIComponent(profileInput.nickname))).items.some((p) => p.id === a.id));
  await api(a, `/profiles/${a.id}/follow`, 'PUT', { following: true }, 400);
  await api(b, `/profiles/${a.id}/follow`, 'PUT', { following: false });
  assert.equal((await api(null, '/profiles/' + a.id)).followersCount, 0);
  console.log('PASS idempotent real follow/unfollow, connection lists and people search');

  const thread = await api(a, '/conversations', 'POST', { peerId: b.id });
  assert.equal((await api(b, '/conversations', 'POST', { peerId: a.id })).id, thread.id);
  await api(c, `/conversations/${thread.id}`, 'GET', undefined, 404);
  await api(c, `/conversations/${thread.id}/messages`, 'GET', undefined, 404);
  await api(c, `/conversations/${thread.id}/typing`, 'PUT', { typing: true }, 404);
  await api(c, `/conversations/${thread.id}/read`, 'PUT', undefined, 404);
  await api(c, `/conversations/${thread.id}/messages`, 'POST', { clientId: randomUUID(), body: 'İzinsiz' }, 404);
  await api(a, '/presence', 'POST', { active: true }, 204);
  assert.equal((await api(b, '/profiles/' + a.id)).online, true);
  await api(a, `/conversations/${thread.id}/typing`, 'PUT', { typing: true }, 204);
  assert.equal((await api(b, `/conversations/${thread.id}`)).peerTyping, true);
  assert.equal((await api(c, `/profiles/${a.id}`)).typing, false);
  assert.equal((await api(b, `/profiles/${a.id}`)).typing, true);
  await api(a, `/conversations/${thread.id}/typing`, 'PUT', { typing: false }, 204);
  const messageInput = { clientId: randomUUID(), body: 'Gizli mektup' };
  const message = await api(a, `/conversations/${thread.id}/messages`, 'POST', messageInput, 201);
  assert.equal((await api(a, `/conversations/${thread.id}/messages`, 'POST', messageInput, 201)).id, message.id);
  assert.equal((await api(b, `/conversations/${thread.id}`)).unreadCount, 1);
  assert.ok((await api(b, '/social-notifications')).some((n) => n.threadId === thread.id && !n.read));
  const note = (await api(b, '/social-notifications')).find((n) => n.threadId === thread.id);
  await api(c, `/social-notifications/${note.id}`, 'PATCH', undefined, 404);
  await api(b, `/conversations/${thread.id}/read`, 'PUT', undefined, 204);
  assert.equal((await api(b, `/conversations/${thread.id}`)).unreadCount, 0);
  assert.ok((await api(a, `/conversations/${thread.id}/messages`)).items.find((m) => m.id === message.id).readAt);
  await api(a, '/presence', 'POST', { active: false }, 204);
  assert.equal((await api(b, '/profiles/' + a.id)).online, false);
  await pool.query("UPDATE community_users SET presence_active=true,last_seen=now()-interval '2 minutes' WHERE id=$1", [a.id]);
  assert.equal((await api(b, '/profiles/' + a.id)).online, false);
  await pool.query("UPDATE conversations SET low_typing_until=now()-interval '1 second',high_typing_until=now()-interval '1 second' WHERE id=$1", [thread.id]);
  assert.equal((await api(b, `/conversations/${thread.id}`)).peerTyping, false);
  console.log('PASS participant-only messages, idempotent send/read, genuine expiring presence and private typing');

  await pool.query(`INSERT INTO direct_messages(thread_id,sender_id,client_id,body,created_at)
    SELECT $1,$2,gen_random_uuid(),'Sayfalama kontrolü '||n,now()-make_interval(secs=>n) FROM generate_series(1,31) n`, [thread.id, a.id]);
  const first = await api(b, `/conversations/${thread.id}/messages`);
  const second = await api(b, `/conversations/${thread.id}/messages?cursor=` + encodeURIComponent(first.nextCursor));
  assert.ok(first.nextCursor); assert.equal(first.items.some((m) => second.items.some((n) => n.id === m.id)), false);

  const book = await api(a, '/authored-books', 'POST', { localId: randomUUID(), title: 'Açık kitap kontrolü', body: 'Gerçek okunma kontrol metni.' });
  const privateBook = await api(a, '/authored-books', 'POST', { localId: randomUUID(), title: 'Özel kitap kontrolü', body: 'Yalnızca yazar.' });
  const post = await api(a, '/bulletins', 'POST', { clientId: randomUUID(), body: '', photoIds: [], bookId: book.id }, 201);
  await api(b, `/bulletins/${post.id}/like`, 'PUT', { liked: true });
  assert.equal((await api(a, '/my-profile')).bookCount, 2);
  const publicBooks = await api(b, `/profiles/${a.id}/content?tab=books`);
  assert.ok(publicBooks.books.some((p) => p.id === book.id)); assert.ok(!publicBooks.books.some((p) => p.id === privateBook.id));
  assert.ok((await api(null, `/profiles/${a.id}/content?tab=bulletins`)).bulletins.some((p) => p.id === post.id));
  assert.ok((await api(b, `/profiles/${b.id}/content?tab=liked`)).bulletins.some((p) => p.id === post.id));
  await api(a, `/authored-books/${book.id}`);
  assert.equal((await pool.query('SELECT count(*)::int AS n FROM book_reads WHERE book_id=$1', [book.id])).rows[0].n, 0);
  await api(b, `/authored-books/${book.id}`); await api(b, `/authored-books/${book.id}`);
  assert.equal((await pool.query('SELECT count(*)::int AS n FROM book_reads WHERE book_id=$1', [book.id])).rows[0].n, 1);
  await clerkClient.users.updateUserMetadata(a.id, { publicMetadata: { role: 'admin' } });
  await api(a, '/social-settings', 'PUT', { ...originalSettings, popularLimit: 100 });
  assert.equal((await api(null, '/profiles/' + a.id)).popular, true);
  await pool.query("UPDATE book_reads SET created_at=now()-interval '31 days' WHERE book_id=$1", [book.id]);
  assert.equal((await api(null, '/profiles/' + a.id)).popular, false);
  await api(a, '/social-settings', 'PUT', { ...originalSettings, facebookUrl: 'https://facebook.com.evil.example/steal' }, 400);
  await clerkClient.users.updateUserMetadata(a.id, { publicMetadata: { role: 'reader' } });
  await api(a, '/social-settings', 'PUT', originalSettings, 403);
  await clerkClient.users.updateUserMetadata(a.id, { publicMetadata: { role: 'admin' } });
  await api(a, '/social-settings', 'PUT', originalSettings);
  console.log('PASS private/public book access, actual likes/content, deduplicated genuine reads, recent-read crown and immediately revocable admin access');

  const photo = await readFile(new URL('../../afilli/assets/images/magazine/autumn-cover.webp', import.meta.url));
  const upload = await api(a, '/profile-uploads', 'POST', { purpose: 'avatar', contentType: 'image/webp', size: photo.length }); images.push(upload.id);
  assert.equal((await fetch(upload.uploadURL, { method: 'PUT', headers: { 'Content-Type': 'image/webp' }, body: photo })).ok, true);
  await api(b, '/my-profile', 'PATCH', { ...input('Fotoğraf Hırsızlığı'), avatarUploadId: upload.id }, 403);
  await api(a, '/my-profile', 'PATCH', { ...profileInput, coverUploadId: upload.id }, 403);
  const updated = await api(a, '/my-profile', 'PATCH', { ...profileInput, avatarUploadId: upload.id });
  const image = await fetch('http://localhost:80' + updated.avatar);
  assert.equal(image.status, 200); assert.deepEqual(Buffer.from(await image.arrayBuffer()), photo);
  await api(a, '/my-profile', 'PATCH', { ...profileInput, avatarUploadId: null });
  assert.equal((await fetch('http://localhost:80' + updated.avatar)).status, 404);
  console.log('PASS actual profile upload, verified full-quality bytes, owner/purpose restrictions and removal');
} finally {
  if (originalSettings && actors[0]) {
    await clerkClient.users.updateUserMetadata(actors[0].id, { publicMetadata: { role: 'admin' } }).catch(() => {});
    await api(actors[0], '/social-settings', 'PUT', originalSettings).catch(() => {});
  }
  const ids = actors.map((actor) => actor.id);
  for (const id of images) await profileObject(id).delete({ ignoreNotFound: true }).catch(() => {});
  for (const [table, condition] of [
    ['social_notifications', 'recipient_id=ANY($1) OR actor_id=ANY($1)'], ['direct_messages', 'sender_id=ANY($1)'],
    ['conversations', 'user_low=ANY($1) OR user_high=ANY($1)'], ['profile_follows', 'follower_id=ANY($1) OR followed_id=ANY($1)'],
    ['profile_uploads', 'owner_id=ANY($1)'], ['bulletin_notifications', 'recipient_id=ANY($1) OR actor_id=ANY($1)'],
    ['bulletin_likes', 'user_id=ANY($1)'], ['bulletins', 'author_id=ANY($1)'], ['book_reads', 'reader_id=ANY($1)'],
    ['authored_books', 'author_id=ANY($1)'], ['community_users', 'id=ANY($1)'],
  ]) await pool.query(`DELETE FROM ${table} WHERE ${condition}`, [ids]).catch(() => {});
  for (const actor of actors) await clerkClient.users.deleteUser(actor.id).catch(() => {});
  await pool.end();
}
