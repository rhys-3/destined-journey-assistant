import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import * as definitions from '../src/preset/definitions.js';
import { createManaged } from '../src/preset/managed.js';
import { createNoise } from '../src/preset/noise.js';
import { createStore } from '../src/preset/store.js';
import { discussionAdapterSupport } from '../src/discussion/adapter.js';
import { prepareToolOutputRequest, TOOL_OUTPUT_NAME } from '../src/preset/tool-output.js';

const sourceArgument = process.argv.indexOf('--source');
if (sourceArgument < 0 || !process.argv[sourceArgument + 1]) {
  throw Error('Pass --source <命定消息处理.js>');
}
const sourcePath = path.resolve(process.argv[sourceArgument + 1]);
const processorSource = fs.readFileSync(sourcePath, 'utf8');
const privateRoot = path.resolve(path.dirname(sourcePath), '../../../../..');
const helperPath = path.join(privateRoot, 'tests/helpers/discussion-macros.mjs');
const { createCustomGeminiAdapter, evaluateDiscussionPrompts, loadFinalPrimePrompts, CORE_IF_SOURCE } = await import(pathToFileURL(helperPath).href);
const { installMessageProcessing, processDestinedMessages, DISCUSSION_MACRO_MARKER } = await import(pathToFileURL(sourcePath).href);
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const adapterSourceUrl = new URL('../src/discussion/adapter.js', import.meta.url);
const { prompts, extension } = loadFinalPrimePrompts();
assert.deepEqual(extension, { version: 6 }, 'the current discussion extension must not retain a history prompt');
assert(!processorSource.includes('requestPrompts') && !processorSource.includes('discussionDefaults'), 'message processor still contains the retired discussion history bridge');
const byName = new Map(prompts.map(prompt => [prompt.__split_name, prompt]));

