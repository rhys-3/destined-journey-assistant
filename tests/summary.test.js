import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { DEFAULT_SETTINGS, CONFIG } from '../src/summary/config.js';
import { summarySnapshot } from '../src/summary/settingsSchema.js';
import { writePresetStore } from '../src/platform/store.js';
import { configureRuntime, captureContext, checkContext, invalidate, runAction, isBusy, setRuntimeEnabled } from '../src/platform/lifecycle.js';
import { loadSettings, saveSettings, getSettings, updateSettings, getKeyForUrl } from '../src/summary/storage.js';
import { computeSummaryPlan, shouldAutoTrigger, executeSummary, finalizeMegaSummarySave } from '../src/summary/summary.js';
import { callSummaryApi, callMegaSummaryApi } from '../src/summary/api.js';
import { processMessagesByTags } from '../src/summary/messages.js';
import { upsertSummaryEntryByName, upsertMegaSummaryEntry, restoreMegaSummaryToSummaries, applySummarizedFloorsVisibility, writeChatWorldbookBinding, migrateWorldbookEntries, getAllSummaryEntriesForDisplay } from '../src/summary/worldbook.js';
import { migrate } from '../src/summary/service.js';
import { reconcileChatBinding, getActiveWorldbookName } from '../src/summary/worldbook.js';

