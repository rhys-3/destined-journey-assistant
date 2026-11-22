import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import variableMocks from './helpers/tavern-variables.cjs';
import { DEFAULT_SETTINGS, DEFAULT_EXCLUDE_TAGS, CONFIG } from '../src/summary/config.js';
import { summarySnapshot } from '../src/summary/settingsSchema.js';
import { writePresetStore, patchSummaryStore } from '../src/platform/store.js';
import { configureRuntime, captureContext, checkContext, contextKey, invalidate, runAction, isBusy, setRuntimeEnabled } from '../src/platform/lifecycle.js';
import { loadSettings, saveSettings, getSettings, updateSettings, getKeyForUrl, migrateOldSettings } from '../src/summary/storage.js';
import { ADAPTER_PROMPTS, PREVIOUS_ARCHIVE_PROMPTS, PREVIOUS_COMPACT_PROMPTS, PREVIOUS_V4_PROMPTS, THINKING_TEMPLATES, PREFILLS, buildArchivePromptBlocks, optionBlocks, activeResultFormat } from '../src/summary/archiveDefaults.js';
import { PRESET_PROMPTS } from '../src/summary/presetDefaults.js';
import { readPromptFile } from '../src/summary/ui/promptTools.js';
import { deleteBoundSummaryBook, getManagedSummaryBookNames } from '../src/summary/worldbook.js';
import { computeSummaryPlan, computeSummaryPlans, computeSummaryPreview, shouldAutoTrigger, executeSummary, finalizeMegaSummarySave, regenerateAndReplaceEntry, startSummaryProcess, startCustomRangeSummaryProcess, skipPendingTask } from '../src/summary/summary.js';
import { callSummaryApi, callMegaSummaryApi, testConnection } from '../src/summary/api.js';
import { extractTagContent, processMessagesByTags } from '../src/summary/messages.js';
import { upsertSummaryEntryByName, upsertMegaSummaryEntry, restoreMegaSummaryToSummaries, activateMegaSummaryEntry, applySummarizedFloorsVisibility, writeChatWorldbookBinding, migrateWorldbookEntries, getAllSummaryEntriesForDisplay } from '../src/summary/worldbook.js';
import { migrate } from '../src/summary/service.js';
import { reconcileChatBinding, getActiveWorldbookName } from '../src/summary/worldbook.js';
import { extractSummaryResult, IncompleteSummaryError } from '../src/summary/result.js';
import { getTask, stopTask, detachTaskState, restoreTaskState, clearTaskLog, beginTask, updateTask, finishTask, selectTaskBatch } from '../src/summary/taskState.js';
import { retryTask, autoTriggerSummary, computeMegaPlan, executeMegaSummary } from '../src/summary/summary.js';
import { getCoverage, getAllSummaryContents, auditArchiveSources, bindWorldbookToChat, deleteSummaryEntry, setSummaryEntryEnabled } from '../src/summary/worldbook.js';
import { ARCHIVE_VAR_KEY, fingerprint, readArchive, currentSources, sourceOf } from '../src/summary/provenance.js';
import { expandMacros, compilePrompt } from '../src/summary/macros.js';
import { buildRegeneratePromptParams, buildSummaryPromptParams } from '../src/summary/prompt.js';
import { setFloorVisibilityAutomation, readVisibilityAutomation, VISIBILITY_AUTOMATION_KEY } from '../src/summary/visibility.js';

// Task lifecycle tests use a custom body; strict default formats are tested separately.
const withOptions=(settings,options)=>({...structuredClone(settings),...Object.fromEntries(['promptBlocks','megaPromptBlocks'].map(key=>[key,settings[key].map(block=>optionBlocks(options).find(option=>option.id===block.id)??structuredClone(block))]))});
const FLOW_SETTINGS = withOptions(DEFAULT_SETTINGS,{resultFormat:'free'});
let script,chat,books,messages,globals,ctx,reports;
function reset() {
  if(typeof globalThis.getVariables==='function')detachTaskState();
  script={};chat={};books={};globals=[];messages=[];ctx={chatId:'a',characterId:1};reports=[];
  globalThis.SillyTavern={getContext:()=>ctx,name1:'User',name2:'Character',POPUP_TYPE:{INPUT:1,CONFIRM:2},POPUP_RESULT:{AFFIRMATIVE:1,CANCELLED:0}};
  globalThis.getLoadedPresetName=()=> '命定';
  globalThis.getVariables=option=>structuredClone(option.type==='chat'?chat:script);
  globalThis.replaceVariables=(value,option)=>{if(option.type==='chat')chat=structuredClone(value);else script=structuredClone(value);};
  globalThis.insertOrAssignVariables=(value,option)=>{const next=variableMocks.mergeTavernVariables(getVariables(option),value);replaceVariables(next,option);return next;};
  globalThis.getWorldbookNames=async()=>Object.keys(books);
  globalThis.getGlobalWorldbookNames=()=>[...globals];
  globalThis.rebindGlobalWorldbooks=async names=>{globals=[...names];};
  globalThis.createWorldbook=async(name,entries)=>{books[name]=structuredClone(entries);};
  globalThis.getWorldbook=async name=>structuredClone(books[name]);
  globalThis.updateWorldbookWith=async(name,fn)=>{books[name]=await fn(structuredClone(books[name]));};
  globalThis.createWorldbookEntries=async(name,entries)=>{books[name].push(...structuredClone(entries));};
  globalThis.replaceWorldbook=async(name,entries)=>{books[name]=structuredClone(entries);};
  globalThis.deleteWorldbook=async name=>{delete books[name];};
  globalThis.getLastMessageId=()=>messages.length-1;
  globalThis.getChatMessages=(range,options={})=>{
    const [start,end]=range.split('-').map(Number);
    return structuredClone(messages.filter(m=>m.message_id>=start&&m.message_id<=end&&(options.hide_state!=='hidden'||m.is_hidden)));
  };
  globalThis.setChatMessages=async updates=>{for(const update of updates)Object.assign(messages[update.message_id],update);};
  globalThis.toastr={info(){},success(){},warning(){},error(){}};
  const events=new Map();
  globalThis.eventRemoveListener=(name,fn)=>events.set(name,(events.get(name)??[]).filter(listener=>listener!==fn));
  globalThis.eventMakeLast=(name,fn)=>{eventRemoveListener(name,fn);events.set(name,[...(events.get(name)??[]),fn]);};
  globalThis.summaryReady=async data=>{for(const fn of events.get('chat_completion_settings_ready')??[])await fn(data);return JSON.parse(JSON.stringify(data));};
  delete globalThis.getScriptTrees;delete globalThis.updateScriptTreesWith;
  configureRuntime({status:(...args)=>reports.push(args),popup:async()=>null,chooseFailure:async()=> 'cancel'});
  invalidate();setRuntimeEnabled(false);writeChatWorldbookBinding('book');books.book=[];restoreTaskState();
}
test.beforeEach(reset);

test('summary snapshots use a whitelist, including prompt block fields',()=>{
  const input={...structuredClone(DEFAULT_SETTINGS),customApiKey:'secret',worldbookName:'private',record:'private'};
  input.promptBlocks[0].apiKey='nested-secret';
  const output=summarySnapshot(input);assert(!JSON.stringify(output).includes('secret'));assert(!('worldbookName' in output));
  assert.throws(()=>summarySnapshot({...input,keepFloorCount:30}),/小于/);
  assert.throws(()=>summarySnapshot({...input,promptBlocks:[input.promptBlocks[0],input.promptBlocks[0]]}),/重复/);
});
test('script writes preserve the latest summary and secret namespaces',async()=>{
  await saveSettings({...FLOW_SETTINGS,customApiKey:'secret',triggerFloorCount:40});
  const stale={...script};await saveSettings({...getSettings(),triggerFloorCount:50});
  writePresetStore({...stale,managed_values:{min_hanzi:'2000'}});
  assert.equal(script.summary_assistant_settings.triggerFloorCount,50);assert.equal(script.summary_assistant_secrets.keysByUrl[''],'secret');
  assert(!Object.hasOwn(script.summary_assistant_settings,'customApiKey'));
});
test('failed settings writes propagate and keep the previous in-memory values',async()=>{
  await saveSettings(DEFAULT_SETTINGS);const previous=getSettings();
  globalThis.replaceVariables=()=>{throw Error('disk failed');};
  await assert.rejects(saveSettings({...previous,triggerFloorCount:45}),/disk failed/);assert.deepEqual(getSettings(),previous);
});
test('legacy migration preserves enabled state and custom prompts, once only',async()=>{
  const legacy={id:'3eb6e3eb-7a14-47dc-900c-759cd2f0bf64',enabled:true,data:{summary_assistant_settings:{...DEFAULT_SETTINGS,userPrefix:'旧用户',customApiKey:'old-secret'}}};
  globalThis.getScriptTrees=()=>[legacy];globalThis.updateScriptTreesWith=fn=>fn([legacy]);
  globalThis.getVariables=option=>structuredClone(option.script_id?legacy.data:option.type==='chat'?chat:script);
  await migrate();assert.equal(script.summary_assistant_settings.enabled,true);assert.equal(legacy.enabled,false);assert.equal(script.summary_assistant_secrets.keysByUrl[''],'old-secret');
  assert(!JSON.stringify(legacy.data).includes('old-secret'));
  script.summary_assistant_settings.userPrefix='新用户';await migrate();assert.equal(script.summary_assistant_settings.userPrefix,'新用户');assert.equal(legacy.data.summary_assistant_settings.userPrefix,'旧用户');
});
test('legacy scripts with a regenerated id migrate by an unambiguous name and loader',async()=>{
  const legacy={id:'user-copy',name:'【命定之诗】总结',content:"import 'destined-journey-summarizer'",enabled:true};
  globalThis.getScriptTrees=()=>[legacy];globalThis.updateScriptTreesWith=fn=>fn([legacy]);
  await migrate();assert.equal(legacy.enabled,false);assert.equal(script.summary_assistant_settings.enabled,true);
  assert.equal(script.summary_assistant_migration.from,'user-copy');
});
test('custom API keys stay with their endpoint when switching configuration',async()=>{
  await saveSettings({...FLOW_SETTINGS,customApiUrl:'https://one.invalid/v1',customApiKey:'one-secret'});
  await updateSettings({customApiUrl:'https://two.invalid/v1'});assert.equal(getSettings().customApiKey,'');
  await updateSettings({customApiKey:'two-secret'});
  await updateSettings({customApiUrl:'https://one.invalid/v1'});assert.equal(getSettings().customApiKey,'one-secret');
  assert.equal(getKeyForUrl('https://two.invalid/v1'),'two-secret');
});
test('threshold counts raw floors, retaining the latest ten',async()=>{
  await saveSettings({...FLOW_SETTINGS,enabled:true});
  seedFloors(29);assert.equal(await shouldAutoTrigger(),false);
  messages.push({message_id:29,role:'assistant',message:'<gametxt>新事件</gametxt>'});assert.equal(await shouldAutoTrigger(),true);
  const plan=await computeSummaryPlan();assert.deepEqual({startFloor:plan.startFloor,endFloor:plan.endFloor,entryName:plan.entryName,lastId:plan.lastId,unsummarizedCount:plan.unsummarizedCount},{startFloor:0,endFloor:19,entryName:'总结0-19楼',lastId:29,unsummarizedCount:30});
  assert.equal(plan.floorCount,20);assert(plan.materialChars>0);
});
test('tag extraction ignores thoughts but preserves untagged user input',()=>{
  const result=processMessagesByTags([{id:0,role:'assistant',message:'<think>secret</think><tp>488-1-1</tp><gametxt>故事<!--注释--></gametxt><summary>摘要</summary>'},{id:1,role:'user',message:'无标签'}],['tp','gametxt'],['think'],true);
  assert.equal(result.length,2);assert.equal(result[0].content,'488-1-1\n故事');assert.equal(result[1].content,'无标签');
});
test('summary generation sends resolved ordered prompts and isolates RP history',async()=>{
  await saveSettings({...FLOW_SETTINGS,enabled:true});let request,sent;
  globalThis.generateRaw=async config=>{request=config;sent=await summaryReady({messages:config.ordered_prompts});return 'result';};
  assert.equal(await callSummaryApi({promptBlocks:DEFAULT_SETTINGS.promptBlocks,oldSummaryContent:'OLD',mergedChatText:'CHAT',scanText:'SCAN'}),'result');
  assert(sent.messages.every(p=>typeof p==='object'&&!p.content.includes('<|no-trans|>')));
  assert.deepEqual(request.overrides.chat_history,{prompts:[],with_depth_entries:false});assert.equal(request.max_chat_history,0);assert(request.generation_id.startsWith('destined-summary-'));
  assert(!request.custom_api);
  await saveSettings({...getSettings(),apiMode:'custom',customApiUrl:'https://example.invalid/v1',customApiModel:'model',customApiKey:'secret',temperature:0.4,maxTokens:2048});
  await callMegaSummaryApi({promptBlocks:DEFAULT_SETTINGS.megaPromptBlocks,mergedSummaryText:'records',oldMegaSummaryContent:''});
  assert.equal(request.custom_api.key,'secret');assert.equal(request.custom_api.max_tokens,2048);
});
test('the saved streaming preference applies to regular summaries, mega summaries and connection tests', async () => {
  const legacySettings = structuredClone(FLOW_SETTINGS);
  delete legacySettings.streamGeneration;
  script[CONFIG.SETTINGS_VAR_KEY] = legacySettings;
  assert.equal((await loadSettings()).streamGeneration, true);
  const streamed = [];
  globalThis.generateRaw = async ({ should_stream }) => {
    streamed.push(should_stream);
    return 'OK';
  };
  for (const expected of [true, false]) {
    await updateSettings({ streamGeneration: expected });
    assert.equal((await loadSettings()).streamGeneration, expected);
    await callSummaryApi({ promptBlocks: DEFAULT_SETTINGS.promptBlocks, mergedChatText: '聊天材料' });
    await callMegaSummaryApi({ promptBlocks: DEFAULT_SETTINGS.megaPromptBlocks, mergedSummaryText: '总结材料' });
    assert.equal(await testConnection(), true);
    assert.deepEqual(streamed.splice(0), [expected, expected, expected]);
  }
});
test('speaker prefixes remain customizable and append the actual AI speaker once',async()=>{
  await saveSettings({...FLOW_SETTINGS,userPrefix:'玩家 {{user}}'});seedFloors(2);let request;
  globalThis.SillyTavern.name2='不应标注为发言者的角色卡名';
  globalThis.generateRaw=async config=>{request=config;return '<summary_result>正文</summary_result>';};
  const params=await buildSummaryPromptParams(0,1);await callSummaryApi(params);
  const material=request.ordered_prompts.find(prompt=>prompt.content.startsWith('<source_material>')).content;
  assert(material.includes('第 0 楼 · 用户输入（意图，未必实现） · 玩家 User'));
  assert(material.includes('[第 1 楼 · AI 正文（实际剧情） · AI · 角色]'));
  assert(!material.includes(SillyTavern.name2));assert.equal(getSettings().assistantPrefix,'AI');
  assert(!material.includes('{{user}}')&&!material.includes('{{char}}'));
  await updateSettings({assistantPrefix:'自定义记录员 {{char}}'});
  await callSummaryApi(await buildSummaryPromptParams(0,1));
  assert(request.ordered_prompts.some(prompt=>prompt.content.includes('自定义记录员 '+SillyTavern.name2)));
  await loadSettings();assert.equal(getSettings().assistantPrefix,'自定义记录员 {{char}}');
  const aligned = await buildSummaryPromptParams(0,1,{...getSettings(),assistantPrefix:'角色'});
  assert.match(aligned.mergedChatText, /实际剧情） · 角色\]/);
  assert.doesNotMatch(aligned.mergedChatText, /角色 · 角色/);
});
test('write depths and mega mapping preserve original summary records on restore',async()=>{
  seedFloors(20);
  await saveSettings({...FLOW_SETTINGS,autoHideSummarizedFloors:false});
  await upsertSummaryEntryByName('总结0-9楼','one');await upsertSummaryEntryByName('总结10-19楼','two');
  assert.equal(books.book[0].position.depth,9998);
  await finalizeMegaSummarySave('大总结0-19楼','mega',['总结0-9楼','总结10-19楼']);
  const mega=books.book.find(e=>e.name==='大总结0-19楼');assert.equal(mega.position.depth,9999);assert(books.book.filter(e=>e.name.startsWith('总结')).every(e=>!e.enabled));
  await restoreMegaSummaryToSummaries('大总结0-19楼');assert(books.book.every(e=>e.enabled));assert.equal(books.book.length,2);
});
test('worldbook migration includes mega summaries and leaves unrelated entries',async()=>{
  await saveSettings({...FLOW_SETTINGS,autoHideSummarizedFloors:false});
  books.book=[{name:'总结0-9楼',content:'one'},{name:'大总结0-19楼',content:'mega'},{name:'无关',content:'keep'}];
  await migrateWorldbookEntries('book','new');assert.deepEqual(books.book,[{name:'无关',content:'keep'}]);assert.equal(books.new.length,2);assert.equal(chat.summary_assistant_worldbook,'new');
});
test('auto visibility does not unhide manually hidden floors',async()=>{
  await saveSettings(DEFAULT_SETTINGS);
  messages=Array.from({length:10},(_,i)=>({message_id:i,is_hidden:i===0}));
  await upsertSummaryEntryByName('总结1-5楼','one');assert.equal(messages[0].is_hidden,true);assert.deepEqual(chat.summary_assistant_auto_hidden_floors,[1,2,3,4,5]);
  setFloorVisibilityAutomation(false);await applySummarizedFloorsVisibility();
  assert(messages.slice(0,6).every(m=>m.is_hidden));
  await applySummarizedFloorsVisibility({autoHide:false});
  assert.equal(messages[0].is_hidden,true);assert(messages.slice(1).every(m=>!m.is_hidden));
});
test('duplicate operations are ignored and context changes reject late writes',async()=>{
  await saveSettings({...FLOW_SETTINGS,enabled:true});let finish;let calls=0;
  const task=runAction(async()=>{calls++;await new Promise(r=>finish=r);await upsertSummaryEntryByName('总结0-1楼','late');});
  assert(isBusy());await runAction(async()=>calls++);ctx.chatId='b';finish();await task;
  assert.equal(calls,1);assert.equal(books.book.length,0);assert(!isBusy());
});
test('rapid chat switches retain the previous global binding until reconciled',async()=>{
  globals=['book','shared'];books.b=[];books.c=[];let finish;
  script.summary_assistant_owned_books=['book'];
  chat.summary_assistant_worldbook='b';ctx.chatId='b';
  globalThis.getWorldbookNames=()=>new Promise(resolve=>finish=resolve);
  const transition=reconcileChatBinding();
  ctx.chatId='c';chat.summary_assistant_worldbook='c';invalidate();
  assert.equal(getActiveWorldbookName(),'c');finish(Object.keys(books));
  await assert.rejects(transition,{name:'AbortError'});
  globalThis.getWorldbookNames=async()=>Object.keys(books);
  await reconcileChatBinding();assert.deepEqual(globals,['shared','c']);
});

