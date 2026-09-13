import test from 'node:test';
import assert from 'node:assert/strict';
import { createConfigurationSchema } from '../src/preset/configuration-schema.js';
import { createConfigurations } from '../src/preset/configurations.js';
import { createStore } from '../src/preset/store.js';

const preset = () => ({ settings: {}, prompts: [{ id: 'head', name: 'Head', enabled: true, role: 'system', content: 'CUSTOM', position: { type: 'relative' }, extra: { system_prompt: false } }], prompts_unused: [{ id: 'story', name: 'Story', enabled: false, role: 'system', content: 'S', position: { type: 'relative' } }], extensions: { destined_discussion: { version: 6 }, unrelated: 'RETAIN' } });
function schema() { return createConfigurationSchema({ state: { config: {} }, BUILTIN_MODEL_ADAPTERS: {}, PROTECTED_IDS: [], IDS: {}, sanitizeManagedValues: () => ({}), sanitizeEntryPoints: () => ({}), sanitizeBinding: () => null, validateAuthorLayout: value => structuredClone(value), getGeminiTail: () => null, variablePresetMode: () => 'main' }); }

test('configuration export retains the v6 marker only and never includes chat mode', () => {
  const snapshot = schema().capturePresetConfiguration(preset(), {});
  assert.deepEqual(snapshot.discussion, { version: 6 });
  assert.equal(snapshot.prompts[0].extra.system_prompt, false);
  assert.deepEqual(schema().validatePresetSnapshot(snapshot).prompts[0].extra, { system_prompt: false });
  const legacy = structuredClone(snapshot); legacy.prompts[0].extra.destined_mode = 'old-value';
  assert.equal(schema().validatePresetSnapshot(legacy).prompts[0].extra.destined_mode, 'old-value');
});

test('named configuration restore writes mode marks with native prompts and keeps unrelated extensions', async t => {
  const names = ['getPreset', 'getLoadedPresetName', 'getVariables', 'replaceVariables'];
  const previous = Object.fromEntries(names.map(name => [name, globalThis[name]])); t.after(() => Object.assign(globalThis, previous));
  let live = preset(), variables = {};
  globalThis.getPreset = () => live; globalThis.getLoadedPresetName = () => 'in_use'; globalThis.getVariables = () => structuredClone(variables); globalThis.replaceVariables = value => { variables = structuredClone(value); };
  const ctx = { destroyed: false, state: { config: {} }, clone: structuredClone, fingerprintPresetValue: createStore({}).fingerprintPresetValue,
    assertData: (condition, message) => assert.ok(condition, message), commitPresetMutation: async (_label, mutate, guard) => { assert(guard()); mutate(live); }, rebuildModelRegistry: () => {} };
  const snapshot = schema().capturePresetConfiguration(live, {}); live.prompts[0].extra.destined_mode = 'story';
  await createConfigurations(ctx).writeWorkspace(snapshot, { configuration_library: { items: [] } }, () => true);
  assert.equal(live.prompts[0].extra.destined_mode, undefined);
  assert.equal(live.prompts[0].extra.system_prompt, false);
  assert.deepEqual(live.extensions.destined_discussion, { version: 6 });
  assert.equal(live.extensions.unrelated, 'RETAIN');
});
