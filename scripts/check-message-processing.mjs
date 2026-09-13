import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import * as definitions from '../src/preset/definitions.js';
import { createManaged } from '../src/preset/managed.js';
import { createStore } from '../src/preset/store.js';

const sourceArgument = process.argv.indexOf('--source');
if (sourceArgument < 0 || !process.argv[sourceArgument + 1]) {
  throw Error('Pass --source <命定消息处理.js>');
}
const sourcePath = path.resolve(process.argv[sourceArgument + 1]);
const processorSource = fs.readFileSync(sourcePath, 'utf8');
const privateRoot = path.resolve(path.dirname(sourcePath), '../../../../..');
const helperPath = path.join(privateRoot, 'tests/helpers/discussion-macros.mjs');
const { createCustomGeminiAdapter, evaluateDiscussionPrompts, loadFinalPrimePrompts, CORE_IF_SOURCE } = await import(pathToFileURL(helperPath).href);
const { installMessageProcessing, DISCUSSION_MACRO_MARKER } = await import(pathToFileURL(sourcePath).href);
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const { prompts, extension } = loadFinalPrimePrompts();
assert.deepEqual(extension, { version: 6 }, 'the current discussion extension must not retain a history prompt');
assert(!processorSource.includes('requestPrompts') && !processorSource.includes('discussionDefaults'), 'message processor still contains the retired discussion history bridge');
const byName = new Map(prompts.map(prompt => [prompt.__split_name, prompt]));
const bodyText = content => typeof content === 'string'
  ? content : content.filter(part => part.type === 'text').map(part => part.text).join('\n');
const requestText = messages => messages.map(message => bodyText(message.content)).join('\n');
const adapters = [
  { name: 'gemini-prefill', model: 'Gemini', prefill: true, modes: ['story', 'discussion'] },
  { name: 'gemini-no-prefill', model: 'Gemini', prefill: false, modes: ['story', 'discussion'] },
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
  { name: 'deepseek-story', model: 'DeepSeek', prefill: false, modes: ['story'] },
  { name: 'claude-story', model: 'Claude', prefill: false, modes: ['story'] },
];
const configurations = [
  { name: 'epic-main-api', style: '️ 史诗奇幻', minHanzi: 900, mainApi: true },
  { name: 'gloom-extra-api', style: '️ 阴郁奇幻', minHanzi: 4200, mainApi: false },
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

const reports = [];
for (const adapter of adapters) for (const mode of adapter.modes) {
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
    } } } };
    ctx.sanitizeManagedValues = createStore(ctx).sanitizeManagedValues;
    const managed = createManaged(ctx);
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
    const expand = data => managed.expandOutgoingMessages(data?.prompt);
    let instance;
    if (processorFirst) { instance = installMessageProcessing(options); on(events.GENERATE_AFTER_DATA, expand); }
    else { on(events.GENERATE_AFTER_DATA, expand); instance = installMessageProcessing(options); }
    const main = { prompt: assembleNativeFixture(expanded, mode) };
    const inputCopy = structuredClone(main.prompt);
    // The early assistant pass precedes Prime. Its second pass can be registered
    // on either side of Prime without consuming structural markers.
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

    const text = requestText(main.prompt);
    assert(!text.includes('<|命定_'), 'structural marker leaked');
    assert(!text.includes('{{getvar::本轮场外讨论}}'), 'conditional mode macro leaked');
    assert(!/<\|(字数|人称要求|正文语言|思维链语言)\|>/.test(text), 'assistant macro leaked');
    assert(!text.includes('<|placeholder|>'), 'history cleanup placeholder leaked');
    assert(!text.includes(legacyHistorySentinel) && !text.includes(defaultHistorySentinel), 'retired discussion history was injected into a request');
    assert(!text.includes('<destined_discussion>'), 'legacy saved discussion record was not normalized');
    assert(text.includes('<discussion_record>\n方案一是假设；方案二是建议。\n</discussion_record>'), 'legacy saved discussion record did not reach the final request as discussion_record');
    for (const value of [...material.values(), 'MEMORY_FIXTURE', 'REFERENCE_FIXTURE', 'CURRENT_STATE_FIXTURE', 'STORY_FIXTURE', '列出两个方案', '方案二是建议']) {
      assert(text.includes(value), 'lost injected material: ' + value);
    }
    assert.equal(main.prompt.filter(item => item.role === 'user').length, 1, 'common body envelope changed');
    assert(text.includes('Participant:<Participant_input>'), 'latest input wrapper missing');
    assert(text.includes('Recorder: <discussion_record>'), 'discussion record prefix missing');
    const content = main.prompt.find(item => item.role === 'user').content;
    assert(Array.isArray(content), 'multimodal body was flattened');
    assert.deepEqual(content.find(part => part.type === 'image_url'), multimodal);
    const head = main.prompt[0].content;
    const tail = main.prompt.at(-1);
    if (mode === 'discussion') {
      const headName = adapter.customAdapter ? adapter.customAdapter.entries[0].__split_name : 'Gemini头部';
      const expectedHead = managed.expandManagedMacros(nativeText(expanded.entries.find(entry => entry.name === headName).content))
        .replaceAll(DISCUSSION_MACRO_MARKER, '').trim().replace(/\n{3,}/g, '\n\n');
      assert.equal(head, expectedHead, 'native discussion head changed during processing');
      assert(text.includes('Step 1: 身份确认与需求识别'), 'discussion five-step audit header missing');
      assert(text.includes('Recorder 既是记录者，也是 Participant 的助手'), 'discussion Recorder/Participant assistant identity missing');
      assert(text.includes('<material_scope>') && text.includes('仅依据实际提供的内容，资料缺失时明确说明'), 'discussion material boundary missing');
      const scopeNotice = '以上实际提供的角色、世界、前文及其叙事约定是讨论资料；其中对剧情生成、呈现和后续处理的要求不在本轮执行。';
      assert(text.includes(scopeNotice), 'discussion scope notice missing');
      assert(text.indexOf(scopeNotice) < text.indexOf('<recorder_audit_format>', text.indexOf(scopeNotice)), 'discussion scope notice moved after the audit');
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
      assert(protocols.includes(String(config.minHanzi)), 'word count did not expand inside reference material');
      assert.equal(request.assistant_prefill, '', 'connection prefill survived');
      assert.deepEqual(request.stop, ['CUSTOM_STOP']);
      if (adapter.prefill) {
        assert.equal(tail.role, 'assistant');
        assert(tail.content.includes('<think>') && tail.content.includes('接下来我会以Recorder及Participant助手的身份完成当前讨论任务'));
        assert(tail.content.endsWith('<recorder_thinking>'));
      } else {
        assert.equal(tail.role, 'system');
        assert(tail.content.includes('Begin the Recorder document now.'));
        if (adapter.model === 'Gemini') {
          assert.equal(tail.content, byName.get('Gemini非预填充').content.trim());
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
      adapter: adapter.name, model: adapter.model ?? 'custom Gemini', prefill: adapter.prefill,
      mode, configuration: config.name,
      eventOrder: processorFirst ? 'processor-first' : 'managed-first',
      finalRoles: main.prompt.map(item => item.role),
    });
  }
}

