import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createDiscussionController } from '../src/discussion/controller.js';
import { createDiscussionMessageAccess } from '../src/discussion/messages.js';
import { isDiscussionMessage, wrapDiscussion } from '../src/discussion/protocol.js';

const args = process.argv.slice(2);
const sourceIndex = args.indexOf('--source');
if (sourceIndex < 0 || !args[sourceIndex + 1]) {
  throw new Error('Usage: node scripts/check-discussion-output.mjs --source <思维链美化.js>');
}

const sourcePath = path.resolve(args[sourceIndex + 1]);
const source = fs.readFileSync(sourcePath, 'utf8');
const sourceSHA256 = crypto.createHash('sha256').update(source).digest('hex');
const privateRoot = path.resolve(path.dirname(sourcePath), '../../../../..');
const helperPath = path.join(privateRoot, 'tests/helpers/discussion-macros.mjs');
const { evaluateDiscussionPrompts } = await import(pathToFileURL(helperPath).href);
const processingPath = path.join(privateRoot, 'split', 'prime', 'extensions', 'tavern_helper', 'scripts', '【命定之诗】消息后处理.js');
const { DISCUSSION_MACRO_MARKER, MESSAGE_MARKERS, installMessageProcessing } = await import(pathToFileURL(processingPath).href);
const geminiDiscussionPrefill = evaluateDiscussionPrompts({
  mode: 'discussion', model: 'Gemini', prefill: true,
}).entries.find(entry => entry.name === 'Gemini预填充').content.trimEnd();
if (!/<recorder_output>\s*<recorder_thinking>\s*$/i.test(geminiDiscussionPrefill)) {
  throw new Error('private Gemini discussion prefill is missing its Recorder suffix boundary');
}

function geminiPartitionFixture() {
  return [
    { role: 'system', content: `模型头部\n${DISCUSSION_MACRO_MARKER}` },
    { role: 'system', content: `${MESSAGE_MARKERS.bodyStart}\n<VOID_reference><|命定_参考区|></VOID_reference>\n<VOID_memory><|命定_记忆区|></VOID_memory>\n<historical_record>\n[Start]\n${MESSAGE_MARKERS.historyStart}` },
    { role: 'system', content: MESSAGE_MARKERS.depth900 },
    { role: 'system', content: MESSAGE_MARKERS.depth2 },
    { role: 'system', content: `${MESSAGE_MARKERS.historyEnd}\nRecorder: \${此回复将在后续生成}\n</historical_record>\n<VOID_runtime><|命定_运行规则区|></VOID_runtime>\n${MESSAGE_MARKERS.bodyEnd}` },
    { role: 'assistant', content: geminiDiscussionPrefill },
  ];
}

function makeDocument() {
  const elements = new Map();
  const head = { appendChild: element => elements.set(element.id, element) };
  return {
    head,
    defaultView: null,
    activeElement: null,
    getElementById: id => elements.get(id) ?? null,
    createElement: () => ({ remove() {}, style: {}, dataset: {} }),
    querySelector: () => null,
    addEventListener() {},
    removeEventListener() {},
  };
}

