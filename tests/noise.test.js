import test from 'node:test';
import assert from 'node:assert/strict';
import { createNoise } from '../src/preset/noise.js';
import { DEFAULT_NOISE_SETTINGS, NOISE_MACRO, buildNoiseText } from '../src/preset/noise-text.js';

const START = '<|命定_正文开始|>', END = '<|命定_正文结束|>';
const SLOT = `${START}\nOutput protocol\n${END}`;
const PROTOCOL_ID = 'dafd56fc-9b51-4936-98b5-bc16f7c37db9';
const GEMINI_HEAD_ID = 'ecc2c6ea-0d97-4640-8aa4-2ff1544e688f';
const CLAUDE_HEAD_ID = '043ce90e-42b6-4f00-be11-a704c63684f8';
const HEAD = `${NOISE_MACRO}\n<role_adapter core="recorder_core">`;

function setup(settings, hostOverrides = {}) {
  let workspace = 'first', callback, stopped = 0;
  const saves = [], notices = [], registrations = [], unregistrations = [];
  const host = {
    stopGeneration() { stopped++; },
    registerMacro(name, fn) { registrations.push(name); callback = fn; },
    unregisterMacro(name) { unregistrations.push(name); callback = null; },
    ...hostOverrides,
  };
  const ctx = {
    state: { config: settings === undefined ? {} : { noise_padding: { ...DEFAULT_NOISE_SETTINGS, ...settings } },
      preset: { prompts: [{ id: GEMINI_HEAD_ID, enabled: true, content: HEAD }, { id: PROTOCOL_ID, enabled: true, content: SLOT }] } },
    macroStops: [], workspaceContextKey: () => workspace, presetIsMine: () => true,
    getContext: () => host, renderActiveContent() {}, showErrorToast: error => notices.push(error),
    async enqueueScriptConfigSave(label, debounceKey, guard, prepare) {
      saves.push({ label, debounceKey, guard, prepare });
      if (guard && !guard()) throw new Error('context changed');
      prepare?.();
    },
  };
  ctx.savedScriptConfig = structuredClone(ctx.state.config);
  const noise = createNoise(ctx); noise.registerNoiseMacro();
  return { ctx, noise, notices, saves, registrations, unregistrations, stopped: () => stopped,
    switchContext: () => { workspace = 'second'; }, invokeMacro: () => callback(),
    expand: text => callback ? text.replaceAll(NOISE_MACRO, () => callback()) : text,
  };
}

test('native macro synchronously expands and unregisters through the host', () => {
  const state = setup({ enabled: true });
  assert.deepEqual(state.registrations, ['destined_prompt_noise']);
  assert.equal(typeof state.noise.prepareNoise(), 'string');
  assert.equal(typeof state.invokeMacro(), 'string');
  assert(!state.expand(HEAD).includes(NOISE_MACRO));
  state.ctx.macroStops[0].unregister();
  assert.deepEqual(state.unregistrations, ['destined_prompt_noise']);
});

test('missing native registration or unregistration rejects enabling', async t => {
  t.mock.method(console, 'error', () => {});
  for (const missing of ['registerMacro', 'unregisterMacro']) {
    const state = setup(undefined, { [missing]: undefined });
    await assert.rejects(async () => state.noise.setNoiseSetting('enabled', true), /原生宏注册接口/);
    assert.equal(state.saves.length, 0); assert.deepEqual(state.ctx.state.config, {});
  }
});

test('old settings default disabled and segment controls persist with the shared debounce key', async () => {
  const state = setup();
  assert.equal(state.noise.readNoiseControl().enabled, false);
  assert.equal(state.noise.readNoiseControl().segments, 10);
  await state.noise.setNoiseSetting('enabled', true);
  await state.noise.setNoiseSetting('mode', 'random');
  await state.noise.setNoiseSetting('segments', '48');
  assert.deepEqual(state.ctx.state.config.noise_padding, { ...DEFAULT_NOISE_SETTINGS, enabled: true, mode: 'random', segments: 48 });
  const control = state.noise.readNoiseControl();
  assert.equal(control.estimatedTokens, 12000); assert.equal(control.busy, false);
  assert(state.saves.every(save => save.debounceKey === 'noise-padding'));
  await state.noise.setNoiseSetting('enabled', false);
  assert.equal(state.invokeMacro(), '');
  const saves = state.saves.length;
  for (const [field, value] of [['enabled', 1], ['mode', 'bad'], ['segments', 9], ['segments', 49], ['segments', 10.5], ['tokens', 2500]]) {
    await assert.rejects(async () => state.noise.setNoiseSetting(field, value));
  }
  assert.equal(state.saves.length, saves);
});

