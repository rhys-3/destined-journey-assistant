module.exports=async(cdp,evaluate)=>{
 const fs=require('node:fs'),assert=require('node:assert/strict'),results=[];
 await evaluate('window.descriptionLayoutBefore={data:structuredClone(data),stored:structuredClone(stored),vars:structuredClone(vars)}');
 try{
 for(const width of [1280,390,320]){
  const height=width===1280?960:width===390?844:640;
  await cdp('Emulation.setDeviceMetricsOverride',{width,height,screenWidth:width,screenHeight:height,deviceScaleFactor:1,mobile:width<720});
  await evaluate(`ui.closePromptEditor(true);ui.state.editorUnlocked=true;ui.openPromptEditor(ui.IDS.dialogue);ui.shadow.querySelector('.editor-descriptions').scrollIntoView({block:'start'});new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))`);
  const pos=await evaluate(`(()=>{const r=ui.shadow.querySelector('[data-field="description:dialogueRatio"]').getBoundingClientRect();return{x:r.x+20,y:r.y+15}})()`);
  await cdp('Input.dispatchMouseEvent',{type:'mousePressed',...pos,button:'left',clickCount:1});await cdp('Input.dispatchMouseEvent',{type:'mouseReleased',...pos,button:'left',clickCount:1});
  await cdp('Input.dispatchKeyEvent',{type:'rawKeyDown',key:'a',code:'KeyA',windowsVirtualKeyCode:65,modifiers:2});await cdp('Input.dispatchKeyEvent',{type:'keyUp',key:'a',code:'KeyA',windowsVirtualKeyCode:65,modifiers:2});
  await cdp('Input.insertText',{text:'对白用于推进交谈，避免反复解释同一件事。'});
  const state=await evaluate(`(()=>{const s=ui.shadow,e=s.querySelector('.prompt-editor-body'),p=s.querySelector('[data-description-preview]'),b=s.querySelector('[data-action="prompt-save"]').getBoundingClientRect();return{dirty:ui.state.promptEditor.dirty,preview:p.textContent,overflow:e.scrollWidth>e.clientWidth+1,button:b.bottom<=innerHeight&&b.top>=0}})()`);
  assert(state.dirty&&state.preview.includes('推进交谈')&&!state.overflow&&state.button,JSON.stringify(state));
  const shot=await cdp('Page.captureScreenshot',{format:'png'});fs.writeFileSync(`.ui-review/description-editor-${width}.png`,Buffer.from(shot.data,'base64'));
  results.push(`${width}px 简介编辑、真实输入、实时预览和固定保存按钮通过`);
  await evaluate(`ui.closePromptEditor(true);ui.openPromptEditor(ui.IDS.eventChain);ui.setEditorField('description:description','长简介换行测试 '+ 'LongWord'.repeat(40)+'\\n第二行说明');ui.savePromptEditor()`);
  await evaluate(`(async()=>{ui.state.activeTab='daily';ui.render();await ui.settle();const c=ui.shadow.querySelector('.content'),e=ui.shadow.querySelector('[data-placement-id="'+ui.IDS.eventChain+'"]');c.scrollTop+=e.getBoundingClientRect().top-c.getBoundingClientRect().top-8;})()`);
  const card=await evaluate(`(()=>{const s=ui.shadow,e=s.querySelector('[data-placement-id="'+ui.IDS.eventChain+'"]'),t=e.querySelector('.placed-actions').getBoundingClientRect(),c=s.querySelector('.content');return{overflow:c.scrollWidth>c.clientWidth+1,cardOverflow:e.scrollWidth>e.clientWidth+1,actions:t.width>50&&t.right<=innerWidth}})()`);
  assert(!card.overflow&&!card.cardOverflow&&card.actions,JSON.stringify(card));
  const cardShot=await cdp('Page.captureScreenshot',{format:'png'});fs.writeFileSync(`.ui-review/description-card-${width}.png`,Buffer.from(cardShot.data,'base64'));
 }
 }finally{await evaluate(`(async()=>{ui.closePromptEditor(true);data=descriptionLayoutBefore.data;stored=descriptionLayoutBefore.stored;vars=descriptionLayoutBefore.vars;delete window.descriptionLayoutBefore;ui.state.config=ui.loadScriptConfig();ui.rebuildModelRegistry();ui.reconcilePreset('description layout restored');ui.render();await ui.settle();})()`);}
 return results;
};
