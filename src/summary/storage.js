import { errorCatched } from './errorHandler.js';
import { CONFIG, BLOCK_TYPES, generateBlockId, DEFAULT_PROMPT_BLOCKS, DEFAULT_MEGA_SUMMARY_PROMPT_BLOCKS, DEFAULT_SETTINGS } from './config.js';
import { getHost, setRuntimeEnabled, insertOrAssignVariables } from '../platform/lifecycle.js';
import { readStore, patchSummaryStore } from '../platform/store.js';
import { summarySnapshot } from './settingsSchema.js';
/**
 * storage.js
 * 设置的加载、保存、迁移、重置
 * 依赖: config.js, utils.js, errorHandler.js
 */

let _cachedSettings = null;

const cloneSettings = (settings) => ({
  ...settings,
  includeTags: Array.isArray(settings?.includeTags)
    ? [...settings.includeTags]
    : [...DEFAULT_SETTINGS.includeTags],
  excludeTags: Array.isArray(settings?.excludeTags)
    ? [...settings.excludeTags]
    : [...DEFAULT_SETTINGS.excludeTags],
  promptBlocks: Array.isArray(settings?.promptBlocks)
    ? settings.promptBlocks.map((b) => ({ ...b }))
    : DEFAULT_PROMPT_BLOCKS.map((b) => ({ ...b })),
  megaPromptBlocks: Array.isArray(settings?.megaPromptBlocks)
    ? settings.megaPromptBlocks.map((b) => ({ ...b }))
    : DEFAULT_MEGA_SUMMARY_PROMPT_BLOCKS.map((b) => ({ ...b })),
});

const migrateOldSettings = (raw) => {
  if (Array.isArray(raw.promptBlocks) && raw.promptBlocks.length > 0) return raw;
  const blocks = DEFAULT_PROMPT_BLOCKS.map((b) => ({ ...b }));
  for (const block of blocks) {
    if (block.id === 'jailbreak' && raw.jailbreakPrompt !== undefined) {
      block.content = raw.jailbreakPrompt;
      if (raw.jailbreakRole) block.role = raw.jailbreakRole;
    }
    if (block.id === 'summary_rules' && raw.summaryRulesPrompt !== undefined) {
      block.content = raw.summaryRulesPrompt;
      if (raw.summaryRulesRole) block.role = raw.summaryRulesRole;
    }
    if (block.id === 'old_summary' && raw.oldSummaryRole) {
      block.role = raw.oldSummaryRole;
    }
    if (block.id === 'chat_messages' && raw.chatMessagesRole) {
      block.role = raw.chatMessagesRole;
    }
    if (block.id === 'summary_instruction' && raw.summaryInstruction !== undefined) {
      block.content = raw.summaryInstruction;
      if (raw.summaryInstructionRole) block.role = raw.summaryInstructionRole;
    }
  }
  raw.promptBlocks = blocks;
  delete raw.jailbreakPrompt;
  delete raw.jailbreakRole;
  delete raw.summaryRulesPrompt;
  delete raw.summaryRulesRole;
  delete raw.oldSummaryRole;
  delete raw.chatMessagesRole;
  delete raw.summaryInstruction;
  delete raw.summaryInstructionRole;
  return raw;
};

const validateBlocks = (blocks, defaultBlocks = DEFAULT_PROMPT_BLOCKS) => {
  if (!Array.isArray(blocks)) return defaultBlocks.map((b) => ({ ...b }));
  const normalized = blocks
    .map((b) => {
      if (!b || typeof b !== 'object') return null;
      if (!b.id) b.id = generateBlockId();
      if (!b.type) b.type = BLOCK_TYPES.PROMPT;
      if (!b.name) b.name = '未命名板块';
      if (b.enabled === undefined) b.enabled = true;
      if (b.type === BLOCK_TYPES.PROMPT && b.content === undefined) b.content = '';
      if (b.role === undefined && b.type !== BLOCK_TYPES.BUILTIN_GROUP) b.role = 'system';
      return b;
    })
    .filter(Boolean);
  const byId = new Map(normalized.map((b) => [b.id, b]));
  for (const defaultBlock of defaultBlocks) {
    if (!byId.has(defaultBlock.id)) {
      normalized.push({ ...defaultBlock });
    }
  }
  return normalized;
};