function seedFloors(count=30) { messages=Array.from({length:count},(_,id)=>({message_id:id,role:id%2?'assistant':'user',name:id%2?'角色':'用户',swipe_id:0,message:id%2?'<gametxt>事件 '+id+'</gametxt>':'我尝试行动 '+id,is_hidden:false})); }
const nextTick=()=>new Promise(resolve=>setImmediate(resolve));
async function waitUntil(predicate) { for(let i=0;i<100;i++){if(predicate())return;await nextTick();}assert.fail('condition did not settle'); }

test('result parser rejects malformed contracts and stores only one complete body',()=>{
  assert.equal(extractSummaryResult('解释<think>检查</think><summary_result>事实</summary_result>结束'),'事实');
  assert.equal(extractSummaryResult('事实</summary_result>',{prefill:'<summary_result>\n'}),'事实');
  for(const value of ['', '事实','<summary_result> </summary_result>','<summary_result>截断','<summary_result>A</summary_result><summary_result>B</summary_result>','<summary_result>A<summary_result>B</summary_result></summary_result>','<summary_result>A</summary_result><summary_result','</summary_result>wrong<summary_result>'])assert.throws(()=>extractSummaryResult(value));
  assert.equal(extractSummaryResult('<summary_result>自由格式</summary_result>'),'自由格式');
  assert.throws(()=>extractSummaryResult('<summary_result>自由格式</summary_result>',{format:'legacy'}));
});
test('coverage finds middle gaps and mega mappings do not cover intervening holes',async()=>{
  await saveSettings({...FLOW_SETTINGS,enabled:true});seedFloors(50);
  books.book=[{name:'总结0-9楼',content:'a',enabled:true},{name:'总结20-29楼',content:'b',enabled:true}];
  const plan=await computeSummaryPlan();assert.equal(plan.startFloor,10);assert.equal(plan.endFloor,19);
  books.book=[{name:'大总结0-29楼',content:'mega',enabled:true}];chat[CONFIG.MEGA_SUMMARY_VAR_KEY]={'大总结0-29楼':['总结0-9楼','总结20-29楼']};
  const {floors}=await getCoverage();assert(!floors.has(10));assert(floors.has(20));
  await assert.rejects(executeMegaSummary(['总结0-9楼','总结20-29楼'],'大总结0-29楼'),/连续/);
});
test('audit repairs a legacy mega without its map, preserves its closed state, and then permits normal activation',async()=>{
  await saveSettings(FLOW_SETTINGS);seedFloors(20);
  books.book=[
    {name:'总结0-9楼',content:'甲',enabled:false},
    {name:'总结10-19楼',content:'乙',enabled:false},
    {name:'大总结0-19楼',content:'旧档案',enabled:false},
  ];
  chat[ARCHIVE_VAR_KEY]={book:{records:{'大总结0-19楼':{legacy:true,sources:[],invalid:'来源楼层、回复版本或原总结已变化',committed:true}},excluded:[],megaExcluded:[]}};
  assert.deepEqual(await auditArchiveSources(),[]);
  assert.deepEqual(chat[CONFIG.MEGA_SUMMARY_VAR_KEY]?.byBook.book,{'大总结0-19楼':['总结0-9楼','总结10-19楼']});
  const recovered=readArchive().records['大总结0-19楼'];assert.equal(recovered.invalid,null);assert.equal(recovered.sources.length,20);
  assert.equal(books.book.find(entry=>entry.name==='大总结0-19楼').enabled,false);
  await activateMegaSummaryEntry('大总结0-19楼');
  assert(books.book.find(entry=>entry.name==='大总结0-19楼').enabled);assert(books.book.filter(entry=>entry.name.startsWith('总结')).every(entry=>!entry.enabled));
});
test('audit uses valid archived mega parents when the worldbook alone has multiple possible source partitions',async()=>{
  await saveSettings(FLOW_SETTINGS);seedFloors(20);const sources=currentSources();
  const names=['总结0-9楼','总结10-19楼','总结0-4楼','总结5-19楼'];
  books.book=[...names.map((name,index)=>({name,content:'普通'+index,enabled:false})),{name:'大总结0-19楼',content:'旧档案',enabled:false}];
  const byRange=(start,end)=>({legacy:true,committed:true,sources:sources.filter(source=>source.id>=start&&source.id<=end)});
  chat[ARCHIVE_VAR_KEY]={book:{records:{
    '总结0-9楼':byRange(0,9),'总结10-19楼':byRange(10,19),'总结0-4楼':byRange(0,4),'总结5-19楼':byRange(5,19),
    '大总结0-19楼':{legacy:true,committed:true,sources:[],invalid:'旧审计误判',parents:['总结0-9楼','总结10-19楼'].map(name=>({name,fingerprint:fingerprint(books.book.find(entry=>entry.name===name).content)}))},
  },excluded:[],megaExcluded:[]}};
  assert.deepEqual(await auditArchiveSources(),[]);
  assert.deepEqual(chat[CONFIG.MEGA_SUMMARY_VAR_KEY]?.byBook.book,{'大总结0-19楼':['总结0-9楼','总结10-19楼']});assert.equal(readArchive().records['大总结0-19楼'].invalid,null);
});
test('audit refuses incomplete or ambiguous legacy mega sources instead of inventing a map',async()=>{
  for(const ordinary of [
    [['总结0-9楼','甲'],['总结20-29楼','乙']],
    [['总结0-9楼','甲'],['总结10-19楼','乙'],['总结0-4楼','丙'],['总结5-19楼','丁']],
  ]){
    reset();await saveSettings(FLOW_SETTINGS);seedFloors(30);
    const name=ordinary.length===2?'大总结0-29楼':'大总结0-19楼';
    books.book=[...ordinary.map(([entryName,content])=>({name:entryName,content,enabled:false})),{name,content:'旧档案',enabled:true}];
    chat[ARCHIVE_VAR_KEY]={book:{records:{[name]:{legacy:true,committed:true,sources:[],invalid:'旧审计误判'}},excluded:[],megaExcluded:[]}};
    const invalid=await auditArchiveSources();
    assert(invalid.includes(name));assert.equal(chat[CONFIG.MEGA_SUMMARY_VAR_KEY],undefined);assert(readArchive().records[name].invalid);assert.equal(books.book.find(entry=>entry.name===name).enabled,false);
  }
});
test('audit does not re-close a natively enabled recovered mega and retains a real source-change invalidation',async()=>{
  await saveSettings(FLOW_SETTINGS);seedFloors(20);
  books.book=[{name:'总结0-9楼',content:'甲',enabled:false},{name:'总结10-19楼',content:'乙',enabled:false},{name:'大总结0-19楼',content:'旧档案',enabled:true}];
  chat[ARCHIVE_VAR_KEY]={book:{records:{'大总结0-19楼':{legacy:true,committed:true,sources:[],invalid:'旧审计误判'}},excluded:[],megaExcluded:[]}};
  let worldbookWrites=0;const update=globalThis.updateWorldbookWith;globalThis.updateWorldbookWith=async(...args)=>{worldbookWrites++;return update(...args);};
  await auditArchiveSources();assert.equal(books.book.find(entry=>entry.name==='大总结0-19楼').enabled,true);const stable=structuredClone(readArchive());
  await auditArchiveSources();assert.equal(books.book.find(entry=>entry.name==='大总结0-19楼').enabled,true);assert.deepEqual(readArchive(),stable);assert.equal(worldbookWrites,0);
  messages[3].message='<gametxt>真实改楼</gametxt>';const invalid=await auditArchiveSources();
  assert(invalid.includes('大总结0-19楼'));assert.equal(books.book.find(entry=>entry.name==='大总结0-19楼').enabled,false);const invalidRecord=structuredClone(readArchive().records['大总结0-19楼']);
  await auditArchiveSources();assert.deepEqual(readArchive().records['大总结0-19楼'],invalidRecord);
});
test('audit leaves a legacy archive unrecovered when persisting its repaired mega map fails',async()=>{
  await saveSettings(FLOW_SETTINGS);seedFloors(20);const sources=currentSources();
  books.book=[{name:'总结0-9楼',content:'甲',enabled:false},{name:'总结10-19楼',content:'乙',enabled:false},{name:'大总结0-19楼',content:'旧档案',enabled:false}];
  chat[ARCHIVE_VAR_KEY]={book:{records:{
    '总结0-9楼':{legacy:true,committed:true,sources:sources.filter(source=>source.id<=9)},
    '总结10-19楼':{legacy:true,committed:true,sources:sources.filter(source=>source.id>=10)},
    '大总结0-19楼':{legacy:true,committed:true,sources:[],invalid:'旧审计误判'},
  },excluded:[],megaExcluded:[]}};
  const before=structuredClone(chat[ARCHIVE_VAR_KEY]),replace=globalThis.replaceVariables;
  globalThis.replaceVariables=(value,option)=>{if(option.type==='chat'&&Object.hasOwn(value,CONFIG.MEGA_SUMMARY_VAR_KEY))return;replace(value,option);};
  await assert.rejects(auditArchiveSources(),/持久化校验失败/);
  assert.equal(chat[CONFIG.MEGA_SUMMARY_VAR_KEY],undefined);assert.deepEqual(chat[ARCHIVE_VAR_KEY],before);
});
test('audit never clears a legacy mega invalidation when an archived parent body changed',async()=>{
  await saveSettings(FLOW_SETTINGS);seedFloors(20);const sources=currentSources();
  books.book=[{name:'总结0-9楼',content:'甲',enabled:false},{name:'总结10-19楼',content:'乙',enabled:false},{name:'大总结0-19楼',content:'旧档案',enabled:true}];
  chat[ARCHIVE_VAR_KEY]={book:{records:{
    '总结0-9楼':{legacy:true,committed:true,sources:sources.filter(source=>source.id<=9)},
    '总结10-19楼':{legacy:true,committed:true,sources:sources.filter(source=>source.id>=10)},
    '大总结0-19楼':{legacy:true,committed:true,sources:[],invalid:'旧审计误判',parents:['总结0-9楼','总结10-19楼'].map(name=>({name,fingerprint:fingerprint(books.book.find(entry=>entry.name===name).content)}))},
  },excluded:[],megaExcluded:[]}};
  books.book.find(entry=>entry.name==='总结10-19楼').content='已被用户改写';
  const invalid=await auditArchiveSources();
  assert(invalid.includes('大总结0-19楼'));assert.equal(chat[CONFIG.MEGA_SUMMARY_VAR_KEY],undefined);assert(readArchive().records['大总结0-19楼'].invalid);assert.equal(books.book.find(entry=>entry.name==='大总结0-19楼').enabled,false);
});
test('audit accepts sparse real sources but rejects sources outside a recorded parent range and duplicate parent names',async()=>{
  await saveSettings(FLOW_SETTINGS);seedFloors(20);const sources=currentSources();
  books.book=[{name:'总结0-9楼',content:'甲',enabled:false},{name:'总结10-19楼',content:'乙',enabled:false},{name:'大总结0-19楼',content:'旧档案',enabled:false}];
  chat[ARCHIVE_VAR_KEY]={book:{records:{
    '总结0-9楼':{legacy:true,committed:true,sources:sources.filter(source=>source.id===0)},
    '总结10-19楼':{legacy:true,committed:true,sources:sources.filter(source=>source.id===10)},
    '大总结0-19楼':{legacy:true,committed:true,sources:[],invalid:'旧审计误判'},
  },excluded:[],megaExcluded:[]}};
  assert.deepEqual(await auditArchiveSources(),[]);assert.deepEqual(chat[CONFIG.MEGA_SUMMARY_VAR_KEY]?.byBook.book,{'大总结0-19楼':['总结0-9楼','总结10-19楼']});assert.deepEqual(readArchive().records['大总结0-19楼'].sources.map(source=>source.id),[0,10]);
  reset();await saveSettings(FLOW_SETTINGS);seedFloors(20);const fresh=currentSources();
  for(const ordinary of [
    [{name:'总结0-9楼',content:'甲',enabled:false},{name:'总结10-19楼',content:'乙',enabled:false}],
    [{name:'总结0-9楼',content:'甲',enabled:false},{name:'总结0-9楼',content:'重复',enabled:false},{name:'总结10-19楼',content:'乙',enabled:false}],
  ]){
    books.book=[...ordinary,{name:'大总结0-19楼',content:'旧档案',enabled:true}];
    const records={'大总结0-19楼':{legacy:true,committed:true,sources:[],invalid:'旧审计误判'}};
    if(ordinary.length===2){records['总结0-9楼']={legacy:true,committed:true,sources:fresh.filter(source=>source.id===10)};records['总结10-19楼']={legacy:true,committed:true,sources:fresh.filter(source=>source.id===11)};}
    chat[ARCHIVE_VAR_KEY]={book:{records,excluded:[],megaExcluded:[]}};
    const invalid=await auditArchiveSources();assert(invalid.includes('大总结0-19楼'));assert.equal(chat[CONFIG.MEGA_SUMMARY_VAR_KEY],undefined);
  }
});
test('a failed recovered-archive write leaves the saved map retryable',async()=>{
  await saveSettings(FLOW_SETTINGS);seedFloors(20);
  books.book=[{name:'总结0-9楼',content:'甲',enabled:false},{name:'总结10-19楼',content:'乙',enabled:false},{name:'大总结0-19楼',content:'旧档案',enabled:false}];
  chat[ARCHIVE_VAR_KEY]={book:{records:{'大总结0-19楼':{legacy:true,committed:true,sources:[],invalid:'旧审计误判'}},excluded:[],megaExcluded:[]}};
  const replace=globalThis.replaceVariables,before=structuredClone(chat[ARCHIVE_VAR_KEY]);globalThis.replaceVariables=(value,option)=>{if(option.type==='chat'&&JSON.stringify(value[ARCHIVE_VAR_KEY])!==JSON.stringify(before))return;replace(value,option);};
  await assert.rejects(auditArchiveSources(),/持久化校验失败/);
  assert.deepEqual(chat[CONFIG.MEGA_SUMMARY_VAR_KEY]?.byBook.book,{'大总结0-19楼':['总结0-9楼','总结10-19楼']});assert.equal(readArchive().records['大总结0-19楼'].sources.length,0);
  globalThis.replaceVariables=replace;assert.deepEqual(await auditArchiveSources(),[]);assert.equal(readArchive().records['大总结0-19楼'].sources.length,20);
});
test('every automatic normal batch stays inside the soft target and ends after an AI reply',async()=>{
  await saveSettings({...FLOW_SETTINGS,enabled:true,batchFloorCount:19});seedFloors(100);
  const plans=await computeSummaryPlans(),cap=Math.floor(19*1.2);assert(plans.length>1);
  assert.deepEqual(plans.map(plan=>plan.startFloor),[plans[0].startFloor,...plans.slice(0,-1).map(plan=>plan.endFloor+1)]);
  assert.equal(plans.at(-1).endFloor,89);
  for(const plan of plans){assert(messages[plan.endFloor].role==='assistant');assert(plan.floorCount<=cap);assert(plan.materialChars>0);assert.equal(plan.entryName,`总结${plan.startFloor}-${plan.endFloor}楼`);}
});
test('generation saves body then hides without CHAT_CHANGED reloads',async()=>{
  await saveSettings({...FLOW_SETTINGS,enabled:true});seedFloors();let calls=0;
  globalThis.generateRaw=async()=>{calls++;return '额外文字<summary_result>两人抵达城门。</summary_result>额外文字';};
  const original=globalThis.setChatMessages;
  globalThis.setChatMessages=async(updates,options)=>{assert.equal(options.refresh,'affected');assert.equal(books.book[0].content,'两人抵达城门。');await original(updates);};
  assert.equal(await executeSummary(0,19,'总结0-19楼'),true);assert.equal(calls,1);assert.equal(getTask().phase,'complete');
  assert(messages.slice(0,20).every(message=>message.is_hidden));assert(messages.slice(20).every(message=>!message.is_hidden));
  assert.equal(readArchive().records['总结0-19楼'].sources.length,20);
});

