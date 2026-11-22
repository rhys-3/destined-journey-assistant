// All script-variable writes pass through this synchronous coordinator.
import { SUMMARY_SCRIPT_VAR_KEYS, SETTINGS_VAR_KEY, SECRETS_VAR_KEY, OWNED_BOOKS_VAR_KEY } from './storage-keys.js';
export function readStore() { return structuredClone(getVariables({ type: 'script' }) ?? {}); }
export function writeStore(value) {
  const next = structuredClone(value);
  replaceVariables(next, { type: 'script' });
  const actual = readStore();
  if (JSON.stringify(actual) !== JSON.stringify(next)) throw new Error('脚本设置持久化校验失败');
  return actual;
}
export function writePresetStore(value) {
  const latest = readStore();
  const next = structuredClone(value);
  for (const key of SUMMARY_SCRIPT_VAR_KEYS) {
    if (Object.hasOwn(latest, key)) next[key] = latest[key];
    else delete next[key];
  }
  return writeStore(next);
}
export function patchSummaryStore(patch) {
  return writeStore({ ...readStore(), ...structuredClone(patch) });
}

export function readGlobalStore() {
  return structuredClone(getVariables({ type: 'global' }) ?? {});
}
export function patchGlobalStore(patch) {
  const next = { ...readGlobalStore(), ...structuredClone(patch) };
  replaceVariables(next, { type: 'global' });
  const actual = readGlobalStore();
  if (JSON.stringify(actual) !== JSON.stringify(next)) throw new Error('全局设置持久化校验失败');
  return actual;
}

export function mergeSummarySecrets(saved = {}, incoming = {}, settings = {}) {
  const keys = new Map(Object.entries(saved.keysByUrl ?? {}));
  function fill(url, value) {
    if (typeof value === 'string' && value.trim() && !keys.get(url)?.trim()) keys.set(url, value);
  }
  const url = String(settings.customApiUrl ?? '').trim();
  fill(saved.customApiUrl?.trim() ?? url, saved.customApiKey);
  for (const [endpoint, value] of Object.entries(incoming.keysByUrl ?? {})) fill(endpoint, value);
  fill(incoming.customApiUrl?.trim() ?? url, incoming.customApiKey);
  fill(url, settings.customApiKey);
  return { keysByUrl: Object.fromEntries(keys) };
}

// Some hosts return copies of the same backing store for both scopes.
// Verify the deletion by reading global again before considering migration complete.
const aliasedHosts = new WeakSet();
export function migrateGlobalSummaryState() {
  const script = readStore();
  const keys = [SECRETS_VAR_KEY, OWNED_BOOKS_VAR_KEY].filter(key => Object.hasOwn(script, key));
  if (!keys.length) return;
  const global = readGlobalStore();
  const patch = {};
  if (keys.includes(SECRETS_VAR_KEY)) {
    patch[SECRETS_VAR_KEY] = mergeSummarySecrets(global[SECRETS_VAR_KEY], script[SECRETS_VAR_KEY], script[SETTINGS_VAR_KEY]);
  }
  if (keys.includes(OWNED_BOOKS_VAR_KEY)) {
    patch[OWNED_BOOKS_VAR_KEY] = [...new Set([...(global[OWNED_BOOKS_VAR_KEY] ?? []), ...(script[OWNED_BOOKS_VAR_KEY] ?? [])])];
  }
  const changed = keys.some(key => JSON.stringify(global[key]) !== JSON.stringify(patch[key]));
  const saved = changed ? patchGlobalStore(patch) : global;
  if (aliasedHosts.has(replaceVariables)) return;
  for (const key of keys) delete script[key];
  writeStore(script);
  const after = readGlobalStore();
  const missing = keys.filter(key => Object.hasOwn(saved, key) && !Object.hasOwn(after, key));
  if (missing.length) {
    patchGlobalStore(Object.fromEntries(missing.map(key => [key, saved[key]])));
    aliasedHosts.add(replaceVariables);
  }
}
