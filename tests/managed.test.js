import test from 'node:test';
import assert from 'node:assert/strict';
import * as definitions from '../src/preset/definitions.js';
import { createManaged } from '../src/preset/managed.js';
import { createStore } from '../src/preset/store.js';

const markers = ['正文开始', '历史开始', '深度900分界', '深度2分界', '历史结束', '正文结束', '记忆区', '参考区', '运行规则区', '资料开始', '资料结束', '场外讨论'].map(name => `<|命定_${name}|>`);
function setup(t, overrides = {}) {
  const notices = [], previousToast = globalThis.toastr;
  globalThis.toastr = { error: message => notices.push(message) };
  t.after(() => { globalThis.toastr = previousToast; });
  t.mock.method(console, 'error', () => {});
  const preset = { prompts: [{ id: definitions.IDS.outputLength, content: '<|字数|> <|字数要求|>' }] };
  let workspace = 'A';
  const ctx = { ...definitions, state: { preset, config: { managed_values: { ...definitions.DEFAULT_MANAGED_VALUES, ...overrides } } }, workspaceContextKey: () => workspace, getPrompt: (value, id) => value?.prompts?.find(prompt => prompt.id === id), enqueueScriptConfigSave: () => Promise.resolve() };
  ctx.sanitizeManagedValues = createStore(ctx).sanitizeManagedValues;
  return { ...createManaged(ctx), notices, setWorkspace: value => { workspace = value; }, setSave: save => { ctx.enqueueScriptConfigSave = save; } };
}

function setupMigration(t, { content, version, values = {} }) {
  const previousName = globalThis.getLoadedPresetName;
  globalThis.getLoadedPresetName = () => 'migration-regression';
  t.after(() => { globalThis.getLoadedPresetName = previousName; });
  const preset = { prompts: [{ id: definitions.IDS.outputLength, content }] };
  let mutations = 0;
  const ctx = {
    ...definitions,
    MODEL_ADAPTERS: {},
    state: {
      preset,
      config: {
        managed_values: { ...definitions.DEFAULT_MANAGED_VALUES, ...values },
        managed_values_version: version,
      },
    },
    workspaceContextKey: () => 'migration-regression',
    getPrompt: (value, id) => value?.prompts?.find(prompt => prompt.id === id),
    enqueueScriptConfigSave: () => Promise.resolve(),
    queuePresetMutation: async (_label, mutate) => { mutations += 1; mutate(preset); },
    renderActiveContent: () => {},
  };
  ctx.sanitizeManagedValues = createStore(ctx).sanitizeManagedValues;
  return { ...createManaged(ctx), ctx, preset, mutationCount: () => mutations };
}

const modernLengthControl = '<length_control scene="non_combat" count_scope="narrative_and_dialogue">要求：<|字数要求|>。</length_control>\n<combat_pacing max_rounds_per_response="<|战斗回合|>">本次推进回合数不得超过<|战斗回合|>回合。</combat_pacing>';

test('managed settings migration accepts the new length requirement markup for v3 and v4 settings', async t => {
  for (const version of [3, 4]) {
    const content = version === 4
      ? modernLengthControl.replace('<length_control ', '<length_control data-destined-ui="output" ')
      : modernLengthControl;
    const managed = setupMigration(t, { content, version });
    await managed.initializeManagedSettings();
    assert.equal(managed.preset.prompts[0].content, modernLengthControl);
    assert.equal(managed.ctx.state.config.managed_values_version, definitions.MANAGED_VALUES_VERSION);
    assert.equal(managed.mutationCount(), 1);
  }

  const fresh = setupMigration(t, { content: modernLengthControl, version: definitions.MANAGED_VALUES_VERSION });
  await fresh.initializeManagedSettings();
  assert.equal(fresh.preset.prompts[0].content, modernLengthControl);
  assert.equal(fresh.mutationCount(), 0);
});

test('managed settings migration keeps legacy length bounds and remains idempotent', async t => {
  for (const attribute of ['min_hanzi', 'min_characters']) for (const hasNumericMacro of [true, false]) {
    const legacyText = hasNumericMacro ? '正文不少于<|字数|>字。' : '正文不少于1800字。';
    const managed = setupMigration(t, {
      version: 3,
      content: `<length_control ${attribute}="1800">${legacyText}</length_control>\n<combat_pacing max_rounds_per_response="2">本次推进回合数不得超过\`max_rounds_per_response\`；</combat_pacing>`,
    });
    await managed.initializeManagedSettings();
    assert.equal(managed.ctx.state.config.managed_values.min_hanzi, '1800');
    assert.match(managed.preset.prompts[0].content, hasNumericMacro ? /min_characters="1800"/ : /min_characters="<\|字数\|>"/);
    assert.match(managed.preset.prompts[0].content, /<\|字数\|>/);
    assert.match(managed.preset.prompts[0].content, /<\|战斗回合\|>/);
    const migrated = managed.preset.prompts[0].content;
    await managed.initializeManagedSettings();
    assert.equal(managed.preset.prompts[0].content, migrated);
    assert.equal(managed.mutationCount(), 1);
  }
});