// The message-processor envelope, the five-step audit fields, and the scope
// notice are shared, but every provider keeps its own native head, thinking
// container, tail, and visible body schema.
const discussionModels = {
  Gemini: { head: 'Gemini头部', thinking: 'Gemini思维链', tail: 'Gemini非预填充', prefillTail: 'Gemini预填充', toolTails: { single: 'Gemini工具一次调用', split: 'Gemini工具两次调用' }, audit: 'recorder_audit_format', bodyThinking: true },
  Claude: { head: 'Claude头部', thinking: 'Claude思维链', tail: 'Claude尾部', audit: 'recorder_audit_format', bodyThinking: true },
  DeepSeek: { head: 'DeepSeek头部', thinking: 'DeepSeek思维链', tail: 'DeepSeek尾部', audit: 'think_format', bodyThinking: false },
  Glm: { head: 'Glm头部', thinking: 'Glm思维链', tail: 'Glm尾部', audit: 'think_format', bodyThinking: false },
};
const tailChannelMarker = {
  Gemini: 'Begin the Recorder document now.',
  Claude: 'Recorder',
  DeepSeek: 'reasoning_content',
  Glm: 'reasoning_content',
};
// The native tail and the discussion thinking branch must name the same
// reasoning channel opening. Extracting it keeps the check free of the
// provider-private separator characters.
const reasoningOpening = value => String(value).match(/以\s*`?([^`\n]+?)`?\s*(?:为)?开头/)?.[1] ?? '';
const bodyText = content => typeof content === 'string'
  ? content : content.filter(part => part.type === 'text').map(part => part.text).join('\n');
const requestText = messages => messages.map(message => bodyText(message.content)).join('\n');
const adapters = [
  { name: 'gemini-prefill', model: 'Gemini', prefill: true, modes: ['story', 'discussion'] },
  { name: 'gemini-no-prefill', model: 'Gemini', prefill: false, modes: ['story', 'discussion'] },
  { name: 'gemini-tool', model: 'Gemini', prefill: false, tool: 'single', modes: ['story', 'discussion'] },
  { name: 'gemini-tool-split', model: 'Gemini', prefill: false, tool: 'split', modes: ['story', 'discussion'] },
  {
    name: 'custom-prefill',
    prefill: true,
    modes: ['story', 'discussion'],
    customAdapter: createCustomGeminiAdapter({ id: 'model:integration-prefill', label: '集成自定义预填充', prefill: true }),
  },
  {
    name: 'custom-no-prefill',
    prefill: false,
    modes: ['story', 'discussion'],
    customAdapter: createCustomGeminiAdapter({ id: 'model:integration-no-prefill', label: '集成自定义非预填充', prefill: false }),
  },
  {
    name: 'custom-tool',
    prefill: false,
    tool: 'single',
    modes: ['story', 'discussion'],
    customAdapter: createCustomGeminiAdapter({ id: 'model:integration-tool', label: '集成自定义工具', tool: 'single' }),
  },
  {
    name: 'custom-tool-split',
    prefill: false,
    tool: 'split',
    modes: ['story', 'discussion'],
    customAdapter: createCustomGeminiAdapter({ id: 'model:integration-tool-split', label: '集成自定义工具', tool: 'split' }),
  },
  { name: 'deepseek', model: 'DeepSeek', prefill: false, modes: ['story', 'discussion'] },
  { name: 'claude', model: 'Claude', prefill: false, modes: ['story', 'discussion'] },
  { name: 'glm', model: 'Glm', prefill: false, modes: ['story', 'discussion'] },
];
const configurations = [
  { name: 'epic-main-minimum', style: '️ 史诗奇幻', minHanzi: 900, maxHanzi: 2500, lengthMode: 'minimum', requirement: '不少于900', mainApi: true },
  { name: 'gloom-extra-maximum', style: '️ 阴郁奇幻', minHanzi: 4200, maxHanzi: 800, lengthMode: 'maximum', requirement: '不多于800', mainApi: false },
  { name: 'epic-extra-range', style: '️ 史诗奇幻', minHanzi: 1500, maxHanzi: 2500, lengthMode: 'range', requirement: '1500—2500', mainApi: false },
];
const nativeText = text => String(text).replaceAll('{{user}}', 'CURRENT_USER').replaceAll('{{char}}', 'CURRENT_CHARACTER');
const message = (role, content) => ({ role, content });
const material = new Map([
  ['worldInfoBefore', 'WORLD_FIXTURE'],
  ['personaDescription', 'PERSONA_FIXTURE'],
  ['charDescription', 'CHARACTER_FIXTURE'],
  ['charPersonality', 'PERSONALITY_FIXTURE'],
  ['scenario', 'SCENARIO_FIXTURE'],
  ['worldInfoAfter', 'WORLD_AFTER_FIXTURE'],
  ['dialogueExamples', 'EXAMPLE_FIXTURE'],
]);
const multimodal = { type: 'image_url', image_url: { url: 'data:image/png;base64,TEST_FIXTURE', detail: 'low' } };
const legacyHistorySentinel = 'LEGACY_DISCUSSION_HISTORY_MUST_NOT_BE_INJECTED';
const defaultHistorySentinel = 'DEFAULT_DISCUSSION_HISTORY_MUST_NOT_BE_INJECTED';

// Material substitutes the native marker values and depth injections. Actual
// prompt bodies and order come from the private split; no preset is copied here.
// EJS and unrelated dynamic macros remain inert material in this local host.
function assembleNativeFixture(expanded, mode) {
  const entries = new Map(expanded.entries.map(entry => [entry.name, entry]));
  const history = [
    message('system', 'MEMORY_FIXTURE'),
    message('system', entries.get('深度九百').content),
    message('system', 'REFERENCE_FIXTURE'),
    message('user', '<|placeholder|>'),
    message('assistant', '<gametxt>STORY_FIXTURE</gametxt>'),
    message('user', '<discussion_record>\n列出两个方案\n</discussion_record>'),
    message('assistant', '<destined_discussion>\n方案一是假设；方案二是建议。\n</destined_discussion>'),
    message('system', entries.get('深度二').content),
    message('system', 'CURRENT_STATE_FIXTURE'),
    message('user', [
      { type: 'text', text: mode === 'discussion'
        ? '<discussion_record>\n采用第二个方案，后续按这个动机写。\n</discussion_record>'
        : '继续剧情，沿用已确认的动机。' },
      structuredClone(multimodal),
    ]),
  ];
  return expanded.entries.flatMap(entry => {
    const source = byName.get(entry.name) ?? entry;
    if (source.injection_position === 1) return [];
    if (source.identifier === 'chatHistory') return history;
    const content = source.marker ? material.get(source.identifier) ?? '' : nativeText(entry.content);
    return content.trim() ? [message(entry.role, content)] : [];
  });
}

// The assistant only offers discussion when discussionAdapterSupport admits the
// model entries that are actually enabled. Feed it the real private split
// (native ids, roles, raw templates) plus the real registry metadata for each
// tested model, and require admission instead of assuming the selection passes.
const supportPrompts = () => prompts.map(prompt => ({
  id: prompt.identifier, role: prompt.role, enabled: false,
  position: { type: 'relative' }, content: prompt.content,
}));
function resolveModelRegistry(model) {
  const builtinKey = Object.keys(definitions.BUILTIN_MODEL_ADAPTERS)
    .find(key => key.toLowerCase() === model.toLowerCase());
  if (builtinKey) return {
    key: builtinKey,
    entry: definitions.BUILTIN_MODEL_ADAPTERS[builtinKey],
    source: 'src/preset/definitions.js BUILTIN_MODEL_ADAPTERS.' + builtinKey,
  };
  // Models without a builtin entry keep their real metadata in the private
  // split frontmatter (`extra.destined_model`), so read it there instead of
  // guessing ids in this script.
  const parts = ['head', 'thinking', 'tail'];
  const grouped = prompts.filter(prompt => prompt.__split_name.startsWith(model) && prompt.extra?.destined_model?.id);
  if (!grouped.length) return null;
  const ordered = [...grouped].sort((a, b) => parts.indexOf(a.extra.destined_model.part) - parts.indexOf(b.extra.destined_model.part));
  return {
    key: ordered[0].extra.destined_model.id,
    entry: { label: model, ids: ordered.map(prompt => prompt.identifier), tails: [], custom: true },
    source: ordered.map(prompt => 'split/prime/prompts/' + prompt.__split_name + '.md').join(' + ') + ' extra.destined_model',
  };
}
function adapterSupportFor(adapter) {
  const model = adapter.customAdapter ? adapter.customAdapter.id : adapter.model;
  const spec = discussionModels[adapter.customAdapter ? 'Gemini' : adapter.model];
  const enabledTail = adapter.prefill && spec.prefillTail ? spec.prefillTail : adapter.tool ? spec.toolTails[adapter.tool] : spec.tail;
  const ids = adapter.customAdapter
    ? adapter.customAdapter.entries.map(entry => entry.id)
    : [spec.head, spec.thinking, enabledTail].map(name => byName.get(name).identifier);
  const resolved = adapter.customAdapter
    ? { key: adapter.customAdapter.id, entry: { label: adapter.customAdapter.label, ids, tails: [], custom: true }, source: 'custom model copies of the native Gemini head/thinking/tail' }
    : resolveModelRegistry(adapter.model);
  if (!resolved) return {
    adapter: adapter.name, model, source: 'unresolved', checked: false,
    available: false, reason: 'no builtin registry entry and no split destined_model metadata',
  };
  const preset = { prompts: supportPrompts() };
  for (const prompt of preset.prompts) prompt.enabled = ids.includes(prompt.id);
  if (adapter.customAdapter) for (const entry of adapter.customAdapter.entries)
    preset.prompts.push({ id: entry.id, role: entry.role, enabled: true, position: { type: 'relative' }, content: entry.content });
  // The gate must be fed the tail the model really enables: prefill tails are
  // native assistant entries, every other tail stays a system entry.
  const tailPrompt = preset.prompts.find(prompt => prompt.id === ids.at(-1));
  assert(tailPrompt, adapter.name + ' gate fixture is missing its enabled tail');
  assert.equal(tailPrompt.role, adapter.prefill ? 'assistant' : 'system', adapter.name + ' gate fixture enabled the wrong tail role');
  const registry = Object.hasOwn(definitions.BUILTIN_MODEL_ADAPTERS, resolved.key)
    ? definitions.BUILTIN_MODEL_ADAPTERS
    : { ...definitions.BUILTIN_MODEL_ADAPTERS, [resolved.key]: resolved.entry };
  return { adapter: adapter.name, model, source: resolved.source, checked: true, ...discussionAdapterSupport(preset, registry) };
}
const adapterSupportResults = adapters.map(adapterSupportFor);

const reports = [];
const noiseOnly = process.argv.includes('--noise-only');
for (const adapter of noiseOnly ? [] : adapters) for (const mode of adapter.modes) {
  for (const config of configurations) for (const processorFirst of [true, false]) {
    const enabled = Object.fromEntries(prompts.filter(prompt => prompt.extra?.destined_ui?.group === 'main-style')
      .map(prompt => [prompt.__split_name, prompt.__split_name === config.style]));
    enabled.主接口变量 = config.mainApi;
    enabled.额外接口变量 = !config.mainApi;
    const expanded = evaluateDiscussionPrompts({ ...adapter, mode, enabled });
    const events = { GENERATE_AFTER_DATA: 'data', CHAT_COMPLETION_SETTINGS_READY: 'ready', OAI_PRESET_CHANGED_AFTER: 'preset' };
    const listeners = new Map(), errors = [];
    const on = (event, fn) => listeners.set(event, [...(listeners.get(event) ?? []), fn]);
    const off = (event, fn) => listeners.set(event, (listeners.get(event) ?? []).filter(item => item !== fn));
    const emit = async (event, ...args) => { for (const fn of listeners.get(event) ?? []) await fn(...args); };
    const ctx = { ...definitions, state: { config: { managed_values: {
      ...definitions.DEFAULT_MANAGED_VALUES, min_hanzi: config.minHanzi,
      max_hanzi: config.maxHanzi, length_mode: config.lengthMode,
    } } } };
    ctx.sanitizeManagedValues = createStore(ctx).sanitizeManagedValues;
    const managed = createManaged(ctx);
    const noise = createNoise(ctx);
    let frozenMode = mode, readinessCalls = 0;
    const preparedOutputs = [];
    const options = {
      on, last: on, off, events,
      requestMode: () => frozenMode,
      assertRequestReady: () => { readinessCalls += 1; },
      // The private processor must ignore the retired bridge data in both
      // modes. Its only valid discussion context is the real chat record.
      requestPrompts: () => ({ ...extension, history: legacyHistorySentinel, defaultHistory: defaultHistorySentinel }),
      notify: value => errors.push(value),
      onPreparedOutput: output => { preparedOutputs.push(output); return true; },
    };
    const expand = data => { noise.inspectNoiseOutgoing(data?.prompt); managed.expandOutgoingMessages(data?.prompt); };
    let instance;
    if (processorFirst) { instance = installMessageProcessing(options); on(events.GENERATE_AFTER_DATA, expand); }
    else { on(events.GENERATE_AFTER_DATA, expand); instance = installMessageProcessing(options); }
    const main = { prompt: assembleNativeFixture(expanded, mode) };
    const inputCopy = structuredClone(main.prompt);
    // The early assistant pass precedes Prime. Its second pass can be registered
    // on either side of Prime without consuming structural markers.
    noise.inspectNoiseOutgoing(main.prompt);
    managed.expandOutgoingMessages(main.prompt);
    await emit(events.GENERATE_AFTER_DATA, main, false);
    assert.deepEqual(preparedOutputs, [{ recorderPrefill: mode === 'discussion' && adapter.prefill === true }]);
    const request = { messages: main.prompt, assistant_prefill: 'CONNECTION_PREFILL', stop: ['CUSTOM_STOP'] };

    // Interleave independent raw summary requests before the main request's
    // settings-ready event. The request-array identity must retain its mode.
    const callsBeforeSummaries = readinessCalls;
    const summaries = [
      { messages: [message('system', 'SUMMARY_RULE'), message('user', 'SUMMARY_SOURCE')], assistant_prefill: 'SUMMARY_PREFILL', stop: ['SUMMARY_STOP'] },
      { messages: [message('user', [{ type: 'text', text: 'OTHER_SUMMARY' }, structuredClone(multimodal)])], temperature: 0.3 },
    ];
    const summaryCopies = structuredClone(summaries);
    for (const summary of summaries) {
      await emit(events.GENERATE_AFTER_DATA, { prompt: summary.messages }, false);
      await emit(events.CHAT_COMPLETION_SETTINGS_READY, summary);
    }
    assert.deepEqual(summaries, summaryCopies);
    assert.equal(readinessCalls, callsBeforeSummaries, 'independent request consulted discussion mode');
    assert.equal(preparedOutputs.length, 1, 'independent summary changed the reply output contract');
    frozenMode = mode === 'story' ? 'discussion' : 'story';
    await emit(events.CHAT_COMPLETION_SETTINGS_READY, request);

    // The assistant's fetch transport consumes the tool-output marker last.
    const toolRequest = prepareToolOutputRequest(request);
    if (adapter.tool) {
      assert(toolRequest?.active, adapter.name + ' did not reach the transport as a tool-output request');
      assert.deepEqual(toolRequest.body.tools.map(tool => tool.function.name), [TOOL_OUTPUT_NAME]);
      assert.equal(toolRequest.body.tool_choice, 'auto');
      // Only the two-call tail carries the continuation that asks for the body.
      if (adapter.tool === 'split') assert(toolRequest.continuation.includes('<recorder_body>') && toolRequest.continuation.includes(TOOL_OUTPUT_NAME), adapter.name + ' lost its continuation prompt');
      else assert.equal(toolRequest.continuation, '', adapter.name + ' unexpectedly asked for a second request');
      main.prompt = toolRequest.body.messages;
    } else assert.equal(toolRequest, null, adapter.name + ' unexpectedly carried the tool-output marker');

    const text = requestText(main.prompt);
    assert(!text.includes('<|命定_'), 'structural marker leaked');
    assert(!text.includes('{{destined_prompt_noise}}'), 'disabled noise macro leaked');
    assert(!text.includes('{{getvar::本轮场外讨论}}'), 'conditional mode macro leaked');
    assert(!/<\|(字数|字数要求|人称要求|正文语言|思维链语言)\|>/.test(text), 'assistant macro leaked');
    const lengthControl = text.match(/<length_control\b[^>]*>([\s\S]*?)<\/length_control>/)?.[1];
    assert(lengthControl?.includes('可见文字字符数要求：' + config.requirement + '。'), 'selected length requirement did not reach the final request');
    assert(!text.includes('<|placeholder|>'), 'history cleanup placeholder leaked');
    assert(!text.includes(legacyHistorySentinel) && !text.includes(defaultHistorySentinel), 'retired discussion history was injected into a request');
    assert(!text.includes('<destined_discussion>'), 'legacy saved discussion record was not normalized');
    assert(text.includes('<discussion_record>\n方案一是假设；方案二是建议。\n</discussion_record>'), 'legacy saved discussion record did not reach the final request as discussion_record');
    for (const value of [...material.values(), 'MEMORY_FIXTURE', 'REFERENCE_FIXTURE', 'CURRENT_STATE_FIXTURE', 'STORY_FIXTURE', '列出两个方案', '方案二是建议']) {
      assert(text.includes(value), 'lost injected material: ' + value);
    }
    assert.equal(main.prompt.filter(item => item.role === 'user').length, 1, 'common body envelope changed');
    if (adapter.tool) {
      assert(text.includes('Participant:<Participant_input ref="tool">'), 'tool input placeholder missing');
      const latestInput = mode === 'discussion' ? '采用第二个方案，后续按这个动机写。' : '继续剧情，沿用已确认的动机。';
      assert(toolRequest.body.tools[0].function.description.includes(latestInput), 'latest input did not reach the tool description');
    } else assert(text.includes('Participant:<Participant_input>'), 'latest input wrapper missing');
    assert(text.includes('Recorder: <discussion_record>'), 'discussion record prefix missing');
    const content = main.prompt.find(item => item.role === 'user').content;
    assert(Array.isArray(content), 'multimodal body was flattened');
    assert.deepEqual(content.find(part => part.type === 'image_url'), multimodal);
    const head = main.prompt[0].content;
    const tail = main.prompt.at(-1);
    if (mode === 'discussion') {
      const specModel = adapter.customAdapter ? 'Gemini' : adapter.model;
      const spec = discussionModels[specModel];
      const headName = adapter.customAdapter ? adapter.customAdapter.entries[0].__split_name : spec.head;
      const thinkingName = adapter.customAdapter ? adapter.customAdapter.entries[1].__split_name : spec.thinking;
      const tailName = adapter.customAdapter ? adapter.customAdapter.entries[2].__split_name
        : adapter.prefill && spec.prefillTail ? spec.prefillTail : adapter.tool ? spec.toolTails[adapter.tool] : spec.tail;
      const headSource = adapter.customAdapter ? adapter.customAdapter.entries[0].content : byName.get(headName).content;
      const tailSource = expanded.entries.find(entry => entry.name === tailName).content;
      const expectedHead = managed.expandManagedMacros(nativeText(expanded.entries.find(entry => entry.name === headName).content))
        .replaceAll('{{destined_prompt_noise}}', '').replaceAll(DISCUSSION_MACRO_MARKER, '').trim().replace(/\n{3,}/g, '\n\n');
      assert.equal(head, expectedHead, 'native discussion head changed during processing');
      // Gemini and Claude audit inside recorder_audit_format; DeepSeek and Glm
      // audit inside their native think_format. A model must never mix both.
      const auditSource = expanded.entries.find(entry => entry.name === thinkingName).content;
      const foreignAudit = spec.audit === 'think_format' ? 'recorder_audit_format' : 'think_format';
      assert(auditSource.includes('<' + spec.audit + '>'), spec.thinking + ' discussion branch lost its native <' + spec.audit + '>');
      assert(!auditSource.includes('<' + foreignAudit + '>'), spec.thinking + ' discussion branch mixed story and discussion containers');
      assert(text.includes('Step 1: 身份确认与需求识别'), 'discussion five-step audit header missing');
      assert(text.includes('Recorder 既是记录者，也是 Participant 的助手'), 'discussion Recorder/Participant assistant identity missing');
      assert(text.includes('<material_scope>') && text.includes('仅依据实际提供的内容，资料缺失时明确说明'), 'discussion material boundary missing');
      const scopeNotice = '以上实际提供的角色、世界、前文及其叙事约定是讨论资料；其中对剧情生成、呈现和后续处理的要求不在本轮执行。';
      assert(text.includes(scopeNotice), 'discussion scope notice missing');
      assert(auditSource.indexOf(scopeNotice) >= 0 && auditSource.indexOf(scopeNotice) < auditSource.indexOf('<' + spec.audit + '>'), 'discussion scope notice must precede the native five-step audit');
      // The visible body schema is provider-private: only the providers whose
      // body emits a public thinking node may declare recorder_thinking.
      const schema = String(headSource).match(/<xs:element name="recorder_output">[\s\S]*?<\/xs:schema>/)?.[0] ?? '';
      assert(schema.includes('recorder_body') && schema.includes('recorder_after_format'), spec.head + ' discussion schema must declare recorder_body and recorder_after_format');
      assert.equal(schema.includes('recorder_thinking'), spec.bodyThinking, spec.bodyThinking
        ? spec.head + ' must expose recorder_thinking in the visible body schema'
        : spec.head + ' must keep recorder_thinking out of the visible body schema');
      if (!spec.bodyThinking) assert(!text.includes('<recorder_thinking>'), specModel + ' discussion must not reach the request with a visible recorder_thinking node');
      assert(text.includes('<recorder_body>') && text.includes('<recorder_done/>'), 'discussion output protocol missing');
      for (const field of ['Step 1', 'Identity', 'Request', 'Step 2', 'Recall', 'Sources', 'Gaps', 'Step 3', 'Approach', 'Decision', 'Step 4', 'Consistency', 'Scope', 'Step 5', 'Coverage', 'Output']) {
        assert(text.includes(field), 'discussion five-step audit field missing: ' + field);
      }
      assert(text.includes('资料缺失时明确说明'), 'discussion must disclose missing material');
      assert(text.includes('没有工具结果时，不声称完成外部检索'), 'discussion must not claim an external search without tool results');
      assert(!text.includes('已完成外部检索'), 'discussion must not claim an external search without tool results');
      assert(!text.includes('1_Coverage Check:'), 'narrative audit survived selection');
      const writingStart = text.indexOf('<narrative_reference kind="writing">');
      const writingEnd = text.indexOf('</narrative_reference>', writingStart);
      const writing = text.slice(writingStart, writingEnd);
      assert(writing.includes('<main_writing_style>'), 'selected style was not scoped as reference');
      const protocolStart = text.indexOf('<narrative_reference kind="body_protocols">');
      const protocolEnd = text.indexOf('</narrative_reference>', protocolStart);
      const protocols = text.slice(protocolStart, protocolEnd);
      assert(protocols.includes('<gametxt_module_protocols'), 'body protocols were removed');
      assert(protocols.includes(config.requirement), 'word count did not expand inside reference material');
      assert.equal(request.assistant_prefill, '', 'connection prefill survived');
      assert.deepEqual(request.stop, ['CUSTOM_STOP']);
      if (adapter.prefill) {
        assert.equal(tail.role, 'assistant');
        assert(tail.content.includes('<think>') && tail.content.includes('接下来我会以Recorder及Participant助手的身份完成当前讨论任务'), 'native Gemini discussion prefill identity changed');
        assert(tail.content.endsWith('<recorder_thinking>'), 'native Gemini discussion prefill boundary changed');
      } else {
        assert.equal(tail.role, 'system', 'the native non-prefill discussion tail must stay a system entry');
        const nativeTail = nativeText(tailSource).trim().replace(/\n{3,}/g, '\n\n');
        const sentTail = adapter.tool ? prepareToolOutputRequest({ messages: [{ role: 'system', content: nativeTail }] }).body.messages[0].content.trim() : nativeTail;
        assert.equal(tail.content, sentTail, 'native ' + tailName + ' discussion tail changed');
        if (adapter.tool) assert(!tail.content.includes('<|命定_'), tailName + ' leaked a transport marker');
        if (adapter.tool) assert(tail.content.includes(TOOL_OUTPUT_NAME) && tail.content.includes('<recorder_output>'), tailName + ' lost its tool delivery contract');
        else assert(tail.content.includes(tailChannelMarker[specModel]), tailName + ' lost its native reasoning channel marker');
        if (spec.audit === 'think_format') {
          const opening = reasoningOpening(tail.content);
          assert(opening && opening === reasoningOpening(auditSource), tailName + ' reasoning opening must match its discussion thinking branch');
        }
      }
    } else {
      assert(!text.includes('Step 1: 身份确认与需求识别'), 'discussion audit reached story');
      assert(!text.includes('<material_scope>'), 'discussion material scope reached story');
      assert(!text.includes('<narrative_reference'), 'discussion scope reached story');
      assert(text.includes('<gametxt_module_protocols'), 'story protocols lost');
      assert.equal(request.assistant_prefill, 'CONNECTION_PREFILL');
      assert.deepEqual(request.stop, ['CUSTOM_STOP', 'Participant:']);
    }
    assert.deepEqual(errors, []);
    assert.notDeepEqual(main.prompt, inputCopy);
    instance.dispose();
    assert.equal((listeners.get(events.CHAT_COMPLETION_SETTINGS_READY) ?? []).length, 0);
    reports.push({
      adapter: adapter.name, model: adapter.model ?? 'custom Gemini', prefill: adapter.prefill, tool: adapter.tool || false,
      mode, configuration: config.name, lengthMode: config.lengthMode, lengthRequirement: config.requirement,
      eventOrder: processorFirst ? 'processor-first' : 'managed-first',
      finalRoles: main.prompt.map(item => item.role),
    });
  }
}

// A missing modern marker or a legacy-only marker must fail at serialization;
// event emitters may swallow callback exceptions before fetch.
for (const [content, expected] of [
  ['<|命定_正文开始|>BROKEN', /缺少讨论标记|宏与本轮模式不一致/],
  ['<|命定_场外原生|>LEGACY', /旧版场外路由/],
]) {
  const listeners = new Map();
  const events = { GENERATE_AFTER_DATA: 'data', CHAT_COMPLETION_SETTINGS_READY: 'ready' };
  const errors = [];
  const instance = installMessageProcessing({
    events, on: (event, fn) => listeners.set(event, fn), off: event => listeners.delete(event),
    requestMode: () => 'discussion', notify: value => errors.push(value),
  });
  const request = { messages: [message('system', content)] };
  listeners.get('data')({ prompt: request.messages }, false);
  listeners.get('ready')(request);
  assert.throws(() => JSON.stringify(request), expected);
  assert.equal(errors.length, 1);
  instance.dispose();
}
// Exercise the real noise callback before Prime consumes its boundaries. The
// Native substitution is simulated; the prebuilt corpus is checked offline.
const noiseCases = [];
// The body pool is drawn on every expansion. One option per group keeps the
// noise and baseline requests comparable while still expanding the macros.
const fixedBodyPool = Object.fromEntries(Object.entries(definitions.DEFAULT_MANAGED_VALUES.body_pool)
  .map(([group, weights]) => [group, Object.fromEntries(Object.keys(weights).map((name, index) => [name, index === 0 ? 1 : 0]))]));
const fixedBodyPoolLines = ['女性: [骨感·平坦, 骨感·平坦, 骨感·平坦]', '男性: [瘦削, 瘦削, 瘦削]'];
{
  for (const adapter of adapters) for (const mode of adapter.modes) for (const [segments, noiseMode] of [[10, 'fixed'], [48, 'random']]) {
    let registration;
    const expanded = evaluateDiscussionPrompts({ ...adapter, mode });
    const original = assembleNativeFixture(expanded, mode);
    const ctx = { ...definitions, macroStops: [], presetIsMine: () => true, workspaceContextKey: () => 'noise-contract',
      getContext: () => ({ registerMacro: (name, callback) => { registration = { name, callback }; }, unregisterMacro() {} }),
      state: { preset: { prompts: expanded.entries.map(prompt => ({ ...prompt, id: prompt.identifier, enabled: true })) },
        config: { managed_values: { ...definitions.DEFAULT_MANAGED_VALUES, body_pool: fixedBodyPool }, noise_padding: { enabled: true, segments, mode: noiseMode } } } };
    ctx.sanitizeManagedValues = createStore(ctx).sanitizeManagedValues;
    const managed = createManaged(ctx);
    const noise = createNoise(ctx);
    noise.registerNoiseMacro();
    noise.beforeNoiseGeneration('normal');
    const padding = noise.readNoiseControl();
    assert.equal(padding.estimatedTokens, segments * 250);
    assert(padding.text && /^[\x00-\x7f]+$/.test(padding.text));
    const main = structuredClone(original);
    for (const item of main) {
      const expand = text => text.replaceAll('{{' + registration.name + '}}', registration.callback);
      if (typeof item.content === 'string') item.content = expand(item.content);
      else for (const part of item.content) if (part.type === 'text') part.text = expand(part.text);
    }
    assert.deepEqual(main.map(item => item.role), original.map(item => item.role), 'noise changed a native role');
    noise.inspectNoiseOutgoing(main);
    managed.expandOutgoingMessages(main);
    const result = processDestinedMessages(main, { mode });
    const protocol = result.find(item => bodyText(item.content).includes('<VOID_output_contract'));
    assert.equal(protocol.role, 'user');
    assert(!bodyText(protocol.content).includes(padding.text), 'noise reached the output protocol');
    const head = result.find(item => bodyText(item.content).includes(padding.text));
    const sourceHead = expanded.entries.find(item => item.content.includes('{{destined_prompt_noise}}'));
    assert.equal(head.role, sourceHead.role, 'noise must share the native model head role');
    assert(bodyText(head.content).trimStart().startsWith(padding.text), 'noise must lead the model head in the same message');
    assert(bodyText(head.content).indexOf(padding.text) < bodyText(head.content).indexOf('[CLEAR :: RESET ROLE'));
    assert(result.indexOf(head) < result.indexOf(protocol), 'noise moved into the body');
    assert.equal(requestText(result).split(padding.text).length - 1, 1, 'noise was inserted more than once');
    assert(!requestText(result).includes('{{destined_prompt_noise}}'));
    if (expanded.entries.some(item => item.content.includes('<|女性体型池|>'))) {
      assert(fixedBodyPoolLines.every(line => requestText(result).includes(line)), 'body pool macros must expand in the final request');
      assert(!/<\|(?:女性|男性)体型池\|>/u.test(requestText(result)), 'body pool macros leaked');
    }
    const baseline = structuredClone(original);
    const off = createNoise({ state: { config: {} } });
    off.inspectNoiseOutgoing(baseline);
    managed.expandOutgoingMessages(baseline);
    const expected = processDestinedMessages(baseline, { mode });
    const normalize = messages => messages.map(item => ({ ...item, content: typeof item.content === 'string'
      ? item.content.replace(padding.text, '').trimStart()
      : item.content.map(part => part.type === 'text' ? { ...part, text: part.text.replace(padding.text, '').trimStart() } : part) }));
    assert.deepEqual(normalize(result), normalize(expected), 'noise changed other prompts or message parts');
    noiseCases.push({ adapter: adapter.name, mode, noiseMode, segments, estimatedTokens: padding.estimatedTokens, headRole: head.role, protocolRole: protocol.role });
    noise.disposeNoise();
  }
}
const report = {
  sourceSha256: hash(fs.readFileSync(sourcePath)),
  promptInputSha256: hash(JSON.stringify({ prompts, extension })),
  conditionalContractSha256: hash(fs.readFileSync(CORE_IF_SOURCE)),
  helperSha256: hash(fs.readFileSync(helperPath)),
  testedAt: new Date().toISOString(),
  adapterSourceSha256: hash(fs.readFileSync(adapterSourceUrl)),
  adapterSupport: adapterSupportResults,
  cases: reports,
  noiseCases,
  verified: [
    'actual split prompt order and bodies; Gemini prefill, no-prefill, one-call and two-call tool-output tails plus four copied custom adapters and native Claude/DeepSeek/Glm in story and discussion; three length modes with style/variable settings and both assistant event orders',
    'every provider keeps its own native discussion head, thinking container (recorder_audit_format or think_format), tail and visible body schema; the five-step fields and the scope notice stay shared and ordered before the audit',
    'conditional branches share the original body and depth envelope, multimodal parts and native head/tail roles',
    'discussion retains narrative style/body/variable protocols inside reference boundaries and selects its own audit/output contract',
    'native Gemini prefill survives; non-prefill Gemini, Claude, DeepSeek and Glm tails match their expanded split entries after normal whitespace cleanup; only the additional connection prefill is cleared',
    'tool-output tails keep the assistant marker through managed expansion and message processing; the fetch transport then removes it and adds exactly one tool; only the two-call tail yields a continuation prompt, while every other tail reaches it unmarked',
    'independent interleaved raw summaries remain untouched; request identity retains the frozen mode',
    'invalid or legacy-only routing markers block request serialization; registered processor listeners are removable',
    'the native head/thinking/tail ids selected for each model are admitted by the assistant discussionAdapterSupport gate through the real registry entry or the split destined_model metadata',
  ],
  boundary: 'Local contract host using locked upstream conditional semantics, private source and public managed macros. Native material/depth placement is simulated. The discussionAdapterSupport gate is fed the real native ids, roles and raw templates plus the real registry metadata, but no live preset is edited and no assistant UI state is exercised. EJS and unrelated dynamic macros are not executed. No live Tavern, model, or external variable-script execution.',
};
fs.mkdirSync('.ui-review', { recursive: true });
fs.writeFileSync('.ui-review/message-processing-integration.json', JSON.stringify(report, null, 2));
const rejectedSupport = adapterSupportResults.filter(item => !item.available);
if (rejectedSupport.length) throw new Error('assistant discussionAdapterSupport must admit every tested discussion model: '
  + rejectedSupport.map(item => item.adapter + ' (' + item.model + ') via ' + item.source + ': ' + item.reason).join(' | '));
console.log(JSON.stringify({
  cases: reports.length,
  noiseCases: noiseCases.length,
  sourceSha256: report.sourceSha256,
  adapterSupport: adapterSupportResults.map(item => item.adapter + '=' + (item.available ? item.model : 'REJECTED')),
  report: '.ui-review/message-processing-integration.json',
  boundary: report.boundary,
}, null, 2));
