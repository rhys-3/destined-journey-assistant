import * as summary from '../summary/service.js';
import { DISCUSSION_SETTINGS_KEY } from '../discussion/preferences.js';
import { writePresetStore } from '../platform/store.js';
import { FLAVOR } from '../flavor.js';
import { OPTIONAL_MODEL_PROMPT_IDS } from './definitions.js';
import { RECOVERY_ID, setLibraryField } from './configuration-schema.js';

// Dependencies use live accessors so asynchronous operations share the current state.
export function createConfigurations(ctx) {
  async function runWorkspaceOperation(label, operation) {
    if (ctx.state.workspaceBusy || summary.busy()) throw new Error('上一项操作尚未完成，请稍候。');
    ctx.assertData(!ctx.state.connectionRequest, '连接请求尚未结束，请等待完成后再操作。');
    ctx.assertData(!ctx.state.config.configuration_error, ctx.state.config.configuration_error);
    ctx.assertData(!ctx.state.promptEditor && !ctx.state.styleEditor, '请先保存或关闭条目编辑器，再操作配置。');
    ctx.assertData(!ctx.hasSettingDraftErrors(), '请先修正或重新保存设定列表中的未保存内容。');
    ctx.assertData(![...(ctx.shadow?.querySelectorAll('[data-action="field-number"]') ?? [])].some(input => !/^-?\d+$/u.test(input.value.trim())), '请先修正当前页面尚未保存的无效数值。');
    ctx.assertData(!ctx.worldLink.busy && !ctx.worldWrites.size, FLAVOR.id === 'general' ? '变量模式正在保存，请稍候。' : '世界书同步尚未完成，请稍候。');
    const name = getLoadedPresetName();
    const contextKey = ctx.workspaceContextKey();
    const current = () => !ctx.destroyed && getLoadedPresetName() === name && ctx.workspaceContextKey() === contextKey;
    ctx.state.workspaceBusy = true;
    ctx.clearLengthDraft?.();
    if (ctx.shadow?.activeElement?.dataset.action === 'length-number') ctx.shadow.activeElement.blur();
    ctx.cancelPromptSort();
    ctx.worldEpoch += 1;
    clearTimeout(ctx.worldTimer);
    ctx.setSaveStatus('saving', label);
    ctx.updateWorkspaceUi();
    try {
      await ctx.flushPendingSaves();
      ctx.assertData(current(), '上下文已变化，操作已取消。');
      ctx.state.preset = ctx.clone(getPreset('in_use'));
      const result = await operation(current);
      ctx.assertData(current(), '上下文已变化，请检查当前状态。');
      ctx.setSaveStatus('saved', label + '完成');
      return result;
    } catch (error) {
      ctx.setSaveStatus('error', error.message ?? String(error));
      throw error;
    } finally {
      ctx.state.workspaceBusy = false;
      if (!ctx.destroyed) {
        ctx.rebuildModelRegistry();
        ctx.refreshPreset(false);
        ctx.syncEntryPoints();
        ctx.renderActiveContent(true);
        ctx.updateWorkspaceUi();
        if (ctx.reconcilePending) { ctx.reconcilePending = false; ctx.reconcilePreset(); }
      }
    }
  }

  function writeConfigurationData(next, current = () => !ctx.destroyed) {
    ctx.assertData(current(), '上下文已变化，未写入配置。');
    const before = ctx.clone(getVariables({ type: 'script' }));
    try {
      ctx.writeScriptConfig(next, true);
      ctx.assertData(current(), '上下文已变化，配置保存未完成。');
      ctx.state.config = ctx.clone(next);
      ctx.savedScriptConfig = ctx.clone(next);
      ctx.rebuildModelRegistry();
    } catch (error) {
      if (current()) {
        try { writePresetStore(before); }
        catch (rollbackError) { error.message += '；脚本设置回滚失败：' + rollbackError.message; }
      }
      throw error;
    }
  }

  async function writeWorkspace(nextPreset, nextConfig, current) {
    const beforeCurrent = ctx.clone(getPreset('in_use'));
    const name = getLoadedPresetName();
    const beforeNamed = name && name !== 'in_use' ? ctx.clone(getPreset(name)) : null;
    const fingerprint = ctx.fingerprintPresetValue(beforeCurrent);
    const guard = () => current() && ctx.fingerprintPresetValue(getPreset('in_use')) === fingerprint;
    // Apply only the snapshot-owned fields. Preserve each target's latest extensions.
    await ctx.commitPresetMutation('配置与模型条目', preset => {
      preset.settings = { ...preset.settings, ...nextPreset.settings };
      preset.prompts = ctx.clone(nextPreset.prompts);
      preset.prompts_unused = ctx.clone(nextPreset.prompts_unused ?? []);
      preset.extensions ??= {};
      const author = Object.hasOwn(nextPreset,'author') ? nextPreset.author : nextPreset.extensions?.destined_author;
      if (author) preset.extensions.destined_author = ctx.clone(author);
      else delete preset.extensions.destined_author;
      if (Object.hasOwn(nextPreset, 'discussion')) {
        if (nextPreset.discussion === null) delete preset.extensions[DISCUSSION_SETTINGS_KEY];
        else preset.extensions[DISCUSSION_SETTINGS_KEY] = ctx.clone(nextPreset.discussion);
      }
    }, guard);
    try {
      writeConfigurationData(nextConfig, current);
    } catch (error) {
      const issues = [];
      for (const [target, before] of [[name, beforeNamed], ['in_use', beforeCurrent]]) {
        if (!before || !current()) { if (before) issues.push(target + '（上下文已变化）'); continue; }
        try { await replacePreset(target, before, { render: target === 'in_use' ? 'debounced' : 'none' }); }
        catch (rollbackError) { issues.push(target + '：' + rollbackError.message); }
      }
      if (issues.length) error.message += '；预设回滚未完成：' + issues.join('、');
      throw error;
    }
  }

  function requireConfigurationLibrary() {
    const error = ctx.state.config.configuration_library_error;
    ctx.assertData(!error, error);
    return ctx.configLibrary();
  }

  function keepDuplicatePositions(config, removedIndex = -1) {
    // Keep the accepted record for each ID or name when an edit removes a conflict.
    const indices = config.configuration_library_view.duplicateIndices;
    if (!indices.length) return;
    const nextIndices = removedIndex < 0 ? indices : indices.map(index => index > removedIndex ? index - 1 : index);
    setLibraryField(config, 'duplicateItemIndices', nextIndices);
  }

  function captureRecovery(scopes = { preset: true, summary: false }) {
    requireConfigurationLibrary();
    const snapshot = ctx.validateSnapshot(ctx.captureConfiguration(getPreset('in_use'), ctx.state.config, scopes));
    return { createdAt: new Date().toISOString(), snapshot };
  }

  async function saveNamedConfiguration(name, overwriteId = '', scopes = ctx.configurationScopes) {
    return runWorkspaceOperation('保存配置', async current => {
      const library = requireConfigurationLibrary();
      const next = ctx.clone(ctx.state.config);
      const source = next.configuration_library;
      const position = library.items.findIndex(item => item.id === overwriteId);
      const previous = library.items[position];
      ctx.assertData(!overwriteId || previous, '要覆盖的配置已不存在');
      const chosenName = ctx.validName(previous?.name ?? name, library.items, overwriteId);
      const now = new Date().toISOString();
      const item = { id: previous?.id ?? ctx.createPromptId(), name: chosenName, createdAt: previous?.createdAt ?? now, updatedAt: now, snapshot: ctx.validateSnapshot(ctx.captureConfiguration(getPreset('in_use'), ctx.state.config, scopes)) };
      if (previous) source.items[library.itemIndices[position]] = item;
      else {
        ctx.assertData(!source.items.some(record => record?.id === item.id), '配置 ID 重复，请重新保存。');
        source.items.push(item);
      }
      setLibraryField(next, 'activeId', item.id);
      writeConfigurationData(next, current);
      ctx.state.configurationName = '';
      return item.id;
    });
  }

  async function renameConfiguration(id, name) {
    return runWorkspaceOperation('重命名配置', async current => {
      const library = requireConfigurationLibrary();
      const next = ctx.clone(ctx.state.config);
      const index = library.itemIndices[library.items.findIndex(item => item.id === id)];
      ctx.assertData(index !== undefined, '配置已不存在');
      const item = next.configuration_library.items[index];
      item.name = ctx.validName(name, library.items, id);
      item.updatedAt = new Date().toISOString();
      keepDuplicatePositions(next);
      writeConfigurationData(next, current);
    });
  }

  async function deleteConfiguration(id) {
    return runWorkspaceOperation('删除配置', async current => {
      const library = requireConfigurationLibrary();
      const next = ctx.clone(ctx.state.config);
      const index = library.itemIndices[library.items.findIndex(item => item.id === id)];
      ctx.assertData(index !== undefined, '配置已不存在');
      next.configuration_library.items.splice(index, 1);
      keepDuplicatePositions(next, index);
      if (library.activeId === id) setLibraryField(next, 'activeId', null);
      writeConfigurationData(next, current);
    });
  }

  async function deleteInvalidConfigurationData() {
    return runWorkspaceOperation('删除未载入的配置数据', async current => {
      const library = requireConfigurationLibrary();
      ctx.assertData(ctx.state.config.configuration_library_issues?.length, '没有需要删除的未载入配置数据。');
      const next = ctx.clone(ctx.state.config);
      const source = next.configuration_library;
      source.items = library.itemIndices.map(index => source.items[index]);
      delete source.duplicateItemIndices;
      delete source.unreadableMetadata;
      for (const field of ['recovery', 'activeId', 'pendingWorld']) {
        if (library.invalidFields.includes(field)) source[field] = null;
      }
      writeConfigurationData(next, current);
    });
  }

  async function resetConfigurationLibrary() {
    return runWorkspaceOperation('重置配置库', async current => {
      ctx.assertData(ctx.state.config.configuration_library_error, '当前配置库可正常读取。');
      const next = { ...ctx.clone(ctx.state.config), configuration_library: ctx.emptyLibrary() };
      writeConfigurationData(next, current);
    });
  }

  async function withLinkedConnection(config, modelId, current, operation) {
    if (!config.connection_link.enabled) return operation();
    const expected = ctx.fingerprintPresetValue(getPreset('in_use'));
    const sourceContext = JSON.parse(ctx.workspaceContextKey()).slice(1);
    const sameChat = () => JSON.stringify(JSON.parse(ctx.workspaceContextKey()).slice(1)) === JSON.stringify(sourceContext);
    await ctx.loadProfiles(false);
    ctx.assertData(current() && ctx.fingerprintPresetValue(getPreset('in_use')) === expected, '上下文或预设内容已变化，未切换连接');
    const profile = ctx.resolveBoundProfile(config.connection_link.bindings[modelId]);
    ctx.assertData(profile, '所选模型没有有效且唯一的酒馆连接绑定。');
    const previousName = await ctx.getCurrentProfileName();
    ctx.assertData(previousName, '无法读取当前连接，已停止切换以保证可恢复。');
    ctx.assertData(current() && ctx.fingerprintPresetValue(getPreset('in_use')) === expected, '上下文或预设内容已变化，未切换连接');
    const rollback = async () => {
      ctx.assertData(!ctx.destroyed && sameChat(), '上下文已变化，未向新聊天写入旧连接');
      const actualName = await ctx.getCurrentProfileName();
      if (actualName === previousName) return;
      ctx.assertData(actualName === profile.name, '连接已被外部修改，未覆盖当前连接');
      await ctx.withWorldTimeout(Promise.resolve(triggerSlash('/profile await=true timeout=' + ctx.PROFILE_TIMEOUT + ' ' + ctx.slashQuote(previousName))), '恢复原连接', ctx.PROFILE_TIMEOUT);
      ctx.assertData(await ctx.getCurrentProfileName() === previousName, '原连接未恢复');
    };
    let settled = false;
    const request = Promise.resolve().then(() => ctx.switchConnectionProfile(profile));
    ctx.state.connectionRequest = request;
    request.then(() => { settled = true; }, () => { settled = true; });
    try {
      await ctx.withWorldTimeout(request, '切换连接', ctx.PROFILE_TIMEOUT);
      ctx.assertData(current(), `连接配置改变了当前预设或聊天，请使用绑定当前${FLAVOR.presetLabel}的连接配置。`);
      ctx.assertData(ctx.fingerprintPresetValue(getPreset('in_use')) === expected, '连接切换期间预设内容发生变化，未覆盖。');
      return await operation();
    } catch (error) {
      if (!settled) {
        error.message += '；旧请求尚未结束，已暂停新的配置切换，结束后尝试恢复原连接。';
        const finish = async () => {
          try {
            await rollback();
            if (!ctx.destroyed) ctx.setSaveStatus('error', '连接请求曾超时，迟到请求已结束并恢复原连接；配置未应用。');
          } catch (lateError) {
            if (!ctx.destroyed) ctx.setSaveStatus('error', '迟到连接请求恢复未完成：' + lateError.message);
          } finally {
            if (ctx.state.connectionRequest === request) ctx.state.connectionRequest = null;
            if (!ctx.destroyed) ctx.updateWorkspaceUi();
          }
        };
        request.then(finish, finish);
      } else {
        try { await rollback(); }
        catch (rollbackError) { error.message += '；连接回滚失败：' + rollbackError.message; }
      }
      throw error;
    } finally {
      if (settled && ctx.state.connectionRequest === request) ctx.state.connectionRequest = null;
    }
  }

  // A snapshot saved before an optional model entry existed would drop that
  // entry from the preset. Keep the current copy, disabled, after its sibling tail.
  function keepOptionalModelPrompts(snapshot, preset) {
    const listed = new Set([...snapshot.prompts, ...snapshot.prompts_unused].map(prompt => prompt.id));
    const result = { ...snapshot, prompts: [...snapshot.prompts], prompts_unused: [...snapshot.prompts_unused] };
    for (const id of OPTIONAL_MODEL_PROMPT_IDS) {
      const current = [...(preset?.prompts ?? []), ...(preset?.prompts_unused ?? [])].find(prompt => prompt.id === id);
      if (listed.has(id) || !current) continue;
      const copy = { ...ctx.snapshotPrompt(current), enabled: false };
      const siblings = Object.values(ctx.BUILTIN_MODEL_ADAPTERS).find(adapter => adapter.tails.includes(id))?.tails ?? [];
      const anchor = result.prompts.findLastIndex(prompt => siblings.includes(prompt.id));
      if (anchor >= 0) result.prompts.splice(anchor + 1, 0, copy);
      else result.prompts_unused.push(copy);
    }
    return result;
  }

  async function applyConfiguration(id) {
    let worldMode = null;
    await runWorkspaceOperation('切换配置', async current => {
      const library = requireConfigurationLibrary();
      const source = id === RECOVERY_ID ? library.recovery : library.items.find(item => item.id === id);
      ctx.assertData(source, '配置或恢复点不存在。');
      const complete = ctx.validateSnapshot(ctx.clone(source.snapshot));
      const snapshot = complete.preset ? keepOptionalModelPrompts(complete.preset, getPreset('in_use')) : null;
      const modelId = snapshot ? ctx.detectModelAdapter(snapshot, ctx.modelRegistry(snapshot.config)) : null;
      if(snapshot) ctx.assertData(modelId || !snapshot.config.connection_link.enabled, '配置的模型条目未正确互斥，无法联动连接。');
      const recovery = captureRecovery(ctx.selectedScopes(complete));
      const apply = async () => {
        const next = { ...ctx.clone(ctx.state.config), ...(snapshot ? ctx.clone(snapshot.config) : {}) };
        setLibraryField(next, 'recovery', recovery);
        setLibraryField(next, 'activeId', id === RECOVERY_ID ? null : id);
        if(snapshot) {
          if (FLAVOR.id === 'general') setLibraryField(next, 'pendingWorld', null);
          else {
            worldMode = ctx.variablePresetMode(snapshot);
            setLibraryField(next, 'pendingWorld', { key: ctx.workspaceContextKey(), mode: worldMode });
          }
        }
        try {
          if(complete.summary) await summary.apply(complete.summary);
          ctx.assertData(current(), '上下文已变化，配置已停止应用');
          if(snapshot) await writeWorkspace(snapshot, next, current);
          else writeConfigurationData(next, current);
        } catch(error) {
          if(complete.summary && current()) { try { await summary.apply(recovery.snapshot.summary); } catch(rollback) { error.message += '；总结配置回滚失败：' + rollback.message; } }
          throw error;
        }
        ctx.clearSettingDrafts();
        ctx.state.reorderUndo = null; ctx.state.editorUnlocked = false;
      };
      if(snapshot) await withLinkedConnection(snapshot.config, modelId, current, apply);
      else await apply();
    });
    if (worldMode && !ctx.destroyed) {
      await ctx.selectVariableMode(worldMode);
      if (ctx.configLibrary().pendingWorld?.key === ctx.workspaceContextKey()) ctx.setSaveStatus('idle', '配置已应用，世界书待同步；请在日常调整中重新检查。');
      else ctx.setSaveStatus('saved', ctx.worldLink.books.length ? '配置已应用，世界书同步完成。' : '配置已应用，当前没有需要同步的变量世界书。');
    }
  }

  return {
    runWorkspaceOperation,
    writeConfigurationData,
    writeWorkspace,
    captureRecovery,
    saveNamedConfiguration,
    renameConfiguration,
    deleteConfiguration,
    deleteInvalidConfigurationData,
    resetConfigurationLibrary,
    withLinkedConnection,
    applyConfiguration
  };
}
