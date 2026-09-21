import { makeSummaryEntryName } from './utils.js';
import { isDiscussionMessage } from '../discussion/protocol.js';

export function bridgeDiscussionGaps(messages) {
  const byId = new Map(messages.map(message => [message.id, message]));
  return (previous, current) => {
    for (let id = previous.id + 1; id < current.id; id++) {
      if (!isDiscussionMessage(byId.get(id))) return false;
    }
    return true;
  };
}

export function splitFloorBatches(messages, target, {canBridgeGap=null, weightOf=message=>String(message.content??message.message??'').length}={}) {
  if(!Number.isInteger(target)||target<1)throw new Error('每批目标楼层数须为正整数');
  const plans=[];
  for(let offset=0;offset<messages.length;){
    let end=offset+1;
    while(end<messages.length&&(messages[end].id===messages[end-1].id+1||canBridgeGap?.(messages[end-1],messages[end])))end++;
    plans.push(...balanceRun(messages.slice(offset,end),target,weightOf));
    offset=end;
  }
  return plans;
}

function balanceRun(messages,target,weightOf) {
  // Keep each user/AI exchange intact. An unfinished trailing turn waits.
  const units=[];let start=0,weight=0;
  for(let index=0;index<messages.length;index++){
    weight+=Math.max(1,weightOf(messages[index]));
    if(messages[index].role!=='assistant')continue;
    units.push({start,end:index,count:index-start+1,weight});start=index+1;weight=0;
  }
  if(!units.length)return [];
  const counts=[0],weights=[0],cap=Math.max(1,Math.floor(target*1.2));
  for(const unit of units){counts.push(counts.at(-1)+unit.count);weights.push(weights.at(-1)+unit.weight);}
  // First choose the fewest feasible batches, then minimize the heaviest batch.
  // Looking ahead prevents short early cuts from forcing a much heavier tail.
  const packing=maxWeight=>{
    const next=[],minimum=Array(units.length+1).fill(0);
    for(let index=0,stop=0;index<units.length;index++){
      stop=Math.max(stop,index+1);
      while(stop<units.length&&counts[stop+1]-counts[index]<=cap&&weights[stop+1]-weights[index]<=maxWeight)stop++;
      next[index]=stop;
    }
    for(let index=units.length-1;index>=0;index--)minimum[index]=1+minimum[next[index]];
    return {next,minimum};
  };
  const batchCount=packing(Infinity).minimum[0];
  let low=units.reduce((max,unit)=>Math.max(max,unit.weight),0),high=weights.at(-1);
  while(low<high){
    const middle=Math.floor((low+high)/2);
    if(packing(middle).minimum[0]<=batchCount)high=middle;else low=middle+1;
  }
  const {next,minimum}=packing(low);
  const plans=[];let cursor=0,left=batchCount;
  while(left){
    const desiredWeight=(weights.at(-1)-weights[cursor])/left;
    const desiredCount=(counts.at(-1)-counts[cursor])/left;
    let stop=cursor+1,bestWeight=Infinity,bestCount=Infinity;
    for(let candidate=cursor+1;candidate<=next[cursor];candidate++){
      if(minimum[candidate]>left-1||units.length-candidate<left-1)continue;
      const weightError=Math.abs(weights[candidate]-weights[cursor]-desiredWeight);
      const countError=Math.abs(counts[candidate]-counts[cursor]-desiredCount);
      if(weightError<bestWeight||(weightError===bestWeight&&countError<bestCount)){
        stop=candidate;bestWeight=weightError;bestCount=countError;
      }
    }
    const startFloor=messages[units[cursor].start].id,endFloor=messages[units[stop-1].end].id;
    plans.push({startFloor,endFloor,entryName:makeSummaryEntryName(startFloor,endFloor),floorCount:counts[stop]-counts[cursor],materialChars:weights[stop]-weights[cursor]});
    cursor=stop;left--;
  }
  return plans;
}

export function batchTaskSpec(plans) {
  const batches=plans.map(({startFloor,endFloor,entryName,floorCount})=>({kind:'normal',startFloor,endFloor,entryName,floorCount,regenerate:false}));
  if(!batches.length)throw new Error('没有可以总结的完整楼层范围');
  const retention=Object.fromEntries(['keepFloorCount','retainedFloorCount','retainedStartFloor','retainedEndFloor'].filter(key=>plans[0][key]!==undefined).map(key=>[key,plans[0][key]]));
  return {...(batches.length===1?batches[0]:{kind:'batch',startFloor:batches[0].startFloor,endFloor:batches.at(-1).endFloor,floorCount:batches.reduce((sum,batch)=>sum+batch.floorCount,0),batches}),...retention};
}