test('summary without randomUUID creates task and request ids, saves and hides completed floors',async t=>{
  const original=Object.getOwnPropertyDescriptor(globalThis,'crypto');
  const getRandomValues=globalThis.crypto.getRandomValues.bind(globalThis.crypto);
  Object.defineProperty(globalThis,'crypto',{configurable:true,value:{getRandomValues}});
  t.after(()=>Object.defineProperty(globalThis,'crypto',original));
  await saveSettings({...FLOW_SETTINGS,enabled:true});seedFloors();let request;
  globalThis.generateRaw=async config=>{request=config;return '<summary_result>两人抵达城门。</summary_result>';};
  assert.equal(await executeSummary(0,19,'总结0-19楼'),true);
  const task=getTask(),uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
  assert.match(task.id,uuid);assert.match(request.generation_id.replace(/^destined-summary-/,''),uuid);
  assert.notEqual(request.generation_id,`destined-summary-${task.id}`);
  assert.equal(task.phase,'complete');assert.equal(books.book[0].content,'两人抵达城门。');
  assert(messages.slice(0,20).every(message=>message.is_hidden));
  assert(messages.slice(20).every(message=>!message.is_hidden));
  assert.equal(readArchive().records['总结0-19楼'].sources.length,20);
});
test('visibility failures retry only visibility and survive recovery reload',async()=>{
  await saveSettings({...FLOW_SETTINGS,enabled:true});seedFloors();let calls=0;
  globalThis.generateRaw=async()=>{calls++;return '<summary_result>正文</summary_result>';};
  const original=globalThis.setChatMessages;globalThis.setChatMessages=async()=>{throw Error('hide failed');};
  assert.equal(await executeSummary(0,19,'总结0-19楼'),false);assert.equal(getTask().errorKind,'visibility');assert.equal(books.book[0].content,'正文');
  restoreTaskState();globalThis.setChatMessages=original;assert.equal(await retryTask(),true);assert.equal(calls,1);assert(messages[0].is_hidden);
});
test('save failures preserve a valid result and never hide before retry',async()=>{
  await saveSettings({...FLOW_SETTINGS,enabled:true});seedFloors();let calls=0;
  globalThis.generateRaw=async()=>{calls++;return '<summary_result>正文</summary_result>';};
  const original=globalThis.createWorldbookEntries;globalThis.createWorldbookEntries=async()=>{throw Error('save failed');};
  await executeSummary(0,19,'总结0-19楼');assert.equal(getTask().errorKind,'save');assert(messages.every(message=>!message.is_hidden));
  globalThis.createWorldbookEntries=original;await retryTask();assert.equal(calls,1);assert.equal(getTask().phase,'complete');
});
test('one automatic retry uses identical materials and settings, then manual retry refreshes settings',async()=>{
  await saveSettings({...FLOW_SETTINGS,enabled:true,customApiKey:'hidden-key',temperature:0.1});seedFloors();const requests=[];
  globalThis.generateRaw=async config=>{requests.push(config);await updateSettings({temperature:0.9,streamGeneration:false});throw Error('timeout https://host.invalid?key=hidden-key');};
  await executeSummary(0,19,'总结0-19楼');assert.equal(requests.length,2);assert.equal(getTask().phase,'pending');
  const materials=request=>request.ordered_prompts;
  assert.equal(requests[1].custom_api.temperature,0.1);assert.deepEqual(materials(requests[0]),materials(requests[1]));assert(!getTask().details.includes('hidden-key'));
  assert.deepEqual(requests.map(request=>request.should_stream),[true,true]);
  globalThis.generateRaw=async config=>{requests.push(config);return '<summary_result>重试正文</summary_result>';};
  await retryTask();assert.equal(requests[2].custom_api.temperature,0.9);assert.equal(requests[2].should_stream,false);assert.equal(getTask().phase,'complete');
});

const upstream524 = '[API 错误] OpenAI endpoint failed with status 524';
for (const [label, generate] of [
  ['a returned Tavern error', async () => upstream524],
  ['a rejected API call', async () => { throw new Error(upstream524); }],
]) test(`HTTP 524 from ${label} is reported as a request failure`, async () => {
  await saveSettings(FLOW_SETTINGS);
  seedFloors(2);
  let calls = 0;
  globalThis.generateRaw = async () => {
    calls++;
    return generate();
  };
  await assert.rejects(testConnection(), error => error.status === 524 && /524/.test(error.message));
  assert.equal(calls, 1);
  assert.equal(await executeSummary(0, 1, '总结0-1楼'), false);
  assert.equal(calls, 3);
  const task = getTask();
  assert.equal(task.phase, 'pending');
  assert.equal(task.errorKind, 'request');
  assert.match(task.message, /524/);
  assert.match(task.message, /超时/);
  assert.match(task.details, /524/);
  assert.equal(task.raw, '');
  assert.deepEqual(books.book, []);
  assert.deepEqual(readArchive().records, {});
  assert(messages.every(message => !message.is_hidden));
});

for (const [label, failure, detail] of [
  ['a fetch failure', new TypeError('Failed to fetch'), /Failed to fetch/i],
  ['an unexpected upstream abort', new DOMException('The operation was aborted.', 'AbortError'), /aborted/i],
]) test(`network errors leave the floors available after ${label}`, async () => {
  await saveSettings(FLOW_SETTINGS);
  seedFloors(2);
  let calls = 0;
  globalThis.generateRaw = async () => {
    calls++;
    throw failure;
  };
  assert.equal(await executeSummary(0, 1, '总结0-1楼'), false);
  assert.equal(calls, 2);
  const task = getTask();
  assert.equal(task.phase, 'pending');
  assert.equal(task.running, false);
  assert.equal(task.errorKind, 'request');
  assert.match(task.message, /连接|中断/);
  assert.match(task.details, detail);
  assert.equal(task.raw, '');
  assert.deepEqual(books.book, []);
  assert(messages.every(message => !message.is_hidden));
});

for (const { label, response, streamGeneration, prefillTemplate, possiblyInterrupted } of [
  { label: 'an unclosed result tag in a streamed response', response: '<summary_result>局部正文', streamGeneration: true, prefillTemplate: 'off', possiblyInterrupted: true },
  { label: 'partial result tag in a streamed response', response: '<summary_result>局部正文</summary_res', streamGeneration: true, prefillTemplate: 'off', possiblyInterrupted: true },
  { label: 'partial result tag with an assistant prefill', response: '局部正文</summary_res', streamGeneration: true, prefillTemplate: 'result', possiblyInterrupted: true },
  { label: 'partial result tag in a non-streamed response', response: '<summary_result>局部正文</summary_res', streamGeneration: false, prefillTemplate: 'off', possiblyInterrupted: false },
  { label: 'plain text without a result tag', response: '正文里提到门牌 524。', streamGeneration: true, prefillTemplate: 'off', possiblyInterrupted: false },
  { label: 'plain text after an assistant prefill', response: '正文里提到门牌 524。', streamGeneration: true, prefillTemplate: 'result', possiblyInterrupted: false },
  { label: 'duplicated complete result tags', response: '<summary_result>第一份</summary_result><summary_result>第二份</summary_result>', streamGeneration: true, prefillTemplate: 'off', possiblyInterrupted: false },
]) test(`summary format failure keeps editable output after ${label}`, async () => {
  await saveSettings({ ...withOptions(FLOW_SETTINGS, { resultFormat: 'free', prefillTemplate }), streamGeneration });
  seedFloors(2);
  let calls = 0;
  globalThis.generateRaw = async () => {
    calls++;
    return response;
  };
  assert.equal(await executeSummary(0, 1, '总结0-1楼'), false);
  assert.equal(calls, 2);
  const task = getTask();
  assert.equal(task.phase, 'pending');
  assert.equal(task.errorKind, 'format');
  assert.equal(task.raw, response);
  const feedback = `${task.message} ${task.details}`;
  if (possiblyInterrupted) assert.match(feedback, /可能[^。！？]*(?:中断|截断)/);
  else assert.doesNotMatch(feedback, /可能[^。！？]*中断|(?:流式|连接|传输)[^。！？]*中断/);
  assert.deepEqual(books.book, []);
  assert(messages.every(message => !message.is_hidden));
  assert.equal(await retryTask('save', '手动补全的正文'), true);
  assert.equal(calls, 2);
  assert.equal(books.book[0].content, '手动补全的正文');
});

for (const prefillTemplate of ['off', 'result']) test(`API error words inside a valid summary are saved (prefill: ${prefillTemplate})`, async () => {
  await saveSettings(withOptions(FLOW_SETTINGS, { resultFormat: 'free', prefillTemplate }));
  seedFloors(2);
  const body = '[API 错误] OpenAI endpoint failed with status 524 是日志上记载的一行文字。';
  globalThis.generateRaw = async ({ ordered_prompts }) => {
    const prefill = ordered_prompts.at(-1).role === 'assistant';
    assert.equal(prefill, prefillTemplate === 'result');
    return `${prefill ? '' : '<summary_result>'}${body}</summary_result>`;
  };
  assert.equal(await executeSummary(0, 1, '总结0-1楼'), true);
  assert.equal(books.book[0].content, body);
});
test('stop cancels only its own generation and blocks automatic restart',async()=>{
  await saveSettings({...FLOW_SETTINGS,enabled:true});seedFloors();let resolve,request;const stopped=[];
  globalThis.stopGenerationById=id=>stopped.push(id);globalThis.generateRaw=config=>{request=config;return new Promise(r=>resolve=r);};
  const running=executeSummary(0,19,'总结0-19楼');await waitUntil(()=>request);
  assert(stopTask());await running;assert.equal(getTask().phase,'stopped');assert.deepEqual(stopped,[request.generation_id]);
  resolve('<summary_result>迟到结果</summary_result>');await autoTriggerSummary();assert.equal(books.book.length,0);
});
test('pause lets an active task finish but queues no more work',async()=>{
  await saveSettings({...FLOW_SETTINGS,enabled:true});seedFloors(50);let resolve;
  globalThis.generateRaw=()=>new Promise(r=>resolve=r);
  const running=executeSummary(0,19,'总结0-19楼');await waitUntil(()=>resolve);await updateSettings({enabled:false});resolve('<summary_result>正文</summary_result>');
  assert.equal(await running,true);assert.equal(getTask().phase,'complete');
});
test('edits and swipes invalidate coverage and restore only assistant-owned hides',async()=>{
  await saveSettings({...FLOW_SETTINGS,enabled:true});seedFloors();messages[2].is_hidden=true;
  globalThis.generateRaw=async()=>'<summary_result>正文</summary_result>';await executeSummary(0,19,'总结0-19楼');
  messages[1].swipe_id=1;messages[1].message='<gametxt>不同版本</gametxt>';
  assert.equal((await getCoverage()).floors.size,0);await auditArchiveSources();await applySummarizedFloorsVisibility();
  assert.equal(books.book[0].enabled,false);assert(messages[2].is_hidden);assert(!messages[1].is_hidden);
});
test('source changes during generation enter pending without saving or hiding',async()=>{
  await saveSettings({...FLOW_SETTINGS,enabled:true});seedFloors();
  globalThis.generateRaw=async()=>{messages[1].message='<gametxt>改楼</gametxt>';return '<summary_result>旧正文</summary_result>';};
  await executeSummary(0,19,'总结0-19楼');assert.equal(getTask().errorKind,'source');assert.equal(books.book.length,0);assert(messages.every(message=>!message.is_hidden));
});
test('deleting or disabling an ordinary summary is respected by automation',async()=>{
  await saveSettings({...FLOW_SETTINGS,enabled:true});seedFloors(50);
  globalThis.generateRaw=async()=>'<summary_result>正文</summary_result>';await executeSummary(0,19,'总结0-19楼');await deleteSummaryEntry('总结0-19楼');
  assert.equal((await computeSummaryPlan()).startFloor,20);assert(!messages[0].is_hidden);
});
test('automatic mega is segmented and history includes mega without future leakage',async()=>{
  await saveSettings({...FLOW_SETTINGS,enabled:true,megaTriggerCount:8,megaBatchCount:6});seedFloors(170);
  for(let i=0;i<8;i++)await upsertSummaryEntryByName('总结'+(i*20)+'-'+(i*20+19)+'楼','记录'+i);
  const plan=await computeMegaPlan();assert.equal(plan.summaryNames.length,6);assert.equal(plan.entryName,'大总结0-119楼');
  globalThis.generateRaw=async()=>'<summary_result>合并档案</summary_result>';assert(await executeMegaSummary(plan.summaryNames,plan.entryName));
  assert.equal((await getAllSummaryContents()).filter(entry=>entry.name.startsWith('总结')).length,2);
  const params=await buildRegeneratePromptParams('总结120-139楼');assert(params.oldSummaryContent.includes('合并档案'));assert(!params.oldSummaryContent.includes('记录7'));
});
test('manual and custom-range generation remain available with automation off',async()=>{
  await saveSettings({...FLOW_SETTINGS,enabled:false});seedFloors(18);let calls=0;
  globalThis.generateRaw=async()=>{calls++;return '<summary_result>手动归档</summary_result>';};
  await autoTriggerSummary();assert.equal(calls,0);
  assert.equal(await shouldAutoTrigger(),false);
  assert(await startSummaryProcess());assert.equal(calls,1);assert(books.book.some(entry=>entry.name==='总结0-7楼'));
  configureRuntime({status:(...args)=>reports.push(args),form:async options=>{assert.deepEqual(options.fields.map(field=>field.type),['number','number']);assert.equal(options.validate({start:10,end:15}),'');assert(options.validate({start:-1,end:15}));assert(options.validate({start:16,end:10}));return {start:10,end:15};}});
  assert(await startCustomRangeSummaryProcess());assert.equal(calls,2);
  assert(books.book.some(entry=>entry.name==='总结10-15楼'));assert.equal(getSettings().enabled,false);
  assert(messages.slice(10,16).every(message=>message.is_hidden));assert(!messages[8].is_hidden&&!messages[9].is_hidden&&!messages[16].is_hidden);
  messages[1].message='<gametxt>改写后的事件</gametxt>';await autoTriggerSummary();
  assert.equal(calls,2);assert(books.book.find(entry=>entry.name==='总结0-7楼').enabled===false);
  assert(messages.slice(0,8).every(message=>!message.is_hidden));assert(messages[10].is_hidden);
});
test('automatic mega uses the configured trigger and merge counts',async()=>{
  await saveSettings({...FLOW_SETTINGS,enabled:true,megaTriggerCount:6,megaBatchCount:4});seedFloors(130);
  for(let i=0;i<5;i++)await upsertSummaryEntryByName('总结'+(i*20)+'-'+(i*20+19)+'楼','记录'+i);
  assert.equal(await computeMegaPlan(),null);
  await upsertSummaryEntryByName('总结100-119楼','记录5');
  const plan=await computeMegaPlan();assert.equal(plan.summaryNames.length,4);assert.equal(plan.entryName,'大总结0-79楼');
  globalThis.generateRaw=async()=>'<summary_result>四条合并</summary_result>';assert(await executeMegaSummary(plan.summaryNames,plan.entryName));
  assert.equal((await getAllSummaryContents()).filter(entry=>entry.name.startsWith('总结')).length,2);
});
test('pre-existing globally enabled books are not adopted as assistant-owned',async()=>{
  globals=['book','shared'];
  await reconcileChatBinding();await bindWorldbookToChat('next');assert(globals.includes('book'));assert(globals.includes('shared'));
  await bindWorldbookToChat('book');assert(!globals.includes('next'));assert(globals.includes('shared'));
});
test('macros expand custom rules without interpreting source text or inserting merge markers',async()=>{
  const settings={...DEFAULT_SETTINGS,customMacros:[{name:'custom',content:'用户 {{user}}；{{summary.material}}'}]};
  assert.equal(expandMacros('{{custom}}',{user:'甲','summary.material':'字面 {{user}}'},settings.customMacros),'用户 甲；字面 {{user}}');
  assert.throws(()=>expandMacros('{{a}}',{},[{name:'a',content:'{{b}}'},{name:'b',content:'{{a}}'}]),/循环/);
  const compiled=await compilePrompt({promptBlocks:[{type:'builtin_group',enabled:true},{type:'prompt',enabled:true,role:'user',content:'{{custom}}'},optionBlocks({prefillTemplate:'result'}).find(block=>block.id==='tail_prefill')],macroValues:{user:'甲','summary.material':'材料','summary.world_before':'世界','summary.persona':'人设'}},settings);
  assert(compiled.orderedPrompts.every(prompt=>typeof prompt==='object'&&!prompt.content.includes('<|no-trans|>')));assert.equal(compiled.orderedPrompts.at(-1).role,'assistant');assert.equal(compiled.prefill,'<summary_result>\n');
});

test('cancelled generation never opens review or saves into a different chat',async()=>{
  await saveSettings({...FLOW_SETTINGS,enabled:true});messages=[{message_id:0,role:'assistant',message:'<gametxt>事件</gametxt>'}];let finish;
  globalThis.generateRaw=()=>new Promise(r=>finish=r);
  const task=runAction(()=>executeSummary(0,0,'总结0-0楼',{requireReview:true}),{generation:true});
  while(!finish)await new Promise(r=>setImmediate(r));invalidate();ctx.chatId='b';finish('---\n488-1-1 | 地点:\n  事件');await task;
  assert.equal(books.book.length,0);
});
test('legacy SPreset fixture documents the compatible memory, reference and runtime format',()=>{
  const settings=JSON.parse(fs.readFileSync(new URL('./fixtures/spreset.json',import.meta.url)));
  const post=Function('return ('+settings.ChatSquash.squashed_post_script+')')();
  const text=post('<VOID_memory><|ws_slot|></VOID_memory><VOID_reference><|ai_slot|></VOID_reference><VOID_runtime><|ac_slot|></VOID_runtime><VOID_injection_buffer>MEGA_9999 SUMMARY_9998</VOID_injection_buffer><@Cut_900><VOID_injection_buffer>REF</VOID_injection_buffer><@Cut_2><VOID_injection_buffer>RULE</VOID_injection_buffer>');
  assert(text.includes('<VOID_memory>MEGA_9999 SUMMARY_9998</VOID_memory>'));assert(text.includes('<VOID_reference>REF</VOID_reference>'));assert(text.includes('<VOID_runtime>RULE</VOID_runtime>'));
  const regexes=settings.RegexBinding.regexes;
  const recent=regexes.find(r=>r.scriptName.startsWith('07'));const distant=regexes.find(r=>r.scriptName.startsWith('08'));
  assert.equal(recent.maxDepth,10);assert.equal(distant.minDepth,11);assert.equal(settings.ChatSquash.squashed_separator_string,'<|no-trans|>');
});

test('native prompt entries send their enabled roles and combine world and character material', async () => {
  for (const key of ['promptBlocks','megaPromptBlocks']) {
    assert.equal(DEFAULT_SETTINGS[key].length,14);
    const values=Object.fromEntries(['world_before','persona','character','personality','scenario','world_after','history','material'].map(name=>['summary.'+name,'DATA_'+name]));
    const compiled=await compilePrompt({promptBlocks:DEFAULT_SETTINGS[key],macroValues:values},DEFAULT_SETTINGS);
    assert.deepEqual(compiled.orderedPrompts.map(message=>message.role),['system','user','user','user','user','user','user','user']);
    const world=compiled.orderedPrompts.find(message=>message.content.startsWith('<world_and_characters>'));
    for(const name of ['world_before','persona','character','personality','scenario','world_after'])assert(world.content.includes('DATA_'+name));
    assert(compiled.orderedPrompts.every(message=>!message.content.includes('<|no-trans|>')));
    assert(compiled.orderedPrompts[5].content.includes('【信息变动】'));
    assert(compiled.orderedPrompts[6].content.includes('<archive_plan_contract>'));
  }
});
const timelineBody = '---\n复兴纪元488年4月15日 | 瓦伦蒂亚城-城门:\n  清晨\n  两人抵达城门，守卫核验身份后放行。\n  【未决事项】两人答应在午后回报调查结果。';

