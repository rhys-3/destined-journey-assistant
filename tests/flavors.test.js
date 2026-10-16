import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { build } from 'esbuild';
import { FLAVOR, FLAVORS } from '../src/flavor.js';

const define = flavor => ({
  __ASSISTANT_FLAVOR__: JSON.stringify(flavor),
  __ASSISTANT_FLAVOR_INJECTED__: '"1"',
});

const bundle = async (entry, flavor, format = 'esm') => {
  const result = await build({
    entryPoints: [entry],
    bundle: true,
    format,
    platform: 'browser',
    target: 'es2022',
    minify: true,
    legalComments: 'none',
    define: define(flavor),
    write: false,
  });
  return result.outputFiles[0].text;
};

const prime = FLAVORS.prime, general = FLAVORS.general;
// Feature markers stand for one settings, model/connection, editor, summary
// and discussion path each; both flavors must ship all of them.
const FEATURES = ['input_button', 'connection_link', 'customMacros', 'managed_values', 'summary_result', 'megaPromptBlocks', '场外讨论'];
const IDENTITY = ['singletonKey', 'elementIdPrefix', 'summaryVariablePrefix', 'summaryWorldbookPrefix', 'scriptName', 'buttonName', 'panelTitleHtml'];

// esbuild writes non-ASCII as \xHH or \uHHHH escapes, so compare decoded text.
const decoded = text => text.replace(/\\x([\dA-F]{2})|\\u([\dA-F]{4})/gi, (_, x, u) => String.fromCharCode(parseInt(x ?? u, 16)));
const carries = (text, value) => decoded(text).includes(value);

// Runs the real modules, not the bundles, to prove the injected flavor reaches
// the identifiers and persisted keys each artifact uses at runtime.
const harness = async flavor => {
  const text = await bundle('tests/fixtures/flavor-harness.js', flavor, 'iife');
  const sandbox = { globalThis: undefined };
  sandbox.globalThis = sandbox;
  vm.runInNewContext(text, sandbox);
  return JSON.parse(sandbox.__flavorReport);
};

// Same mechanism for the managed settings and summary passes.
const report = async (fixture, flavor, key) => {
  const text = await bundle(fixture, flavor, 'iife');
  const sandbox = { globalThis: undefined, structuredClone };
  sandbox.globalThis = sandbox;
  vm.runInNewContext(text, sandbox);
  return JSON.parse(sandbox[key]);
};

test('source imports resolve to the prime flavor by default', () => {
  assert.equal(FLAVOR.id, prime.id);
  assert.deepEqual({ ...FLAVOR }, { ...prime });
});

test('flavors keep identity and storage separate', () => {
  for (const field of [...IDENTITY, 'output'])
    assert.notEqual(prime[field], general[field], field);
  assert.deepEqual([...prime.legacyButtonNames], ['命定预设设置', '命定设置']);
  assert.deepEqual([...general.legacyButtonNames], []);
  assert.deepEqual([...general.legacySummaryScriptIds], []);
  assert.deepEqual([...general.legacySummaryScriptNames], []);
});

