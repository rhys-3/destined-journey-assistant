import { IDS, FIELD_DEFINITIONS, LANGUAGE_DEFINITIONS } from './definitions.js';

export const DESCRIPTION_LIMIT = 2000;
const numericDefaults = {
  hanzi: '每次回复的正文篇幅要求', dialogueRatio: '对白在正文中的占比',
  dialogueRounds: '角色之间至少来回几轮对白', combatRounds: '每次回复推进几回合战斗',
};
const promptDefaults = {
  [IDS.nsfwGeneral]: '中性镜头，双方并重的性描写。',
  [IDS.nsfwMale]: '男性凝视，写承受方的肉体。',
  [IDS.nsfwFemale]: '女性凝视，写男性肉体与承受方感受。',
  [IDS.nsfwGuard]: '未主动要求时，保持普通剧情。',
  [IDS.nsfwSfw]: '非露骨情节下的男凝描写。',
  [IDS.nsfwPace]: '四阶段推进与射精、高潮控制。',
  [IDS.nsfwWords]: '禁用词、套式表达与医学专业术语。',
  [IDS.eventChain]: '配合世界书事件链使用；此处只切换预设条目。',
  [IDS.resetCache]: '排查命中异常时启用，恢复正常后关闭。',
  '928d98d6-2128-4f9d-8406-440fa2d70f87': '总开关：启用基础表达规则及已勾选的细则。',
};
export const DESCRIPTION_KEYS = ['description', ...Object.keys(numericDefaults), 'body', 'thinking'];

export function descriptionFields(id) {
  if (id === IDS.dialogue) return ['dialogueRatio', 'dialogueRounds'].map(key => ({key, label: FIELD_DEFINITIONS[key].label}));
  if (id === IDS.outputLength) return [
    ...['body', 'thinking'].map(key => ({key, label: LANGUAGE_DEFINITIONS[key].label})),
    ...['hanzi', 'combatRounds'].map(key => ({key, label: FIELD_DEFINITIONS[key].label})),
  ];
  return [{key: 'description', label: '条目简介'}];
}

export function promptDescription(prompt, key = 'description') {
  const ui = prompt?.extra?.destined_ui;
  // Missing means inherit; an explicitly empty string hides the description.
  if (Object.hasOwn(ui?.descriptions ?? {}, key) && typeof ui.descriptions[key] === 'string') return ui.descriptions[key];
  if (key === 'description') return (typeof ui?.description==='string'?ui.description:'') || promptDefaults[prompt?.id] || '';
  return numericDefaults[key] ?? LANGUAGE_DEFINITIONS[key]?.description ?? '';
}

export function descriptionSnapshot(prompt) {
  return Object.fromEntries(descriptionFields(prompt?.id).map(({key}) => [key, promptDescription(prompt, key)]));
}