test('format entries change sent rules and edited formats use custom validation',async()=>{
  assert.equal(activeResultFormat(DEFAULT_SETTINGS.promptBlocks),'legacy');
  for(const [format,body,rule] of [['legacy',timelineBody,'日期 | 完整地点路径'],['archive','【时空与事件】\n- 清晨｜城门：守卫核验身份后放行。','【时空与事件】'],['free','自定义段落','自定义格式要求']]){
    const settings=withOptions(DEFAULT_SETTINGS,{resultFormat:format});
    const compiled=await compilePrompt({promptBlocks:settings.promptBlocks,macroValues:{}},settings);
    assert.equal(compiled.resultFormat,format);assert(compiled.orderedPrompts.some(message=>message.content.includes(rule)));
    assert.equal(extractSummaryResult('<summary_result>'+body+'</summary_result>',{format}),body);
  }
  const edited=structuredClone(DEFAULT_SETTINGS.promptBlocks);edited.find(block=>block.id==='format_legacy').content='用户自写的段落格式';assert.equal(activeResultFormat(edited),'free');
  for(const body of ['- **人物与觉醒**：人物醒来。','---\n日期 | 地点:\n没有时间与缩进','---\n地点:\n  清晨\n  事件','---\n日期 | 地点:\n  清晨\n  事件\n---\n坏标题'])assert.throws(()=>extractSummaryResult('<summary_result>'+body+'</summary_result>',{format:'legacy'}));
  assert.throws(()=>extractSummaryResult('<summary_result>- 人物醒来</summary_result>',{format:'archive'}));
});

test('planning and tail entries are independently selectable and parse the actual assistant prefill',async()=>{
  for(const thinkingTemplate of ['off','brief','plan'])for(const prefillTemplate of ['off','result','plan','gemini']){
    const settings={...DEFAULT_SETTINGS,promptBlocks:buildArchivePromptBlocks(false,{thinkingTemplate,prefillTemplate})};
    const compiled=await compilePrompt({promptBlocks:settings.promptBlocks,macroValues:{}},settings);
    assert.equal(compiled.orderedPrompts.filter(message=>message.role==='system').length,1);
    const thinking=THINKING_TEMPLATES[thinkingTemplate];if(thinking.head)assert(compiled.orderedPrompts.some(message=>message.content.includes(thinking.head)&&message.content.includes(thinking.tail)));
    assert.equal(compiled.prefill,PREFILLS[prefillTemplate]);
    assert.equal(settings.promptBlocks.filter(block=>block.choiceGroup==='tail'&&block.enabled).length,1);
    if(compiled.prefill){
      assert.equal(compiled.orderedPrompts.at(-1).content,compiled.prefill);
      const continuation = prefillTemplate === 'plan' ? 'PASS</archive_plan>\n<summary_result>\n' : '';
      assert.equal(extractSummaryResult(continuation+timelineBody+'</summary_result>',{format:'legacy',prefill:compiled.prefill}),timelineBody);
    }
  }
});

test('worldbook material includes only before and after context, excluding all depth entries',async()=>{
  books.book=[{name:'总结0-1楼',content:'OWN_MEMORY'}];
  globalThis.SillyTavern.getCharacterCardFields=()=>({description:'CHARACTER',personality:'PERSONALITY',persona:'PERSONA',scenario:'SCENARIO'});
  let dryRun,scanData;globalThis.SillyTavern.getWorldInfoPrompt=async(text,budget,dry,globalScanData)=>{dryRun=dry;scanData=globalScanData;return {worldInfoBefore:'BEFORE\nOWN_MEMORY',worldInfoAfter:'AFTER',worldInfoDepth:[{entries:['EXTERNAL_DEPTH','OWN_MEMORY']}]};};
  const compiled=await compilePrompt({promptBlocks:DEFAULT_SETTINGS.promptBlocks,mergedChatText:'MATERIAL'},DEFAULT_SETTINGS);
  const world=compiled.orderedPrompts.find(message=>message.content.startsWith('<world_and_characters>'));
  assert.equal(world.role,'user');assert(!world.content.includes('EXTERNAL_DEPTH'));assert(!world.content.includes('OWN_MEMORY'));assert(world.content.includes('CHARACTER'));assert.equal(dryRun,true);
  // Builds between ST c292f6416 and 4177c829d read globalScanData.trigger without a default.
  assert.equal(scanData?.trigger,'normal');for(const key of ['personaDescription','characterDescription','characterPersonality','characterDepthPrompt','scenario','creatorNotes'])assert.equal(scanData[key],'');
});

test('old prompt settings migrate to selectable entries while preserving edited lists and roles',()=>{
  const raw={...structuredClone(DEFAULT_SETTINGS),...structuredClone(PREVIOUS_ARCHIVE_PROMPTS),promptVersion:2,resultFormat:'free'};
  const migrated=migrateOldSettings(structuredClone(raw));assert.equal(migrated.promptVersion,5);assert.deepEqual(migrated.promptBlocks,DEFAULT_SETTINGS.promptBlocks);
  assert.deepEqual(migrateOldSettings({...summarySnapshot(raw),promptVersion:2}).promptBlocks,DEFAULT_SETTINGS.promptBlocks);
  raw.promptBlocks[1].content='用户自己写的格式';raw.promptBlocks[1].role='assistant';raw.resultFormat='archive';
  const custom=migrateOldSettings(structuredClone(raw));assert.deepEqual(custom.promptBlocks.slice(0,raw.promptBlocks.length),raw.promptBlocks);assert.equal(activeResultFormat(custom.promptBlocks),'archive');assert.deepEqual(migrateOldSettings(structuredClone(custom)),custom);
  const compact=migrateOldSettings({...structuredClone(PREVIOUS_COMPACT_PROMPTS),promptVersion:3,resultFormat:'archive',prefillTemplate:'result',thinkingTemplate:'brief',includeDepthWorldbook:true,noTransTag:true});
  assert.equal(compact.promptBlocks.length,14);assert.equal(activeResultFormat(compact.promptBlocks),'archive');assert(compact.promptBlocks.find(block=>block.id==='tail_prefill').enabled);assert(!compact.promptBlocks.find(block=>block.id==='tail_instruction').enabled);
  for(const key of ['resultFormat','thinkingTemplate','prefillTemplate','includeDepthWorldbook','noTransTag'])assert(!Object.hasOwn(compact,key));
});

test('V4 defaults upgrade while format, planning and tail selections migrate independently', () => {
  const stock = migrateOldSettings({ promptVersion: 4, ...structuredClone(PREVIOUS_V4_PROMPTS) });
  assert.deepEqual(stock.promptBlocks, DEFAULT_SETTINGS.promptBlocks);
  assert.deepEqual(stock.megaPromptBlocks, DEFAULT_SETTINGS.megaPromptBlocks);
  for (const [format, check, prefill, planId, tailId] of [
    ['archive', null, null, undefined, 'tail_instruction'],
    ['free', 'check_brief', PREFILLS.result, 'check_brief', 'tail_prefill'],
    ['legacy', 'check_destined', '<archive_check>核对完成。</archive_check>\n<summary_result>\n', 'plan_structured', 'tail_prefill_plan'],
  ]) {
    const promptBlocks = structuredClone(PREVIOUS_V4_PROMPTS.promptBlocks);
    for (const block of promptBlocks) {
      if (block.choiceGroup === 'format') block.enabled = block.id === `format_${format}`;
      if (block.choiceGroup === 'check') block.enabled = block.id === check;
      if (block.choiceGroup === 'tail') block.enabled = block.id === (prefill ? 'tail_prefill' : 'tail_instruction');
      if (block.id === 'tail_prefill' && prefill) block.content = prefill;
    }
    const migrated = summarySnapshot(migrateOldSettings({ promptVersion: 4, promptBlocks }));
    const enabled = group => migrated.promptBlocks.find(block => block.choiceGroup === group && block.enabled)?.id;
    assert.equal(activeResultFormat(migrated.promptBlocks), format);
    assert.equal(enabled('adapter'), 'jailbreak');
    assert.equal(enabled('plan'), planId);
    assert.equal(enabled('tail'), tailId);
  }
});

test('V4 edited lists keep ordering, custom content and roles through V5', async () => {
  const promptBlocks = structuredClone(PREVIOUS_V4_PROMPTS.promptBlocks);
  promptBlocks[0].content += '\n{{summary.depth}}';
  promptBlocks[0].role = 'user';
  promptBlocks[1].enabled = false;
  promptBlocks.splice(1, 0, promptBlocks.pop(), { id: 'custom-history', type: 'old_summary', role: 'user', enabled: true, name: '自定义来源' });
  const migrated = summarySnapshot(migrateOldSettings({ promptVersion: 4, promptBlocks: structuredClone(promptBlocks) }));
  assert.deepEqual(migrated.promptBlocks, promptBlocks);
  assert.deepEqual(migrateOldSettings(structuredClone(migrated)), migrated);
  const compiled = await compilePrompt({ promptBlocks, macroValues: {} }, migrated);
  assert.equal(compiled.orderedPrompts[0].role, 'user');
  assert.match(compiled.orderedPrompts[0].content, /你是独立的第三方剧情档案员/);
});

test('V1 through V5 prompt files update only the prompt lists and custom macros', () => {
  const settings = { ...DEFAULT_SETTINGS, excludeTags: [], triggerFloorCount: 42 };
  const format = 'destined-summary-prompts';
  const sources = [PRESET_PROMPTS, PREVIOUS_ARCHIVE_PROMPTS, PREVIOUS_COMPACT_PROMPTS, PREVIOUS_V4_PROMPTS, DEFAULT_SETTINGS];
  for (const [index, source] of sources.entries()) {
    const raw = {
      ...source, format, version: index + 1, triggerFloorCount: 100, excludeTags: ['custom'],
      customMacros: [{ name: 'example', content: '示例' }], customApiKey: 'ignored',
    };
    const data = readPromptFile(raw, settings);
    assert.equal(data.promptVersion, 5);
    assert.deepEqual(data.promptBlocks, DEFAULT_SETTINGS.promptBlocks);
    assert.deepEqual(data.megaPromptBlocks, DEFAULT_SETTINGS.megaPromptBlocks);
    assert.deepEqual(data.customMacros, raw.customMacros);
    assert.equal(data.triggerFloorCount, 42);
    assert.deepEqual(data.excludeTags, []);
    assert(!Object.hasOwn(data, 'customApiKey'));
  }
  assert.throws(() => readPromptFile({ format, version: 6 }, settings), /不支持/);
  const legacy = readPromptFile({ format, summaryInstruction: 'V1 独立末尾条目' }, settings);
  assert.equal(legacy.promptBlocks.at(-1).content, 'V1 独立末尾条目');
});

test('choice groups allow a single enabled entry and adapter blocks insist on an active head', async () => {
  for (const choiceGroup of ['adapter', 'format', 'plan', 'check', 'tail']) {
    const block = { id: 'a', type: 'prompt', name: 'A', enabled: true, role: 'system', content: 'A', choiceGroup };
    assert.throws(() => summarySnapshot({ promptBlocks: [block, { ...block, id: 'b' }] }), /只能启用一个/);
    assert.equal(summarySnapshot({ promptBlocks: [block, { ...block, id: 'b', enabled: false }] }).promptBlocks.length, 2);
  }
  const heads = DEFAULT_SETTINGS.promptBlocks.filter(block => block.choiceGroup === 'adapter');
  const inactive = heads.map(block => ({ ...block, enabled: false }));
  assert.throws(() => summarySnapshot({ promptBlocks: inactive }), /须启用一个头部/);
  const compiled = await compilePrompt({ promptBlocks: inactive, macroValues: {} }, DEFAULT_SETTINGS);
  assert.deepEqual(compiled.orderedPrompts[0], { role: 'system', content: ADAPTER_PROMPTS.standard });
  const adapted = buildArchivePromptBlocks(false, { adapterMode: 'gemini', prefillTemplate: 'gemini' });
  const request = await compilePrompt({ promptBlocks: adapted, macroValues: {} }, DEFAULT_SETTINGS);
  assert.deepEqual(request.orderedPrompts[0], { role: 'system', content: ADAPTER_PROMPTS.gemini });
  assert.equal(request.prefill, '');
  assert.match(request.orderedPrompts.at(-1).content, /Native reasoning is the single word "Ready"/);
});

test('legacy individual prompt fields retain the custom output instruction and its role', () => {
  const migrated=migrateOldSettings({jailbreakPrompt:'自定义身份',summaryRulesPrompt:'自定义记录规则',summaryInstruction:'保留这段原来的输出要求',summaryInstructionRole:'assistant'});
  assert.equal(migrated.promptBlocks.find(block=>block.id==='jailbreak').content,'自定义身份');
  assert.equal(migrated.promptBlocks.find(block=>block.id==='summary_rules').content,'自定义记录规则');
  const tail=migrated.promptBlocks.find(block=>block.id==='summary_instruction');
  assert.equal(tail.content,'保留这段原来的输出要求');assert.equal(tail.role,'assistant');
  assert.deepEqual(migrateOldSettings(structuredClone(migrated)),migrated);
});

test('legacy dynamic material entries become editable macro prompts without losing their source',async()=>{
  const raw={promptVersion:3,promptBlocks:[{id:'old',name:'旧记忆',enabled:true,type:'old_summary',role:'assistant'},{id:'source',name:'来源',enabled:true,type:'chat_messages',role:'user',leadText:'只看本次',xmlTag:'old_tag'},{id:'world',name:'背景',type:'builtin_group',enabled:true}]};
  const migrated=migrateOldSettings(raw);assert(migrated.promptBlocks.every(block=>block.type==='prompt'));
  assert.equal(migrated.promptBlocks[0].role,'assistant');assert(migrated.promptBlocks[0].content.includes('{{summary.history}}'));assert(migrated.promptBlocks[1].content.includes('<old_tag>'));assert(migrated.promptBlocks[1].content.startsWith('只看本次'));assert(migrated.promptBlocks[2].content.includes('{{summary.character}}'));
  migrated.promptBlocks[0].content='编辑后的自定义记忆条目';const compiled=await compilePrompt({promptBlocks:migrated.promptBlocks,macroValues:{}},DEFAULT_SETTINGS);assert.equal(compiled.orderedPrompts[0].content,'编辑后的自定义记忆条目');
});

test('explicit binding accepts every existing worldbook and preserves unrelated entries and global books', async () => {
  books.shared=[{name:'角色知识',content:'KEEP',uid:12}];globals=['shared','external'];
  await bindWorldbookToChat('shared');assert.equal(getActiveWorldbookName(),'shared');
  await upsertSummaryEntryByName('总结0-1楼','正文');
  assert(books.shared.some(entry=>entry.name==='角色知识'&&entry.content==='KEEP'));
  const result=await deleteBoundSummaryBook();assert.equal(result.keptOtherEntries,1);
  assert.deepEqual(books.shared,[{name:'角色知识',content:'KEEP',uid:12}]);assert.deepEqual(globals,['shared','external']);
  assert(!getActiveWorldbookName());assert(!getManagedSummaryBookNames().includes('shared'));
});

test('deleting a book prunes its catalog and externally deleted bindings restore owned hides', async () => {
  await saveSettings(FLOW_SETTINGS);seedFloors();await bindWorldbookToChat('book');
  await upsertSummaryEntryByName('总结0-3楼','正文');assert(messages[0].is_hidden);
  messages[9].is_hidden=true;delete books.book;
  await reconcileChatBinding();assert(!getActiveWorldbookName());assert.equal(chat.summary_assistant_binding_paused,true);
  assert(!getManagedSummaryBookNames().includes('book'));assert(!messages[0].is_hidden);assert(messages[9].is_hidden);
  await bindWorldbookToChat('new');await deleteBoundSummaryBook();
  assert(!books.new);assert(!getManagedSummaryBookNames().includes('new'));
});

test('default generation saves the timeline format and rejects arbitrary bullet summaries before hiding', async () => {
  await saveSettings(DEFAULT_SETTINGS);seedFloors(50);
  globalThis.generateRaw=async()=>'<summary_result>'+timelineBody+'</summary_result>';
  assert(await executeSummary(0,19,'总结0-19楼'));assert.equal(books.book[0].content,timelineBody);
  globalThis.generateRaw=async()=>'<summary_result>- **人物与觉醒**：人物醒来。</summary_result>';
  assert.equal(await executeSummary(20,39,'总结20-39楼'),false);assert.equal(getTask().errorKind,'format');
  assert(!books.book.some(entry=>entry.name==='总结20-39楼'));assert(messages.slice(20).every(message=>!message.is_hidden));
});

test('an opening with filtered material is fingerprinted and hidden only after a successful batch',async()=>{
  await saveSettings(FLOW_SETTINGS);seedFloors(30);messages[0]={message_id:0,role:'assistant',message:'<options>开局界面，没有剧情正文</options>',is_hidden:false};
  const params=await buildSummaryPromptParams(0,19);assert(!params.mergedChatText.includes('开局界面'));assert(params.sources.some(source=>source.id===0));
  globalThis.generateRaw=async()=>'<summary_result>事件档案</summary_result>';assert(await executeSummary(0,19,'总结0-19楼'));assert(messages[0].is_hidden);assert((await getCoverage()).floors.has(0));
  messages[0].message='<gametxt>修改过的开局剧情</gametxt>';await auditArchiveSources();await applySummarizedFloorsVisibility();assert(!messages[0].is_hidden);assert(!(await getCoverage()).floors.has(0));
  const tagged=await buildSummaryPromptParams(0,19);assert(tagged.mergedChatText.includes('第 0 楼'));assert(tagged.mergedChatText.includes('修改过的开局剧情'));
});
test('manual floor actions include zero, filter roles and pause automation until enabled again',async()=>{
  await saveSettings(FLOW_SETTINGS);seedFloors(30);await upsertSummaryEntryByName('总结0-9楼','档案');
  const {visibilitySnapshot,setManualFloorVisibility}=await import('../src/summary/visibility.js');
  assert.equal(visibilitySnapshot((await getCoverage()).floors).counts.total,30);
  await setManualFloorVisibility(0,9,false,'user');await applySummarizedFloorsVisibility();
  assert.equal(readVisibilityAutomation(),false);
  assert(!messages[0].is_hidden);assert(messages[1].is_hidden);assert.equal(visibilitySnapshot().counts.hidden,5);
  setFloorVisibilityAutomation(true);await applySummarizedFloorsVisibility();assert(messages.slice(0,10).every(message=>message.is_hidden));
  await setManualFloorVisibility(0,29,false);await applySummarizedFloorsVisibility();assert.equal(visibilitySnapshot().counts.shown,30);
  await assert.rejects(setManualFloorVisibility(-1,2,true),/整数楼层/);
});