let script,chat,books,messages,globals,ctx,reports;
function reset() {
  script={};chat={};books={};globals=[];messages=[];ctx={chatId:'a',characterId:1};reports=[];
  globalThis.SillyTavern={getContext:()=>ctx,name1:'User',name2:'Character',POPUP_TYPE:{INPUT:1,CONFIRM:2},POPUP_RESULT:{AFFIRMATIVE:1,CANCELLED:0}};
  globalThis.getLoadedPresetName=()=> '命定';
  globalThis.getVariables=option=>structuredClone(option.type==='chat'?chat:script);
  globalThis.replaceVariables=value=>{script=structuredClone(value);};
  globalThis.insertOrAssignVariables=(value,option)=>{if(option.type==='chat')Object.assign(chat,structuredClone(value));else Object.assign(script,structuredClone(value));};
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
  delete globalThis.getScriptTrees;delete globalThis.updateScriptTreesWith;
  configureRuntime({status:(...args)=>reports.push(args),popup:async()=>null,chooseFailure:async()=> 'cancel'});
  invalidate();setRuntimeEnabled(false);writeChatWorldbookBinding('book');books.book=[];
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
  await saveSettings({...DEFAULT_SETTINGS,customApiKey:'secret',triggerFloorCount:40});
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
  script.summary_assistant_settings.userPrefix='新用户';await migrate();assert.equal(script.summary_assistant_settings.userPrefix,'新用户');assert.equal(legacy.data.summary_assistant_settings.userPrefix,'旧用户');
});
test('legacy scripts with a regenerated id migrate by an unambiguous name and loader',async()=>{
  const legacy={id:'user-copy',name:'【命定之诗】总结',content:"import 'destined-journey-summarizer'",enabled:true};
  globalThis.getScriptTrees=()=>[legacy];globalThis.updateScriptTreesWith=fn=>fn([legacy]);
  await migrate();assert.equal(legacy.enabled,false);assert.equal(script.summary_assistant_settings.enabled,true);
  assert.equal(script.summary_assistant_migration.from,'user-copy');
});
test('custom API keys stay with their endpoint when switching configuration',async()=>{
  await saveSettings({...DEFAULT_SETTINGS,customApiUrl:'https://one.invalid/v1',customApiKey:'one-secret'});
  await updateSettings({customApiUrl:'https://two.invalid/v1'});assert.equal(getSettings().customApiKey,'');
  await updateSettings({customApiKey:'two-secret'});
  await updateSettings({customApiUrl:'https://one.invalid/v1'});assert.equal(getSettings().customApiKey,'one-secret');
  assert.equal(getKeyForUrl('https://two.invalid/v1'),'two-secret');
});
test('threshold counts raw floors, retaining the latest ten',async()=>{
  await saveSettings({...DEFAULT_SETTINGS,enabled:true});
  messages=Array.from({length:29},(_,i)=>({message_id:i}));assert.equal(await shouldAutoTrigger(),false);
  messages.push({message_id:29});assert.equal(await shouldAutoTrigger(),true);
  assert.deepEqual(await computeSummaryPlan(),{startFloor:0,endFloor:19,entryName:'总结0-19楼',lastId:29,unsummarizedCount:30});
});
test('tag extraction ignores thoughts and untagged messages, not the rendered UI',()=>{
  const result=processMessagesByTags([{id:0,role:'assistant',message:'<think>secret</think><tp>488-1-1</tp><gametxt>故事<!--注释--></gametxt><summary>摘要</summary>'},{id:1,role:'user',message:'无标签'}],['tp','gametxt'],['think'],true);
  assert.equal(result.length,1);assert.equal(result[0].content,'488-1-1\n故事');
});
test('summary generation sends ordered prompts, scan-only input and the SPreset marker',async()=>{
  await saveSettings({...DEFAULT_SETTINGS,enabled:true});let request;
  globalThis.generateRaw=async config=>{request=config;return 'result';};
  assert.equal(await callSummaryApi({promptBlocks:DEFAULT_SETTINGS.promptBlocks,oldSummaryContent:'OLD',mergedChatText:'CHAT',scanText:'SCAN'}),'result');
  assert(request.ordered_prompts.filter(p=>typeof p==='object').every(p=>p.content.startsWith('<|no-trans|>')));
  assert.deepEqual(request.injects,[{role:'system',content:'SCAN',position:'none',should_scan:true}]);assert(request.generation_id.startsWith('destined-summary-'));
  assert(!request.custom_api);
  await saveSettings({...getSettings(),apiMode:'custom',customApiUrl:'https://example.invalid/v1',customApiModel:'model',customApiKey:'secret',temperature:0.4,maxTokens:2048});
  await callMegaSummaryApi({promptBlocks:DEFAULT_SETTINGS.megaPromptBlocks,mergedSummaryText:'records',oldMegaSummaryContent:''});
  assert.equal(request.custom_api.key,'secret');assert.equal(request.custom_api.max_tokens,2048);
});
test('write depths and mega mapping preserve original summary records on restore',async()=>{
  await saveSettings({...DEFAULT_SETTINGS,autoHideSummarizedFloors:false});
  await upsertSummaryEntryByName('总结0-9楼','one');await upsertSummaryEntryByName('总结10-19楼','two');
  assert.equal(books.book[0].position.depth,9998);
  await finalizeMegaSummarySave('大总结0-19楼','mega',['总结0-9楼','总结10-19楼']);
  const mega=books.book.find(e=>e.name==='大总结0-19楼');assert.equal(mega.position.depth,9999);assert(books.book.filter(e=>e.name.startsWith('总结')).every(e=>!e.enabled));
  await restoreMegaSummaryToSummaries('大总结0-19楼');assert(books.book.every(e=>e.enabled));assert.equal(books.book.length,2);
});
test('worldbook migration includes mega summaries and leaves unrelated entries',async()=>{
  await saveSettings({...DEFAULT_SETTINGS,autoHideSummarizedFloors:false});
  books.book=[{name:'总结0-9楼',content:'one'},{name:'大总结0-19楼',content:'mega'},{name:'无关',content:'keep'}];
  await migrateWorldbookEntries('book','new');assert.deepEqual(books.book,[{name:'无关',content:'keep'}]);assert.equal(books.new.length,2);assert.equal(chat.summary_assistant_worldbook,'new');
});
test('auto visibility does not unhide manually hidden floors',async()=>{
  await saveSettings(DEFAULT_SETTINGS);
  messages=Array.from({length:10},(_,i)=>({message_id:i,is_hidden:i===0}));
  await upsertSummaryEntryByName('总结1-5楼','one');assert.equal(messages[0].is_hidden,true);assert.deepEqual(chat.summary_assistant_auto_hidden_floors,[1,2,3,4,5]);
  await saveSettings({...getSettings(),autoHideSummarizedFloors:false});await applySummarizedFloorsVisibility();
  assert.equal(messages[0].is_hidden,true);assert(messages.slice(1).every(m=>!m.is_hidden));
});
test('duplicate operations are ignored and context changes reject late writes',async()=>{
  await saveSettings({...DEFAULT_SETTINGS,enabled:true});let finish;let calls=0;
  const task=runAction(async()=>{calls++;await new Promise(r=>finish=r);await upsertSummaryEntryByName('总结0-1楼','late');});
  assert(isBusy());await runAction(async()=>calls++);ctx.chatId='b';finish();await task;
  assert.equal(calls,1);assert.equal(books.book.length,0);assert(!isBusy());
});
test('rapid chat switches retain the previous global binding until reconciled',async()=>{
  globals=['book','shared'];books.b=[];books.c=[];let finish;
  chat.summary_assistant_worldbook='b';ctx.chatId='b';
  globalThis.getWorldbookNames=()=>new Promise(resolve=>finish=resolve);
  const transition=reconcileChatBinding();
  ctx.chatId='c';chat.summary_assistant_worldbook='c';invalidate();
  assert.equal(getActiveWorldbookName(),'c');finish(Object.keys(books));
  await assert.rejects(transition,{name:'AbortError'});
  globalThis.getWorldbookNames=async()=>Object.keys(books);
  await reconcileChatBinding();assert.deepEqual(globals,['shared','c']);
});
test('cancelled generation never opens review or saves into a different chat',async()=>{
  await saveSettings({...DEFAULT_SETTINGS,enabled:true});messages=[{message_id:0,role:'assistant',message:'<gametxt>事件</gametxt>'}];let finish;
  globalThis.generateRaw=()=>new Promise(r=>finish=r);
  const task=runAction(()=>executeSummary(0,0,'总结0-0楼',{requireReview:true}),{generation:true});
  while(!finish)await new Promise(r=>setImmediate(r));invalidate();ctx.chatId='b';finish('---\n488-1-1 | 地点:\n  事件');await task;
  assert.equal(books.book.length,0);
});
test('SPreset partitions real fixture markers into memory, reference and runtime',()=>{
  const settings=JSON.parse(fs.readFileSync(new URL('./fixtures/spreset.json',import.meta.url)));
  const post=Function('return ('+settings.ChatSquash.squashed_post_script+')')();
  const text=post('<VOID_memory><|ws_slot|></VOID_memory><VOID_reference><|ai_slot|></VOID_reference><VOID_runtime><|ac_slot|></VOID_runtime><VOID_injection_buffer>MEGA_9999 SUMMARY_9998</VOID_injection_buffer><@Cut_900><VOID_injection_buffer>REF</VOID_injection_buffer><@Cut_2><VOID_injection_buffer>RULE</VOID_injection_buffer>');
  assert(text.includes('<VOID_memory>MEGA_9999 SUMMARY_9998</VOID_memory>'));assert(text.includes('<VOID_reference>REF</VOID_reference>'));assert(text.includes('<VOID_runtime>RULE</VOID_runtime>'));
  const regexes=settings.RegexBinding.regexes;
  const recent=regexes.find(r=>r.scriptName.startsWith('07'));const distant=regexes.find(r=>r.scriptName.startsWith('08'));
  assert.equal(recent.maxDepth,10);assert.equal(distant.minDepth,11);assert.equal(settings.ChatSquash.squashed_separator_string,'<|no-trans|>');
});
