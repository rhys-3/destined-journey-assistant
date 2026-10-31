import test from 'node:test';
import assert from 'node:assert/strict';
import * as definitions from '../src/preset/definitions.js';
import { migrateNoisePlacement, needsNoisePlacementMigration, NATIVE_NOISE_MACRO } from '../src/preset/noise-placement.js';
import { createManaged } from '../src/preset/managed.js';
import { createStore } from '../src/preset/store.js';
import { createConfigurationSchema } from '../src/preset/configuration-schema.js';

const outputId = 'dafd56fc-9b51-4936-98b5-bc16f7c37db9';
const initializerId = '03adb1e6-e613-48ad-844e-035444017ec4';
const noiseSettings = { enabled: true, segments: 29, mode: 'random', seed: '0123456789abcdef' };
const cachePrefix = '[{{getvar::缓存}}CLEAR :: RESET ROLE & TASK, DISCARD AI IDENTITY, LOAD VOID RULE]';
const headContent = `{{#if {{getvar::本轮场外讨论}}}}\n${cachePrefix} Discussion rules\n{{else}}\n${cachePrefix} Story rules\n{{/if}}`;
const prompt = (id, content, extra = {}) => ({ id, name: id, content, enabled: true, role: 'system', position: { type: 'relative' }, extra });
function legacyPreset() {
  return { settings: {}, extensions: {}, prompts: [
    prompt(initializerId, '{{setvar::缓存::}}{{setvar::keep::}}'),
    prompt(definitions.IDS.resetCache, '{{#setvar 缓存}}{{random::CMD_HASH,REQ_ID}}{{roll::1d999}} :: {{/setvar}}{{trim}}'),
    ...Object.values(definitions.BUILTIN_MODEL_ADAPTERS).flatMap(adapter => [...adapter.ids, ...adapter.tails]
      .map((id, index) => prompt(id, index === 0 ? headContent : 'Keep exact model text.'))),
    prompt('custom-head', headContent, { destined_model: { id: 'model:custom', part: 'head' } }),
    prompt(outputId, `<|命定_正文开始|>\n${NATIVE_NOISE_MACRO}\nOutput rules.`),
    prompt('unrelated', 'Unrelated content with {{getvar::unrelated}}.'),
  ], prompts_unused: [], config: { noise_padding: structuredClone(noiseSettings) } };
}

test('legacy placement migration moves only known slots and preserves roles, settings and custom text', () => {
  const preset = legacyPreset(), before = structuredClone(preset);
  preset.prompts.find(item => item.id === 'custom-head').role = 'assistant';
  assert(needsNoisePlacementMigration(preset));
  assert.equal(migrateNoisePlacement(preset), preset);
  assert(!needsNoisePlacementMigration(preset));
  assert(!preset.prompts.some(item => item.id === definitions.IDS.resetCache));
  assert.deepEqual(preset.config.noise_padding, noiseSettings);
  assert.equal(preset.prompts.find(item => item.id === initializerId).content, '{{setvar::keep::}}');
  assert.equal(preset.prompts.find(item => item.id === outputId).content, '<|命定_正文开始|>\nOutput rules.');
  const heads = preset.prompts.filter(item => item.content.startsWith(NATIVE_NOISE_MACRO));
  assert.equal(heads.length, 4);
  for (const head of heads) assert.equal(head.content, `${NATIVE_NOISE_MACRO}\n${headContent.replaceAll('{{getvar::缓存}}', '')}`);
  assert.equal(heads.find(item => item.id === 'custom-head').role, 'assistant');
  for (const unchanged of before.prompts.filter(item => item.id === 'unrelated' || item.content === 'Keep exact model text.')) {
    assert.deepEqual(preset.prompts.find(item => item.id === unchanged.id), unchanged);
  }
  const once = structuredClone(preset);
  migrateNoisePlacement(preset);
  assert.deepEqual(preset, once);
});

test('migration recognizes CRLF and preserves an edited cache entry and unrelated output text', () => {
  const preset = legacyPreset();
  const cache = preset.prompts.find(item => item.id === definitions.IDS.resetCache);
  cache.content = 'User-created neutral text.';
  const output = preset.prompts.find(item => item.id === outputId);
  output.content = output.content.replaceAll('\n', '\r\n');
  migrateNoisePlacement(preset);
  assert.equal(output.content, '<|命定_正文开始|>\r\nOutput rules.');
  assert.equal(preset.prompts.find(item => item.id === definitions.IDS.resetCache).content, cache.content);
});

test('unrecognized placement is left untouched instead of relocating custom macros', () => {
  for (const content of ['Custom output text.', `<|命定_正文开始|>\nCustom line\n${NATIVE_NOISE_MACRO}\n`]) {
    const preset = legacyPreset();
    preset.prompts.find(item => item.id === outputId).content = content;
    const before = structuredClone(preset);
    migrateNoisePlacement(preset);
    assert.deepEqual(preset, before);
  }
});