test('hide summarized floors runs once; enabling automation clears choices across gaps too',async()=>{
  await saveSettings({...FLOW_SETTINGS,autoHideSummarizedFloors:false});seedFloors(30);
  await upsertSummaryEntryByName('总结0-3楼','第一段');await upsertSummaryEntryByName('总结6-9楼','第二段');
  const {setManualFloorVisibilityByIds,setManualFloorVisibility,readVisibilityOverrides}=await import('../src/summary/visibility.js');
  const {floors}=await getCoverage();await setManualFloorVisibilityByIds(floors,true);
  await getAllSummaryEntriesForDisplay();await autoTriggerSummary();await applySummarizedFloorsVisibility();
  assert([...floors].every(id=>messages[id].is_hidden));assert(!messages[4].is_hidden&&!messages[5].is_hidden);
  // Native changes after a one-shot action must not be forced back on refresh.
  messages[0].is_hidden=false;await applySummarizedFloorsVisibility();assert(!messages[0].is_hidden);
  await setManualFloorVisibility(0,29,true);
  setFloorVisibilityAutomation(true);await applySummarizedFloorsVisibility();
  assert([...floors].every(id=>messages[id].is_hidden));assert(!messages[4].is_hidden&&!messages[5].is_hidden);
  assert.equal(readVisibilityAutomation(false),true);assert.deepEqual(readVisibilityOverrides(),{});
});

test('enabling automation removes all assistant overrides and preserves other variables and archives',async()=>{
  await saveSettings(FLOW_SETTINGS);seedFloors(30);await upsertSummaryEntryByName('总结0-9楼','保留的总结正文');
  const {setManualFloorVisibility,readVisibilityOverrides}=await import('../src/summary/visibility.js');
  await setManualFloorVisibility(0,29,false);
  chat.other_extension={nested:{keep:true},list:[1,2,3]};const beforeBooks=structuredClone(books),beforeScript=structuredClone(script);
  setFloorVisibilityAutomation(true);await applySummarizedFloorsVisibility();
  assert(messages.slice(0,10).every(message=>message.is_hidden));assert(messages.slice(10).every(message=>!message.is_hidden));
  assert.deepEqual(readVisibilityOverrides(),{});
  assert.deepEqual(chat.other_extension,{nested:{keep:true},list:[1,2,3]});assert.deepEqual(books,beforeBooks);assert.deepEqual(script,beforeScript);
});

test('a dropped variable replacement is still detected before changing any floor visibility',async()=>{
  await saveSettings(FLOW_SETTINGS);seedFloors(30);await upsertSummaryEntryByName('总结0-9楼','保留档案');
  const {setManualFloorVisibility,readVisibilityOverrides}=await import('../src/summary/visibility.js');
  await setManualFloorVisibility(0,29,false);const before=readVisibilityOverrides(),replace=globalThis.replaceVariables;
  globalThis.replaceVariables=(value,option)=>{if(option.type!=='chat')replace(value,option);};
  assert.throws(()=>setFloorVisibilityAutomation(true),/持久化校验失败/);
  assert.deepEqual(readVisibilityOverrides(),before);assert(messages.every(message=>!message.is_hidden));
});

test('enabling automation without summaries clears manual states and restores only assistant-managed floors',async()=>{
  await saveSettings(FLOW_SETTINGS);seedFloors(12);messages[11].is_hidden=true;
  const {setManualFloorVisibility,readVisibilityOverrides,visibilitySnapshot}=await import('../src/summary/visibility.js');
  await setManualFloorVisibility(0,9,true);await setManualFloorVisibility(2,3,false);
  assert.equal(readVisibilityAutomation(),false);
  setFloorVisibilityAutomation(true);await applySummarizedFloorsVisibility();
  assert.equal(readVisibilityAutomation(),true);assert.deepEqual(readVisibilityOverrides(),{});
  assert(messages.slice(0,11).every(message=>!message.is_hidden));assert(messages[11].is_hidden);
  assert(visibilitySnapshot().groups.filter(group=>group.to<11).every(group=>group.state==='显示'));
  assert.deepEqual(chat.summary_assistant_auto_hidden_floors,[]);
});

test('the automation switch saves in empty chats and remains separate from other chats and configurations',async()=>{
  await saveSettings({...FLOW_SETTINGS,autoHideSummarizedFloors:false});const beforeScript=structuredClone(script);
  setFloorVisibilityAutomation(true);await applySummarizedFloorsVisibility();
  assert.equal(readVisibilityAutomation(false),true);assert.deepEqual(chat.summary_assistant_visibility_overrides,{});
  const firstChat=structuredClone(chat);ctx.chatId='b';chat={};
  assert.equal(readVisibilityAutomation(false),false);setFloorVisibilityAutomation(false);
  const secondChat=structuredClone(chat);ctx.chatId='a';chat=firstChat;
  assert.equal(readVisibilityAutomation(false),true);assert.equal(secondChat[VISIBILITY_AUTOMATION_KEY],false);
  assert.deepEqual(script,beforeScript);assert(!Object.hasOwn(summarySnapshot(getSettings()),VISIBILITY_AUTOMATION_KEY));
});

test('old manual choices migrate to a paused policy until the chat explicitly enables automation',async()=>{
  await saveSettings(FLOW_SETTINGS);seedFloors(12);
  const {setManualFloorVisibility}=await import('../src/summary/visibility.js');
  await setManualFloorVisibility(0,3,false);delete chat[VISIBILITY_AUTOMATION_KEY];
  assert.equal(readVisibilityAutomation(true),false);
  setFloorVisibilityAutomation(true);assert.equal(readVisibilityAutomation(false),true);
});

test('manual actions pause hiding for later generated summaries and automation catches up when enabled',async()=>{
  await saveSettings(FLOW_SETTINGS);seedFloors(30);await upsertSummaryEntryByName('总结0-3楼','第一段');
  const {setManualFloorVisibility}=await import('../src/summary/visibility.js');
  await setManualFloorVisibility(0,3,false);
  globalThis.generateRaw=async()=>'<summary_result>后续总结</summary_result>';
  await executeSummary(4,9,'总结4-9楼');
  assert.equal(getTask().phase,'complete');assert(books.book.some(entry=>entry.name==='总结4-9楼'));
  assert(messages.slice(0,10).every(message=>!message.is_hidden));
  setFloorVisibilityAutomation(true);await applySummarizedFloorsVisibility();assert(messages.slice(0,10).every(message=>message.is_hidden));
  setFloorVisibilityAutomation(false);await deleteSummaryEntry('总结4-9楼');
  assert(messages.slice(0,4).every(message=>message.is_hidden));assert(messages.slice(4,10).every(message=>!message.is_hidden));
});

test('discussion visibility hides native and pure legacy records bracketed by covered story sources',async()=>{
  await saveSettings({...FLOW_SETTINGS,autoHideSummarizedFloors:false});
  messages=[
    {message_id:0,role:'user',message:'剧情 0',is_hidden:false},
    {message_id:1,role:'assistant',message:'有原生标记的讨论',extra:{destined_discussion:{version:1,mode:'discussion'}},is_hidden:false},
    {message_id:2,role:'assistant',message:'剧情 2',is_hidden:false},
    {message_id:3,role:'assistant',message:'<!--旧记录--><discussion_record note="a > b">旧讨论</discussion_record>',is_hidden:false},
    {message_id:4,role:'assistant',message:'<discussion_record>附带片段</discussion_record><gametxt>剧情 4</gametxt>',is_hidden:false},
    {message_id:5,role:'user',message:'<discussion_record>用户引用</discussion_record>',is_hidden:false},
    {message_id:6,role:'assistant',message:'<destined_discussion>讨论尾部</destined_discussion>',is_hidden:false},
  ];
  await upsertSummaryEntryByName('总结0-6楼','档案');
  chat[ARCHIVE_VAR_KEY]={book:{records:{'总结0-6楼':{sources:messages.map(sourceOf)}}}};
  const coverage=await getCoverage();
  assert.deepEqual([...coverage.floors],[0,2,4,5]);
  setFloorVisibilityAutomation(true);await applySummarizedFloorsVisibility();
  assert.deepEqual(messages.map(message=>!!message.is_hidden),[true,true,true,true,true,true,false]);
  const {visibilitySnapshot}=await import('../src/summary/visibility.js');
  const snapshot=visibilitySnapshot(coverage.floors);
  assert.deepEqual([...snapshot.discussionFloors],[1,3]);
  assert.equal(snapshot.counts.covered,4);
  const {discussionRecordPage}=await import('../src/summary/ui/discussionRecords.js');
  assert.deepEqual(discussionRecordPage(snapshot).records.map(record=>record.message_id),[6,3,1]);
});

test('discussion visibility excludes discussion-only and unbracketed records from coverage and automation',async()=>{
  await saveSettings({...FLOW_SETTINGS,autoHideSummarizedFloors:false});
  messages=[
    {message_id:0,role:'assistant',message:'首段讨论',extra:{destined_discussion:{version:1,mode:'discussion'}},is_hidden:false},
    {message_id:1,role:'assistant',message:'剧情 1',is_hidden:false},
    {message_id:2,role:'assistant',message:'中间讨论',extra:{destined_discussion:{version:1,mode:'discussion'}},is_hidden:false},
    {message_id:3,role:'assistant',message:'未覆盖剧情',is_hidden:false},
    {message_id:4,role:'assistant',message:'最新讨论',extra:{destined_discussion:{version:1,mode:'discussion'}},is_hidden:false},
  ];
  await upsertSummaryEntryByName('总结0-4楼','档案');
  // A provenance record must not make a discussion record part of story coverage.
  chat[ARCHIVE_VAR_KEY]={book:{records:{'总结0-4楼':{sources:[0,1,2].map(id=>sourceOf(messages[id]))}}}};
  const coverage=await getCoverage();
  assert.deepEqual([...coverage.floors],[1]);
  setFloorVisibilityAutomation(true);await applySummarizedFloorsVisibility();
  assert.deepEqual(messages.map(message=>!!message.is_hidden),[false,true,false,false,false]);
});

test('discussion choices are scoped, source-guarded, and restore to automatic visibility',async()=>{
  await saveSettings({...FLOW_SETTINGS,autoHideSummarizedFloors:false});
  messages=[
    {message_id:0,role:'user',message:'剧情 0',is_hidden:false},
    {message_id:1,role:'assistant',message:'<destined_discussion>旧讨论 1</destined_discussion>',is_hidden:false},
    {message_id:2,role:'assistant',message:'剧情 2',is_hidden:false},
    {message_id:3,role:'assistant',message:'讨论 3',extra:{destined_discussion:{version:1,mode:'discussion'}},is_hidden:false},
    {message_id:4,role:'assistant',message:'剧情 4',is_hidden:false},
  ];
  await upsertSummaryEntryByName('总结0-4楼','档案');
  chat[ARCHIVE_VAR_KEY]={book:{records:{'总结0-4楼':{sources:[0,2,4].map(id=>sourceOf(messages[id]))}}}};
  const {floors}=await getCoverage();
  const {setManualFloorVisibilityByIds,readVisibilityOverrides,restoreDiscussionVisibilityAutomation}=await import('../src/summary/visibility.js');
  const first=sourceOf(messages[1]), second=sourceOf(messages[3]);
  setFloorVisibilityAutomation(true);await applySummarizedFloorsVisibility();
  assert(messages.every(message=>message.is_hidden));
  await setManualFloorVisibilityByIds([1],false,{discussionSources:[first]});
  assert.equal(readVisibilityAutomation(),true);
  assert.deepEqual(readVisibilityOverrides()[1],{hidden:false,fingerprint:first.fingerprint,scope:'discussion'});
  await applySummarizedFloorsVisibility();
  assert.equal(messages[1].is_hidden,false);assert.equal(messages[3].is_hidden,true);
  // Re-enabling global automation does not erase a separate discussion decision.
  setFloorVisibilityAutomation(true);await applySummarizedFloorsVisibility();
  assert.equal(messages[1].is_hidden,false);assert.equal(messages[3].is_hidden,true);
  await assert.rejects(setManualFloorVisibilityByIds([3],false,{discussionSources:[first]}),/讨论记录已变化/);
  const stale={...second};messages[3].swipe_id=1;
  assert.throws(()=>restoreDiscussionVisibilityAutomation([stale]),/讨论记录已变化/);
  messages[3].swipe_id=0;
  restoreDiscussionVisibilityAutomation([first]);await applySummarizedFloorsVisibility();
  assert.equal(readVisibilityOverrides()[1],undefined);assert.equal(messages[1].is_hidden,true);
  await applySummarizedFloorsVisibility({autoHide:false});
  assert(messages.every(message=>!message.is_hidden));
  assert.deepEqual([...floors],[0,2,4]);
});

test('discussion visibility writes retain the existing persistence and chat-context guards',async()=>{
  await saveSettings(FLOW_SETTINGS);
  messages=[{message_id:0,role:'assistant',message:'讨论',extra:{destined_discussion:{version:1,mode:'discussion'}},is_hidden:false}];
  const {setManualFloorVisibilityByIds}=await import('../src/summary/visibility.js');
  const source=sourceOf(messages[0]), replace=globalThis.replaceVariables;
  globalThis.replaceVariables=(value,option)=>{if(option.type!=='chat')replace(value,option);};
  await assert.rejects(setManualFloorVisibilityByIds([0],true,{discussionSources:[source]}),/持久化校验失败/);
  assert.equal(messages[0].is_hidden,false);
  globalThis.replaceVariables=replace;
  const write=globalThis.setChatMessages;
  globalThis.setChatMessages=async updates=>{ctx.chatId='other';await write(updates);};
  await assert.rejects(setManualFloorVisibilityByIds([0],true,{discussionSources:[source]}),{name:'AbortError'});
  assert.equal(messages[0].is_hidden,true);
});

test('discussion coverage helper requires contiguous covered story boundaries',async()=>{
  const {discussionFloorsWithinCoverage}=await import('../src/summary/visibility.js');
  const discussion=(message_id)=>({message_id,extra:{destined_discussion:{version:1,mode:'discussion'}}});
  assert.deepEqual([...discussionFloorsWithinCoverage([discussion(0),discussion(1)],new Set([0,1]))],[]);
  assert.deepEqual([...discussionFloorsWithinCoverage([{message_id:0},discussion(1),{message_id:3}],new Set([0,3]))],[]);
  assert.deepEqual([...discussionFloorsWithinCoverage([{message_id:0},discussion(1),{message_id:2}],new Set([0]))],[]);
  assert.deepEqual([...discussionFloorsWithinCoverage([{message_id:0},discussion(1),{message_id:2}],new Set([0,2]))],[1]);
});

test('losing disabled or invalid story coverage restores assistant-hidden discussions',async()=>{
  await saveSettings({...FLOW_SETTINGS,autoHideSummarizedFloors:false});
  messages=[
    {message_id:0,role:'user',message:'剧情 0',is_hidden:false},
    {message_id:1,role:'assistant',message:'讨论',extra:{destined_discussion:{version:1,mode:'discussion'}},is_hidden:false},
    {message_id:2,role:'assistant',message:'剧情 2',is_hidden:false},
  ];
  await upsertSummaryEntryByName('总结0-2楼','档案');
  chat[ARCHIVE_VAR_KEY]={book:{records:{'总结0-2楼':{sources:[0,2].map(id=>sourceOf(messages[id]))}}}};
  setFloorVisibilityAutomation(true);await applySummarizedFloorsVisibility();
  assert(messages.every(message=>message.is_hidden));
  await setSummaryEntryEnabled('总结0-2楼',false);
  assert(messages.every(message=>!message.is_hidden));
  await setSummaryEntryEnabled('总结0-2楼',true);await applySummarizedFloorsVisibility();
  assert(messages.every(message=>message.is_hidden));
  messages[2].message='已修改的剧情';await auditArchiveSources();await applySummarizedFloorsVisibility();
  assert.equal(books.book[0].enabled,false);assert(messages.every(message=>!message.is_hidden));
});

test('clearing task logs preserves active and pending results; completed logs never delete archives',async()=>{
  await saveSettings(FLOW_SETTINGS);seedFloors();await upsertSummaryEntryByName('总结0-3楼','保留档案');
  const task=beginTask({startFloor:4,endFloor:9});updateTask(task,{phase:'generating',body:'待保存正文',raw:'原始结果'},{save:true});
  clearTaskLog();assert.equal(getTask().running,true);assert.deepEqual(getTask().log,[]);assert.equal(getTask().body,'待保存正文');
  finishTask(task,{phase:'pending',errorKind:'save'});clearTaskLog();restoreTaskState();
  assert.equal(getTask().phase,'pending');assert.equal(getTask().raw,'原始结果');assert.deepEqual(getTask().log,[]);
  const original=globalThis.replaceVariables;globalThis.replaceVariables=()=>{throw Error('disk failed');};
  const before=getTask();assert.throws(clearTaskLog,/disk failed/);assert.deepEqual(getTask(),before);globalThis.replaceVariables=original;
  const resumed=beginTask(before.spec,before);finishTask(resumed,{phase:'complete'});clearTaskLog();restoreTaskState();
  assert.equal(getTask(),null);assert.equal(books.book[0].content,'保留档案');
});

test('a triggered round drains its eligible range in balanced target-sized batches',async()=>{
  for(const limit of [20,30]){
    reset();await saveSettings({...FLOW_SETTINGS,enabled:true,triggerFloorCount:50,keepFloorCount:10,batchFloorCount:limit});seedFloors(50);
    const requests=[];globalThis.generateRaw=async config=>{requests.push(config);return '<summary_result>批次记忆'+requests.length+'</summary_result>';};
    const plans=await computeSummaryPlans();
    assert.deepEqual(plans.map(plan=>[plan.startFloor,plan.endFloor]),[[0,19],[20,39]]);
    assert(plans.every(plan=>plan.floorCount<=Math.floor(limit*1.2)&&messages[plan.endFloor].role==='assistant'));
    await autoTriggerSummary();assert.equal(requests.length,2);assert.equal(getTask().phase,'complete');
    assert(requests[1].ordered_prompts.some(prompt=>prompt.content.includes('批次记忆1')));
    assert(messages.slice(0,40).every(message=>message.is_hidden));assert(messages.slice(40).every(message=>!message.is_hidden));
    assert(getTask().batches.every(batch=>batch.phase==='complete'));
    assert.deepEqual(books.book.map(entry=>entry.name),plans.map(plan=>plan.entryName));
  }
});

