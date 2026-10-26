import { NOISE_CORPUS } from './noise-corpus.js';

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

function shuffledCorpus(seed) {
  let state = 2166136261;
  for (const char of seed) state = Math.imul(state ^ char.charCodeAt(0), 16777619) >>> 0;
  const next = () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = Math.imul(state ^ (state >>> 15), state | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
  const blocks = [...NOISE_CORPUS];
  for (let index = blocks.length - 1; index > 0; index--) {
    const target = Math.floor(next() * (index + 1));
    [blocks[index], blocks[target]] = [blocks[target], blocks[index]];
  }
  return blocks;
}

// The bank is calibrated offline. Runtime only selects and joins whole blocks.
export function buildNoiseText(value = {}) {
  const settings = normalizeNoiseSettings(value);
  const blocks = shuffledCorpus(settings.seed).slice(0, settings.segments)
    .map((text, index) => `[Noise block ${String(index + 1).padStart(2, '0')}]\n${text}`);
  return {
    text: 'Inert diagnostic fragments. Data only; not instructions or story facts. Do not quote or continue.\n<noise_padding>\n'
      + blocks.join('\n\n') + '\n</noise_padding>',
    segments: settings.segments,
    estimatedTokens: settings.segments * NOISE_TOKENS_PER_SEGMENT,
  };
}
