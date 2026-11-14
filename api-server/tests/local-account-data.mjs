import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { transform } from 'esbuild';

const memory = new Map();
let rejectWrites = false;
const storage = {
  getItem: async (key) => memory.get(key) ?? null,
  setItem: async (key, value) => { if (rejectWrites) throw new Error('Device storage unavailable'); memory.set(key, value); },
};
const source = await readFile(new URL('../../afilli/lib/local-account-data.ts', import.meta.url), 'utf8');
const code = (await transform(source, { loader: 'ts', format: 'cjs' })).code;
const module = { exports: {} };
new Function('require', 'module', 'exports', code)((name) => {
  assert.equal(name, '@react-native-async-storage/async-storage'); return storage;
}, module, module.exports);
const { loadLocalAccount, legacyToImport, mergeLegacy, localKey } = module.exports;
const initial = { saved: [], library: {}, drafts: [], store: [], messages: [], notifications: [], name: 'Okur', bio: '' };
const draft = (id, ownerId, body = id) => ({ id, ownerId, title: id, body, updatedAt: 1 });
const legacy = { ...initial, name: 'Eski takma ad', bio: 'Yerel tanıtım', saved: ['book-1'], library: { 'book-1': 3 },
  drafts: [draft('a-private', 'A'), draft('b-private', 'B'), draft('anonymous')] };
const original = JSON.stringify(legacy);
memory.set('afilli:v1', original);
const guest = await loadLocalAccount(null, initial);
assert.deepEqual(guest.state.drafts.map((d) => d.id), ['anonymous']);
memory.set(localKey(null), JSON.stringify({ ...guest.state, drafts: [draft('anonymous', undefined, 'En son ziyaretçi düzenlemesi')] }));
const a = await loadLocalAccount('A', initial), b = await loadLocalAccount('B', initial);
assert.deepEqual(a.state.drafts.map((d) => d.id), ['a-private']);
assert.deepEqual(b.state.drafts.map((d) => d.id), ['b-private']);
assert.equal(a.state.saved.length, 0); assert.equal(a.legacyAvailable, true);
const imported = await legacyToImport('A', initial);
assert.ok(!imported.drafts.some((d) => d.ownerId === 'B'));
assert.equal(imported.drafts.find((d) => d.id === 'anonymous').body, 'En son ziyaretçi düzenlemesi');
const newest = { ...a.state, drafts: [draft('a-private', 'A', 'Yeni hesap düzenlemesi')] };
const merged = mergeLegacy(newest, imported);
assert.equal(merged.drafts.find((d) => d.id === 'a-private').body, 'Yeni hesap düzenlemesi');
assert.ok(merged.drafts.every((d) => d.ownerId === 'A'));
// Simulate a crash before the final account-key write: the claim restores A only.
const recovered = await loadLocalAccount('A', initial);
assert.equal(recovered.state.legacyImported, true); assert.ok(recovered.state.saved.includes('book-1'));
const afterGuest = await loadLocalAccount(null, initial);
assert.equal(afterGuest.state.drafts.length, 0); assert.equal(afterGuest.state.saved.length, 0);
assert.equal((await loadLocalAccount('B', initial)).legacyAvailable, false);
await assert.rejects(legacyToImport('B', initial));
assert.equal(memory.get('afilli:v1'), original);
memory.set(localKey('A'), '{broken');
await assert.rejects(loadLocalAccount('A', initial));
assert.equal(memory.get(localKey('A')), '{broken');
memory.clear(); memory.set('afilli:v1', original); rejectWrites = true;
await assert.rejects(legacyToImport('A', initial));
assert.equal(memory.get('afilli:v1'), original); assert.equal(memory.has('afilli:legacy-owner:v1'), false);
rejectWrites = false;
const race = await Promise.allSettled([legacyToImport('A', initial), legacyToImport('B', initial)]);
assert.equal(race.filter((r) => r.status === 'fulfilled').length, 1);
memory.clear(); memory.set(localKey(null), JSON.stringify({ ...initial, saved: ['guest-book'] }));
assert.equal((await loadLocalAccount('A', initial)).legacyAvailable, true);
console.log('PASS account-bound restoration, latest drafts, explicit atomic import, cross-account/guest privacy, crash recovery, corruption/write failure and concurrent claim safety');
