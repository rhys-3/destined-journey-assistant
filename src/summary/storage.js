import { errorCatched } from './errorHandler.js';
import { CONFIG, BLOCK_TYPES, generateBlockId, DEFAULT_PROMPT_BLOCKS, DEFAULT_MEGA_SUMMARY_PROMPT_BLOCKS, DEFAULT_SETTINGS, DEFAULT_EXCLUDE_TAGS } from './config.js';
import { getHost, setRuntimeEnabled, writeVariableKeys } from '../platform/lifecycle.js';
import { assertRecordWritable } from '../platform/lifecycle.js';
import { readStore, patchSummaryStore, readGlobalStore, patchGlobalStore, migrateGlobalSummaryState } from '../platform/store.js';
import { summarySnapshot } from './settingsSchema.js';
import { PRESET_PROMPTS as LEGACY_PROMPTS } from './presetDefaults.js';
import { PREVIOUS_ARCHIVE_PROMPTS, PREVIOUS_COMPACT_PROMPTS, PREVIOUS_V4_PROMPTS, buildArchivePromptBlocks, optionBlocks, PROMPT_VERSION } from './archiveDefaults.js';
import { SECRETS_VAR_KEY } from '../platform/storage-keys.js';
/**
 * storage.js
 * 设置的加载、保存、迁移、重置
 * 依赖: config.js, utils.js, errorHandler.js
 */

let _cachedSettings = null;

const matchesDefaultBlocks = (actual, defaults, matchesField = (key, value, expected) => value === expected) => {
  if (!Array.isArray(actual) || actual.length !== defaults.length) return false;
  // Persisted snapshots reorder object keys; compare the editable values, not JSON key order.
  const value = (block, key) => block?.[key] ?? (key === 'role' ? 'system' : key === 'enabled' ? true : '');
  return actual.every((block, index) => ['id','name','type','enabled','role','content','leadText','xmlTag','choiceGroup'].every(key =>
    matchesField(key, value(block,key), value(defaults[index],key), defaults[index])));
};

const matchesOldDefault = (actual, defaults) => matchesDefaultBlocks(actual, defaults, (key, value, expected) =>
  value === expected || (key === 'content' && String(value).replace(/\n\{\{summary.depth\}\}/g, '') === expected));

const promptLists = [
  ['promptBlocks', DEFAULT_PROMPT_BLOCKS, false],
  ['megaPromptBlocks', DEFAULT_MEGA_SUMMARY_PROMPT_BLOCKS, true],
];

function migrateV4Blocks(blocks, defaults, previous, mega) {
  if (matchesDefaultBlocks(blocks, previous)) return structuredClone(defaults);
  const oldPlanPrefill = '<archive_check>核对完成。</archive_check>\n<summary_result>\n';
  if (!matchesDefaultBlocks(blocks, previous, (key, value, expected, block) =>
    value === expected || (key === 'enabled' && block.choiceGroup) ||
    (key === 'content' && block.id === 'tail_prefill' && value === oldPlanPrefill))) return blocks;

  const selected = group => blocks.filter(block => block.enabled && block.choiceGroup === group);
  const format = selected('format'), check = selected('check'), tail = selected('tail');
  if ([format, check, tail].some(items => items.length > 1)) return blocks;
  return buildArchivePromptBlocks(mega, {
    resultFormat: format[0]?.id.slice('format_'.length) ?? 'off',
    thinkingTemplate: check[0]?.id === 'check_destined' ? 'plan' : check[0]?.id === 'check_brief' ? 'brief' : 'off',
    prefillTemplate: tail[0]?.id === 'tail_prefill' ? (tail[0].content === oldPlanPrefill ? 'plan' : 'result') : 'off',
  });
}

