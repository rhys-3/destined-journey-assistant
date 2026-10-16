// Bundled by tests/flavors.test.js under each flavor; reports managed migration
// results for a Prime-style entry and for a general-preset entry without
// <combat_pacing> and without <|字数|>.
import { BUILTIN_MODEL_ADAPTERS, DEFAULT_MANAGED_VALUES, IDS, MANAGED_CONTROLS, MANAGED_MACROS, MANAGED_MACRO_KEYS } from '../../src/preset/definitions.js';
import { createManaged } from '../../src/preset/managed.js';
import { createStore } from '../../src/preset/store.js';

const ctx = {
  IDS,
  MANAGED_MACROS,
  MANAGED_MACRO_KEYS,
  MANAGED_CONTROLS,
  MODEL_ADAPTERS: BUILTIN_MODEL_ADAPTERS,
  DEFAULT_MANAGED_VALUES,
  state: { preset: null, config: { managed_values: { ...DEFAULT_MANAGED_VALUES } } },
  getPrompt: (preset, id) => preset?.prompts?.find(prompt => prompt.id === id) ?? null,
};
ctx.sanitizeManagedValues = createStore(ctx).sanitizeManagedValues;
const managed = createManaged(ctx);

const primeEntry = '<length_control scene="non_combat" count_scope="narrative_and_dialogue"><|字数要求|></length_control>\n<combat_pacing max_rounds_per_response="1">本次推进回合数不得超过\`max_rounds_per_response\`；</combat_pacing>';
const generalEntry = '<length_control scene="non_combat" count_scope="narrative_and_dialogue">协作写作要求：<|字数要求|>。对白约占<|对白比例|>%，不低于<|对白轮次|>轮。</length_control>';

const migrate = (id, content) => {
  try {
    return { input: content, content: managed.migrateManagedPromptContent(id, content), error: '' };
  } catch (error) {
    return { input: content, content: '', error: error.message };
  }
};

globalThis.__managedReport = JSON.stringify({
  primeStyle: migrate(IDS.outputLength, primeEntry),
  generalStyle: migrate(IDS.outputLength, generalEntry),
  legacy: managed.readLegacyManagedValues({ prompts: [{ id: IDS.outputLength, content: generalEntry }] }),
  defaults: ctx.sanitizeManagedValues({}, null),
  macroKeys: [...MANAGED_MACRO_KEYS],
  controls: {
    dialogue: [...MANAGED_CONTROLS.dialogue],
    length: [...MANAGED_CONTROLS.length],
    languages: [...MANAGED_CONTROLS.languages],
  },
});
