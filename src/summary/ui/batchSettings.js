import { getSettings } from '../storage.js';
import { escapeHtml } from '../utils.js';
import { computeSummaryPreview } from '../summary.js';
import { captureContext, checkContext } from '../../platform/lifecycle.js';
import { planStatusText, planSummaryText, planBatchChips } from './planPreview.js';
import { readTagEditor } from './tagEditor.js';
/**
 * ui/batchSettings.js
 * 分批设置与“实际聊天预览”。
 * 预览读取面板草稿：改动立即重算，但不写入设置，也不影响正在运行的任务。
 * 依赖: storage.js, utils.js, summary.js, platform/lifecycle.js, ui/planPreview.js
 */

export const BATCH_PRESETS = {
  'with-summary': { triggerFloorCount:50, keepFloorCount:10 },
  'without-summary': { triggerFloorCount:20, keepFloorCount:5 },
};

const pendingLine = '<p class="sa-preview-line" data-preview-status>正在按当前草稿重新计算…</p>';

// Only the fields that change the plan are read from the draft; everything else
// comes from the saved settings so the planner always receives a complete value.
// An unfinished or impossible draft is reported instead of falling back to the
// saved numbers, which would show a plan the drafts do not describe. Messages
// match settingsSchema.
function draftSettings(panel) {
  const current = getSettings(), field = selector => panel.querySelector(selector), number = id => field(id)?.valueAsNumber;
  const draft = {
    ...current,
    enabled: field('#sa-enabled')?.checked ?? current.enabled,
    triggerFloorCount: number('#sa-trigger-count'),
    keepFloorCount: number('#sa-keep-count'),
    batchFloorCount: number('#sa-batch-count'),
    parallelBatches: field('#sa-parallel-batches')?.checked ?? current.parallelBatches,
    batchConcurrency: number('#sa-batch-concurrency'),
    includeTags: readTagEditor(panel,'includeTags'),
    excludeTags: readTagEditor(panel,'excludeTags'),
    excludeHtmlComments: field('#sa-exclude-html-comments').checked,
  };
  const problem = !['triggerFloorCount', 'keepFloorCount', 'batchFloorCount'].every(key => Number.isInteger(draft[key]) && draft[key] >= 1 && draft[key] <= 999) ? '总结楼层数须为 1—999 的整数'
    : draft.keepFloorCount >= draft.triggerFloorCount ? '保留楼层数须小于触发楼层数'
    : draft.parallelBatches && !(Number.isInteger(draft.batchConcurrency) && draft.batchConcurrency >= 1 && draft.batchConcurrency <= 8) ? '并发数须为 1—8 的整数'
    : '';
  return { draft, problem };
}

export function renderPlanPreview(preview) {
  const summary = planSummaryText(preview), chips = planBatchChips(preview);
  return `<p class="sa-preview-line" data-preview-status>${escapeHtml(planStatusText(preview))}</p>`
    + (summary ? `<p class="sa-preview-line" data-preview-plan>${escapeHtml(summary)}</p>` : '')
    + (chips.length ? `<ul class="sa-preview-batches" data-preview-batches>${chips.map(chip => `<li>${escapeHtml(chip)}</li>`).join('')}</ul>` : '');
}

export const renderPlanIssue = message => `<p class="sa-preview-line" data-preview-status data-preview-issue>${escapeHtml(message)}</p>`;

// Late results from a previous chat or an already disposed panel are dropped by
// the per-panel token; the context token additionally covers chat switches.
export async function refreshBatchPreview(panel) {
  const target = panel?.querySelector?.('[data-batch-preview]');
  if (!target) return;
  const { draft, problem } = draftSettings(panel);
  const token = (panel._planPreviewToken ?? 0) + 1; panel._planPreviewToken = token;
  if (problem) { target.innerHTML = renderPlanIssue(problem); return; }
  const context = captureContext();
  const current = () => panel._planPreviewToken === token && panel.isConnected;
  try {
    const preview = await computeSummaryPreview(draft);
    checkContext(context); if (!current()) return;
    target.innerHTML = renderPlanPreview(preview);
  } catch (error) {
    if (error?.name === 'AbortError' || !current()) return;
    target.innerHTML = renderPlanIssue(`读取当前聊天失败：${error?.message ?? '未知错误'}`);
  }
}

export function scheduleRefreshBatchPreview(panel, delay = 180) {
  if (!panel) return;
  clearTimeout(panel._planPreviewTimer);
  // Drop whatever is in flight before debouncing: the preview must never keep
  // showing the previous draft once the user edits a field.
  panel._planPreviewToken = (panel._planPreviewToken ?? 0) + 1;
  const target = panel.querySelector('[data-batch-preview]'), { problem } = draftSettings(panel);
  if (problem) { if (target) target.innerHTML = renderPlanIssue(problem); return; }
  if (target) target.innerHTML = pendingLine;
  panel._planPreviewTimer = setTimeout(() => { panel._planPreviewTimer = null; refreshBatchPreview(panel); }, delay);
}

export function disposeBatchPreview(panel) {
  if (!panel) return;
  clearTimeout(panel._planPreviewTimer); panel._planPreviewTimer = null;
  panel._planPreviewToken = (panel._planPreviewToken ?? 0) + 1;
}

function syncBatchControls(panel) {
  const parallel = panel.querySelector('#sa-parallel-batches').checked;
  panel.querySelector('#sa-batch-concurrency').disabled = !parallel;
  panel.querySelector('[data-batch-history-hint]').hidden = !parallel;
}

export function bindBatchSettings(panel) {
  panel.querySelector('#sa-batch-preset').addEventListener('change', event => {
    const preset = BATCH_PRESETS[event.target.value];
    if (preset) { panel.querySelector('#sa-trigger-count').value = preset.triggerFloorCount; panel.querySelector('#sa-keep-count').value = preset.keepFloorCount; }
    syncBatchControls(panel); scheduleRefreshBatchPreview(panel, 0);
  });
  for (const input of panel.querySelectorAll('#sa-trigger-count,#sa-keep-count,#sa-batch-count,#sa-parallel-batches,#sa-batch-concurrency,#sa-exclude-html-comments')) input.addEventListener('input', () => {
    if (['sa-trigger-count', 'sa-keep-count'].includes(input.id)) panel.querySelector('#sa-batch-preset').value = 'custom';
    syncBatchControls(panel); scheduleRefreshBatchPreview(panel);
  });
  syncBatchControls(panel);
  refreshBatchPreview(panel);
}
