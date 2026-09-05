module.exports=async(cdp,evaluate)=>{
 const assert=require('node:assert/strict'),results=[];
 const key='destined-settings-ui:a980269e-8d77-4f5e-bad7-b2fe0a2cd470';
 const reload=async()=>{await evaluate('window.transparencyReloadPending=true');await cdp('Page.reload');for(let i=0;i<50;i++){if(await evaluate('!window.transparencyReloadPending&&!!window.ui?.shadow?.querySelector(".panel")')){await evaluate('ui.shadow.querySelector("[data-tab=settings]").click()');return;}await new Promise(r=>setTimeout(r,100));}throw Error('面板未加载');};
 await evaluate(`localStorage.setItem('${key}','{"theme":"midnight"}')`);await reload();
 assert.equal(await evaluate('ui.shadow.querySelector("[data-action=ui-transparency]").value'),'1');
 assert(await evaluate(`!ui.shadow.textContent.includes('旅程')&&ui.shadow.querySelector('.eyebrow').textContent==='DESTINED JOURNEY'&&!getComputedStyle(ui.shadow.querySelector('.tabs'),'::before').content.includes('旅程')`));
 results.push('未设定时默认透明度1%，保留DESTINED JOURNEY与中文文案修正');
 const before=await evaluate('JSON.stringify({data,stored,vars})');
 await evaluate('window.retainedContent=ui.shadow.querySelector(".content");window.transparencyWrites=0;window.originalStorageWrite=Storage.prototype.setItem;Storage.prototype.setItem=function(...args){transparencyWrites++;return originalStorageWrite.apply(this,args)}');
 const set=async(value,event)=>evaluate(`(()=>{const s=ui.shadow.querySelector('[data-action="ui-transparency"]');s.value=${value};s.dispatchEvent(new Event('${event}',{bubbles:true}));return getComputedStyle(ui.shadow.querySelector('.panel')).backgroundColor})()`);
 assert.equal(await set(0,'input'),'rgb(16, 20, 18)');
 assert.equal(await set(30,'input'),'rgba(16, 20, 18, 0.9)');
 assert.equal(await evaluate('transparencyWrites'),0);
 assert(await evaluate('retainedContent===ui.shadow.querySelector(".content")'));
 assert.equal(await set(6,'change'),'rgba(16, 20, 18, 0.94)');
 assert.equal(await evaluate('transparencyWrites'),1);
 assert.equal(await evaluate('ui.shadow.querySelector("[data-transparency-value]").textContent'),'6%');
 assert.equal(await evaluate('JSON.stringify({data,stored,vars})'),before);
 results.push('0%完全不透明，上限10%；拖动不重建内容、不写存储，松开只保存一次且不修改预设');
 await evaluate(`Storage.prototype.setItem=originalStorageWrite;const s=ui.shadow.querySelector('[data-action="ui-theme"]');s.value='forest';s.dispatchEvent(new Event('change',{bubbles:true}));ui.closePanel();ui.openPanel()`);
 await reload();
 assert.equal(await evaluate('getComputedStyle(ui.shadow.querySelector(".panel")).backgroundColor'),'rgba(18, 32, 28, 0.94)');
 // Use the native keyboard interaction to exercise the actual range control.
 await evaluate('ui.shadow.querySelector("[data-action=ui-transparency]").focus()');
 await cdp('Input.dispatchKeyEvent',{type:'keyDown',key:'ArrowRight',code:'ArrowRight',windowsVirtualKeyCode:39});
 await cdp('Input.dispatchKeyEvent',{type:'keyUp',key:'ArrowRight',code:'ArrowRight',windowsVirtualKeyCode:39});
 assert.equal(await evaluate('ui.shadow.querySelector("[data-action=ui-transparency]").value'),'7');
 results.push('主题切换、关闭重开及刷新后保留透明度，键盘方向键可调节');
 await evaluate(`Storage.prototype.setItem=function(){throw Error('storage unavailable')}`);
 await set(8,'change');await evaluate('ui.closePanel();ui.openPanel()');
 assert.equal(await evaluate('ui.shadow.querySelector("[data-action=ui-transparency]").value'),'8');
 await reload();
 for(const value of ['bad',-1,200,null]){
  await evaluate(`localStorage.setItem('${key}',JSON.stringify({theme:'midnight',transparency:${JSON.stringify(value)}}))`);await reload();
  assert.equal(await evaluate('ui.shadow.querySelector("[data-action=ui-transparency]").value'),'1');
 }
 results.push('存储不可用仍可调节；非法透明度安全回退为1%');
 await evaluate(`localStorage.setItem('${key}','{"theme":"midnight","transparency":27}')`);await reload();
 assert.equal(await evaluate('ui.shadow.querySelector("[data-action=ui-transparency]").value'),'10');
 results.push('旧版保存的较高透明度自动限制到10%');
 return results;
};
