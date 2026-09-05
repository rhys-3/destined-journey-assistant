import { helperApi, tavernContext } from './ambient.js';
let host;
let epoch = 0;
let operation = null;
let disposed = false;
let enabled = false;
const cancellations = new Set();
export function configureRuntime(value) { host = value; disposed = false; }
export function getHost() { return host; }
export function contextKey() {
  const st = tavernContext();
  const ctx = st?.getContext?.() ?? st ?? {};
  return JSON.stringify([helperApi('getLoadedPresetName')?.(), ctx.chatId ?? ctx.getCurrentChatId?.(), ctx.characterId, ctx.groupId]);
}
export function captureContext() { return { epoch, key: contextKey() }; }
export function checkContext(token) {
  if (disposed || token.epoch !== epoch || token.key !== contextKey()) {
    const error = new Error('聊天、预设或总结状态已变化，本次操作已取消');
    error.name = 'AbortError';
    throw error;
  }
}
export function assertCurrent() {
  if (operation) checkContext(operation.token);
  else if (disposed) throw new Error('脚本已卸载');
}
export function invalidate() { epoch++; for (const cancel of [...cancellations]) cancel(); }
export function onCancel(cancel) { cancellations.add(cancel); return () => cancellations.delete(cancel); }
export function setRuntimeEnabled(value) { if (enabled !== value) invalidate(); enabled = value; }
export function isEnabled() { return enabled; }
export function isBusy() { return !!operation; }
export async function runAction(fn, { generation = false, quiet = false } = {}) {
  if (operation) { if (!quiet) host?.status('上一项总结操作尚未完成，请稍候。', 'info'); return; }
  if (generation && !enabled) { if (!quiet) host?.status('请先启用总结功能。', 'info'); return; }
  const token = captureContext();
  const own = { token };
  operation = own;
  host?.busy?.(true);
  try { const result = await fn(); checkContext(token); return result; }
  catch (error) {
    if (error.name !== 'AbortError') { host?.status(error.message ?? String(error), 'error'); console.error('[命定总结]', error); }
  } finally { if (operation === own) operation = null; host?.busy?.(false); }
}
export function disposeRuntime() { invalidate(); disposed = true; }
export async function requestGeneration(fn, config) {
  assertCurrent();
  if (!enabled) throw new Error('请先启用总结功能');
  const token = captureContext();
  const generation_id = `destined-summary-${crypto.randomUUID()}`;
  const stop = () => { try { Promise.resolve(helperApi('stopGenerationById')?.(generation_id)).catch(console.warn); } catch(error) { console.warn(error); } };
  let rejectCancelled;
  const cancelled = new Promise((_, reject) => { rejectCancelled=reject; });
  const off = onCancel(() => { stop(); rejectCancelled(Object.assign(new Error('总结任务已取消'), {name:'AbortError'})); });
  const timer = setTimeout(() => { stop(); rejectCancelled(new Error('总结请求超过 5 分钟，已停止；可重试')); }, 300000);
  try { const result = await Promise.race([fn({ ...config, generation_id }), cancelled]); checkContext(token); assertCurrent(); return result; }
  finally { clearTimeout(timer); off(); }
}
export async function guardedWrite(name, ...args) {
  assertCurrent();
  const token = captureContext();
  const api = helperApi(name);
  if (typeof api !== 'function') throw new Error(`酒馆助手缺少 ${name}，请更新扩展后重试`);
  const result = await api(...args);
  checkContext(token);
  assertCurrent();
  return result;
}
export const createWorldbook = (...args) => guardedWrite('createWorldbook', ...args);
export const replaceWorldbook = (...args) => guardedWrite('replaceWorldbook', ...args);
export const deleteWorldbook = (...args) => guardedWrite('deleteWorldbook', ...args);
export const rebindGlobalWorldbooks = (...args) => guardedWrite('rebindGlobalWorldbooks', ...args);
export const createWorldbookEntries = (...args) => guardedWrite('createWorldbookEntries', ...args);
export const updateWorldbookWith = (name, updater) => guardedWrite('updateWorldbookWith', name, value => { assertCurrent(); return updater(value); });
export const setChatMessages = (...args) => guardedWrite('setChatMessages', ...args);
export function insertOrAssignVariables(...args) { assertCurrent(); return helperApi('insertOrAssignVariables')(...args); }
export const SillyTavern = new Proxy({}, {
  get(_, key) {
    if (key === 'callGenericPopup') return async (...args) => { assertCurrent(); const value = await host.popup(...args); assertCurrent(); return value; };
    return tavernContext()?.[key];
  },
});
