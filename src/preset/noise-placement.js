import { BUILTIN_MODEL_ADAPTERS, IDS } from './definitions.js';
import { FLAVOR } from '../flavor.js';

export const NATIVE_NOISE_MACRO_NAME = FLAVOR.id === 'prime' ? 'destined_prompt_noise' : 'general_prompt_noise';
export const NATIVE_NOISE_MACRO = `{{${NATIVE_NOISE_MACRO_NAME}}}`;
const OUTPUT_PROTOCOL_ID = 'dafd56fc-9b51-4936-98b5-bc16f7c37db9';
const INITIALIZER_ID = '03adb1e6-e613-48ad-844e-035444017ec4';
const OLD_SLOT = new RegExp(`(<\\|命定_正文开始\\|>[\\t ]*\\r?\\n)\\{\\{${NATIVE_NOISE_MACRO_NAME}\\}\\}\\r?\\n`, 'u');
const OLD_CACHE = '{{getvar::缓存}}';
const SHIPPED_RESET = /^\{\{#setvar 缓存\}\}(?:\{\{(?:random::[^{}]*|roll::1d\d+)\}\}| :: )+\{\{\/setvar\}\}\{\{trim\}\}\s*$/u;

export function isNoiseHead(prompt, registry = BUILTIN_MODEL_ADAPTERS) {
  return Object.values(registry).some(adapter => adapter.ids[0] === prompt.id)
    || prompt.extra?.destined_model?.part === 'head';
}

export function needsNoisePlacementMigration(preset, registry) {
  return (preset?.prompts ?? []).some(prompt => prompt.id === OUTPUT_PROTOCOL_ID && OLD_SLOT.test(prompt.content))
    && [...(preset?.prompts ?? []), ...(preset?.prompts_unused ?? [])].some(prompt =>
      isNoiseHead(prompt, registry) && String(prompt.content ?? '').includes(OLD_CACHE));
}

// Only move the shipped slots. Keep custom text, roles, ids and noise settings.
export function migrateNoisePlacement(preset, registry) {
  if (!needsNoisePlacementMigration(preset, registry)) return preset;
  for (const prompt of [...(preset.prompts ?? []), ...(preset.prompts_unused ?? [])]) {
    let content = String(prompt.content ?? '');
    if (isNoiseHead(prompt, registry) && content.includes(OLD_CACHE)) {
      content = content.replaceAll(OLD_CACHE, '');
      if (!content.includes(NATIVE_NOISE_MACRO)) content = `${NATIVE_NOISE_MACRO}\n${content}`;
    }
    if (prompt.id === OUTPUT_PROTOCOL_ID) content = content.replace(OLD_SLOT, '$1');
    if (prompt.id === INITIALIZER_ID) content = content.replaceAll('{{setvar::缓存::}}', '');
    if (prompt.content !== undefined) prompt.content = content;
  }
  for (const list of ['prompts', 'prompts_unused']) {
    if (Array.isArray(preset[list])) preset[list] = preset[list].filter(prompt =>
      prompt.id !== IDS.resetCache || !SHIPPED_RESET.test(String(prompt.content ?? '')));
  }
  return preset;
}
