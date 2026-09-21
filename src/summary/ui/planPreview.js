/**
 * ui/planPreview.js
 * 把 summary.js computeSummaryPreview 的结果格式化成“实际聊天预览”文案。
 * 只做格式化：不读设置、不补缺字段、不重新统计楼层。
 */

export const floorRange = (start, end) => Number.isInteger(start) && Number.isInteger(end) && start <= end ? `#${start}—#${end}` : '';

export function planStatusText(preview) {
  const parts = [];
  if (!preview.enabled) parts.push('自动总结已暂停，“立即总结”仍会处理一轮。');
  if (preview.lastId < 0) return `${parts.join('')}当前聊天还没有可总结的楼层。`;
  if (!preview.unsummarizedCount) return `${parts.join('')}当前没有未总结消息。`;
  parts.push(preview.unsummarizedCount >= preview.triggerFloorCount
    ? `未总结 ${preview.unsummarizedCount} 楼，已达到 ${preview.triggerFloorCount} 楼的启动条件。`
    : `未总结 ${preview.unsummarizedCount} 楼，达到 ${preview.triggerFloorCount} 楼后自动总结（还差 ${preview.triggerFloorCount - preview.unsummarizedCount} 楼）。`);
  if (!preview.plans.length) parts.push('当前没有可总结的完整范围；最近消息与尚未完成的对话会继续保留。');
  return parts.join('');
}

export function planSummaryText(preview) {
  if (!preview.plans.length) return '';
  const parts = [`本轮 ${preview.plans.length} 批`, `实际 ${preview.plannedFloorCount} 楼`, `每批目标 ${preview.batchFloorCount} 楼`];
  if (preview.retainedFloorCount) parts.push(`保留最近 ${preview.retainedFloorCount} 楼${retentionRange(preview)}${preview.retainedFloorCount>preview.keepFloorCount?'，为保持完整对话多留':''}`);
  parts.push(preview.remainingCount ? `本轮后未总结剩 ${preview.remainingCount} 楼` : '本轮后没有剩余未总结楼层');
  return `${parts.join(' · ')}。`;
}

export function planBatchChips(preview) {
  const chips = preview.plans.slice(0, 6).map((plan, index) => `第 ${index + 1} 批 · ${plan.floorCount} 楼 · ${floorRange(plan.startFloor, plan.endFloor)}`);
  if (preview.plans.length > chips.length) chips.push(`…共 ${preview.plans.length} 批`);
  return chips;
}

const retentionRange = preview => {
  const range = floorRange(preview.retainedStartFloor, preview.retainedEndFloor);
  return range ? `（${range}）` : '';
};
