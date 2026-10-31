import test from 'node:test';
import assert from 'node:assert/strict';
import * as definitions from '../src/preset/definitions.js';
import { BODY_POOL_GROUPS, bodyPoolShares, defaultBodyPool, drawBodyPool, normalizeBodyPool, pickWeighted, setBodyPoolWeight } from '../src/preset/body-pool.js';
import { createBodyPoolControls } from '../src/preset/body-pool-controls.js';
import { createConfigurationSchema } from '../src/preset/configuration-schema.js';
import { createManaged } from '../src/preset/managed.js';
import { createStore } from '../src/preset/store.js';

// Deterministic generator for distribution checks.
function seeded(seed = 1) {
  let value = seed;
  return () => { value = (value * 1103515245 + 12345) % 2147483648; return value / 2147483648; };
}

test('defaults keep extreme builds rare and match the managed defaults', () => {
  assert.deepEqual(normalizeBodyPool(undefined), defaultBodyPool());
  assert.deepEqual(definitions.DEFAULT_MANAGED_VALUES.body_pool, defaultBodyPool());
  assert.ok(Object.isFrozen(definitions.DEFAULT_MANAGED_VALUES.body_pool.female_build));
  const female = bodyPoolShares(defaultBodyPool().female_build);
  const male = bodyPoolShares(defaultBodyPool().male_build);
  for (const share of [female.骨感, female.微胖, male.瘦削, male.肥胖]) assert.ok(share <= 6, `extreme share ${share}%`);
  assert.ok(female.匀称 + female.纤细 >= 55);
});

test('normalization drops unknown options, repairs invalid weights and restores an all-zero group', () => {
  const value = normalizeBodyPool({
    female_build: { 纤细: '9', 匀称: 11, 健美: -1, 丰腴: 1.5, 未知: 5 },
    female_bust: Object.fromEntries(BODY_POOL_GROUPS[1].options.map(([name]) => [name, 0])),
    male_build: [],
  });
  assert.equal(value.female_build.纤细, 9);
  assert.equal(value.female_build.匀称, defaultBodyPool().female_build.匀称);
  assert.equal(value.female_build.健美, defaultBodyPool().female_build.健美);
  assert.equal(value.female_build.丰腴, defaultBodyPool().female_build.丰腴);
  assert.ok(!('未知' in value.female_build));
  assert.deepEqual(value.female_bust, defaultBodyPool().female_bust);
  assert.deepEqual(value.male_build, defaultBodyPool().male_build);
});

test('weighted picks follow the weights and never return zero-weight options', () => {
  assert.equal(pickWeighted({ a: 0, b: 3, c: 0 }, () => 0.99), 'b');
  assert.equal(pickWeighted({ a: 1, b: 1 }, () => 0), 'a');
  assert.equal(pickWeighted({ a: 1, b: 1 }, () => 0.999999), 'b');
  assert.equal(pickWeighted({ a: 0 }), '');
  const random = seeded(7), counts = {};
  for (let i = 0; i < 20000; i++) { const name = pickWeighted({ 少: 1, 多: 9 }, random); counts[name] = (counts[name] ?? 0) + 1; }
  assert.ok(Math.abs(counts.少 / 20000 - 0.1) < 0.02, JSON.stringify(counts));
});

test('draws three female build·bust pairs and three male builds from the configured options', () => {
  const female = drawBodyPool(undefined, 'female', seeded(3));
  const male = drawBodyPool(undefined, 'male', seeded(4));
  const builds = BODY_POOL_GROUPS[0].options.map(([name]) => name), busts = BODY_POOL_GROUPS[1].options.map(([name]) => name);
  const femaleItems = female.slice(1, -1).split(', ');
  assert.equal(femaleItems.length, 3);
  for (const item of femaleItems) {
    const [build, bust] = item.split('·');
    assert.ok(builds.includes(build) && busts.includes(bust), item);
  }
  const maleItems = male.slice(1, -1).split(', ');
  assert.equal(maleItems.length, 3);
  for (const item of maleItems) assert.ok(BODY_POOL_GROUPS[2].options.some(([name]) => name === item), item);
  const only = { ...defaultBodyPool(), male_build: { 瘦削: 0, 匀称: 0, 精壮: 4, 魁梧: 0, 敦实: 0, 肥胖: 0 } };
  assert.equal(drawBodyPool(only, 'male'), '[精壮, 精壮, 精壮]');
});

test('weight changes reject invalid input and keep at least one option per group', () => {
  assert.equal(setBodyPoolWeight(undefined, 'male_build', '魁梧', 8).male_build.魁梧, 8);
  assert.throws(() => setBodyPoolWeight(undefined, 'male_build', '巨乳', 1), /不支持/);
  assert.throws(() => setBodyPoolWeight(undefined, 'unknown', '匀称', 1), /不支持/);
  for (const value of [-1, 11, 1.5, 'x']) assert.throws(() => setBodyPoolWeight(undefined, 'female_bust', '适中', value), /0～10/);
  let pool = defaultBodyPool();
  const names = BODY_POOL_GROUPS[1].options.map(([name]) => name);
  for (const name of names.slice(0, -1)) pool = setBodyPoolWeight(pool, 'female_bust', name, 0);
  assert.throws(() => setBodyPoolWeight(pool, 'female_bust', names.at(-1), 0), /至少保留一项/);
});

