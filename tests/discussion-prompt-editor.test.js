import test from 'node:test';
import assert from 'node:assert/strict';
import { createPromptEditor } from '../src/preset/prompt-editor.js';

function setup(prompt) {
  let live = { prompts: [structuredClone(prompt)], prompts_unused: [], extensions: {} };
  globalThis.getLoadedPresetName = () => 'in_use'; globalThis.getPreset = () => structuredClone(live);
  const ctx = { state: { editorUnlocked: true, preset: structuredClone(live), promptEditor: null, styleEditor: null }, clone: structuredClone,
    refreshPreset: () => { ctx.state.preset = structuredClone(live); }, renderStyleEditorLayer: () => {}, renderActiveContent: () => {}, shadow: { querySelector: () => null, querySelectorAll: () => [] },
    placementSnapshot: () => ({ block: 'unclassified', before: '' }), PROTECTED_IDS: new Set(), MODEL_IDS: new Set(), PLACEHOLDER_IDS: new Set(), SYSTEM_PROMPT_IDS: new Set(),
    getPromptGroupId: () => null, authorDependency: () => '', authorLayout: () => ({ blocks: [{ id: 'unclassified', kind: 'toggles' }] }),
    savePlacement: (_preset, item) => { item.extra ??= {}; item.extra.destined_ui = { version: 3, block: 'unclassified', order: 0, group: '', label: '', description: '' }; }, repairPlacementGroup: () => {},
    createPromptId: () => 'new-discussion-id', destroyed: false, saveChain: Promise.resolve(), commitPresetMutation: async (_label, mutate) => { const next = structuredClone(live); mutate(next); live = next; ctx.state.preset = structuredClone(next); }, trackPresetOperation: task => task,
    fingerprintPresetValue: value => JSON.stringify(value), escapeHtml: value => String(value), renderPlacementFields: () => '', setPlacementField: (_field, value) => { ctx.state.promptEditor.draft.authorUi.block = value; },
  };
  return { editor: createPromptEditor(ctx), ctx, live: () => live };
}

test('existing legacy mode metadata remains untouched by the native editor', async () => {
  const state = setup({ id: 'native', name: '原生', content: '正文', enabled: true, role: 'system', position: { type: 'relative' }, extra: { destined_mode: 'discussion' } });
  state.editor.openPromptEditor('native'); state.editor.setEditorField('content', '改后正文'); await state.editor.savePromptEditor();
  assert.equal(state.live().prompts[0].extra.destined_mode, 'discussion');
});

test('new public entries keep their original content', async () => {
  const state = setup({ id: 'existing', name: '已有', content: '', enabled: false, role: 'system', position: { type: 'relative' }, extra: {} });
  state.editor.openPromptEditor('', { block: 'unclassified' }); state.editor.setEditorField('name', '新增条目'); state.editor.setEditorField('content', '正文');
  await state.editor.savePromptEditor();
  assert.equal(state.live().prompts.at(-1).content, '正文');
  assert.equal(state.live().prompts.at(-1).extra.destined_mode, undefined);
});