function makeNativeHarness() {
  const chat = [];
  const handlers = new Map();
  const messageUpdates = [];
  async function emit(event, ...values) {
    for (const handler of handlers.get(event) ?? []) await handler(...values);
  }
  const getContext = () => ({ chat });
  const getMessages = (id, { include_swipes = false } = {}) => {
    const raw = chat[id];
    if (!raw) return [];
    const swipe = raw.swipe_id ?? 0;
    const swipes = raw.swipes ?? [raw.mes ?? ''];
    const swipes_info = raw.swipe_info ?? [raw.extra ?? {}];
    const base = {
      message_id: id,
      name: raw.name ?? '角色',
      role: raw.is_user ? 'user' : 'assistant',
      is_hidden: !!raw.is_system,
      swipe_id: swipe,
      swipes,
      swipes_data: raw.variables ?? [{}],
    };
    return [structuredClone(include_swipes
      ? { ...base, swipes_info }
      : { ...base, message: raw.mes ?? '', data: (raw.variables ?? [{}])[swipe] ?? {}, extra: swipes_info[swipe] ?? {} })];
  };
  const writes = [];
  const setMessages = async updates => {
    for (const update of updates) {
      assert.deepEqual(Object.keys(update).sort(), ['message', 'message_id'], '正文保存只能调用 text setter');
      const raw = chat[update.message_id];
      assert(raw && typeof update.message === 'string', '正文保存目标必须存在且为字符串');
      const swipe = raw.swipe_id ?? 0;
      raw.mes = update.message;
      if (raw.swipes) raw.swipes[swipe] = update.message;
      writes.push(structuredClone(update));
      messageUpdates.push(update.message_id);
      // Helper's text setter schedules the native update after it saves mes/swipes.
      // This is where a completed discussion can first reach the styler wrapped.
      await emit('MESSAGE_UPDATED', update.message_id);
    }
  };
  const access = createDiscussionMessageAccess({ getContext, getMessages, setMessages });
  const controller = createDiscussionController({
    contextKey: () => 'integration-chat',
    readMessage: access.read,
    lastMessageId: () => chat.length - 1,
    compatible: () => true,
    readMode: () => 'discussion',
    writeMode() {},
    writeMessage: access.write,
    changed() {},
  });
  const document = makeDocument();
  const window = { document, chat, parent: null, top: null, __destinedDiscussionV1: controller };
  window.parent = window;
  window.top = window;
  const sandbox = {
    window,
    document,
    SillyTavern: { chat, getContext: () => ({ powerUserSettings: { reasoning: {} } }) },
    eventOn: (event, handler) => {
      const list = handlers.get(event) ?? [];
      list.push(handler);
      handlers.set(event, list);
    },
    tavern_events: {
      MESSAGE_UPDATED: 'MESSAGE_UPDATED', MESSAGE_RECEIVED: 'MESSAGE_RECEIVED',
      GENERATION_ENDED: 'GENERATION_ENDED', GENERATION_STOPPED: 'GENERATION_STOPPED',
      CHAT_CHANGED: 'CHAT_CHANGED', CHARACTER_MESSAGE_RENDERED: 'CHARACTER_MESSAGE_RENDERED',
      STREAM_TOKEN_RECEIVED: 'STREAM_TOKEN_RECEIVED',
    },
    getScriptId: () => 'discussion-output-integration',
    setTimeout: () => 0,
    clearTimeout() {},
    queueMicrotask: callback => callback(),
    MutationObserver: undefined,
    console: { debug() {}, info() {}, log() {}, warn() {}, error() {} },
  };
  sandbox.$ = value => {
    if (typeof value === 'function') value();
    return { on() {} };
  };
  vm.runInNewContext(source.replace('const DEBUG = true;', 'const DEBUG = false;'), sandbox, { filename: sourcePath });
  return { chat, getMessages, writes, messageUpdates, controller, emit };
}

async function prepareGeminiPrefill(controller) {
  const handlers = new Map();
  const on = (event, handler) => handlers.set(event, [...(handlers.get(event) ?? []), handler]);
  const off = (event, handler) => handlers.set(event, (handlers.get(event) ?? []).filter(item => item !== handler));
  const events = { GENERATE_AFTER_DATA: 'data', CHAT_COMPLETION_SETTINGS_READY: 'ready' };
  const processor = installMessageProcessing({
    on,
    last: on,
    off,
    events,
    requestMode: () => controller.requestMode(),
    onPreparedOutput: output => controller.setRequestOutput(output),
  });
  const messages = geminiPartitionFixture();
  for (const handler of handlers.get(events.GENERATE_AFTER_DATA) ?? []) await handler({ prompt: messages }, false);
  processor.dispose();
  assert.equal(messages.at(-1)?.content, geminiDiscussionPrefill.trim(), '分区后最后的原生 assistant 条目必须保留实际 Gemini prefill');
  assert.deepEqual(controller.requestOutput(), { mode: 'discussion', recorderPrefill: true }, '分区回调必须冻结 Gemini Recorder prefill 标志');
}

