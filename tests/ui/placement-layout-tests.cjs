module.exports=async(cdp,evaluate)=>{
 const fs=require('node:fs'),assert=require('node:assert/strict'),results=[];
 await cdp('Emulation.setDeviceMetricsOverride',{width:1280,height:960,screenWidth:1280,screenHeight:960,deviceScaleFactor:1,mobile:false});
 await evaluate('ui.closePromptEditor(true);ui.state.editorUnlocked=false;ui.render()');
 const toggle=await evaluate(`(()=>{const r=ui.shadow.querySelector('.edit-mode-switch span').getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})()`);
 await cdp('Input.dispatchMouseEvent',{type:'mousePressed',...toggle,button:'left',clickCount:1});
 assert(await evaluate(`!ui.shadow.querySelector('.panel-moving')`),'编辑总开关文字不触发窗口拖动');
 await cdp('Input.dispatchMouseEvent',{type:'mouseReleased',...toggle,button:'left',clickCount:1});
 assert(await evaluate('ui.state.editorUnlocked'),'鼠标点击总开关文字开启编辑');
 results.push('真实鼠标点击编辑模式文字，正确开启且不拖动窗口');
 await evaluate('ui.state.editorUnlocked=false;ui.render()');
 for(const [name,width,height,tab]of [['simple-daily',1280,960,'daily'],['simple-style',390,844,'style'],['simple-tools',320,640,'tools'],['simple-editor',1280,960,'editor'],['simple-editor',390,844,'editor'],['simple-editor',320,640,'editor']]){
  await cdp('Emulation.setDeviceMetricsOverride',{width,height,screenWidth:width,screenHeight:height,deviceScaleFactor:1,mobile:width<720});
  await evaluate(`ui.closePromptEditor(true);ui.state.activeTab=${JSON.stringify(tab==='editor'?'advanced':tab)};ui.render();${tab==='editor'?'ui.state.editorUnlocked=true;ui.openPromptEditor(ui.IDS.eventChain);':''}`);
  await new Promise(r=>setTimeout(r,150));
  if(tab==='editor'){await evaluate(`ui.shadow.querySelector('.placement-fields').scrollIntoView({block:'center'});`);await new Promise(r=>setTimeout(r,80));}
  const bounds=await evaluate(`(()=>{const c=ui.shadow.querySelector('.content'),p=ui.shadow.querySelector('.panel').getBoundingClientRect(),e=ui.shadow.querySelector('.prompt-editor-body');return{outside:p.left<0||p.right>innerWidth+1||p.bottom>innerHeight+1,overflow:c.scrollWidth>c.clientWidth+1,editor:e&&e.scrollWidth>e.clientWidth+1}})()`);
  assert(!bounds.outside&&!bounds.overflow&&!bounds.editor,name+width+JSON.stringify(bounds));
  const shot=await cdp('Page.captureScreenshot',{format:'png'});fs.writeFileSync(`.ui-review/${name}-${width}.png`,Buffer.from(shot.data,'base64'));results.push(name+' '+width+'px 布局通过');
 }
 for(const width of [1280,390,320])for(const [tab,block]of [['daily','reply'],['style','main-style'],['tools','models']]){
  const height=width===1280?960:844;
  await cdp('Emulation.setDeviceMetricsOverride',{width,height,screenWidth:width,screenHeight:height,deviceScaleFactor:1,mobile:width<720});
  await evaluate(`ui.closePromptEditor(true);ui.state.editorUnlocked=false;ui.state.activeTab=${JSON.stringify(tab)};ui.render();ui.shadow.querySelector('[data-placement-block="${block}"]').scrollIntoView({block:'start'});`);
  await new Promise(r=>setTimeout(r,200));
  await evaluate(`(()=>{const c=ui.shadow.querySelector('.content'),s=ui.shadow.querySelector('[data-placement-block="${block}"]');c.scrollTop+=s.getBoundingClientRect().top-c.getBoundingClientRect().top-8;})()`);
  const result=await evaluate(`(()=>{const root=ui.shadow,c=root.querySelector('.content'),section=root.querySelector('[data-placement-block="${block}"]');return{overflow:c.scrollWidth>c.clientWidth+1,heights:[...section.querySelectorAll('.numeric-card,.placed-choice')].map(e=>e.getBoundingClientRect().height),directions:[...section.querySelectorAll('.chips')].map(e=>getComputedStyle(e).flexDirection),editSwitch:root.querySelector('[data-action="edit-mode"]').getBoundingClientRect().height}})()`);
  assert(!result.overflow&&result.heights.every(h=>h<225)&&result.directions.every(d=>d==='row')&&result.editSwitch===18,JSON.stringify({width,tab,result}));
  const shot=await cdp('Page.captureScreenshot',{format:'png'});fs.writeFileSync(`.ui-review/compact-${block}-${width}.png`,Buffer.from(shot.data,'base64'));results.push(`${block} ${width}px 紧凑布局通过`);
 }
 await evaluate('ui.closePromptEditor(true)');fs.writeFileSync('.ui-review/placement-layout-results.json',JSON.stringify(results,null,2));return results;
};