test('legacy token configuration remains usable before the next segment save', async () => {
  const state = setup();
  state.ctx.state.config.noise_padding = { enabled: true, tokens: 6000, mode: 'fixed' };
  assert.equal(state.noise.readNoiseControl().segments, 24);
  assert.equal(state.noise.readNoiseControl().estimatedTokens, 6000);
  assert.equal(state.noise.prepareNoise(), buildNoiseText({ segments: 24 }).text);
  await state.noise.setNoiseSetting('segments', 25);
  assert.equal(state.ctx.state.config.noise_padding.segments, 25);
  assert(!Object.hasOwn(state.ctx.state.config.noise_padding, 'tokens'));
});

test('support requires the macro to open exactly one enabled model head', () => {
  const state = setup({ enabled: true });
  const head = state.ctx.state.preset.prompts[0];
  assert.equal(state.noise.readNoiseControl().supported, true);
  for (const text of [NOISE_MACRO, `${START}\n${NOISE_MACRO}`, `Prefix ${NOISE_MACRO}\nText`, `${NOISE_MACRO} same line`, ` \n${NOISE_MACRO}`]) {
    head.content = text;
    assert.equal(state.noise.readNoiseControl().supported, false, JSON.stringify(text));
  }
  head.content = `${NOISE_MACRO}\t \r\n<role_adapter core="recorder_core">`;
  assert.equal(state.noise.readNoiseControl().supported, true);
  head.content = `\n\n${HEAD}`;
  assert.equal(state.noise.readNoiseControl().supported, true);
});

test('an output-protocol slot alone never enables noise', () => {
  const state = setup({ enabled: true });
  const [head, protocol] = state.ctx.state.preset.prompts;
  head.content = '<role_adapter core="recorder_core">';
  protocol.content = `${START}\n${NOISE_MACRO}\nOutput protocol\n${END}`;
  assert.equal(state.noise.readNoiseControl().supported, false);
  assert.equal(state.noise.prepareNoise(), '');
});

test('two enabled model heads disable noise until one is switched off', () => {
  const state = setup({ enabled: true });
  const prompts = state.ctx.state.preset.prompts;
  prompts.push({ id: CLAUDE_HEAD_ID, enabled: true, content: HEAD });
  assert.equal(state.noise.readNoiseControl().supported, false);
  prompts[prompts.length - 1].enabled = false;
  assert.equal(state.noise.readNoiseControl().supported, true);
  prompts[0].enabled = false;
  prompts[prompts.length - 1].enabled = true;
  assert.equal(state.noise.readNoiseControl().supported, true);
  prompts[prompts.length - 1].content = '<role_adapter core="recorder_core">';
  assert.equal(state.noise.readNoiseControl().supported, false);
});

test('builtin registry ids, custom adapters and split head metadata identify heads', () => {
  const state = setup({ enabled: true });
  const customHead = '9c8d7e6f-0000-4000-8000-000000000001';
  state.ctx.MODEL_ADAPTERS = { Custom: { ids: [customHead, 'tail-a', 'tail-b'], tails: [] } };
  state.ctx.state.preset.prompts = [
    { id: 'tail-a', enabled: true, content: HEAD },
    { id: customHead, enabled: true, content: HEAD },
  ];
  assert.equal(state.noise.readNoiseControl().supported, true);
  state.ctx.MODEL_ADAPTERS = {};
  state.ctx.state.preset.prompts = [
    { id: 'model:11111111-1111-4111-8111-111111111111', enabled: true, content: '<role_adapter core="recorder_core">' },
    { id: 'thinking-entry', enabled: true, content: HEAD, extra: { destined_model: { part: 'thinking' } } },
  ];
  assert.equal(state.noise.readNoiseControl().supported, false);
  state.ctx.state.preset.prompts[1].extra.destined_model.part = 'head';
  assert.equal(state.noise.readNoiseControl().supported, true);
  // A non-head entry with head text is not a head; only the metadata entry counts.
  state.ctx.state.preset.prompts[0].content = HEAD;
  assert.equal(state.noise.readNoiseControl().supported, true);
  state.ctx.state.preset.prompts.push({ id: 'second-head', enabled: true, content: HEAD, extra: { destined_model: { part: 'head' } } });
  assert.equal(state.noise.readNoiseControl().supported, false);
});