const { parseYamlWithPath } = await import(pathToFileURL(path.join(privateRoot, 'scripts/preset/io.mjs')).href);
const splitRoot = path.join(privateRoot, 'split/prime');
const manifest = JSON.parse(fs.readFileSync(path.join(splitRoot, '.preset-tool.json'), 'utf8'));
const displayRuleIds = ['2916dba3-68bb-4c60-8a65-95eafa682b77', '9cbf76c5-d752-4b97-bfc3-41d843306e7e'];
const displayRules = manifest.regex_scripts.map(entry => parseYamlWithPath(path.join(splitRoot, 'extensions/regex_scripts', entry.file + '.yaml')))
  .filter(rule => displayRuleIds.includes(rule.id));
assert.deepEqual(displayRules.map(rule => rule.id), displayRuleIds, 'display rules must use the native preset order');

function renderDiscussionMessage(text) {
  return displayRules.reduce((value, rule) => {
    const pattern = rule.findRegex.match(/^\/(.*)\/([a-z]*)$/s);
    assert(pattern && !rule.disabled && rule.markdownOnly && rule.placement.includes(2));
    return value.replace(new RegExp(pattern[1], pattern[2]), rule.replaceString);
  }, String(text ?? ''));
}
async function runCase({ name, lifecycle, nativeReasoning, prefill, appendStatus, stylePhase }) {
  const harness = makeNativeHarness();
  const body = '## 讨论方案\n\n- 保留自然 Markdown 全文\n- 不把推理写进正文\n\n结语：继续推进。';
  const publicCheck = '简短公开检查：确认讨论范围与风险。';
  const recorder = prefill
    ? `${publicCheck}</recorder_thinking><recorder_body>${body}</recorder_body><recorder_after_format><recorder_done/></recorder_after_format></recorder_output>`
    : `<recorder_output><recorder_thinking>${publicCheck}</recorder_thinking><recorder_body>${body}</recorder_body><recorder_after_format><recorder_done/></recorder_after_format></recorder_output>`;
  const statusTail = appendStatus ? '<StatusPlaceHolderImpl/>' : '';
  const original = `${recorder}${statusTail}`;
  const reasoning = nativeReasoning ? '原生思维链：保留此字段。' : undefined;
  const raw = {
    is_user: false,
    mes: '',
    extra: reasoning ? { reasoning, reasoning_signature: 'native-signature' } : {},
    swipe_id: 0,
    swipes: [''],
    swipe_info: [{
      send_date: '2026-09-13T00:00:00.000Z',
      gen_started: '2026-09-13T00:00:01.000Z',
      gen_finished: '2026-09-13T00:00:02.000Z',
      extra: { upstream_metadata: true },
  }],
  };
  harness.controller.start('normal');
  if (prefill) await prepareGeminiPrefill(harness.controller);
  harness.chat.push(raw);
  // ST emits stream tokens before its DOM write. Keep the real native chat text in place first.
  raw.mes = original;
  raw.swipes[0] = original;
  await harness.emit('STREAM_TOKEN_RECEIVED', original);
  assert.equal(raw.mes, original, '流事件不能改写讨论正文');
  assert.equal(raw.extra.reasoning, reasoning, '流事件不能提前改写原生 reasoning');

  await harness.controller.received(0);
  if (stylePhase === 'beforeWrapper') {
    // The ordinary listener extracts the public check before the controller
    // writes its discussion wrapper.
    await harness.emit('MESSAGE_RECEIVED', 0);
  }
  await harness.controller.ended(0);
  if (lifecycle === 'completed') {
    await harness.emit('GENERATION_ENDED', 0);
  } else {
    // A stopped reply still announces its final message before the terminal
    // lifecycle event. The controller still waits for this guarded candidate.
    await harness.emit('GENERATION_STOPPED', 0);
  }

  const remainingRecorder = `${prefill ? '' : '<recorder_output>'}<recorder_body>${body}</recorder_body><recorder_after_format><recorder_done/></recorder_after_format></recorder_output>${statusTail}`;
  const expected = wrapDiscussion(remainingRecorder);
  const basic = harness.getMessages(0, { include_swipes: false })[0];
  assert.equal(raw.mes, expected, '消息保存必须保留 Recorder 壳、当前讨论包装与原始尾段');
  assert.equal(raw.swipes[0], expected, '当前 native swipe 必须同步保留 Recorder 壳与尾段');
  assert.equal(raw.mes.includes('<StatusPlaceHolderImpl/>'), appendStatus, 'MVU 的 Status 尾段必须原样留在当前讨论包装中');
  assert.equal(renderDiscussionMessage(raw.mes).trim(), `${body}${statusTail}`, '按原生顺序执行实际显示正则后必须保留正文与 Status 尾段');
  assert.equal(raw.extra.reasoning, publicCheck, '闭合的 recorder_thinking 必须成为可折叠公开检查');
  assert.equal(raw.extra.reasoning_signature, reasoning ? 'native-signature' : undefined, 'reasoning signature 必须保持');
  assert.equal(raw.swipe_info[0].send_date, '2026-09-13T00:00:00.000Z');
  assert.equal(raw.swipe_info[0].gen_started, '2026-09-13T00:00:01.000Z');
  assert.equal(raw.swipe_info[0].gen_finished, '2026-09-13T00:00:02.000Z');
  assert.equal(raw.swipe_info[0].extra.upstream_metadata, true);
  assert.equal(raw.extra.destined_discussion?.mode, 'discussion');
  assert.equal(raw.swipe_info[0].extra.destined_discussion?.mode, 'discussion');
  assert.equal(raw.extra.destined_discussion?.recorder_prefill === true, prefill);
  assert.equal(raw.swipe_info[0].extra.destined_discussion?.recorder_prefill === true, prefill);
  assert(isDiscussionMessage(basic), '4.9.5 helper basic snapshot 必须识别为讨论消息');
  assert.equal(harness.writes.length, 1, '讨论标记只需一次 text setter 保存');
  assert.equal(harness.messageUpdates.length, 1, '助手 text setter 必须触发一次 MESSAGE_UPDATED');
  return { name, lifecycle, nativeReasoning, prefill, appendStatus, stylePhase, passed: true, textSetterWrites: harness.writes.length };
}