test('length modes expand compact requirements and reject invalid bounds without saving', async t => {
  const managed = setup(t);
  assert.equal(managed.expandManagedMacros('<|字数|>；<|字数要求|>'), '1500；不少于1500');
  await managed.setLengthMode('maximum');
  assert.equal(managed.expandManagedMacros('<|字数要求|>'), '不多于2500');
  await managed.setLengthMode('range');
  await managed.setLengthValue('minimum', '1800');
  assert.equal(managed.expandManagedMacros('<|字数要求|>'), '1800—2500');
  await assert.rejects(() => managed.setLengthValue('maximum', '1700'), /最少字数不能大于最多字数/);
  for (const value of ['0', '-1', '', '1.5', '9007199254740992']) await assert.rejects(() => managed.setLengthValue('maximum', value), /有效的正整数/);
  for (const value of ['0', '-1', '', '1.5', '9007199254740992']) await assert.rejects(() => managed.setNumericField('hanzi', value), /有效的正整数/);
  assert.equal(managed.managedMacroValues().字数要求, '1800—2500');
});

test('length settings normalize legacy values and retain safe compatible defaults', () => {
  const ctx = { DEFAULT_MANAGED_VALUES: definitions.DEFAULT_MANAGED_VALUES };
  const sanitize = createStore(ctx).sanitizeManagedValues;
  assert.deepEqual(sanitize({ min_hanzi: '1500' }).min_hanzi, '1500');
  assert.deepEqual(sanitize({ min_hanzi: '1500' }).max_hanzi, '2500');
  assert.equal(sanitize({ min_hanzi: '5000' }).max_hanzi, '5000');
  assert.deepEqual(sanitize({ min_hanzi: '1500', max_hanzi: '800', length_mode: 'maximum' }).max_hanzi, '800');
  assert.deepEqual(sanitize({ min_hanzi: '1500', max_hanzi: '800', length_mode: 'range' }).max_hanzi, '1500');
  assert.deepEqual(sanitize({ min_hanzi: '-1', max_hanzi: '0', length_mode: 'unknown' }), {
    ...definitions.DEFAULT_MANAGED_VALUES,
  });
});

test('maximum mode keeps a lower hidden maximum and can enter an editable range draft', async t => {
  const managed = setup(t, { min_hanzi: '1500', max_hanzi: '800', length_mode: 'maximum' });
  assert.equal(managed.expandManagedMacros('<|字数要求|>'), '不多于800');
  await managed.setLengthMode('range');
  assert.equal(managed.readLengthControl().mode, 'range');
  assert.match(managed.readLengthControl().error, /先调整/);
  await managed.setLengthValue('minimum', '800');
  assert.deepEqual(managed.readLengthControl().values.length_mode, 'range');
  assert.equal(managed.expandManagedMacros('<|字数要求|>'), '800—800');
});

test('length range drafts never survive a workspace change', async t => {
  const managed = setup(t, { min_hanzi: '1500', max_hanzi: '800', length_mode: 'maximum' });
  await managed.setLengthMode('range');
  assert.equal(managed.readLengthControl().mode, 'range');
  managed.setWorkspace('B');
  assert.equal(managed.readLengthControl().mode, 'maximum');
  assert.equal(managed.readLengthControl().error, '');
});

test('a completed earlier save does not clear a newer range draft', async t => {
  const managed = setup(t, { min_hanzi: '1500', max_hanzi: '800', length_mode: 'maximum' });
  let complete;
  managed.setSave(() => new Promise(resolve => { complete = resolve; }));
  const earlier = managed.setLengthMode('maximum');
  await managed.setLengthMode('range');
  complete();
  await earlier;
  assert.equal(managed.readLengthControl().mode, 'range');
  assert.match(managed.readLengthControl().error, /先调整/);
});

test('managed expansion preserves all current message boundaries and regions without unknown-macro warnings', t => {
  const managed = setup(t);
  for (const marker of markers) {
    const input = `前文 ${marker} <|字数|> <|正文语言|> 后文`;
    assert.equal(managed.expandManagedMacros(input, true), `前文 ${marker} 1500 简体中文 后文`);
  }
  assert.deepEqual(managed.notices, []);
});

test('both outgoing macro passes preserve structural markers and non-text message parts', t => {
  const managed = setup(t);
  const image = { type: 'image_url', image_url: { url: 'data:image/png;base64,fixture' } };
  const messages = [
    { role: 'system', name: 'adapter', content: `${markers[0]} <|字数|>` },
    { role: 'user', content: [{ type: 'text', text: markers.slice(1).join('\n') }, image] },
  ];
  managed.expandOutgoingMessages(messages);
  const firstPass = structuredClone(messages);
  managed.expandOutgoingMessages(messages);
  assert.deepEqual(messages, firstPass);
  assert.equal(messages[0].content, `${markers[0]} 1500`);
  assert.equal(messages[1].content[0].text, markers.slice(1).join('\n'));
  assert.deepEqual(messages[1].content[1], image);
  assert.equal(messages[0].name, 'adapter');
  assert.deepEqual(managed.notices, []);
});

test('unknown names and retired region names remain blocked without removing valid markers', t => {
  const managed = setup(t);
  const unknown = ['<|命定_正文开始错字|>', '<|命定_未知|>', '<|命定_记忆填入处|>', '<|命定_参考填入处|>', '<|命定_运行规则填入处|>'];
  assert.equal(managed.expandManagedMacros([markers[0], ...unknown, markers[6]].join(''), true), markers[0] + markers[6]);
  assert.equal(managed.notices.length, 1);
  assert(unknown.every(token => managed.notices[0].includes(token)));
  assert(!managed.notices[0].includes(markers[0]));
  assert(!managed.notices[0].includes(markers[6]));
});

test('recursive managed values still cannot leave short macros in outgoing content', t => {
  const managed = setup(t, { global_preference: '<|字数|>' });
  assert.equal(managed.expandManagedMacros(`${markers[0]}<|全局偏好|>${markers[5]}`, true), markers[0] + '- ' + markers[5]);
  assert.equal(managed.notices.length, 1);
  assert.match(managed.notices[0], /短宏递归残留/);
});