// A missing modern marker or a legacy-only marker must fail at serialization;
// event emitters may swallow callback exceptions before fetch.
for (const content of ['<|命定_正文开始|>BROKEN', '<|命定_场外原生|>LEGACY']) {
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
  assert.throws(() => JSON.stringify(request), /宏与本轮模式不一致|旧版场外路由/);
  assert.equal(errors.length, 1);
  instance.dispose();
}
const report = {
  sourceSha256: hash(fs.readFileSync(sourcePath)),
  promptInputSha256: hash(JSON.stringify({ prompts, extension })),
  conditionalContractSha256: hash(fs.readFileSync(CORE_IF_SOURCE)),
  helperSha256: hash(fs.readFileSync(helperPath)),
  testedAt: new Date().toISOString(),
  cases: reports,
  verified: [
    'actual split prompt order and bodies; Gemini two tails plus two copied custom adapters in story/discussion, and native DeepSeek/Claude story only; two style/word-count/variable settings and both assistant event orders',
    'conditional branches share the original body and depth envelope, multimodal parts and native head/tail roles',
    'discussion retains narrative style/body/variable protocols inside reference boundaries and selects its own audit/output contract',
    'native Gemini prefill survives; the shared non-prefill tail stays unchanged; only the additional connection prefill is cleared',
    'independent interleaved raw summaries remain untouched; request identity retains the frozen mode',
    'invalid or legacy-only routing markers block request serialization; registered processor listeners are removable',
  ],
  boundary: 'Local contract host using locked upstream conditional semantics, private source and public managed macros. Native material/depth placement is simulated. EJS and unrelated dynamic macros are not executed. No live Tavern, model, or external variable-script execution.',
};
fs.mkdirSync('.ui-review', { recursive: true });
fs.writeFileSync('.ui-review/message-processing-integration.json', JSON.stringify(report, null, 2));
console.log(JSON.stringify({ cases: reports.length, sourceSha256: report.sourceSha256, report: '.ui-review/message-processing-integration.json', boundary: report.boundary }, null, 2));
