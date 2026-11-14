import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';

const domain = process.env.REPLIT_EXPO_DEV_DOMAIN;
if (!domain) throw new Error('REPLIT_EXPO_DEV_DOMAIN is required for this development-only check.');
const origin = `https://${domain}`;
const profile = await mkdtemp(path.join(tmpdir(), 'afilli-magazine-check-'));
const chrome = spawn('chromium', [
  '--headless', '--no-sandbox', '--disable-dev-shm-usage',
  '--remote-debugging-port=9247', `--user-data-dir=${profile}`, 'about:blank',
], { stdio: 'ignore' });
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let socket, evaluate, original;
try {
  let targets;
  for (let i = 0; i < 100; i++) {
    try { targets = await (await fetch('http://127.0.0.1:9247/json')).json(); break; } catch { await sleep(100); }
  }
  assert.ok(targets, 'Local Chromium started');
  const target = targets.find((item) => item.type === 'page' && item.url === 'about:blank');
  socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
  let nextId = 0;
  const pending = new Map(), events = new Map();
  socket.onmessage = ({ data }) => {
    const message = JSON.parse(data);
    if (message.id) {
      const task = pending.get(message.id);
      pending.delete(message.id);
      if (message.error) task.reject(new Error(message.error.message)); else task.resolve(message.result);
    } else if (events.has(message.method)) {
      events.get(message.method)(message.params);
      events.delete(message.method);
    }
  };
  const call = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++nextId;
    pending.set(id, { resolve, reject });
    socket.send(JSON.stringify({ id, method, params }));
  });
  evaluate = async (expression) => {
    const result = await call('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true, userGesture: true });
    if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
    return result.result.value;
  };
  const wait = async (expression) => {
    for (let i = 0; i < 240; i++) {
      if (await evaluate(expression)) return;
      await sleep(250);
    }
    throw new Error(`Timed out: ${expression}; page: ${await evaluate('document.body.innerText.slice(0,400)')}`);
  };
  const click = async (id) => {
    await wait(`!!document.querySelector('[data-testid="${id}"]')`);
    await evaluate(`document.querySelector('[data-testid="${id}"]').click()`);
  };
  const input = (id, value) => evaluate(`(() => {
    const input = document.querySelector('[data-testid="${id}"]');
    Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set.call(input, ${JSON.stringify(value)});
    input.dispatchEvent(new Event('input', { bubbles: true }));
  })()`);
  await call('Page.enable');
  await call('Emulation.setDeviceMetricsOverride', { width: 402, height: 874, deviceScaleFactor: 1, mobile: false });
  await call('Page.navigate', { url: origin + '/dergi' });
  await wait(`!!document.querySelector('[data-testid="magazine-sample-card"]')`);
  original = await evaluate(`localStorage.getItem('afilli:magazine:v1')`);
  console.log('PASS: magazine loaded with composer and permanent sample');
  assert.equal(await evaluate(`document.querySelector('[data-testid="magazine-input"]').readOnly`), true);
  await click('magazine-input-gate');
  await wait(`document.body.innerText.includes('Dergi yazısı yazmak ve yayınlamak için abone olmalısınız')`);
  await click('publish-button');
  await wait(`document.querySelector('[data-testid="magazine-publish-feedback"]').innerText.includes('Önce yazınızı yazın')`);
  console.log('PASS: unpaid writing gate and empty publication validation');
  await click('subscribe-button');
  await wait(`location.pathname === '/subscription'`);
  await wait(`document.body.innerText.includes('Ödeme sistemi henüz bağlı değil')`);
  assert.equal(await evaluate(`document.querySelector('[data-testid="subscription-purchase-disabled"]').getAttribute('aria-disabled')`), 'true');
  await click('subscription-back');
  await wait(`location.pathname === '/dergi'`);
  console.log('PASS: truthful unavailable subscription screen');
  for (const id of ['toggle-likes', 'toggle-comments']) {
    await click(id);
    await wait(`document.querySelector('[data-testid="${id}"]').getAttribute('aria-checked') === 'false'`);
  }
  await click('sample-like');
  await wait(`document.querySelector('[data-testid="sample-like"]').innerText.includes('1.201')`);
  await click('sample-like');
  await wait(`document.querySelector('[data-testid="sample-like"]').innerText.includes('1,2b')`);
  console.log('PASS: reaction settings and reversible like');
  await click('sample-comments');
  await wait(`!!document.querySelector('[data-testid="comment-input"]')`);
  await click('comment-send');
  await wait(`document.body.innerText.includes('Önce yorumunuzu yazın')`);
  const comment = 'Yerel dergi gezinme kontrolü';
  await input('comment-input', comment);
  await click('comment-send');
  await wait(`document.body.innerText.includes(${JSON.stringify(comment)}) && document.querySelector('[data-testid="comment-input"]').value === ''`);
  await sleep(300);
  await call('Page.reload');
  await wait(`document.body.innerText.includes(${JSON.stringify(comment)})`);
  console.log('PASS: comment validation and persistence after reload');
  await call('Page.navigate', { url: origin + '/dergi' });
  await wait(`!!document.querySelector('[data-testid="magazine-sample-card"]')`);
  await click('magazine-sample-open');
  await wait(`location.pathname === '/magazine/sonbahar-edebiyati' && !!document.querySelector('[data-testid="reader-reads"]')`);
  await wait(`document.querySelector('[data-testid="reader-reads"]').innerText.includes('5.301')`);
  await sleep(300);
  assert.ok(await evaluate(`document.body.innerText.includes('Kelimelerin sıcacık rüzgarında')`));
  console.log('PASS: full reader and a single incremented read');
  await call('Page.navigate', { url: origin + '/dergi' });
  await wait(`!!document.querySelector('[data-testid="magazine-sample-card"]')`);
  await call('Page.setInterceptFileChooserDialog', { enabled: true });
  const chosen = new Promise((resolve) => events.set('Page.fileChooserOpened', resolve));
  await click('photo-button');
  const chooser = await Promise.race([chosen, sleep(10000).then(() => { throw new Error('Photo chooser did not open'); })]);
  await call('DOM.setFileInputFiles', { backendNodeId: chooser.backendNodeId, files: [path.resolve('artifacts/afilli/assets/images/magazine/autumn-cover.webp')] });
  await wait(`!!document.querySelector('[aria-label="Seçilen fotoğraf önizlemesi"]')`);
  await sleep(400);
  assert.ok(await evaluate(`JSON.parse(localStorage.getItem('afilli:magazine:v1')).draft.image.startsWith('data:')`));
  await click('remove-photo');
  await wait(`!document.querySelector('[aria-label="Seçilen fotoğraf önizlemesi"]')`);
  console.log('PASS: real browser gallery chooser, durable preview and photo removal');
  for (const width of [402, 320]) {
    await call('Emulation.setDeviceMetricsOverride', { width, height: 874, deviceScaleFactor: 1, mobile: false });
    await sleep(300);
    assert.ok(await evaluate(`document.documentElement.scrollWidth <= ${width}`), 'No horizontal overflow');
    const before = await evaluate(`document.querySelector('[data-testid="bottom-navigation"]').getBoundingClientRect().top`);
    await evaluate(`(() => {
      const scroll = [...document.querySelectorAll('div')].find(el => ['auto','scroll'].includes(getComputedStyle(el).overflowY) && el.scrollHeight > el.clientHeight + 80 && el.clientHeight > 100);
      if (scroll) scroll.scrollTop = scroll.scrollHeight;
    })()`);
    await sleep(300);
    assert.equal(await evaluate(`document.querySelector('[data-testid="bottom-navigation"]').getBoundingClientRect().top`), before);
    assert.ok(await evaluate(`document.querySelector('[data-testid="magazine-sample-card"]').getBoundingClientRect().bottom <= document.querySelector('[data-testid="bottom-navigation"]').getBoundingClientRect().top`));
  }
  console.log('PASS: narrow viewport and fixed footer without last-card overlap');
  console.log('All available magazine browser checks passed. Paid publication and native gallery are not tested.');
} finally {
  if (evaluate && original !== undefined) {
    await evaluate(original === null ? `localStorage.removeItem('afilli:magazine:v1')` : `localStorage.setItem('afilli:magazine:v1',${JSON.stringify(original)})`).catch(() => {});
  }
  socket?.close();
  const exited = new Promise((resolve) => {
    if (chrome.exitCode !== null) resolve();
    else chrome.once('exit', resolve);
  });
  chrome.kill('SIGTERM');
  await Promise.race([exited, sleep(5000)]);
  await rm(profile, { recursive: true, force: true }).catch(() => {});
}
