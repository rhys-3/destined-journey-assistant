import test from 'node:test';
import assert from 'node:assert/strict';
import { createConfigurations } from '../src/preset/configurations.js';
import { createConfigurationSchema, RECOVERY_ID } from '../src/preset/configuration-schema.js';
import { DEFAULT_MANAGED_VALUES, IDS, VARIABLE_MODES } from '../src/preset/definitions.js';
import { createStore } from '../src/preset/store.js';

test('valid configuration operations preserve unreadable records and metadata until deliberate deletion', async t => {
  let committedPreset = {
    settings: { temperature: 0.5 },
    prompts: VARIABLE_MODES.map(({ id, key }) => ({ id, name: key, enabled: key === 'main', role: 'system' })),
    prompts_unused: [],
  };
  let variables = {};
  let failNext = false;
  const globals = {
    getLoadedPresetName: () => 'in_use',
    getPreset: () => structuredClone(committedPreset),
    replacePreset: async (_name, value) => { committedPreset = structuredClone(value); },
    getVariables: () => structuredClone(variables),
    replaceVariables: value => {
      if (failNext) { failNext = false; throw new Error('script write failed'); }
      variables = structuredClone(value);
    },
  };
  const originals = Object.fromEntries(Object.keys(globals).map(key => [key, globalThis[key]]));
  Object.assign(globalThis, globals);
  t.after(() => Object.assign(globalThis, originals));
  const noop = () => {};
  const ctx = {
    state: { preset: committedPreset }, worldLink: { busy: false, books: [] }, worldWrites: new Set(),
    debounceTimers: new Map(), saveChain: Promise.resolve(), configurationScopes: { preset: true, summary: false },
    IDS, VARIABLE_MODES, DEFAULT_MANAGED_VALUES, BUILTIN_MODEL_ADAPTERS: {}, PROTECTED_IDS: [],
    captureWorldContext: () => ({ key: 'test-chat' }), createPromptId: () => 'created',
    presetIsMine: () => true, variablePresetMode: () => 'main', getGeminiTail: () => null,
    detectModelAdapter: () => null, selectVariableMode: noop, renderStatus: noop,
    hasSettingDraftErrors: () => false, cancelPromptSort: noop, clearSettingDrafts: noop,
    syncEntryPoints: noop, renderActiveContent: noop, updateWorkspaceUi: noop,
  };
  Object.assign(ctx, createStore(ctx), createConfigurationSchema(ctx), createConfigurations(ctx));
  function reload() {
    ctx.state.config = ctx.loadScriptConfig();
    ctx.savedScriptConfig = structuredClone(ctx.state.config);
  }
  reload();
  const snapshot = ctx.captureConfiguration(committedPreset);
  const validA = { id: 'a', name: 'A', createdAt: 'a created', snapshot };
  const validB = { id: 'b', name: 'B', createdAt: 'b created', snapshot };
  const duplicateName = { id: 'b', name: 'a', snapshot: { ...snapshot, differentSource: true } };
  const duplicateId = { id: 'b', name: 'Duplicate ID', snapshot };
  const corrupt = { id: 'damaged', name: 'Corrupt version', snapshot: { version: 42, retained: [1, { x: true }] } };
  const corruptRecovery = { createdAt: 'unchanged', snapshot: { version: 42 } };
  const corruptPending = { key: 42, mode: 'obsolete' };
  const source = {
    version: 1, items: [corrupt, validA, duplicateName, validB, duplicateId, null],
    activeId: 'b', recovery: corruptRecovery, pendingWorld: corruptPending, extraField: { keep: true },
  };
  variables.configuration_library = structuredClone(source);
  reload();
  assert.deepEqual(ctx.configLibrary().items.map(({ name }) => name), ['A', 'B']);

  await ctx.saveScriptConfig('word count', config => { config.managed_values.min_hanzi = '1800'; });
  assert.deepEqual(variables.configuration_library, source);
  assert.equal(Object.hasOwn(variables, 'configuration_library_view'), false);
  await ctx.renameConfiguration('a', 'renamed A');
  reload();
  assert.equal(ctx.configLibrary().activeId, 'b');
  assert.deepEqual(ctx.configLibrary().items.map(({ name }) => name), ['renamed A', 'B']);
  assert.deepEqual(variables.configuration_library.items[2], duplicateName);

  await ctx.saveNamedConfiguration('', 'b');
  assert.equal(variables.configuration_library.items[3].createdAt, 'b created');
  assert.equal(variables.configuration_library.items[3].snapshot.preset.config.managed_values.min_hanzi, '1800');
  await ctx.saveNamedConfiguration('new configuration');
  await ctx.deleteConfiguration('b');
  reload();
  assert.deepEqual(ctx.configLibrary().items.map(({ id }) => id), ['a', 'created']);
  assert.deepEqual(variables.configuration_library.items.slice(2, 5), [duplicateName, duplicateId, null]);

  const beforeApply = structuredClone(variables.configuration_library);
  failNext = true;
  await assert.rejects(ctx.applyConfiguration('a'), /script write failed/);
  assert.deepEqual(variables.configuration_library, beforeApply);
  await ctx.applyConfiguration('a');
  await ctx.applyConfiguration(RECOVERY_ID);
  reload();
  assert.deepEqual(variables.configuration_library.items, beforeApply.items);
  assert.deepEqual(variables.configuration_library.unreadableMetadata, [
    { field: 'recovery', value: corruptRecovery },
    { field: 'pendingWorld', value: corruptPending },
  ]);
  assert(ctx.configLibrary().recovery);
  assert(ctx.state.config.configuration_library_issues.length);

  const libraryBeforeDelete = structuredClone(variables.configuration_library);
  await ctx.deleteInvalidConfigurationData();
  assert.deepEqual(variables.configuration_library, {
    version: 1, items: [libraryBeforeDelete.items[1], libraryBeforeDelete.items[5]],
    activeId: null, recovery: libraryBeforeDelete.recovery, pendingWorld: libraryBeforeDelete.pendingWorld,
    extraField: { keep: true },
  });
  assert.equal(ctx.state.config.configuration_library_issues, undefined);

  variables.configuration_library = { version: 42, items: [corrupt] };
  reload();
  await ctx.saveScriptConfig('word count', config => { config.managed_values.min_hanzi = '2000'; });
  await assert.rejects(ctx.deleteInvalidConfigurationData(), /配置库未载入/);
  assert.deepEqual(variables.configuration_library, { version: 42, items: [corrupt] });
  await ctx.resetConfigurationLibrary();
  assert.deepEqual(variables.configuration_library, ctx.emptyLibrary());
});