test('parallel generation stays bounded and saves each group in floor order despite reversed completion',async()=>{
  await saveSettings({...FLOW_SETTINGS,enabled:true,triggerFloorCount:70,keepFloorCount:10,batchFloorCount:20,parallelBatches:true,batchConcurrency:2});seedFloors(70);
  const plans=await computeSummaryPlans();assert.equal(plans.length,3);assert(plans.every(plan=>plan.floorCount<=Math.floor(20*1.2)));
  const pending=[],requests=[];let active=0,peak=0;
  globalThis.generateRaw=config=>{requests.push(config);active++;peak=Math.max(peak,active);return new Promise(resolve=>pending.push(value=>{active--;resolve('<summary_result>'+value+'</summary_result>');}));};
  const run=autoTriggerSummary();await waitUntil(()=>pending.length===2);assert.equal(books.book.length,0);
  pending[1]('第二批');await nextTick();assert.equal(books.book.length,0);assert.equal(getTask().batches[1].body,'第二批');
  pending[0]('第一批');await waitUntil(()=>pending.length===3);
  assert.deepEqual(books.book.map(entry=>entry.name),plans.slice(0,2).map(plan=>plan.entryName));
  assert(requests[2].ordered_prompts.some(prompt=>prompt.content.includes('第一批')&&prompt.content.includes('第二批')));
  assert(!requests[1].ordered_prompts.some(prompt=>prompt.content.includes('第一批')));
  pending[2]('第三批');await run;assert.equal(peak,2);assert.equal(requests.length,3);assert.equal(getTask().phase,'complete');
});

test('a failed parallel batch preserves successful siblings and retries only unfinished batches after reload',async()=>{
  await saveSettings({...FLOW_SETTINGS,enabled:true,triggerFloorCount:70,keepFloorCount:10,batchFloorCount:20,parallelBatches:true,batchConcurrency:2});seedFloors(70);
  const plans=await computeSummaryPlans();
  let calls=0;globalThis.generateRaw=async()=>{if(++calls===1)throw Object.assign(Error('denied'),{status:401});return '<summary_result>第二批成功</summary_result>';};
  await autoTriggerSummary();assert.equal(calls,2);assert.equal(getTask().phase,'pending');assert.deepEqual(books.book.map(entry=>entry.name),[plans[1].entryName]);
  assert.deepEqual(getTask().batches.map(batch=>batch.phase),['pending','complete','queued']);
  restoreTaskState();globalThis.generateRaw=async()=>{calls++;return '<summary_result>恢复批次</summary_result>';};
  await retryTask();assert.equal(calls,4);assert.equal(getTask().phase,'complete');assert.equal(books.book.find(entry=>entry.name===plans[1].entryName).content,'第二批成功');
  assert(messages.slice(0,60).every(message=>message.is_hidden));
});

test('a batch with no AI text after filtering can retry after changing the tags',async()=>{
  await saveSettings({...FLOW_SETTINGS,excludeTags:['narrative']});
  seedFloors(2);
  messages[1].message='<narrative>原来的剧情</narrative>';
  const requests=[];
  globalThis.generateRaw=async config=>{requests.push(config);return '<summary_result>恢复后的总结</summary_result>';};

  assert.equal(await executeSummary(0,1,'总结0-1楼'),false);
  assert.equal(getTask().phase,'pending');
  assert.equal(getTask().errorKind,'material');
  assert.match(getTask().message,/AI 正文/);
  assert.equal(requests.length,0);
  assert.deepEqual(books.book,[]);
  assert(messages.every(message=>!message.is_hidden));

  restoreTaskState();
  assert.equal(getTask().errorKind,'material');
  await updateSettings({includeTags:['narrative']});
  assert.equal(await retryTask(),true);
  assert.equal(requests.length,1);
  assert(requests[0].ordered_prompts.some(prompt=>prompt.content.includes('原来的剧情')));
  assert.equal(books.book[0].content,'恢复后的总结');
  assert.equal(getTask().phase,'complete');
});

test('skipping a batch with no AI text keeps the original floors and resumes later batches',async()=>{
  await saveSettings({...FLOW_SETTINGS,enabled:true,triggerFloorCount:82,keepFloorCount:10,batchFloorCount:20});
  seedFloors(82);
  for(const message of messages.slice(24,48)) {
    if(message.role==='assistant')message.message=`<summary>没有可用正文 ${message.message_id}</summary>`;
  }
  const skippedMessages=structuredClone(messages.slice(24,48));
  const requests=[];
  globalThis.generateRaw=async config=>{requests.push(config);return `<summary_result>总结 ${requests.length}</summary_result>`;};

  await autoTriggerSummary();
  assert.equal(requests.length,1);
  assert.deepEqual(getTask().batches.map(batch=>batch.phase),['complete','pending','queued']);
  assert.equal(getTask().batches[1].errorKind,'material');
  assert.match(getTask().message,/AI 正文/);
  assert.deepEqual(books.book.map(entry=>entry.name),['总结0-23楼']);
  assert.deepEqual(messages.slice(24,48),skippedMessages);
  const firstEntry=structuredClone(books.book[0]);
  const firstRecord=readArchive().records['总结0-23楼'];

  assert.equal(await retryTask(),false);
  assert.equal(getTask().errorKind,'material');
  assert(!getTask().log.some(entry=>entry.phase==='generating'));
  assert.equal(requests.length,1);

  skipPendingTask();
  assert.deepEqual(readArchive().excluded,[{start:24,end:47}]);
  assert.deepEqual(getTask().batches.map(batch=>batch.phase),['complete','skipped','queued']);
  assert.equal(await retryTask(),true);
  assert.equal(requests.length,2);
  assert.deepEqual(getTask().batches.map(batch=>batch.phase),['complete','skipped','complete']);
  assert.deepEqual(books.book.map(entry=>entry.name),['总结0-23楼','总结48-71楼']);
  assert.deepEqual(books.book[0],firstEntry);
  assert.deepEqual(readArchive().records['总结0-23楼'],firstRecord);
  assert.deepEqual(messages.slice(24,48),skippedMessages);
  assert.deepEqual(await computeSummaryPlans(),[]);
});

test('recovery reclassifies a legacy missing AI text error and preserves a 503 request error',()=>{
  const details='本次范围没有可归档的 AI 正文，请检查提取标签';
  const requestError={phase:'pending',errorKind:'request',message:'请求未完成，请检查连接后重试'};
  const batches=[details,'HTTP 503 Service Unavailable'].map((value,index)=>({
    ...requestError,details:value,spec:{kind:'normal',startFloor:index*20,endFloor:index*20+19},
  }));
  const key=contextKey();
  patchSummaryStore({summary_assistant_runtime:{[key]:{
    ...requestError,id:'legacy-errors',key,running:false,selectedBatch:0,details,
    spec:{kind:'batch',startFloor:0,endFloor:39,batches:batches.map(batch=>batch.spec)},batches,
  }}});

  restoreTaskState();
  const recovered=getTask();
  assert.equal(recovered.errorKind,'material');
  assert.equal(recovered.message,details);
  assert.equal(recovered.batches[0].errorKind,'material');
  assert.equal(recovered.batches[0].message,details);
  assert.deepEqual(recovered.batches[1],batches[1]);
});

test('stopping a parallel round cancels all its own requests and ignores late results',async()=>{
  await saveSettings({...FLOW_SETTINGS,enabled:true,triggerFloorCount:50,keepFloorCount:10,parallelBatches:true,batchConcurrency:2});seedFloors(50);
  const pending=[],ids=[],stops=[];globalThis.stopGenerationById=id=>stops.push(id);
  globalThis.generateRaw=config=>{ids.push(config.generation_id);return new Promise(resolve=>pending.push(resolve));};
  const run=autoTriggerSummary();await waitUntil(()=>pending.length===2);assert(stopTask());await run;
  assert.deepEqual(new Set(stops),new Set(ids));pending.forEach(resolve=>resolve('<summary_result>迟到正文</summary_result>'));await nextTick();
  assert.equal(books.book.length,0);assert.equal(getTask().phase,'stopped');assert(messages.every(message=>!message.is_hidden));
});

test('skipping one failed batch retains completed siblings and leaves queued work resumable',async()=>{
  await saveSettings({...FLOW_SETTINGS,enabled:true,triggerFloorCount:70,keepFloorCount:10,parallelBatches:true,batchConcurrency:2});seedFloors(70);
  let calls=0;globalThis.generateRaw=async()=>{if(++calls===1)throw Object.assign(Error('denied'),{status:401});return '<summary_result>可保留记录</summary_result>';};
  await autoTriggerSummary();skipPendingTask();assert.deepEqual(getTask().batches.map(batch=>batch.phase),['skipped','complete','queued']);
  globalThis.generateRaw=async()=>{calls++;return '<summary_result>最后一批</summary_result>';};await retryTask();
  assert.equal(calls,3);assert.equal(getTask().phase,'complete');assert.equal(books.book.length,2);assert(!(await getCoverage()).floors.has(0));
});

test('editing one failed batch saves just that selection without regenerating another failed batch',async()=>{
  await saveSettings({...FLOW_SETTINGS,enabled:true,triggerFloorCount:50,keepFloorCount:10,parallelBatches:true,batchConcurrency:2});seedFloors(50);
  let calls=0;globalThis.generateRaw=async()=>{calls++;throw Object.assign(Error('denied'),{status:401});};
  await autoTriggerSummary();selectTaskBatch(1);await retryTask('save','手动修复第二批');
  assert.equal(calls,2);assert.equal(getTask().phase,'pending');assert.equal(books.book[0].name,'总结20-39楼');assert.equal(books.book[0].content,'手动修复第二批');
  assert.equal(getTask().batches[0].phase,'pending');assert.equal(getTask().batches[1].phase,'complete');
});

test('custom and regenerated ranges stay one request and pause stops queuing after the active serial batch',async()=>{
  await saveSettings({...FLOW_SETTINGS,enabled:false,batchFloorCount:20});seedFloors(50);
  let calls=0;globalThis.generateRaw=async()=>{calls++;return '<summary_result>指定范围</summary_result>';};
  await executeSummary(0,39,'总结0-39楼');
  assert.equal(calls,1);assert.deepEqual(books.book.map(entry=>entry.name),['总结0-39楼']);
  assert(messages.slice(0,40).every(message=>message.is_hidden));assert(messages.slice(40).every(message=>!message.is_hidden));
  await regenerateAndReplaceEntry('总结0-39楼');
  assert.equal(calls,2);assert.deepEqual(books.book.map(entry=>entry.name),['总结0-39楼']);assert.equal(getTask().phase,'complete');
  reset();await saveSettings({...FLOW_SETTINGS,enabled:true,triggerFloorCount:50,keepFloorCount:10});seedFloors(50);
  assert.equal((await computeSummaryPlans()).length,2);
  calls=0;globalThis.generateRaw=async()=>{calls++;await updateSettings({enabled:false});return '<summary_result>暂停前完成</summary_result>';};
  await autoTriggerSummary();assert.equal(calls,1);assert.equal(books.book.length,1);assert.equal(getTask().batches[1].phase,'paused');
});

test('behavior migration upgrades old exclusion defaults and preserves custom settings',()=>{
  assert.deepEqual(DEFAULT_SETTINGS.excludeTags,DEFAULT_EXCLUDE_TAGS);assert.equal(DEFAULT_SETTINGS.behaviorVersion,2);assert.equal(DEFAULT_SETTINGS.megaTriggerCount,15);assert.equal(DEFAULT_SETTINGS.megaBatchCount,10);assert.equal(DEFAULT_SETTINGS.parallelBatches,false);
  const previous={...structuredClone(DEFAULT_SETTINGS),excludeTags:['think'],megaTriggerCount:8,megaBatchCount:6};delete previous.behaviorVersion;
  const migrated=migrateOldSettings(previous);assert.deepEqual(migrated.excludeTags,DEFAULT_EXCLUDE_TAGS);assert.equal(migrated.behaviorVersion,2);assert.equal(migrated.megaTriggerCount,15);assert.equal(migrated.megaBatchCount,10);
  assert.deepEqual(migrateOldSettings({...DEFAULT_SETTINGS,behaviorVersion:1,excludeTags:[]}).excludeTags,DEFAULT_EXCLUDE_TAGS);
  assert.deepEqual(migrateOldSettings({...DEFAULT_SETTINGS,behaviorVersion:1,excludeTags:['think']}).excludeTags,['think']);
  assert.deepEqual(migrateOldSettings({...DEFAULT_SETTINGS,excludeTags:[]}).excludeTags,[]);
  assert.equal(summarySnapshot({...DEFAULT_SETTINGS,behaviorVersion:1}).behaviorVersion,2);
  assert.deepEqual(migrateOldSettings({...previous,behaviorVersion:undefined,excludeTags:['hidden'],megaTriggerCount:12,megaBatchCount:9}).excludeTags,['hidden']);
  assert.deepEqual(migrateOldSettings({...DEFAULT_SETTINGS,excludeTags:['think']}).excludeTags,['think']);
});

test('tag exclusions apply inside extracted AI text and accept nested tags and attributes',()=>{
  const input=[{id:0,role:'assistant',message:'<think>不读取</think><gametxt>保留<hidden data-x="1">秘密<hidden>嵌套</hidden>内部</hidden>结尾</gametxt>'},{id:1,role:'user',message:'用户保留 <hidden>原文</hidden>'}];
  const result=processMessagesByTags(input,['gametxt'],['hidden'],true);
  assert.equal(result[0].content,'保留结尾');assert.equal(result[1].content,input[1].message);
  assert.equal(processMessagesByTags([{id:0,role:'assistant',message:'<gametxt>甲<think>正文中的思考</think>乙</gametxt>'}],['gametxt'],[],true)[0].content,'甲<think>正文中的思考</think>乙');
});

test('AI extraction follows document order, uses a union of matching blocks and skips public reasoning', () => {
  const message = `<recorder_thinking mode="a > b"><tp>假时间</tp><gametxt>假正文</gametxt></recorder_thinking>
    <archive_plan><gametxt>规划示例</gametxt></archive_plan>
    <gametxt data-note='a < b > c'>甲<style>样式</style><tp>嵌套地点</tp>乙<script>脚本</script><gametxt>嵌套正文</gametxt>丙</gametxt>
    <tp>后到的时间</tp><gametxt>续篇</gametxt>`;
  const [processed] = processMessagesByTags([{ id: 1, role: 'assistant', message }], ['tp', 'gametxt', 'tp'], [], true);
  assert.equal(processed.content, '甲<tp>嵌套地点</tp>乙<gametxt>嵌套正文</gametxt>丙\n后到的时间\n续篇');
  const [filtered] = processMessagesByTags([{ id: 1, role: 'assistant', message }], ['tp', 'gametxt'], ['tp'], true);
  assert.equal(filtered.content, '甲乙<gametxt>嵌套正文</gametxt>丙\n后到的时间\n续篇');
});

test('AI extraction falls back only when no include tag matches', () => {
  const input = [
    { id: 0, role: 'assistant', message: '<gametxt> \n </gametxt>标签外的文字' },
    { id: 1, role: 'assistant', message: '<gametxt><!-- 注释 --></gametxt>标签外的文字' },
    { id: 2, role: 'assistant', message: '<gametxt />标签外的文字' },
    { id: 3, role: 'assistant', message: '<gametxt><hidden>排除</hidden></gametxt>标签外的文字' },
    { id: 4, role: 'assistant', message: '<think><gametxt>思考示例</gametxt></think>未加标签的正文' },
    { id: 5, role: 'assistant', message: '<gametxt> </gametxt><gametxt>标签正文</gametxt>标签外的文字' },
  ];
  assert.deepEqual(
    processMessagesByTags(input, ['gametxt'], ['hidden'], true).map(({ id, content }) => [id, content]),
    [[4, '未加标签的正文'], [5, '标签正文']],
  );
});

test('AI fallback retains story and HTML details while removing reasoning, scripts and technical shells', () => {
  const message = `<recorder_output>思考前缀</thinking> </think><recorder_body>
<script data-token="a > b">const example = '<gametxt>脚本中的假正文</gametxt>';</script><style>div { color: red }</style>
<details data-x="a > b"> <summary>面板标题</summary>面板内容</details><summary>独立摘要</summary>
角色进入城门。</recorder_body><recorder_after_format><recorder_done/><options>选项</options></recorder_after_format></recorder_output>`;
  const input = [{ id: 1, role: 'assistant', message }, { id: 2, role: 'user', message: '<options>用户原文</options>' }];
  const [assistant, user] = processMessagesByTags(input, ['tp', 'gametxt'], DEFAULT_EXCLUDE_TAGS, true);
  assert.match(assistant.content, /<details data-x="a > b"> <summary>面板标题<\/summary>面板内容<\/details>/);
  assert.match(assistant.content, /角色进入城门/);
  assert.doesNotMatch(assistant.content, /思考前缀|假正文|<style|<script|<\/?recorder_|独立摘要|选项/);
  assert.equal(user.content, input[1].message);
  const [stray] = processMessagesByTags([{ id: 3, role: 'assistant', message: '普通剧情</thinking>后续描述。' }], ['gametxt'], [], true);
  assert.match(stray.content, /普通剧情.*后续描述/);
  const [system] = processMessagesByTags([{ id: 4, role: 'system', message: '<tp>时间</tp><gametxt>系统剧情<hidden>去除</hidden></gametxt>' }], ['gametxt'], ['hidden'], true);
  assert.equal(system.content, '系统剧情');
  const [details] = processMessagesByTags([{ id: 5, role: 'assistant', message: '<details><summary>标题</summary><think>保留</think></details>' }], ['gametxt'], [], true);
  assert.match(details.content, /<think>保留<\/think>/);
});

