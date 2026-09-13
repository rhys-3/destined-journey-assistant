import { isBusy, getHost, runAction, captureContext, checkContext } from '../../platform/lifecycle.js';
import { setManualFloorVisibilityByIds, restoreDiscussionVisibilityAutomation, readVisibilityAutomation } from '../visibility.js';
import { applySummarizedFloorsVisibility } from '../worldbook.js';
import { sourceOf } from '../provenance.js';
import { getSettings } from '../storage.js';
import { isDiscussionMessage } from '../../discussion/protocol.js';
import { escapeHtml } from '../utils.js';

export const DISCUSSION_PAGE_SIZE = 30;

const roleLabel = role => role === 'user' ? '用户输入' : role === 'assistant' ? 'AI 输出' : '系统消息';
const visibilityLabel = record => {
  if (record.override) return record.override.hidden ? '手动隐藏' : '手动显示';
  if (record.is_hidden && record.owned) return '随总结隐藏';
  return record.is_hidden ? '已隐藏' : '显示中';
};
const sourceFor = message => sourceOf(message);
const preview = message => String(message ?? '').slice(0, 512).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 88);

export function discussionRecordPage(snapshot, query = {}) {
  const matches = message => isDiscussionMessage(message)
    && (!query.role || query.role === 'all' || message.role === query.role)
    && (!query.visibility || query.visibility === 'all' || !!message.is_hidden === (query.visibility === 'hidden'));
  const messages = snapshot.messages.filter(matches).reverse();
  const pages = Math.max(1, Math.ceil(messages.length / DISCUSSION_PAGE_SIZE));
  let page = query.page ?? 0;
  if (Number.isInteger(query.jump)) {
    const index = messages.findIndex(message => message.message_id === query.jump);
    page = Math.floor((index < 0 ? 0 : index) / DISCUSSION_PAGE_SIZE);
  }
  page = Math.max(0, Math.min(pages - 1, page));
  const records = messages.slice(page * DISCUSSION_PAGE_SIZE, (page + 1) * DISCUSSION_PAGE_SIZE).map(message => ({
    ...message,
    override: snapshot.overrides?.[message.message_id],
    owned: snapshot.owned?.has(message.message_id) ?? false,
    followsSummary: snapshot.discussionFloors?.has(message.message_id) ?? false,
  }));
  return { page, pages, count: messages.length, records };
}

function renderRecord(record, selected) {
  const floor = record.message_id;
  const state = visibilityLabel(record);
  const author = escapeHtml(record.name || roleLabel(record.role));
  return `<tr data-discussion-row="${floor}"><td><label class="sa-discussion-select"><input type="checkbox" data-discussion-select value="${floor}" ${selected ? 'checked' : ''} aria-label="选择第 ${floor} 楼讨论记录"><span>${floor} 楼</span></label><span class="sa-discussion-role">${author} · ${roleLabel(record.role)}</span><span class="sa-discussion-preview">${escapeHtml(preview(record.message)) || '（空记录）'}</span></td><td><span class="sa-floor-state ${record.is_hidden ? 'is-hidden' : 'is-shown'}">${state}</span></td><td><button type="button" class="sa-btn sa-btn-sm" data-discussion-view="${floor}">查看</button><button type="button" class="sa-btn sa-btn-sm" data-discussion-mutate="${record.is_hidden ? 'show' : 'hide'}" data-discussion-id="${floor}" ${isBusy() ? 'disabled' : ''}>${record.is_hidden ? '显示' : '隐藏'}</button><button type="button" class="sa-btn sa-btn-sm" data-discussion-mutate="auto" data-discussion-id="${floor}" ${isBusy() ? 'disabled' : ''}>恢复自动</button></td></tr>`;
}