test('disabled settings strip only an unexpanded head slot and keep literal body macros', () => {
  const state = setup();
  assert(!state.expand(HEAD).includes(NOISE_MACRO));
  const body = `${START}\n${NOISE_MACRO}\n${END}`;
  const data = { messages: [{ role: 'system', content: state.expand(HEAD) }, { role: 'user', content: body }] };
  state.noise.inspectNoiseOutgoing(data.messages); state.noise.validateNoiseRequest(data);
  assert.equal(data.messages[0].content, state.expand(HEAD));
  assert.equal(data.messages[1].content, body);
  assert.doesNotThrow(() => JSON.stringify(data));
});

test('disabled settings keep the head newline when stripping the slot', () => {
  const state = setup();
  const data = { messages: [{ role: 'system', content: `  \t${NOISE_MACRO}  \r\n<role_adapter core="recorder_core">` }] };
  state.noise.inspectNoiseOutgoing(data.messages); state.noise.validateNoiseRequest(data);
  assert.equal(data.messages[0].content, '  \t  \r\n<role_adapter core="recorder_core">');
  assert.doesNotThrow(() => JSON.stringify(data));
});

test('enabled requests pass literal macro examples in the user body untouched', () => {
  const state = setup({ enabled: true });
  state.noise.beforeNoiseGeneration('normal');
  const padding = state.noise.prepareNoise(), macro = NOISE_MACRO;
  const body = `${START}\n示例正文：在头部写 ${macro} 会被展开。\n\n\`\`\`text\n${macro}\n<role_adapter core="recorder_core">\n\`\`\`\n\n引用结束\n${END}`;
  const data = { messages: [
    { role: 'system', content: state.expand(HEAD) },
    { role: 'user', content: [{ type: 'text', text: body }, { type: 'image_url', image_url: { url: 'data:image/png;base64,FIXTURE' } }] },
  ] };
  state.noise.inspectNoiseOutgoing(data.messages); state.noise.validateNoiseRequest(data);
  assert.doesNotThrow(() => JSON.stringify(data));
  assert.equal(data.messages[1].content[0].text, body);
  assert.equal(data.messages[1].content[0].text.split(macro).length - 1, 2);
  assert.equal(data.messages[1].content[1].type, 'image_url');
  assert.equal(data.messages[0].content.split(padding).length - 1, 1);
  assert.equal(data.messages[0].content.startsWith(padding), true);
});

test('a fenced macro example right after the body boundary is not treated as a head slot', () => {
  const state = setup({ enabled: true });
  state.noise.beforeNoiseGeneration('normal');
  const body = `${START}\n\`\`\`\n${NOISE_MACRO}\n\`\`\`\n${END}`;
  const data = { messages: [{ role: 'system', content: state.expand(HEAD) }, { role: 'user', content: body }] };
  state.noise.inspectNoiseOutgoing(data.messages); state.noise.validateNoiseRequest(data);
  assert.doesNotThrow(() => JSON.stringify(data));
  assert.equal(data.messages[1].content, body);
});

test('fixed logs remain stable through repeated generations and perform zero network calls', t => {
  const fetch = t.mock.method(globalThis, 'fetch', () => { throw new Error('unexpected network request'); });
  const state = setup({ enabled: true });
  const prepared = state.noise.prepareNoise();
  assert.equal(prepared, buildNoiseText(DEFAULT_NOISE_SETTINGS).text);
  for (let round = 0; round < 3; round++) {
    assert.equal(state.noise.beforeNoiseGeneration('normal'), undefined);
    assert.equal(state.invokeMacro(), prepared);
    state.noise.finishNoiseGeneration();
  }
  assert.equal(fetch.mock.callCount(), 0); assert.equal(state.saves.length, 0);
});

test('random logs reroll only for real generation and stay frozen across macro expansions and dry runs', () => {
  const state = setup({ enabled: true, mode: 'random' });
  const initial = state.noise.prepareNoise();
  state.noise.beforeNoiseGeneration('normal', {}, true);
  assert.equal(state.invokeMacro(), initial);
  state.noise.beforeNoiseGeneration('quiet'); assert.equal(state.invokeMacro(), initial);
  state.noise.beforeNoiseGeneration('normal'); const first = state.invokeMacro();
  assert.notEqual(first, initial); assert.equal(state.invokeMacro(), first);
  state.noise.beforeNoiseGeneration('normal', {}, true); assert.equal(state.invokeMacro(), first);
  state.noise.finishNoiseGeneration(); state.noise.beforeNoiseGeneration('swipe');
  assert.notEqual(state.invokeMacro(), first); assert.equal(state.saves.length, 0);
});

