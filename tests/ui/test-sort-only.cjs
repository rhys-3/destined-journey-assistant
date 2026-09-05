(async () => {
const fs = require('node:fs');
const {spawn} = require('node:child_process');
const path = require('node:path');
const assert = require('node:assert/strict');
const raw=JSON.parse(fs.readFileSync('build/命定之诗专用预设-0.7.json','utf8'));
const convert=(p,enabled)=>({...p,id:p.identifier,enabled,role:p.role??'system',position:p.injection_position===1?{type:'in_chat',depth:p.injection_depth,order:p.injection_order}:{type:'relative'}});
const prompts=raw.prompt_order[0].order.map(o=>{const p=raw.prompts.find(p=>p.identifier===o.identifier);return p?convert(p,o.enabled):null}).filter(Boolean);
const preset={settings:{should_stream:raw.stream_openai},prompts,prompts_unused:raw.prompts.filter(p=>!prompts.some(q=>q.id===p.identifier)).map(p=>convert(p,p.enabled)),extensions:{}};
const script=fs.readFileSync('split/命定之诗专用预设-0.7/extensions/tavern_helper/scripts/【命定之诗】预设设置.js','utf8');
const marker='  try {\n    const version = await getTavernHelperVersion();';
assert(script.includes(marker));
const injected=script.slice(0,script.indexOf(marker))+`
  window.ui = { state, IDS, GROUPS, MODEL_ADAPTERS, PROTECTED_IDS, worldLink, worldWrites, variablePresetMode, scanWorldbookMode, scheduleWorldbookScan, selectVariableMode, render, renderActiveContent, openPanel, closePanel, applyGroup, selectModelAdapter, setNumericField, setNarrationPerson, setGlobalPreference, setUserAdditionalSetting, togglePrompt, updateEntryPoint, reconcilePreset, expandManagedMacros, openStyleEditor, saveStyleEditor, deleteUserStyle, getGroupOptions, readUserAdditionalSetting, openPromptEditor, savePromptEditor, closePromptEditor, setEditorField, get shadow(){return shadow;}, async settle(){await new Promise(r=>setTimeout(r,400));await saveChain;} };
`+script.slice(script.indexOf(marker))+'\nsetTimeout(() => window.ui.openPanel(), 0);';
const mock=`window.data=${JSON.stringify(preset)};window.stored=structuredClone(data);window.vars={managed_values_version:1,style_structure_version:1};window.errors=[];window.addEventListener('error',e=>errors.push(e.message));window.addEventListener('unhandledrejection',e=>errors.push(String(e.reason)));
window.getScriptId=()=> 'a980269e-8d77-4f5e-bad7-b2fe0a2cd470';window.getVariables=()=>vars;window.replaceVariables=v=>{vars=structuredClone(v)};
window.getPreset=n=>structuredClone(n==='in_use'?data:stored);window.getLoadedPresetName=()=> 'test';window.replacePreset=async(n,v)=>{if(window.failWrite===n){window.failWrite=null;throw Error('simulated save failure')} if(n==='in_use')data=structuredClone(v);else stored=structuredClone(v)};
window.handlers=new Map();window.tavern_events=Object.fromEntries(['PRESET_CHANGED','OAI_PRESET_CHANGED_AFTER','SETTINGS_UPDATED','CHAT_COMPLETION_PROMPT_READY','GENERATE_AFTER_DATA','CONNECTION_PROFILE_LOADED','CONNECTION_PROFILE_CREATED','CONNECTION_PROFILE_DELETED','CONNECTION_PROFILE_UPDATED','CHAT_CHANGED','CHARACTER_PAGE_LOADED','CHARACTER_EDITED','WORLDINFO_SETTINGS_UPDATED','WORLDINFO_UPDATED'].map(s=>[s,s]));window.eventOn=(name,fn)=>{const list=handlers.get(name)||[];list.push(fn);handlers.set(name,list);return {stop(){}}};window.eventMakeLast=eventOn;window.getButtonEvent=n=>n;window.registerMacroLike=()=>({});window.getTavernHelperVersion=async()=> '4.0.0';window.SillyTavern={getContext:()=>({})};window.triggerSlash=async()=> '[]';window.updateScriptButtonsWith=()=>{};window.toastr={error:m=>errors.push(String(m)),warning:()=>{},success:()=>{},info:()=>{}};window.confirm=()=>true;`;
fs.writeFileSync('.ui-review/preview.html','<!doctype html><html lang="zh-CN"><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>命定预设设置 · 本地交互验证</title><body style="margin:0;background:#0c1210"><script>'+mock.replaceAll('</script','<\\/script')+'</script><script>'+injected.replaceAll('</script','<\\/script')+'</script></body></html>');
const browser=spawn('C:/Program Files/Google/Chrome/Application/chrome.exe',['--headless=new','--disable-gpu','--no-first-run','--no-default-browser-check','--remote-debugging-port=0','--remote-allow-origins=*','--user-data-dir='+path.resolve('.ui-review/chrome-profile'),'about:blank'],{windowsHide:true,stdio:['ignore','ignore','pipe']});
let ws;
try{
const endpoint=awaitPromise();
function awaitPromise(){return new Promise((resolve,reject)=>{let log='';browser.stderr.on('data',v=>{log+=v;const m=log.match(/DevTools listening on (ws:\/\/[^\s]+)/);if(m)resolve(m[1]);});setTimeout(()=>reject(Error('Chrome startup timeout')),12000).unref();});}
const browserUrl=new URL(await endpoint);
const pages=await (await fetch('http://'+browserUrl.host+'/json/list')).json();
ws=new WebSocket(pages.find(p=>p.type === 'page').webSocketDebuggerUrl);await new Promise(r=>ws.addEventListener('open',r,{once:true}));
let id=0;const pending=new Map();ws.addEventListener('message',e=>{const m=JSON.parse(e.data);if(m.id){const p=pending.get(m.id);pending.delete(m.id);m.error?p.reject(Error(m.error.message)):p.resolve(m.result);}});
const cdp=(method,params={})=>new Promise((resolve,reject)=>{const key=++id;pending.set(key,{resolve,reject});ws.send(JSON.stringify({id:key,method,params}));});
const evaluate=async expression=>{const r=await cdp('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw Error(r.exceptionDetails.text+' '+r.exceptionDetails.exception?.description);return r.result.value;};
await cdp('Emulation.setDeviceMetricsOverride',{width:1280,height:960,screenWidth:1280,screenHeight:960,deviceScaleFactor:1,mobile:false});
await cdp('Page.navigate',{url:'file:///'+path.resolve('.ui-review/preview.html').replaceAll('\\','/')});
for(let i=0;i<50;i++){if(await evaluate('!!window.ui?.shadow?.querySelector(".panel")'))break;await new Promise(r=>setTimeout(r,100));}
const sortResults=await require('./sort-tests.cjs')(cdp,evaluate);console.log(JSON.stringify(sortResults,null,2));fs.writeFileSync('.ui-review/sort-test-results.json',JSON.stringify(sortResults,null,2));
for(const [name,width,height,tab] of [['desktop',1280,960,'daily'],['desktop-style',1280,960,'style'],['mobile',390,844,'daily'],['mobile-tools',390,844,'tools'],['small-mobile',320,640,'style'],['desktop-entries',1280,960,'advanced'],['mobile-entries',390,844,'advanced'],['desktop-editor',1280,960,'editor'],['mobile-editor',390,844,'editor'],['small-editor',320,640,'editor']]){
await cdp('Emulation.setDeviceMetricsOverride',{width,height,screenWidth:width,screenHeight:height,deviceScaleFactor:1,mobile:width<720});await evaluate(`ui.closePromptEditor(true);ui.state.activeTab=${JSON.stringify(tab==='editor'?'advanced':tab)};ui.render();${tab==='editor'?'ui.openPromptEditor(ui.IDS.resetCache);':''}`);await new Promise(r=>setTimeout(r,150));
const overflow=await evaluate(`(()=>{const root=ui.shadow;const c=root.querySelector('.content');const p=root.querySelector('.panel').getBoundingClientRect();return {overflow:c.scrollWidth>c.clientWidth+1,panelOutside:p.left<0||p.right>innerWidth+1||p.bottom>innerHeight+1}})()`);assert(!overflow.overflow&&!overflow.panelOutside,name+JSON.stringify(overflow));
if(tab==='editor'){const layout=await evaluate(`(()=>{const p=ui.shadow.querySelector('.prompt-editor');const b=p.getBoundingClientRect();const body=p.querySelector('.prompt-editor-body');return {overflow:body.scrollWidth>body.clientWidth+1,outside:b.left<0||b.right>innerWidth+1||b.bottom>innerHeight+1}})()`);assert(!layout.overflow&&!layout.outside,name+JSON.stringify(layout));}
const shot=await cdp('Page.captureScreenshot',{format:'png'});fs.writeFileSync('.ui-review/'+name+'.png',Buffer.from(shot.data,'base64'));console.log(name+' layout OK');}
await cdp('Browser.close');
}catch(e){console.error(e);process.exitCode=1;}finally{ws?.close();browser.kill();}
})().catch(e => { console.error(e); process.exitCode = 1; });
