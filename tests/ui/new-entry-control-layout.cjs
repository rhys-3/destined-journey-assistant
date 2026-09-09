module.exports=async(cdp,evaluate)=>{
 const fs=require('node:fs'),assert=require('node:assert/strict'),results=[];
 for(const width of [1280,390,320]){
  const height=width===1280?960:width===390?844:640;
  await cdp('Emulation.setDeviceMetricsOverride',{width,height,screenWidth:width,screenHeight:height,deviceScaleFactor:1,mobile:width<720});
  await evaluate(`(async()=>{ui.closePromptEditor(true);ui.state.editorUnlocked=true;ui.openPromptEditor('',{block:'plot-pace'});await ui.settle();ui.shadow.querySelector('.new-entry-control').scrollIntoView({block:'center'});})()`);
  const pos=await evaluate(`(()=>{const r=ui.shadow.querySelector('[data-field="controlType"]').getBoundingClientRect();return{x:r.x+20,y:r.y+r.height/2}})()`);
  await cdp('Input.dispatchMouseEvent',{type:'mousePressed',...pos,button:'left',clickCount:1});await cdp('Input.dispatchMouseEvent',{type:'mouseReleased',...pos,button:'left',clickCount:1});
  for(const [key,code,vk]of [['Home','Home',36],['Enter','Enter',13]]){await cdp('Input.dispatchKeyEvent',{type:'rawKeyDown',key,code,windowsVirtualKeyCode:vk});await cdp('Input.dispatchKeyEvent',{type:'keyUp',key,code,windowsVirtualKeyCode:vk});}
  const state=await evaluate(`(()=>{const e=ui.shadow.querySelector('.prompt-editor-body'),s=ui.shadow.querySelector('[data-action="prompt-save"]').getBoundingClientRect();return{type:ui.state.promptEditor.draft.controlType,overflow:e.scrollWidth>e.clientWidth+1,save:s.top>=0&&s.bottom<=innerHeight}})()`);
  assert(state.type==='toggle'&&!state.overflow&&state.save,JSON.stringify(state));
  await evaluate(`ui.setEditorField('controlType','single');ui.renderActiveContent(true);ui.shadow.querySelector('.new-entry-control').scrollIntoView({block:'center'});`);
  const shot=await cdp('Page.captureScreenshot',{format:'png'});fs.writeFileSync(`.ui-review/new-entry-control-${width}.png`,Buffer.from(shot.data,'base64'));results.push(`${width}px 类型选择可点击切换，保存按钮可见，无横向溢出`);
 }
 await evaluate('ui.closePromptEditor(true)');return results;
};
