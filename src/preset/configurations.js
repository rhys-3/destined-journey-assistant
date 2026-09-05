import * as summary from '../summary/service.js';
import { writePresetStore } from '../platform/store.js';

// Dependencies use live accessors so asynchronous operations share the current state.
export function createConfigurations(ctx) {
  async function runWorkspaceOperation(label, operation) {
    if (ctx.state.workspaceBusy || summary.busy()) throw new Error('上一项操作尚未完成，请稍候。');
    ctx.assertData(!ctx.state.connectionRequest, '连接请求尚未结束，请等待完成后再操作。');
    ctx.assertData(!ctx.state.config.configuration_error, ctx.state.config.configuration_error);
    ctx.assertData(!ctx.state.promptEditor && !ctx.state.styleEditor, '请先保存或关闭条目编辑器，再操作配置。');
    ctx.assertData(![...(ctx.shadow?.querySelectorAll('[data-action="field-number"]') ?? [])].some(input => !/^-?\d+$/u.test(input.value.trim())), '请先修正当前页面尚未保存的无效数值。');
    ctx.assertData(!ctx.worldLink.busy && !ctx.worldWrites.size, '世界书同步尚未完成，请稍候。');
    const name = getLoadedPresetName();
    const contextKey = ctx.workspaceContextKey();
    const current = () => !ctx.destroyed && getLoadedPresetName() === name && ctx.workspaceContextKey() === contextKey;
    ctx.state.workspaceBusy = true;
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
      writePresetStore(next);
      ctx.assertData(current(), '上下文已变化，配置保存未完成。');
      const actual = getVariables({ type: 'script' });
      ctx.assertData(JSON.stringify(actual.configuration_library) === JSON.stringify(next.configuration_library), '配置持久化校验失败');
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

  function saveRecovery(current, scopes) {
    const next = ctx.clone(ctx.state.config);
    next.configuration_library.recovery = { createdAt: new Date().toISOString(), snapshot: ctx.validateSnapshot(ctx.captureConfiguration(getPreset('in_use'), ctx.state.config, scopes)) };
    writeConfigurationData(next, current);
  }

  async function saveNamedConfiguration(name, overwriteId = '', scopes = ctx.configurationScopes) {
    return runWorkspaceOperation('保存配置', async current => {
      const next = ctx.clone(ctx.state.config);
      const library = next.configuration_library;
      const previous = overwriteId ? library.items.find(item => item.id === overwriteId) : null;
      ctx.assertData(!overwriteId || previous, '要覆盖的配置已不存在');
      const chosenName = ctx.validName(previous?.name ?? name, library.items, overwriteId);
      const now = new Date().toISOString();
      const item = { id: previous?.id ?? ctx.createPromptId(), name: chosenName, createdAt: previous?.createdAt ?? now, updatedAt: now, snapshot: ctx.validateSnapshot(ctx.captureConfiguration(getPreset('in_use'), ctx.state.config, scopes)) };
      if (previous) library.items[library.items.indexOf(previous)] = item;
      else library.items.push(item);
      library.activeId = item.id;
      writeConfigurationData(next, current);
      ctx.state.configurationName = '';
      return item.id;
    });
  }

  async function renameConfiguration(id, name) {
    return runWorkspaceOperation('重命名配置', async current => {
      const next = ctx.clone(ctx.state.config);
      const item = next.configuration_library.items.find(item => item.id === id);
      ctx.assertData(item, '配置已不存在');
      item.name = ctx.validName(name, next.configuration_library.items, id);
      item.updatedAt = new Date().toISOString();
      writeConfigurationData(next, current);
    });
  }

  async function deleteConfiguration(id) {
    return runWorkspaceOperation('删除配置', async current => {
      const next = ctx.clone(ctx.state.config);
      ctx.assertData(next.configuration_library.items.some(item => item.id === id), '配置已不存在');
      next.configuration_library.items = next.configuration_library.items.filter(item => item.id !== id);
      if (next.configuration_library.activeId === id) next.configuration_library.activeId = null;
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
      ctx.assertData(current(), '连接配置改变了当前预设或聊天，请使用绑定当前命定预设的连接配置。');
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

  async function applyConfiguration(id) {
    let worldMode = null;
    await runWorkspaceOperation('切换配置', async current => {
      const library = ctx.configLibrary();
      const source = id === '__recovery__' ? library.recovery : library.items.find(item => item.id === id);
      ctx.assertData(source, '配置或恢复点不存在。');
      const complete = ctx.validateSnapshot(ctx.clone(source.snapshot));
      const snapshot = complete.preset;
      const modelId = snapshot ? ctx.detectModelAdapter(snapshot, ctx.modelRegistry(snapshot.config)) : null;
      if(snapshot) ctx.assertData(modelId || !snapshot.config.connection_link.enabled, '配置的模型条目未正确互斥，无法联动连接。');
      saveRecovery(current, ctx.selectedScopes(complete));
      const apply = async () => {
        const previousSummary = summary.capture();
        const next = { ...ctx.clone(ctx.state.config), ...(snapshot ? ctx.clone(snapshot.config) : {}) };
        next.configuration_library.activeId = id === '__recovery__' ? null : id;
        if(snapshot) { worldMode = ctx.variablePresetMode(snapshot); next.configuration_library.pendingWorld = { key: ctx.workspaceContextKey(), mode: worldMode }; }
        try {
          if(complete.summary) await summary.apply(complete.summary);
          ctx.assertData(current(), '上下文已变化，配置已停止应用');
          if(snapshot) await writeWorkspace(snapshot, next, current);
          else writeConfigurationData(next, current);
        } catch(error) {
          if(complete.summary && current()) { try { await summary.apply(previousSummary); } catch(rollback) { error.message += '；总结配置回滚失败：' + rollback.message; } }
          throw error;
        }
        ctx.state.reorderUndo = null; ctx.state.editorUnlocked = false;
      };
      if(snapshot) await withLinkedConnection(snapshot.config, modelId, current, apply);
      else await apply();
    });
    if (worldMode && !ctx.destroyed) {
      await ctx.selectVariableMode(worldMode);
      if (ctx.configLibrary().pendingWorld?.key === ctx.workspaceContextKey()) ctx.setSaveStatus('idle', '配置已应用，世界书待同步；请在日常调整中重新检查。');
      else ctx.setSaveStatus('saved', '配置已应用，世界书同步完成。');
    }
  }

  function exportConfigurations(id = '', scopes = ctx.exportScopes) {
    ctx.assertData(scopes.preset || scopes.summary, '请至少勾选一类导出配置');
    ctx.assertData(!ctx.state.config.configuration_error, '当前配置数据异常，请使用“导出原始备份”。');
    const library = ctx.configLibrary();
    const candidates = id ? library.items.filter(item => item.id === id) : library.items;
    const items = candidates.map(item => {
      const complete=ctx.validateSnapshot(item.snapshot);
      const snapshot={ version:2, ...(scopes.preset && complete.preset ? {preset:complete.preset}:{}), ...(scopes.summary && complete.summary ? {summary:complete.summary}:{}) };
      return snapshot.preset || snapshot.summary ? {...item,snapshot}:null;
    }).filter(Boolean);
    ctx.assertData(items.length, '没有可导出的配置');
    return JSON.stringify({ format: 'destined-configurations', version: 2, items: redactSecrets(items) }, null, 2);
  }

  function redactSecrets(value) {
    if(Array.isArray(value))return value.map(redactSecrets);
    if(!ctx.plainObject(value))return value;
    return Object.fromEntries(Object.entries(value).filter(([key])=>!/(?:api[_-]?key|secrets|summary_assistant_(?:worldbook|mega_summary_map|auto_hidden_floors))/i.test(key)).map(([key,entry])=>[key,redactSecrets(entry)]));
  }

  function exportRecoverableConfigurations() {
    ctx.assertData(ctx.exportScopes.preset || ctx.exportScopes.summary, '请至少勾选一类导出配置');
    const raw=getVariables({type:'script'}).configuration_library;
    const items=[];
    for(const item of Array.isArray(raw?.items)?raw.items:[]) {
      try {
        const complete=ctx.validateSnapshot(item.snapshot);
        const snapshot={version:2,...(ctx.exportScopes.preset&&complete.preset?{preset:complete.preset}:{}),...(ctx.exportScopes.summary&&complete.summary?{summary:complete.summary}:{})};
        if(snapshot.preset||snapshot.summary) items.push({id:String(item.id ?? crypto.randomUUID()),name:String(item.name ?? '恢复的配置'),createdAt:String(item.createdAt ?? ''),updatedAt:String(item.updatedAt ?? ''),snapshot});
      } catch { /* Invalid records cannot be safely shared; the original remains stored. */ }
    }
    ctx.assertData(items.length, '没有可安全导出的有效配置；原始数据仍保留在脚本变量中');
    return JSON.stringify({format:'destined-configurations',version:2,items:redactSecrets(items)},null,2);
  }

  function rejectUnsafeKeys(value) {
    if (!value || typeof value !== 'object') return;
    for (const key of Object.keys(value)) {
      ctx.assertData(!['__proto__', 'constructor', 'prototype'].includes(key), '文件包含不支持的对象字段');
      rejectUnsafeKeys(value[key]);
    }
  }

  async function importConfigurations(text) {
    ctx.assertData(typeof text === 'string' && text.length <= 20 * 1024 * 1024, '配置文件超过 20 MB 或格式无效');
    const document = JSON.parse(text.replace(/^\uFEFF/u, ''));
    rejectUnsafeKeys(document);
    ctx.assertData(document.format === 'destined-configurations' && [1,2].includes(document.version), '不支持的命定配置文件或版本');
    const imported = ctx.validateLibrary({ ...ctx.emptyLibrary(), items: document.items }).items;
    return runWorkspaceOperation('导入配置', async current => {
      const next = ctx.clone(ctx.state.config);
      const library = next.configuration_library;
      for (const item of imported) {
        const originalName = item.name;
        let suffix = 2;
        while (library.items.some(other => other.name.toLocaleLowerCase() === item.name.toLocaleLowerCase())) item.name = originalName.slice(0, 88) + ' (' + suffix++ + ')';
        if (library.items.some(other => other.id === item.id)) item.id = ctx.createPromptId();
        library.items.push(item);
      }
      writeConfigurationData(next, current);
      return imported.length;
    });
  }

  function downloadConfiguration(text, name) {
    const blob = new Blob([text], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = name.replace(/[<>:"/\\|?*\u0000-\u001f]/gu, '_') + '.json';
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  return {
    runWorkspaceOperation,
    writeConfigurationData,
    writeWorkspace,
    saveRecovery,
    saveNamedConfiguration,
    renameConfiguration,
    deleteConfiguration,
    withLinkedConnection,
    applyConfiguration,
    exportConfigurations,
    redactSecrets,
    exportRecoverableConfigurations,
    rejectUnsafeKeys,
    importConfigurations,
    downloadConfiguration
  };
}
