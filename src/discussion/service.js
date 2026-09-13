import { createDiscussionController } from './controller.js';
import { DISCUSSION_BRIDGE, DISCUSSION_CHAT_KEY, isDiscussionMessage } from './protocol.js';
import { suppressDiscussionCommands } from './variables.js';
import { createDiscussionMessageAccess } from './messages.js';
import { createDiscussionUi } from './ui.js';
import { createNativeDiscussionMode } from './native-mode.js';
import { discussionAdapterSupport } from './adapter.js';

export function startDiscussion(ctx) {
  const host = window.parent, doc = host.document;
  host[DISCUSSION_BRIDGE]?.dispose?.();
  const stops = [], owner = getLoadedPresetName();
  let disposed = false, guardedMvu = null, mvuStop = null, nativeMode = null, quietPending = false, quietRejection = null, latestGenerationType = null, dryRunError = null;
  const mvu = () => typeof Mvu !== 'undefined' ? Mvu : host.Mvu;
  function syncVariableGuard() {
    const runtime = mvu();
    if (runtime === guardedMvu) return;
    mvuStop?.(); mvuStop = null; guardedMvu = null;
    if (!runtime?.events?.COMMAND_PARSED || typeof eventMakeLast !== 'function') return;
    const event = runtime.events.COMMAND_PARSED;
    const callback = (...args) => {
      if (disposed || getLoadedPresetName() !== owner) return;
      suppressDiscussionCommands(...args, controller?.isPendingDiscussionSource?.(args[2]) === true);
    };
    eventMakeLast(event, callback);
    mvuStop = () => eventRemoveListener(event, callback);
    guardedMvu = runtime;
  }
  const contextKey = () => {
    const state = ctx.getContext();
    return JSON.stringify([getLoadedPresetName(), state?.characterId, state?.groupId, state?.chatId]);
  };
  // Lifecycle events do not carry a context. Remember the context that owned
  // our ephemeral state so a character/preset/chat change cannot reuse it.
  let lifecycleContext = contextKey();
  const messages = createDiscussionMessageAccess({ getContext: ctx.getContext,
    getMessages: (...args) => getChatMessages(...args), setMessages: (...args) => setChatMessages(...args) });
  const readMessage = messages.read;
  const modelSupport = () => discussionAdapterSupport(getPreset('in_use'), ctx.MODEL_ADAPTERS);
  function protocolCompatible() {
    const state = ctx.getContext();
    return getLoadedPresetName() === owner && !!state?.chatId && Array.isArray(state?.chat)
      && host.__destinedPrimeMessageProcessor?.discussionProtocolVersion === 1
      && host.__destinedPrimeMessageProcessor?.discussionSettingsVersion === 6
      && host.__destinedPrimeMessageProcessor?.macroDiscussionVersion === 2
      && ctx.state.preset?.extensions?.destined_discussion?.version === 6
      && typeof eventMakeFirst === 'function'
      && typeof getChatMessages === 'function' && typeof setChatMessages === 'function'
      && (!mvu() || guardedMvu === mvu());
  }
  const compatible = () => protocolCompatible() && modelSupport().available;
  const incompatibleReason = () => protocolCompatible() ? modelSupport().reason : '需要支持讨论模式的配套预设、助手与当前聊天，请配套更新后重试。';
  const controller = createDiscussionController({
    contextKey, readMessage, lastMessageId: () => getLastMessageId(), compatible, incompatibleReason,
    readMode: () => getVariables({ type: 'chat' })?.[DISCUSSION_CHAT_KEY],
    writeMode: value => {
      const next = { ...getVariables({ type: 'chat' }), [DISCUSSION_CHAT_KEY]: value === 'discussion' };
      replaceVariables(next, { type: 'chat' });
    },
    writeMessage: messages.write,
    notify: message => toastr.error(message, '讨论模式'),
    changed: () => refresh(),
  });
  nativeMode = createNativeDiscussionMode({ host, ctx, contextKey,
    readChatMode: () => getVariables({ type: 'chat' })?.[DISCUSSION_CHAT_KEY],
    writeChatMode: async (enabled, origin) => {
      if (contextKey() !== origin) throw new Error('聊天已切换，未保存讨论模式。');
      const next = { ...getVariables({ type: 'chat' }), [DISCUSSION_CHAT_KEY]: enabled };
      replaceVariables(next, { type: 'chat' });
      if (contextKey() !== origin || getVariables({ type: 'chat' })?.[DISCUSSION_CHAT_KEY] !== enabled) throw new Error('讨论模式保存失败。');
    },
    busy: () => controller.busy, changed: () => refresh(),
    availability: () => protocolCompatible() ? modelSupport() : { available: true },
    onUnsupported: reason => (toastr.info ?? toastr.error)('已返回剧情模式。' + reason, '讨论模式'),
  });
  const click = async () => {
    try { await controller.toggle(); await nativeMode.synchronize(); } catch (error) { toastr.error(error.message, '讨论模式'); }
  };
  const ui = createDiscussionUi({ doc, ctx, onToggle: click });
  function resetLifecycleState() {
    quietPending = false;
    quietRejection = null;
    latestGenerationType = null;
    dryRunError = null;
    controller.contextChanged();
    nativeMode?.reset();
  }
  function ensureLifecycleContext() {
    const current = contextKey();
    if (current === lifecycleContext) return false;
    lifecycleContext = current;
    resetLifecycleState();
    return true;
  }
  function refresh(badges = true) {
    if (disposed) return;
    ensureLifecycleContext();
    syncVariableGuard();
    if (!controller.busy) nativeMode?.synchronize().catch(error => console.warn('[讨论模式] 原生开关同步失败。', error));
    ui.refresh({ available: compatible(), active: controller.mode === 'discussion', busy: controller.busy,
      unavailableReason: incompatibleReason() });
    if (!badges) return;
    try { controller.observe(getLastMessageId()); } catch { /* no current chat */ }
    for (const row of doc.querySelectorAll('#chat .mes[mesid]')) {
      const id = Number(row.getAttribute('mesid'));
      let item;
      try { item = readMessage(id); } catch { continue; }
      const existing = row.querySelector('.destined-discussion-badge');
      if (!isDiscussionMessage(item)) { existing?.remove(); continue; }
      if (!existing) {
        const badge = doc.createElement('span'); badge.className = 'destined-discussion-badge';
        badge.textContent = '讨论'; badge.style.cssText = 'display:inline-block;font-size:11px;padding:2px 6px;border-radius:5px;background:#65468b;color:white;margin:3px 6px;';
        (row.querySelector('.ch_name') ?? row.querySelector('.mes_block') ?? row).append(badge);
      }
    }
  }
  const subscribe = (name, handler, first = false) => {
    const event = tavern_events[name];
    if (!event) return;
    const stop = first && typeof eventMakeFirst === 'function' ? eventMakeFirst(event, handler) : eventOn(event, handler);
    stops.push(typeof stop === 'function' ? stop : () => eventRemoveListener(event, handler));
  };
  const subscribeLast = (name, handler) => {
    const event = tavern_events[name];
    if (!event || typeof eventMakeLast !== 'function') return;
    eventMakeLast(event, handler);
    stops.push(() => eventRemoveListener(event, handler));
  };
  subscribe('GENERATION_STARTED', async (...args) => {
    const [type = 'normal', _options = {}, dryRun = false] = args;
    ensureLifecycleContext();
    if (dryRun) {
      latestGenerationType = type;
      dryRunError = null;
      try {
        // A native click can happen immediately before the preview. Sync it
        // first; controller.mode alone may still be the previous chat value.
        const mode = await nativeMode.synchronize();
        nativeMode.prepareRound(mode, { type, dryRun: true });
      } catch (error) {
        dryRunError = error instanceof Error ? error : new Error(String(error));
        controller.fail(dryRunError);
      }
      return;
    }
    if (type === 'quiet') {
      // START precedes Tavern rebuilding its abort controller. Stop the frozen
      // discussion now, then cancel the quiet controller at AFTER_COMMANDS.
      // The terminal event has no type, so overlapping requests are rejected
      // instead of letting an untyped quiet end claim the discussion reply.
      if (controller.busy && controller.activeMode === 'discussion') {
        const error = new Error('讨论模式生成中，已拒绝并停止重叠的原生静默请求。');
        const stopGeneration = ctx.getContext()?.stopGeneration;
        quietRejection = { origin: lifecycleContext, error, quietAbortIssued: false };
        controller.fail(error);
        if (typeof stopGeneration !== 'function') {
          toastr.error(`${error.message} 当前酒馆未提供 stopGeneration 接口。`, '讨论模式');
          return;
        }
        try {
          stopGeneration();
          toastr.error(error.message, '讨论模式');
        } catch (stopError) {
          console.warn('[讨论模式] 无法停止重叠的原生生成。', stopError);
          toastr.error(`${error.message} 停止生成失败。`, '讨论模式');
        }
        return;
      }
      latestGenerationType = 'quiet'; quietPending = true;
      dryRunError = null;
      try { nativeMode.prepareRound('story', { type }); } catch (error) { console.warn('[讨论模式] 静默请求隔离失败。', error); }
      return;
    }
    if (!['normal', 'regenerate', 'swipe', 'continue'].includes(type)) return;
    quietRejection = null;
    latestGenerationType = type; dryRunError = null;
    try {
      await nativeMode.synchronize();
    } catch (error) {
      controller.start(type, { mode: controller.mode }); controller.fail(error); return;
    }
    if (controller.start(...args)) {
      let mode;
      try {
        mode = controller.requestMode();
        if (type === 'continue' && mode === 'discussion' && String(getPreset('in_use')?.settings?.assistant_prefill ?? '').trim()) {
          throw new Error('讨论模式继续生成不能与连接的 assistant_prefill 同时使用；请先清空该连接预填充后重试。');
        }
        nativeMode.prepareRound(mode, { type });
      } catch (error) {
        controller.fail(error);
      }
    }
  }, true);
  subscribe('GENERATION_AFTER_COMMANDS', (type = 'normal') => {
    if (type !== 'quiet' || quietRejection?.origin !== lifecycleContext) return;
    const stopGeneration = ctx.getContext()?.stopGeneration;
    if (typeof stopGeneration !== 'function') return;
    try {
      // AFTER_COMMANDS runs after Generate has installed the quiet request's
      // controller, so this abort cannot be mistaken for the earlier reply.
      quietRejection.quietAbortIssued = true;
      stopGeneration();
    } catch (error) {
      console.warn('[讨论模式] 无法停止被拒绝的原生静默请求。', error);
    }
  }, true);
  subscribe('MESSAGE_SENT', controller.sent, true);
  subscribe('MESSAGE_RECEIVED', controller.received, true);
  // First capture establishes the known source for MVU. The last listener
  // runs after Tavern has finalized the body and can safely write its wrapper.
  subscribeLast('MESSAGE_RECEIVED', controller.receivedFinal);
  const ended = async () => {
    ensureLifecycleContext();
    if (quietPending) { quietPending = false; nativeMode.finishQuiet(); latestGenerationType = null; return; }
    await controller.ended(); nativeMode.finishQuiet(); if (!controller.busy) latestGenerationType = null;
    if (quietRejection?.quietAbortIssued) quietRejection = null;
  };
  subscribe('GENERATION_ENDED', ended);
  // Tavern emits STOPPED immediately after hideStopButton. Ordinary stops use
  // ENDED as their finalization signal; only a rejected quiet overlap needs
  // STOPPED as a fallback while its two aborts are being unwound.
  subscribe('GENERATION_STOPPED', () => {
    if (quietRejection?.origin === lifecycleContext) return ended();
  });
  subscribe('MESSAGE_EDITED', controller.edited, true);
  subscribe('MESSAGE_SWIPED', controller.edited, true);
  const contextChanged = () => {
    lifecycleContext = contextKey();
    resetLifecycleState();
    void nativeMode.synchronize().catch(() => {});
  };
  subscribe('CHAT_CHANGED', contextChanged);
  subscribe('OAI_PRESET_CHANGED_AFTER', () => refresh(false));
  subscribe('USER_MESSAGE_RENDERED', refresh);
  subscribe('CHARACTER_MESSAGE_RENDERED', refresh);
  const timer = setInterval(() => refresh(false), 1500);
  function expandPrompt(text) {
    if (typeof text !== 'string') throw new TypeError('讨论提示词必须是文本。');
    const substitute = typeof substitudeMacros === 'function' ? substitudeMacros : host.substitudeMacros;
    let nativeExpanded = text;
    if (typeof substitute !== 'function') {
      if (/{{[^{}]+}}/.test(text)) throw new Error('当前酒馆缺少宏替换接口，无法展开讨论提示词中的酒馆宏。');
    } else {
      nativeExpanded = substitute(text);
    }
    return typeof ctx.expandManagedMacros === 'function' ? ctx.expandManagedMacros(nativeExpanded, true) : nativeExpanded;
  }
  const instance = {
    requestMode: ({ type, dryRun = false } = {}) => {
      ensureLifecycleContext();
      if (dryRun && dryRunError) throw dryRunError;
      const requestType = type ?? latestGenerationType ?? 'normal';
      if (requestType === 'quiet' && quietRejection?.origin === lifecycleContext) throw quietRejection.error;
      if (requestType === 'quiet') return 'story';
      const mode = controller.requestMode({ dryRun });
      if (dryRun) nativeMode.prepareRound(mode, { type: requestType, dryRun: true });
      return mode;
    },
    assertRequestReady: ({ type, dryRun = false, mode } = {}) => {
      ensureLifecycleContext();
      if (dryRun && dryRunError) throw dryRunError;
      const actual = instance.requestMode({ type, dryRun });
      if ((type ?? latestGenerationType) !== 'quiet') nativeMode.prepareRound(actual, { type: type ?? latestGenerationType ?? 'normal', dryRun });
      if (mode && mode !== actual) throw new Error('本轮讨论状态与请求标记不一致，已阻止发送。');
      return actual;
    },
    setRequestOutput: output => controller.setRequestOutput(output),
    requestOutput: () => controller.requestOutput(),
    // Kept for released processors that still call this bridge. History is no
    // longer a request prompt and must never be injected into a chat request.
    requestPrompts: () => ({}),
    requestPreset: () => getPreset('in_use'),
    expandPrompt,
    refresh,
    dispose() {
      if (disposed) return;
      disposed = true; controller.dispose(); clearInterval(timer); stops.forEach(stop => stop()); mvuStop?.();
      ui.dispose();
      doc.querySelectorAll('.destined-discussion-badge').forEach(item => item.remove());
      if (host[DISCUSSION_BRIDGE] === instance) delete host[DISCUSSION_BRIDGE];
    },
  };
  host[DISCUSSION_BRIDGE] = instance;
  refresh();
  return instance;
}
