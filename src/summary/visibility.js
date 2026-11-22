import { assertRecordWritable, writeVariableKeys, setChatMessages, captureContext, checkContext } from '../platform/lifecycle.js';
import { fingerprint, sourceOf } from './provenance.js';
import { isSummaryDiscussion } from './messages.js';
import { AUTO_HIDDEN_FLOORS_VAR_KEY, AUTO_HIDDEN_FINGERPRINTS_VAR_KEY, VISIBILITY_AUTOMATION_VAR_KEY, VISIBILITY_OVERRIDES_VAR_KEY } from '../platform/storage-keys.js';

export const VISIBILITY_OVERRIDES_KEY = VISIBILITY_OVERRIDES_VAR_KEY;
export const VISIBILITY_AUTOMATION_KEY = VISIBILITY_AUTOMATION_VAR_KEY;
const AUTO_HIDDEN_KEY = AUTO_HIDDEN_FLOORS_VAR_KEY;
const contentFingerprint = msg => fingerprint([msg.role, msg.name ?? '', msg.swipe_id ?? null, msg.message ?? '']);
function groupFloorIds(signatures) {
  const bySignature = new Map();
  signatures.forEach((signature, id) => {
    if (!bySignature.has(signature)) bySignature.set(signature, []);
    bySignature.get(signature).push(id);
  });
  return bySignature;
}
// After deletions the surviving messages form a subsequence. Surrounding
// messages can identify a repeated reply even when its occurrence count fell.
function ownershipAfterDeletion(previous, current, owned) {
  const earliest = [];
  let cursor = 0;
  for (const signature of current) {
    while (cursor < previous.length && previous[cursor] !== signature) cursor++;
    if (cursor === previous.length) return null;
    earliest.push(cursor++);
  }
  const unownedSignatures = new Set(previous.filter((_, id) => !owned.has(id)));
  const result = new Set();
  cursor = previous.length - 1;
  for (let id = current.length - 1; id >= 0; id--) {
    while (previous[cursor] !== current[id]) cursor--;
    if ((cursor === earliest[id] && owned.has(cursor)) || !unownedSignatures.has(current[id])) result.add(id);
    cursor--;
  }
  return result;
}
export function autoHiddenOwnership(ids, messages) {
  const floors = [...new Set(ids)].sort((a, b) => a - b);
  const signatures = [];
  if (floors.length) for (const message of messages) signatures[message.message_id] = contentFingerprint(message);
  return { [AUTO_HIDDEN_KEY]: floors, [AUTO_HIDDEN_FINGERPRINTS_VAR_KEY]: signatures };
}
export function loadAutoHiddenFloorIds(messages = allFloorMessages()) {
  const vars = getVariables({ type: 'chat' }), owned = new Set(vars?.[AUTO_HIDDEN_KEY] ?? []);
  const previous = vars?.[AUTO_HIDDEN_FINGERPRINTS_VAR_KEY];
  if (!owned.size || !previous?.length) return owned;
  const current = [];
  for (const message of messages) current[message.message_id] = contentFingerprint(message);
  if (current.length < previous.length) {
    const survivors = ownershipAfterDeletion(previous, current, owned);
    if (survivors) return survivors;
  }
  if (current.length >= previous.length) {
    const replaced = new Set(), replacements = new Set();
    current.forEach((signature, id) => {
      if (signature === previous[id]) return;
      if (id < previous.length) replaced.add(previous[id]);
      replacements.add(signature);
    });
    // Edits and appended messages retain floor ownership. Only remap if an
    // old signature could have moved from one changed slot into another.
    if (![...replaced].some(signature => replacements.has(signature))) return owned;
  }
  const oldIds = groupFloorIds(previous), newIds = groupFloorIds(current), result = new Set();
  for (const [signature, group] of oldIds) {
    const now = newIds.get(signature) ?? [];
    if (group.length === now.length) {
      group.forEach((id, i) => { if (owned.has(id)) result.add(now[i]); });
    } else if (now.length <= group.length && group.every(id => owned.has(id))) {
      for (const id of now) result.add(id);
    } else if (current.length >= previous.length && group.every(id => current[id] === signature)) {
      for (const id of group) if (owned.has(id)) result.add(id);
    }
  }
  // An edit or swipe replaces the text in place. A deletion moves an existing
  // fingerprint into that slot, so it must not inherit the deleted floor's flag.
  if (previous.length === current.length) for (const id of owned) {
    if (current[id] && !newIds.has(previous[id]) && !oldIds.has(current[id])) result.add(id);
  }
  return result;
}
export function allFloorMessages() {
  const last = getLastMessageId();
  return last < 0 ? [] : getChatMessages(`0-${last}`, {role:'all',hide_state:'all',include_swipes:false}).filter(message => Number.isInteger(message.message_id) && message.message_id >= 0).sort((a,b)=>a.message_id-b.message_id);
}
export function readVisibilityOverrides(messages = allFloorMessages()) {
  const saved = getVariables({type:'chat'})?.[VISIBILITY_OVERRIDES_KEY] ?? {};
  return Object.fromEntries(messages.filter(message => {
    const value = saved[message.message_id];
    return value && typeof value.hidden === 'boolean' && value.fingerprint === sourceOf(message).fingerprint;
  }).map(message => [message.message_id,saved[message.message_id]]));
}
export function readVisibilityAutomation(fallback = true, messages) {
  const saved = getVariables({type:'chat'})?.[VISIBILITY_AUTOMATION_KEY];
  if (typeof saved === 'boolean') return saved;
  return Object.values(readVisibilityOverrides(messages)).some(value => value.scope !== 'discussion') ? false : fallback !== false;
}
export function setFloorVisibilityAutomation(enabled) {
  assertRecordWritable();
  if (typeof enabled !== 'boolean') throw new Error('自动隐藏开关状态无效');
  const patch = {[VISIBILITY_AUTOMATION_KEY]:enabled};
  if (enabled) {
    const messages = allFloorMessages();
    const owned = loadAutoHiddenFloorIds(messages);
    // Reset general floor controls while preserving choices made in Discussion
    // Records. Native manual choices remain outside assistant ownership.
    const overrides = readVisibilityOverrides(messages);
    Object.assign(patch, autoHiddenOwnership([...owned, ...Object.entries(overrides).filter(([,value])=>value.scope!=='discussion').map(([id])=>Number(id))], messages));
    patch[VISIBILITY_OVERRIDES_KEY] = Object.fromEntries(Object.entries(overrides).filter(([,value])=>value.scope==='discussion'));
  }
  writeVariableKeys(patch,{type:'chat'});
}
/** Discussion can follow two covered story boundaries without becoming a source. */
export function discussionFloorsWithinCoverage(messages, floors) {
  const result = new Set();
  let leftCovered = false, pending = [], previous = -1;
  for (const message of messages) {
    const id = message.message_id;
    if (id !== previous + 1) { leftCovered = false; pending = []; }
    previous = id;
    if (isSummaryDiscussion(message)) {
      if (leftCovered) pending.push(id);
      continue;
    }
    if (leftCovered && floors.has(id)) for (const floor of pending) result.add(floor);
    pending = [];
    leftCovered = floors.has(id);
  }
  return result;
}
export function visibilitySnapshot(floors = new Set()) {
  const messages = allFloorMessages(), overrides = readVisibilityOverrides(messages);
  const discussionFloors = discussionFloorsWithinCoverage(messages, floors);
  const owned = loadAutoHiddenFloorIds(messages);
  const counts = { total:messages.length, shown:0, hidden:0, user:0, assistant:0, system:0, shownUser:0, shownAssistant:0, covered:0 };
  const groups = [];
  for (const message of messages) {
    const id=message.message_id, hidden=!!message.is_hidden, role=message.role, discussion=isSummaryDiscussion(message), covered=!discussion&&floors.has(id), followsSummary=discussionFloors.has(id);
    counts[hidden?'hidden':'shown']++;
    counts[role === 'user' ? 'user' : role === 'assistant' ? 'assistant' : 'system']++;
    if (!hidden && role === 'user') counts.shownUser++;
    if (!hidden && role === 'assistant') counts.shownAssistant++;
    if (covered) counts.covered++;
    const state = hidden ? owned.has(id) ? '自动隐藏' : '手动隐藏' : overrides[id]?.hidden === false ? '手动显示' : '显示';
    const key = [role,discussion,hidden,covered,followsSummary,state,id===0].join('|'), previous=groups.at(-1);
    if (previous?.key === key && previous.to + 1 === id) { previous.to=id;previous.count++; }
    else groups.push({key,from:id,to:id,count:1,role,discussion,hidden,covered,followsSummary,state});
  }
  return {messages,counts,groups,overrides,owned,discussionFloors,shownIds:messages.filter(message=>!message.is_hidden).map(message=>message.message_id),hiddenIds:messages.filter(message=>message.is_hidden).map(message=>message.message_id)};
}
export async function setManualFloorVisibility(from, to, hidden, role = 'all') {
  assertRecordWritable();
  const last=getLastMessageId();
  if (![from,to].every(Number.isInteger) || from < 0 || to < from || to > last) throw new Error(`请输入 0—${Math.max(0,last)} 之间、起点不大于终点的整数楼层`);
  if (!['all','user','assistant','system'].includes(role)) throw new Error('消息类型无效');
  const ids=allFloorMessages().filter(message=>message.message_id>=from&&message.message_id<=to&&(role==='all'||message.role===role)).map(message=>message.message_id);
  return setManualFloorVisibilityByIds(ids,hidden);
}
export async function setManualFloorVisibilityByIds(ids, hidden, { discussionSources = null } = {}) {
  assertRecordWritable();
  if (typeof hidden !== 'boolean') throw new Error('显隐状态无效');
  const token=captureContext(), wanted=new Set(ids);
  const messages=allFloorMessages(), selected=messages.filter(message=>wanted.has(message.message_id));
  if(selected.length!==wanted.size)throw new Error('所选楼层已变化，请刷新后重试');
  if(discussionSources) assertDiscussionSelection(selected, discussionSources);
  if(!selected.length)return 0;
  const overrides=readVisibilityOverrides(messages);
  for (const message of selected) overrides[message.message_id]={hidden,fingerprint:sourceOf(message).fingerprint,...(discussionSources?{scope:'discussion'}:{})};
  const selectedIds=new Set(selected.map(message=>message.message_id));
  const owned = [...loadAutoHiddenFloorIds(messages)].filter(id=>!selectedIds.has(id));
  writeVariableKeys({...(discussionSources?{}:{[VISIBILITY_AUTOMATION_KEY]:false}),[VISIBILITY_OVERRIDES_KEY]:overrides,...autoHiddenOwnership(owned,messages)},{type:'chat'});
  const updates=selected.filter(message=>!!message.is_hidden!==hidden).map(message=>({message_id:message.message_id,is_hidden:hidden}));
  for(let index=0;index<updates.length;index+=200) await setChatMessages(updates.slice(index,index+200),{refresh:'affected'});
  checkContext(token);
  const actual=new Map(allFloorMessages().map(message=>[message.message_id,!!message.is_hidden]));
  if(!selected.every(message=>actual.get(message.message_id)===hidden)) throw new Error('楼层显隐没有全部保存，请重试');
  return updates.length;
}

function assertDiscussionSelection(messages, sources) {
  const expected = new Map(sources.map(source => [source.id, source.fingerprint]));
  if (expected.size !== sources.length || messages.length !== sources.length || messages.some(message => !isSummaryDiscussion(message) || expected.get(message.message_id) !== sourceOf(message).fingerprint)) {
    throw new Error('所选讨论记录已变化，请刷新后重试');
  }
}
export function restoreDiscussionVisibilityAutomation(sources) {
  assertRecordWritable();
  const messages = allFloorMessages(), wanted = new Set(sources.map(source=>source.id));
  const selected = messages.filter(message=>wanted.has(message.message_id));
  assertDiscussionSelection(selected, sources);
  const overrides = readVisibilityOverrides(messages);
  for (const id of wanted) delete overrides[id];
  writeVariableKeys({[VISIBILITY_OVERRIDES_KEY]:overrides,...autoHiddenOwnership([...loadAutoHiddenFloorIds(messages),...wanted],messages)},{type:'chat'});
}
