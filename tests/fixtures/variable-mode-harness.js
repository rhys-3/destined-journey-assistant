// Bundled by tests/flavors.test.js under each flavor; reports the variable-mode
// options this flavor selects and detects, plus the preset markers that decide
// whether the loaded preset may be edited at all.
import { GROUPS, OWNED_PRESET_PROMPT_IDS, VARIABLE_MODES, VARIABLE_MODE_BY_ID, presetBelongsToFlavor } from '../../src/preset/definitions.js';
import { createModels } from '../../src/preset/models.js';
import { createWorldbook } from '../../src/preset/worldbook.js';

const presetOf = (...keys) => ({
  prompts: VARIABLE_MODES.map(mode => ({ id: mode.id, enabled: keys.includes(mode.key) })),
});

const routed = [];
const ctx = {
  GROUPS,
  VARIABLE_MODES,
  VARIABLE_MODE_BY_ID,
  getPrompt: (preset, id) => preset?.prompts?.find(item => item.id === id) ?? null,
  selectVariableMode: mode => { routed.push(mode); },
};

const models = createModels(ctx);
for (const mode of VARIABLE_MODES) models.applyGroup('variable-mode', mode.id);
const worldbook = createWorldbook(ctx);

globalThis.__variableModeReport = JSON.stringify({
  options: GROUPS['variable-mode'].options.map(([id, label]) => [id, label]),
  ids: VARIABLE_MODES.map(mode => mode.id),
  keys: VARIABLE_MODES.map(mode => mode.key),
  ownedPresetPromptIds: [...OWNED_PRESET_PROMPT_IDS],
  routed,
  mine: {
    own: presetBelongsToFlavor(presetOf(...VARIABLE_MODES.map(mode => mode.key))),
    // Prime's preset only carries the first two entries of the general flavor.
    primeShape: presetBelongsToFlavor({ prompts: VARIABLE_MODES.slice(0, 2).map(mode => ({ id: mode.id, enabled: mode.key === 'main' })) }),
    empty: presetBelongsToFlavor({ prompts: [] }),
    missing: presetBelongsToFlavor(null),
  },
  detect: {
    ...Object.fromEntries(VARIABLE_MODES.map(mode => [mode.key, worldbook.variablePresetMode(presetOf(mode.key))])),
    none: worldbook.variablePresetMode(presetOf('none')),
    empty: worldbook.variablePresetMode(presetOf()),
    multiple: worldbook.variablePresetMode(presetOf(...VARIABLE_MODES.map(mode => mode.key))),
  },
});
