module.exports=async(cdp,evaluate)=>{
 const fs=require('node:fs'),assert=require('node:assert/strict'),results=[];
 const setTheme=id=>evaluate(`(()=>{if(ui.state.promptEditor)ui.closePromptEditor(true);if(ui.state.activeTab!=='settings'){ui.state.activeTab='settings';ui.render();}const e=ui.shadow.querySelector('[data-action="ui-theme"]');e.value=${JSON.stringify(id)};e.dispatchEvent(new Event('change',{bubbles:true}));})()`);
 await evaluate('ui.closePromptEditor(true);ui.state.editorUnlocked=true;ui.render()');
 const entryChecks=await evaluate(`(()=>{
  const excluded=['models','streaming','entry-points'];
  for(const page of ui.authorLayout().pages){
   ui.state.activeTab=page.id;ui.render();
   for(const block of ui.authorLayout().blocks.filter(b=>b.page===page.id&&!b.hidden&&b.id!=='entry-points')){
    const section=ui.shadow.querySelector('[data-placement-block="'+block.id+'"]');
    const add=section.querySelector('[data-action="entry-new-here"],[data-action="new-style"]');
    if(!!add===excluded.includes(block.id))throw Error('错误的新增入口: '+block.id);
   }
  }
  ui.state.activeTab='tools';ui.render();
  if(!ui.shadow.textContent.includes('新增自定义模型'))throw Error('自定义模型入口丢失');
  if(ui.shadow.querySelector('.entry-point-card'))throw Error('入口不应留在模型工具页');
  ui.shadow.querySelector('[data-tab="settings"]').click();
  if(!ui.shadow.querySelector('.entry-point-card')||!ui.shadow.querySelector('.appearance-card')||ui.shadow.querySelector('.panel-head [data-action="ui-theme"]'))throw Error('设置页迁移不完整');
  if(ui.shadow.querySelectorAll('.tabs button').length!==6)throw Error('设置导航缺失');
  const root=ui.shadow, panel=root.querySelector('.panel'), frame=getComputedStyle(panel,'::after');
  if(frame.content!=='none')throw Error('不应恢复装饰外框');
  const paint=getComputedStyle(panel);
  if(!paint.backgroundColor.startsWith('rgba(')||paint.opacity!=='1'||!paint.backgroundImage.includes('gradient'))throw Error('微透渐变底层异常');
  if([...root.querySelectorAll('*')].some(e=>{const s=getComputedStyle(e);return s.backdropFilter!=='none'||s.filter!=='none'||s.animationName!=='none';}))throw Error('出现高负载视觉效果');
  return true;
 })()`);
 assert(entryChecks);
 results.push('编辑模式仅移除三个专用控件板块的新增条目，保留其余新增与自定义模型入口');
 results.push('移除装饰外框，微透渐变底层保留文字不透明；无模糊滤镜或常驻动画');
 await evaluate('ui.state.editorUnlocked=false;ui.state.activeTab="daily";ui.render()');
 const before=await evaluate('JSON.stringify({data,stored,vars})');
 for(const theme of ['midnight','forest','ember','parchment']){
  await setTheme(theme);
  assert.equal(await evaluate('ui.shadow.querySelector(".destined-root").dataset.theme'),theme);
  for(const [width,height] of [[1280,960],[768,1024],[390,844],[320,640],[844,390]]){
   await cdp('Emulation.setDeviceMetricsOverride',{width,height,screenWidth:width,screenHeight:height,deviceScaleFactor:1,mobile:width<720||height<500});
   for(const tab of ['daily','style','tools','configurations','settings','advanced','editor']){
    await evaluate(`ui.closePromptEditor(true);ui.state.activeTab=${JSON.stringify(tab==='editor'?'advanced':tab)};ui.render();${tab==='editor'?'ui.openPromptEditor(ui.IDS.eventChain);':''}`);
    await new Promise(r=>setTimeout(r,35));
    const bounds=await evaluate(`(()=>{const root=ui.shadow,p=root.querySelector('.panel').getBoundingClientRect();const containers=[...root.querySelectorAll('.content,.panel-head,.head-actions,.configuration-shortcut,.prompt-editor-body')];return{outside:p.left<0||p.top<0||p.right>innerWidth+1||p.bottom>innerHeight+1,overflow:containers.filter(e=>e.scrollWidth>e.clientWidth+1).map(e=>e.className),space:root.querySelector('.content').clientHeight}})()`);
    assert(!bounds.outside&&!bounds.overflow.length&&bounds.space>=90,JSON.stringify({theme,width,height,tab,bounds}));
    if((width===1280||width===390)&&tab==='style'){
     const shot=await cdp('Page.captureScreenshot',{format:'png'});fs.writeFileSync('.ui-review/theme-'+theme+'-'+width+'.png',Buffer.from(shot.data,'base64'));
    }
    if((width===1280||width===390)&&tab==='settings'&&theme==='midnight'){
     const shot=await cdp('Page.captureScreenshot',{format:'png'});fs.writeFileSync('.ui-review/settings-'+width+'.png',Buffer.from(shot.data,'base64'));
    }
   }
  }
  results.push(theme+': 七个页面 × 五种屏幕尺寸，无内容溢出');
 }
 await evaluate('ui.closePromptEditor(true);ui.state.activeTab="daily";ui.render()');
 assert.equal(await evaluate('JSON.stringify({data,stored,vars})'),before,'切换外观不得写入预设与脚本配置');
 results.push('主题切换不改变提示词、模型与已保存的配置');
 await evaluate(`ui.state.activeTab='settings';ui.render();new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))`);
 await evaluate(`(()=>{const root=ui.shadow,c=root.querySelector('.content');window.oldContent=c;window.oldControl=root.querySelector('[data-action="ui-transparency"]');oldControl.focus({preventScroll:true});c.scrollTop=200;window.oldScroll=c.scrollTop;})()`);
 await setTheme('forest');
 assert(await evaluate('oldContent===ui.shadow.querySelector(".content")&&oldContent.scrollTop===oldScroll&&oldControl===ui.shadow.activeElement'),await evaluate('JSON.stringify({sameContent:oldContent===ui.shadow.querySelector(".content"),scroll:oldContent.scrollTop,oldScroll,focused:ui.shadow.activeElement?.outerHTML,connected:oldControl.isConnected})'));
 results.push('设置页即时切换保留滚动与焦点，不重建内容');
 await evaluate('ui.closePanel();ui.openPanel()');
 assert.equal(await evaluate('ui.shadow.querySelector("[data-action=ui-theme]").value'),'forest');
 await cdp('Page.reload');
 for(let i=0;i<50;i++){if(await evaluate('!!window.ui?.shadow?.querySelector(".panel")'))break;await new Promise(r=>setTimeout(r,100));}
 assert.equal(await evaluate('ui.shadow.querySelector(".destined-root").dataset.theme'),'forest');
 results.push('关闭重开与完整刷新后恢复本机主题');
 // Local storage payloads from old versions or invalid data must safely fall back.
 await evaluate(`globalThis.__destinedJourneyAssistant.destroy();localStorage.setItem('destined-settings-ui:a980269e-8d77-4f5e-bad7-b2fe0a2cd470','{"theme":"unknown"}')`);
 await cdp('Page.reload');
 for(let i=0;i<50;i++){if(await evaluate('!!window.ui?.shadow?.querySelector(".panel")'))break;await new Promise(r=>setTimeout(r,100));}
 assert.equal(await evaluate('ui.shadow.querySelector(".destined-root").dataset.theme'),'midnight');
 results.push('未知主题安全回退到曜石黑金');
 await evaluate(`window.realSetItem=Storage.prototype.setItem;Storage.prototype.setItem=function(){throw new DOMException('quota','QuotaExceededError')}`);
 await setTheme('parchment');
 await evaluate('ui.closePanel();ui.openPanel()');
 assert.equal(await evaluate('ui.shadow.querySelector(".destined-root").dataset.theme'),'parchment');
 assert(await evaluate('window.errors.length===0'),await evaluate('JSON.stringify(errors)'));
 await evaluate('Storage.prototype.setItem=window.realSetItem');
 results.push('存储拒绝写入时仍可切换、关闭重开，无异常');
 await cdp('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});
 assert(await evaluate(`[...ui.shadow.querySelectorAll('*')].every(e=>getComputedStyle(e).animationName==='none'&&getComputedStyle(e).transitionDuration==='0s')`));
 results.push('遵循减少动态效果偏好；无模糊滤镜、无常驻动画');
 await cdp('Emulation.setDeviceMetricsOverride',{width:1280,height:960,screenWidth:1280,screenHeight:960,deviceScaleFactor:1,mobile:false});
 await evaluate('ui.render();ui.shadow.querySelector(".panel").style.width="620px"');
 const narrow=await evaluate(`[...ui.shadow.querySelectorAll('.panel-head,.head-actions,.content')].filter(e=>e.scrollWidth>e.clientWidth+1).map(e=>e.className)`);
 assert(!narrow.length, '桌面窗口缩至620px不得溢出: '+narrow.join(','));
 results.push('桌面拖动缩至620px仍可完整使用');
 results.push(...await require('./transparency-tests.cjs')(cdp,evaluate));
 fs.writeFileSync('.ui-review/theme-test-results.json',JSON.stringify(results,null,2));return results;
};
