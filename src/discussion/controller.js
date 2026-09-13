import { DISCUSSION_VERSION, DISCUSSION_KEY, getDiscussionMetadata, isDiscussionMessage, wrapDiscussion, unwrapDiscussion } from './protocol.js';

/** Native-generation state and message writes are scoped to a single chat/preset. */
export function createDiscussionController(api) {
  let request = null;
  let writes = Promise.resolve();
  let disposed = false;
  const mutating = new Set();
  const observed = new Map();
  let lastObserved = null;
  const current = origin => !disposed && api.contextKey() === origin;
  const changed = () => api.changed?.();
  const savedMode = () => (api.readMode() === true || api.readMode() === 'discussion') ? 'discussion' : 'story';
  const pendingSwipe = item => Array.isArray(item?.swipes) && Number.isInteger(item.swipe_id) && item.swipe_id >= item.swipes.length;
  function observe(id) {
    const item = api.readMessage(id);
    if (item?.role !== 'assistant' || pendingSwipe(item)) return;
    const snapshot = { context: api.contextKey(), id, mode: isDiscussionMessage(item) ? 'discussion' : 'story' };
    observed.set(`${snapshot.context}:${id}`, snapshot);
    lastObserved = snapshot;
  }

  function requestMode({ dryRun = false } = {}) {
    if (disposed) return 'story';
    if (request && !current(request.context)) request = null;
    // A terminal token exists only to accept Tavern's late MESSAGE_RECEIVED.
    // It must not keep a failed/no-reply generation blocking the next round.
    if (request?.terminal) return savedMode();
    if (request?.error) throw request.error;
    const mode = request?.mode ?? savedMode();
    if (mode === 'discussion' && !api.compatible()) throw new Error(api.incompatibleReason?.() || '讨论模式需要配套的预设与助手，请更新后重试。');
    return mode;
  }

  function tagMessage(id, mode, { origin = api.contextKey(), recorderPrefill } = {}) {
    if (!Number.isInteger(id) || id < 0 || !current(origin)) return Promise.resolve();
    const captured = api.readMessage(id);
    if (!captured) return Promise.resolve();
    const swipe = captured.swipe_id ?? 0;
    writes = writes.catch(() => {}).then(async () => {
      if (!current(origin)) return;
      const message = api.readMessage(id);
      if (!message || (message.swipe_id ?? 0) !== swipe) return;
      // Do not attach a late result to a message that has since been replaced.
      if (message.message !== captured.message) return;
      const extra = structuredClone(message.extra ?? {});
      const content = mode === 'discussion' ? wrapDiscussion(message.message) : unwrapDiscussion(message.message);
      if (mode === 'discussion') {
        const retainedPrefill = getDiscussionMetadata(message)?.recorder_prefill === true;
        const actualPrefill = recorderPrefill === undefined ? retainedPrefill : recorderPrefill === true;
        extra[DISCUSSION_KEY] = { version: DISCUSSION_VERSION, mode, ...(actualPrefill ? { recorder_prefill: true } : {}) };
      }
      else delete extra[DISCUSSION_KEY];
      if (content === message.message && JSON.stringify(extra) === JSON.stringify(message.extra ?? {})) return;
      const update = { message_id: id, message: content, extra };
      if (Array.isArray(message.swipes)) {
        delete update.message; delete update.extra;
        update.swipe_id = swipe;
        update.swipes = [...message.swipes];
        update.swipes[swipe] = content;
        update.swipes_info = structuredClone(message.swipes_info ?? []);
        update.swipes_info[swipe] = extra;
      }
      const writeKey = `${origin}:${id}`;
      mutating.add(writeKey);
      try { await api.writeMessage(update); } finally { mutating.delete(writeKey); }
      if (!current(origin)) return;
      const actual = api.readMessage(id);
      if (actual && ((actual.swipe_id ?? 0) === swipe) && (actual.message !== content || isDiscussionMessage(actual) !== (mode === 'discussion'))) {
        throw new Error('讨论标记保存失败，请重试后再继续。');
      }
      changed();
    }).catch(error => {
      if (current(origin)) { if (request) request.error = error; api.notify?.(error.message); }
    });
    return writes;
  }

  function start(type = 'normal', options = {}, dryRun = false) {
    if (dryRun || !['normal', 'regenerate', 'swipe', 'continue'].includes(type)) return;
    const context = api.contextKey();
    const lastId = api.lastMessageId(), last = api.readMessage(lastId);
    if (last?.role === 'assistant' && !pendingSwipe(last)) observe(lastId);
    const previous = observed.get(`${context}:${lastId}`)
      ?? (type === 'regenerate' && lastObserved?.context === context && lastObserved.id === lastId + 1 ? lastObserved : null);
    const inferred = ['regenerate', 'swipe', 'continue'].includes(type)
      ? previous?.mode ?? (last?.role === 'assistant' ? (isDiscussionMessage(last) ? 'discussion' : 'story') : savedMode())
      : savedMode();
    // Native synchronization has already chosen the round mode.  Preserve a
    // regenerating/swiping discussion page unless the caller explicitly froze it.
    const mode = options?.mode === 'discussion' || options?.mode === 'story' ? options.mode : inferred;
    request = { context, mode, type, lastId, recorderPrefill: false, error: null };
    if (mode === 'discussion' && !api.compatible()) request.error = new Error(api.incompatibleReason?.() || '讨论模式协议不兼容，请更新配套预设与助手。');
    changed();
    return true;
  }

  async function sent(id) {
    if (request && current(request.context) && request.mode === 'discussion') await tagMessage(id, 'discussion', { origin: request.context, recorderPrefill: false });
  }
  async function received(id) {
    if (!request || !current(request.context)) return;
    if (request.type === 'normal' && id <= request.lastId) return;
    const item = api.readMessage(id);
    if (item?.role !== 'assistant') return;
    // Streaming content and native reasoning can still change after this event.
    // Keep only a guarded candidate; ended() writes the final body once.
    request.candidateId = id;
    request.candidateSwipe = item.swipe_id ?? 0;
  }
  async function finishTerminal() {
    const token = request;
    if (!token?.terminal || token.finalizing || !Number.isInteger(token.candidateId) || !current(token.context)) return;
    token.finalizing = true;
    await tagMessage(token.candidateId, token.mode, { origin: token.context, recorderPrefill: token.recorderPrefill });
    await writes;
    if (request === token) request = null;
    changed();
  }
  async function receivedFinal(id) {
    await received(id);
    await finishTerminal();
  }
  async function ended() {
    const token = request;
    if (!token || !current(token.context)) return;
    // Tavern passes chat.length here, not the generated floor. Hold this token
    // until MESSAGE_RECEIVED supplies the real floor and active swipe.
    token.terminal = true;
    await finishTerminal();
    if (request === token) changed();
  }
  async function edited(id) {
    if (mutating.has(`${api.contextKey()}:${id}`)) return;
    const item = api.readMessage(id);
    // Native right-swipe announces an empty page before starting generation.
    // Keep the old page's observed mode, and never create/fill that page here.
    if (pendingSwipe(item)) return;
    observe(id);
    if (isDiscussionMessage(item)) await tagMessage(id, 'discussion');
    changed();
  }
  function contextChanged() { request = null; observed.clear(); lastObserved = null; changed(); }
  function isPendingDiscussionSource(content) {
    if (!request || request.mode !== 'discussion' || !current(request.context) || !Number.isInteger(request.candidateId)) return false;
    const item = api.readMessage(request.candidateId);
    if (!item || (item.swipe_id ?? 0) !== request.candidateSwipe) return false;
    // COMMAND_PARSED provides the message source. Match the known candidate
    // exactly; do not classify a late result from another floor by its text.
    return String(item.message ?? '') === String(content ?? '');
  }
  async function toggle() {
    if (request && !request.terminal) throw new Error('生成结束后再切换模式。');
    if (!api.compatible()) throw new Error(api.incompatibleReason?.() || '需要支持讨论模式的配套预设与助手。');
    const origin = api.contextKey(), next = savedMode() === 'discussion' ? 'story' : 'discussion';
    await api.writeMode(next);
    if (!current(origin)) return;
    if (savedMode() !== next) throw new Error('讨论模式保存失败。');
    changed();
  }
  function setRequestOutput({ recorderPrefill = false } = {}) {
    if (!request || request.terminal || !current(request.context)) return false;
    request.recorderPrefill = recorderPrefill === true;
    return true;
  }
  function requestOutput() {
    if (request && current(request.context)) return { mode: request.mode, recorderPrefill: request.recorderPrefill === true };
    return null;
  }
  return {
    requestMode, requestOutput, setRequestOutput, start, sent, received, receivedFinal, ended, edited, contextChanged, toggle, observe, isPendingDiscussionSource,
    fail(error) { if (request) request.error = error instanceof Error ? error : new Error(String(error)); changed(); },
    get mode() { return savedMode(); }, get activeMode() { return request?.mode ?? null; }, get busy() { return !!request && !request.terminal; },
    flush: () => writes,
    dispose() { disposed = true; request = null; },
  };
}