export function refreshDiscussionRecords(panel, { force = false } = {}) {
  const target = panel.querySelector('[data-discussion-records]');
  if (!target) return;
  const snapshot = panel._visibilitySnapshot;
  if (!snapshot) {
    target.innerHTML = '<p class="sa-empty">等待楼层快照…</p>';
    return;
  }
  const count = snapshot.messages.filter(isDiscussionMessage).length;
  target.dataset.discussionCount = String(count);
  const tab = panel.querySelector('[data-tab="discussion"]');
  if (tab) tab.textContent = count ? `讨论记录（${count}）` : '讨论记录';
  const pane = target.closest('[data-pane="discussion"]');
  if (!force && !pane?.classList.contains('active')) {
    return;
  }
  const query = panel._discussionQuery ??= { page: 0, role: 'all', visibility: 'all' };
  const state = discussionRecordPage(snapshot, query);
  query.page = state.page;
  delete query.jump;
  const selected = panel._discussionSelected ??= new Set();
  if (panel._discussionSelectionSnapshot && panel._discussionSelectionSnapshot !== snapshot) selected.clear();
  panel._discussionSelectionSnapshot = snapshot;
  const available = new Set(state.records.map(record => record.message_id));
  for (const id of [...selected]) if (!available.has(id)) selected.delete(id);
  const allSelected = state.records.length > 0 && state.records.every(record => selected.has(record.message_id));
  target.dataset.selectionCount = String(selected.size);
  const options = (items, value) => items.map(([option, label]) => `<option value="${option}" ${option === value ? 'selected' : ''}>${label}</option>`).join('');
  const max = snapshot.messages.at(-1)?.message_id ?? 0;
  const automation = readVisibilityAutomation(getSettings().autoHideSummarizedFloors, snapshot.messages);
  const automationHint = automation === false
    ? '按总结自动隐藏当前已暂停；“恢复自动”会清除讨论专页选择，重新开启全局自动后才会按总结隐藏。'
    : '讨论只在两段已总结剧情之间时随总结隐藏；最新讨论会保留。手动显示或隐藏会持续保留。';
  target.innerHTML = `<section class="sa-discussion-section"><div class="sa-discussion-intro"><p>独立管理讨论模式留下的记录；讨论不会被当作剧情总结来源。</p><p class="sa-hint">${automationHint}</p></div><div class="sa-floor-filters"><label>消息类型<select class="sa-select" data-discussion-filter="role">${options([['all', '全部类型'], ['user', '用户输入'], ['assistant', 'AI 输出'], ['system', '系统消息']], query.role)}</select></label><label>显示状态<select class="sa-select" data-discussion-filter="visibility">${options([['all', '全部状态'], ['shown', '仅显示'], ['hidden', '仅隐藏']], query.visibility)}</select></label></div><div class="sa-floor-jump"><input class="sa-input" type="number" min="0" max="${max}" placeholder="输入讨论楼层" aria-label="定位讨论楼层" data-discussion-jump-input><button class="sa-btn" type="button" data-discussion-jump>前往</button></div><div class="sa-discussion-batch"><label class="sa-discussion-select"><input type="checkbox" data-discussion-select-page ${allSelected ? 'checked' : ''} ${state.records.length ? '' : 'disabled'}>选择本页</label><span class="sa-hint" data-discussion-selection>已选 ${selected.size} 条 · 共 ${state.count} 条讨论记录，每页最多 ${DISCUSSION_PAGE_SIZE} 条；新记录在前。</span><div class="sa-btn-group"><button type="button" class="sa-btn" data-discussion-batch="show" data-discussion-mutate ${selected.size && !isBusy() ? '' : 'disabled'}>批量显示</button><button type="button" class="sa-btn" data-discussion-batch="hide" data-discussion-mutate ${selected.size && !isBusy() ? '' : 'disabled'}>批量隐藏</button><button type="button" class="sa-btn" data-discussion-batch="auto" data-discussion-mutate ${selected.size && !isBusy() ? '' : 'disabled'}>批量恢复自动</button></div></div><div class="sa-floor-table-wrap"><table class="sa-floor-table sa-discussion-table"><thead><tr><th>楼层 / 类型</th><th>状态</th><th>操作</th></tr></thead><tbody>${state.records.map(record => renderRecord(record, selected.has(record.message_id))).join('') || '<tr><td colspan="3">没有符合筛选条件的讨论记录</td></tr>'}</tbody></table></div><div class="sa-floor-pages"><button type="button" class="sa-btn" data-discussion-page="-1" ${state.page === 0 ? 'disabled' : ''}>上一页</button><span role="status">${state.page + 1} / ${state.pages} 页</span><button type="button" class="sa-btn" data-discussion-page="1" ${state.page + 1 >= state.pages ? 'disabled' : ''}>下一页</button></div></section>`;
}

function selectedRecords(panel, ids) {
  const byId = new Map((panel._visibilitySnapshot?.messages ?? []).map(message => [message.message_id, message]));
  const records = ids.map(id => byId.get(id)).filter(Boolean);
  if (records.length !== ids.length || records.some(message => !isDiscussionMessage(message))) throw new Error('所选讨论记录已变化，请刷新后重试');
  return records;
}

async function changeDiscussionVisibility(panel, ids, action, refresh) {
  const records = selectedRecords(panel, ids);
  const sources = records.map(sourceFor);
  if (action === 'auto') {
    restoreDiscussionVisibilityAutomation(sources);
    await applySummarizedFloorsVisibility();
  } else {
    await setManualFloorVisibilityByIds(ids, action === 'hide', { discussionSources: sources });
  }
  panel._discussionSelected?.clear();
  await refresh(panel);
}

