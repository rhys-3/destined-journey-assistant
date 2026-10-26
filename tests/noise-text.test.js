import test from 'node:test';
import assert from 'node:assert/strict';
import {
  NOISE_MACRO, DEFAULT_NOISE_SETTINGS, NOISE_MIN_SEGMENTS, NOISE_MAX_SEGMENTS,
  NOISE_TOKENS_PER_SEGMENT, normalizeNoiseSettings, createNoiseSeed, buildNoiseText,
} from '../src/preset/noise-text.js';

function blocks(text) {
  return [...text.matchAll(/\[Noise block \d{2}\]\n([\s\S]*?)(?=\n\[Noise block \d{2}\]|\n<\/noise_padding>|$)/g)].map(match => match[1].trim());
}

test('segment settings default off and expose only the supported fields', () => {
  assert.equal(NOISE_MACRO, '{{destined_prompt_noise}}');
  assert.equal(NOISE_MIN_SEGMENTS, 10); assert.equal(NOISE_MAX_SEGMENTS, 48);
  assert.equal(NOISE_TOKENS_PER_SEGMENT, 250);
  assert.deepEqual(normalizeNoiseSettings(), DEFAULT_NOISE_SETTINGS);
  assert.deepEqual(normalizeNoiseSettings({ enabled: 'true', segments: 1, mode: 'bad', seed: '{{unsafe}}', secret: 'omit' }), DEFAULT_NOISE_SETTINGS);
  assert.deepEqual(normalizeNoiseSettings({ enabled: true, segments: 100, mode: 'random', seed: 'ABCDEF0123456789' }), {
    enabled: true, segments: 48, mode: 'random', seed: 'abcdef0123456789',
  });
  assert.equal(normalizeNoiseSettings({ segments: 20.7 }).segments, 21);
  assert.equal(normalizeNoiseSettings({ segments: Infinity }).segments, 10);
});

test('legacy token settings migrate to bounded segments and the new setting takes precedence', () => {
  for (const [tokens, segments] of [[2500, 10], [6000, 24], [12000, 48], [1, 10], [20000, 48], [6375, 26]]) {
    assert.equal(normalizeNoiseSettings({ tokens }).segments, segments);
  }
  assert.equal(normalizeNoiseSettings({ segments: 12, tokens: 12000 }).segments, 12);
  assert(!Object.hasOwn(normalizeNoiseSettings({ tokens: 6000 }), 'tokens'));
});

test('seed generation uses native secure randomness without randomUUID', () => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'crypto');
  try {
    Object.defineProperty(globalThis, 'crypto', { configurable: true, value: {
      getRandomValues(bytes) { bytes.set([0, 1, 2, 3, 252, 253, 254, 255]); return bytes; },
    } });
    assert.equal(createNoiseSeed(), '00010203fcfdfeff');
    Object.defineProperty(globalThis, 'crypto', { configurable: true, value: {} });
    assert.throws(() => createNoiseSeed(), /getRandomValues/);
  } finally {
    if (descriptor) Object.defineProperty(globalThis, 'crypto', descriptor);
    else delete globalThis.crypto;
  }
});

for (const segments of [10, 24, 48]) {
  test(`${segments} segments are synchronous English log text with an explicitly estimated token count`, () => {
    const result = buildNoiseText({ segments });
    assert.equal(typeof result.text, 'string'); assert.equal(result.then, undefined);
    assert.equal(result.segments, segments); assert.equal(result.estimatedTokens, segments * 250);
    assert.equal(blocks(result.text).length, segments);
    assert.equal(new Set(blocks(result.text)).size, segments);
    assert.match(result.text, /\[Noise block 01\]/);
    assert.doesNotMatch(result.text, /[^\x09\x0a\x0d\x20-\x7e]|\{\{|\}\}|<%|%>|命定/);
    assert(blocks(result.text).every(block => /[A-Za-z]{4,}/.test(block) && block.length > 100));
  });
}

test('fixed seeds reproduce logs and adding segments preserves all preceding blocks', () => {
  const seed = '0123456789abcdef';
  const small = buildNoiseText({ segments: 10, seed });
  const medium = buildNoiseText({ segments: 24, seed });
  const large = buildNoiseText({ segments: 48, seed });
  assert.deepEqual(buildNoiseText({ segments: 10, seed }), small);
  assert.deepEqual(blocks(medium.text).slice(0, 10), blocks(small.text));
  assert.deepEqual(blocks(large.text).slice(0, 24), blocks(medium.text));
  assert.notEqual(buildNoiseText({ segments: 10, seed: 'fedcba9876543210' }).text, small.text);
});

test('log assembly performs no network requests', t => {
  const fetch = t.mock.method(globalThis, 'fetch', () => { throw new Error('unexpected network request'); });
  buildNoiseText({ segments: 10 }); buildNoiseText({ segments: 48 });
  assert.equal(fetch.mock.callCount(), 0);
});
