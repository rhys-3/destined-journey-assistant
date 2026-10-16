import { FLAVOR } from '../flavor.js';

// Persisted keys are namespaced per flavor so the prime assistant and the
// general roleplay assistant never read or overwrite each other's records.
const prefix = FLAVOR.summaryVariablePrefix;
const key = suffix => `${prefix}_${suffix}`;

export const SETTINGS_VAR_KEY = key('settings');
export const SECRETS_VAR_KEY = key('secrets');
export const MIGRATION_VAR_KEY = key('migration');
export const RUNTIME_VAR_KEY = key('runtime');
export const OWNED_BOOKS_VAR_KEY = key('owned_books');
export const BOOKS_VAR_KEY = key('books');
export const CHAT_WB_VAR_KEY = key('worldbook');
export const MEGA_SUMMARY_VAR_KEY = key('mega_summary_map');
export const ARCHIVE_VAR_KEY = key('archive');
export const BINDING_PAUSED_VAR_KEY = key('binding_paused');
export const AUTO_HIDDEN_FLOORS_VAR_KEY = key('auto_hidden_floors');
export const VISIBILITY_AUTOMATION_VAR_KEY = key('visibility_auto');
export const VISIBILITY_OVERRIDES_VAR_KEY = key('visibility_overrides');

// Summary fields a preset settings write must preserve; other keys stay untouched.
export const SUMMARY_SCRIPT_VAR_KEYS = Object.freeze([
  SETTINGS_VAR_KEY,
  SECRETS_VAR_KEY,
  MIGRATION_VAR_KEY,
  RUNTIME_VAR_KEY,
  OWNED_BOOKS_VAR_KEY,
  BOOKS_VAR_KEY,
]);