async function viewDiscussionRecord(panel, id) {
  const token = captureContext();
  const cached = selectedRecords(panel, [id])[0];
  const current = getChatMessages(String(id), { role: 'all', hide_state: 'all', include_swipes: false }).find(message => message.message_id === id);
  if (!current || !isDiscussionMessage(current) || sourceFor(current).fingerprint !== sourceFor(cached).fingerprint) throw new Error('讨论记录已变化，请刷新后查看');
  checkContext(token);
  await getHost()?.viewText(`第 ${current.message_id} 楼讨论原文`, `[第 ${current.message_id} 楼 · ${roleLabel(current.role)} · ${current.is_hidden ? '隐藏' : '显示'}]\n${current.message ?? ''}`);
  checkContext(token);
}

export function bindDiscussionRecords(panel, refresh) {
  const render = () => refreshDiscussionRecords(panel);
  panel.addEventListener('change', event => {
    const target = event.target;
    if (target.matches('[data-discussion-filter]')) {
      panel._discussionQuery = { ...panel._discussionQuery, [target.dataset.discussionFilter]: target.value, page: 0 };
      render();
    } else if (target.matches('[data-discussion-select]')) {
      const selected = panel._discussionSelected ??= new Set();
      const id = Number(target.value);
      if (target.checked) selected.add(id); else selected.delete(id);
      render();
    } else if (target.matches('[data-discussion-select-page]')) {
      const state = discussionRecordPage(panel._visibilitySnapshot, panel._discussionQuery);
      const selected = panel._discussionSelected ??= new Set();
      for (const record of state.records) target.checked ? selected.add(record.message_id) : selected.delete(record.message_id);
      render();
    }
  });
  const jump = () => {
    const input = panel.querySelector('[data-discussion-jump-input]');
    const value = input?.valueAsNumber;
    if (!Number.isInteger(value) || value < 0 || value > Number(input.max)) {
      getHost()?.status(`请输入 0—${input?.max ?? 0} 之间的楼层编号`, 'info');
      return;
    }
    const all = panel._visibilitySnapshot?.messages ?? [];
    if (!all.some(message => message.message_id === value && isDiscussionMessage(message))) {
      getHost()?.status('该楼层不是讨论记录', 'info');
      return;
    }
    const filtered = discussionRecordPage(panel._visibilitySnapshot, { ...panel._discussionQuery, page: 0, jump: value });
    if (!filtered.records.some(record => record.message_id === value)) {
      getHost()?.status('当前筛选条件不包含该讨论记录', 'info');
      return;
    }
    panel._discussionQuery = { ...panel._discussionQuery, jump: value };
    render();
    panel.querySelector(`[data-discussion-row="${value}"]`)?.scrollIntoView({ block: 'nearest' });
  };
  panel.addEventListener('click', event => {
    const view = event.target.closest('[data-discussion-view]');
    if (view) {
      viewDiscussionRecord(panel, Number(view.dataset.discussionView)).catch(error => {
        if (error.name !== 'AbortError') getHost()?.status(error.message, 'error');
      });
      return;
    }
    if (event.target.closest('[data-discussion-refresh]')) {
      const token = captureContext();
      refresh(panel).then(() => checkContext(token)).catch(error => {
        if (error.name !== 'AbortError') getHost()?.status(error.message, 'error');
      });
      return;
    }
    if (event.target.closest('[data-discussion-jump]')) return jump();
    const page = event.target.closest('[data-discussion-page]');
    if (page) {
      panel._discussionQuery = { ...panel._discussionQuery, page: (panel._discussionQuery?.page ?? 0) + Number(page.dataset.discussionPage) };
      render();
      return;
    }
    const button = event.target.closest('[data-discussion-mutate]');
    if (!button || isBusy()) return;
    const action = button.dataset.discussionBatch ?? button.dataset.discussionMutate;
    const ids = button.dataset.discussionBatch
      ? [...(panel._discussionSelected ?? [])]
      : [Number(button.dataset.discussionId)];
    if (!ids.length) return;
    const token = captureContext();
    runAction(async () => {
      await changeDiscussionVisibility(panel, ids, action, refresh);
      checkContext(token);
      getHost()?.status(action === 'auto' ? `已让 ${ids.length} 条讨论记录恢复自动规则` : `已${action === 'hide' ? '隐藏' : '显示'} ${ids.length} 条讨论记录`, 'success');
    });
  });
  panel.addEventListener('keydown', event => {
    if (event.key === 'Enter' && event.target.matches('[data-discussion-jump-input]')) {
      event.preventDefault();
      jump();
    }
  });
}
