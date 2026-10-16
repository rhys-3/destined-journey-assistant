import { startPresetAssistant } from './preset/assistant.js';
import { FLAVOR } from './flavor.js';
const key = FLAVOR.singletonKey;
globalThis[key]?.destroy?.();
try {
  globalThis[key] = await startPresetAssistant();
} catch(error) {
  globalThis[key]?.destroy?.();
  console.error(`[${FLAVOR.scriptName}] 初始化失败`, error);
  globalThis.toastr?.error(`${FLAVOR.scriptName}启动失败：` + error.message);
  throw error;
}
