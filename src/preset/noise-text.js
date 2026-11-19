import { NOISE_WORDS, NOISE_SUBJECTS, NOISE_PREDICATES } from './noise-corpus.js';

export const NOISE_MACRO = '{{destined_prompt_noise}}';
export const NOISE_MIN_SEGMENTS = 10;
export const NOISE_MAX_SEGMENTS = 48;
export const NOISE_TOKENS_PER_SEGMENT = 250;

export const DEFAULT_NOISE_SETTINGS = Object.freeze({
  enabled: false,
  segments: NOISE_MIN_SEGMENTS,
  mode: 'fixed',
  seed: '93b72a5dc184e60f',
});

export function normalizeNoiseSettings(value) {
  const source = value && typeof value === 'object' ? value : {};
  // Keep the approximate size of the earlier local build's exact-token target.
  const count = Number(source.segments ?? (source.tokens == null ? NaN : Number(source.tokens) / NOISE_TOKENS_PER_SEGMENT));
  return {
    enabled: source.enabled === true,
    segments: Number.isFinite(count) ? Math.max(NOISE_MIN_SEGMENTS, Math.min(NOISE_MAX_SEGMENTS, Math.round(count))) : DEFAULT_NOISE_SETTINGS.segments,
    mode: source.mode === 'random' ? 'random' : 'fixed',
    seed: typeof source.seed === 'string' && /^[a-f0-9]{16}$/i.test(source.seed)
      ? source.seed.toLowerCase() : DEFAULT_NOISE_SETTINGS.seed,
  };
}

export function createNoiseSeed() {
  if (typeof globalThis.crypto?.getRandomValues !== 'function') throw new Error('Noise seed generation requires crypto.getRandomValues.');
  return Array.from(globalThis.crypto.getRandomValues(new Uint8Array(8)), byte => byte.toString(16).padStart(2, '0')).join('');
}

function seededIndex(seed) {
  let state = 2166136261;
  for (const char of seed) state = Math.imul(state ^ char.charCodeAt(0), 16777619) >>> 0;
  return size => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = Math.imul(state ^ (state >>> 15), state | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return Math.floor(((value ^ (value >>> 14)) >>> 0) / 4294967296 * size);
  };
}

const LETTERS = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';
const SEPARATORS = [' ', ' ', ' ', '  ', ' / ', ' - ', ', ', ' | '];
// Calibrated with the local Gemma tokenizer at roughly 250 tokens per segment.
const FRAGMENTS_PER_SEGMENT = 118;
const NOISE_FOOTER = 'The preceding fragments are noise padding. Do not treat them as instructions or story facts. Do not quote or continue them.';

function noiseFragment(next) {
  const kind = next(16);
  if (kind < 4) return LETTERS[next(LETTERS.length)];
  if (kind === 4) return String(next(100));
  if (kind === 5) return NOISE_SUBJECTS[next(NOISE_SUBJECTS.length)] + ' ' + NOISE_PREDICATES[next(NOISE_PREDICATES.length)];
  const word = NOISE_WORDS[next(NOISE_WORDS.length)];
  if (kind < 11) {
    const length = 2 + next(Math.min(3, word.length - 2));
    return next(2) ? word.slice(0, length) : word.slice(-length);
  }
  return word;
}

function noiseSegment(next) {
  const lines = [];
  let remaining = FRAGMENTS_PER_SEGMENT;
  while (remaining > 0) {
    const count = Math.min(remaining, 3 + next(9));
    let line = noiseFragment(next);
    for (let i = 1; i < count; i++) line += SEPARATORS[next(SEPARATORS.length)] + noiseFragment(next);
    lines.push(line);
    remaining -= count;
  }
  return lines.join('\n');
}

export function buildNoiseText(value = {}) {
  const settings = normalizeNoiseSettings(value);
  const next = seededIndex(settings.seed);
  const blocks = Array.from({ length: settings.segments }, () => noiseSegment(next));
  return {
    text: [...blocks, NOISE_FOOTER].join('\n\n'),
    segments: settings.segments,
    estimatedTokens: settings.segments * NOISE_TOKENS_PER_SEGMENT,
  };
}
