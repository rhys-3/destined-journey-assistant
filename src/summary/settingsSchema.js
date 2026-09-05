import { DEFAULT_SETTINGS, BLOCK_TYPES } from './config.js';

const booleans = ['enabled','includeOldSummary','autoTriggerConfirm','autoHideSummarizedFloors','noTransTag','excludeHtmlComments'];
const strings = ['customApiUrl','customApiModel','customApiSource','userPrefix','assistantPrefix','noTransTagValue'];
function demand(value, message) { if(!value) throw new Error(message); }
export function summarySnapshot(input) {
  demand(input && typeof input === 'object' && !Array.isArray(input), '总结配置格式无效');
  const value = { ...structuredClone(DEFAULT_SETTINGS), ...input };
  const out = {};
  for (const key of booleans) { demand(typeof value[key] === 'boolean', `总结参数 ${key} 必须是开关`); out[key]=value[key]; }
  for (const key of strings) { demand(typeof value[key] === 'string', `总结参数 ${key} 必须是文本`); out[key]=value[key]; }
  demand(['tavern','custom'].includes(value.apiMode), '总结 API 模式无效'); out.apiMode=value.apiMode;
  for (const key of ['triggerFloorCount','keepFloorCount']) {
    demand(Number.isInteger(value[key]) && value[key]>=1 && value[key]<=999, '总结楼层数须为 1—999 的整数'); out[key]=value[key];
  }
  demand(out.keepFloorCount < out.triggerFloorCount, '保留楼层数须小于触发楼层数');
  for (const key of ['temperature','maxTokens']) {
    const field=value[key];
    demand(field==='same_as_preset' || ((typeof field==='number'||typeof field==='string') && String(field).trim()!=='' && Number.isFinite(Number(field))), `${key} 须为数字或 same_as_preset`);
    out[key]=field==='same_as_preset'?field:Number(field);
  }
  demand(out.temperature==='same_as_preset'||out.temperature>=0, '温度不能为负数');
  demand(out.maxTokens==='same_as_preset'||(Number.isInteger(out.maxTokens)&&out.maxTokens>0), '最大 Tokens 须为正整数');
  for (const key of ['includeTags','excludeTags']) {
    demand(Array.isArray(value[key])&&value[key].every(t=>typeof t==='string'&&/^[\w:-]+$/.test(t)), '标签名称格式无效'); out[key]=[...value[key]];
  }
  for (const key of ['promptBlocks','megaPromptBlocks']) {
    demand(Array.isArray(value[key]), '总结提示词板块必须是列表'); const ids=new Set();
    out[key]=value[key].map(block=>{
      demand(block && typeof block.id==='string' && block.id && !ids.has(block.id), '总结板块 ID 缺失或重复'); ids.add(block.id);
      demand(Object.values(BLOCK_TYPES).includes(block.type) && typeof block.name==='string' && typeof block.enabled==='boolean', '总结板块格式无效');
      const item={id:block.id,type:block.type,name:block.name,enabled:block.enabled};
      if(block.type!==BLOCK_TYPES.BUILTIN_GROUP) { demand(['system','user','assistant'].includes(block.role),'总结板块角色无效'); item.role=block.role; }
      for(const field of ['content','leadText','xmlTag']) if(Object.hasOwn(block,field)) { demand(typeof block[field]==='string','总结板块内容须为文本'); item[field]=block[field]; }
      if(item.xmlTag) demand(/^[\w:-]+$/.test(item.xmlTag),'总结内容标签格式无效');
      return item;
    });
  }
  return out;
}
