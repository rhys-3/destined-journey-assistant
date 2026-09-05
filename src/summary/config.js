import { PRESET_PROMPTS } from './presetDefaults.js';

/**
 * config.js
 * 全局配置常量、板块类型、内置提示词、默认设置
 */

const CONFIG = {
  MAIN_BUTTON_NAME: "总结设置",
  WORLDBOOK_NAME_PREFIX: "命定之诗总结世界书",
  ENTRY_START_ORDER: 100,
  ENTRY_DEPTH: 9998,
  ENTRY_ROLE: "system",
  SETTINGS_VAR_KEY: "summary_assistant_settings",
  CHAT_WB_VAR_KEY: "summary_assistant_worldbook",
  MEGA_SUMMARY_DEPTH: 9999,
  MEGA_SUMMARY_VAR_KEY: "summary_assistant_mega_summary_map",
};

const BLOCK_TYPES = {
  PROMPT: "prompt",
  BUILTIN_GROUP: "builtin_group",
  OLD_SUMMARY: "old_summary",
  CHAT_MESSAGES: "chat_messages",
};

const BUILTIN_PROMPTS = [
  "world_info_before",
  "persona_description",
  "char_description",
  "char_personality",
  "scenario",
  "world_info_after",
  "dialogue_examples",
];

const generateBlockId = () =>
  `custom_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

const DEFAULT_PROMPT_BLOCKS = PRESET_PROMPTS.promptBlocks;
const DEFAULT_MEGA_SUMMARY_PROMPT_BLOCKS = PRESET_PROMPTS.megaPromptBlocks;

const DEFAULT_SETTINGS = {
  enabled: false,
  apiMode: "tavern",
  customApiUrl: "",
  customApiKey: "",
  customApiModel: "",
  customApiSource: "openai",
  temperature: 1,
  maxTokens: 32000,
  includeTags: ["tp", "gametxt"],
  excludeTags: ["think"],
  excludeHtmlComments: true,
  triggerFloorCount: 30,
  keepFloorCount: 10,
  includeOldSummary: true,
  autoTriggerConfirm: false,
  autoHideSummarizedFloors: true,
  userPrefix: "{{user}}",
  assistantPrefix: "{{char}}",
  noTransTag: true,
  noTransTagValue: "<|no-trans|>",
  promptBlocks: DEFAULT_PROMPT_BLOCKS.map((b) => ({ ...b })),
  megaPromptBlocks: DEFAULT_MEGA_SUMMARY_PROMPT_BLOCKS.map((b) => ({ ...b })),
};


export { CONFIG, BLOCK_TYPES, BUILTIN_PROMPTS, generateBlockId, DEFAULT_PROMPT_BLOCKS, DEFAULT_MEGA_SUMMARY_PROMPT_BLOCKS, DEFAULT_SETTINGS };
