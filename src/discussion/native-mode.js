export const NATIVE_DISCUSSION_TOGGLE_ID = 'destined-discussion-toggle';
export const DISCUSSION_ROUND_MACRO = '本轮场外讨论';

function nativeSubstitute(host) {
  return typeof substitudeMacros === 'function' ? substitudeMacros : host?.substitudeMacros;
}

/**
 * The preset toggle is a view of the current chat, not shared configuration.
 * Only Tavern's macro interface writes the round value: Helper chat variables
 * deliberately never stand in for that scope.
 */
export function createNativeDiscussionMode({ host, ctx, contextKey, readChatMode, writeChatMode, busy, changed,
  availability = () => ({ available: true }), onUnsupported }) {
  let reflected = null;
  let quietRestore = null;
  let synchronizing = null;
  const currentPreset = () => getPreset('in_use');
  const toggle = (preset = currentPreset()) => [...(preset?.prompts ?? []), ...(preset?.prompts_unused ?? [])]
    .find(prompt => prompt.id === NATIVE_DISCUSSION_TOGGLE_ID) ?? null;
  const modeOf = value => value === true || value === 'discussion' ? 'discussion' : 'story';
  const rawMode = () => readChatMode();
  const savedMode = () => modeOf(rawMode());
  const isCurrent = origin => contextKey() === origin;

  function readEnabled() {
    const item = toggle();
    if (!item) throw new Error('当前预设缺少讨论模式总开关，请导入配套预设。');
    return item.enabled === true;
  }
  async function writeEnabled(enabled, origin = contextKey()) {
    const before = toggle();
    if (!before) throw new Error('当前预设缺少讨论模式总开关，请导入配套预设。');
    if (before.enabled === enabled) { reflected = { origin, enabled }; return; }
    await ctx.queuePresetMutation('同步讨论模式总开关', preset => {
      if (!isCurrent(origin)) throw new Error('聊天已切换，未同步讨论模式总开关。');
      const item = toggle(preset);
      if (!item) throw new Error('当前预设缺少讨论模式总开关，请导入配套预设。');
      item.enabled = enabled;
    });
    if (!isCurrent(origin) || readEnabled() !== enabled) throw new Error('原生讨论模式总开关保存失败。');
    reflected = { origin, enabled };
  }
  async function persist(mode, origin = contextKey()) {
    await writeChatMode(mode === 'discussion', origin);
    if (!isCurrent(origin) || savedMode() !== mode) throw new Error('讨论模式保存失败。');
    changed?.();
  }

  /** Capture a direct native click before copying the chat state back to it. */
  async function synchronizeNow({ preferNative = false } = {}, origin = contextKey()) {
    if (!isCurrent(origin)) throw new Error('聊天已切换，未同步讨论模式总开关。');
    const enabled = readEnabled();
    const support = availability();
    if (!busy() && !support.available) {
      const hadDiscussion = enabled || savedMode() === 'discussion';
      if (savedMode() !== 'story') await persist('story', origin);
      await writeEnabled(false, origin);
      if (hadDiscussion) onUnsupported?.(support.reason);
      return 'story';
    }
    const nativeChanged = reflected?.origin === origin && reflected.enabled !== enabled;
    if (!busy() && (preferNative || nativeChanged) && savedMode() !== (enabled ? 'discussion' : 'story')) await persist(enabled ? 'discussion' : 'story', origin);
    const mode = savedMode();
    if (!busy()) await writeEnabled(mode === 'discussion', origin);
    return mode;
  }
  function synchronize(options) {
    const origin = contextKey();
    if (synchronizing?.origin === origin) return synchronizing.promise;
    const job = { origin };
    job.promise = Promise.resolve().then(() => synchronizeNow(options, origin)).finally(() => {
      if (synchronizing === job) synchronizing = null;
    });
    synchronizing = job;
    return job.promise;
  }
  function writeRound(mode) {
    const substitute = nativeSubstitute(host);
    if (typeof substitute !== 'function') throw new Error('当前酒馆缺少原生宏接口，无法写入本轮讨论状态。');
    const value = mode === 'discussion' ? '1' : '0';
    substitute(`{{setvar::${DISCUSSION_ROUND_MACRO}::${value}}}`);
    const actual = String(substitute(`{{getvar::${DISCUSSION_ROUND_MACRO}}}`) ?? '').trim();
    if (actual !== value) throw new Error('原生本轮讨论变量写入失败。');
  }
  function prepareRound(mode, { type = 'normal', dryRun = false } = {}) {
    if (mode === 'discussion') {
      const support = availability();
      if (!support.available) throw new Error(support.reason || '当前模型条目不支持讨论模式。');
    }
    if (dryRun) { writeRound(mode); return mode; }
    if (type === 'quiet') {
      if (busy()) return 'story';
      const substitute = nativeSubstitute(host);
      if (typeof substitute !== 'function') throw new Error('当前酒馆缺少原生宏接口，无法隔离静默请求。');
      quietRestore = String(substitute(`{{getvar::${DISCUSSION_ROUND_MACRO}}}`) ?? '').trim();
      writeRound('story');
      return 'story';
    }
    writeRound(mode);
    return mode;
  }
  function finishQuiet() {
    if (quietRestore == null || busy()) return;
    const value = quietRestore; quietRestore = null;
    const substitute = nativeSubstitute(host);
    if (typeof substitute !== 'function') return;
    substitute(`{{setvar::${DISCUSSION_ROUND_MACRO}::${value === '1' ? '1' : '0'}}}`);
  }
  function reset() { reflected = null; quietRestore = null; synchronizing = null; }
  return { readEnabled, savedMode, synchronize, persist, writeEnabled, writeRound, prepareRound, finishQuiet, reset };
}
