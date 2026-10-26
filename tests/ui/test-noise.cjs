// Real UI modules/runtime with simulated host/storage APIs; no Tavern/model calls.
const fs = require('node:fs'), Module = require('node:module');
let source = fs.readFileSync('tests/ui/test-ui.cjs', 'utf8');
const fixture = `
import {createNoiseControls} from './noise-controls.js';
import {createEvents} from './events.js';
import {PANEL_CSS} from '../ui/styles.js';
const host=document.createElement('div');document.body.append(host);const shadow=host.attachShadow({mode:'open'});
shadow.innerHTML='<style>'+PANEL_CSS+'</style><div class="destined-root"><section class="panel" style="inset:12px;width:auto;height:auto;min-width:0"><main class="content"></main></section></div>';
const value={supported:true,enabled:false,mode:'fixed',segments:10,estimatedTokens:2500,text:'',error:'',busy:false};
const state={disclosures:new Set(),editorUnlocked:true,workspaceBusy:false};
const ctx={state,shadow,readNoiseControl:()=>({...value}),IDS:{resetCache:'cache'},getPrompt:()=>({id:'cache',enabled:false}),escapeHtml:s=>String(s??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;'),toggleHtml:()=>'<input type="checkbox" data-cache-toggle aria-label="重置命中缓存">',showErrorToast:e=>window.testFailure=String(e),async setNoiseSetting(key,v){window.noiseWrites++;if(window.failNoiseSave){ctx.renderActiveContent();throw Error('模拟保存失败');}value[key]=v;if(value.enabled){value.estimatedTokens=value.segments*250;value.text='Example log '.repeat(value.segments);}ctx.renderActiveContent(); },async regenerateNoise(){window.noiseRegenerations++;value.text='Replacement noise '.repeat(150);ctx.renderActiveContent();}};
ctx.previewNoiseSegments=segments=>({segments,estimatedTokens:segments*250,text:'Example log '.repeat(segments)});
Object.assign(ctx,createNoiseControls(ctx));
ctx.renderActiveContent=()=>{for(const d of shadow.querySelectorAll('[data-disclosure]'))d.open?state.disclosures.add(d.dataset.disclosure):state.disclosures.delete(d.dataset.disclosure);shadow.querySelector('.content').innerHTML=ctx.renderNoiseControls();};
const events=createEvents(ctx);shadow.addEventListener('click',events.handleClick);shadow.addEventListener('change',events.handleChange);shadow.addEventListener('input',events.handleInput);
window.noiseWrites=0;window.noiseRegenerations=0;window.ui={shadow,state,value,render:ctx.renderActiveContent};ctx.renderActiveContent();window.testReady=true;
`;
const bundle = require('esbuild').buildSync({stdin:{contents:fixture,resolveDir:require('node:path').resolve('src/preset')},bundle:true,format:'iife',platform:'browser',target:'es2022',write:false}).outputFiles[0].text;
const scriptStart=source.indexOf("const script=fs.readFileSync('src/preset/assistant.js'");
const mockStart=source.indexOf('const mock=',scriptStart);
if(scriptStart<0||mockStart<scriptStart)throw Error('Harness setup markers changed');
const integrated = process.argv.includes('--integrated');
if (!integrated) source=source.slice(0,scriptStart)+'const injected='+JSON.stringify(bundle)+';\n'+source.slice(mockStart);
if (integrated) {
 source=source.replace('if (modernLength) {', `{
 const protocol=preset.prompts.find(p=>p.id==='dafd56fc-9b51-4936-98b5-bc16f7c37db9');
 assert(protocol,'Output protocol fixture missing');protocol.enabled=true;
 protocol.content='<|命定_正文开始|>\\n{{destined_prompt_noise}}\\n'+protocol.content;
}\nif (modernLength) {`);
 source=source.replace('window.ui = { summary,','window.ui = { noise, summary,');
 const integrationMock=`
 window.vars.noise_padding={enabled:false,mode:'fixed',tokens:6000,seed:'93b72a5dc184e60f'};
 window.noiseTokenRequests=0;window.noiseExtraRequests=0;
 const originalNoiseFetch=window.fetch.bind(window);
 window.fetch=async(input,options)=>{
  const url=String(input);
  if(url.startsWith('/api/tokenizers/')){noiseTokenRequests++;throw Error('Noise must never call a tokenizer endpoint');}
  noiseExtraRequests++;return originalNoiseFetch(input,options);
 };
 window.nativeMacros=new Map();
 window.SillyTavern.getContext=()=>({
  getRequestHeaders:()=>({'Content-Type':'application/json'}),
  registerMacro:(name,callback)=>nativeMacros.set(name,callback),
  unregisterMacro:name=>nativeMacros.delete(name),
 });
 // Simulate native substitution at the input to budgeting, independently of the
 // helper's registerMacroLike mock, which remains unchanged for managed macros.
 window.nativeNoiseBeforeBudget=text=>{
  const expanded=text.replaceAll('{{destined_prompt_noise}}',String(nativeMacros.get('destined_prompt_noise')?.()??''));
  window.lastNativeNoiseBudget={text:expanded};
  return expanded;
 };
 for(const name of ['GENERATION_AFTER_COMMANDS','GENERATION_ENDED','GENERATION_STOPPED','CHAT_COMPLETION_SETTINGS_READY'])tavern_events[name]=name;
 `;
 source=source.replace("fs.writeFileSync('.ui-review/preview.html'",'const integrationMock='+JSON.stringify(integrationMock)+";\nfs.writeFileSync('.ui-review/preview.html'");
 source=source.replace('mock+isolationMock','mock+isolationMock+integrationMock');
}
const start=source.indexOf('console.log(await evaluate'),end=source.indexOf("await cdp('Browser.close');",start);
const runIsolated=async(cdp,evaluate)=>{
 const q=selector=>`ui.shadow.querySelector(${JSON.stringify(selector)})`;
 assert(await evaluate(`${q('[data-action=noise-enabled]')}.checked===false&&${q('[data-action=noise-segments]')}.value==='10'`));
 await evaluate(`${q('[data-action=noise-enabled]')}.click();new Promise(r=>setTimeout(r,10))`);
 assert.equal(await evaluate('noiseWrites'),1);
 await evaluate(`(()=>{window.dragNode=${q('[data-action=noise-segments]')};window.previewNode=${q('[data-noise-preview-text]')};dragNode.focus();for(let n=10;n<=48;n++){dragNode.value=n;dragNode.dispatchEvent(new Event('input',{bubbles:true}));}})()`);
 assert(await evaluate(`noiseWrites===1&&dragNode===${q('[data-action=noise-segments]')}&&ui.shadow.activeElement===dragNode&&previewNode===${q('[data-noise-preview-text]')}&&${q('[data-noise-segment-value]')}.textContent==='48 段 · 约 12000 tokens'&&previewNode.textContent==='Example log '.repeat(48)`));
 await evaluate(`dragNode.dispatchEvent(new Event('change',{bubbles:true}));new Promise(r=>setTimeout(r,10))`);
 assert.equal(await evaluate('ui.value.segments'),48);
 await evaluate(`(()=>{const s=${q('[data-action=noise-segment-number]')};s.value=24;s.dispatchEvent(new Event('change',{bubbles:true}));})()`);
 assert.equal(await evaluate('ui.value.segments'),24);
 for(const invalid of [9,49,10.5]){
  await evaluate(`(()=>{const s=${q('[data-action=noise-segment-number]')};s.value=${invalid};s.dispatchEvent(new Event('change',{bubbles:true}));})()`);
  assert.equal(await evaluate('ui.value.segments'),24);
  assert(await evaluate(`${q('[data-noise-error]')}.textContent.includes('10～48')`));
 }
 await evaluate(`window.failNoiseSave=true;${q('[data-action=noise-enabled]')}.click();new Promise(r=>setTimeout(r,10))`);
 assert(await evaluate(`${q('[data-action=noise-enabled]')}.checked&&ui.value.enabled&&!!window.testFailure`));
 await evaluate(`window.failNoiseSave=false;${q('[data-action=noise-mode][data-value=random]')}.click();new Promise(r=>setTimeout(r,10))`);
 assert(await evaluate(`${q('[data-action=noise-regenerate]')}.disabled&&ui.value.mode==='random'`));
 await evaluate(`${q('[data-action=noise-mode][data-value=fixed]')}.click();new Promise(r=>setTimeout(r,10))`);
 await evaluate(`${q('[data-action=noise-regenerate]')}.click();new Promise(r=>setTimeout(r,10))`);
 assert.equal(await evaluate('noiseRegenerations'),1);
 await evaluate(`${q('.noise-preview')}.open=true;ui.render()`);
 assert(await evaluate(`${q('.noise-preview')}.open`));
 for(const [width,height] of [[1280,960],[390,844],[320,640]]){
  await cdp('Emulation.setDeviceMetricsOverride',{width,height,screenWidth:width,screenHeight:height,deviceScaleFactor:1,mobile:width<720});
  await evaluate(`ui.shadow.querySelector('.destined-root').classList.toggle('mobile-layout',${width}<720);ui.render()`);
  const layout=await evaluate(`(()=>{const e=ui.shadow.querySelector('[data-noise-controls]'),r=e.getBoundingClientRect();return{overflow:e.scrollWidth>e.clientWidth+1,left:r.left,right:r.right,width:innerWidth}})()`);
  assert(!layout.overflow&&layout.left>=0&&layout.right<=layout.width+1,JSON.stringify(layout));
  const shot=await cdp('Page.captureScreenshot',{format:'png'});fs.writeFileSync('.ui-review/noise-'+width+'.png',Buffer.from(shot.data,'base64'));
 }
 await evaluate('ui.value.supported=false;ui.render()');
 assert(await evaluate(`${q('[data-action=noise-enabled]')}.disabled&&${q('[data-action=noise-segments]')}.disabled&&!${q('[data-cache-toggle]')}.disabled`));
 console.log('分段噪声UI：连续input保留节点/焦点并更新预览、change保存、整数范围、失败恢复、模式预览、协议禁用及三宽度布局通过（模拟宿主）');
};
const runIntegrated=async(cdp,evaluate)=>{
 await evaluate('ui.state.activeTab="daily";ui.render();ui.settle()');
 assert(await evaluate(`ui.shadow.querySelector('.content').children[1].matches('[data-noise-controls]')&&ui.shadow.querySelectorAll('[data-key="prompt:'+ui.IDS.resetCache+'"]').length===1`));
 assert(await evaluate(`ui.noise.readNoiseControl().segments===24&&ui.noise.readNoiseControl().estimatedTokens===6000`));
 assert(await evaluate(`nativeMacros.has('destined_prompt_noise')&&nativeMacros.get('destined_prompt_noise')()===''`));
 assert(await evaluate(`['GENERATION_AFTER_COMMANDS','GENERATION_ENDED','GENERATION_STOPPED','CHAT_COMPLETION_SETTINGS_READY'].every(name=>handlers.get(name)?.length)`));
 await evaluate(`ui.shadow.querySelector('.noise-preview').open=true;ui.shadow.querySelector('[data-action="noise-enabled"]').click();ui.settle()`);
 assert(await evaluate(`vars.noise_padding.enabled&&vars.noise_padding.segments===24&&!('tokens' in vars.noise_padding)&&!ui.noise.readNoiseControl().busy&&ui.shadow.querySelector('.noise-preview').open`));
 const fixed=await evaluate('ui.noise.readNoiseControl().text');
 assert(await evaluate(`nativeNoiseBeforeBudget('{{destined_prompt_noise}}')===ui.noise.readNoiseControl().text`));
 await evaluate(`(async()=>{for(const fn of handlers.get('GENERATION_AFTER_COMMANDS'))await fn('normal',{},false);for(const fn of handlers.get('GENERATION_ENDED'))await fn();})()`);
 assert.equal(await evaluate('ui.noise.readNoiseControl().text'),fixed);
 // Exercise the native range thumb with real mouse events across several frames.
 const pointer=await evaluate(`(()=>{window.mouseDragNode=ui.shadow.querySelector('[data-action="noise-segments"]');mouseDragNode.scrollIntoView({block:'center'});window.mouseDragStored=JSON.stringify(vars.noise_padding);window.mouseDragPreview=ui.shadow.querySelector('[data-noise-preview-text]').textContent;window.mouseDragWrites=0;window.mouseOriginalReplaceVariables=window.replaceVariables;window.replaceVariables=(...args)=>{mouseDragWrites++;return mouseOriginalReplaceVariables(...args)};const r=mouseDragNode.getBoundingClientRect(),start=(Number(mouseDragNode.value)-10)/38;return{x:r.left+7+start*(r.width-14),left:r.left+7,length:r.width-14,y:r.top+r.height/2};})()`);
 await cdp('Input.dispatchMouseEvent',{type:'mouseMoved',x:pointer.x,y:pointer.y});
 await cdp('Input.dispatchMouseEvent',{type:'mousePressed',x:pointer.x,y:pointer.y,button:'left',buttons:1,clickCount:1});
 for(const fraction of [0.5,0.65,0.85]){
  await cdp('Input.dispatchMouseEvent',{type:'mouseMoved',x:pointer.left+fraction*pointer.length,y:pointer.y,button:'left',buttons:1});
  await evaluate('new Promise(resolve=>requestAnimationFrame(()=>resolve()))');
  assert(await evaluate(`mouseDragNode===ui.shadow.querySelector('[data-action="noise-segments"]')&&JSON.stringify(vars.noise_padding)===mouseDragStored&&mouseDragWrites===0&&noiseTokenRequests===0&&noiseExtraRequests===0&&ui.shadow.querySelector('[data-noise-preview-text]').textContent===ui.noise.previewNoiseSegments(Number(mouseDragNode.value)).text&&ui.shadow.querySelector('[data-noise-preview-text]').textContent!==mouseDragPreview`));
 }
 const mouseFinal=await evaluate('Number(mouseDragNode.value)');
 assert(mouseFinal>=40&&mouseFinal<=45,`Unexpected native thumb position: ${mouseFinal}`);
 await cdp('Input.dispatchMouseEvent',{type:'mouseReleased',x:pointer.left+0.85*pointer.length,y:pointer.y,button:'left',buttons:0,clickCount:1});
 await evaluate('ui.settle()');
 assert(await evaluate(`vars.noise_padding.segments===${mouseFinal}&&mouseDragWrites===1&&noiseTokenRequests===0&&noiseExtraRequests===0`));
 await evaluate('window.replaceVariables=mouseOriginalReplaceVariables;ui.shadow.querySelector(".content").scrollTop=0');
 await evaluate(`(()=>{window.dragNode=ui.shadow.querySelector('[data-action="noise-segments"]');window.previewNode=ui.shadow.querySelector('[data-noise-preview-text]');window.beforeDragConfig=JSON.stringify(vars.noise_padding);window.beforeDragRequests=noiseExtraRequests;dragNode.focus();for(let n=10;n<=48;n++){dragNode.value=n;dragNode.dispatchEvent(new Event('input',{bubbles:true}));}})()`);
 assert(await evaluate(`JSON.stringify(vars.noise_padding)===beforeDragConfig&&noiseTokenRequests===0&&noiseExtraRequests===beforeDragRequests&&dragNode===ui.shadow.querySelector('[data-action="noise-segments"]')&&ui.shadow.activeElement===dragNode&&previewNode===ui.shadow.querySelector('[data-noise-preview-text]')&&previewNode.textContent===ui.noise.previewNoiseSegments(48).text&&ui.shadow.querySelector('[data-noise-segment-value]').textContent==='48 段 · 约 12000 tokens'`));
 await evaluate(`dragNode.dispatchEvent(new Event('change',{bubbles:true}));ui.settle()`);
 assert(await evaluate(`vars.noise_padding.segments===48&&ui.noise.readNoiseControl().estimatedTokens===12000`));
 await evaluate(`(()=>{const s=ui.shadow.querySelector('[data-action="noise-segments"]');s.value=47;s.dispatchEvent(new Event('change',{bubbles:true}));window.pendingDragNode=ui.shadow.querySelector('[data-action="noise-segments"]');pendingDragNode.focus();pendingDragNode.value=24;pendingDragNode.dispatchEvent(new Event('input',{bubbles:true}));})()`);
 await evaluate('ui.settle()');
 assert(await evaluate(`pendingDragNode===ui.shadow.querySelector('[data-action="noise-segments"]')&&ui.shadow.activeElement===pendingDragNode&&pendingDragNode.value==='24'&&vars.noise_padding.segments===47&&ui.shadow.querySelector('[data-noise-segment-value]').textContent==='24 段 · 约 6000 tokens'`));

 await evaluate(`(()=>{const s=ui.shadow.querySelector('[data-action="noise-segment-number"]');s.value=11;s.dispatchEvent(new Event('change',{bubbles:true}));})()`);
 await evaluate('ui.settle()');
 assert(await evaluate('vars.noise_padding.segments===11&&ui.noise.readNoiseControl().estimatedTokens===2750'));
 await evaluate(`window.noiseStoredBeforeFailure=JSON.stringify(vars.noise_padding);window.noiseOriginalReplaceVariables=window.replaceVariables;window.replaceVariables=()=>{throw Error('模拟噪声设置保存失败')};ui.shadow.querySelector('[data-action="noise-enabled"]').click();ui.settle()`);
 assert(await evaluate(`ui.noise.readNoiseControl().enabled&&ui.shadow.querySelector('[data-action="noise-enabled"]').checked&&JSON.stringify(vars.noise_padding)===noiseStoredBeforeFailure&&errors.some(message=>message.includes('模拟噪声设置保存失败'))`));
 await evaluate('window.replaceVariables=noiseOriginalReplaceVariables');
 const beforeReroll=await evaluate('({seed:vars.noise_padding.seed,text:ui.noise.readNoiseControl().text})');
 await evaluate(`ui.shadow.querySelector('[data-action="noise-regenerate"]').click();ui.settle()`);
 assert(await evaluate(`vars.noise_padding.seed!==${JSON.stringify(beforeReroll.seed)}&&ui.noise.readNoiseControl().text!==${JSON.stringify(beforeReroll.text)}`));
 await evaluate(`ui.shadow.querySelector('[data-action="noise-mode"][data-value="random"]').click();ui.settle()`);
 assert(await evaluate(`vars.noise_padding.mode==='random'&&ui.shadow.querySelector('[data-action="noise-regenerate"]').disabled`));
 const randomPreview=await evaluate('ui.noise.readNoiseControl().text');
 await evaluate(`(async()=>{for(const fn of handlers.get('GENERATION_AFTER_COMMANDS'))await fn('normal',{},true);})()`);
 assert.equal(await evaluate('ui.noise.readNoiseControl().text'),randomPreview);
 await evaluate(`(async()=>{for(const fn of handlers.get('GENERATION_AFTER_COMMANDS'))await fn('normal',{},false);})()`);
 const randomRound=await evaluate('ui.noise.readNoiseControl().text');assert.notEqual(randomRound,randomPreview);
 await evaluate(`(async()=>{for(const fn of handlers.get('GENERATION_ENDED'))await fn();for(const fn of handlers.get('GENERATION_AFTER_COMMANDS'))await fn('normal',{},false);for(const fn of handlers.get('GENERATION_STOPPED'))await fn();})()`);
 assert.notEqual(await evaluate('ui.noise.readNoiseControl().text'),randomRound);
 assert.equal(await evaluate('noiseTokenRequests'),0);
 assert.equal(await evaluate('noiseExtraRequests'),0);
 const enabled=await evaluate('ui.state.preset.prompts.find(p=>p.id===ui.IDS.resetCache).enabled');
 await evaluate(`ui.shadow.querySelector('[data-key="prompt:'+ui.IDS.resetCache+'"]').click();ui.settle()`);
 assert.equal(await evaluate('stored.prompts.find(p=>p.id===ui.IDS.resetCache).enabled'),!enabled);
 await evaluate('ui.state.editorUnlocked=true;ui.render();ui.shadow.querySelector("[data-noise-controls] [data-action=entry-edit]").click()');
 assert(await evaluate('ui.state.promptEditor.id===ui.IDS.resetCache'));
 await evaluate('ui.closePromptEditor(true);ui.state.activeTab="tools";ui.render()');
 assert(await evaluate(`!ui.shadow.querySelector('[data-key="prompt:'+ui.IDS.resetCache+'"]')`));
 for(const [width,height] of [[1280,960],[390,844],[320,640]]){
  await cdp('Emulation.setDeviceMetricsOverride',{width,height,screenWidth:width,screenHeight:height,deviceScaleFactor:1,mobile:width<720});
  await evaluate('ui.state.activeTab="daily";ui.render()');
  const layout=await evaluate(`(()=>{const c=ui.shadow.querySelector('.content'),r=ui.shadow.querySelector('.panel').getBoundingClientRect();return{overflow:c.scrollWidth>c.clientWidth+1,outside:r.left<0||r.right>innerWidth+1}})()`);
  assert(!layout.overflow&&!layout.outside,JSON.stringify(layout));
  const shot=await cdp('Page.captureScreenshot',{format:'png'});fs.writeFileSync('.ui-review/noise-integrated-'+width+'.png',Buffer.from(shot.data,'base64'));
 }
 await evaluate('globalThis.__destinedJourneyAssistant.destroy()');assert(await evaluate(`!nativeMacros.has('destined_prompt_noise')`));
 console.log('真实分段噪声runtime+模拟宿主：旧tokens迁移、启用持久化、连续拖动无保存/网络/节点替换、段数预览、change保存、固定/随机/dry-run、原生宏注销、缓存编辑及三宽度布局通过');
};
const run = integrated ? runIntegrated : runIsolated;
source=source.slice(0,start)+`await (${run.toString()})(cdp,evaluate);\n`+source.slice(end);
source=source.replaceAll('.ui-review/preview.html','.ui-review/noise-preview.html').replace("path.resolve('.ui-review/chrome-profile')","path.resolve('.ui-review/chrome-noise-profile')");
const runner=new Module(__filename,module);runner.filename=__filename;runner.paths=module.paths;runner._compile(source,__filename);
