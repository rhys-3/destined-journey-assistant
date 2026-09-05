import { writePresetStore } from '../platform/store.js';

// Dependencies use live accessors so asynchronous operations share the current state.
export function createStore(ctx) {
  function clone(value) {
    return typeof structuredClone === 'function'
      ? structuredClone(value)
      : JSON.parse(JSON.stringify(value));
  }

  function escapeHtml(value) {
    return String(value ?? '')
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#39;');
  }

  function normalizeName(value) {
    return String(value ?? '')
      .replace(/[📋🎯🧭📄✒️✨⚙️🎭🏁📚📤🔌🔥🛟🛡️🧠🧩🧪🧱]/gu, '')
      .trim();
  }

  function sanitizeIntegerSetting(value, fallback) {
    const normalized = String(value ?? '').trim();
    return /^-?\d+$/u.test(normalized) ? normalized : fallback;
  }

  function sanitizeManagedValues(value) {
    const source = value && typeof value === 'object' ? value : {};
    const person = ['first', 'second', 'third'].includes(source.narration_person)
      ? source.narration_person
      : ctx.DEFAULT_MANAGED_VALUES.narration_person;
    return {
      min_hanzi: sanitizeIntegerSetting(source.min_hanzi, ctx.DEFAULT_MANAGED_VALUES.min_hanzi),
      dialogue_ratio: sanitizeIntegerSetting(source.dialogue_ratio, ctx.DEFAULT_MANAGED_VALUES.dialogue_ratio),
      dialogue_round_trips: sanitizeIntegerSetting(source.dialogue_round_trips, ctx.DEFAULT_MANAGED_VALUES.dialogue_round_trips),
      combat_rounds: sanitizeIntegerSetting(source.combat_rounds, ctx.DEFAULT_MANAGED_VALUES.combat_rounds),
      narration_person: person,
      body_language: sanitizeLanguageSetting(source.body_language, ctx.DEFAULT_MANAGED_VALUES.body_language),
      thinking_language: sanitizeLanguageSetting(source.thinking_language, ctx.DEFAULT_MANAGED_VALUES.thinking_language),
      global_preference: typeof source.global_preference === 'string' ? source.global_preference : ctx.DEFAULT_MANAGED_VALUES.global_preference,
    };
  }

  function sanitizeLanguageSetting(value, fallback = '简体中文') {
    const normalized = String(value ?? '').trim();
    return normalized
      && normalized.length <= 80
      && !/[\u0000-\u001f\u007f<>{}]/u.test(normalized)
      ? normalized
      : fallback;
  }

  function loadScriptConfig() {
    let raw = {};
    try {
      raw = getVariables({ type: 'script' }) ?? {};
    } catch (error) {
      console.warn(`[${ctx.SCRIPT_NAME}] 无法读取脚本变量，使用默认配置。`, error);
    }
    const source = raw.connection_link ?? {};
    const bindings = source.bindings ?? {};
    const result = {
      ...raw,
      managed_values_version: Number(raw.managed_values_version) || 0,
      style_structure_version: Number(raw.style_structure_version) || 0,
      managed_values: sanitizeManagedValues(raw.managed_values),
      entry_points: sanitizeEntryPoints(raw.entry_points),
      connection_link: {
        enabled: source.enabled === true,
        bindings: {
          ...Object.fromEntries(Object.entries(bindings).map(([key, value]) => [key, sanitizeBinding(value)])),
          Gemini: sanitizeBinding(bindings.Gemini),
          Claude: sanitizeBinding(bindings.Claude),
          DeepSeek: sanitizeBinding(bindings.DeepSeek),
        },
      },
    };
    try {
      delete result.configuration_error;
      result.custom_models = ctx.validateCustomModels(raw.custom_models ?? []);
      result.configuration_library = ctx.validateLibrary(raw.configuration_library ?? ctx.emptyLibrary());
      result.model_tail_modes = { Gemini: 'no-prefill', ...raw.model_tail_modes };
    } catch (error) {
      result.configuration_error = '配置数据未载入：' + error.message + '。原始数据已保留，请先导出备份。';
      console.error('[' + ctx.SCRIPT_NAME + ']', error);
    }
    return result;
  }

  function sanitizeEntryPoints(source) {
    const value = source && typeof source === 'object' ? source : {};
    const points = {
      floating_orb: value.floating_orb !== false,
      input_button: value.input_button !== false,
      wand_menu: value.wand_menu !== false,
    };
    if (!Object.values(points).some(Boolean)) points.floating_orb = true;
    return points;
  }

  function sanitizeBinding(binding) {
    if (!binding || typeof binding !== 'object') return null;
    const id = typeof binding.id === 'string' ? binding.id : '';
    const name = typeof binding.name === 'string' ? binding.name : '';
    return id || name ? { id, name } : null;
  }

  function saveScriptConfig(message = '连接配置已保存') {
    return enqueueScriptConfigSave(message);
  }

  async function commitScriptConfig(label) {
    setSaveStatus('saving', `正在保存：${label}`);
    try {
      writePresetStore(ctx.state.config);
      ctx.savedScriptConfig = clone(ctx.state.config);
      ctx.rebuildModelRegistry();
      setSaveStatus('saved', `已保存：${label}`);
    } catch (error) {
      ctx.state.config = clone(ctx.savedScriptConfig);
      ctx.rebuildModelRegistry();
      ctx.renderActiveContent(true);
      const message = error instanceof Error ? error.message : String(error);
      setSaveStatus('error', `保存失败：${message}`);
      throw error;
    }
  }

  function enqueueScriptConfigSave(label, debounceKey = null) {
    const enqueueConfig = () => {
      const task = ctx.saveChain.then(() => commitScriptConfig(label));
      ctx.saveChain = task.catch(error => console.error(`[${ctx.SCRIPT_NAME}] ${label} 失败。`, error));
      return task;
    };
    if (!debounceKey) return enqueueConfig();
    const key = `config:${debounceKey}`;
    const previous = ctx.debounceTimers.get(key);
    if (previous) {
      clearTimeout(previous.timer);
      previous.resolve({ superseded: true });
    }
    return new Promise((resolve, reject) => {
      const flush = () => {
        clearTimeout(timer);
        ctx.debounceTimers.delete(key);
        const task = enqueueConfig();
        task.then(resolve, reject);
        return task;
      };
      const timer = setTimeout(flush, ctx.SAVE_DELAY);
      ctx.debounceTimers.set(key, { timer, resolve, reject, flush });
    });
  }

  function getContext() {
    try {
      return SillyTavern.getContext?.() ?? SillyTavern;
    } catch {
      return SillyTavern;
    }
  }

  function getPrompt(preset, id) {
    return preset?.prompts?.find(prompt => prompt.id === id);
  }

  function requirePrompt(preset, id) {
    const prompt = getPrompt(preset, id);
    if (!prompt) throw new Error(`找不到预设条目：${id}`);
    return prompt;
  }

  function fingerprintPresetValue(preset) {
    if (!preset) return '';
    return JSON.stringify({
      settings: preset.settings,
      author: preset.extensions?.destined_author,
      prompts: (preset.prompts ?? []).map(prompt => ({
        id: prompt.id,
        name: prompt.name,
        enabled: prompt.enabled,
        position: prompt.position,
        role: prompt.role,
        content: prompt.content,
        extra: prompt.extra,
      })),
      prompts_unused: (preset.prompts_unused ?? []).map(prompt => ({
        id: prompt.id,
        name: prompt.name,
        enabled: prompt.enabled,
        position: prompt.position,
        role: prompt.role,
        content: prompt.content,
        extra: prompt.extra,
      })),
    });
  }

  function refreshPreset(shouldRender = true) {
    try {
      ctx.state.preset = clone(getPreset('in_use'));
      ctx.presetFingerprint = fingerprintPresetValue(ctx.state.preset);
      if (shouldRender) ctx.renderActiveContent(true);
    } catch (error) {
      ctx.state.preset = null;
      setSaveStatus('error', `读取当前预设失败：${error instanceof Error ? error.message : String(error)}`);
    }
  }

  function setSaveStatus(kind, message) {
    ctx.state.saveState = kind;
    ctx.state.saveMessage = message;
    ctx.renderStatus();
  }

  async function commitPresetMutation(label, mutator, guard = null, fromCurrent = false) {
    const startingName = getLoadedPresetName();
    const callerGuard = guard;
    guard = () => !ctx.destroyed && getLoadedPresetName() === startingName && (!callerGuard || callerGuard());
    if (guard && !guard()) throw new Error('上下文已变化，已停止保存');
    setSaveStatus('saving', `正在保存：${label}`);

    const loadedName = getLoadedPresetName();
    const targets = loadedName && loadedName !== 'in_use' ? [loadedName, 'in_use'] : ['in_use'];
    const before = new Map();
    const after = new Map();
    const current = fromCurrent ? clone(getPreset('in_use')) : null;

    for (const target of targets) {
      const snapshot = clone(getPreset(target));
      before.set(target, snapshot);
      const next = clone(current ?? snapshot);
      mutator(next);
      after.set(target, next);
    }

    const written = [];
    ctx.commitInProgress = true;
    try {
      for (const target of targets) {
        if (guard && !guard()) throw new Error('上下文已变化，已停止保存');
        written.push(target);
        await replacePreset(target, after.get(target), {
          render: target === 'in_use' ? 'debounced' : 'none',
        });
        if (fingerprintPresetValue(getPreset(target)) !== fingerprintPresetValue(after.get(target))) throw new Error('保存结果与预期不一致，可能存在外部并发修改。');
        if (ctx.destroyed || getLoadedPresetName() !== startingName) throw new Error('上下文已变化，已停止保存');
      }
      ctx.state.preset = clone(getPreset('in_use'));
      ctx.presetFingerprint = fingerprintPresetValue(ctx.state.preset);
      setSaveStatus('saved', `已保存：${label}`);
    } catch (error) {
      const rollbackIssues = [];
      for (const target of written.reverse()) {
        if (target === 'in_use' && (ctx.destroyed || getLoadedPresetName() !== startingName)) { rollbackIssues.push(target + '（上下文已变化）'); continue; }
        try {
          const actual = fingerprintPresetValue(getPreset(target));
          if (actual === fingerprintPresetValue(before.get(target))) continue;
          if (actual !== fingerprintPresetValue(after.get(target))) { rollbackIssues.push(target + '（外部修改，未覆盖）'); continue; }
          await replacePreset(target, before.get(target), {
            render: target === 'in_use' ? 'debounced' : 'none',
          });
        } catch (rollbackError) {
          rollbackIssues.push(target);
          console.error(`[${ctx.SCRIPT_NAME}] 回滚 ${target} 失败。`, rollbackError);
        }
      }
      if (rollbackIssues.length) error.message += '；回滚失败：' + rollbackIssues.join('、');
      ctx.state.preset = clone(getPreset('in_use'));
      ctx.presetFingerprint = fingerprintPresetValue(ctx.state.preset);
      ctx.renderActiveContent(true);
      const message = error instanceof Error ? error.message : String(error);
      setSaveStatus('error', `保存失败：${message}`);
      throw error;
    } finally {
      ctx.commitInProgress = false;
      if (ctx.reconcilePending) {
        ctx.reconcilePending = false;
        queueMicrotask(() => reconcilePreset('保存后同步'));
      }
    }
  }

  function trackPresetOperation(task) {
    ctx.pendingPresetOperations += 1;
    return task.finally(() => {
      ctx.pendingPresetOperations = Math.max(0, ctx.pendingPresetOperations - 1);
      if (ctx.pendingPresetOperations === 0 && ctx.reconcilePending && !ctx.commitInProgress) {
        ctx.reconcilePending = false;
        queueMicrotask(() => reconcilePreset('本地保存后同步'));
      }
    });
  }

  function queuePresetMutation(label, mutator, debounceKey = null) {
    try {
      const optimistic = clone(ctx.state.preset);
      mutator(optimistic);
      ctx.state.preset = optimistic;
    } catch (error) {
      return Promise.reject(error);
    }
    if (debounceKey) {
      const previous = ctx.debounceTimers.get(debounceKey);
      if (previous) {
        clearTimeout(previous.timer);
        previous.resolve({ superseded: true });
      }
      return trackPresetOperation(new Promise((resolve, reject) => {
        const flush = () => {
          clearTimeout(timer);
          ctx.debounceTimers.delete(debounceKey);
          const task = enqueue(label, mutator);
          task.then(resolve, reject);
          return task;
        };
        const timer = setTimeout(flush, ctx.SAVE_DELAY);
        ctx.debounceTimers.set(debounceKey, { timer, resolve, reject, flush });
      }));
    }
    return trackPresetOperation(enqueue(label, mutator));
  }

  function enqueue(label, mutator) {
    const presetName = getLoadedPresetName();
    const task = ctx.saveChain.then(() => commitPresetMutation(label, mutator, () => getLoadedPresetName() === presetName));
    ctx.saveChain = task.catch(error => {
      console.error(`[${ctx.SCRIPT_NAME}] ${label} 失败。`, error);
    });
    return task;
  }

  function reconcilePreset(reason = '外部预设变化') {
    if (ctx.destroyed) return;
    if (ctx.commitInProgress || ctx.pendingPresetOperations > 0 || ctx.state.workspaceBusy) {
      ctx.reconcilePending = true;
      return;
    }
    try {
      const next = clone(getPreset('in_use'));
      const nextFingerprint = fingerprintPresetValue(next);
      if (ctx.state.promptEditor && ctx.state.promptEditor.presetName !== getLoadedPresetName()) ctx.renderStyleEditorLayer();
      if (nextFingerprint === ctx.presetFingerprint) return;
      ctx.state.preset = next;
      ctx.presetFingerprint = nextFingerprint;
      if (ctx.state.open) {
        ctx.renderActiveContent(true);
        ctx.ensurePromptMetadata();
      }
      setSaveStatus('saved', `已同步：${reason}`);
    } catch (error) {
      console.warn(`[${ctx.SCRIPT_NAME}] 同步外部预设变化失败。`, error);
    }
  }

  return {
    clone,
    escapeHtml,
    normalizeName,
    sanitizeIntegerSetting,
    sanitizeManagedValues,
    sanitizeLanguageSetting,
    loadScriptConfig,
    sanitizeEntryPoints,
    sanitizeBinding,
    saveScriptConfig,
    commitScriptConfig,
    enqueueScriptConfigSave,
    getContext,
    getPrompt,
    requirePrompt,
    fingerprintPresetValue,
    refreshPreset,
    setSaveStatus,
    commitPresetMutation,
    trackPresetOperation,
    queuePresetMutation,
    enqueue,
    reconcilePreset
  };
}