test('custom cache conditions and consumers preserve the entire legacy preset', () => {
  for (const id of [definitions.BUILTIN_MODEL_ADAPTERS.Gemini.ids[0], 'unrelated']) {
    const preset = legacyPreset();
    const custom = preset.prompts.find(item => item.id === id);
    custom.content = `{{if {{getvar::缓存}}}}${custom.content}{{else}}Custom fallback{{/if}}`;
    const before = structuredClone(preset);
    assert.equal(needsNoisePlacementMigration(preset), false);
    migrateNoisePlacement(preset);
    assert.deepEqual(preset, before);
    assert(preset.prompts.find(item => item.id === initializerId).content.includes('{{setvar::缓存::}}'));
    assert(preset.prompts.some(item => item.id === definitions.IDS.resetCache));
  }
});

test('legacy named snapshots migrate on import while keeping the saved noise selection', () => {
  const ctx = { ...definitions, state: { config: {} },
    sanitizeEntryPoints: () => ({}), sanitizeBinding: () => null,
    validateAuthorLayout: value => structuredClone(value), getGeminiTail: () => null,
    variablePresetMode: () => 'main', PROTECTED_IDS: [] };
  ctx.sanitizeManagedValues = createStore(ctx).sanitizeManagedValues;
  const schema = createConfigurationSchema(ctx);
  const input = legacyPreset();
  input.prompts = input.prompts.filter(item => item.id !== 'custom-head');
  const legacy = schema.capturePresetConfiguration(input, { noise_padding: noiseSettings });
  const validated = schema.validatePresetSnapshot(legacy);
  assert.equal(needsNoisePlacementMigration(validated), false);
  assert.deepEqual(validated.config.noise_padding, noiseSettings);
  assert.equal(validated.prompts.find(item => item.id === definitions.BUILTIN_MODEL_ADAPTERS.Gemini.ids[0]).content.split(NATIVE_NOISE_MACRO).length - 1, 1);
  assert(!validated.prompts.find(item => item.id === outputId).content.includes(NATIVE_NOISE_MACRO));
  assert(legacy.prompts.find(item => item.id === outputId).content.includes(NATIVE_NOISE_MACRO), 'validation must not mutate the imported file');
});

test('startup uses the existing guarded preset queue and leaves current managed settings unchanged', async t => {
  const previousName = globalThis.getLoadedPresetName;
  globalThis.getLoadedPresetName = () => 'legacy-noise';
  t.after(() => { globalThis.getLoadedPresetName = previousName; });
  const preset = legacyPreset();
  let mutations = 0, configSaves = 0;
  const ctx = { ...definitions, MODEL_ADAPTERS: definitions.BUILTIN_MODEL_ADAPTERS,
    state: { preset, config: { managed_values_version: definitions.MANAGED_VALUES_VERSION, noise_padding: noiseSettings } },
    presetIsMine: () => true, workspaceContextKey: () => 'legacy-noise',
    getPrompt: (value, id) => value?.prompts?.find(item => item.id === id),
    queuePresetMutation: async (_label, mutate) => { mutations++; mutate(preset); },
    enqueueScriptConfigSave: async () => { configSaves++; }, renderActiveContent() {} };
  const managed = createManaged(ctx), before = structuredClone(ctx.state.config);
  await managed.initializeManagedSettings();
  await managed.initializeManagedSettings();
  assert.equal(mutations, 1);
  assert.equal(configSaves, 0);
  assert.deepEqual(ctx.state.config, before);
  assert(!needsNoisePlacementMigration(preset));
});

test('startup migration propagates a changed workspace and leaves its source recoverable', async t => {
  const previousName = globalThis.getLoadedPresetName;
  let name = 'legacy-noise';
  globalThis.getLoadedPresetName = () => name;
  t.after(() => { globalThis.getLoadedPresetName = previousName; });
  const preset = legacyPreset(), before = structuredClone(preset);
  const ctx = { ...definitions, MODEL_ADAPTERS: definitions.BUILTIN_MODEL_ADAPTERS,
    state: { preset, config: { managed_values_version: definitions.MANAGED_VALUES_VERSION } },
    presetIsMine: () => true, workspaceContextKey: () => name,
    getPrompt: (value, id) => value?.prompts?.find(item => item.id === id),
    queuePresetMutation: async (_label, mutate) => { name = 'another-preset'; mutate(preset); },
    renderActiveContent() {} };
  await assert.rejects(createManaged(ctx).initializeManagedSettings(), /上下文已变化/);
  assert.deepEqual(preset, before);
});
