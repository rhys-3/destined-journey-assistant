import test from 'node:test';
import assert from 'node:assert/strict';
import { discussionAdapterSupport } from '../src/discussion/adapter.js';
import { BUILTIN_MODEL_ADAPTERS } from '../src/preset/definitions.js';
import { createCustomModels } from '../src/preset/custom-models.js';

const branch = text => `{{#if {{getvar::本轮场外讨论}}}}${text}{{else}}STORY{{/if}}`;
const gemini = BUILTIN_MODEL_ADAPTERS.Gemini;
// GLM ships as an editable copy saved in the runtime configuration, so its records
// reach the adapter through the registry instead of BUILTIN_MODEL_ADAPTERS.
const GLM = 'glm';
const glm = { label: GLM, ids: ['glm-head', 'glm-think', 'glm-tail'], tails: [], custom: true };
const ADAPTERS = { ...BUILTIN_MODEL_ADAPTERS, [GLM]: glm };
const MARKERS = {
  Gemini: '</narrative_reference><recorder_audit_format>AUDIT_FIXTURE</recorder_audit_format>',
  Claude: '</narrative_reference><recorder_audit_format>PUBLIC_CHECK_FIXTURE</recorder_audit_format>',
  DeepSeek: '</narrative_reference><think_format>REASONING_CHECK_FIXTURE</think_format>',
  [GLM]: '</narrative_reference><think_format>REASONING_CHECK_FIXTURE</think_format>',
};
const TAILS = {
  [gemini.tails[0]]: { role: 'assistant', content: branch('<think>ENTRY_FIXTURE</think><recorder_output><recorder_thinking>') },
  [gemini.tails[1]]: { role: 'system', content: 'Begin <recorder_output><recorder_thinking>' },
};
function entryContent(model, id) {
  const adapter = ADAPTERS[model];
  if (id === adapter.ids[0]) return branch('<|命定_场外讨论|> HEAD_FIXTURE');
  if (id === adapter.ids[1]) return branch(MARKERS[model]);
  return TAILS[id]?.content ?? model + ' TAIL_FIXTURE';
}
function fixture(model = 'Gemini', prefill = false) {
  return { prompts: Object.entries(ADAPTERS).flatMap(([name, adapter]) => [...adapter.ids, ...adapter.tails]
    .map(id => ({ id, name: id, enabled: name === model && (adapter.ids.includes(id) || id === adapter.tails[prefill ? 0 : 1]),
      role: TAILS[id]?.role ?? 'system', position: { type: 'relative' }, content: entryContent(name, id) }))), prompts_unused: [] };
}

test('each shipped adapter enables discussion from its own head and thinking branch markers', () => {
  for (const prefill of [false, true]) {
    assert.deepEqual(discussionAdapterSupport(fixture('Gemini', prefill), ADAPTERS), { available: true, model: 'Gemini', reason: '' });
  }
  for (const model of ['Claude', 'DeepSeek', GLM]) {
    assert.deepEqual(discussionAdapterSupport(fixture(model), ADAPTERS), { available: true, model, reason: '' });
  }
});

test('templates without a discussion branch stay rejected for every adapter', () => {
  for (const model of ['Gemini', 'Claude', 'DeepSeek', GLM]) {
    const adapter = ADAPTERS[model];
    const oldHead = fixture(model);
    oldHead.prompts.find(prompt => prompt.id === adapter.ids[0]).content = 'old narrative template';
    assert.match(discussionAdapterSupport(oldHead, ADAPTERS).reason, /缺少讨论分支/);
    const oldThinking = fixture(model);
    oldThinking.prompts.find(prompt => prompt.id === adapter.ids[1]).content = '<recorder_audit_format>story only</recorder_audit_format>';
    assert.match(discussionAdapterSupport(oldThinking, ADAPTERS).reason, /缺少讨论分支/);
    const noMarker = fixture(model);
    noMarker.prompts.find(prompt => prompt.id === adapter.ids[1]).content = branch('story thinking without a format marker');
    assert.match(discussionAdapterSupport(noMarker, ADAPTERS).reason, /缺少讨论分支/);
    const openReference = fixture(model);
    openReference.prompts.find(prompt => prompt.id === adapter.ids[1]).content = branch(MARKERS[model].replace('</narrative_reference>', ''));
    assert.match(discussionAdapterSupport(openReference, ADAPTERS).reason, /缺少讨论分支/);
    const plainName = fixture(model);
    plainName.prompts.find(prompt => prompt.id === adapter.ids[1]).content = branch('</narrative_reference> recorder_audit_format think_format');
    assert.match(discussionAdapterSupport(plainName, ADAPTERS).reason, /缺少讨论分支/);
  }
  const oldPrefill = fixture('Gemini', true);
  oldPrefill.prompts.find(prompt => prompt.id === gemini.tails[0]).content = '<think>old story prefill</think>';
  assert.equal(discussionAdapterSupport(oldPrefill, ADAPTERS).available, false);
});

