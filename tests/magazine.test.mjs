import test from 'node:test';
import assert from 'node:assert/strict';
import {
  countMagazineWords, limitMagazineText, validateMagazinePublication,
  formatMagazineCount, SAMPLE_MAGAZINE, SAMPLE_MAGAZINE_ID,
} from '../data/magazine.ts';

test('counts Unicode text and ignores empty whitespace', () => {
  assert.equal(countMagazineWords(' \n\t '), 0);
  assert.equal(countMagazineWords('İlk\u00a0satır.\nİkinci\tkelime'), 4);
});

test('preserves a draft below the word limit', () => {
  const text = '  Sonbahar\n\nkelimeleri  ';
  assert.deepEqual(limitMagazineText(text), { text, count: 2, limited: false });
});

test('accepts exactly 3000 words and marks the limit reached', () => {
  const text = Array(3000).fill('kelime').join(' ');
  assert.deepEqual(limitMagazineText(text), { text, count: 3000, limited: true });
  assert.deepEqual(validateMagazinePublication(text, true), { ok: true });
});

test('clamps a large paste to 3000 complete words', () => {
  const text = Array(3100).fill('İstanbul').join('\n');
  const result = limitMagazineText(text);
  assert.equal(result.count, 3000);
  assert.equal(result.limited, true);
  assert.equal(countMagazineWords(result.text), 3000);
  assert.equal(result.text, Array(3000).fill('İstanbul').join('\n'));
});

test('rejects empty publication with the requested message', () => {
  assert.deepEqual(validateMagazinePublication(' \n ', false), { ok: false, error: 'Önce yazınızı yazın' });
});

test('cannot publish without a verified subscription', () => {
  assert.equal(validateMagazinePublication('Bir dergi yazısı.', false).ok, false);
});

test('also validates the limit at publication', () => {
  assert.deepEqual(validateMagazinePublication(Array(3001).fill('kelime').join(' '), true), { ok: false, error: 'Limit doldu' });
});

test('keeps the permanent sample and requested initial count labels', () => {
  assert.equal(SAMPLE_MAGAZINE.id, SAMPLE_MAGAZINE_ID);
  assert.equal(formatMagazineCount(1200), '1,2b');
  assert.equal(formatMagazineCount(5300), '5,3b');
  assert.equal(formatMagazineCount(234), '234');
});
