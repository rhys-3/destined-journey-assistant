// Bundled by tests/flavors.test.js under each flavor; reports resolved values.
import { FLAVOR } from '../../src/flavor.js';
import { AUTO_HIDDEN_FLOORS_VAR_KEY, ARCHIVE_VAR_KEY, BINDING_PAUSED_VAR_KEY, BOOKS_VAR_KEY, CHAT_WB_VAR_KEY, MEGA_SUMMARY_VAR_KEY, MIGRATION_VAR_KEY, OWNED_BOOKS_VAR_KEY, RUNTIME_VAR_KEY, SECRETS_VAR_KEY, SETTINGS_VAR_KEY, VISIBILITY_AUTOMATION_VAR_KEY, VISIBILITY_OVERRIDES_VAR_KEY } from '../../src/platform/storage-keys.js';
import { BUTTON_NAME, LEGACY_BUTTON_NAMES } from '../../src/preset/definitions.js';
import { CONFIG } from '../../src/summary/config.js';

globalThis.__flavorReport = JSON.stringify({
  id: FLAVOR.id,
  buttonName: BUTTON_NAME,
  singletonKey: FLAVOR.singletonKey,
  elementIdPrefix: FLAVOR.elementIdPrefix,
  legacyButtonNames: [...LEGACY_BUTTON_NAMES],
  summaryWorldbookPrefix: CONFIG.WORLDBOOK_NAME_PREFIX,
  keys: {
    settings: SETTINGS_VAR_KEY,
    secrets: SECRETS_VAR_KEY,
    migration: MIGRATION_VAR_KEY,
    runtime: RUNTIME_VAR_KEY,
    ownedBooks: OWNED_BOOKS_VAR_KEY,
    books: BOOKS_VAR_KEY,
    chatWorldbook: CHAT_WB_VAR_KEY,
    megaSummaryMap: MEGA_SUMMARY_VAR_KEY,
    archive: ARCHIVE_VAR_KEY,
    bindingPaused: BINDING_PAUSED_VAR_KEY,
    autoHiddenFloors: AUTO_HIDDEN_FLOORS_VAR_KEY,
    visibilityAutomation: VISIBILITY_AUTOMATION_VAR_KEY,
    visibilityOverrides: VISIBILITY_OVERRIDES_VAR_KEY,
  },
});