test('conflicting, incomplete, and unmerged model selections cannot enable discussion', () => {
  const conflict = fixture(); conflict.prompts.find(prompt => prompt.id === gemini.tails[0]).enabled = true;
  assert.equal(discussionAdapterSupport(conflict, ADAPTERS).available, false);
  const missing = fixture(); missing.prompts.find(prompt => prompt.id === gemini.ids[1]).enabled = false;
  assert.equal(discussionAdapterSupport(missing, ADAPTERS).available, false);
  const unmerged = fixture('Claude'); unmerged.prompts.find(prompt => prompt.id === gemini.ids[0]).enabled = true;
  assert.equal(discussionAdapterSupport(unmerged, ADAPTERS).available, false);
});

test('the existing custom model creation copies both branches, keeps source entries intact, and remains editable', async () => {
  for (const prefill of [false, true]) {
    let live = fixture('Gemini', prefill), serial = 0;
    const before = structuredClone(live);
    globalThis.getPreset = () => structuredClone(live);
    const ctx = {
      state: { preset: live, config: { custom_models: [], connection_link: { bindings: {} } }, editorUnlocked: true },
      BUILTIN_MODEL_ADAPTERS, MODEL_ADAPTERS: BUILTIN_MODEL_ADAPTERS,
      assertData: (value, message) => assert(value, message), clone: structuredClone,
      runWorkspaceOperation: (_label, operation) => operation(() => true), validName: value => value,
      fingerprintPresetValue: JSON.stringify, createPromptId: () => `custom-${++serial}`,
      requirePrompt: (preset, id) => { const prompt = preset.prompts.find(item => item.id === id); assert(prompt); return prompt; },
      writeWorkspace: async (preset, config) => { live = preset; ctx.state.preset = preset; ctx.state.config = config; },
    };
    const customModels = createCustomModels(ctx);
    const id = await customModels.addCustomModel('Editable copy', prefill ? 'prefill' : 'no-prefill');
    const saved = ctx.state.config.custom_models.find(model => model.id === id);
    const sourceIds = [...gemini.ids, gemini.tails[prefill ? 0 : 1]];
    for (let index = 0; index < 3; index++) {
      const source = live.prompts.find(prompt => prompt.id === sourceIds[index]);
      const copy = live.prompts.find(prompt => prompt.id === saved.ids[index]);
      assert.deepEqual(source, before.prompts.find(prompt => prompt.id === source.id));
      assert.equal(copy.content, source.content);
      assert.equal(copy.role, source.role);
      assert.deepEqual(copy.position, source.position);
      assert.equal(copy.enabled, false);
    }
    for (const prompt of live.prompts) prompt.enabled = saved.ids.includes(prompt.id);
    const registry = { ...BUILTIN_MODEL_ADAPTERS, [id]: { ...saved, tails: [], custom: true } };
    assert.deepEqual(discussionAdapterSupport(live, registry), { available: true, model: id, reason: '' });
    live.prompts.find(prompt => prompt.id === saved.ids[1]).content += '\nCUSTOM_RULE';
    assert.equal(discussionAdapterSupport(live, registry).available, true);
    assert(!live.prompts.find(prompt => prompt.id === gemini.ids[1]).content.includes('CUSTOM_RULE'));
  }
});
