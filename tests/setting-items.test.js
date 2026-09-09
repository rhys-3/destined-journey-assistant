import test from 'node:test';
import assert from 'node:assert/strict';
import { IDS, USER_ADDITIONAL_DEFAULT } from '../src/preset/definitions.js';
import { legacySettingItems, normalizeCustomSettingValues, serializeSettingItems, validateSettingItems, readSettingTemplate, migrateCustomSettingPrompts, SETTINGS_AUTHORITY } from '../src/preset/setting-items.js';
import { createPlacement } from '../src/preset/placement.js';
import * as definitions from '../src/preset/definitions.js';
import { createManaged } from '../src/preset/managed.js';
import { createStore } from '../src/preset/store.js';

const globalContent = '{{#setvar VOID2}}\n\n<VOID_likes>\n<|全局偏好|>\n</VOID_likes>{{/setvar}}{{//标签内填写你的偏好}}{{#setvar 偏好}}\n- Preference: [从<VOID_likes>提取本轮可执行偏好与落实位置；不得覆盖世界规则和角色设定]{{/setvar}}{{trim}}';
const additionalContent = `{{#setvar 用户设定}}\n${USER_ADDITIONAL_DEFAULT}\n{{/setvar}}{{trim}}`;
const oldPreset = () => ({ prompts: [
  { id: IDS.globalPreference, name: '🧩 全局偏好', enabled: false, content: globalContent },
  { id: IDS.userAdditional, name: '用户附加设定', enabled: true, content: additionalContent },
  { id: 'init', content: '{{setvar::VOID2::}}{{setvar::偏好::}}{{setvar::用户设定::}}' },
  ...['Gemini', 'Claude', 'DeepSeek'].map(id => ({ id, content: `READ=input | MODE=ADJUDICATED_SCENE${id === 'DeepSeek' ? ' | FACT_SCOPE=ADJUDICATED_ONLY' : ''}\n\n- 1_Input Units\n- 2_Adjudication{{getvar::偏好}}{{getvar::回顾}}` })),
] });

test('legacy conversion preserves paragraphs, nested lists and ambiguous text, splitting only flat lists', () => {
  assert.deepEqual(legacySettingItems('', 'old'), []);
  assert.deepEqual(legacySettingItems('- 一\r\n- 二', 'old').map(item => item.text), ['一', '二']);
  for (const text of ['第一句\n第二句', '- 一级\n  - 子项', '1. 一\n2. 二', '前言\n- 一\n- 二']) {
    assert.deepEqual(legacySettingItems(text, 'old').map(item => item.text), [text]);
  }
});

test('serialization preserves order and multiline content while excluding disabled and empty rows', () => {
  const items = [
    { id: 'a', text: '第一句\n续行 <user> {{user}}', enabled: true },
    { id: 'b', text: '不发送', enabled: false },
    { id: 'c', text: '  \n ', enabled: true },
    { id: 'd', text: '最后一句 $&', enabled: true },
  ];
  assert.equal(serializeSettingItems(items, 'global_settings'), '- 第一句\n  续行 <user> {{user}}\n- 最后一句 $&');
  assert.equal(serializeSettingItems([...items].reverse(), 'global_settings'), '- 最后一句 $&\n- 第一句\n  续行 <user> {{user}}');
  assert.equal(items[0].text, '第一句\n续行 <user> {{user}}');
  assert.throws(() => serializeSettingItems([{ id: 'x', text: '{{/setvar}}', enabled: true }], 'user_additional_settings'), /截断/);
  assert.throws(() => serializeSettingItems([{ id: 'x', text: '</VOID_likes>', enabled: true }], 'global_settings'), /截断/);
});

test('normalization gives explicit arrays priority, including empty arrays, and remains idempotent', () => {
  const preset = oldPreset();
  const migrated = normalizeCustomSettingValues({ global_preference: '- 一\n- 二' }, preset);
  assert.deepEqual(migrated.global_settings.map(item => item.text), ['一', '二']);
  assert.equal(migrated.user_additional_settings.length, 3);
  assert.deepEqual(normalizeCustomSettingValues(migrated, preset), migrated);
  assert.deepEqual(normalizeCustomSettingValues({ global_settings: [], user_additional_settings: [], global_preference: '旧值' }, preset), { global_settings: [], user_additional_settings: [] });
  assert.deepEqual(normalizeCustomSettingValues({}), {});
  assert.equal(normalizeCustomSettingValues({}, migrateCustomSettingPrompts(preset)).user_additional_settings.length, 3);
});

test('pre-v2 empty script defaults do not overwrite older text stored inside the prompt', t => {
  const previous = globalThis.getVariables;
  globalThis.getVariables = () => ({ managed_values_version: 1, managed_values: { global_preference: '' } });
  t.after(() => { if (previous) globalThis.getVariables = previous; else delete globalThis.getVariables; });
  const ctx = { ...definitions, validateCustomModels: value => value, validateLibrary: value => value, emptyLibrary: () => ({}), getPrompt: (preset, id) => preset.prompts.find(prompt => prompt.id === id) };
  const store = createStore(ctx);
  const preset = oldPreset();
  preset.prompts[0].content = preset.prompts[0].content.replace('<|全局偏好|>', '用户原先写在条目里的内容');
  const config = store.loadScriptConfig();
  const legacy = createManaged(ctx).readLegacyManagedValues(preset);
  const values = store.sanitizeManagedValues({ ...config.managed_values, ...legacy }, preset);
  assert.equal(values.global_settings[0].text, '用户原先写在条目里的内容');
});

