import { BUILTIN_MODEL_ADAPTERS } from '../preset/definitions.js';

const MODE_MACRO = /\{\{#?if\s+!?\{\{getvar::本轮场外讨论\}\}\}\}/;
const MARKER = '<|命定_场外讨论|>';
const DISCUSSION_THINKING = /<(?:recorder_audit_format|think_format)>/;

/** Inspect the selected native template, including editable model copies. */
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
  if (matches.length !== 1) return { available: false, reason: '请选择包含场外分支的模型，并完整启用对应头部、思维链和尾部。' };
  const [name, adapter] = matches[0];
  const head = String(prompts.get(adapter.ids[0])?.content ?? '');
  const thinking = String(prompts.get(adapter.ids[1])?.content ?? '');
  const tail = prompts.get(name === 'Gemini' ? adapter.tails.find(enabled) : adapter.ids.at(-1));
  if (!MODE_MACRO.test(head) || !head.includes(MARKER) || !MODE_MACRO.test(thinking)
    || !DISCUSSION_THINKING.test(thinking) || !thinking.includes('</narrative_reference>')
    || (tail?.role === 'assistant' && !MODE_MACRO.test(String(tail.content ?? '')))) {
    return { available: false, reason: '当前模型条目缺少讨论分支；可从包含讨论分支的完整条目复制头部、思维链及所需尾部后再开启。' };
  }
  return { available: true, model: name, reason: '' };
}
