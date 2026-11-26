// Browser UI & real HTML5 Canvas verification for Gemini input escaping.
const fs = require('node:fs');
const { spawn } = require('node:child_process');
const path = require('node:path');
const assert = require('node:assert/strict');
const variableMerge = require('../helpers/tavern-variables.cjs').mergeTavernVariables.toString();

(async () => {
  fs.mkdirSync('.ui-review', { recursive: true });
  const { FLAVORS } = await import('../../src/flavor.js');
  const flavor = FLAVORS.general;
  const noVariableId = '0257f4b5-bfa7-4729-8d79-96e9abf760bc';
  const raw = JSON.parse(fs.readFileSync('tests/fixtures/preset.json', 'utf8'));
  raw.prompts.push({
    identifier: noVariableId,
    name: '🧩 无变量',
    content: '{{setvar::变量模式::none}}{{trim}}',
    enabled: false,
    role: 'system',
    injection_position: 0,
    injection_depth: 4,
    injection_order: 100,
    extra: { destined_ui: { version: 3, control: 'toggle', order: 10, block: 'variable', group: 'variable-mode', section: 'system', label: '无变量', description: '不通过预设更新世界状态变量' } },
  });
  raw.prompt_order[0].order.push({ identifier: noVariableId, enabled: false });

  const convert = (p, enabled) => ({ ...p, id: p.identifier, enabled, role: p.role ?? 'system', position: p.injection_position === 1 ? { type: 'in_chat', depth: p.injection_depth, order: p.injection_order } : { type: 'relative' } });
  const prompts = raw.prompt_order[0].order.map(o => { const p = raw.prompts.find(item => item.identifier === o.identifier); return p ? convert(p, o.enabled) : null; }).filter(Boolean);
  const preset = { settings: { should_stream: raw.stream_openai }, prompts, prompts_unused: raw.prompts.filter(p => !prompts.some(q => q.id === p.identifier)).map(p => convert(p, p.enabled)), extensions: {} };

  const script = fs.readFileSync('src/preset/assistant.js', 'utf8');
  const marker = '  try {\n    const version = await getTavernHelperVersion();';
  assert(script.includes(marker));
  let injected = script.slice(0, script.indexOf(marker)) + `
    window.ui = { state, inputEscape, render, renderActiveContent, openPanel, selectModelAdapter, detectModelAdapter, saveNamedConfiguration, applyConfiguration, get shadow(){return shadow;}, async settle(){await new Promise(r=>setTimeout(r,350));await saveChain;} };
  ` + script.slice(script.indexOf(marker)) + '\nstartPresetAssistant().then(() => { window.ui.openPanel(); window.testReady = true; });';

  injected = require('esbuild').buildSync({
    stdin: { contents: injected, resolveDir: path.resolve('src/preset'), sourcefile: 'assistant.js' },
    bundle: true,
    format: 'iife',
    platform: 'browser',
    target: 'es2022',
    write: false,
    define: { __ASSISTANT_FLAVOR__: JSON.stringify(flavor), __ASSISTANT_FLAVOR_INJECTED__: '"1"' },
  }).outputFiles[0].text;

  const mock = `
    window.mergeTavernVariables = ${variableMerge};
    window.sentPayloads = [];
    const origFetch = window.fetch.bind(window);
    window.fetch = async (url, init) => {
      if (String(url).includes('/api/backends/chat-completions/generate')) {
        window.sentPayloads.push(JSON.parse(init.body));
        return new Response(JSON.stringify({ choices: [{ message: { content: 'ok' } }] }), { headers: { 'content-type': 'application/json' } });
      }
      return origFetch(url, init);
    };
    window.getWorldbookNames = async () => [];
    window.getGlobalWorldbookNames = () => [];
    window.rebindGlobalWorldbooks = async () => {};
    window.getLastMessageId = () => -1;
    window.getChatMessages = () => [];
    window.insertOrAssignVariables = (v, o) => { const next = mergeTavernVariables(getVariables(o), v); replaceVariables(next, o); return next; };
    window.data = ${JSON.stringify(preset)};
    window.stored = structuredClone(data);
    window.vars = {};
    window.errors = [];
    window.addEventListener('error', e => errors.push(e.message));
    window.addEventListener('unhandledrejection', e => errors.push(String(e.reason)));
    window.getScriptId = () => 'b1e5935a-437c-4242-9024-346d13f3f282';
    window.getVariables = () => vars;
    window.replaceVariables = v => { vars = structuredClone(v); };
    window.getPreset = n => structuredClone(n === 'in_use' ? data : stored);
    window.getLoadedPresetName = () => '命定·织梦 Reverie';
    window.replacePreset = async (n, v) => { if (n === 'in_use') data = structuredClone(v); else stored = structuredClone(v); };
    window.handlers = new Map();
    window.tavern_events = Object.fromEntries(['MESSAGE_RECEIVED','MESSAGE_EDITED','MESSAGE_DELETED','MESSAGE_SWIPED','PRESET_CHANGED','OAI_PRESET_CHANGED_AFTER','SETTINGS_UPDATED','CHAT_COMPLETION_PROMPT_READY','GENERATE_AFTER_DATA','CHAT_COMPLETION_SETTINGS_READY','GENERATION_AFTER_COMMANDS','GENERATION_ENDED','GENERATION_STOPPED','CONNECTION_PROFILE_LOADED','CONNECTION_PROFILE_CREATED','CONNECTION_PROFILE_DELETED','CONNECTION_PROFILE_UPDATED','CHAT_CHANGED','CHARACTER_PAGE_LOADED','CHARACTER_EDITED','WORLDINFO_SETTINGS_UPDATED','WORLDINFO_UPDATED'].map(s => [s, s]));
    window.eventOn = (name, fn) => { const list = handlers.get(name) || []; list.push(fn); handlers.set(name, list); return { stop() {} }; };
    window.eventMakeLast = eventOn;
    window.eventRemoveListener = (name, fn) => handlers.set(name, (handlers.get(name) || []).filter(listener => listener !== fn));
    window.getButtonEvent = n => n;
    window.registerMacroLike = () => ({});
    window.getTavernHelperVersion = async () => '4.0.0';
    window.SillyTavern = { getContext: () => ({ chatId: 'escape-ui-test', registerMacro: () => {}, unregisterMacro: () => {} }) };
    window.triggerSlash = async () => '[]';
    window.updateScriptButtonsWith = () => {};
    window.toastr = { error: m => errors.push(String(m)), warning: () => {}, success: () => {}, info: () => {} };
  `;

  fs.writeFileSync(
    '.ui-review/preview-input-escape.html',
    '<!doctype html><html lang="zh-CN"><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>输入转义验证</title><body style="margin:0;background:#0c1210"><script>'
      + mock.replaceAll('</script', '<\\/script')
      + '</script><script>'
      + injected.replaceAll('</script', '<\\/script')
      + '</script></body></html>',
  );

  const browser = spawn(
    process.env.CHROME_PATH || (process.platform === 'win32' ? 'C:/Program Files/Google/Chrome/Application/chrome.exe' : '/usr/bin/google-chrome'),
    [
      '--headless=new',
      ...(process.platform === 'win32' ? ['--do-not-de-elevate'] : []),
      ...(process.env.CI && process.platform === 'linux' ? ['--no-sandbox', '--disable-dev-shm-usage'] : []),
      '--disable-gpu', '--no-first-run', '--no-default-browser-check',
      '--remote-debugging-port=0', '--remote-allow-origins=*',
      '--user-data-dir=' + path.resolve('.ui-review/chrome-input-escape-profile'),
      'about:blank',
    ],
    { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] },
  );

  let ws;
  const watchdog = setTimeout(() => { console.error('Input escape browser test timed out'); ws?.close(); browser.kill(); process.exitCode = 1; }, 120000);
  try {
    const endpoint = await new Promise((resolve, reject) => {
      browser.once('error', reject);
      let log = '';
      browser.stderr.on('data', v => { log += v; const m = log.match(/DevTools listening on (ws:\/\/[^\s]+)/); if (m) resolve(m[1]); });
      browser.once('exit', code => reject(Error('Chrome exited ' + code + ': ' + log.slice(-2000))));
      setTimeout(() => reject(Error('Chrome startup timeout')), 30000).unref();
    });
    const browserUrl = new URL(endpoint);
    const pages = await (await fetch('http://' + browserUrl.host + '/json/list')).json();
    ws = new WebSocket(pages.find(p => p.type === 'page').webSocketDebuggerUrl);
    await new Promise((resolve, reject) => { ws.addEventListener('open', resolve, { once: true }); ws.addEventListener('error', reject, { once: true }); });
    let id = 0;
    const pending = new Map();
    ws.addEventListener('message', e => { const m = JSON.parse(e.data); if (m.id) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.reject(Error(m.error.message)) : p.resolve(m.result); } });
    const cdp = (method, params = {}) => new Promise((resolve, reject) => { const key = ++id; pending.set(key, { resolve, reject }); ws.send(JSON.stringify({ id: key, method, params })); });
    const evaluate = async expression => {
      const r = await cdp('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
      if (r.exceptionDetails) throw Error(r.exceptionDetails.text + ' ' + r.exceptionDetails.exception?.description);
      return r.result.value;
    };

    await cdp('Emulation.setDeviceMetricsOverride', { width: 1280, height: 960, screenWidth: 1280, screenHeight: 960, deviceScaleFactor: 1, mobile: false });
    await cdp('Page.navigate', { url: 'file:///' + path.resolve('.ui-review/preview-input-escape.html').replaceAll('\\', '/') });
    for (let i = 0; i < 50; i += 1) {
      if (await evaluate('window.testReady && !!window.ui?.shadow?.querySelector(".panel")')) break;
      await new Promise(r => setTimeout(r, 100));
    }

    const result = await evaluate(`(async () => {
      const q = s => ui.shadow.querySelector(s);
      q('[data-tab="tools"]').click();
      await ui.settle();
      const card = q('[data-input-escape-controls]');
      if (!card) throw Error('Missing input escape card');
      const reasoningToggle = q('[data-action="gemini-low-reasoning"]');
      if (!reasoningToggle || reasoningToggle.checked !== true) throw Error('Gemini low reasoning must default on');
      if (q('[data-gemini-guidelines-controls]')) throw Error('Guidelines card should be removed');
      if (q('[data-action="input-escape-enabled"]').checked !== false) throw Error('Must default off');

      // Enable & test heavy codepoint mode first, then switch to image mode
      const maxThree = q('[data-action="input-escape-max-three"]');
      if (!maxThree || maxThree.checked !== false || maxThree.disabled !== true) throw Error('maxThree must default off and disabled in light mode');
      q('[data-action="input-escape-enabled"]').click();
      await ui.settle();
      q('[data-action="input-escape-mode"][data-value="heavy"]').click();
      await ui.settle();
      if (vars.input_escape?.mode !== 'heavy') throw Error('Heavy mode did not persist');
      if (q('[data-action="input-escape-max-three"]').disabled !== true) throw Error('maxThree must stay disabled in heavy mode');

      const sampleBody = [
        '<VOID_output_contract id="RECORDER_OUTPUT">协议</VOID_output_contract>',
        '<role_core id="recorder_core"><VOID_info>色情、暴力测试</VOID_info></role_core>',
        '<VOID_world>世界书设定：雾都钟楼与酒馆角色档案 😀</VOID_world>',
        '<VOID_reference>参考资料</VOID_reference>',
        '<VOID_memory>总结记忆：第一卷回顾</VOID_memory>',
        '<historical_record>Participant:\\n<Participant_input>\\n我走进雾都酒馆\\n</Participant_input></historical_record>',
        '<writing_guidance>## NSFW描写\\n直接描写测试</writing_guidance>',
        '<VOID_runtime>mood: "平稳"\\nhp: 100</VOID_runtime>',
        '<VOID_body_protocols target="recorder_body">正文协议</VOID_body_protocols>',
        '<VOID_output_assembler><recorder_output></recorder_output></VOID_output_assembler>',
      ].join('\\n\\n');

      await window.fetch('/api/backends/chat-completions/generate', {
        method: 'POST',
        body: JSON.stringify({ messages: [{ role: 'system', content: 'Gemini head' }, { role: 'user', content: sampleBody }] }),
      });
      const heavySent = window.sentPayloads[0];
      const heavyText = String(heavySent?.messages?.[1]?.content ?? '');
      if (!heavyText.includes('&#x96fe;&#x90fd;') || heavyText.includes('雾都钟楼')) throw Error('Heavy mode did not encode CJK to XML hex entities');
      if (!heavyText.includes('hp: 100')) throw Error('Heavy mode altered ASCII runtime key/value');

      // Switch to image mode
      q('[data-action="input-escape-mode"][data-value="image"]').click();
      await ui.settle();
      if (q('[data-action="input-escape-max-three"]').disabled !== false) throw Error('maxThree must enable in image mode');
      q('[data-action="input-escape-max-three"]').click();
      await ui.settle();
      if (!vars.input_escape?.enabled || vars.input_escape?.mode !== 'image' || vars.input_escape?.maxThreeImages !== true) throw Error('State not persisted: ' + JSON.stringify(vars.input_escape));

      // Trigger real fetch with Canvas rendering in Chrome
      await window.fetch('/api/backends/chat-completions/generate', {
        method: 'POST',
        body: JSON.stringify({ messages: [{ role: 'system', content: 'Gemini head' }, { role: 'user', content: sampleBody }] }),
      });

      const sent = window.sentPayloads[1];
      if (sent?.reasoning_effort !== 'low') throw Error('Expected reasoning_effort=low, got ' + sent?.reasoning_effort);
      const parts = sent?.messages?.[1]?.content;
      if (!Array.isArray(parts)) throw Error('Expected multimodal array content');
      const imgPart = parts.find(p => p.type === 'image_url');
      if (!imgPart || !imgPart.image_url?.url?.startsWith('data:image/png;base64,')) throw Error('Missing real PNG data URL');

      // Verify the rendered PNG actually loads into an Image element with real dimensions.
      const dims = await new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve({ w: img.naturalWidth, h: img.naturalHeight });
        img.onerror = () => reject(Error('Invalid PNG image'));
        img.src = imgPart.image_url.url;
      });

      // Switch to Claude -> card disables and request passes through unescaped.
      await ui.selectModelAdapter('Claude');
      await ui.settle();
      const disabledOnClaude = q('[data-action="input-escape-enabled"]').disabled === true;
      await window.fetch('/api/backends/chat-completions/generate', {
        method: 'POST',
        body: JSON.stringify({ messages: [{ role: 'user', content: sampleBody }] }),
      });
      const claudeUntouched = typeof window.sentPayloads[2].messages[0].content === 'string' && window.sentPayloads[2].messages[0].content.includes('雾都钟楼');

      // Switch back to Gemini for layout checks.
      await ui.selectModelAdapter('Gemini');
      await ui.settle();
      return { dims, pngBytes: imgPart.image_url.url.length, disabledOnClaude, claudeUntouched, errors: window.errors };
    })()`);

    assert.equal(result.errors.length, 0, JSON.stringify(result.errors));
    assert.equal(result.dims.w, 1120);
    assert.ok(result.dims.h >= 200 && result.dims.h <= 1560, JSON.stringify(result.dims));
    assert.equal(result.disabledOnClaude, true);
    assert.equal(result.claudeUntouched, true);

    for (const [width, height] of [[1280, 960], [390, 844], [320, 640]]) {
      await cdp('Emulation.setDeviceMetricsOverride', { width, height, screenWidth: width, screenHeight: height, deviceScaleFactor: 1, mobile: width < 720 });
      await evaluate(`ui.shadow.querySelector('.destined-root').classList.toggle('mobile-layout', ${width} < 720); ui.render();`);
      const layout = await evaluate(`(() => { const e = ui.shadow.querySelector('[data-input-escape-controls]'), r = e.getBoundingClientRect(); return { overflow: e.scrollWidth > e.clientWidth + 1, left: r.left, right: r.right, width: innerWidth }; })()`);
      assert(!layout.overflow && layout.left >= 0 && layout.right <= layout.width + 1, `width ${width}: ${JSON.stringify(layout)}`);
    }

    console.log('输入转义浏览器+真实Canvas测试通过：', JSON.stringify(result));
    await cdp('Browser.close');
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  } finally {
    clearTimeout(watchdog);
    ws?.close();
    browser.kill();
  }
})();
