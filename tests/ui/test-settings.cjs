const fs=require('node:fs'),Module=require('node:module');
let source=fs.readFileSync('tests/ui/test-ui.cjs','utf8');
const start=source.indexOf('console.log(await evaluate'),end=source.indexOf("await cdp('Browser.close');",start);
if(start<0||end<start)throw Error('Harness markers changed');
const run=async(cdp,evaluate)=>{
 await evaluate(`ui.state.config.entry_points={floating_orb:true,input_button:false,wand_menu:false};ui.render();ui.shadow.querySelector('[data-tab="settings"]').click()`);
 assert(await evaluate(`ui.state.activeTab==='settings'&&!!ui.shadow.querySelector('.entry-point-card')&&!ui.shadow.querySelector('.panel-head .appearance-controls')`));
 await evaluate(`ui.shadow.querySelector('[data-key="entry:input_button"]').click();ui.settle()`);
 assert(await evaluate('ui.state.config.entry_points.input_button'));
 await evaluate(`ui.shadow.querySelector('[data-key="entry:floating_orb"]').click();ui.settle()`);
 assert(await evaluate('!ui.state.config.entry_points.floating_orb'));
 await evaluate(`ui.shadow.querySelector('[data-key="entry:input_button"]').click();ui.settle()`);
 assert(await evaluate('Object.values(ui.state.config.entry_points).some(Boolean)'));
 await evaluate(`ui.shadow.querySelector('[data-key="entry:floating_orb"]').click();ui.settle()`);
 assert(await evaluate('ui.state.config.entry_points.floating_orb'));
 console.log('设置页入口开关可保存，最后一个入口不能被关闭');
 for(const theme of ['midnight','forest','ember','parchment']){
  await evaluate(`(()=>{ui.state.activeTab='settings';ui.render();const t=ui.shadow.querySelector('[data-action="ui-theme"]');t.value='${theme}';t.dispatchEvent(new Event('change',{bubbles:true}));const s=ui.shadow.querySelector('[data-action="ui-transparency"]');s.value=10;s.dispatchEvent(new Event('change',{bubbles:true}));})()`);
  for(const [width,height] of [[1280,960],[390,844]]){
   await cdp('Emulation.setDeviceMetricsOverride',{width,height,screenWidth:width,screenHeight:height,deviceScaleFactor:1,mobile:width<720});
   for(const group of ['base-tone','main-style']){
    await evaluate(`ui.state.editorUnlocked=true;ui.state.activeTab='style';ui.render();ui.shadow.querySelector('[data-action="new-style"][data-group="${group}"]').click()`);
    const paint=await evaluate(`(()=>{const e=ui.shadow.querySelector('.style-editor'),s=getComputedStyle(e),r=e.getBoundingClientRect();return{color:s.backgroundColor,image:s.backgroundImage,opacity:s.opacity,overflow:e.scrollWidth>e.clientWidth+1,outside:r.left<0||r.right>innerWidth+1||r.top<0||r.bottom>innerHeight+1}})()`);
    assert(paint.color.startsWith('rgb(')&&paint.image==='none'&&paint.opacity==='1'&&!paint.overflow&&!paint.outside,JSON.stringify({theme,width,group,paint}));
    if(theme==='midnight'&&group==='base-tone'){
     const shot=await cdp('Page.captureScreenshot',{format:'png'});fs.writeFileSync('.ui-review/opaque-style-'+width+'.png',Buffer.from(shot.data,'base64'));
    }
    await evaluate(`ui.shadow.querySelector('[data-action="cancel-style"]').click()`);
    assert(await evaluate(`!ui.shadow.querySelector('.style-editor')`));
   }
  }
 }
 console.log('四套主题 × 双端：新增基调、主文风弹窗在最大透明度下仍完全不透明，可正常关闭，无溢出');
};
source=source.slice(0,start)+`await (${run.toString()})(cdp,evaluate);\n`+source.slice(end);
source=source.replaceAll('.ui-review/preview.html','.ui-review/settings-preview.html').replace("path.resolve('.ui-review/chrome-profile')","path.resolve('.ui-review/chrome-settings-profile')");
const runner=new Module(__filename,module);runner.filename=__filename;runner.paths=module.paths;runner._compile(source,__filename);