test('both bundles carry every feature and stay self contained', async () => {
  const outputs = {
    prime: await bundle('src/index.js', prime),
    general: await bundle('src/index.js', general),
  };
  for (const [name, text] of Object.entries(outputs)) {
    for (const marker of FEATURES) assert(text.includes(marker), `${name} missing ${marker}`);
    assert(!/\bimport\s*\(/.test(text), `${name} must not import at runtime`);
    assert(!/^\s*import[\s{*'"]/mu.test(text), `${name} must not keep module imports`);
    assert(!/cdn\.jsdelivr|unpkg\.com|\.jsdelivr\.net/.test(text), `${name} must not reference a CDN`);
  }
  for (const field of IDENTITY) {
    assert(carries(outputs.prime, prime[field]), `prime bundle lost ${field}`);
    assert(!carries(outputs.prime, general[field]), `prime bundle kept general ${field}`);
    assert(carries(outputs.general, general[field]), `general bundle lost ${field}`);
    assert(!carries(outputs.general, prime[field]), `general bundle kept prime ${field}`);
  }
  // The general flavor's third variable-mode entry never leaks into prime.
  assert.equal(carries(outputs.general, NO_VARIABLE_ID), true, 'general bundle lost the no-variable entry');
  assert.equal(carries(outputs.prime, NO_VARIABLE_ID), false, 'prime bundle kept the no-variable entry');
  // Both assistants talk to Prime 1.9's message processor, so the bridge names
  // stay shared while the assistant-owned chat flag stays per flavor.
  for (const bridge of ['__destinedPrimeMessageProcessor', '__destinedDiscussionV1']) {
    assert.equal(carries(outputs.prime, bridge), true, `prime bundle lost ${bridge}`);
    assert.equal(carries(outputs.general, bridge), true, `general bundle lost ${bridge}`);
  }
  assert.equal(carries(outputs.prime, prime.discussionChatKey), true, 'prime bundle lost its discussion chat key');
  assert.equal(carries(outputs.prime, general.discussionChatKey), false, 'prime bundle kept the general discussion chat key');
  assert.equal(carries(outputs.general, general.discussionChatKey), true, 'general bundle lost its discussion chat key');
  assert.equal(carries(outputs.general, prime.discussionChatKey), false, 'general bundle kept the prime discussion chat key');
});

test('injected flavor reaches identities and persisted keys', async () => {
  const generalReport = await harness(general);
  assert.equal(generalReport.id, 'general');
  assert.equal(generalReport.buttonName, '通用预设助手');
  assert.equal(generalReport.singletonKey, '__generalRoleplayAssistant');
  assert.deepEqual(generalReport.legacyButtonNames, []);
  assert.equal(generalReport.elementIdPrefix, 'general-settings');
  assert.equal(generalReport.summaryWorldbookPrefix, '通用总结世界书');
  for (const [kind, key] of Object.entries(generalReport.keys))
    assert(key.startsWith('general_summary_'), `${kind} key ${key}`);
  const primeReport = await harness(prime);
  assert.equal(primeReport.singletonKey, '__destinedJourneyAssistant');
  assert.deepEqual(primeReport.legacyButtonNames, ['命定预设设置', '命定设置']);
  for (const [kind, key] of Object.entries(primeReport.keys))
    assert(key.startsWith('summary_assistant_'), `${kind} key ${key}`);
  // Every persisted name must differ between the two flavors.
  for (const kind of Object.keys(primeReport.keys))
    assert.notEqual(primeReport.keys[kind], generalReport.keys[kind], kind);
});

test('general flavor keeps its managed fields without Prime-only entries', async () => {
  const generalManaged = await report('tests/fixtures/managed-harness.js', general, '__managedReport');
  assert.equal(generalManaged.generalStyle.error, '');
  assert.equal(generalManaged.generalStyle.content, generalManaged.generalStyle.input);
  assert.equal(generalManaged.primeStyle.error, '');
  assert.equal(generalManaged.primeStyle.content, generalManaged.primeStyle.input);
  assert(!generalManaged.generalStyle.content.includes('<|字数|>'));
  assert(!generalManaged.generalStyle.content.includes('<|战斗回合|>'));
  assert(!Object.hasOwn(generalManaged.legacy, 'combat_rounds'));
  for (const key of ['hanzi', 'combatRounds', 'thinkingLanguage'])
    assert(!generalManaged.macroKeys.includes(key), key);
  assert.deepEqual(generalManaged.controls.length, []);
  assert.deepEqual(generalManaged.controls.languages, ['body']);
  assert.deepEqual(generalManaged.controls.dialogue, ['dialogueRatio', 'dialogueRounds']);
  // Shared fields keep the static defaults even without preset data.
  assert.deepEqual(generalManaged.defaults, {
    min_hanzi: '1500',
    max_hanzi: '2500',
    length_mode: 'minimum',
    dialogue_ratio: '40',
    dialogue_round_trips: '3',
    combat_rounds: '1',
    narration_person: 'third',
    body_language: '简体中文',
    thinking_language: '简体中文',
  });

  const primeManaged = await report('tests/fixtures/managed-harness.js', prime, '__managedReport');
  assert(generalManaged.macroKeys.length < primeManaged.macroKeys.length);
  assert(primeManaged.macroKeys.includes('hanzi') && primeManaged.macroKeys.includes('combatRounds'));
  assert(primeManaged.primeStyle.content.includes('<combat_pacing max_rounds_per_response="<|战斗回合|>">'));
  assert.deepEqual(primeManaged.controls.length, ['hanzi', 'combatRounds']);
  assert.deepEqual(primeManaged.controls.languages, ['body', 'thinking']);
});

test('general flavor summary still excludes discussion floors', async () => {
  for (const flavor of [prime, general]) {
    const materials = await report('tests/fixtures/summary-discussion-harness.js', flavor, '__summaryReport');
    assert.deepEqual(materials.map(item => item.id), [0, 2], flavor.id);
    assert.equal(materials[0].content, '开局剧情');
  }
});

// The general preset adds a third 无变量 choice; prime keeps its two shipped
// options, and neither flavor may write the other's preset.
const NO_VARIABLE_ID = '0257f4b5-bfa7-4729-8d79-96e9abf760bc';
const MAIN_VARIABLE_ID = '85c7f45b-e3b4-430c-bbab-822498d93de2';
const EXTRA_VARIABLE_ID = '9103b46e-5810-4ed9-b06e-4365070fca35';

test('flavors select and detect their own variable modes', async () => {
  const primeModes = await report('tests/fixtures/variable-mode-harness.js', prime, '__variableModeReport');
  const generalModes = await report('tests/fixtures/variable-mode-harness.js', general, '__variableModeReport');

  assert.deepEqual(primeModes.ids, [MAIN_VARIABLE_ID, EXTRA_VARIABLE_ID]);
  assert.deepEqual(primeModes.keys, ['main', 'extra']);
  assert.deepEqual(primeModes.routed, ['main', 'extra']);
  assert.equal(primeModes.detect.main, 'main');
  assert.equal(primeModes.detect.extra, 'extra');
  assert.equal(primeModes.detect.none, null);
  assert.equal(primeModes.detect.empty, null);
  assert.equal(primeModes.detect.multiple, null);

  assert.deepEqual(generalModes.ids, [MAIN_VARIABLE_ID, EXTRA_VARIABLE_ID, NO_VARIABLE_ID]);
  assert.deepEqual(generalModes.keys, ['main', 'extra', 'none']);
  // Selecting the third entry must route to the no-variable mode.
  assert.deepEqual(generalModes.routed, ['main', 'extra', 'none']);
  assert.equal(generalModes.detect.main, 'main');
  assert.equal(generalModes.detect.extra, 'extra');
  assert.equal(generalModes.detect.none, 'none');
  assert.equal(generalModes.detect.empty, null);
  assert.equal(generalModes.detect.multiple, null);
  assert.deepEqual(generalModes.options.filter(([id]) => id === NO_VARIABLE_ID).map(([, label]) => label), ['无变量']);
  assert.deepEqual(primeModes.options.map(([id]) => id), [MAIN_VARIABLE_ID, EXTRA_VARIABLE_ID]);
});

test('only the owning preset may be edited', async () => {
  const primeModes = await report('tests/fixtures/variable-mode-harness.js', prime, '__variableModeReport');
  const generalModes = await report('tests/fixtures/variable-mode-harness.js', general, '__variableModeReport');
  // Prime is unrestricted, so its published behavior does not change.
  assert.deepEqual(primeModes.ownedPresetPromptIds, []);
  assert.equal(primeModes.mine.primeShape, true);
  assert.equal(primeModes.mine.empty, true);
  assert.equal(primeModes.mine.own, true);
  // The general flavor needs its own variable-mode set, which Prime lacks.
  assert.deepEqual(generalModes.ownedPresetPromptIds, [MAIN_VARIABLE_ID, EXTRA_VARIABLE_ID, NO_VARIABLE_ID]);
  assert(generalModes.ownedPresetPromptIds.includes(NO_VARIABLE_ID));
  assert.equal(generalModes.mine.own, true);
  assert.equal(generalModes.mine.primeShape, false);
  assert.equal(generalModes.mine.empty, false);
  assert.equal(generalModes.mine.missing, false);
});
