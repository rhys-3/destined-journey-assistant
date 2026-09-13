import { BUILTIN_MODEL_ADAPTERS } from '../preset/definitions.js';

const MODE_MACRO = /\{\{#?if\s+!?\{\{getvar::本轮场外讨论\}\}\}\}/;
const MARKER = '<|命定_场外讨论|>';

/** Inspect the selected native template, including editable Gemini copies. */
export function discussionAdapterSupport(preset, registry = BUILTIN_MODEL_ADAPTERS) {
  const prompts = new Map((preset?.prompts ?? []).map(prompt => [prompt.id, prompt]));
  const enabled = id => prompts.get(id)?.enabled === true;
  const models = Object.entries(registry);
  const matches = models.filter(([name, adapter]) => {
    const own = adapter.ids.every(enabled);
    const others = models.filter(([other]) => other !== name)
      .every(([, other]) => [...other.ids, ...other.tails].every(id => !enabled(id)));
    return own && others && (name !== 'Gemini' || adapter.tails.filter(enabled).length === 1);
  });
  if (matches.length !== 1) return { available: false, reason: '请选择 Gemini 或包含场外分支的自定义模型，并完整启用对应头部、思维链和尾部。' };
  const [name, adapter] = matches[0];
  if (name !== 'Gemini' && adapter.custom !== true) return { available: false, reason: '讨论模式内置适配仅支持 Gemini；自定义模型可复制 Gemini 的讨论分支。' };
  const head = String(prompts.get(adapter.ids[0])?.content ?? '');
  const thinking = String(prompts.get(adapter.ids[1])?.content ?? '');
  const tail = prompts.get(name === 'Gemini' ? adapter.tails.find(enabled) : adapter.ids.at(-1));
  if (!MODE_MACRO.test(head) || !head.includes(MARKER) || !MODE_MACRO.test(thinking)
    || !thinking.includes('<recorder_audit_format>') || !thinking.includes('</narrative_reference>')
    || (tail?.role === 'assistant' && !MODE_MACRO.test(String(tail.content ?? '')))) {
    return { available: false, reason: '当前模型条目缺少讨论分支；可从 Gemini 复制头部、思维链及所需尾部后再开启。' };
  }
  return { available: true, model: name, reason: '' };
}
