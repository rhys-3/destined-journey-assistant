import { startPresetAssistant } from './preset/assistant.js';
const key = '__destinedJourneyAssistant';
globalThis[key]?.destroy?.();
try {
  globalThis[key] = await startPresetAssistant();
} catch(error) {
  globalThis[key]?.destroy?.();
  console.error('[命定预设助手] 初始化失败', error);
  globalThis.toastr?.error('命定预设助手启动失败：' + error.message);
  throw error;
}
