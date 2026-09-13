export const DISCUSSION_SETTINGS_KEY = 'destined_discussion';
export const DISCUSSION_CONDITION = '{{if {{getvar::本轮场外讨论}}}}';
export const DISCUSSION_CONDITION_CLOSE = '{{/if}}';

const LEGACY_PROMPT_NAMES = Object.freeze(['geminiHead', 'geminiEntry', 'geminiClose', 'geminiTail', 'geminiPrefill']);
const LEGACY_STORED_PROMPT_NAMES = Object.freeze(['head', 'tail', 'history', ...LEGACY_PROMPT_NAMES]);
const NORMAL_ROLES = new Set(['system', 'user', 'assistant']);
const ENTRY_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,99}$/;
const DEFAULT_DISCUSSION_IDS = new Map([
  ['destined-discussion-head', 'destined-discussion-head'], ['head', 'destined-discussion-head'],
  ['destined-discussion-rules', 'destined-discussion-rules'], ['rules', 'destined-discussion-rules'],
  ['destined-discussion-thinking', 'destined-discussion-thinking'], ['thinking', 'destined-discussion-thinking'],
  ['destined-discussion-analysis', 'destined-discussion-analysis'], ['analysis', 'destined-discussion-analysis'],
  ['destined-discussion-tail', 'destined-discussion-tail'], ['tail', 'destined-discussion-tail'],
]);

function plainObject(value) { return value != null && typeof value === 'object' && !Array.isArray(value); }
function text(value, limit, label) {
  if (typeof value !== 'string' || value.length > limit) throw new Error(`${label}必须是至多 ${limit} 字符的文本。`);
  return value;
}
function legacyPrompts(value) {
  if (value == null) return undefined;
  if (!plainObject(value)) throw new Error('旧版 Gemini 讨论提示词格式不受支持。');
  const prompts = {};
  for (const name of LEGACY_PROMPT_NAMES) if (Object.hasOwn(value, name)) prompts[name] = text(value[name], 32000, '讨论提示词：' + name);
  return Object.keys(prompts).length ? prompts : undefined;
}
function sanitizeV1(value) {
  if (!plainObject(value.prompts)) throw new Error('讨论模式设置格式或版本不受支持。');
  const prompts = {};
  for (const name of LEGACY_STORED_PROMPT_NAMES) if (Object.hasOwn(value.prompts, name)) prompts[name] = text(value.prompts[name], 32000, '讨论提示词：' + name);
  return { version: 1, prompts };
}
function sanitizePosition(value) {
  if (!plainObject(value) || (value.type !== 'relative' && value.type !== 'in_chat')) throw new Error('讨论条目位置不受支持。');
  if (value.type === 'relative') return { type: 'relative' };
  for (const name of ['depth', 'order']) if (!Number.isInteger(value[name]) || value[name] < 0 || value[name] > 10000) throw new Error('聊天记录中的讨论条目深度和顺序必须是 0 到 10000 的整数。');
  return { type: 'in_chat', depth: value.depth, order: value.order };
}
function sanitizeLegacyEntry(value) {
  if (!plainObject(value) || typeof value.id !== 'string' || !ENTRY_ID.test(value.id)) throw new Error('讨论条目 ID 不受支持。');
  if (!NORMAL_ROLES.has(value.role)) throw new Error('讨论条目角色只能是 system、user 或 assistant。');
  if (typeof value.enabled !== 'boolean') throw new Error('讨论条目的启用状态不受支持。');
  const name = text(value.name, 100, '讨论条目名称');
  if (!name.trim()) throw new Error('讨论条目名称不能为空。');
  const entry = { id: value.id, name, enabled: value.enabled, role: value.role, position: sanitizePosition(value.position), content: text(value.content, 32000, '讨论条目内容') };
  if (Object.hasOwn(value, 'kind')) {
    if (value.kind !== 'reference' && value.kind !== 'history') throw new Error('讨论固定条目标记不受支持。');
    entry.kind = value.kind;
  }
  return entry;
}
function sanitizeV2(value) {
  if (!Array.isArray(value.entries) || value.entries.length > 100) throw new Error('讨论条目必须是最多 100 项的列表。');
  const ids = new Set();
  const entries = value.entries.map(entry => {
    const next = sanitizeLegacyEntry(entry);
    if (ids.has(next.id)) throw new Error('讨论条目 ID 必须唯一。');
    ids.add(next.id);
    return next;
  });
  const result = { version: 2, entries, history: text(value.history, 32000, '返回剧情后的场外历史说明') };
  const legacy = legacyPrompts(value.legacyPrompts);
  if (legacy) result.legacyPrompts = legacy;
  return result;
}
function sanitizeV3(value) {
  const result = { version: 3, history: text(value.history, 32000, '返回剧情后的场外历史说明') };
  const legacy = legacyPrompts(value.legacyPrompts);
  if (legacy) result.legacyPrompts = legacy;
  return result;
}
function sanitizeV4(value) {
  return { version: 4, history: text(value.history, 32000, '返回剧情后的场外历史说明') };
}
function sanitizeV5(value) {
  return { version: 5, history: text(value.history, 32000, '返回剧情后的场外历史说明') };
}
function sanitizeV6(value) {
  if (Object.keys(value).some(key => key !== 'version')) throw new Error('讨论模式设置 v6 只保存版本标记。');
  return { version: 6 };
}

