import { SETTING_LISTS, validateSettingItems, legacySettingItems, settingTextError, readSettingTemplate } from './setting-items.js';

export function createSettingLists(ctx) {
  const drafts = new Map();
  const undo = new Map();
  let contextKey = '';
  let composing = false;
  let contextEpoch = 0;
  const currentKey = () => {
    const context = ctx.getContext();
    return JSON.stringify([getLoadedPresetName(), context?.characterId, context?.groupId, context?.chatId]);
  };

  function clearSettingDrafts() {
    drafts.clear();
    undo.clear();
    composing = false;
    contextEpoch += 1;
    contextKey = currentKey();
  }

  function syncSettingContext() {
    const key = currentKey();
    if (contextKey && contextKey !== key) {
      // Uncommitted list changes belong to the previous editing context.
      for (const name of drafts.keys()) {
        if (Object.hasOwn(ctx.savedScriptConfig.managed_values, name)) ctx.state.config.managed_values[name] = ctx.clone(ctx.savedScriptConfig.managed_values[name]);
        else delete ctx.state.config.managed_values[name];
      }
      clearSettingDrafts();
    }
    contextKey = key;
    return key;
  }

  function getSettingItems(key) {
    syncSettingContext();
    const draft = drafts.get(key);
    if (draft) return ctx.clone(draft.items);
    return ctx.sanitizeManagedValues(ctx.state.config.managed_values, ctx.state.preset)[key] ?? [];
  }

  function hasSettingDraftErrors() {
    syncSettingContext();
    return [...drafts.values()].some(draft => draft.error || draft.composing);
  }

  function isSettingComposing() {
    syncSettingContext();
    return composing;
  }

  function setSettingItems(key, items, debounce = true) {
    const origin = syncSettingContext();
    const epoch = contextEpoch;
    const definition = SETTING_LISTS[key];
    if (!definition) return Promise.reject(new Error('未知的设定列表。'));
    const template = readSettingTemplate(ctx.state.preset, key);
    if (!template.ok || !template.managed) return Promise.reject(new Error(template.error || '设定列表尚未完成迁移，请稍候或重新打开助手。'));
    if (ctx.state.config.configuration_error) return Promise.reject(new Error(ctx.state.config.configuration_error));
    const next = validateSettingItems(items);
    const error = next.map(item => settingTextError(item.text, key)).find(Boolean) ?? '';
    const draft = { items: next, error, composing: false };
    drafts.set(key, draft);
    if (error) return Promise.reject(new Error(error));
    ctx.state.config.managed_values[key] = ctx.clone(next);
    const task = ctx.enqueueScriptConfigSave(definition.label, `setting-list:${key}`, () => !ctx.destroyed && currentKey() === origin && contextEpoch === epoch, () => {
      // A preceding failed save may have rolled back the shared config. Restore
      // this operation's valid data just before committing, using newer edits if present.
      const latest = drafts.get(key);
      ctx.state.config.managed_values[key] = ctx.clone(latest && !latest.error && !latest.composing ? latest.items : next);
    });
    if (!debounce) ctx.debounceTimers.get(`config:setting-list:${key}`)?.flush();
    return task.then(result => {
      if (!result?.superseded && currentKey() === origin && drafts.get(key) === draft) drafts.delete(key);
      return result;
    }).catch(error => {
      if (currentKey() === origin && drafts.get(key) === draft) {
        draft.error = `保存失败：${error.message}`;
        updateListError(key, draft.error);
      }
      throw error;
    });
  }

  function updateListError(key, message) {
    const error = [...(ctx.shadow?.querySelectorAll('[data-setting-error]') ?? [])].find(node => node.dataset.settingError === key);
    if (error) error.textContent = message;
  }

  function resizeSettingInput(input) {
    input.style.height = 'auto';
    input.style.height = `${Math.max(66, input.scrollHeight)}px`;
  }

  function resizeSettingInputs() {
    for (const input of ctx.shadow?.querySelectorAll('[data-action="setting-text"]') ?? []) resizeSettingInput(input);
  }

  function renderSettingList(key) {
    const definition = SETTING_LISTS[key];
    const template = readSettingTemplate(ctx.state.preset, key);
    const available = template.ok && template.managed && !ctx.state.config.configuration_error;
    const items = getSettingItems(key);
    const escape = ctx.escapeHtml;
    const action = (name, label, id = '', disabled = false) => `<button type="button" class="text-button" data-action="setting-${name}" data-key="${key}" data-id="${escape(id)}" ${disabled || !available ? 'disabled' : ''}>${label}</button>`;
    const rows = items.map((item, index) => `<div class="setting-row${item.enabled ? '' : ' setting-row-muted'}" data-setting-id="${escape(item.id)}">
      <textarea rows="2" aria-label="${definition.label}第${index + 1}条" data-action="setting-text" data-key="${key}" data-id="${escape(item.id)}" placeholder="写下一两句话…" ${available ? '' : 'disabled'}>${escape(item.text)}</textarea>
      <div class="setting-row-actions"><label class="setting-enabled"><input type="checkbox" aria-label="启用${definition.label}第${index + 1}条" data-action="setting-enabled" data-key="${key}" data-id="${escape(item.id)}" ${item.enabled ? 'checked' : ''} ${available ? '' : 'disabled'}>启用</label>
      ${action('up', '上移', item.id, index === 0)}${action('down', '下移', item.id, index === items.length - 1)}${action('delete', '删除', item.id)}</div></div>`).join('');
    const message = drafts.get(key)?.error || (available ? '' : template.error || ctx.state.config.configuration_error || '设定列表尚未完成迁移。');
    const hint = key === 'global_settings' ? '填写希望持续生效的设定，可覆盖其它世界设定与角色设定。' : '补充对用户角色的描述要求。';
    return `<div class="setting-list" data-setting-list="${key}"><p class="setting-hint">${hint}</p>${rows || '<p class="setting-empty">暂无设定，点击下方添加。</p>'}<div class="setting-list-actions">${action('add', '＋ 添加')}${undo.has(key) ? action('undo', '撤销删除') : ''}${key === 'user_additional_settings' ? action('reset', '恢复默认') : ''}</div><div class="field-error" data-setting-error="${key}" role="status">${escape(message)}</div></div>`;
  }

  function renderList(key, focusId = '') {
    const current = [...(ctx.shadow?.querySelectorAll('[data-setting-list]') ?? [])].find(node => node.dataset.settingList === key);
    if (!current) return;
    const content = ctx.shadow.querySelector('.content');
    const scroll = content?.scrollTop;
    current.outerHTML = renderSettingList(key);
    resizeSettingInputs();
    if (content && scroll !== undefined) content.scrollTop = scroll;
    if (focusId) [...ctx.shadow.querySelectorAll('[data-action="setting-text"]')].find(node => node.dataset.key === key && node.dataset.id === focusId)?.focus({ preventScroll: true });
  }

  function handleSettingAction(action, target) {
    const key = target.dataset.key;
    const items = getSettingItems(key);
    const index = items.findIndex(item => item.id === target.dataset.id);
    let focusId = '';
    if (action === 'setting-add') {
      focusId = ctx.createPromptId();
      items.push({ id: focusId, text: '', enabled: true });
    } else if (action === 'setting-reset') {
      undo.delete(key);
      items.splice(0, items.length, ...legacySettingItems(ctx.USER_ADDITIONAL_DEFAULT, 'additional-default'));
    } else if (action === 'setting-undo') {
      const removed = undo.get(key);
      if (!removed) return;
      items.splice(Math.min(removed.index, items.length), 0, removed.item);
      focusId = removed.item.id;
      undo.delete(key);
    } else if (index >= 0) {
      if (action === 'setting-delete') {
        undo.set(key, { index, item: items[index] });
        items.splice(index, 1);
        focusId = items[Math.min(index, items.length - 1)]?.id;
      } else if (action === 'setting-enabled') items[index].enabled = target.checked;
      else if (action === 'setting-up' || action === 'setting-down') {
        const next = index + (action === 'setting-up' ? -1 : 1);
        if (next < 0 || next >= items.length) return;
        [items[index], items[next]] = [items[next], items[index]];
        focusId = items[next].id;
      } else return;
    } else return;
    const task = setSettingItems(key, items, false);
    renderList(key, focusId);
    return task.catch(ctx.showErrorToast);
  }

  function handleSettingInput(target, isComposing = false) {
    const key = target.dataset.key;
    const items = getSettingItems(key);
    const item = items.find(item => item.id === target.dataset.id);
    if (!item) return;
    item.text = target.value;
    resizeSettingInput(target);
    if (isComposing) {
      drafts.set(key, { items, error: '', composing: true });
      return;
    }
    const error = settingTextError(item.text, key);
    updateListError(key, error);
    return setSettingItems(key, items).catch(failure => {
      if (!error) ctx.showErrorToast(failure);
    });
  }

  function handleSettingComposition(event) {
    if (event.target.dataset?.action !== 'setting-text') return;
    composing = event.type === 'compositionstart';
    if (!composing) handleSettingInput(event.target);
  }

  return { getSettingItems, setSettingItems, clearSettingDrafts, syncSettingContext, hasSettingDraftErrors, isSettingComposing, renderSettingList, resizeSettingInputs, handleSettingAction, handleSettingInput, handleSettingComposition };
}
