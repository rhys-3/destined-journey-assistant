import test from 'node:test';
import assert from 'node:assert/strict';
import { createModels } from '../src/preset/models.js';
import { BUILTIN_MODEL_ADAPTERS, GEMINI_TAIL_MODES } from '../src/preset/definitions.js';

const gemini = BUILTIN_MODEL_ADAPTERS.Gemini;
const [prefillId, noPrefillId, toolId, toolSplitId] = gemini.tails;

function presetWith({ tool = true, enabledTail = noPrefillId } = {}) {
  const ids = Object.values(BUILTIN_MODEL_ADAPTERS).flatMap(adapter => [...adapter.ids, ...adapter.tails])
    .filter(id => tool || (id !== toolId && id !== toolSplitId));
  return { prompts: ids.map(id => ({ id, name: id, enabled: gemini.ids.includes(id) || id === enabledTail })) };
}

function models(preset, tailMode = 'no-prefill') {
  const getPrompt = (target, id) => target?.prompts?.find(prompt => prompt.id === id);
  return createModels({
    state: { preset, config: { model_tail_modes: { Gemini: tailMode } } },
    MODEL_ADAPTERS: BUILTIN_MODEL_ADAPTERS,
    BUILTIN_MODEL_ADAPTERS,
    getPrompt,
    requirePrompt: (target, id) => {
      const prompt = getPrompt(target, id);
      if (!prompt) throw new Error('missing ' + id);
      return prompt;
    },
  });
}

test('the tail modes follow the tail entry order', () => {
  assert.deepEqual(GEMINI_TAIL_MODES, ['prefill', 'no-prefill', 'tool', 'tool-split']);
  assert.equal(gemini.tails.length, 4);
});

test('each enabled tail reads as its mode', () => {
  for (const [index, mode] of GEMINI_TAIL_MODES.entries()) {
    const preset = presetWith({ enabledTail: gemini.tails[index] });
    const api = models(preset);
    assert.equal(api.getGeminiTail(preset), mode);
    assert.equal(api.detectModelAdapter(preset), 'Gemini');
  }
});

test('zero or several tails are not a valid Gemini selection', () => {
  const none = presetWith({ enabledTail: null });
  assert.equal(models(none).getGeminiTail(none), null);
  assert.equal(models(none).detectModelAdapter(none), null);
  const both = presetWith();
  both.prompts.find(prompt => prompt.id === toolId).enabled = true;
  assert.equal(models(both).getGeminiTail(both), null);
  assert.equal(models(both).detectModelAdapter(both), null);
});

test('switching back to Gemini restores the remembered tool tail', () => {
  const preset = presetWith({ enabledTail: null });
  for (const prompt of preset.prompts) prompt.enabled = BUILTIN_MODEL_ADAPTERS.Claude.ids.includes(prompt.id);
  models(preset, 'tool').applyModelToPreset(preset, 'Gemini');
  const enabled = preset.prompts.filter(prompt => prompt.enabled).map(prompt => prompt.id);
  assert.deepEqual(enabled, [...gemini.ids, toolId]);
});

test('presets without the tool tail fall back to no-prefill', () => {
  const preset = presetWith({ tool: false, enabledTail: prefillId });
  const api = models(preset, 'tool');
  assert.equal(api.geminiTailAvailable('tool', preset), false);
  assert.equal(api.geminiTailAvailable('tool-split', preset), false);
  assert.equal(api.geminiTailAvailable('prefill', preset), true);
  preset.prompts.find(prompt => prompt.id === prefillId).enabled = false;
  api.applyModelToPreset(preset, 'Gemini');
  assert.equal(api.getGeminiTail(preset), 'no-prefill');
  api.applyModelToPreset(preset, 'Claude');
  assert.equal(api.detectModelAdapter(preset), 'Claude');
  assert.equal(preset.prompts.some(prompt => prompt.id === noPrefillId && prompt.enabled), false);
});
