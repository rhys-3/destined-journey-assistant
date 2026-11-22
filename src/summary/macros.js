import { tavernContext, helperApi } from '../platform/ambient.js';
import { IDENTITY_MACRO_SOURCE, captureIdentityValues, identityMacroValue, expandIdentityMacros } from '../platform/identity-macros.js';
import { captureContext, checkContext } from '../platform/lifecycle.js';
import { BLOCK_TYPES, BUILTIN_PROMPTS } from './config.js';
import { ADAPTER_PROMPTS, OUTPUT_CONTRACT, formatInstruction, activeResultFormat } from './archiveDefaults.js';
import { getActiveWorldbookName } from './worldbook.js';
import { VARIABLE_WORLD_ENTRIES } from '../preset/definitions.js';
import { parseRange } from './provenance.js';
import { escapeRegex, normalizeWorldbookEntries } from './utils.js';

export const MACROS = [
  ['summary.output_format', '所选输出格式与结果标签要求'],
  ['summary.history', '此前有效的大总结与普通总结'], ['summary.material', '本次带楼层编号的材料'], ['summary.start', '起始楼层'], ['summary.end', '结束楼层'], ['summary.kind', '总结类型'],
  ['summary.world_before', '世界书前置'], ['summary.persona', '用户设定'], ['summary.character', '角色描述'], ['summary.personality', '角色性格'], ['summary.scenario', '场景'], ['summary.world_after', '世界书后置'], ['summary.examples', '对话示例'], ['user', '用户名称'], ['char', '角色名称'],
];
// Mirrors SillyTavern's defaultGlobalScanData; some builds read it without a default.
const WORLD_SCAN_DATA = Object.freeze({ trigger: 'normal', personaDescription: '', characterDescription: '', characterPersonality: '', characterDepthPrompt: '', scenario: '', creatorNotes: '' });
const builtinNames = { world_info_before: 'world_before', persona_description: 'persona', char_description: 'character', char_personality: 'personality', scenario: 'scenario', world_info_after: 'world_after', dialogue_examples: 'examples' };

const variableEntries = new Set(Object.values(VARIABLE_WORLD_ENTRIES));
function isControlEntry(entry) {
  const name = entry.name?.normalize('NFKC') ?? '';
  return parseRange(entry.name) || variableEntries.has(entry.name) || /\[mvu_update\]/i.test(name) ||
    /^(?:\[[^\]]+\]\s*)*output_format_/i.test(name.trim());
}

async function omittedWorldInfo(token) {
  const readBook = helperApi('getWorldbook');
  if (!readBook) return [];
  const readBindings = [
    async () => {
      const character = await helperApi('getCharWorldbookNames')?.('current');
      return [character?.primary, ...(character?.additional ?? [])];
    },
    async () => [await helperApi('getChatWorldbookName')?.('current')],
    async () => await helperApi('getGlobalWorldbookNames')?.() ?? [],
  ];
  const bindings = await Promise.allSettled(readBindings.map(read => read()));
  checkContext(token);
  const names = new Set([getActiveWorldbookName()]);
  for (const result of bindings) {
    if (result.status === 'fulfilled') for (const name of result.value) names.add(name);
    else console.warn('总结资料未能读取世界书绑定', result.reason);
  }
  const books = [...names].filter(Boolean);
  const reads = await Promise.allSettled(books.map(async name => readBook(name)));
  checkContext(token);
  const omitted = new Set();
  reads.forEach((result, index) => {
    if (result.status === 'rejected') { console.warn('总结资料未能读取世界书', books[index], result.reason); return; }
    for (const entry of normalizeWorldbookEntries(result.value)) {
      if (isControlEntry(entry) && entry.content?.trim()) omitted.add(entry.content.trim());
    }
  });
  return [...omitted].sort((a, b) => b.length - a.length);
}

