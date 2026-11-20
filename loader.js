// Paste this loader into the existing 命定预设助手 script (preserve its UUID and variables).
const version = '3.18.2';
const asset = `/gh/rhys-3/destined-journey-assistant@v${version}/dist/destined-journey-assistant.js`;
const hosts = ['cdn.jsdelivr.net', 'testingcf.jsdelivr.net'];
const reloadName = '重新加载命定预设助手';
let loading = false;
let retryEvent;

async function downloadAssistant(retry) {
  const errors = [];
  for (const host of hosts) {
    try {
      const response = await fetch(`https://${host}${asset}`, {
        signal: AbortSignal.timeout(10_000),
        cache: retry ? 'reload' : 'default',
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const script = await response.blob();
      if (!/^(application|text)\/javascript(?:;|$)/i.test(script.type)) {
        throw new Error('响应不是 JavaScript');
      }
      return script;
    } catch (error) {
      errors.push(`${host}: ${error.message}`);
    }
  }
  throw new Error(errors.join(' / '));
}

async function loadAssistant(retry = false) {
  if (loading) return;
  loading = true;
  try {
    const script = await downloadAssistant(retry);
    const moduleUrl = URL.createObjectURL(script);
    try {
      await import(moduleUrl);
    } finally {
      URL.revokeObjectURL(moduleUrl);
    }
  } catch (error) {
    console.error(`[命定预设助手 v${version}] 加载失败`, error);
    toastr.error(`命定预设助手 v${version} 加载失败：${error.message}。可点击“${reloadName}”重试。`);
    updateScriptButtonsWith(buttons => [...buttons.filter(button => button.name !== reloadName), { name: reloadName, visible: true }]);
    retryEvent ??= eventOn(getButtonEvent(reloadName), () => loadAssistant(true));
    return;
  } finally {
    loading = false;
  }
  retryEvent?.stop?.();
  updateScriptButtonsWith(buttons => buttons.filter(button => button.name !== reloadName));
}

await loadAssistant();
