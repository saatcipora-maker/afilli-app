import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { clerkClient } from '@clerk/express';
import { bulletinObject } from '../src/lib/bulletin-storage.ts';

// Run against a dedicated local headless Chromium with remote debugging on 9250.
// Real Clerk tickets and session tokens stay in memory and are never logged.
const requireDb = createRequire(new URL('../../../lib/db/package.json', import.meta.url));
const { Pool } = requireDb('pg'), pool = new Pool();
const target = (await (await fetch('http://127.0.0.1:9250/json')).json()).find((target) => target.type === 'page');
const socket = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve) => { socket.onopen = resolve; });
let nextId = 0, user, sessionId, post;
const waiting = new Map();
socket.onmessage = ({ data }) => {
  const message = JSON.parse(data);
  if (!message.id) return;
  const callback = waiting.get(message.id); waiting.delete(message.id);
  if (message.error) callback.reject(new Error(message.error.message)); else callback.resolve(message.result);
};
const call = (method, params = {}) => new Promise((resolve, reject) => {
  const id = ++nextId; waiting.set(id, { resolve, reject });
  socket.send(JSON.stringify({ id, method, params }));
});
async function evaluate(expression) {
  const response = await call('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true, userGesture: true });
  if (response.exceptionDetails) throw new Error(response.exceptionDetails.exception?.description?.split('\n')[0] ?? 'Browser evaluation failed');
  return response.result.value;
}
async function wait(expression, ms = 25000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await evaluate(expression)) return;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error('Browser condition timed out: ' + expression.slice(0, 160));
}
const selector = (id) => `[data-testid=${JSON.stringify(id)}]`;
const exists = (id) => `!!document.querySelector(${JSON.stringify(selector(id))})`;
const click = (id) => evaluate(`document.querySelector(${JSON.stringify(selector(id))}).click()`);
async function type(id, value) {
  await evaluate(`(() => {
    const element=document.querySelector(${JSON.stringify(selector(id))});
    const proto=element.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto,'value').set.call(element,${JSON.stringify(value)});
    element.dispatchEvent(new Event('input',{bubbles:true}));
  })()`);
}
async function api(path, method = 'GET', body) {
  const token = (await clerkClient.sessions.getToken(sessionId)).jwt;
  const response = await fetch('http://localhost:80/api' + path, {
    method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  assert.ok(response.ok, `${method} ${path}: ${response.status}`);
  return response.status === 204 ? null : response.json();
}
async function footer() {
  assert.equal(await evaluate(`(() => {const e=document.querySelector('[data-testid=bottom-navigation]');if(!e)return false;const r=e.getBoundingClientRect();return r.top>=0&&r.bottom<=innerHeight+1})()`), true);
}
const tag = 'Tarayıcı denetimi ' + randomUUID();
const go = (path) => call('Page.navigate', { url: 'https://' + process.env.REPLIT_EXPO_DEV_DOMAIN + path });
try {
  await call('Page.enable'); await call('Runtime.enable');
  await call('Emulation.setDeviceMetricsOverride', { width: 402, height: 874, deviceScaleFactor: 1, mobile: false });
  await go('/bultenler');
  await wait(exists('bulletin-composer')); await footer();
  assert.ok(await evaluate(`document.body.innerText.includes('Paylaşmak için giriş yap')`));
  user = await clerkClient.users.createUser({
    emailAddress: [`afilli-browser-${randomUUID()}@example.com`], firstName: 'Tarayıcı Yazarı', skipPasswordRequirement: true,
  });
  const ticket = await clerkClient.signInTokens.createSignInToken({ userId: user.id, expiresInSeconds: 120 });
  sessionId = await evaluate(`(async()=>{const result=await window.Clerk.client.signIn.create({strategy:'ticket',ticket:${JSON.stringify(ticket.token)}});if(result.status!=='complete')throw new Error('Test login incomplete');await window.Clerk.setActive({session:result.createdSessionId});return result.createdSessionId})()`);
  await wait(exists('composer-publish')); await footer();
  if (process.env.BULLETIN_BROWSER_STAGE !== 'book') {
  await click('composer-publish');
  await wait(`document.body.innerText.includes('Önce yazını yaz')`);
  await type('composer-input', 'x'.repeat(1100));
  await wait(`document.body.innerText.includes('1000 / 1000')`);
  await type('composer-input', tag + ' taslak');
  await wait(`Object.entries(localStorage).some(([k,v])=>k.includes('afilli:bulletin-draft:')&&v.includes(${JSON.stringify(tag)}))`);
  await go('/bultenler'); await wait(exists('composer-publish'));
  await wait(`document.querySelector('[data-testid=composer-input]').value===${JSON.stringify(tag + ' taslak')}`);
  await click('composer-publish');
  await wait(`document.querySelector('[data-testid=composer-input]').value===''`);
  let feed = await api('/bulletins');
  post = feed.items.find((post) => post.author.id === user.id && post.body === tag + ' taslak');
  assert.ok(post);
  await wait(exists('bulletin-' + post.id));
  console.log('PASS: real browser sign-in, empty/length validation, draft restart recovery and actual publication');

  await click('like-' + post.id);
  await wait(`document.querySelector(${JSON.stringify(selector('like-' + post.id))}).getAttribute('aria-pressed')==='true'`);
  await click('react-' + post.id);
  await wait(exists('reaction-picker')); await click('react-😂');
  await wait(exists('bucket-😂'));
  await click('comments-' + post.id);
  await wait(exists('root-comment-input'));
  await type('root-comment-input', tag + ' yorum');
  await click('root-comment-send');
  await wait(`document.body.innerText.includes(${JSON.stringify(tag + ' yorum')})`);
  assert.equal((await api(`/bulletins/${post.id}`)).commentCount, 1);
  await footer();
  console.log('PASS: browser like, reaction picker, real comment submission and fixed footer on detail');

  await go('/bultenler'); await wait(exists('composer-publish'));
  await type('composer-input', tag + ' fotoğraf');
  await click('mode-photo'); await wait(exists('photo-source'));
  await call('Page.setInterceptFileChooserDialog', { enabled: true });
  const pickerEvent = new Promise((resolve) => {
    const old = socket.onmessage;
    socket.onmessage = (event) => {
      const message = JSON.parse(event.data);
      if (message.method === 'Page.fileChooserOpened') { socket.onmessage = old; resolve(message.params); }
      else old(event);
    };
  });
  await click('photo-gallery');
  const picker = await pickerEvent;
  const photo = fileURLToPath(new URL('../../afilli/assets/images/magazine/autumn-cover.webp', import.meta.url));
  await call('DOM.setFileInputFiles', { backendNodeId: picker.backendNodeId, files: [photo] });
  await wait(exists('remove-photo-0'));
  await wait(`(()=>{const image=document.querySelector('[aria-label="Seçilen fotoğraf 1"] img');return image?.complete&&image.naturalWidth>0})()`);
  assert.ok(await evaluate(`document.querySelector('[aria-label="Seçilen fotoğraf 1"] img').src.startsWith('blob:')`));
  await click('composer-publish');
  await wait(`document.querySelector('[data-testid=composer-input]').value===''`, 45000);
  feed = await api('/bulletins');
  const photoPost = feed.items.find((post) => post.author.id === user.id && post.body === tag + ' fotoğraf');
  assert.equal(photoPost?.photos.length, 1);
  console.log('PASS: actual browser gallery selection, local photo preview and full App Storage upload/publication');
  } else {
    post = await api('/bulletins', 'POST', { clientId: randomUUID(), body: tag + ' silme denetimi', photoIds: [] });
  }

  const book = await api('/authored-books', 'POST', { localId: randomUUID(), title: 'Gerçek Kitap Denetimi', body: 'Kitabın gerçek bölüm metni.' });
  await click('mode-book'); await wait(exists('book-picker'));
  await wait(exists('pick-book-' + book.id)); await click('pick-book-' + book.id);
  await wait(`!!document.querySelector('[aria-label="Kitabı kaldır"]')`); await type('composer-input', tag + ' kitap');
  await click('composer-publish'); await wait(`document.querySelector('[data-testid=composer-input]').value===''`);
  await wait(exists('bulletin-book-' + book.id)); await click('bulletin-book-' + book.id);
  await wait(`document.body.innerText.includes('Kitabın gerçek bölüm metni.')`); await footer();
  console.log('PASS: own-book picker, actual book sharing and readable book detail');

  await go('/bultenler'); await wait(exists('bulletin-' + post.id));
  const before = await evaluate(`document.querySelector('[data-testid=bottom-navigation]').getBoundingClientRect().top`);
  await evaluate(`(()=>{const e=[...document.querySelectorAll('div')].find(e=>e.scrollHeight>e.clientHeight+80&&e.clientHeight>100&&/auto|scroll/.test(getComputedStyle(e).overflowY));if(e)e.scrollTop=e.scrollHeight})()`);
  await footer();
  assert.equal(await evaluate(`document.querySelector('[data-testid=bottom-navigation]').getBoundingClientRect().top`), before);
  await call('Emulation.setDeviceMetricsOverride', { width: 320, height: 874, deviceScaleFactor: 1, mobile: false });
  assert.equal(await evaluate(`document.documentElement.scrollWidth<=innerWidth+1`), true);
  await call('Emulation.setDeviceMetricsOverride', { width: 402, height: 874, deviceScaleFactor: 1, mobile: false });
  await click('bulletin-menu-' + post.id);
  await click('bulletin-delete');
  await wait(exists('confirm-delete')); await click('confirm-delete');
  await wait(`!document.querySelector(${JSON.stringify(selector('bulletin-' + post.id))})`);
  console.log('PASS: persistent fixed footer, 320px width and confirmed real deletion');
} catch (error) {
  console.error('Visible page at failure:', await evaluate('document.body.innerText.slice(0,2400)').catch(() => 'unavailable'));
  throw error;
} finally {
  if (user) {
    const rows = (await pool.query('SELECT id FROM bulletin_uploads WHERE owner_id=$1', [user.id])).rows;
    await pool.query(`DELETE FROM bulletin_reactions WHERE user_id=$1 OR target_id IN
      (SELECT id FROM bulletins WHERE author_id=$1 UNION SELECT id FROM bulletin_comments WHERE author_id=$1)`, [user.id]);
    await pool.query('DELETE FROM bulletins WHERE author_id=$1', [user.id]);
    await pool.query('DELETE FROM authored_books WHERE author_id=$1', [user.id]);
    await pool.query('DELETE FROM bulletin_uploads WHERE owner_id=$1', [user.id]);
    await pool.query('DELETE FROM community_users WHERE id=$1', [user.id]);
    for (const { id } of rows) await bulletinObject(id).delete({ ignoreNotFound: true }).catch(() => {});
    await evaluate(`window.Clerk?.signOut()`).catch(() => {});
    await clerkClient.users.deleteUser(user.id);
  }
  await pool.end(); socket.close();
}
