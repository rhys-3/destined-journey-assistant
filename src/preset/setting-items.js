import { IDS, USER_ADDITIONAL_DEFAULT } from './definitions.js';

export const SETTING_LISTS = Object.freeze({
  global_settings: { label: '全局设定', promptId: IDS.globalPreference, macro: '<|全局设定|>' },
  user_additional_settings: { label: '用户附加设定', promptId: IDS.userAdditional, macro: '<|用户附加设定|>' },
});
export const SETTINGS_AUTHORITY = '以下设定可覆盖其它世界设定与角色设定。';
const OLD_MACRO = '<|全局偏好|>';
const GLOBAL_REGION = /(<VOID_likes\b[^>]*>)([\s\S]*?)(<\/VOID_likes>)/iu;
const ADDITIONAL_REGION = /^\s*\{\{#setvar 用户设定\}\}\n?([\s\S]*?)\n?\{\{\/setvar\}\}(?:\{\{trim\}\})?\s*$/u;
const normalizeText = value => String(value ?? '').replace(/\r\n?/gu, '\n');

export function validateSettingItems(items, key = '') {
  if (!Array.isArray(items)) throw new Error('设定列表必须是数组。');
  const ids = new Set();
  return items.map(item => {
    if (!item || typeof item.id !== 'string' || !item.id || ids.has(item.id)
      || typeof item.text !== 'string' || typeof item.enabled !== 'boolean') {
      throw new Error('设定条目的标识、文本或开关无效。');
    }
    ids.add(item.id);
    const error = key && settingTextError(item.text, key);
    if (error) throw new Error(error);
    return { id: item.id, text: normalizeText(item.text), enabled: item.enabled };
  });
}

// Only an unambiguous flat list is split. Paragraphs and nested lists stay intact.
export function legacySettingItems(value, prefix) {
  const text = normalizeText(value);
  if (!text.trim()) return [];
  const lines = text.split('\n').filter(line => line.trim());
  const texts = lines.every(line => /^- \S/u.test(line))
    ? lines.map(line => line.slice(2)) : [text];
  return texts.map((text, index) => ({ id: `${prefix}:${index + 1}`, text, enabled: true }));
}

export function settingTextError(text, key) {
  if (/\{\{\s*\/setvar\s*\}\}/iu.test(text)) return '不能包含 {{/setvar}}，否则会截断设定内容。';
  if (key === 'global_settings' && /<\/VOID_likes\s*>/iu.test(text)) return '不能包含 </VOID_likes>，否则会截断全局设定。';
  return '';
}

export function serializeSettingItems(items, key) {
  return validateSettingItems(items ?? []).filter(item => item.enabled && item.text.trim()).map(item => {
    const error = settingTextError(item.text, key);
    if (error) throw new Error(error);
    return '- ' + item.text.trim().replace(/\n/gu, '\n  ');
  }).join('\n');
}

export function readSettingTemplate(preset, key) {
  const definition = SETTING_LISTS[key];
  const prompt = preset?.prompts?.find(item => item.id === definition?.promptId);
  if (!prompt) return { ok: false, error: `找不到“${definition?.label ?? '设定'}”条目。` };
  const content = normalizeText(prompt.content);
  const count = token => content.split(token).length - 1;
  const match = key === 'global_settings' ? content.match(GLOBAL_REGION) : content.match(ADDITIONAL_REGION);
  const valid = key === 'global_settings'
    ? count('</VOID_likes>') === 1 && !match?.[2]?.includes('<VOID_likes>')
    : count('{{#setvar 用户设定}}') === 1 && count('{{/setvar}}') === 1;
  if (!match || !valid) return { ok: false, error: `${definition.label}的受管包装缺失或格式异常，原文已保留。` };
  const body = key === 'global_settings' ? match[2] : match[1];
  const managed = body.includes(definition.macro) || (key === 'global_settings' && body.includes(OLD_MACRO));
  return { ok: true, content, body, managed, error: '' };
}

// Missing fields remain missing until a preset is available. An explicit [] wins.
export function normalizeCustomSettingValues(source = {}, preset = null) {
  const result = {};
  for (const key of Object.keys(SETTING_LISTS)) {
    if (Object.hasOwn(source, key)) {
      result[key] = validateSettingItems(source[key]);
      continue;
    }
    if (key === 'global_settings' && typeof source.global_preference === 'string') {
      result[key] = legacySettingItems(source.global_preference, 'global');
      continue;
    }
    if (!preset) continue;
    const template = readSettingTemplate(preset, key);
    if (template.ok && !template.managed) {
      result[key] = legacySettingItems(template.body.replace(/^\n|\n$/gu, ''), key);
    } else if (template.ok) {
      result[key] = key === 'global_settings' ? [] : legacySettingItems(USER_ADDITIONAL_DEFAULT, 'additional-default');
    }
  }
  for (const [key, items] of Object.entries(result)) result[key] = validateSettingItems(items, key);
  return result;
}

// Surgical updates only: custom reasoning text is left alone unless it matches
// the shipped Preference instruction and its existing read can be placed safely.
export function migrateCustomSettingPrompts(preset) {
  for (const [key, definition] of Object.entries(SETTING_LISTS)) {
    const prompt = preset.prompts?.find(item => item.id === definition.promptId);
    const template = readSettingTemplate(preset, key);
    if (!template.ok) continue;
    if (key === 'global_settings') {
      let content = template.content.replace(/\sdata-destined-ui="global-preference"/gu, '');
      if (!template.managed) content = content.replace(GLOBAL_REGION, (_match, open, _body, close) => `${open}\n${SETTINGS_AUTHORITY}\n${definition.macro}\n${close}`);
      else {
        content = content.replaceAll(OLD_MACRO, definition.macro);
        if (!content.includes(SETTINGS_AUTHORITY)) content = content.replace(/<VOID_likes\b[^>]*>/iu, opening => `${opening}\n${SETTINGS_AUTHORITY}`);
      }
      content = content.replace('{{//标签内填写你的偏好}}', '')
        .replace('{{#setvar 偏好}}', '{{#setvar 全局设定}}')
        .replace('- Preference: [从<VOID_likes>提取本轮可执行偏好与落实位置；不得覆盖世界规则和角色设定]', '- Settings: [落实<VOID_likes>中与本轮相关的设定]');
      prompt.content = content;
      if (['全局偏好', '🧩 全局偏好'].includes(prompt.name)) prompt.name = prompt.name.replace('全局偏好', '全局设定');
      const ui = prompt.extra?.destined_ui;
      if (ui?.label === '全局偏好') ui.label = '全局设定';
    } else if (!template.managed) {
      prompt.content = `{{#setvar 用户设定}}\n${definition.macro}\n{{/setvar}}{{trim}}`;
    }
  }
  for (const prompt of preset.prompts ?? []) {
    let content = String(prompt.content ?? '');
    content = content.replaceAll('{{setvar::偏好::}}', '{{setvar::全局设定::}}');
    if (content.includes('{{getvar::偏好}}')) {
      const line = /^READ=[^\r\n]*ADJUDICATED_(?:SCENE|ONLY)\r?$/mu;
      if (line.test(content) && content.split('{{getvar::偏好}}').length === 2 && !content.includes('{{getvar::全局设定}}')) {
        content = content.replace('{{getvar::偏好}}', '');
        content = content.replace(line, match => match.replace(/\r?$/u, '{{getvar::全局设定}}'));
      } else content = content.replaceAll('{{getvar::偏好}}', '{{getvar::全局设定}}');
    }
    if (prompt.content !== undefined) prompt.content = content;
  }
  return preset;
}