const cases = [];
for (const lifecycle of ['completed', 'stopped']) {
  for (const nativeReasoning of [false, true]) {
    for (const prefill of [false, true]) {
      for (const appendStatus of [false, true]) {
        for (const stylePhase of ['beforeWrapper', 'afterWrapper']) {
          cases.push(await runCase({
            name: `${lifecycle}-${prefill ? 'geminiPrefill' : 'plain'}-${nativeReasoning ? 'nativeReasoning' : 'emptyExtra'}-${appendStatus ? 'withStatus' : 'withoutStatus'}-${stylePhase}`,
            lifecycle,
            nativeReasoning,
            prefill,
            appendStatus,
            stylePhase,
          }));
        }
      }
    }
  }
}

const output = {
  source: sourcePath,
  sourceSHA256,
  displayRulesSHA256: crypto.createHash('sha256').update(JSON.stringify(displayRules)).digest('hex'),
  geminiDiscussionPrefillSHA256: crypto.createHash('sha256').update(geminiDiscussionPrefill).digest('hex'),
  caseCount: cases.length,
  cases,
  boundary: 'No live Tavern/model; VM executes the supplied Prime styler with native chat and helper API stubs.',
};
const outputPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '.ui-review', 'discussion-output-integration.json');
fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, `${JSON.stringify(output, null, 2)}\n`);
console.log(JSON.stringify(output, null, 2));