/** Whitelist the small extension value. Prompt content always remains native. */
export function sanitizeDiscussionSettings(value) {
  if (value == null) return null;
  if (!plainObject(value)) throw new Error('讨论模式设置格式或版本不受支持。');
  if (value.version === 1) return sanitizeV1(value);
  if (value.version === 2) return sanitizeV2(value);
  if (value.version === 3) return sanitizeV3(value);
  if (value.version === 4) return sanitizeV4(value);
  if (value.version === 5) return sanitizeV5(value);
  if (value.version === 6) return sanitizeV6(value);
  throw new Error('讨论模式设置格式或版本不受支持。');
}

export function discussionPromptMode(prompt) {
  // v1-v3 metadata is read only for importing old configurations. Runtime no
  // longer routes prompt entries by this field.
  return prompt?.extra?.destined_mode === 'discussion' ? 'discussion' : 'story';
}

export function readDiscussionHistory(preset, fallback = '') {
  const stored = sanitizeDiscussionSettings(preset?.extensions?.[DISCUSSION_SETTINGS_KEY]);
  if (stored?.version === 5 || stored?.version === 4 || stored?.version === 3 || stored?.version === 2) return stored.history;
  if (stored?.version === 1 && Object.hasOwn(stored.prompts, 'history')) return stored.prompts.history;
  return typeof fallback === 'string' ? fallback : '';
}

/** Returns native records only; it never compiles a second prompt collection. */
export function readNativeDiscussionConfig(preset) {
  return { history: readDiscussionHistory(preset), prompts: preset?.prompts ?? [], prompts_unused: preset?.prompts_unused ?? [] };
}

function migrationDefaults(defaults) {
  const safe = sanitizeDiscussionSettings(defaults);
  if (!safe || safe.version !== 2) throw new Error('请更新配套预设，启用讨论条目设置。');
  return safe;
}
function canonicalId(id) { return DEFAULT_DISCUSSION_IDS.get(id) ?? id; }
function nativeEntry(entry) {
  return {
    id: canonicalId(entry.id), name: entry.name, enabled: entry.enabled, role: entry.role,
    position: structuredClone(entry.position), content: wrapDiscussionCondition(entry.content),
  };
}
export function wrapDiscussionCondition(content) {
  const value = String(content ?? '');
  return value.includes(DISCUSSION_CONDITION) ? value : `${DISCUSSION_CONDITION}${value}${DISCUSSION_CONDITION_CLOSE}`;
}
function isLegacyReference(entry) { return entry.id === 'destined-discussion-reference' || entry.kind === 'reference'; }
function isLegacyHistory(entry) { return entry.id === 'destined-discussion-history' || entry.kind === 'history'; }
function migrationSections(entries) {
  const reference = entries.findIndex(isLegacyReference);
  const history = entries.findIndex(isLegacyHistory);
  if (reference < 0 || history < 0 || reference >= history) throw new Error('旧版讨论配置缺少可安全迁移的资料和历史位置。');
  return {
    beforeReference: entries.slice(0, reference).map(nativeEntry),
    betweenReferenceHistory: entries.slice(reference + 1, history).map(nativeEntry),
    afterHistory: entries.slice(history + 1).map(nativeEntry),
  };
}

/** Build, but never persist, the one-time user-triggered conversion from v1/v2. */
export function buildNativeDiscussionMigration(preset, defaults) {
  const stored = sanitizeDiscussionSettings(preset?.extensions?.[DISCUSSION_SETTINGS_KEY]);
  const base = migrationDefaults(defaults);
  const source = stored?.version === 2 ? stored.entries : base.entries;
  const sections = migrationSections(source);
  const prompts = [...sections.beforeReference, ...sections.betweenReferenceHistory, ...sections.afterHistory];
  if (stored?.version === 1) {
    for (const name of ['head', 'tail']) if (Object.hasOwn(stored.prompts, name)) {
      const entry = prompts.find(item => item.id === `destined-discussion-${name}`);
      if (entry) entry.content = stored.prompts[name];
    }
  }
  const seen = new Set();
  for (const prompt of prompts) {
    if (seen.has(prompt.id)) throw new Error('迁移后的讨论条目 ID 重复。');
    seen.add(prompt.id);
  }
  const extension = { version: 6 };
  return { prompts, extension, ...sections };
}

// Compatibility exports for callers released with v1/v2. They expose native
// source only and do not rebuild a request-only prompt list.
export function resolveDiscussionSettings(value, defaults) {
  return buildNativeDiscussionMigration({ extensions: { [DISCUSSION_SETTINGS_KEY]: value } }, defaults);
}
export function readDiscussionConfig(preset) { return readNativeDiscussionConfig(preset); }
export function readDiscussionPrompts(preset) {
  const stored = sanitizeDiscussionSettings(preset?.extensions?.[DISCUSSION_SETTINGS_KEY]);
  return stored?.version === 1 ? stored.prompts : stored?.legacyPrompts ?? {};
}
