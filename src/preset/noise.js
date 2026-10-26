import { normalizeNoiseSettings, createNoiseSeed, buildNoiseText, NOISE_MIN_SEGMENTS, NOISE_MAX_SEGMENTS } from './noise-text.js';
import { FLAVOR } from '../flavor.js';

const OUTPUT_PROTOCOL_ID = 'dafd56fc-9b51-4936-98b5-bc16f7c37db9';
const BODY_START = '<|命定_正文开始|>';
const BODY_END = '<|命定_正文结束|>';
const NATIVE_MACRO_NAME = FLAVOR.id === 'prime' ? 'destined_prompt_noise' : 'general_prompt_noise';
const NOISE_SLOT = new RegExp(`(<\\|命定_正文开始\\|>[\\t ]*\\r?\\n)\\{\\{${NATIVE_MACRO_NAME}\\}\\}`, 'gu');
const FAILED_NOISE = '<noise_padding_unavailable/>';

export function createNoise(ctx) {
  let prepared = null, round = null, error = '', registrationError = '', disposed = false;
  const requests = new WeakMap();
  const settings = () => normalizeNoiseSettings(ctx.state.config.noise_padding);
  const key = value => JSON.stringify(value);
  const currentContext = () => ctx.workspaceContextKey();
  const slotPresent = text => new RegExp(NOISE_SLOT.source, 'u').test(String(text ?? ''));
  const supported = () => ctx.presetIsMine(ctx.state.preset) && ctx.state.preset?.prompts?.some(prompt =>
    prompt.id === OUTPUT_PROTOCOL_ID && prompt.enabled && slotPresent(prompt.content));
  const render = () => { if (!disposed && !ctx.destroyed) ctx.renderActiveContent?.(true); };

  function prepareNoise(reroll = false) {
    const value = settings(), cacheKey = key(value);
    if (!value.enabled || !supported()) return '';
    if (registrationError) throw new Error(registrationError);
    const randomize = reroll && value.mode === 'random';
    if (!randomize && prepared?.key === cacheKey) return prepared.text;
    const seed = randomize ? createNoiseSeed() : value.seed;
    prepared = { ...buildNoiseText({ ...value, seed }), key: cacheKey, seed };
    return prepared.text;
  }

  function previewNoiseSegments(segments) {
    const value = settings();
    return buildNoiseText({ ...value, segments, seed: prepared?.key === key(value) ? prepared.seed : value.seed });
  }

  function readNoiseControl() {
    const value = settings();
    const preview = prepared?.key === key(value) ? prepared : buildNoiseText(value);
    return { ...value, supported: supported(), estimatedTokens: preview.estimatedTokens,
      text: preview.text, error, busy: false };
  }

  function refreshNoise() {
    if (!settings().enabled || !supported()) return;
    try { prepareNoise(); }
    catch (failure) { error = failure.message ?? String(failure); }
  }

  function changeSettings(next) {
    if (ctx.state.workspaceBusy) throw new Error('上一项设置尚未保存，请稍候。');
    if (!supported()) throw new Error('当前输出协议缺少噪声占位宏，请使用配套预设。');
    if (registrationError && next.enabled) throw new Error(registrationError);
    const origin = currentContext();
    const guard = () => !disposed && !ctx.destroyed && currentContext() === origin && supported();
    const before = settings();
    const seed = prepared?.key === key(before) && next.seed === before.seed && next.mode === before.mode
      ? prepared.seed : next.seed;
    // Update the visible draft now. The shared queue debounces, verifies and
    // rolls back failed writes without holding up local generation or dragging.
    ctx.state.config.noise_padding = next;
    prepared = { ...buildNoiseText({ ...next, seed }), key: key(next), seed };
    error = '';
    render();
    return ctx.enqueueScriptConfigSave('噪声填充', 'noise-padding', guard).catch(failure => {
      if (guard()) { error = failure.message ?? String(failure); render(); }
      throw failure;
    });
  }

  async function setNoiseSetting(field, value) {
    if (!['enabled', 'segments', 'mode'].includes(field)) throw new Error('不支持的噪声设置。');
    if (field === 'enabled' && typeof value !== 'boolean') throw new Error('噪声开关格式无效。');
    if (field === 'mode' && !['fixed', 'random'].includes(value)) throw new Error('噪声模式无效。');
    if (field === 'segments' && (!Number.isSafeInteger(Number(value)) || Number(value) < NOISE_MIN_SEGMENTS || Number(value) > NOISE_MAX_SEGMENTS)) {
      throw new Error(`噪声段数须为 ${NOISE_MIN_SEGMENTS}～${NOISE_MAX_SEGMENTS} 的整数。`);
    }
    return changeSettings({ ...settings(), [field]: field === 'segments' ? Number(value) : value });
  }

  async function regenerateNoise() { return changeSettings({ ...settings(), seed: createNoiseSeed() }); }

  function beforeNoiseGeneration(type, _options = {}, dryRun = false) {
    if (dryRun || !['normal', 'regenerate', 'swipe', 'continue'].includes(type)) return;
    round = null;
    if (!settings().enabled || !supported()) return;
    const origin = currentContext();
    try { round = { origin, text: prepareNoise(true) }; }
    catch (failure) {
      error = failure.message ?? String(failure);
      round = { origin, error: failure };
      ctx.showErrorToast?.(failure);
      ctx.getContext()?.stopGeneration?.();
    }
  }

  function registerNoiseMacro() {
    try {
      const context = ctx.getContext();
      if (typeof context?.registerMacro !== 'function' || typeof context?.unregisterMacro !== 'function') {
        throw new Error('当前酒馆未提供原生宏注册接口，无法在上下文计数前展开噪声。');
      }
      // Native substitution happens before Tavern budgets preset prompts. This
      // callback only returns local text and adds no tokenizer/network wait.
      context.registerMacro(NATIVE_MACRO_NAME, () => {
        if (!supported()) return '';
        const activeRound = round?.origin === currentContext() ? round : null;
        if (activeRound?.error) return FAILED_NOISE;
        if (activeRound?.text) return activeRound.text;
        try { return prepareNoise(); }
        catch (failure) { error = failure.message ?? String(failure); return FAILED_NOISE; }
      });
      ctx.macroStops.push({ unregister: () => context.unregisterMacro(NATIVE_MACRO_NAME) });
    } catch (failure) {
      registrationError = failure.message ?? String(failure);
      console.error('[噪声填充]', failure);
    }
  }

  function inspectNoiseOutgoing(messages, dryRun = false) {
    if (!Array.isArray(messages)) return;
    const texts = messages.flatMap(message => typeof message?.content === 'string' ? [message.content]
      : (Array.isArray(message?.content) ? message.content : []).filter(part => part?.type === 'text').map(part => part.text));
    const prime = texts.some(text => text?.includes(BODY_START)) && texts.some(text => text?.includes(BODY_END));
    const unavailable = texts.some(text => text?.includes(FAILED_NOISE));
    if (!prime && !unavailable) return;
    let failure = unavailable ? new Error(error || '噪声展开失败，已阻止请求发送。') : null;
    for (const message of messages) {
      const update = text => {
        if (!slotPresent(text)) return text;
        if (!settings().enabled) return text.replace(new RegExp(NOISE_SLOT.source, 'gu'), '$1');
        failure = new Error(registrationError || '噪声宏未在上下文计数前展开，已阻止请求发送。');
        return text;
      };
      if (typeof message.content === 'string') message.content = update(message.content);
      else for (const part of Array.isArray(message.content) ? message.content : []) if (part.type === 'text') part.text = update(part.text);
    }
    if (!dryRun) requests.set(messages, failure);
  }

  function validateNoiseRequest(data) {
    const failure = requests.get(data?.messages);
    if (!failure) return;
    ctx.showErrorToast?.(failure);
    Object.defineProperty(data, 'toJSON', { configurable: true, value() { throw failure; } });
  }

  function finishNoiseGeneration() { round = null; }
  function disposeNoise() { disposed = true; prepared = null; round = null; }
  return { readNoiseControl, previewNoiseSegments, setNoiseSetting, regenerateNoise, refreshNoise, prepareNoise,
    beforeNoiseGeneration, registerNoiseMacro, inspectNoiseOutgoing, validateNoiseRequest, finishNoiseGeneration, disposeNoise };
}
