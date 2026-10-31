import { BODY_POOL_GROUPS, BODY_POOL_MAX_WEIGHT, bodyPoolShares, defaultBodyPool, normalizeBodyPool, setBodyPoolWeight } from './body-pool.js';

/** Weight sliders for the 体型随机 entry. Saving goes through the shared script config queue. */
export function createBodyPoolControls(ctx) {
  let error = '';
  const pool = () => normalizeBodyPool(ctx.state.config.managed_values?.body_pool);
  const supported = () => {
    const content = String(ctx.getPrompt(ctx.state.preset, ctx.IDS.bodyPool)?.content ?? '');
    return [ctx.MANAGED_MACROS.femaleBodyPool, ctx.MANAGED_MACROS.maleBodyPool].every(token => content.includes(token));
  };

  function renderBodyPoolControls() {
    const value = pool(), ok = supported();
    const disabled = !ok || ctx.state.workspaceBusy ? 'disabled' : '';
    const esc = ctx.escapeHtml;
    const groups = BODY_POOL_GROUPS.map(group => {
      const shares = bodyPoolShares(value[group.key]);
      const options = group.options.map(([name]) => {
        const weight = value[group.key][name];
        return `<label class="body-pool-option"><span>${esc(name)}</span><input type="range" min="0" max="${BODY_POOL_MAX_WEIGHT}" step="1" value="${weight}" data-action="body-pool-weight" data-group="${group.key}" data-option="${esc(name)}" aria-label="${esc(group.label)}：${esc(name)}" aria-valuetext="权重 ${weight}，约 ${shares[name]}%" ${disabled}><output data-body-pool-share>${shares[name]}%</output></label>`;
      }).join('');
      return `<fieldset class="body-pool-group" data-body-pool-group="${group.key}"><legend>${esc(group.label)}</legend><div class="body-pool-options">${options}</div></fieldset>`;
    }).join('');
    return `<details class="body-pool" data-body-pool data-disclosure="body-pool" ${ctx.state.disclosures.has('body-pool') ? 'open' : ''}><summary>调整体型比例</summary>`
      + (ok ? '' : '<p class="warning">条目缺少体型池短宏，无法调整。</p>')
      + `<div class="body-pool-groups">${groups}</div>`
      + `<div class="body-pool-footer"><p>数值为相对权重，0 表示不会抽到；每次生成重新抽取。</p><button type="button" class="secondary-button" data-action="body-pool-reset" ${disabled}>恢复默认</button></div>`
      + `<p class="field-error" data-body-pool-error role="status">${esc(error)}</p></details>`;
  }

  function fail(failure) {
    error = failure.message ?? String(failure);
    ctx.renderActiveContent?.(true);
    return Promise.reject(failure);
  }

  function commit(next, key) {
    if (ctx.state.workspaceBusy) return fail(new Error('上一项设置尚未保存，请稍候。'));
    if (!supported()) return fail(new Error('体型随机条目缺少体型池短宏。'));
    error = '';
    ctx.state.config.managed_values.body_pool = next;
    return ctx.enqueueScriptConfigSave('体型比例', key);
  }

  function setBodyPoolOption(groupKey, option, weight) {
    let next;
    try { next = setBodyPoolWeight(pool(), groupKey, option, weight); }
    catch (failure) { return fail(failure); }
    return commit(next, `body-pool:${groupKey}`);
  }

  function resetBodyPool() {
    return commit(defaultBodyPool(), 'body-pool').then(result => {
      ctx.renderActiveContent?.(true);
      return result;
    });
  }

  return { renderBodyPoolControls, setBodyPoolOption, resetBodyPool };
}

// Dragging only refreshes the group's shares; the change event saves.
export function updateBodyPoolDraft(target) {
  const group = target.closest('[data-body-pool-group]');
  if (!group) return;
  const sliders = [...group.querySelectorAll('[data-action="body-pool-weight"]')];
  const shares = bodyPoolShares(Object.fromEntries(sliders.map(slider => [slider.dataset.option, Number(slider.value)])));
  for (const slider of sliders) {
    const share = shares[slider.dataset.option];
    slider.setAttribute('aria-valuetext', `权重 ${slider.value}，约 ${share}%`);
    const output = slider.parentElement.querySelector('[data-body-pool-share]');
    if (output) output.textContent = `${share}%`;
  }
}