test('invalid row data is rejected without coercing or dropping user content', () => {
  const row = { id: 'a', text: '保留', enabled: true };
  assert.throws(() => validateSettingItems([row, row]), /标识/);
  assert.throws(() => validateSettingItems([{ ...row, enabled: 'false' }]), /开关/);
  assert.throws(() => normalizeCustomSettingValues({ global_settings: null }), /数组/);
  assert.throws(() => normalizeCustomSettingValues({ global_settings: [{ ...row, text: '</VOID_likes>' }] }), /截断/);
  assert.deepEqual(row, { id: 'a', text: '保留', enabled: true });
});

test('older marker attributes migrate once while preserving unrelated tag attributes', () => {
  const preset = oldPreset();
  preset.prompts[0].content = globalContent.replace('<VOID_likes>', '<VOID_likes data-destined-ui="global-preference" tone="custom">');
  migrateCustomSettingPrompts(preset);
  assert(preset.prompts[0].content.includes('<VOID_likes tone="custom">\n' + SETTINGS_AUTHORITY));
  assert(!preset.prompts[0].content.includes('data-destined-ui='));
  const once = structuredClone(preset);
  assert.deepEqual(migrateCustomSettingPrompts(preset), once);
});

test('prompt migration preserves identities and insertion settings and places all reads at the existing READ line end', () => {
  const preset = oldPreset();
  preset.prompts[0].position = { type: 'in_chat', depth: 4, order: 100 };
  const before = structuredClone(preset);
  migrateCustomSettingPrompts(preset);
  assert.equal(preset.prompts[0].name, '🧩 全局设定');
  assert.deepEqual(preset.prompts[0].position, before.prompts[0].position);
  assert.equal(preset.prompts[0].enabled, false);
  assert.equal(preset.prompts[0].content.split(SETTINGS_AUTHORITY).length, 2);
  assert.match(preset.prompts[0].content, /\{\{#setvar 全局设定\}\}\n- Settings:/);
  assert(!preset.prompts[0].content.includes('世界规则'));
  assert(!preset.prompts[0].content.includes('{{//'));
  assert.equal(preset.prompts[1].content, '{{#setvar 用户设定}}\n<|用户附加设定|>\n{{/setvar}}{{trim}}');
  assert.equal(preset.prompts[2].content, '{{setvar::VOID2::}}{{setvar::全局设定::}}{{setvar::用户设定::}}');
  for (const prompt of preset.prompts.slice(3)) {
    const end = prompt.id === 'DeepSeek' ? 'ADJUDICATED_ONLY' : 'ADJUDICATED_SCENE';
    assert(prompt.content.includes(`${end}{{getvar::全局设定}}\n\n- 1_Input Units`));
    assert.equal(prompt.content.split('{{getvar::全局设定}}').length, 2);
    assert(prompt.content.endsWith('- 2_Adjudication{{getvar::回顾}}'));
  }
  assert(preset.prompts.at(-1).content.includes('MODE=ADJUDICATED_SCENE | FACT_SCOPE=ADJUDICATED_ONLY'));
  const once = structuredClone(preset);
  assert.deepEqual(migrateCustomSettingPrompts(preset), once);
});

test('custom text and malformed wrappers are not replaced by standard templates', () => {
  const preset = oldPreset();
  preset.prompts[0].name = '自己的名称';
  preset.prompts[0].content = globalContent.replace('- Preference: [从<VOID_likes>提取本轮可执行偏好与落实位置；不得覆盖世界规则和角色设定]', '自己编写的检查内容');
  preset.prompts[1].content = additionalContent + '\n额外手写包装';
  migrateCustomSettingPrompts(preset);
  assert.equal(preset.prompts[0].name, '自己的名称');
  assert(preset.prompts[0].content.includes('自己编写的检查内容'));
  assert.equal(preset.prompts[1].content, additionalContent + '\n额外手写包装');
  assert.equal(readSettingTemplate(preset, 'user_additional_settings').ok, false);
  const custom = { prompts: [{ id: 'custom-thinking', content: 'READ=input | MODE=ADJUDICATED_SCENE\n- 用户自行安排的位置{{getvar::全局设定}}' }] };
  assert.deepEqual(migrateCustomSettingPrompts(structuredClone(custom)), custom);
});

test('default layout migration moves both settings without mutating its input or custom placements', () => {
  const placement = createPlacement({ clone: structuredClone, assertData: (ok, message) => { if (!ok) throw Error(message); }, plainObject: value => value && typeof value === 'object', DEFAULT_GROUP_OPTION_IDS: {} });
  const old = placement.defaultAuthorLayout();
  old.pages = old.pages.filter(page => page.id !== 'custom-settings');
  old.pages.find(page => page.id === 'style').label = '文风与偏好';
  old.blocks.find(block => block.id === 'preference').label = '长期叙事偏好';
  for (const block of old.blocks.filter(block => ['preference', 'user-additional'].includes(block.id))) block.page = 'style';
  const before = structuredClone(old);
  const migrated = placement.validateAuthorLayout(old);
  assert.deepEqual(old, before);
  assert.deepEqual(migrated.pages.slice(0, 3).map(page => page.label), ['日常调整', '自定义设定', '文风与表达']);
  assert.equal(migrated.blocks.find(block => block.id === 'preference').page, 'custom-settings');
  assert.deepEqual(placement.validateAuthorLayout(migrated), migrated);
  old.blocks.find(block => block.id === 'preference').page = 'tools';
  old.blocks.find(block => block.id === 'preference').label = '自己的分区';
  const custom = placement.validateAuthorLayout(old).blocks.find(block => block.id === 'preference');
  assert.equal(custom.page, 'tools');
  assert.equal(custom.label, '自己的分区');
});
