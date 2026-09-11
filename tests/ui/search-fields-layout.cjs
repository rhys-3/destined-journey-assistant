module.exports=async(cdp,evaluate)=>{
 const fs=require('node:fs'),assert=require('node:assert/strict'),results=[];
 await evaluate(`window.searchFieldsLayoutBefore={data:structuredClone(data),stored:structuredClone(stored),filter:ui.state.entryFilter,search:ui.state.search,searchFields:structuredClone(ui.state.searchFields),unlocked:ui.state.editorUnlocked,tab:ui.state.activeTab};data.prompts.push({id:'search-fields-layout-needle',name:'布局名称',content:'布局正文针',enabled:true,role:'system',position:{type:'relative'},extra:{destined_ui:{descriptions:{description:'布局简介'}}}});stored=structuredClone(data);ui.reconcilePreset('search fields layout fixtures');ui.state.activeTab='advanced';ui.state.entryFilter='all';ui.state.search='';ui.state.searchFields=['name'];ui.state.editorUnlocked=true;ui.renderActiveContent();`);
 try{
  for(const [label,width,height] of [['desktop',1280,960],['mobile',320,640]]){
   await cdp('Emulation.setDeviceMetricsOverride',{width,height,screenWidth:width,screenHeight:height,deviceScaleFactor:1,mobile:width===320});
   await evaluate(`ui.state.activeTab='advanced';ui.state.search='';ui.state.searchFields=['name'];ui.state.editorUnlocked=true;ui.renderActiveContent();ui.shadow.querySelector('.entry-search-fields').scrollIntoView({block:'center'});new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))`);
   const inputPos=await evaluate(`(()=>{const r=ui.shadow.querySelector('[data-action="search"]').getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})()`);
   await cdp('Input.dispatchMouseEvent',{type:'mousePressed',...inputPos,button:'left',clickCount:1});await cdp('Input.dispatchMouseEvent',{type:'mouseReleased',...inputPos,button:'left',clickCount:1});
   await cdp('Input.dispatchKeyEvent',{type:'rawKeyDown',key:'a',code:'KeyA',windowsVirtualKeyCode:65,modifiers:2});await cdp('Input.dispatchKeyEvent',{type:'keyUp',key:'a',code:'KeyA',windowsVirtualKeyCode:65,modifiers:2});await cdp('Input.insertText',{text:'布局正文针'});
   await evaluate(`window.searchFieldsInputBefore=ui.shadow.querySelector('[data-action="search"]');new Promise(r=>requestAnimationFrame(r))`);
   const contentPos=await evaluate(`(()=>{const r=ui.shadow.querySelector('[data-action="search-field"][data-value="content"]').getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})()`);
   await cdp('Input.dispatchMouseEvent',{type:'mousePressed',...contentPos,button:'left',clickCount:1});await cdp('Input.dispatchMouseEvent',{type:'mouseReleased',...contentPos,button:'left',clickCount:1});
   let state=await evaluate(`(()=>{const s=ui.shadow,c=s.querySelector('.content'),g=s.querySelector('.entry-search-fields'),input=s.querySelector('[data-action="search"]');return{sameInput:input===window.searchFieldsInputBefore,value:input.value,buttonFocus:s.activeElement===s.querySelector('[data-action="search-field"][data-value="content"]'),selected:ui.state.searchFields.join(','),matched:[...s.querySelectorAll('[data-entry-results] [data-action="prompt-open"]')].some(e=>e.dataset.id==='search-fields-layout-needle'),overflow:c.scrollWidth>c.clientWidth+1||g.scrollWidth>g.clientWidth+1}})()`);
   assert(state.sameInput&&state.value==='布局正文针'&&state.buttonFocus&&state.selected==='name,content'&&state.matched&&!state.overflow,JSON.stringify({label,state}));
   await cdp('Input.dispatchKeyEvent',{type:'rawKeyDown',key:' ',code:'Space',windowsVirtualKeyCode:32});await cdp('Input.dispatchKeyEvent',{type:'keyUp',key:' ',code:'Space',windowsVirtualKeyCode:32});
   state=await evaluate(`(()=>({selected:ui.state.searchFields.join(','),matched:[...ui.shadow.querySelectorAll('[data-entry-results] [data-action="prompt-open"]')].some(e=>e.dataset.id==='search-fields-layout-needle')}))()`);
   assert(state.selected==='name'&&!state.matched,JSON.stringify({label,state}));
   const shot=await cdp('Page.captureScreenshot',{format:'png'});fs.writeFileSync(`.ui-review/search-fields-${label}.png`,Buffer.from(shot.data,'base64'));
   results.push(`${label} 搜索字段真实鼠标、键盘交互与无横向溢出通过`);
  }
 }finally{await evaluate(`data=searchFieldsLayoutBefore.data;stored=searchFieldsLayoutBefore.stored;ui.state.entryFilter=searchFieldsLayoutBefore.filter;ui.state.search=searchFieldsLayoutBefore.search;ui.state.searchFields=searchFieldsLayoutBefore.searchFields;ui.state.editorUnlocked=searchFieldsLayoutBefore.unlocked;ui.state.activeTab=searchFieldsLayoutBefore.tab;delete window.searchFieldsInputBefore;delete window.searchFieldsLayoutBefore;ui.reconcilePreset('search fields layout restored');ui.renderActiveContent();`);await cdp('Emulation.setDeviceMetricsOverride',{width:1280,height:960,screenWidth:1280,screenHeight:960,deviceScaleFactor:1,mobile:false});}
 return results;
};
