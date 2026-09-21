import { getSettings, getMegaSummaryMapping } from './storage.js';
import { getCoverage, auditArchiveSources, applySummarizedFloorsVisibility, upsertSummaryEntryByName, upsertMegaSummaryEntry, isEntryDisabled } from './worldbook.js';
import { validateResultBody } from './result.js';
import { getRawMessages, processMessagesByTags } from './messages.js';
import { makeSummaryEntryName, makeMegaSummaryEntryName } from './utils.js';
import { parseRange, excludeRange, consecutiveSummaries, recordValid } from './provenance.js';
import { getTask, clearTask, updatePendingTask, taskBatchFields } from './taskState.js';
import { getHost, captureContext, checkContext } from '../platform/lifecycle.js';
import { runSummaryTask } from './taskRunner.js';
import { splitFloorBatches, batchTaskSpec, bridgeDiscussionGaps } from './batchPlan.js';
import { isDiscussionMessage } from '../discussion/protocol.js';

export const showSummaryHint = (message, kind = 'info') => getHost()?.status(message, kind);
export const hideSummaryHint = () => {};
export const showSummaryHintFor = showSummaryHint;
export const chooseSummaryFailureAction = options => getHost()?.chooseFailure(options);
export const stripMarkdownCodeFence = text => String(text ?? '').trim().replace(/^```[^\n]*\n([\s\S]*?)\n```$/, '$1');
export const normalizeSummaryFormatting = text => String(text ?? '').trim();
export const containsMarkdownCodeFence = text => /```/.test(text);
export function validateSummaryContent(text, options = {}) { try { validateResultBody(text, options.format); return ''; } catch (error) { return error.message; } }
export const SUMMARY_INVALID_PATTERNS = [], SUMMARY_LAZY_PATTERNS = [], SUMMARY_WRAPPER_LINE_PATTERNS = [], SUMMARY_HEADER_PATTERN = /^---\s*\r?\n[^\r\n]+[:：]\s*$/m;
export const finalizeSummarySave = (name, content) => upsertSummaryEntryByName(name, content);
export const finalizeMegaSummarySave = (name, content, names) => upsertMegaSummaryEntry(name, content, names);

export async function computeSummaryPreview(settings = getSettings()) {
  const token=captureContext(),lastId=getLastMessageId();
  const { floors, archive, entries } = await getCoverage();
  const ignored = [...archive.excluded, ...entries.filter(entry => isEntryDisabled(entry) && !archive.records[entry.name]?.invalid).map(entry => parseRange(entry.name)).filter(Boolean)];
  const isIgnored = id => ignored.some(range => id >= range.start && id <= range.end);
  const raw = await getRawMessages(0, lastId);
  const story = raw.filter(message => !isDiscussionMessage(message));
  const outstanding = story.filter(message => !floors.has(message.id) && !isIgnored(message.id));
  let boundary=Math.max(0,story.length-settings.keepFloorCount);
  while(boundary>0&&story[boundary-1].role!=='assistant')boundary--;
  const keepBoundary=story[boundary-1]?.id??-1,retained=story.slice(boundary);
  const eligible = outstanding.filter(message => message.id <= keepBoundary);
  const processed=processMessagesByTags(eligible,settings.includeTags,settings.excludeTags,settings.excludeHtmlComments);
  const weights=new Map(processed.map(message=>[message.id,message.content.length]));
  const retention={keepFloorCount:settings.keepFloorCount,retainedFloorCount:retained.length,retainedStartFloor:retained[0]?.id??null,retainedEndFloor:retained.at(-1)?.id??null};
  const plans=splitFloorBatches(eligible,settings.batchFloorCount,{canBridgeGap:bridgeDiscussionGaps(raw),weightOf:message=>weights.get(message.id)??0})
    .map(plan=>({...plan,lastId,unsummarizedCount:outstanding.length,...retention}));
  const plannedFloorCount=plans.reduce((sum,plan)=>sum+plan.floorCount,0);
  checkContext(token);
  return {plans,lastId,unsummarizedCount:outstanding.length,plannedFloorCount,remainingCount:outstanding.length-plannedFloorCount,...retention,
    triggerFloorCount:settings.triggerFloorCount,keepFloorCount:settings.keepFloorCount,batchFloorCount:settings.batchFloorCount,ready:outstanding.length>=settings.triggerFloorCount&&plans.length>0,enabled:settings.enabled};
}
export async function computeSummaryPlans(settings = getSettings()) { return (await computeSummaryPreview(settings)).plans; }
export async function computeSummaryPlan() { return (await computeSummaryPlans())[0]??null; }
export async function shouldAutoTrigger() { const plan = await computeSummaryPlan(); return !!plan && plan.unsummarizedCount >= getSettings().triggerFloorCount; }
export async function computeMegaPlan() {
  const settings = getSettings(); if (!settings.autoMegaSummary) return null;
  const { entries, archive, sources } = await getCoverage();
  const normals = entries.filter(entry => entry.name.startsWith('总结') && parseRange(entry.name) && !isEntryDisabled(entry) && recordValid(entry, archive, sources, entries)).sort((a, b) => parseRange(a.name).start - parseRange(b.name).start);
  if (normals.length < settings.megaTriggerCount) return null;
  for (let i = 0; i <= normals.length - settings.megaBatchCount; i++) {
    const names = normals.slice(i, i + settings.megaBatchCount).map(entry => entry.name);
    try {
      const discussionIds = new Set((await getRawMessages(0, getLastMessageId())).filter(isDiscussionMessage).map(message => message.id));
      const ranges = consecutiveSummaries(names, { discussionIds }), entryName = makeMegaSummaryEntryName(ranges[0].start, ranges.at(-1).end);
      if (!archive.megaExcluded.some(name=>{const range=parseRange(name);return range&&range.end>=ranges[0].start&&range.start<=ranges.at(-1).end;})) return { summaryNames: names, entryName };
    } catch { /* Skip a gap, never claim its intervening floors. */ }
  }
  return null;
}
export async function validateManualSummaryRange(start, end, { replacing = false } = {}) {
  const lastId = getLastMessageId();
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || start > end || end > lastId) return { ok: false, message: '请输入当前聊天内有效的整数楼层范围。' };
  if (!replacing) { const { floors } = await getCoverage(); for (let id = start; id <= end; id++) if (floors.has(id)) return { ok: false, message: '范围与有效总结重叠，请使用对应条目的重新生成。' }; }
  return { ok: true, lastId };
}
export async function executeSummary(startFloor, endFloor, entryName, options = {}) {
  if(options.regenerate){const {entries,megaMap}=await getCoverage();if(entries.some(entry=>!isEntryDisabled(entry)&&megaMap[entry.name]?.includes(entryName)))throw new Error('该条目已被大总结包含，请先回档对应的大总结再重生成');}
  const validation = await validateManualSummaryRange(startFloor, endFloor, { replacing: options.regenerate });
  if (!validation.ok) throw new Error(validation.message);
  const raw=await getRawMessages(startFloor,endFloor),story=raw.filter(message=>!isDiscussionMessage(message));
  if(!story.some(message=>message.role==='assistant'))return showSummaryHint('所选范围没有可归档的 AI 正文');
  return runSummaryTask({ kind: 'normal', startFloor, endFloor, entryName, floorCount:story.length, regenerate: !!options.regenerate });
}
export async function executeMegaSummary(summaryNames, entryName, options = {}) {
  const discussionIds = new Set((await getRawMessages(0, getLastMessageId())).filter(isDiscussionMessage).map(message => message.id));
  const ranges = consecutiveSummaries(summaryNames, { discussionIds });
  return runSummaryTask({ kind: 'mega', summaryNames, entryName, startFloor: ranges[0].start, endFloor: ranges.at(-1).end, regenerate: !!options.regenerate });
}
export async function retryTask(mode, body) {
  const previous = getTask(); if (!previous || previous.running) return;
  return runSummaryTask(previous.spec, { previous, mode, editedBody: body });
}
export function skipPendingTask() {
  const task = getTask(); if (!task || task.running) return;
  const index=task.selectedBatch??0,batch=task.batches?.[index],spec=batch?.spec??task.spec;
  excludeRange(spec.entryName,{mega:spec.kind==='mega'});
  if(task.batches?.length>1){
    const batches=task.batches;batches[index].phase='skipped';
    const next=batches.findIndex(item=>!['complete','skipped','paused'].includes(item.phase));
    if(next>=0){updatePendingTask({...taskBatchFields(batches[next]),batches,selectedBatch:next,phase:'pending',message:'已跳过此批，其他批次可继续处理'});return;}
  }
  clearTask();
}
export async function startSummaryProcess() { const plans=await computeSummaryPlans();if(!plans.length)return showSummaryHint('当前没有可以总结的完整楼层范围');return runSummaryTask(batchTaskSpec(plans)); }
export async function startCustomRangeSummaryProcess() {
  const plan = await computeSummaryPlan();
  const last=getLastMessageId();if(last<0)return showSummaryHint('聊天中还没有可总结的楼层');
  const raw=await getRawMessages(0,last);
  const input=await getHost().form({title:'指定楼层总结',message:`楼层编号从 0 开始，当前最后一楼为 #${last}。所选范围一次生成，不受每批目标或保留楼层设置限制。`,
    fields:[{name:'start',label:'起始楼层编号',type:'number',min:0,max:last,step:1,value:plan?.startFloor??0},{name:'end',label:'结束楼层编号',type:'number',min:0,max:last,step:1,value:plan?.endFloor??last}],
    choices:[['一次生成','__form__'],['取消',null]],
    render:({doc,content})=>{
      const preview=doc.createElement('p');preview.dataset.rangePreview='';preview.setAttribute('role','status');content.append(preview);
      const update=()=>{
        const start=content.querySelector('[data-form-field="start"]').valueAsNumber,end=content.querySelector('[data-form-field="end"]').valueAsNumber;
        if(!Number.isInteger(start)||!Number.isInteger(end)||start<0||end<start||end>last){preview.textContent='请填写有效的起止编号。';return;}
        const selected=raw.filter(message=>message.id>=start&&message.id<=end),discussion=selected.filter(isDiscussionMessage).length;
        preview.textContent=`所选 #${start}—#${end}，共 ${selected.length} 楼；${discussion?`其中 ${selected.length-discussion} 楼剧情材料，跳过 ${discussion} 楼讨论；`:''}将一次生成。`;
      };
      content.addEventListener('input',update);update();
    },
    validate:value=>Number.isInteger(value.start)&&Number.isInteger(value.end)&&value.start>=0&&value.end>=value.start&&value.end<=last?'':`请填写 0—${last} 之间、起点不大于终点的整数。`});
  if(!input)return;
  return executeSummary(input.start,input.end,makeSummaryEntryName(input.start,input.end));
}
export async function regenerateAndReplaceEntry(name) { const range = parseRange(name); if (!range) throw new Error('条目名称无效'); return executeSummary(range.start, range.end, name, { regenerate: true }); }
export async function regenerateAndReplaceMegaEntry(name) { await auditArchiveSources(); const names = await getMegaSummaryMapping(name); if (!names?.length) throw new Error('缺少原始总结来源映射，请检查对应楼层的普通总结是否完整'); return executeMegaSummary(names, name, { regenerate: true }); }
export async function autoTriggerSummary() {
  const token = captureContext();
  await auditArchiveSources(); await applySummarizedFloorsVisibility(); checkContext(token);
  while (getSettings().enabled && !['pending','stopped'].includes(getTask()?.phase)) {
    const mega = await computeMegaPlan(); checkContext(token);
    if (mega) { if (!await executeMegaSummary(mega.summaryNames, mega.entryName)) break; continue; }
    const plans = await computeSummaryPlans(); checkContext(token);
    if (!plans.length || plans[0].unsummarizedCount < getSettings().triggerFloorCount) break;
    if (!await runSummaryTask(batchTaskSpec(plans),{automatic:true})) break;
  }
}