test('previewing segment counts is synchronous, read-only and does not reroll random text', () => {
  const state = setup({ enabled: true, mode: 'random' });
  state.noise.beforeNoiseGeneration('normal');
  const text = state.invokeMacro(), before = structuredClone(state.ctx.state.config);
  const preview = state.noise.previewNoiseSegments(24);
  assert.equal(typeof preview.text, 'string'); assert.equal(preview.then, undefined);
  assert.equal(preview.segments, 24); assert.equal(preview.estimatedTokens, 6000);
  assert.deepEqual(state.noise.previewNoiseSegments(24), preview);
  assert(preview.text.startsWith(text.slice(0, text.indexOf('[Noise block 02]'))));
  assert.deepEqual(state.ctx.state.config, before); assert.equal(state.invokeMacro(), text);
  assert.equal(state.saves.length, 0);
});

test('committing a random-mode segment preview preserves the already selected log order', async t => {
  const state = setup({ enabled: true, mode: 'random' });
  state.noise.beforeNoiseGeneration('normal');
  const preview = state.noise.previewNoiseSegments(24).text;
  const random = t.mock.method(globalThis.crypto, 'getRandomValues', () => { throw new Error('unexpected reroll'); });
  const save = state.noise.setNoiseSetting('segments', 24);
  assert.equal(state.noise.readNoiseControl().text, preview);
  assert.equal(state.ctx.state.config.noise_padding.segments, 24);
  assert.equal(random.mock.callCount(), 0);
  await save;
  assert.equal(state.noise.readNoiseControl().text, preview);
});

test('a pending save does not block optimistic segment updates, previews or real generation', async t => {
  const fetch = t.mock.method(globalThis, 'fetch', () => { throw new Error('unexpected network request'); });
  const state = setup({ enabled: true });
  const pending = [];
  state.ctx.enqueueScriptConfigSave = (label, debounceKey, guard, prepare) => new Promise((resolve, reject) => {
    pending.push({ label, debounceKey, guard, prepare, resolve, reject });
  });
  const first = state.noise.setNoiseSetting('segments', 24);
  assert.equal(state.ctx.state.config.noise_padding.segments, 24);
  assert.equal(state.noise.readNoiseControl().estimatedTokens, 6000);
  assert.equal(state.noise.readNoiseControl().busy, false);
  const second = state.noise.setNoiseSetting('segments', 48);
  assert.equal(state.ctx.state.config.noise_padding.segments, 48);
  assert.equal(state.noise.previewNoiseSegments(12).segments, 12);
  assert.equal(state.noise.beforeNoiseGeneration('normal'), undefined);
  assert.equal(state.invokeMacro(), buildNoiseText({ ...DEFAULT_NOISE_SETTINGS, segments: 48 }).text);
  assert.equal(pending.length, 2); assert(pending.every(item => item.debounceKey === 'noise-padding'));
  pending[0].resolve({ superseded: true });
  assert(pending[1].guard()); pending[1].prepare?.(); pending[1].resolve();
  await Promise.all([first, second]);
  assert.equal(fetch.mock.callCount(), 0);
});

test('store rollback restores persisted configuration and its preview after a failed save', async () => {
  const state = setup({ enabled: true });
  const saved = structuredClone(state.ctx.state.config), text = state.noise.prepareNoise();
  state.ctx.enqueueScriptConfigSave = async () => {
    state.ctx.state.config = structuredClone(state.ctx.savedScriptConfig);
    throw new Error('storage failed');
  };
  await assert.rejects(async () => state.noise.setNoiseSetting('segments', 48), /storage failed/);
  assert.deepEqual(state.ctx.state.config, saved);
  assert.equal(state.noise.readNoiseControl().segments, 10);
  assert.equal(state.noise.prepareNoise(), text);
});

test('queued writes retain their workspace guard after an optimistic edit', async () => {
  const state = setup({ enabled: true }); let queued;
  state.ctx.enqueueScriptConfigSave = (_label, _key, guard, prepare) => new Promise((resolve, reject) => { queued = { guard, prepare, resolve, reject }; });
  const save = state.noise.setNoiseSetting('segments', 24);
  state.switchContext(); assert.equal(queued.guard(), false);
  queued.reject(new Error('context changed'));
  await assert.rejects(save, /context changed/);
});