export function getKeyForUrl(url) {
  const vars=readStore(), secrets=vars.summary_assistant_secrets ?? {};
  const key=String(url??'').trim();
  return secrets.keysByUrl?.[key] ?? (String(vars[CONFIG.SETTINGS_VAR_KEY]?.customApiUrl??'').trim()===key ? secrets.customApiKey ?? vars[CONFIG.SETTINGS_VAR_KEY]?.customApiKey ?? '' : '');
}
const loadSettings = async () => {
  const vars = readStore();
  const raw = vars[CONFIG.SETTINGS_VAR_KEY];
  const settings = summarySnapshot(raw ? migrateOldSettings(structuredClone(raw)) : DEFAULT_SETTINGS);
  _cachedSettings = { ...settings, customApiKey: getKeyForUrl(settings.customApiUrl) };
  setRuntimeEnabled(settings.enabled);
  return cloneSettings(_cachedSettings);
};
const saveSettings = async settings => {
  const validated = summarySnapshot(settings);
  patchSummaryStore({
    [CONFIG.SETTINGS_VAR_KEY]: validated,
    summary_assistant_secrets: { keysByUrl: { ...readStore().summary_assistant_secrets?.keysByUrl, [validated.customApiUrl.trim()]: String(settings.customApiKey ?? '') } },
  });
  _cachedSettings = { ...validated, customApiKey: String(settings.customApiKey ?? '') };
  setRuntimeEnabled(validated.enabled);
  getHost()?.changed?.();
};
const getSettings = () => cloneSettings(_cachedSettings ?? DEFAULT_SETTINGS);
const updateSettings = async partial => {
  const settings = { ...getSettings(), ...partial };
  if(partial.customApiUrl !== undefined && partial.customApiUrl !== getSettings().customApiUrl && !Object.hasOwn(partial,'customApiKey')) settings.customApiKey=getKeyForUrl(partial.customApiUrl);
  await saveSettings(settings);
  return settings;
};
const resetSettings = async () => {
  const settings = { ...structuredClone(DEFAULT_SETTINGS), enabled: getSettings().enabled, customApiKey: getKeyForUrl(DEFAULT_SETTINGS.customApiUrl) };
  await saveSettings(settings); return settings;
};

// ---- 大总结映射管理 ----

const loadMegaSummaryMap = errorCatched(async () => {
  try {
    const vars = getVariables({ type: 'chat' });
    const map = vars?.[CONFIG.MEGA_SUMMARY_VAR_KEY];
    if (map && typeof map === 'object') {
      return map;
    }
    return {};
  } catch (e) {
    console.warn('加载大总结映射失败:', e);
    return {};
  }
});

const saveMegaSummaryMap = errorCatched(async (map) => {
  insertOrAssignVariables(
    { [CONFIG.MEGA_SUMMARY_VAR_KEY]: map || {} },
    { type: 'chat' }
  );
});

const getMegaSummaryMap = errorCatched(async () => {
  return await loadMegaSummaryMap();
});

const setMegaSummaryMapping = errorCatched(async (megaSummaryName, summaryNames) => {
  const map = await loadMegaSummaryMap();
  map[megaSummaryName] = Array.isArray(summaryNames) ? [...summaryNames] : [];
  await saveMegaSummaryMap(map);
});

const getMegaSummaryMapping = errorCatched(async (megaSummaryName) => {
  const map = await loadMegaSummaryMap();
  return map[megaSummaryName] || null;
});

const deleteMegaSummaryMapping = errorCatched(async (megaSummaryName) => {
  const map = await loadMegaSummaryMap();
  delete map[megaSummaryName];
  await saveMegaSummaryMap(map);
});

export { _cachedSettings, cloneSettings, migrateOldSettings, validateBlocks, loadSettings, saveSettings, getSettings, updateSettings, resetSettings, loadMegaSummaryMap, saveMegaSummaryMap, getMegaSummaryMap, setMegaSummaryMapping, getMegaSummaryMapping, deleteMegaSummaryMapping };