function managedSetup(t, bodyPool) {
  t.mock.method(console, 'error', () => {});
  const preset = { prompts: [{ id: definitions.IDS.bodyPool, content: '女性: <|女性体型池|>\n男性: <|男性体型池|>' }] };
  const ctx = { ...definitions, presetIsMine: () => true, state: { preset, config: { managed_values: { ...definitions.DEFAULT_MANAGED_VALUES, body_pool: bodyPool } } }, workspaceContextKey: () => 'A', getPrompt: (value, id) => value?.prompts?.find(prompt => prompt.id === id), enqueueScriptConfigSave: () => Promise.resolve() };
  ctx.sanitizeManagedValues = createStore(ctx).sanitizeManagedValues;
  return { ctx, managed: createManaged(ctx) };
}

test('managed short macros expand to freshly drawn pools from the saved weights', t => {
  const onlyFemale = { ...defaultBodyPool(), female_build: { 骨感: 0, 纤细: 0, 匀称: 0, 健美: 5, 丰腴: 0, 微胖: 0 }, female_bust: { 平坦: 0, 小巧: 2, 适中: 0, 丰满: 0, 巨乳: 0 } };
  const { managed } = managedSetup(t, onlyFemale);
  const expanded = managed.expandManagedMacros('女性: <|女性体型池|>\n男性: <|男性体型池|>', true);
  assert.match(expanded, /^女性: \[健美·小巧, 健美·小巧, 健美·小巧\]\n男性: \[[^\]]+\]$/u);
  assert.doesNotMatch(expanded, /<\|/u);
  const values = managed.managedMacroValues();
  assert.ok(Object.getOwnPropertyDescriptor(values, '女性体型池').get, 'pool is drawn lazily on expansion');
});

test('configuration snapshots carry the body pool and old snapshots fall back to defaults', () => {
  const sanitizeManagedValues = createStore({ DEFAULT_MANAGED_VALUES: definitions.DEFAULT_MANAGED_VALUES }).sanitizeManagedValues;
  const schema = createConfigurationSchema({ state: { config: {} }, BUILTIN_MODEL_ADAPTERS: {}, PROTECTED_IDS: [], IDS: {}, sanitizeManagedValues, sanitizeEntryPoints: () => ({}), sanitizeBinding: () => null, validateAuthorLayout: value => structuredClone(value), getGeminiTail: () => null, variablePresetMode: () => 'main' });
  const preset = { settings: {}, prompts: [], prompts_unused: [], extensions: {} };
  const custom = setBodyPoolWeight(undefined, 'male_build', '魁梧', 9);
  const snapshot = schema.capturePresetConfiguration(preset, { managed_values: { body_pool: custom } });
  assert.equal(snapshot.config.managed_values.body_pool.male_build.魁梧, 9);
  assert.equal(schema.validatePresetSnapshot(snapshot).config.managed_values.body_pool.male_build.魁梧, 9);
  const legacy = structuredClone(snapshot); delete legacy.config.managed_values.body_pool;
  assert.deepEqual(schema.validatePresetSnapshot(legacy).config.managed_values.body_pool, defaultBodyPool());
});

function controlsSetup(content = '<|女性体型池|><|男性体型池|>') {
  const saves = [], renders = [];
  const ctx = {
    ...definitions,
    state: { preset: { prompts: [{ id: definitions.IDS.bodyPool, content }] }, config: { managed_values: { body_pool: defaultBodyPool() } }, disclosures: new Set(), workspaceBusy: false },
    getPrompt: (value, id) => value?.prompts?.find(prompt => prompt.id === id),
    escapeHtml: value => String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;'),
    enqueueScriptConfigSave: (label, key) => { saves.push([label, key]); return Promise.resolve(); },
    renderActiveContent: () => renders.push(true),
  };
  return { ctx, saves, renders, controls: createBodyPoolControls(ctx) };
}

test('controls render every weight, save changes and keep the stored value on rejection', async () => {
  const { ctx, saves, controls } = controlsSetup();
  const html = controls.renderBodyPoolControls();
  const total = BODY_POOL_GROUPS.reduce((sum, group) => sum + group.options.length, 0);
  assert.equal(html.match(/data-action="body-pool-weight"/g).length, total);
  assert.doesNotMatch(html, /disabled/);
  assert.doesNotMatch(html, /<details[^>]*open/);
  await controls.setBodyPoolOption('male_build', '魁梧', 7);
  assert.equal(ctx.state.config.managed_values.body_pool.male_build.魁梧, 7);
  assert.deepEqual(saves.at(-1), ['体型比例', 'body-pool:male_build']);
  await assert.rejects(() => controls.setBodyPoolOption('male_build', '魁梧', 12), /0～10/);
  assert.equal(ctx.state.config.managed_values.body_pool.male_build.魁梧, 7);
  assert.match(controls.renderBodyPoolControls(), /0～10/);
  await controls.resetBodyPool();
  assert.deepEqual(ctx.state.config.managed_values.body_pool, defaultBodyPool());
});

test('controls are disabled without the short macros and while another save is running', async () => {
  const missing = controlsSetup('女性: 无');
  assert.match(missing.controls.renderBodyPoolControls(), /缺少体型池短宏/);
  assert.equal(missing.controls.renderBodyPoolControls().match(/<input[^>]* disabled/g).length, 17);
  await assert.rejects(() => missing.controls.setBodyPoolOption('male_build', '魁梧', 3), /缺少体型池短宏/);
  assert.equal(missing.saves.length, 0);
  const busy = controlsSetup();
  busy.ctx.state.workspaceBusy = true;
  await assert.rejects(() => busy.controls.setBodyPoolOption('male_build', '魁梧', 3), /尚未保存/);
  assert.equal(busy.saves.length, 0);
});
