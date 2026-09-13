import test from 'node:test';
import assert from 'node:assert/strict';
import { discussionAdapterSupport } from '../src/discussion/adapter.js';
import { BUILTIN_MODEL_ADAPTERS } from '../src/preset/definitions.js';
import { createCustomModels } from '../src/preset/custom-models.js';

const branch = text => `{{#if {{getvar::本轮场外讨论}}}}${text}{{else}}STORY{{/if}}`;
const gemini = BUILTIN_MODEL_ADAPTERS.Gemini;
function fixture(prefill = false) {
  const contents = new Map([
    [gemini.ids[0], branch('<|命定_场外讨论|> HEAD_FIXTURE')],
    [gemini.ids[1], branch('</narrative_reference><recorder_audit_format>AUDIT_FIXTURE</recorder_audit_format>')],
    [gemini.tails[0], branch('<think>ENTRY_FIXTURE</think><recorder_output><recorder_thinking>')],
    [gemini.tails[1], 'Begin <recorder_output><recorder_thinking>'],
  ]);
  return { prompts: Object.entries(BUILTIN_MODEL_ADAPTERS).flatMap(([name, adapter]) => [...adapter.ids, ...adapter.tails]
    .map(id => ({ id, name: id, enabled: name === 'Gemini' && (adapter.ids.includes(id) || id === adapter.tails[prefill ? 0 : 1]),
      role: id === gemini.tails[0] ? 'assistant' : 'system', position: { type: 'relative' }, content: contents.get(id) ?? name }))), prompts_unused: [] };
}

test('Gemini supports both native tails without consulting the API model name', () => {
  for (const prefill of [false, true]) assert.equal(discussionAdapterSupport(fixture(prefill)).available, true);
});

test('unsupported, conflicting, incomplete, and unmerged templates cannot enable discussion', () => {
  for (const name of ['Claude', 'DeepSeek']) {
    const preset = fixture();
    for (const prompt of preset.prompts) prompt.enabled = BUILTIN_MODEL_ADAPTERS[name].ids.includes(prompt.id);
    assert.match(discussionAdapterSupport(preset).reason, /仅支持 Gemini/);
  }
  const conflict = fixture(); conflict.prompts.find(prompt => prompt.id === gemini.tails[0]).enabled = true;
  assert.equal(discussionAdapterSupport(conflict).available, false);
  const missing = fixture(); missing.prompts.find(prompt => prompt.id === gemini.ids[1]).enabled = false;
  assert.equal(discussionAdapterSupport(missing).available, false);
  const oldCopy = fixture(); oldCopy.prompts.find(prompt => prompt.id === gemini.ids[0]).content = 'old narrative template';
  assert.match(discussionAdapterSupport(oldCopy).reason, /缺少讨论分支/);
  const oldPrefill = fixture(true); oldPrefill.prompts.find(prompt => prompt.id === gemini.tails[0]).content = '<think>old story prefill</think>';
  assert.equal(discussionAdapterSupport(oldPrefill).available, false);
});

test('the existing custom model creation copies both branches, keeps source entries intact, and remains editable', async () => {
  for (const prefill of [false, true]) {
    let live = fixture(prefill), serial = 0;
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
