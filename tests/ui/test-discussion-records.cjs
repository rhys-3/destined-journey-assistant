const fs = require('node:fs');
const Module = require('node:module');
const assert = require('node:assert/strict');

let source = fs.readFileSync('tests/ui/test-ui.cjs', 'utf8');
const start = source.indexOf('console.log(await evaluate');
const end = source.indexOf("await cdp('Browser.close');", start);
assert(start >= 0 && end > start, 'browser harness markers are missing');
function injectedScenario() { /*
const discussionResults=[];
const discussionCheck=(name,ok)=>{assert(ok,name);discussionResults.push(name);};
const discussionPause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function discussionClick(selector){
  const point=await evaluate('(()=>{const e=ui.shadow.querySelector('+JSON.stringify(selector)+');if(!e)throw Error("Missing "+'+JSON.stringify(selector)+');e.scrollIntoView({block:"center",inline:"nearest"});const r=e.getBoundingClientRect(),hit=ui.shadow.elementFromPoint(r.left+r.width/2,r.top+r.height/2);return {x:r.left+r.width/2,y:r.top+r.height/2,reachable:!!r.width&&!!r.height&&!e.disabled&&(hit===e||e.contains(hit))};})()');
  assert(point.reachable, selector+' is not reachable');
  await cdp('Input.dispatchMouseEvent',{type:'mousePressed',x:point.x,y:point.y,button:'left',clickCount:1});
  await cdp('Input.dispatchMouseEvent',{type:'mouseReleased',x:point.x,y:point.y,button:'left',clickCount:1});
  await discussionPause(90);
}
await evaluate(`(async()=>{
  window.messages=[];window.chatVars={};window.books={};window.globalBooks=[];
  window.getVariables=o=>structuredClone(o?.type==='chat'?chatVars:vars);
  window.replaceVariables=(value,o)=>{if(o?.type==='chat')chatVars=structuredClone(value);else vars=structuredClone(value);};
  window.getWorldbookNames=async()=>Object.keys(books);window.getWorldbook=async n=>structuredClone(books[n]||[]);
  window.getGlobalWorldbookNames=()=>globalBooks;window.rebindGlobalWorldbooks=async n=>{globalBooks=n};
  window.createWorldbook=async(n,v)=>{books[n]=structuredClone(v)};window.createWorldbookEntries=async(n,v)=>books[n].push(...structuredClone(v));window.updateWorldbookWith=async(n,fn)=>{books[n]=await fn(structuredClone(books[n]))};
  window.getLastMessageId=()=>messages.length-1;window.messageReads=[];
  window.getChatMessages=(range)=>{messageReads.push(range);const [from,to=from]=range.split('-').map(Number);return structuredClone(messages.filter(message=>message.message_id>=from&&message.message_id<=to));};
  window.setChatMessages=async updates=>updates.forEach(update=>Object.assign(messages[update.message_id],update));
  window.SillyTavern={getContext:()=>({chatId:'discussion-records-test',characterId:1}),name1:'用户',name2:'角色',POPUP_TYPE:{CONFIRM:2,INPUT:1},POPUP_RESULT:{AFFIRMATIVE:1,CANCELLED:0}};
  window.stopGenerationById=()=>{};
  const discussionExtra={destined_discussion:{version:1,mode:'discussion'}};
  messages.splice(0,messages.length,
    {message_id:0,role:'assistant',name:'叙述者',message:'剧情开端',is_hidden:true},
    ...Array.from({length:35},(_,offset)=>{const id=offset+1;return {message_id:id,role:id%3===0?'user':'assistant',name:id===35?'<img src=x>危险名字':'讨论者'+id,message:id===35?'<discussion_record>危险 <img src=x onerror=alert(1)></discussion_record>':'<discussion_record>讨论原文 '+id+'</discussion_record>',is_hidden:true,extra:discussionExtra};}),
    {message_id:36,role:'assistant',name:'叙述者',message:'剧情衔接',is_hidden:true},
    {message_id:37,role:'assistant',name:'最新讨论',message:'<discussion_record>最新讨论保留</discussion_record>',is_hidden:false,extra:discussionExtra},
  );
  for(const key of Object.keys(chatVars))delete chatVars[key];Object.assign(chatVars,{summary_assistant_worldbook:'讨论验证书',summary_assistant_visibility_auto:true,summary_assistant_auto_hidden_floors:Array.from({length:35},(_,i)=>i+1)});
  for(const key of Object.keys(books))delete books[key];books['讨论验证书']=[{uid:1,name:'总结0-36楼',content:'有效剧情总结'}];
  await ui.summary.apply({...ui.summary.capture(),enabled:false,keepFloorCount:1,batchFloorCount:20,promptBlocks:ui.summary.capture().promptBlocks.map(block=>({...block,enabled:block.choiceGroup==='format'?block.id==='format_free':block.enabled}))});
  window.discussionSettingsBefore=JSON.stringify(ui.summary.capture());
  ui.state.activeTab='summary';ui.render();await new Promise(resolve=>setTimeout(resolve,120));
})()`);
await discussionClick('.sa-tab-item[data-tab="discussion"]');
let state=await evaluate(`(()=>{const root=ui.shadow;return {tab:root.querySelector('.sa-tab-item.active')?.dataset.tab,rows:root.querySelectorAll('[data-discussion-row]').length,pages:root.querySelector('.sa-floor-pages span')?.textContent,text:root.querySelector('[data-discussion-records]')?.textContent,html:root.querySelector('[data-discussion-records]')?.innerHTML};})()`);
discussionCheck('讨论页签按 metadata 筛出记录并倒序分页',state.tab==='discussion'&&state.rows===30&&state.pages==='1 / 2 页'&&state.text.includes('最新讨论保留')&&!state.html.includes('<img src=x>'));
discussionCheck('自动隐藏状态区分讨论与最新保留',state.text.includes('随总结隐藏')&&!state.text.includes('随总结保留'));
await discussionClick('[data-discussion-page="1"]');
state=await evaluate(`({pages:ui.shadow.querySelector('.sa-floor-pages span')?.textContent,first:ui.shadow.querySelector('[data-discussion-row]')?.dataset.discussionRow})`);
discussionCheck('讨论记录每页最多30条并可翻页',state.pages==='2 / 2 页'&&state.first==='6');
await discussionClick('[data-discussion-page="-1"]');
await evaluate(`(()=>{const input=ui.shadow.querySelector('[data-discussion-jump-input]');input.value='35';input.dispatchEvent(new Event('input',{bubbles:true}));})()`);
await discussionClick('[data-discussion-jump]');
state=await evaluate(`({page:ui.shadow.querySelector('.sa-floor-pages span')?.textContent,row:!!ui.shadow.querySelector('[data-discussion-row="35"]')})`);
discussionCheck('按讨论楼层定位',state.page==='1 / 2 页'&&state.row);
await discussionClick('[data-discussion-filter="visibility"]');
await cdp('Input.dispatchKeyEvent',{type:'keyDown',key:'End',code:'End',windowsVirtualKeyCode:35});
await cdp('Input.dispatchKeyEvent',{type:'keyUp',key:'End',code:'End',windowsVirtualKeyCode:35});
await cdp('Input.dispatchKeyEvent',{type:'keyDown',key:'Enter',code:'Enter',windowsVirtualKeyCode:13});
await cdp('Input.dispatchKeyEvent',{type:'keyUp',key:'Enter',code:'Enter',windowsVirtualKeyCode:13});
await discussionPause(80);
state=await evaluate(`({value:ui.shadow.querySelector('[data-discussion-filter="visibility"]').value,rows:ui.shadow.querySelectorAll('[data-discussion-row]').length,unchanged:window.discussionSettingsBefore===JSON.stringify(ui.summary.capture())})`);
discussionCheck('显示状态筛选不触发总结设置保存',state.value==='hidden'&&state.rows===30&&state.unchanged);
await evaluate(`(()=>{const select=ui.shadow.querySelector('[data-discussion-filter="visibility"]');select.value='all';select.dispatchEvent(new Event('change',{bubbles:true}));})()`);
await discussionClick('[data-discussion-jump]');
await discussionClick('[data-discussion-mutate="show"][data-discussion-id="35"]');
await discussionPause(160);
state=await evaluate(`({auto:chatVars.summary_assistant_visibility_auto,override:chatVars.summary_assistant_visibility_overrides?.[35],hidden:messages[35].is_hidden,text:ui.shadow.querySelector('[data-discussion-records]').textContent})`);
discussionCheck('单条显示只写讨论选择并保持全局自动开启',state.auto===true&&state.override?.scope==='discussion'&&state.override?.hidden===false&&!state.hidden&&state.text.includes('手动显示'));
await discussionClick('[data-discussion-mutate="auto"][data-discussion-id="35"]');
await discussionPause(180);
state=await evaluate(`({auto:chatVars.summary_assistant_visibility_auto,override:chatVars.summary_assistant_visibility_overrides?.[35],hidden:messages[35].is_hidden})`);
discussionCheck('恢复自动清除讨论选择并重新按覆盖隐藏',state.auto===true&&!state.override&&state.hidden);
await discussionClick('[data-discussion-select-page]');
await discussionClick('[data-discussion-batch="show"]');
await discussionPause(180);
state=await evaluate(`({auto:chatVars.summary_assistant_visibility_auto,selected:ui.shadow.querySelector('[data-discussion-selection]').textContent,manual:Object.values(chatVars.summary_assistant_visibility_overrides||{}).filter(value=>value.scope==='discussion'&&value.hidden===false).length})`);
discussionCheck('当前页可批量显示且不暂停自动',state.auto===true&&state.selected.includes('已选 0 条')&&state.manual===30);
await discussionClick('[data-discussion-select-page]');
await discussionClick('[data-discussion-batch="auto"]');
await discussionPause(180);
state=await evaluate(`({auto:chatVars.summary_assistant_visibility_auto,manual:Object.values(chatVars.summary_assistant_visibility_overrides||{}).filter(value=>value.scope==='discussion').length})`);
discussionCheck('当前页可批量恢复自动',state.auto===true&&state.manual===0);
await discussionClick('[data-discussion-view="35"]');
await discussionPause(80);
state=await evaluate(`(()=>{const dialog=ui.shadow.querySelector('.dj-dialog textarea');return {safe:dialog?.value.includes('<img src=x onerror=alert(1)>'),markup:!!ui.shadow.querySelector('.dj-dialog img'),lastRead:messageReads.at(-1)};})()`);
discussionCheck('查看原文通过安全文本窗口呈现且只读选中楼层',state.safe&&!state.markup&&state.lastRead==='35');
await discussionClick('.dj-dialog-actions button:last-child');
await discussionClick('.sa-tab-item[data-tab="status"]');
await evaluate(`(()=>{messages.push(...Array.from({length:20},(_,i)=>({message_id:38+i,role:'assistant',message:'<gametxt>后续剧情 '+i+'</gametxt>',is_hidden:false})));window.generateRaw=()=>new Promise(resolve=>window.discussionFinish=resolve);ui.shadow.querySelector('#sa-start-summary').click();})()`);
await discussionPause(100);
await discussionClick('.sa-tab-item[data-tab="discussion"]');
state=await evaluate(`({mutating:[...ui.shadow.querySelectorAll('[data-discussion-mutate]')].every(button=>button.disabled),view:ui.shadow.querySelector('[data-discussion-view]')?.disabled===false,filter:ui.shadow.querySelector('[data-discussion-filter]')?.disabled===false,pending:typeof discussionFinish==='function'})`);
discussionCheck('总结忙碌时禁用讨论修改但保留查看和筛选',state.mutating&&state.view&&state.filter&&state.pending);
await evaluate(`window.discussionFinish?.('<summary_result>结束忙碌测试</summary_result>')`);await discussionPause(1200);
state=await evaluate(`[...ui.shadow.querySelectorAll('[data-discussion-mutate]')].some(button=>!button.disabled)`);
discussionCheck('忙碌结束后讨论修改按钮解除禁用',state);
for(const width of [390,320]){
  await cdp('Emulation.setDeviceMetricsOverride',{width,height:844,screenWidth:width,screenHeight:844,deviceScaleFactor:1,mobile:true});
  await evaluate(`ui.state.activeTab='summary';ui.render();ui.shadow.querySelector('.sa-tab-item[data-tab="discussion"]').click()`);await discussionPause(100);
  state=await evaluate(`(()=>{const root=ui.shadow.querySelector('.content');return {overflow:root.scrollWidth>root.clientWidth+1,tabs:ui.shadow.querySelector('.sa-tabs').scrollWidth>ui.shadow.querySelector('.sa-tabs').clientWidth,compact:getComputedStyle(ui.shadow.querySelector('.sa-generation-actions')).display==='none'};})()`);
  discussionCheck(width+'px讨论页精简生成控件、整体无横向溢出且页签可横滑',!state.overflow&&state.tabs&&state.compact);
  const shot=await cdp('Page.captureScreenshot',{format:'png'});fs.writeFileSync('.ui-review/discussion-records-'+width+'.png',Buffer.from(shot.data,'base64'));
}
await evaluate(`(async()=>{messages.splice(0);for(const key of Object.keys(chatVars))delete chatVars[key];for(const key of Object.keys(books))delete books[key];ui.render();await new Promise(resolve=>setTimeout(resolve,100));})()`);
await discussionClick('.sa-tab-item[data-tab="discussion"]');
state=await evaluate(`ui.shadow.querySelector('[data-discussion-records]').textContent`);
discussionCheck('无世界书和空聊天显示空讨论列表',state.includes('没有符合筛选条件的讨论记录'));
fs.writeFileSync('.ui-review/discussion-records-results.json',JSON.stringify(discussionResults,null,2));
console.log(discussionResults);
*/ }
const scenarioSource = injectedScenario.toString();
const scenario = scenarioSource.slice(scenarioSource.indexOf('/*') + 2, scenarioSource.lastIndexOf('*/')).trim();
source = (source.slice(0,start)+scenario+'\n'+source.slice(end)).replaceAll('.ui-review/preview.html', '.ui-review/discussion-records-preview.html').replace("path.resolve('.ui-review/chrome-profile')", "path.resolve('.ui-review/chrome-discussion-records-final-profile')");
const runner = new Module(__filename, module);
runner.filename = __filename;
runner.paths = module.paths;
runner._compile(source, __filename);