const cloneSettings = (settings) => ({
  ...structuredClone(settings),
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
  if(raw.behaviorVersion===undefined){
    if(JSON.stringify(raw.excludeTags)==='["think"]')raw.excludeTags=[];
    if(raw.megaTriggerCount===8&&raw.megaBatchCount===6){raw.megaTriggerCount=15;raw.megaBatchCount=10;}
    raw.behaviorVersion=1;
  }
  if (raw.behaviorVersion === 1) {
    if (Array.isArray(raw.excludeTags) && !raw.excludeTags.length) raw.excludeTags = [...DEFAULT_EXCLUDE_TAGS];
    raw.behaviorVersion = DEFAULT_SETTINGS.behaviorVersion;
  }
  if (Array.isArray(raw.promptBlocks)) return migrateNativeOptions(raw);
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
  if (raw.summaryInstruction !== undefined) raw.promptBlocks.push({ id:'summary_instruction', type:'prompt', name:'附加输出要求', enabled:true, role:raw.summaryInstructionRole || 'user', content:raw.summaryInstruction });
  delete raw.jailbreakPrompt;
  delete raw.jailbreakRole;
  delete raw.summaryRulesPrompt;
  delete raw.summaryRulesRole;
  delete raw.oldSummaryRole;
  delete raw.chatMessagesRole;
  delete raw.summaryInstruction;
  delete raw.summaryInstructionRole;
  return migrateNativeOptions(raw);
};

function normalizeLegacyBlock(block) {
  if(block.type===BLOCK_TYPES.PROMPT)return block;
  let content=block.content;
  if(block.type===BLOCK_TYPES.BUILTIN_GROUP)content??=['world_before','persona','character','personality','scenario','world_after','examples'].map(name=>'{{summary.'+name+'}}').join('\n\n');
  if(block.type===BLOCK_TYPES.OLD_SUMMARY)content='<prior_memory>\n{{summary.history}}\n</prior_memory>';
  if(block.type===BLOCK_TYPES.CHAT_MESSAGES){const tag=block.xmlTag||'source_material';content=(block.leadText||'')+'\n<'+tag+'>\n{{summary.material}}\n</'+tag+'>';}
  return {...block,type:BLOCK_TYPES.PROMPT,role:block.role||'user',content:content??''};
}

function migrateNativeOptions(raw) {
  for (const [key, defaults, mega] of promptLists) {
    if (!Array.isArray(raw[key])) {
      raw[key] = structuredClone(defaults);
      continue;
    }
    if (raw.promptVersion === 4) raw[key] = migrateV4Blocks(raw[key], defaults, PREVIOUS_V4_PROMPTS[key], mega);
    if (raw.promptVersion !== undefined && raw.promptVersion >= 4) continue;
    const oldDefault = [LEGACY_PROMPTS[key], PREVIOUS_ARCHIVE_PROMPTS[key]].some(previous => matchesOldDefault(raw[key], previous));
    const compactDefault = matchesOldDefault(raw[key], PREVIOUS_COMPACT_PROMPTS[key]);
    const options = {
      mega,
      resultFormat: oldDefault && raw.resultFormat === 'free' ? 'legacy' : raw.resultFormat ?? (compactDefault || oldDefault ? 'legacy' : 'free'),
      thinkingTemplate: raw.thinkingTemplate ?? (compactDefault || oldDefault ? 'plan' : 'off'),
      prefillTemplate: raw.prefillTemplate ?? 'off',
    };
    if (oldDefault || compactDefault) raw[key] = buildArchivePromptBlocks(mega, options);
    else if (!raw[key].some(block => block.choiceGroup)) {
      const ids = new Set(raw[key].map(block => block.id));
      const choices = optionBlocks(options).filter(block => block.choiceGroup !== 'adapter');
      raw[key].push(...choices.map(block => ids.has(block.id) ? { ...block, id: generateBlockId() } : block));
    }
    raw[key] = raw[key].map(normalizeLegacyBlock);
  }
  raw.promptVersion=PROMPT_VERSION;
  for(const key of ['resultFormat','thinkingTemplate','prefillTemplate','includeDepthWorldbook','noTransTag','noTransTagValue'])delete raw[key];
  return raw;
}

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
  return normalized;
};

export function getKeyForUrl(url) {
  migrateGlobalSummaryState();
  const vars=readStore(), secrets=readGlobalStore()[SECRETS_VAR_KEY] ?? {};
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
  migrateGlobalSummaryState();
  const url = validated.customApiUrl.trim(), key = String(settings.customApiKey ?? '');
  const secrets = readGlobalStore()[SECRETS_VAR_KEY] ?? { keysByUrl: {} };
  const keyChanged = (secrets.keysByUrl?.[url] ?? '') !== key;
  if (keyChanged) patchGlobalStore({ [SECRETS_VAR_KEY]: { keysByUrl: { ...secrets.keysByUrl, [url]: key } } });
  try { patchSummaryStore({ [CONFIG.SETTINGS_VAR_KEY]: validated }); }
  catch (error) {
    if (keyChanged) patchGlobalStore({ [SECRETS_VAR_KEY]: secrets });
    throw error;
  }
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
  assertRecordWritable();
  const settings = { ...structuredClone(DEFAULT_SETTINGS), enabled: getSettings().enabled, customApiKey: getKeyForUrl(DEFAULT_SETTINGS.customApiUrl) };
  await saveSettings(settings); return settings;
};

// ---- 大总结映射管理 ----

function mapsByBook(vars) {
  const stored = vars?.[CONFIG.MEGA_SUMMARY_VAR_KEY];
  if (!stored || stored.byBook) return stored?.byBook ?? {};
  const bound = vars[CONFIG.CHAT_WB_VAR_KEY];
  return bound ? { [bound]: stored } : {};
}

export function scopeLegacyMegaMapping(vars) {
  const stored = vars?.[CONFIG.MEGA_SUMMARY_VAR_KEY];
  if (!stored || stored.byBook) return {};
  return { [CONFIG.MEGA_SUMMARY_VAR_KEY]: { byBook: mapsByBook(vars) } };
}

const loadMegaSummaryMap = errorCatched(async book => {
  const vars = getVariables({ type: 'chat' });
  const maps = mapsByBook(vars), name = book ?? vars?.[CONFIG.CHAT_WB_VAR_KEY];
  return Object.hasOwn(maps, name) ? structuredClone(maps[name]) : {};
});

const saveMegaSummaryMap = errorCatched(async (map, book) => {
  const vars = getVariables({ type: 'chat' }), name = book ?? vars?.[CONFIG.CHAT_WB_VAR_KEY];
  if (!name) throw new Error('当前聊天没有绑定总结世界书');
  writeVariableKeys(
    { [CONFIG.MEGA_SUMMARY_VAR_KEY]: { byBook: { ...mapsByBook(vars), [name]: map } } },
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
