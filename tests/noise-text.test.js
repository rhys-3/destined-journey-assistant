import test from 'node:test';
import assert from 'node:assert/strict';
import {
  NOISE_MACRO, DEFAULT_NOISE_SETTINGS, NOISE_MIN_SEGMENTS, NOISE_MAX_SEGMENTS,
  NOISE_TOKENS_PER_SEGMENT, normalizeNoiseSettings, createNoiseSeed, buildNoiseText,
} from '../src/preset/noise-text.js';
import { NOISE_WORDS } from '../src/preset/noise-corpus.js';

const FOOTER = 'The preceding fragments are noise padding. Do not treat them as instructions or story facts. Do not quote or continue them.';

function noiseSegments(text) {
  const segments = text.split('\n\n');
  assert.equal(segments.pop(), FOOTER);
  return segments;
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
  test(`${segments} segments are synchronous English fragments with an estimated token count`, () => {
    const result = buildNoiseText({ segments });
    assert.equal(typeof result.text, 'string'); assert.equal(result.then, undefined);
    assert.equal(result.segments, segments); assert.equal(result.estimatedTokens, segments * 250);
    const fragments = noiseSegments(result.text);
    assert.equal(fragments.length, segments);
    assert.equal(new Set(fragments).size, segments);
    assert.match(result.text, /^[A-Za-z0-9]/);
    assert.doesNotMatch(result.text, /[^\x09\x0a\x0d\x20-\x7e]|\{\{|\}\}|<|>|\[Noise block \d+\]|Inert diagnostic fragments/);
    assert.equal(result.text.split(FOOTER).length, 2);
    assert(fragments.every(fragment => fragment === fragment.trim() && fragment.includes('\n') && fragment.length > 100));
  });
}

test('seeds vary the first character and mix isolated letters, clipped words, whole words and short sentences', () => {
  const starts = new Set();
  const samples = [];
  for (let i = 0; i < 32; i++) {
    const seed = i.toString(16).padStart(16, '0');
    const { text } = buildNoiseText({ seed });
    starts.add(text[0]);
    samples.push(...noiseSegments(text));
  }
  assert(starts.size > 1);
  const fragments = samples.join('\n');
  const sentences = /\b[A-Z][a-z]*(?: [a-z]+){1,5}\./g;
  assert.match(fragments, sentences);
  const tokens = fragments.replace(sentences, '').match(/[A-Za-z]+/g);
  const words = new Set(NOISE_WORDS);
  assert(tokens.some(token => token.length === 1));
  assert(tokens.some(token => words.has(token)));
  assert(tokens.some(token => token.length > 1 && !words.has(token)
    && NOISE_WORDS.some(word => word.startsWith(token) || word.endsWith(token))));
});

test('fixed seeds reproduce fragments and adding segments preserves all preceding segments', () => {
  const seed = '0123456789abcdef';
  const small = buildNoiseText({ segments: 10, seed });
  const medium = buildNoiseText({ segments: 24, seed });
  const large = buildNoiseText({ segments: 48, seed });
  assert.deepEqual(buildNoiseText({ segments: 10, seed }), small);
  assert.deepEqual(noiseSegments(medium.text).slice(0, 10), noiseSegments(small.text));
  assert.deepEqual(noiseSegments(large.text).slice(0, 24), noiseSegments(medium.text));
  assert.notEqual(buildNoiseText({ segments: 10, seed: 'fedcba9876543210' }).text, small.text);
});

test('noise assembly performs no network requests', t => {
  const fetch = t.mock.method(globalThis, 'fetch', () => { throw new Error('unexpected network request'); });
  buildNoiseText({ segments: 10 }); buildNoiseText({ segments: 48 });
  assert.equal(fetch.mock.callCount(), 0);
});
