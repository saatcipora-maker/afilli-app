import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { clerkClient } from '@clerk/express';
import { profileObject } from '../src/lib/bulletin-storage.ts';

// Dedicated disposable Chromium profile, never the creator's browser/session.
const requireDb = createRequire(new URL('../../../lib/db/package.json', import.meta.url));
const { Pool } = requireDb('pg'), pool = new Pool(), actors = [];
const target = (await (await fetch('http://127.0.0.1:9250/json')).json()).find((item) => item.type === 'page');
const socket = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve) => { socket.onopen = resolve; });
const callbacks = new Map(); let serial = 0;
socket.onmessage = ({ data }) => {
  const message = JSON.parse(data); if (!message.id) return;
  const callback = callbacks.get(message.id); callbacks.delete(message.id);
  if (message.error) callback.reject(new Error(message.error.message)); else callback.resolve(message.result);
};
const call = (method, params = {}) => new Promise((resolve, reject) => { const id = ++serial; callbacks.set(id, { resolve, reject }); socket.send(JSON.stringify({ id, method, params })); });
async function evaluate(expression) {
  const response = await call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, userGesture: true });
  if (response.exceptionDetails) throw new Error(response.exceptionDetails.exception?.description?.split('\n')[0] ?? 'Browser evaluation failed');
  return response.result.value;
}
async function wait(expression, timeout = 30000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    if (await evaluate(expression)) return;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error('Browser condition timed out: ' + expression.slice(0, 150));
}
const sel = (id) => `[data-testid=${JSON.stringify(id)}]`;
const exists = (id) => `!!document.querySelector(${JSON.stringify(sel(id))})`;
const click = (id) => evaluate(`document.querySelector(${JSON.stringify(sel(id))}).click()`);
async function type(id, value) {
  await evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(sel(id))});const p=e.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype;Object.getOwnPropertyDescriptor(p,'value').set.call(e,${JSON.stringify(value)});e.dispatchEvent(new Event('input',{bubbles:true}));})()`);
}
const go = (path) => call('Page.navigate', { url: 'https://' + process.env.REPLIT_EXPO_DEV_DOMAIN + path });
async function actor(label) {
  const user = await clerkClient.users.createUser({ emailAddress: [`profile-browser-${randomUUID()}@example.com`], firstName: label, skipPasswordRequirement: true });
  const value = { id: user.id, session: (await clerkClient.sessions.createSession({ userId: user.id })).id }; actors.push(value);
  return value;
}
async function api(who, path, method = 'GET', body) {
  const token = (await clerkClient.sessions.getToken(who.session)).jwt;
  const response = await fetch('http://localhost:80/api' + path, { method, headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  const result = response.status === 204 ? null : await response.json();
  assert.ok(response.ok, `${method} ${path}: ${result?.error ?? response.status}`); return result;
}
async function login(who) {
  await wait('!!window.Clerk?.loaded');
  const ticket = await clerkClient.signInTokens.createSignInToken({ userId: who.id, expiresInSeconds: 120 });
  await evaluate(`(async()=>{const r=await window.Clerk.client.signIn.create({strategy:'ticket',ticket:${JSON.stringify(ticket.token)}});if(r.status!=='complete')throw new Error('Test login incomplete');await window.Clerk.setActive({session:r.createdSessionId});})()`);
}
async function footer() {
  const rect = await evaluate(`(()=>{const e=document.querySelector('[data-testid=bottom-navigation]');if(!e)return null;const r=e.getBoundingClientRect();return {top:r.top,bottom:r.bottom,left:r.left,right:r.right}})()`);
  const height = await evaluate('innerHeight');
  assert.ok(rect && rect.top > 0 && rect.bottom <= height + 1); return rect;
}
async function scrollBottom() {
  await evaluate(`(()=>{for(const e of document.querySelectorAll('*')){const s=getComputedStyle(e);if((s.overflowY==='auto'||s.overflowY==='scroll')&&e.scrollHeight>e.clientHeight)e.scrollTop=e.scrollHeight;}})()`);
}
async function screenshot(name) {
  await mkdir('generated-artifacts/afilli-profile', { recursive: true });
  const image = await call('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  await writeFile('generated-artifacts/afilli-profile/' + name + '.png', Buffer.from(image.data, 'base64'));
}
const tag = randomUUID().slice(0, 6);
try {
  const [a, b] = await Promise.all([actor('Yazar Denetimi'), actor('Okur Denetimi')]);
  const name = 'Yazar ' + tag;
  const settings = await api(a, '/social-settings');
  await api(a, '/my-profile'); await api(b, '/my-profile');
  await call('Page.enable'); await call('Runtime.enable'); await call('Network.enable');
  await call('Page.navigate', { url: 'about:blank' });
  await call('Storage.clearDataForOrigin', { origin: 'https://' + process.env.REPLIT_EXPO_DEV_DOMAIN, storageTypes: 'all' });
  await call('Emulation.setDeviceMetricsOverride', { width: 402, height: 874, deviceScaleFactor: 1, mobile: false });
  const legacy = { saved: [], library: {}, store: [], messages: [], notifications: [], name: 'Eski yerel takma ad', bio: 'Eski tanıtım',
    drafts: [{ id: 'private-a', title: 'A özel', body: 'A özel metin ' + tag, updatedAt: 1, ownerId: a.id },
      { id: 'private-b', title: 'B özel', body: 'B özel metin ' + tag, updatedAt: 1, ownerId: b.id },
      { id: 'anonymous', title: 'Ziyaretçi', body: 'Anonim metin ' + tag, updatedAt: 1 }] };
  const original = JSON.stringify(legacy);
  await call('Page.addScriptToEvaluateOnNewDocument', { source: `if(!localStorage.getItem('profile-test-seeded')){localStorage.setItem('afilli:v1',${JSON.stringify(original)});localStorage.setItem('profile-test-seeded','yes');}` });
  await go('/profile'); await wait(exists('profile-guest')); await wait(exists('instagram-official'));
  const fixed = await footer(); await scrollBottom(); assert.deepEqual(await footer(), fixed);
  if (!['media', 'chat', 'conversation'].includes(process.env.PROFILE_BROWSER_STAGE)) {
  await click('social-facebook'); await wait(exists('social-missing-sheet'));
  assert.ok(await evaluate(`document.body.innerText.includes('henüz')`));
  await evaluate(`Array.from(document.querySelectorAll('[role=button]')).find(e=>e.getAttribute('aria-label')==='Kapat').click()`);
  await evaluate(`window.__openedSocial=null;window.open=(url)=>{window.__openedSocial=url;return {closed:false,close(){}};}`);
  await click('instagram-official');
  await wait(`typeof window.__openedSocial==='string'`);
  assert.ok((await evaluate('window.__openedSocial')).includes('instagram.com/' + settings.instagramHandle));
  await call('Network.emulateNetworkConditions', { offline: true, latency: 0, downloadThroughput: 0, uploadThroughput: 0 });
  await wait('navigator.onLine===false'); await click('instagram-official');
  await wait(`document.body.innerText.includes('İnternet bağlantısı yok, tekrar dene')`);
  await call('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
  console.log('PASS guest profile, fixed footer, honest missing social links and Instagram/offline feedback');

  await login(a); await wait(exists('profile-name'));
  assert.equal(await evaluate(`document.querySelector('[data-testid=profile-name]').innerText`), 'Yazar Denetimi');
  await go('/profile-settings'); await wait(exists('settings-import')); await click('settings-import');
  await wait(exists('settings-import-confirm')); await click('settings-import-confirm'); await wait(exists('settings-import-prefill'));
  await wait(`(localStorage.getItem(${JSON.stringify('afilli:v2:' + a.id)})||'').includes('Anonim metin')`);
  const accountA = await evaluate(`JSON.parse(localStorage.getItem(${JSON.stringify('afilli:v2:' + a.id)}))`);
  assert.ok(accountA.drafts.every((draft) => draft.ownerId === a.id));
  assert.ok(!accountA.drafts.some((draft) => draft.id === 'private-b'));
  assert.equal(await evaluate(`localStorage.getItem('afilli:v1')`), original);
  await go('/profile-edit'); await wait(exists('profile-edit-nickname'));
  assert.equal(await evaluate(`document.querySelector('[data-testid=profile-edit-nickname]').value`), 'Yazar Denetimi');
  await type('profile-edit-nickname', name); await type('profile-edit-bio', 'Kalıcı tanıtım ' + tag);
  await click('profile-edit-save'); await wait(exists('profile-name'));
  await wait(`document.querySelector('[data-testid=profile-name]').innerText===${JSON.stringify(name)}`);
  assert.equal((await api(a, '/my-profile')).nickname, name);
  await screenshot('profile-402');
  assert.deepEqual(await footer(), fixed); await scrollBottom(); assert.deepEqual(await footer(), fixed);
  console.log('PASS explicit legacy import, account-owned draft recovery and real profile edit persistence');
  } else {
    if (process.env.PROFILE_BROWSER_STAGE !== 'conversation') { await login(a); await wait(exists('profile-name')); }
    const me = await api(a, '/my-profile');
    await api(a, '/my-profile', 'PATCH', { nickname: name, handle: me.handle, bio: 'Kalıcı tanıtım ' + tag, quote: '', instagram: null });
  }

  if (!['chat', 'conversation'].includes(process.env.PROFILE_BROWSER_STAGE)) {
  await go('/profile-edit'); await wait(exists('profile-edit-avatar-library'));
  await call('Page.setInterceptFileChooserDialog', { enabled: true });
  await click('profile-edit-avatar-library'); await wait(`!!document.querySelector('input[type=file]')`);
  const doc = await call('DOM.getDocument');
  const node = await call('DOM.querySelector', { nodeId: doc.root.nodeId, selector: 'input[type=file]' });
  await call('DOM.setFileInputFiles', { nodeId: node.nodeId, files: [fileURLToPath(new URL('../../afilli/assets/images/magazine/autumn-cover.webp', import.meta.url))] });
  await wait(exists('profile-edit-avatar-undo'));
  await wait(`!document.body.innerText.includes('Fotoğraf yükleniyor')`);
  await click('profile-edit-save'); await wait(exists('profile-name'));
  assert.ok((await api(a, '/my-profile')).avatar.includes('/api/profile-media/'));
  console.log('PASS actual gallery selection and account-owned profile image upload');
  }

  if (process.env.PROFILE_BROWSER_STAGE !== 'conversation') {
  await clerkClient.users.updateUserMetadata(a.id, { publicMetadata: { role: 'admin' } });
  await go('/social-admin'); await wait(exists('admin-instagram')); await wait(exists('admin-save'));
  assert.equal(await evaluate(`document.querySelector('[data-testid=admin-instagram]').value`), settings.instagramHandle);
  await go('/profile-settings'); await wait(exists('settings-sign-out')); await click('settings-sign-out');
  await wait('!!window.Clerk?.loaded&&!window.Clerk.user'); await go('/profile'); await wait(exists('profile-guest'));
  await login(b); await wait(exists('profile-name'));
  assert.equal(await evaluate(`document.querySelector('[data-testid=profile-name]').innerText`), 'Okur Denetimi');
  const accountB = await evaluate(`JSON.parse(localStorage.getItem(${JSON.stringify('afilli:v2:' + b.id)}))`);
  assert.ok(accountB.drafts.every((draft) => draft.ownerId === b.id));
  assert.ok(!accountB.drafts.some((draft) => draft.id === 'anonymous' || draft.id === 'private-a'));
  await go('/profile-edit'); await wait(exists('profile-edit-nickname'));
  assert.equal(await evaluate(`document.querySelector('[data-testid=profile-edit-nickname]').value`), 'Okur Denetimi');
  await go('/social-admin'); await wait(exists('admin-forbidden'));
  console.log('PASS genuine sign-out/account switch, private cache/form/draft isolation and admin UI access control');
  } else { await login(b); await wait(exists('profile-name')); }

  await go('/people/' + a.id); await wait(exists('public-profile-follow')); await click('public-profile-follow');
  await wait(`document.querySelector('[data-testid=public-profile-follow]').innerText.includes('Takibi Bırak')`);
  await click('profile-stat-followers'); await wait(exists('connection-' + b.id));
  await evaluate(`Array.from(document.querySelectorAll('[role=button]')).find(e=>e.getAttribute('aria-label')==='Kapat').click()`);
  await click('public-profile-message'); await wait(exists('chat-input'));
  const thread = (await api(b, '/conversations')).find((thread) => thread.peer.id === a.id);
  const text = 'UI özel mektup ' + tag;
  await type('chat-input', text); await click('chat-send');
  await wait(`document.body.innerText.includes(${JSON.stringify(text)})&&!document.body.innerText.includes('Gönderiliyor')`);
  const sent = await api(a, `/conversations/${thread.id}/messages`);
  assert.equal(sent.items.filter((message) => message.body === text).length, 1);
  const reply = 'Yazar yanıtı ' + tag;
  await api(a, `/conversations/${thread.id}/messages`, 'POST', { clientId: randomUUID(), body: reply });
  await wait(`document.body.innerText.includes(${JSON.stringify(reply)})`);
  await type('chat-input', 'Kaybolmayan taslak ' + tag); await click('tab-profile'); await wait(exists('profile-name'));
  await go('/chat/' + thread.id); await wait(exists('chat-input'));
  await wait(`document.querySelector('[data-testid=chat-input]').value===${JSON.stringify('Kaybolmayan taslak ' + tag)}`);
  await screenshot('chat-402'); assert.deepEqual(await footer(), fixed);
  await call('Emulation.setDeviceMetricsOverride', { width: 320, height: 740, deviceScaleFactor: 1, mobile: false });
  await go('/profile'); await wait(exists('profile-name')); await scrollBottom();
  assert.equal(await evaluate('document.documentElement.scrollWidth<=innerWidth'), true);
  const small = await footer(); assert.ok(small.right <= 321);
  await screenshot('profile-320');
  console.log('PASS real public profile follow/list, private send/receive, navigation-safe draft restore and 320px fixed-footer layout');
} finally {
  await call('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 }).catch(() => {});
  await evaluate('window.Clerk?.signOut()').catch(() => {});
  const ids = actors.map((actor) => actor.id);
  const uploads = (await pool.query('SELECT id FROM profile_uploads WHERE owner_id=ANY($1)', [ids])).rows;
  for (const upload of uploads) await profileObject(upload.id).delete({ ignoreNotFound: true }).catch(() => {});
  for (const [table, condition] of [
    ['social_notifications', 'recipient_id=ANY($1) OR actor_id=ANY($1)'], ['direct_messages', 'sender_id=ANY($1)'],
    ['conversations', 'user_low=ANY($1) OR user_high=ANY($1)'], ['profile_follows', 'follower_id=ANY($1) OR followed_id=ANY($1)'],
    ['profile_uploads', 'owner_id=ANY($1)'], ['community_users', 'id=ANY($1)'],
  ]) await pool.query(`DELETE FROM ${table} WHERE ${condition}`, [ids]).catch(() => {});
  for (const actor of actors) await clerkClient.users.deleteUser(actor.id).catch(() => {});
  await pool.end(); socket.close();
}