test('summary normalization strips public notes and accepts prefill echoes and wrapped formats', () => {
  const fake = '<summary_result>规划里的示例</summary_result>';
  const notes = `<thinking>${fake}</thinking><archive_plan>${fake}<think>标签示例</archive_plan><archive_check>${fake}</archive_check><archive_finalize>${fake}</archive_finalize>`;
  const body = '　---\r\n日期　｜ 城门 ：\r\n\t清晨\r\n　 抵达城门。\r\n    【未决事项】稍后回报。';
  const normalized = '---\n日期 | 城门:\n  清晨\n  抵达城门。\n  【未决事项】稍后回报。';
  assert.equal(extractSummaryResult(`\`\`\`xml\n${notes}<SUMMARY_RESULT>\n${body}\n</sUMMARY_result>\n\`\`\``, { format: 'legacy' }), normalized);
  assert.equal(extractSummaryResult(`<SUMMARY_RESULT>\n\`\`\`text\n${body}\n\`\`\`\n</SUMMARY_RESULT>`, { prefill: PREFILLS.result, format: 'legacy' }), normalized);
  assert.equal(extractSummaryResult(`<archive_plan>\nStep 1: PASS</archive_plan><summary_result>正文</summary_result>`, { prefill: PREFILLS.plan }), '正文');
  assert.equal(extractSummaryResult(`<archive_check>${fake}</archive_check>续写正文</summary_result>`, { prefill: PREFILLS.result }), '续写正文');
  for (const response of ['PASS', '<archive_plan>PASS', '<think>未完成' + fake]) {
    assert.throws(() => extractSummaryResult(response, { prefill: PREFILLS.plan }), IncompleteSummaryError);
  }
  assert.throws(() => extractSummaryResult('<archive_finalize>未完成' + fake), IncompleteSummaryError);
  const singleNarrative = '---\n日期 | 城门:\n  清晨抵达城门。';
  assert.equal(extractSummaryResult(`<summary_result>${singleNarrative}</summary_result>`, { format: 'legacy' }), singleNarrative);
  for (const content of ['【未决事项】仅有分类', '- 自由项目列表', '• 自由项目列表']) {
    assert.throws(() => extractSummaryResult(`<summary_result>---\n日期 | 城门:\n  ${content}</summary_result>`, { format: 'legacy' }));
  }
});

test('archive normalization canonicalizes headings and bullets and enforces heading order', () => {
  const wrap = value => `<summary_result>${value}</summary_result>`;
  const body = ' 【 时空与事件 】：\n * 清晨｜城门：到达。\n【信息与关系变化】: \n • 获得钥匙。\n【约定与未决事项】\n- 之后回报。';
  const canonical = '【时空与事件】\n- 清晨｜城门：到达。\n【信息与关系变化】\n- 获得钥匙。\n【约定与未决事项】\n- 之后回报。';
  assert.equal(extractSummaryResult(wrap(body), { format: 'archive' }), canonical);
  for (const invalid of [
    '【时空与事件】\n- 到达。\n【约定与未决事项】\n- 承诺。\n【信息与关系变化】\n- 获得钥匙。',
    '【时空与事件】\n【信息与关系变化】\n- 获得钥匙。',
    '【时空与事件】\n- 到达。\n【未知分类】\n- 内容。',
  ]) assert.throws(() => extractSummaryResult(wrap(invalid), { format: 'archive' }));
});

test('a long floor list is paged in bounded slices and can jump and filter without loading rows for every floor',async()=>{
  await saveSettings(FLOW_SETTINGS);seedFloors(3000);messages[2999].is_hidden=true;
  const {visibilitySnapshot}=await import('../src/summary/visibility.js'),{floorPage,FLOOR_PAGE_SIZE}=await import('../src/summary/ui/floorBrowser.js');
  const snapshot=visibilitySnapshot();assert.equal(floorPage(snapshot).pages,100);assert(floorPage(snapshot).groups.length<=FLOOR_PAGE_SIZE);
  const last=floorPage(snapshot,{jump:2999});assert.equal(last.page,99);assert.equal(last.groups.at(-1).to,2999);
  const users=floorPage(snapshot,{role:'user',page:49});assert.equal(users.count,1500);assert(users.groups.every(group=>group.role==='user'));
  assert.deepEqual(floorPage(snapshot,{visibility:'hidden'}).groups.map(group=>group.from),[2999]);
  const {parseTagNames}=await import('../src/summary/ui/tagEditor.js');assert.deepEqual(parseTagNames('<tp>，gametxt、hidden;tp'),['tp','gametxt','hidden']);assert.throws(()=>parseTagNames('bad!tag'));
});

test('preview reports the next round without writing settings, worldbook or task state',async()=>{
  await saveSettings({...FLOW_SETTINGS,enabled:true,triggerFloorCount:50,keepFloorCount:10,batchFloorCount:20});seedFloors(50);
  books.book=[{name:'旧条目',content:'保留'}];
  const before={script:structuredClone(script),chat:structuredClone(chat),books:structuredClone(books)};
  const preview=await computeSummaryPreview();
  assert.deepEqual({script,chat,books},before);assert.equal(getTask(),null);
  assert.deepEqual(preview.plans.map(plan=>[plan.startFloor,plan.endFloor,plan.entryName]),[[0,19,'总结0-19楼'],[20,39,'总结20-39楼']]);
  assert.deepEqual(await computeSummaryPlans(),preview.plans);
  assert.equal(preview.lastId,49);assert.equal(preview.unsummarizedCount,50);
  assert.equal(preview.plannedFloorCount,40);assert.equal(preview.remainingCount,10);
  assert.equal(preview.retainedStartFloor,40);assert.equal(preview.retainedFloorCount,10);assert.equal(preview.retainedEndFloor,49);
  assert.equal(preview.ready,true);assert.equal(preview.enabled,true);
});

test('a recovered pending or stopped task keeps its recorded batches and never regenerates saved ones',async()=>{
  const sourcesFor=(start,end)=>messages.slice(start,end+1).map(message=>sourceOf({id:message.message_id,role:message.role,name:message.name,swipe_id:message.swipe_id,message:message.message}));
  for(const phase of ['pending','stopped']){
    reset();await saveSettings({...FLOW_SETTINGS,enabled:true,triggerFloorCount:50,keepFloorCount:10,batchFloorCount:10});seedFloors(50);
    books.book=[{name:'总结0-19楼',content:'旧批次正文',enabled:false}];
    const batch=(start,end,batchPhase,body)=>({spec:{kind:'normal',startFloor:start,endFloor:end,entryName:`总结${start}-${end}楼`,floorCount:end-start+1,regenerate:false},phase:batchPhase,body,saved:batchPhase==='complete',book:'book',sources:sourcesFor(start,end),parents:[],resultFormat:'free',errorKind:null,details:'',attempt:1});
    const batches=[batch(0,19,'complete','旧批次正文'),batch(20,39,'pending','')];
    patchSummaryStore({summary_assistant_runtime:{[contextKey()]:{id:`legacy-${phase}`,key:contextKey(),spec:{kind:'batch',startFloor:0,endFloor:39,floorCount:40,batches},phase,running:false,selectedBatch:1,startedAt:1,endedAt:null,message:'',details:'',errorKind:null,attempt:0,log:[],batches}}});
    restoreTaskState();
    assert.equal(getTask().phase,phase);assert.deepEqual(getTask().batches.map(batch=>batch.spec.entryName),['总结0-19楼','总结20-39楼']);
    const fresh=await computeSummaryPlans();
    assert(fresh.length>1,'新的批次目标应把同一段拆得更细');assert(fresh.every(plan=>plan.entryName!=='总结20-39楼'));
    const requests=[];globalThis.generateRaw=async config=>{requests.push(config);return '<summary_result>恢复正文</summary_result>';};
    assert.equal(await retryTask(),true);
    assert.equal(requests.length,1);
    assert.deepEqual(books.book.map(entry=>entry.name).sort(),['总结0-19楼','总结20-39楼']);
    assert.equal(books.book.find(entry=>entry.name==='总结0-19楼').content,'旧批次正文');
    assert.deepEqual(readArchive().records['总结20-39楼'].sources.map(source=>source.id),Array.from({length:20},(_,index)=>20+index));
    assert.equal(getTask().phase,'complete');assert(getTask().batches.every(batch=>batch.phase==='complete'));
  }
});

test('older saved settings reuse their batch target without rewriting the stored value',async()=>{
  script[CONFIG.SETTINGS_VAR_KEY]={...structuredClone(FLOW_SETTINGS),enabled:true,triggerFloorCount:50,keepFloorCount:10,batchFloorCount:15};
  const stored=structuredClone(script[CONFIG.SETTINGS_VAR_KEY]);
  await loadSettings();
  assert.equal(getSettings().batchFloorCount,15);assert.deepEqual(script[CONFIG.SETTINGS_VAR_KEY],stored);
  seedFloors(50);
  const plans=await computeSummaryPlans(),cap=Math.floor(15*1.2);
  assert.equal(plans.length,Math.ceil(40/cap));assert(plans.every(plan=>plan.floorCount<=cap));assert.equal(plans.at(-1).endFloor,39);
  globalThis.generateRaw=async()=>'<summary_result>沿用旧目标</summary_result>';
  await autoTriggerSummary();
  assert.equal(getTask().phase,'complete');assert.equal(books.book.length,plans.length);
  assert.equal(script[CONFIG.SETTINGS_VAR_KEY].batchFloorCount,15);assert.equal(getSettings().batchFloorCount,15);
});

test('existing summary entries keep their name and body when a new round saves',async()=>{
  await saveSettings({...FLOW_SETTINGS,enabled:true,triggerFloorCount:30,keepFloorCount:10,batchFloorCount:20});seedFloors(50);
  books.book=[{name:'总结0-19楼',content:'旧档案正文',enabled:true}];
  let calls=0;globalThis.generateRaw=async()=>{calls++;return '<summary_result>新批次正文</summary_result>';};
  await autoTriggerSummary();
  assert.equal(calls,1);
  assert.equal(books.book.filter(entry=>entry.name==='总结0-19楼').length,1);
  assert.equal(books.book.find(entry=>entry.name==='总结0-19楼').content,'旧档案正文');
  assert.equal(books.book.filter(entry=>entry.name==='总结20-39楼').length,1);
  assert(messages.slice(0,40).every(message=>message.is_hidden));assert(messages.slice(40).every(message=>!message.is_hidden));
});

test('a backlogged chat up to floor 120 plans its whole round in one pass for the three recommended settings',async()=>{
  for(const setting of [
    {label:'已开启摘要 50/10/40',triggerFloorCount:50,keepFloorCount:10,batchFloorCount:40},
    {label:'已开启摘要 50/10/20',triggerFloorCount:50,keepFloorCount:10,batchFloorCount:20},
    {label:'未开启摘要 20/5/20',triggerFloorCount:20,keepFloorCount:5,batchFloorCount:20},
  ]){
    reset();await saveSettings({...FLOW_SETTINGS,enabled:true,...setting});seedFloors(121);
    const preview=await computeSummaryPreview(),{plans}=preview,cap=Math.floor(setting.batchFloorCount*1.2);
    assert(plans.length>0,`${setting.label} 应产生批次`);assert.equal(plans[0].startFloor,0);
    plans.forEach((plan,index)=>{
      assert.equal(plan.entryName,`总结${plan.startFloor}-${plan.endFloor}楼`);
      assert.equal(plan.floorCount,plan.endFloor-plan.startFloor+1,`${plan.entryName} 楼层数与范围不符`);
      assert.equal(messages[plan.endFloor].role,'assistant',`${plan.entryName} 未以 AI 回复收尾`);
      assert(plan.floorCount<=cap,`${plan.entryName} 超出软上限`);
      if(index)assert.equal(plan.startFloor,plans[index-1].endFloor+1,`${plan.entryName} 与上一批不连续`);
    });
    assert.equal(preview.plannedFloorCount,plans.reduce((sum,plan)=>sum+plan.floorCount,0));
    assert.equal(preview.remainingCount,preview.unsummarizedCount-preview.plannedFloorCount);
    assert.equal(preview.retainedStartFloor,plans.at(-1).endFloor+1);assert.equal(preview.retainedEndFloor,120);
    assert.equal(preview.retainedFloorCount,121-preview.retainedStartFloor);assert.equal(preview.ready,true);
    const mean=plans.reduce((sum,plan)=>sum+plan.materialChars,0)/plans.length;
    plans.forEach(plan=>assert(Math.abs(plan.materialChars-mean)<=mean*0.15,`${setting.label} 的 ${plan.entryName} 正文权重偏离均值过多`));
    const requests=[];globalThis.generateRaw=async()=>{requests.push(1);return `<summary_result>第${requests.length}批</summary_result>`;};
    await autoTriggerSummary();
    assert.equal(requests.length,plans.length,`${setting.label} 的请求数应与批次数一致`);
    assert.deepEqual(books.book.map(entry=>entry.name),plans.map(plan=>plan.entryName));
    assert.equal(getTask().phase,'complete');assert(getTask().batches.every(batch=>batch.phase==='complete'));
    assert.equal(getTask().spec.floorCount,plans.reduce((sum,plan)=>sum+plan.floorCount,0));
    assert.equal(getTask().spec.keepFloorCount,setting.keepFloorCount);
    assert.equal(getTask().spec.retainedFloorCount,preview.retainedFloorCount);
    assert.equal(getTask().spec.retainedStartFloor,preview.retainedStartFloor);
    assert(messages.slice(0,plans.at(-1).endFloor+1).every(message=>message.is_hidden));
    assert(messages.slice(preview.retainedStartFloor).every(message=>!message.is_hidden));
  }
});

test('a chat growing to floor 120 triggers where the floor counts say and each round keeps its planned ranges',async()=>{
  const uniform='正文正文正文正文正文正文正文正文';
  for(const setting of [
    {label:'已开启摘要 50/10/40',triggerFloorCount:50,keepFloorCount:10,batchFloorCount:40,remaining:40,
      rounds:[[50,['0-40']],[90,['41-80']]]},
    {label:'已开启摘要 50/10/20',triggerFloorCount:50,keepFloorCount:10,batchFloorCount:20,remaining:40,
      rounds:[[50,['0-20','21-40']],[90,['41-60','61-80']]]},
    {label:'未开启摘要 20/5/20',triggerFloorCount:20,keepFloorCount:5,batchFloorCount:20,remaining:8,
      rounds:[[20,['0-14']],[34,['15-28']],[48,['29-42']],[62,['43-56']],[76,['57-70']],[90,['71-84']],[104,['85-98']],[118,['99-112']]]},
  ]){
    reset();await saveSettings({...FLOW_SETTINGS,enabled:true,autoMegaSummary:false,...setting});
    messages=[];let calls=0;
    globalThis.generateRaw=async()=>{calls++;return '<summary_result>连续批次</summary_result>';};
    const rounds=[];
    for(let id=0;id<=120;id++){
      const assistant=id%2===0;
      messages.push({message_id:id,role:assistant?'assistant':'user',name:assistant?'角色':'用户',swipe_id:0,message:assistant?`<tp>${uniform}</tp>`:uniform,is_hidden:false});
      if(!assistant)continue;
      const previous=getTask()?.id;
      await autoTriggerSummary();
      const task=getTask();
      if(!task||task.id===previous)continue;
      assert.equal(task.phase,'complete',`${setting.label} 在第 ${id} 楼的回合应完成`);
      const specs=task.spec.kind==='batch'?task.spec.batches:[task.spec];
      rounds.push([id,specs.map(batch=>`${batch.startFloor}-${batch.endFloor}`)]);
    }
    assert.deepEqual(rounds,setting.rounds,`${setting.label} 的触发点与分批范围`);
    const planned=rounds.flatMap(([,names])=>names);
    assert.equal(calls,planned.length,`${setting.label} 的请求数应与批次总数一致`);
    const lastEnd=Number(planned.at(-1).split('-')[1]);
    for(const name of planned){const [start,end]=name.split('-').map(Number);assert.equal(messages[end].role,'assistant',`${name} 未以 AI 回复收尾`);assert(end-start+1<=Math.floor(setting.batchFloorCount*1.2),`${name} 超出软上限`);}
    const covered=planned.reduce((sum,name)=>{const [start,end]=name.split('-').map(Number);return sum+end-start+1;},0);
    assert.equal(new Set(planned.flatMap(name=>{const [start,end]=name.split('-').map(Number);return Array.from({length:end-start+1},(_,index)=>start+index);})).size,covered,'已保存批次不能重复覆盖同一楼层');
    assert(messages.slice(0,lastEnd+1).every(message=>message.is_hidden));
    assert(messages.slice(lastEnd+1).every(message=>!message.is_hidden));
    assert.equal((await computeSummaryPreview()).unsummarizedCount,setting.remaining,`${setting.label} 的剩余未总结楼层`);
  }
});

test('migration moves safety keys across distinct stores and preserves the aliased host contract',async()=>{
  const {migrateGlobalSummaryState,readGlobalStore,patchGlobalStore}=await import('../src/platform/store.js');
  const {SECRETS_VAR_KEY,OWNED_BOOKS_VAR_KEY}=await import('../src/platform/storage-keys.js');
  const legacy={keysByUrl:{'https://summary.invalid':'fixture-key'}};
  script={managed_values:{test:true},[SECRETS_VAR_KEY]:legacy,[OWNED_BOOKS_VAR_KEY]:['old']};
  migrateGlobalSummaryState();
  writePresetStore({managed_values:{test:false}});
  assert.deepEqual(readGlobalStore()[SECRETS_VAR_KEY],legacy);
  assert.deepEqual(readGlobalStore()[OWNED_BOOKS_VAR_KEY],['old']);
  let shared={otherFlavor:123};
  const aliasRead=getVariables, aliasWrite=replaceVariables;
  globalThis.getVariables=o=>o.type==='global'?structuredClone(shared):aliasRead(o);
  globalThis.replaceVariables=(v,o)=>{if(o.type==='global')shared=structuredClone(v);else aliasWrite(v,o);};
  migrateGlobalSummaryState();
  assert.deepEqual(shared,{otherFlavor:123,[SECRETS_VAR_KEY]:legacy,[OWNED_BOOKS_VAR_KEY]:['old']});
  assert.deepEqual(script,{managed_values:{test:false}});
  script[SECRETS_VAR_KEY]={keysByUrl:{'https://summary.invalid':'stale'}};
  migrateGlobalSummaryState(); assert(!Object.hasOwn(script,SECRETS_VAR_KEY));
  assert.deepEqual(shared[SECRETS_VAR_KEY],legacy);
  const skipGlobal=globalThis.replaceVariables;
  globalThis.replaceVariables=(v,o)=>{if(o.type!=='global')skipGlobal(v,o);};
  assert.throws(()=>patchGlobalStore({newField:true}),/校验/);
});

