import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { build } from 'esbuild';
import { FLAVORS } from '../src/flavor.js';

const primeOnlyPrompt = '900cb71c-f6a6-441f-a78c-056ddfc8db10';
const nonePrompt = FLAVORS.general.variableModes.find(mode => mode.key === 'none').id;
const sparseGroup = [
  '1e2f222b-dbe8-42ae-93c8-7858bc419201', '6a4edd08-eefd-4e1b-825b-f6baef169964',
  '7f3c1daf-7d5f-410d-992d-456a32358ad1', 'a532adb2-715f-4a94-a149-f76b75acb835',
  'd9d9f7cc-99d3-4c10-9407-2890b3d63336', '6db91db9-d195-4075-bbf1-a2ec3dd4fcff',
  '7c9b969d-bc0f-49bc-b7b2-8714c726f241', 'f7981332-2532-432b-8b7a-c805c85f5a3e',
  'b99b3c89-d79b-4686-bbec-c668310e803f', '0506330b-2323-4cbc-9934-7e1f15f10310',
  '3e3e6335-662b-4b0d-bd86-8d7195f7363e', '0149d66b-dbc8-42e3-849c-9e706801ee75',
  'c89dee5f-dedb-48af-9c9f-6ecb23004147', 'a6d4d2df-7347-4e74-84a7-b0edf46781f5',
];

function minimalReverie(definitions) {
  // The layout shapes match the incomplete v3 metadata shipped in Reverie 1.2.1.
  const sparse = new Map([
    [nonePrompt, { block: 'variable', group: 'variable-mode', order: 10 }],
    ['585a8861-6404-4dad-865b-dff1e42b615c', { block: 'hidden', order: 10 }],
    ['349ddc8b-89b0-42f0-a653-6caae0465841', { block: 'beautify', order: 10 }],
    ...sparseGroup.map((id, index) => [id, { block: 'main-style', group: 'main-style', order: (index + 1) * 10 }]),
  ]);
  const models = Object.values(definitions.BUILTIN_MODEL_ADAPTERS).flatMap(adapter => [...adapter.ids, ...adapter.tails]);
  const ids = new Set([...definitions.PROTECTED_IDS, ...models, ...FLAVORS.general.ownPresetPromptIds, ...sparse.keys()]);
  ids.delete(primeOnlyPrompt);
  const prompts = [...ids].map(id => ({
    id, name: id, role: 'system', content: 'Synthetic test entry',
    enabled: definitions.PROTECTED_IDS.has(id) || id === FLAVORS.general.variableModes[0].id,
    ...(sparse.has(id) ? { extra: { destined_ui: { version: 3, ...sparse.get(id) } } } : {}),
  }));
  return { settings: {}, prompts, prompts_unused: [], extensions: {} };
}

function readRealReverie(path) {
  const raw = JSON.parse(readFileSync(path, 'utf8'));
  const order = raw.prompt_order[0].order;
  const byId = new Map(raw.prompts.map(prompt => [prompt.identifier, prompt]));
  const convert = (prompt, enabled) => ({
    id: prompt.identifier, name: prompt.name, enabled, role: prompt.role ?? 'system',
    content: prompt.content,
    position: prompt.injection_position === 1 ? { type: 'in_chat', depth: prompt.injection_depth, order: prompt.injection_order } : { type: 'relative' },
    extra: prompt.extra,
  });
  const activeIds = new Set(order.map(entry => entry.identifier));
  return {
    settings: { should_stream: raw.stream_openai },
    prompts: order.filter(entry => byId.has(entry.identifier)).map(entry => convert(byId.get(entry.identifier), entry.enabled)),
    prompts_unused: raw.prompts.filter(prompt => !activeIds.has(prompt.identifier)).map(prompt => convert(prompt, prompt.enabled)),
    extensions: raw.extensions,
  };
}

