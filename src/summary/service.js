import { configureRuntime, getHost, invalidate, disposeRuntime, runAction, isBusy, captureContext, checkContext } from '../platform/lifecycle.js';
import { helperApi } from '../platform/ambient.js';
import { readStore, patchSummaryStore, readGlobalStore, patchGlobalStore, migrateGlobalSummaryState, mergeSummarySecrets } from '../platform/store.js';
import { DEFAULT_SETTINGS, CONFIG } from './config.js';
import { summarySnapshot } from './settingsSchema.js';
import { loadSettings, getSettings, saveSettings, migrateOldSettings, getKeyForUrl } from './storage.js';
import { buildPanelHtml } from './ui/panel.js';
import { bindPanelEvents, refreshEntryList, refreshMegaEntryList, refreshStatus } from './ui/panelEvents.js';
import { autoTriggerSummary } from './summary.js';
import { reconcileChatBinding, releaseOwnedBooks } from './worldbook.js';
import { restoreTaskState, detachTaskState } from './taskState.js';
import { createTaskView, refreshTaskWidget } from './ui/taskView.js';
import { FLAVOR } from '../flavor.js';
import { MIGRATION_VAR_KEY, SECRETS_VAR_KEY } from '../platform/storage-keys.js';
import { presetBelongsToFlavor } from '../preset/definitions.js';