export async function snapshotContext(params, settings) {
  const token = captureContext(), st = tavernContext(), ctx = st?.getContext?.() ?? st ?? {};
  const fields = (st?.getCharacterCardFields ?? ctx.getCharacterCardFields)?.() ?? {};
  const values = {
    ...captureIdentityValues(),
    'summary.history': params.oldSummaryContent ?? params.oldMegaSummaryContent ?? '', 'summary.material': params.mergedChatText ?? params.mergedSummaryText ?? '',
    'summary.start': String(params.startFloor ?? ''), 'summary.end': String(params.endFloor ?? ''), 'summary.kind': params.kind === 'mega' ? '大总结' : '普通总结',
    'summary.persona': fields.persona ?? '', 'summary.character': fields.description ?? '', 'summary.personality': fields.personality ?? '', 'summary.scenario': fields.scenario ?? '', 'summary.examples': fields.mesExamples ?? '',
    'summary.world_before': '', 'summary.world_after': '', 'summary.depth': '',
  };
  const scan = st?.getWorldInfoPrompt ?? ctx.getWorldInfoPrompt;
  if (scan) {
    const omitted = await omittedWorldInfo(token);
    const world = await scan([params.scanText ?? values['summary.material']], ctx.chatCompletionSettings?.openai_max_context ?? st?.chatCompletionSettings?.openai_max_context ?? 32000, true, { ...WORLD_SCAN_DATA });
    checkContext(token);
    const clean = text => {
      let value = String(text ?? '').replace(/\r\n/g, '\n');
      // ST joins whole world-info entries with newlines. A short summary may
      // also occur inside an ordinary sentence, which must remain intact.
      for (const entry of omitted) {
        const block = escapeRegex(entry.replace(/\r\n/g, '\n'));
        value = value.replace(new RegExp('^[ \\t]*' + block + '[ \\t]*(?:\\n|$)', 'gm'), '');
      }
      return value.replace(/<UpdateVariable\b[^>]*>[\s\S]*?<\/UpdateVariable\s*>/gi, '')
        .replace(/\[mvu_update\][\s\S]*?\[\/mvu_update\]/gi, '')
        .replace(/^[ \t]*\[mvu_update\].*$/gim, '').trim();
    };
    values['summary.world_before'] = clean(world?.worldInfoBefore);
    values['summary.world_after'] = clean(world?.worldInfoAfter);
  }
  checkContext(token);
  for (const name of Object.values(builtinNames)) {
    const key = `summary.${name}`;
    values[key] = expandIdentityMacros(values[key], values);
  }
  return values;
}
export function expandMacros(text, values, customMacros = []) {
  const customs = new Map(customMacros.map(macro => [macro.name, macro.content]));
  const pattern = new RegExp(`${IDENTITY_MACRO_SOURCE}|\\{\\{([\\w.-]+)\\}\\}`, 'gi');
  const resolve = (source, stack = []) => String(source ?? '').replace(pattern, (whole, curly, legacy, name) => {
    if (curly || legacy) return identityMacroValue(curly ?? legacy, values) ?? whole;
    if (Object.hasOwn(values, name)) return values[name]; // Materials are opaque; never expand their embedded instructions/macros.
    if (!customs.has(name)) return whole;
    if (stack.includes(name) || stack.length >= 12) throw new Error(`自定义宏循环引用：${name}`);
    return resolve(customs.get(name), [...stack, name]);
  });
  return resolve(text);
}
export async function compilePrompt(params, settings) {
  const resultFormat=activeResultFormat(params.promptBlocks);
  const values = { ...(params.macroValues ?? await snapshotContext(params, settings)), 'summary.output_format': formatInstruction(resultFormat), 'summary.depth': '' };
  const expand = text => expandMacros(text, values, settings.customMacros);
  const messages = [];
  const add = (content, role = 'system') => { if (content?.trim()) messages.push({ role, content }); };
  const adapters = (params.promptBlocks ?? []).filter(block => block.choiceGroup === 'adapter');
  if (adapters.length && !adapters.some(block => block.enabled && expand(block.content).trim())) add(ADAPTER_PROMPTS.standard);
  for (const block of params.promptBlocks ?? []) {
    if (!block.enabled) continue;
    if (block.type === BLOCK_TYPES.BUILTIN_GROUP) {
      if (block.content !== undefined) add(expand(block.content), block.role);
      else add(BUILTIN_PROMPTS.map(name => values[`summary.${builtinNames[name]}`]).filter(Boolean).join('\n\n'), block.role ?? 'user');
    } else if (block.type === BLOCK_TYPES.OLD_SUMMARY) {
      add(`<prior_memory>\n${values['summary.history']}\n</prior_memory>`, block.role);
    } else if (block.type === BLOCK_TYPES.CHAT_MESSAGES) {
      const tag = block.xmlTag || 'source_material'; add(`${expand(block.leadText)}\n<${tag}>\n${values['summary.material']}\n</${tag}>`, block.role);
    } else add(expand(block.content), block.role);
  }
  const appendUser = content => {
    if (!content?.trim()) return;
    const lastUser = messages.findLast(message => message.role === 'user');
    if (lastUser) lastUser.content += '\n\n' + content;
    else add(content, 'user');
  };
  if(!messages.some(message=>message.role!=='assistant'&&message.content.includes(OUTPUT_CONTRACT)))appendUser(OUTPUT_CONTRACT);
  const prefill = messages.at(-1)?.role === 'assistant' ? messages.at(-1).content : '';
  const orderedPrompts = messages;
  return { orderedPrompts, prefill, resultFormat, macroValues: values };
}
export const generationApi = () => helperApi('generateRaw') ?? (typeof window !== 'undefined' ? window.generateRaw ?? window.parent?.generateRaw : undefined);
