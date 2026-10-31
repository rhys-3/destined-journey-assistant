// Browser smoke test for the general-roleplay flavor. It runs the shared preset
// runtime with the general build identifiers, mirrors a fresh general preset
// (prime fixture plus the third 无变量 entry) and reuses the worldbook suite.
(async () => {
const fs = require('node:fs');
const {spawn} = require('node:child_process');
const path = require('node:path');
const assert = require('node:assert/strict');
const variableMerge = require('../helpers/tavern-variables.cjs').mergeTavernVariables.toString();
fs.mkdirSync('.ui-review',{recursive:true});
const { FLAVORS } = await import('../../src/flavor.js');
const flavor = FLAVORS.general;
const noVariableId = '0257f4b5-bfa7-4729-8d79-96e9abf760bc';
const raw=JSON.parse(fs.readFileSync('tests/fixtures/preset.json','utf8'));
// The general preset adds a third variable-mode entry the prime fixture lacks.
raw.prompts.push({
  identifier: noVariableId,
  name: '🧩 无变量',
  content: '{{setvar::变量模式::none}}{{setvar::主变量启用::}}{{setvar::额外变量启用::}}{{trim}}',
  enabled: false,
  role: 'system',
  injection_position: 0,
  injection_depth: 4,
  injection_order: 100,
  extra: { destined_ui: { version: 3, control: 'toggle', order: 10, block: 'variable', group: 'variable-mode', section: 'system' } },
});
raw.prompt_order[0].order.push({identifier: noVariableId, enabled: false});
// The general length entry carries <|字数要求|> without Prime's floor or combat pacing.
raw.prompts.find(p => p.identifier === '31f1341f-e48c-415e-b917-207d46ea5e77').content = '{{#setvar 字数}}\n<language target="recorder_body">正文、对白与正文内面板使用<|正文语言|>；角色专名、原文引用和代码可按语境保留原语言。</language>\n<length_control requirement="<|字数要求|>" count_scope="narrative_and_dialogue">\n普通叙事与角色对白<|字数要求|>个可见文字字符；不统计空白、HTML/XML标签、代码与信息面板。\n</length_control>{{/setvar}}{{trim}}';
const convert=(p,enabled)=>({...p,id:p.identifier,enabled,role:p.role??'system',position:p.injection_position===1?{type:'in_chat',depth:p.injection_depth,order:p.injection_order}:{type:'relative'}});
const prompts=raw.prompt_order[0].order.map(o=>{const p=raw.prompts.find(p=>p.identifier===o.identifier);return p?convert(p,o.enabled):null}).filter(Boolean);
const preset={settings:{should_stream:raw.stream_openai},prompts,prompts_unused:raw.prompts.filter(p=>!prompts.some(q=>q.id===p.identifier)).map(p=>convert(p,p.enabled)),extensions:{}};
const script=fs.readFileSync('src/preset/assistant.js','utf8');
const marker='  try {\n    const version = await getTavernHelperVersion();';
assert(script.includes(marker));
let injected=script.slice(0,script.indexOf(marker))+`
  window.ui = { summary, captureCombined: captureConfiguration, captureConfiguration: capturePresetConfiguration, validateSnapshot: validatePresetSnapshot, validateLibrary, loadScriptConfig, emptyLibrary, rebuildModelRegistry, configLibrary, modelRegistry, getGeminiTail, geminiTailAvailable, setGeminiTail, detectModelAdapter, flushPendingSaves, addCustomModel, renameCustomModel, deleteCustomModel, setCustomTail, saveNamedConfiguration, renameConfiguration, deleteConfiguration, applyConfiguration, exportConfigurations, importConfigurations, resolveBoundProfile, configurationIsDirty, runWorkspaceOperation, writeWorkspace, state, IDS, GROUPS, MODEL_ADAPTERS, PROTECTED_IDS, worldLink, worldWrites, variablePresetMode, scanWorldbookMode, scheduleWorldbookScan, selectVariableMode, render, renderActiveContent, openPanel, closePanel, applyGroup, selectModelAdapter, setNumericField, setLengthMode, setLengthValue, setLanguageField, readLanguageField, managedMacroValues, setNarrationPerson, setGlobalPreference, setUserAdditionalSetting, togglePrompt, updateEntryPoint, reconcilePreset, expandManagedMacros, openStyleEditor, saveStyleEditor, deleteUserStyle, getGroupOptions, readUserAdditionalSetting, openPromptEditor, savePromptEditor, closePromptEditor, setEditorField, BUTTON_NAME, SCRIPT_NAME, FLAVOR, VARIABLE_MODES, presetIsMine, FOREIGN_PRESET_MESSAGE, get shadow(){return shadow;}, async settle(){await new Promise(r=>setTimeout(r,400));await saveChain;} };
  Object.assign(window.ui, {defaultAuthorLayout,validateAuthorLayout,authorLayout,placementEntry,placementMembers,placementSnapshot,setPlacementField,editEntryAction,getPromptGroupId});
  window.uiStorageKeys = await import('../platform/storage-keys.js');
  window.uiSummaryConfig = (await import('../summary/config.js')).CONFIG;
  window.uiDiscussion = await import('../discussion/protocol.js');
  window.__assistantFlavorId = ${JSON.stringify(flavor.id)};
`+script.slice(script.indexOf(marker))+'\nstartPresetAssistant().then(() => { window.ui.openPanel(); window.testReady=true; });';
injected=require('esbuild').buildSync({stdin:{contents:injected,resolveDir:path.resolve('src/preset'),sourcefile:'assistant.js'},bundle:true,format:'iife',platform:'browser',target:'es2022',write:false,define:{__ASSISTANT_FLAVOR__:JSON.stringify(flavor),__ASSISTANT_FLAVOR_INJECTED__:'"1"'}}).outputFiles[0].text;
const mock=`window.mergeTavernVariables=${variableMerge};window.getWorldbookNames=async()=>[];window.getGlobalWorldbookNames=()=>[];window.rebindGlobalWorldbooks=async()=>{};window.getLastMessageId=()=>-1;window.getChatMessages=()=>[];window.insertOrAssignVariables=(v,o)=>{const next=mergeTavernVariables(getVariables(o),v);replaceVariables(next,o);return next;};window.data=${JSON.stringify(preset)};window.stored=structuredClone(data);window.vars={};window.errors=[];window.addEventListener('error',e=>errors.push(e.message));window.addEventListener('unhandledrejection',e=>errors.push(String(e.reason)));
window.getScriptId=()=> 'b71c4f60-2a1d-4d2e-9f77-8d0a6c5b1e42';window.getVariables=()=>vars;window.replaceVariables=v=>{vars=structuredClone(v)};
window.getPreset=n=>structuredClone(n==='in_use'?data:stored);window.getLoadedPresetName=()=> '通用测试预设';window.replacePreset=async(n,v)=>{if(window.failWrite===n){window.failWrite=null;throw Error('simulated save failure')} if(n==='in_use')data=structuredClone(v);else stored=structuredClone(v)};
window.handlers=new Map();window.tavern_events=Object.fromEntries(['MESSAGE_RECEIVED','MESSAGE_EDITED','MESSAGE_DELETED','MESSAGE_SWIPED','PRESET_CHANGED','OAI_PRESET_CHANGED_AFTER','SETTINGS_UPDATED','CHAT_COMPLETION_PROMPT_READY','GENERATE_AFTER_DATA','CONNECTION_PROFILE_LOADED','CONNECTION_PROFILE_CREATED','CONNECTION_PROFILE_DELETED','CONNECTION_PROFILE_UPDATED','CHAT_CHANGED','CHARACTER_PAGE_LOADED','CHARACTER_EDITED','WORLDINFO_SETTINGS_UPDATED','WORLDINFO_UPDATED'].map(s=>[s,s]));window.eventOn=(name,fn)=>{const list=handlers.get(name)||[];list.push(fn);handlers.set(name,list);return {stop(){}}};window.eventMakeLast=eventOn;window.getButtonEvent=n=>n;window.registerMacroLike=()=>({});window.getTavernHelperVersion=async()=> '4.0.0';window.SillyTavern={getContext:()=>({})};window.triggerSlash=async()=> '[]';window.updateScriptButtonsWith=()=>{};window.toastr={error:m=>errors.push(String(m)),warning:()=>{},success:()=>{},info:()=>{}};for(const name of ['confirm','prompt','alert'])window[name]=()=>{throw Error('Native browser dialog used: '+name)};`;
const isolationMock=`window.tavern_events.CHAT_COMPLETION_SETTINGS_READY='CHAT_COMPLETION_SETTINGS_READY';window.eventRemoveListener=(name,fn)=>handlers.set(name,(handlers.get(name)||[]).filter(listener=>listener!==fn));window.eventMakeLast=(name,fn)=>{eventRemoveListener(name,fn);return eventOn(name,fn);};`;
fs.writeFileSync('.ui-review/preview-general.html','<!doctype html><html lang="zh-CN"><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>通用预设助手 · 本地交互验证</title><body style="margin:0;background:#0c1210"><script>'+(mock+isolationMock).replaceAll('</script','<\\/script')+'</script><script>'+injected.replaceAll('</script','<\\/script')+'</script></body></html>');
const browser=spawn(process.env.CHROME_PATH || (process.platform==='win32'?'C:/Program Files/Google/Chrome/Application/chrome.exe':'/usr/bin/google-chrome'),['--headless=new',...(process.platform==='win32'?['--do-not-de-elevate']:[]),...(process.env.CI&&process.platform==='linux'?['--no-sandbox','--disable-dev-shm-usage']:[]),'--disable-gpu','--no-first-run','--no-default-browser-check','--remote-debugging-port=0','--remote-allow-origins=*','--user-data-dir='+path.resolve('.ui-review/chrome-profile-general'),'about:blank'],{windowsHide:true,stdio:['ignore','ignore','pipe']});
let ws;
let stage='starting Chrome';
const watchdog=setTimeout(()=>{console.error('Browser verification timed out: '+stage);ws?.close();browser.kill();process.exitCode=1;},180000);
try{
const endpoint=await new Promise((resolve,reject)=>{browser.once('error',reject);let log='';browser.stderr.on('data',v=>{log+=v;const m=log.match(/DevTools listening on (ws:\/\/[^\s]+)/);if(m)resolve(m[1]);});browser.once('exit',code=>reject(Error('Chrome exited '+code+': '+log.slice(-2000))));setTimeout(()=>reject(Error('Chrome startup timeout: '+log.slice(-2000))),30000).unref();});
const browserUrl=new URL(endpoint);
stage='listing browser pages';
const pages=await (await fetch('http://'+browserUrl.host+'/json/list')).json();
stage='connecting to browser';
ws=new WebSocket(pages.find(p=>p.type === 'page').webSocketDebuggerUrl);await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Browser connection timeout')),10000);ws.addEventListener('open',()=>{clearTimeout(timer);resolve();},{once:true});ws.addEventListener('error',()=>{clearTimeout(timer);reject(Error('Browser connection failed'));},{once:true});});
let id=0;const pending=new Map();ws.addEventListener('message',e=>{const m=JSON.parse(e.data);if(m.id){const p=pending.get(m.id);pending.delete(m.id);m.error?p.reject(Error(m.error.message)):p.resolve(m.result);}});
const cdp=(method,params={})=>new Promise((resolve,reject)=>{stage=method;const key=++id;const timer=setTimeout(()=>{pending.delete(key);reject(Error('Browser command timed out: '+method));},60000);pending.set(key,{resolve:value=>{clearTimeout(timer);resolve(value);},reject:error=>{clearTimeout(timer);reject(error);}});ws.send(JSON.stringify({id:key,method,params}));});
const evaluate=async expression=>{const r=await cdp('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw Error(r.exceptionDetails.text+' '+r.exceptionDetails.exception?.description);return r.result.value;};
await cdp('Emulation.setDeviceMetricsOverride',{width:1280,height:960,screenWidth:1280,screenHeight:960,deviceScaleFactor:1,mobile:false});
await cdp('Page.navigate',{url:'file:///'+path.resolve('.ui-review/preview-general.html').replaceAll('\\','/')});
for(let i=0;i<50;i++){if(await evaluate('window.testReady && !!window.ui?.shadow?.querySelector(".panel")'))break;await new Promise(r=>setTimeout(r,100));}
console.log(await evaluate('({errors:window.errors,ready:!!window.ui,vars:window.vars})'));
const results=await evaluate(fs.readFileSync('tests/ui/general-tests.txt','utf8'));
console.log(JSON.stringify(results,null,2));fs.writeFileSync('.ui-review/general-test-results.json',JSON.stringify(results,null,2));
const worldResults=await evaluate(fs.readFileSync('tests/ui/worldbook-tests.txt','utf8'));
console.log(JSON.stringify(worldResults,null,2));fs.writeFileSync('.ui-review/general-worldbook-test-results.json',JSON.stringify(worldResults,null,2));
const layout=await evaluate(`(()=>{const root=ui.shadow;const c=root.querySelector('.content');const p=root.querySelector('.panel').getBoundingClientRect();const options=root.querySelector('.variable-options');return {overflow:c.scrollWidth>c.clientWidth+1,panelOutside:p.left<0||p.right>innerWidth+1||p.bottom>innerHeight+1,modes:options?options.querySelectorAll('button').length:0}})()`);
assert(!layout.overflow&&!layout.panelOutside,'general layout '+JSON.stringify(layout));
const shot=await cdp('Page.captureScreenshot',{format:'png'});fs.writeFileSync('.ui-review/general-desktop.png',Buffer.from(shot.data,'base64'));
await cdp('Browser.close');
}catch(e){console.error(e);process.exitCode=1;}finally{clearTimeout(watchdog);ws?.close();browser.kill();}
})().catch(e => { console.error(e); process.exitCode = 1; });