const legacyScriptContent = new RegExp(`destined-journey-summarizer|${CONFIG.SETTINGS_VAR_KEY}`);
let panel=null, slot=null, stops=[], refreshPromise=null;
let savedPanel=null;
let bindingChain=Promise.resolve();
let taskView=null, queued=false, queueTimer=null;
let activePreset = false;
let bindingState = 'pending', bindingRequest = null;
function ownsLoadedPreset() {
  const readPreset = helperApi('getPreset');
  if (typeof readPreset !== 'function') return true;
  const markers = FLAVOR.id === 'prime' ? ['900cb71c-f6a6-441f-a78c-056ddfc8db10'] : FLAVOR.ownPresetPromptIds;
  return presetBelongsToFlavor(readPreset('in_use'), markers);
}
function schedule() {
  if (!activePreset || bindingState !== 'ready') return;
  queued=true; if(queueTimer || isBusy())return;
  queueTimer=setTimeout(async()=>{
    queueTimer=null; if(!activePreset || bindingState !== 'ready' || isBusy())return;
    queued=false;
    await runAction(()=>autoTriggerSummary(),{quiet:true});
  },150);
}
function reconcileBinding() {
  if (bindingRequest) return bindingRequest;
  const token = captureContext();
  const request = reconcileChatBinding().then(names => {
    checkContext(token);
    const resumed = bindingState === 'failed';
    bindingState = 'ready';
    if (resumed) schedule();
    return names;
  }, error => {
    checkContext(token);
    bindingState = 'failed';
    throw error;
  }).finally(() => { if (bindingRequest === request) bindingRequest = null; });
  bindingRequest = request;
  return request;
}
function flatten(trees){return trees.flatMap(item=>item.type==='folder'?flatten(item.scripts??[]):[item]);}
export async function migrate() {
  migrateGlobalSummaryState();
  const raw=readStore();
  let old;
  // Only the scripts this flavor replaces are adopted; the other flavor keeps its own.
  if(typeof getScriptTrees==='function' && (FLAVOR.legacySummaryScriptIds.length||FLAVOR.legacySummaryScriptNames.length)) {
    const scripts=flatten(getScriptTrees({type:'preset'}));
    old=scripts.find(s=>FLAVOR.legacySummaryScriptIds.includes(s.id));
    if(!old) {
      const matches=scripts.filter(s=>FLAVOR.legacySummaryScriptNames.includes(s.name) && legacyScriptContent.test(s.content??''));
      if(matches.length>1)throw new Error('发现多个旧总结脚本，未自动迁移或停用；请先保留一个需要接续的旧总结脚本');
      old=matches[0];
    }
  }
  const legacyData = old?.data ?? {};
  const legacySettings = legacyData[CONFIG.SETTINGS_VAR_KEY];
  const legacySecrets = legacyData[SECRETS_VAR_KEY];
  const hasLegacyKey = Object.hasOwn(legacySettings ?? {}, 'customApiKey') || Object.hasOwn(legacyData, SECRETS_VAR_KEY);
  const secrets = readGlobalStore()[SECRETS_VAR_KEY] ?? {};
  if(!raw[MIGRATION_VAR_KEY] || Object.hasOwn(secrets, 'customApiKey') || Object.hasOwn(raw[CONFIG.SETTINGS_VAR_KEY] ?? {}, 'customApiKey') || raw[CONFIG.SETTINGS_VAR_KEY]?.promptVersion !== DEFAULT_SETTINGS.promptVersion || raw[CONFIG.SETTINGS_VAR_KEY]?.behaviorVersion !== DEFAULT_SETTINGS.behaviorVersion) {
    let oldSettings=old?.data?.[CONFIG.SETTINGS_VAR_KEY];
    if(old) oldSettings=getVariables({type:'script',script_id:old.id})?.[CONFIG.SETTINGS_VAR_KEY]??oldSettings;
    const selected=raw[CONFIG.SETTINGS_VAR_KEY]??(old?{...oldSettings,enabled:old.enabled === true}:DEFAULT_SETTINGS);
    const settings=summarySnapshot(migrateOldSettings(structuredClone(selected)));
    if (secrets.customApiKey !== undefined || selected.customApiKey) {
      patchGlobalStore({ [SECRETS_VAR_KEY]: mergeSummarySecrets(secrets, {}, selected) });
    }
    patchSummaryStore({
      [CONFIG.SETTINGS_VAR_KEY]:settings,
      [MIGRATION_VAR_KEY]:{...raw[MIGRATION_VAR_KEY],version:2,from:raw[MIGRATION_VAR_KEY]?.from??old?.id??null},
    });
  }
  if (hasLegacyKey) {
    const merged = mergeSummarySecrets(readGlobalStore()[SECRETS_VAR_KEY], legacySecrets, legacySettings);
    if (Object.keys(merged.keysByUrl).length) patchGlobalStore({ [SECRETS_VAR_KEY]: merged });
  }
  if(old?.enabled || hasLegacyKey) {
    if(typeof updateScriptTreesWith!=='function') throw new Error('请更新酒馆助手后重试迁移：旧总结脚本尚未停用。');
    await updateScriptTreesWith(trees => {
      const item = flatten(trees).find(script => script.id === old.id);
      if (item) {
        item.enabled = false;
        if (item.data) {
          delete item.data[SECRETS_VAR_KEY];
          if (item.data[CONFIG.SETTINGS_VAR_KEY]) delete item.data[CONFIG.SETTINGS_VAR_KEY].customApiKey;
        }
      }
      return trees;
    }, { type:'preset' });
  }
}
export async function initialize(host) {
  configureRuntime({...host,remount,flush,busy: value => {host.busy?.(value);taskView?.refresh();if(!value){refresh();if(queued)schedule();}}});
  activePreset = ownsLoadedPreset();
  bindingState = 'pending';
  try { if (activePreset) { await migrate(); await loadSettings(); } }
  catch(error) { throw new Error('总结配置未加载，原数据已保留：'+error.message, {cause:error}); }
  const subscribe=(event,handler)=>{if(event)stops.push(eventOn(event,handler));};
  for(const name of ['MESSAGE_RECEIVED','MESSAGE_EDITED','MESSAGE_DELETED','MESSAGE_SWIPED'])subscribe(tavern_events[name],schedule);
  let loadedPreset = activePreset ? getLoadedPresetName() : null;
  const contextChanged=(presetChanged)=>{
    activePreset = ownsLoadedPreset();
    bindingState = 'pending';
    bindingRequest = null;
    if (presetChanged) loadedPreset = null;
    detachTaskState(); invalidate(); panel?._dispose?.(); savedPanel?._dispose?.(); savedPanel=null;
    clearTimeout(queueTimer);queueTimer=null;queued=false;
    const token = captureContext();
    bindingChain=bindingChain.catch(()=>{}).then(async () => {
      checkContext(token);
      if (!activePreset) { loadedPreset = null; remount(); await releaseOwnedBooks(); return; }
      if (presetChanged || loadedPreset !== getLoadedPresetName()) {
        await migrate(); checkContext(token); await loadSettings();
        loadedPreset = getLoadedPresetName();
      }
      try { await reconcileBinding(); }
      finally { checkContext(token); restoreTaskState(); remount(); }
      schedule();
    });
    return bindingChain.catch(error=>{if(error.name!=='AbortError')host.status(error.message,'error');});
  };
  subscribe(tavern_events.CHAT_CHANGED,()=>contextChanged(false));
  subscribe(tavern_events.PRESET_CHANGED,()=>contextChanged(true));
  subscribe(tavern_events.OAI_PRESET_CHANGED_AFTER,()=>contextChanged(true));
  subscribe(tavern_events.WORLDINFO_UPDATED,()=>{
    if (!activePreset || bindingState === 'pending') return;
    if (bindingState === 'failed') return reconcileBinding().then(refresh).catch(error => {
      if (error.name !== 'AbortError') host.status(error.message, 'error');
    });
    refresh(); schedule();
  });
  await (activePreset ? reconcileBinding() : releaseOwnedBooks()).catch(error=>host.status(error.message,'error'));
  if (activePreset) restoreTaskState();
  taskView=createTaskView(host);schedule();
}
export function mount(target) {
  if(!target)return;
  slot=target;
  if (!activePreset) { target.textContent='当前预设未启用此版本的总结助手'; return; }
  if(savedPanel) { panel=savedPanel;target.append(panel);savedPanel=null;refreshTaskWidget(panel);return refresh(); }
  panel=target.ownerDocument.createElement('div');panel.innerHTML=buildPanelHtml(getSettings());
  target.append(panel);bindPanelEvents(panel,getSettings(),reconcileBinding);refreshTaskWidget(panel);refresh();
}
export function detach() {
  if(!panel)return;
  panel._flush?.().catch(error=>getHost()?.status(error.message,'error'));
  panel.remove();savedPanel=panel;panel=null;slot=null;
}
export function remount() {
  savedPanel?._dispose?.();savedPanel=null;
  if(!slot?.isConnected)return;
  panel?._dispose?.();slot.replaceChildren();panel=null;mount(slot);
}
export function flush() { return (panel??savedPanel)?._flush?.()??Promise.resolve(); }
export function refresh() {
  taskView?.refresh();
  if(!activePreset || bindingState === 'pending' || !panel?.isConnected)return Promise.resolve();
  refreshTaskWidget(panel);
  if(isBusy())return Promise.resolve();
  if(refreshPromise)return refreshPromise;
  const current=panel;
  refreshPromise=(async()=>{await current._refreshWorldbooks?.();await Promise.all([refreshEntryList(current,current.querySelector('#sa-start-mega-summary')?.textContent.includes('退出')),refreshMegaEntryList(current),refreshStatus(current),current._refreshPlan?.()]);})()
    .catch(error=>{if(error.name!=='AbortError')getHost()?.status(error.message,'error');}).finally(()=>{refreshPromise=null;});
  return refreshPromise;
}
export function capture() {return summarySnapshot(getSettings());}
export function validate(value) {return summarySnapshot(migrateOldSettings(structuredClone(value)));}
export async function apply(value) {
  if(isBusy())throw new Error('总结任务尚未结束，请稍候再切换配置');
  await saveSettings({...validate(value),customApiKey:getKeyForUrl(value.customApiUrl)});remount();
}
export function busy(){return isBusy();}
export function dispose() {
  activePreset = false;
  bindingState = 'pending';
  bindingRequest = null;
  detachTaskState();taskView?.destroy();taskView=null;clearTimeout(queueTimer);queueTimer=null;queued=false;
  panel?._dispose?.();savedPanel?._dispose?.();savedPanel=null;panel=null;slot=null;
  for(const stop of stops){if(typeof stop==='function')stop();else stop?.stop?.();}stops=[];
  disposeRuntime();
  const cleanup = releaseOwnedBooks();
  cleanup.catch(error => getHost()?.status(error.message, 'error'));
  return cleanup;
}
