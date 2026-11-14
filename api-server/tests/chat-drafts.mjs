import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { transform } from 'esbuild';
const memory = new Map();
let failWrite = false;
const storage = {
  getItem: async (key) => memory.get(key) ?? null,
  setItem: async (key, value) => { if (failWrite) throw new Error('Storage unavailable'); memory.set(key, value); },
  removeItem: async (key) => { if (failWrite) throw new Error('Storage unavailable'); memory.delete(key); },
};
const source = await readFile(new URL('../../afilli/lib/chat-drafts.ts', import.meta.url), 'utf8');
const code = (await transform(source, { loader: 'ts', format: 'cjs' })).code;
const module = { exports: {} };
new Function('require', 'module', 'exports', code)(() => storage, module, module.exports);
const { chatDraftKey, readChatDraft, saveDraftBody, enqueueOutbox, ackOutbox, parseChatDraft } = module.exports;
const p = { clientId: randomUUID(), body: 'İlk mektup' }, q = { clientId: randomUUID(), body: 'İkinci mektup' };
await saveDraftBody('A', 'thread', p.body);
await enqueueOutbox('A', 'thread', p, () => '');
assert.deepEqual((await readChatDraft('A', 'thread')).outbox, [p]);
assert.deepEqual(await readChatDraft('B', 'thread'), { body: '', outbox: [] });
await Promise.all([saveDraftBody('A', 'thread', 'Yeni taslak'), enqueueOutbox('A', 'thread', q, () => 'Yeni taslak'), ackOutbox('A', 'thread', p.clientId)]);
assert.deepEqual(await readChatDraft('A', 'thread'), { body: 'Yeni taslak', outbox: [q] });
await enqueueOutbox('A', 'thread', q, () => 'Daha yeni taslak');
assert.equal((await readChatDraft('A', 'thread')).outbox.length, 1);
failWrite = true;
await assert.rejects(ackOutbox('A', 'thread', q.clientId));
assert.equal((await readChatDraft('A', 'thread')).outbox[0].clientId, q.clientId);
failWrite = false;
await ackOutbox('A', 'thread', q.clientId);
assert.equal((await readChatDraft('A', 'thread')).body, 'Daha yeni taslak');
for (const raw of ['{broken', '[]', '{"body":12}', '{"body":"","outbox":"bad"}', '{"body":"","outbox":[{"clientId":"x","body":"y"}]}']) {
  memory.set(chatDraftKey('A', 'thread'), raw);
  await assert.rejects(saveDraftBody('A', 'thread', ''));
  assert.equal(memory.get(chatDraftKey('A', 'thread')), raw);
}
assert.deepEqual(parseChatDraft(JSON.stringify({ body: 'Eski biçim', failed: [p] })), { body: 'Eski biçim', outbox: [p] });
console.log('PASS durable outbox, stable retry IDs, concurrent body/send/ack safety, owner isolation, write failures and strict non-destructive restore');