test('Reverie saves and applies each variable mode with sparse display metadata', async t => {
  const bundle = await build({
    stdin: {
      contents: [
        'export * as definitions from "./src/preset/definitions.js";',
        'export { createStore } from "./src/preset/store.js";',
        'export { createConfigurationSchema } from "./src/preset/configuration-schema.js";',
        'export { createConfigurations } from "./src/preset/configurations.js";',
        'export { createWorldbook } from "./src/preset/worldbook.js";',
        'export { createPlacement } from "./src/preset/placement.js";',
        'export { createModels } from "./src/preset/models.js";',
      ].join('\n'),
      resolveDir: process.cwd(),
    },
    define: { __ASSISTANT_FLAVOR__: JSON.stringify(FLAVORS.general), __ASSISTANT_FLAVOR_INJECTED__: '"1"' },
    bundle: true,
    format: 'esm',
    write: false,
  });
  const esm = 'data:text/javascript;base64,' + Buffer.from(bundle.outputFiles[0].contents).toString('base64');
  const {
    definitions, createStore, createConfigurationSchema, createConfigurations,
    createWorldbook, createPlacement, createModels,
  } = await import(esm);
  const realPath = process.env.REVERIE_TEST_PRESET;
  if (realPath) t.diagnostic('Using the actual Reverie preset as read-only input');
  const initial = realPath ? readRealReverie(realPath) : minimalReverie(definitions);
  const presets = new Map(['reverie', 'in_use'].map(key => [key, structuredClone(initial)]));
  let variables = {}, id = 0;
  const globals = {
    getPreset: name => structuredClone(presets.get(name)),
    getLoadedPresetName: () => 'reverie',
    replacePreset: async (name, value) => { presets.set(name, structuredClone(value)); },
    getVariables: () => structuredClone(variables),
    replaceVariables: value => { variables = structuredClone(value); },
  };
  for (const name of ['getGlobalWorldbookNames', 'getCharWorldbookNames', 'getChatWorldbookName', 'getWorldbook', 'updateWorldbookWith']) {
    globals[name] = () => assert.fail('Reverie called ' + name);
  }
  t.after(() => references.forEach(([key, value]) => { globalThis[key] = value; }));
  const references = Object.keys(globals).map(key => [key, globalThis[key]]);
  Object.assign(globalThis, globals);
  const noop = () => {};
  const ctx = {
    ...definitions, presetIsMine: preset => definitions.presetBelongsToFlavor(preset), state: { preset: initial }, saveChain: Promise.resolve(),
    pendingPresetOperations: 0, debounceTimers: new Map(), worldEpoch: 0,
    worldLink: { busy: false, books: [] }, worldWrites: new Set(),
    createPromptId: () => 'configuration-' + ++id, hasSettingDraftErrors: () => false,
    renderStatus: noop, clearSettingDrafts: noop, cancelPromptSort: noop, updateWorkspaceUi: noop,
    renderActiveContent: noop, syncEntryPoints: noop,
  };
  Object.assign(ctx, createStore(ctx), createConfigurationSchema(ctx), createPlacement(ctx),
    createConfigurations(ctx), createWorldbook(ctx), createModels(ctx));
  ctx.getContext = () => ({ chatId: 'configuration-test' });
  ctx.state.config = ctx.loadScriptConfig();
  ctx.savedScriptConfig = structuredClone(ctx.state.config);
  ctx.rebuildModelRegistry();

  assert(!initial.prompts.some(prompt => prompt.id === primeOnlyPrompt));
  assert(!ctx.PROTECTED_IDS.has(primeOnlyPrompt));
  const sparseUi = [...initial.prompts, ...initial.prompts_unused].filter(({ extra }) =>
    extra?.destined_ui?.version === 3 && !Object.hasOwn(extra.destined_ui, 'label'));
  assert.equal(sparseUi.length, 17);
  for (const { key } of FLAVORS.general.variableModes) {
    const flags = preset => FLAVORS.general.variableModes.map(({ id }) => preset.prompts.find(prompt => prompt.id === id).enabled);
    const expected = FLAVORS.general.variableModes.map(mode => mode.key === key);
    await ctx.selectVariableMode(key);
    assert.equal(ctx.variablePresetMode(), key, ctx.worldLink.message);
    const id = await ctx.saveNamedConfiguration(key, '', { preset: true, summary: false });
    const item = variables.configuration_library.items.find(record => record.id === id);
    assert.equal(item.snapshot.flavor, 'general');
    assert.deepEqual(flags(item.snapshot.preset), expected);
    await ctx.selectVariableMode(key === 'main' ? 'extra' : 'main');
    await ctx.applyConfiguration(id);
    assert.deepEqual(flags(presets.get('reverie')), expected);
    assert.deepEqual(flags(presets.get('in_use')), expected);
    assert.equal(variables.configuration_library.pendingWorld, null);
    assert.throws(() => ctx.validateSnapshot({ ...item.snapshot, flavor: 'prime' }), /该配置属于其他预设版本/);
    const { flavor, ...oldSnapshot } = item.snapshot;
    assert.equal(ctx.validateSnapshot(oldSnapshot).flavor, 'general');
  }
  const invalidUi = structuredClone(sparseUi[0]);
  invalidUi.extra.destined_ui.label = 1;
  assert.throws(() => ctx.snapshotPrompt(invalidUi), /显示位置格式无效/);
});