test('current round stays frozen after disabling, then finish or context change removes the old round', async () => {
  const state = setup({ enabled: true, mode: 'random' });
  state.noise.beforeNoiseGeneration('continue'); const frozen = state.invokeMacro();
  await state.noise.setNoiseSetting('enabled', false); assert.equal(state.invokeMacro(), frozen);
  state.switchContext(); assert.equal(state.invokeMacro(), '');
  state.noise.finishNoiseGeneration(); assert.equal(state.invokeMacro(), '');
});

test('unsupported presets never prepare or inject logs', () => {
  const state = setup({ enabled: true }); state.ctx.presetIsMine = () => false;
  assert.equal(state.noise.prepareNoise(), ''); state.noise.beforeNoiseGeneration('normal');
  assert.equal(state.invokeMacro(), ''); assert.equal(state.noise.readNoiseControl().supported, false);
});

test('failed random seed generation stops and blocks the marked outgoing request', t => {
  const state = setup({ enabled: true, mode: 'random' });
  t.mock.method(globalThis.crypto, 'getRandomValues', () => { throw new Error('secure randomness unavailable'); });
  state.noise.beforeNoiseGeneration('normal');
  assert.equal(state.stopped(), 1);
  assert.equal(state.invokeMacro(), '<noise_padding_unavailable/>');
  const data = { messages: [{ role: 'system', content: state.expand(HEAD) }] };
  state.noise.inspectNoiseOutgoing(data.messages); state.noise.validateNoiseRequest(data);
  assert.throws(() => JSON.stringify(data), /secure randomness unavailable/);
});

test('repeated outgoing hooks preserve one log block and the original head role', () => {
  const state = setup({ enabled: true }); state.noise.beforeNoiseGeneration('normal');
  const data = { messages: [{ role: 'assistant', content: state.expand(HEAD) }] }, before = structuredClone(data);
  for (let count = 0; count < 2; count++) {
    state.noise.inspectNoiseOutgoing(data.messages); state.noise.validateNoiseRequest(data);
    assert.doesNotThrow(() => JSON.stringify(data));
  }
  assert.deepEqual(data, before); assert.equal(data.messages[0].content.match(/\[Noise block 01\]/g).length, 1);
});

test('unexpanded head slots are blocked before serialization; previews and ordinary summaries are unaffected', () => {
  const state = setup({ enabled: true });
  const data = { messages: [{ role: 'system', content: [{ type: 'text', text: HEAD }] }] };
  state.noise.inspectNoiseOutgoing(data.messages, true); state.noise.validateNoiseRequest(data);
  assert.doesNotThrow(() => JSON.stringify(data));
  state.noise.inspectNoiseOutgoing(data.messages); state.noise.validateNoiseRequest(data);
  assert.throws(() => JSON.stringify(data), /宏未在上下文计数前展开/);
  for (const content of ['Summarize these messages.', NOISE_MACRO, `${START}\nSummary only`]) {
    const ordinary = { messages: [{ role: 'user', content }] };
    state.noise.inspectNoiseOutgoing(ordinary.messages); state.noise.validateNoiseRequest(ordinary);
    assert.doesNotThrow(() => JSON.stringify(ordinary));
  }
});

test('a head slot surviving message processing blocks the request even without body boundaries', () => {
  const state = setup({ enabled: true });
  const data = { messages: [{ role: 'system', content: `${NOISE_MACRO}\n<role_adapter core="recorder_core">` }] };
  assert(!JSON.stringify(data).includes(START));
  state.noise.inspectNoiseOutgoing(data.messages); state.noise.validateNoiseRequest(data);
  assert.throws(() => JSON.stringify(data), /宏未在上下文计数前展开/);
});

test('a disabled slot inside an already processed head is removed without blocking', () => {
  const state = setup();
  const data = { messages: [{ role: 'system', content: `${NOISE_MACRO}\n<role_adapter core="recorder_core">` }] };
  state.noise.inspectNoiseOutgoing(data.messages); state.noise.validateNoiseRequest(data);
  assert.equal(data.messages[0].content, '\n<role_adapter core="recorder_core">');
  assert.doesNotThrow(() => JSON.stringify(data));
});