test('new preset, unbound chat, foreign preset and disposal remove only temporary global bindings',async()=>{
  const service=await import('../src/summary/service.js');
  const ledger='summary_assistant_owned_books', book='命定之诗总结世界书_1';
  let shared={general_summary_owned_books:['Reverie']}, preset='v1.9', mine=true;
  const handlers=new Map();
  globalThis.getLoadedPresetName=()=>preset;
  globalThis.getPreset=()=>({prompts:mine?[{id:'900cb71c-f6a6-441f-a78c-056ddfc8db10'}]:[]});
  globalThis.tavern_events=Object.fromEntries(['CHAT_CHANGED','PRESET_CHANGED','WORLDINFO_UPDATED','MESSAGE_RECEIVED'].map(k=>[k,k]));
  globalThis.eventOn=(name,fn)=>{handlers.set(name,fn);return ()=>handlers.delete(name);};
  globalThis.getVariables=o=>structuredClone(o.type==='global'?shared:o.type==='chat'?chat:script);
  globalThis.replaceVariables=(v,o)=>{if(o.type==='global')shared=structuredClone(v);else if(o.type==='chat')chat=structuredClone(v);else script=structuredClone(v);};
  const native=['用户启用的书','Reverie']; globals=[...native];books[book]=[];chat={};
  try {
    await service.initialize({status:(...args)=>reports.push(args)});
    await bindWorldbookToChat(book);await updateSettings({userPrefix:'v1 私有设置',customApiUrl:'https://model.invalid',customApiKey:'unit-test'});
    assert.deepEqual(globals,[...native,book]);assert.deepEqual(shared[ledger],[book]);assert(!JSON.stringify(script).includes('unit-test'));
    script={};preset='v2.0';await handlers.get('PRESET_CHANGED')();
    assert.equal(getSettings().userPrefix,DEFAULT_SETTINGS.userPrefix);assert.equal(getKeyForUrl('https://model.invalid'),'unit-test');
    chat={};ctx.chatId='B';await handlers.get('CHAT_CHANGED')();assert.deepEqual(globals,native);assert.deepEqual(shared[ledger],[]);
    await bindWorldbookToChat(book);
    mine=false;preset='foreign';script={};await handlers.get('PRESET_CHANGED')();
    assert.deepEqual(globals,native);assert.deepEqual(script,{});assert.equal(chat.summary_assistant_worldbook,book);
    mine=true;preset='v2.0';await handlers.get('PRESET_CHANGED')();assert.deepEqual(globals,[...native,book]);
  } finally { await service.dispose(); delete globalThis.getPreset; }
  assert.deepEqual(globals,native);assert.deepEqual(shared[ledger],[]);
  assert.deepEqual(shared.general_summary_owned_books,['Reverie']);assert(!reports.some(([,kind])=>kind==='error'));
});

test('book migration preserves duplicate ordinary names and ids, scopes old mega maps, and retains a failed deletion',async()=>{
  const {getMegaSummaryMap,setMegaSummaryMapping}=await import('../src/summary/storage.js');
  const parent=['总结0-0楼','总结1-1楼'],mega='大总结0-1楼';
  const ordinary=[{uid:0,name:'同名',content:'甲'},{uid:9,name:'同名',content:'乙'}];
  books.book=[{uid:0,name:mega,content:'旧档案'}];books.new=structuredClone(ordinary);books.third=[];
  chat[CONFIG.MEGA_SUMMARY_VAR_KEY]={[mega]:parent};
  await bindWorldbookToChat('third');assert.deepEqual(await getMegaSummaryMap(),{});
  await setMegaSummaryMapping(mega,['第三本书']);await bindWorldbookToChat('book');
  assert.deepEqual(await getMegaSummaryMap(),{[mega]:parent});
  await migrateWorldbookEntries('book','new');
  assert.deepEqual(books.new.slice(0,2),ordinary);assert.deepEqual(await getMegaSummaryMap(),{[mega]:parent});
  await deleteBoundSummaryBook();assert.deepEqual(books.new,ordinary);
  await bindWorldbookToChat('third');assert.deepEqual(await getMegaSummaryMap(),{[mega]:['第三本书']});
  globalThis.deleteWorldbook=async()=>false;
  await assert.rejects(deleteBoundSummaryBook(),/删除失败/);
  assert.equal(getActiveWorldbookName(),'third');assert.deepEqual(await getMegaSummaryMap(),{[mega]:['第三本书']});
});

test('deleting floors restores shifted auto-hidden sources and leaves native-hidden neighbors alone',async()=>{
  seedFloors(8);messages[5].message=messages[3].message;messages[5].is_hidden=true;
  await saveSettings(DEFAULT_SETTINGS);await upsertSummaryEntryByName('总结1-4楼','档案');
  assert.deepEqual(chat.summary_assistant_auto_hidden_floors,[1,2,3,4]);
  messages.splice(0,1);messages.forEach((msg,id)=>{msg.message_id=id;});
  await auditArchiveSources();await applySummarizedFloorsVisibility();
  assert.deepEqual(messages.map(m=>m.is_hidden),[false,false,false,false,true,false,false]);
  assert.deepEqual(chat.summary_assistant_auto_hidden_floors,[]);
});

test('editing auto-hidden text from or to a duplicate restores the edited floor and preserves native-hidden neighbors', async () => {
  for (const startsWithDuplicate of [true, false]) {
    reset();
    seedFloors(8);
    messages[5].message=startsWithDuplicate ? messages[3].message : '<gametxt>另一段正文</gametxt>';
    messages[5].is_hidden=true;
    await saveSettings(DEFAULT_SETTINGS);
    await upsertSummaryEntryByName('总结1-4楼','档案');
    assert.deepEqual(chat.summary_assistant_auto_hidden_floors,[1,2,3,4]);
    messages[3].message=startsWithDuplicate ? '<gametxt>修改后的正文</gametxt>' : messages[5].message;
    await auditArchiveSources();
    await applySummarizedFloorsVisibility();
    assert.deepEqual(messages.map(message => message.is_hidden),[false,false,false,false,false,true,false,false]);
    assert.deepEqual(chat.summary_assistant_auto_hidden_floors,[]);
  }
});

test('in-place edits followed by a new floor retain ownership of the edited duplicate',async()=>{
  seedFloors(10);
  messages[2].message=messages[8].message='继续';
  messages[8].is_hidden=true;
  await saveSettings(DEFAULT_SETTINGS);
  await upsertSummaryEntryByName('总结1-3楼','档案');
  messages[2].message='往左走'; messages[3].message='向前。';
  messages.push({message_id:10,role:'user',message:'后续',is_hidden:false});
  await auditArchiveSources(); await applySummarizedFloorsVisibility();
  assert.deepEqual(messages.filter(message=>message.is_hidden).map(message=>message.message_id),[8]);
});

test('tag extraction reports matched even for an empty story element',()=>{
  assert.deepEqual(extractTagContent('<gametxt>   </gametxt>',['gametxt']),{matched:true,content:''});
  assert.deepEqual(extractTagContent('<think><gametxt>示例</gametxt></think>',['gametxt']),{matched:false,content:''});
});

test('deleting one repeated floor preserves the visibility owner of the identifiable survivor',async()=>{
  for (const removed of [2,8]) {
    reset();seedFloors(10);
    messages[2].message=messages[8].message='继续';
    messages[8].is_hidden=true;
    await saveSettings(DEFAULT_SETTINGS);
    await upsertSummaryEntryByName('总结0-9楼','档案');
    messages.splice(removed,1);messages.forEach((message,id)=>{message.message_id=id;});
    await auditArchiveSources();await applySummarizedFloorsVisibility();
    assert.deepEqual(messages.filter(message=>message.is_hidden).map(message=>message.message_id),removed===2?[7]:[]);
  }
});

test('delayed host updater cannot mutate a book after invalidation, including outside runAction',async()=>{
  const {updateWorldbookWith}=await import('../src/platform/lifecycle.js');
  let release,called=false;
  globalThis.updateWorldbookWith=(name,fn)=>new Promise((resolve,reject)=>{release=()=>{try{resolve(fn([]));}catch(error){reject(error);}};});
  const pending=updateWorldbookWith('book',()=>{called=true;return [];});
  invalidate();release();await assert.rejects(pending,{name:'AbortError'});assert.equal(called,false);
});

test('archive writes split exclusions and the audit disables enabled uncommitted entries',async()=>{
  seedFloors(10);chat[ARCHIVE_VAR_KEY]={book:{records:{},excluded:[{start:0,end:9}]}};
  await upsertSummaryEntryByName('总结3-5楼','正文');
  assert.equal(books.book[0].ignoreBudget,true);assert.deepEqual(readArchive().excluded,[{start:0,end:2},{start:6,end:9}]);
  chat[ARCHIVE_VAR_KEY].book.records['总结3-5楼'].committed=false;
  assert.deepEqual(await auditArchiveSources(),['总结3-5楼']);assert.equal(books.book[0].enabled,false);
});

test('manual edits report failure for active mega parents, and rollback suppresses only identical parents',async()=>{
  const {viewEditEntry}=await import('../src/summary/ui/panelEvents.js');
  seedFloors(6);await saveSettings({...FLOW_SETTINGS,megaTriggerCount:3,megaBatchCount:2});
  const names=['总结0-1楼','总结2-3楼','总结4-5楼'];
  for(const name of names)await upsertSummaryEntryByName(name,name);
  const mega='大总结0-3楼';
  await upsertMegaSummaryEntry(mega,'合并',names.slice(0,2));assert(books.book.find(e=>e.name===mega).ignoreBudget);
  configureRuntime({popup:async()=>'覆盖',status:(...args)=>reports.push(args)});
  await viewEditEntry(null,names[0]);
  assert(reports.some(([msg])=>msg==='该条目已被大总结包含，请先回档对应的大总结再修改'));assert(!reports.some(([,kind])=>kind==='success'));
  assert.equal(books.book.find(e=>e.name===names[0]).content,names[0]);
  await restoreMegaSummaryToSummaries(mega);
  assert.deepEqual((await computeMegaPlan()).summaryNames,names.slice(1));
  await upsertSummaryEntryByName(names[0],'已改写');
  assert.deepEqual((await computeMegaPlan()).summaryNames,names.slice(0,2));
});

test('world context keeps ordinary text containing a short memory and filters whole entries and MVU controls',async()=>{
  const {snapshotContext}=await import('../src/summary/macros.js');
  books.book=[{name:'总结0-1楼',content:'旧城'},{name:'[mvu_update]变量',content:'内部控制行'}];
  SillyTavern.getWorldInfoPrompt=async()=>({worldInfoBefore:'旧城的夜色\n旧城\n内部控制行\n北风',worldInfoAfter:'<UpdateVariable a="1">补丁</UpdateVariable>场景\n[mvu_update]隐私\n内部[/mvu_update]\n[mvu_update]单行'});
  const values=await snapshotContext({mergedChatText:'剧情'},DEFAULT_SETTINGS);
  assert.equal(values['summary.world_before'],'旧城的夜色\n北风');assert.equal(values['summary.world_after'],'场景');
});


test('summary panel displays host error text literally in all three record views',async()=>{
  const {refreshEntryList,refreshMegaEntryList,refreshStatus}=await import('../src/summary/ui/panelEvents.js');
  globalThis.getWorldbookNames=async()=>{throw new Error('读取 <书名> & 失败');};
  for(const refresh of [refreshEntryList,refreshMegaEntryList,refreshStatus]){
    const element={querySelector:()=>null};
    await refresh({querySelector:()=>element});
    if(refresh===refreshStatus)assert.match(element.textContent,/读取 <书名> & 失败/);
    else assert.match(element.innerHTML,/读取 &lt;书名&gt; &amp; 失败/);
  }
});

test('a second preset merges legacy credentials and owned books before its script data is cleaned', async () => {
  const { migrateGlobalSummaryState } = await import('../src/platform/store.js');
  const { SETTINGS_VAR_KEY:settings, SECRETS_VAR_KEY:secrets, OWNED_BOOKS_VAR_KEY:owned } = await import('../src/platform/storage-keys.js');
  let shared = { unrelated: 'keep' }, dropGlobalWrite = false;
  globalThis.getVariables = ({ type }) => structuredClone(type === 'global' ? shared : script);
  globalThis.replaceVariables = (value, { type }) => {
    if (type === 'script') script = structuredClone(value);
    else if (!dropGlobalWrite) shared = structuredClone(value);
  };
  script = { [secrets]: { keysByUrl: { common: 'first', empty: '' } }, [owned]: ['first', 'both'] };
  migrateGlobalSummaryState();
  script = { [settings]: { customApiUrl: ' legacy ' }, [secrets]: {
    keysByUrl: { common: 'second', empty: 'filled', new: 'second-only' }, customApiKey: 'single'
  }, [owned]: ['both', 'second'], custom_models: [] };
  const before = structuredClone(script);
  dropGlobalWrite = true;
  assert.throws(migrateGlobalSummaryState, /全局设置持久化校验失败/);
  assert.deepEqual(script, before);
  dropGlobalWrite = false;
  migrateGlobalSummaryState();
  assert.deepEqual(shared, { unrelated: 'keep', [secrets]: { keysByUrl: {
    common:'first', empty:'filled', new:'second-only', legacy:'single',
  } }, [owned]: ['first', 'both', 'second'] });
  assert.deepEqual(script, { [settings]: { customApiUrl: ' legacy ' }, custom_models: [] });
});

test('worldbook migration reconciles existing summary flags and positions before removing the source', async () => {
  const normal = { name:'总结0-1楼', content:'原始', uid:1, disable:true, position:{depth:9998, order:104} };
  const mega = { name:'大总结0-1楼', content:'合并', uid:2, enabled:true, position:{depth:9999, order:1} };
  const targetNormal = { ...normal, uid:70, enabled:true, disable:false, disabled:false, position:{depth:4, order:3} };
  books.book = [normal, mega];
  books.target = [targetNormal, { ...mega, uid:71, enabled:false }, { name:'旁注', content:'保留', uid:72 }];
  const update = globalThis.updateWorldbookWith;
  globalThis.updateWorldbookWith = async (name, modify) => {
    await update(name, modify);
    books.target[0].enabled = true;
  };
  await assert.rejects(migrateWorldbookEntries('book','target'), /记录校验失败/);
  assert.deepEqual(books.book,[normal,mega]); assert.equal(getActiveWorldbookName(),'book');
  globalThis.updateWorldbookWith = update;
  await migrateWorldbookEntries('book','target');
  assert.equal(books.book,undefined); assert.equal(getActiveWorldbookName(),'target');
  assert.deepEqual(books.target[0],{ ...targetNormal, enabled:false, disable:true, disabled:true, position:normal.position });
  assert.equal(books.target[1].enabled,true); assert.equal(books.target[1].uid,71);
  assert.deepEqual(books.target[2],{ name:'旁注', content:'保留', uid:72 });
});

test('summary context filters whole control entries in character, chat and global books, tolerating a failed read',async t=>{
  const { snapshotContext } = await import('../src/summary/macros.js');
  const reads = [];
  t.mock.method(console, 'warn', () => {});
  t.after(()=>{delete globalThis.getCharWorldbookNames;delete globalThis.getChatWorldbookName;});
  globalThis.getCharWorldbookNames = () => ({primary:'character',additional:['shared','missing']});
  globalThis.getChatWorldbookName = () => 'chat';
  globals = ['shared','global'];
  books.character = [{name:'[mvu_update]输出规则',content:'变量条款'}];
  books.shared = [{name:'[本体][变量]output_format_(随AI输出开，主API)',content:'多行\n输出协议'}];
  books.chat = [{name:'大总结0-9楼',content:'旧的档案'}];
  books.global = [{name:'output_format_(其他模式)',content:'接口控制'}];
  globalThis.getWorldbook = async name => {
    reads.push(name);
    if (name === 'missing') throw new Error('世界书不可用');
    return structuredClone(books[name]);
  };
  SillyTavern.getWorldInfoPrompt = async () => ({
    worldInfoBefore:'变量条款\n普通资料引用变量条款。\n多行\n输出协议',
    worldInfoAfter:'旧的档案\n接口控制\n保留场景',
  });
  const values = await snapshotContext({mergedChatText:'剧情'}, DEFAULT_SETTINGS);
  assert.deepEqual(reads.sort(),['book','character','chat','global','missing','shared']);
  assert.equal(values['summary.world_before'],'普通资料引用变量条款。');
  assert.equal(values['summary.world_after'],'保留场景');
  globalThis.getCharWorldbookNames = () => {throw Error('没有当前角色');};
  assert.equal((await snapshotContext({},DEFAULT_SETTINGS))['summary.world_after'],'保留场景');
});

test('a failed chat binding pauses automation and a world-info event can recover without another chat switch', async t => {
  const service = await import('../src/summary/service.js');
  const events = new Map(), errors = [];
  const before = globalThis.getLastMessageId;
  let floorReads = 0, refuseBind = true;
  globalThis.getLastMessageId = () => { floorReads++; return before(); };
  globalThis.tavern_events = Object.fromEntries(['CHAT_CHANGED','WORLDINFO_UPDATED','MESSAGE_RECEIVED'].map(name=>[name,name]));
  globalThis.eventOn = (name, fn) => { events.set(name,fn); return () => events.delete(name); };
  chat = {}; globals = [];
  await service.initialize({status:(message,kind)=>{if (kind === 'error') errors.push(message);}});
  t.after(()=>service.dispose());
  ctx.chatId = 'other';
  chat = {[CONFIG.CHAT_WB_VAR_KEY]:'book'};
  globalThis.rebindGlobalWorldbooks = async names => {
    if (refuseBind) throw Error('暂时不能绑定');
    globals = [...names];
  };
  await events.get('CHAT_CHANGED')();
  assert.deepEqual(errors,['暂时不能绑定']);
  events.get('MESSAGE_RECEIVED')();
  const paused = floorReads;
  await new Promise(resolve=>setTimeout(resolve,200));
  assert.equal(floorReads,paused);
  refuseBind = false;
  await events.get('WORLDINFO_UPDATED')();
  assert.deepEqual(globals,['book']);
  await new Promise(resolve=>setTimeout(resolve,200));
  assert(floorReads > paused);
});
