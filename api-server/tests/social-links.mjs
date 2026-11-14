import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { transform } from 'esbuild';
const events = [], errors = [];
let installed = true, visible = true, blocked = false;
const native = { Platform: { OS: 'ios' }, Linking: {
  canOpenURL: async (url) => { events.push(['check', url]); return visible; },
  openURL: async (url) => { events.push(['open', url]); if (url.startsWith('instagram:') && !installed) throw new Error('Not installed'); },
} };
const proxy = { opener: {}, location: { replace: (url) => events.push(['tab', url]) } };
globalThis.window = {
  open: (url) => { events.push(['window', url]); return blocked ? null : proxy; },
  location: { assign: (url) => events.push(['same-tab', url]) },
};
const code = (await transform(await readFile(new URL('../../afilli/lib/social-links.ts', import.meta.url), 'utf8'), { loader: 'ts', format: 'cjs' })).code;
const module = { exports: {} };
new Function('require', 'module', 'exports', code)(() => native, module, module.exports);
const { openInstagram, instagramAppUrl, instagramWebUrl, OFFLINE_MESSAGE } = module.exports;
const handle = 'writer.test';
const tick = () => new Promise((resolve) => setImmediate(resolve));
for (const platform of ['ios', 'android']) {
  native.Platform.OS = platform;
  for (const present of [true, false]) {
    installed = present; visible = present; events.length = 0;
    openInstagram(handle, false, (error) => errors.push(error)); await tick();
    assert.equal(events[0][0], 'check');
    assert.equal(events.at(-1)[1], present ? instagramAppUrl(handle) : instagramWebUrl(handle));
  }
  installed = true; visible = false; events.length = 0;
  openInstagram(handle, false, (error) => errors.push(error)); await tick();
  assert.equal(events.at(-1)[1], instagramAppUrl(handle));
}
events.length = 0; openInstagram(handle, true, (error) => errors.push(error));
assert.equal(events.length, 0); assert.equal(errors.at(-1), OFFLINE_MESSAGE);
native.Platform.OS = 'web'; events.length = 0;
openInstagram(handle, false, () => {}); assert.equal(proxy.opener, null);
assert.deepEqual(events, [['window', 'about:blank'], ['tab', instagramWebUrl(handle)]]);
blocked = true; events.length = 0; openInstagram(handle, false, () => {});
assert.deepEqual(events.at(-1), ['same-tab', instagramWebUrl(handle)]);
console.log('PASS native Instagram installed/missing/restricted-visibility branches, exact offline feedback and single safe web navigation');
