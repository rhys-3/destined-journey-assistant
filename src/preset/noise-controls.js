import { promptDescription } from './descriptions.js';

/** Presentation only; preparation, persistence and context guards live in the host. */
export function createNoiseControls(ctx) {
  function renderNoiseControls() {
    const value = ctx.readNoiseControl();
    const cache = ctx.getPrompt(ctx.state.preset, ctx.IDS.resetCache);
    const cacheDescription = cache ? promptDescription(cache) : '';
    const disabled = !value.supported || ctx.state.workspaceBusy ? 'disabled' : '';
    const previewOpen = ctx.state.disclosures.has('noise-preview');
    const cacheControl = cache ? `<div class="noise-cache-row"><div><strong>重置命中缓存</strong>${cacheDescription ? `<p>${ctx.escapeHtml(cacheDescription)}</p>` : ''}</div><div class="placed-actions">${ctx.toggleHtml('prompt:' + cache.id, cache.enabled)}${ctx.state.editorUnlocked ? `<button type="button" class="text-button" data-action="entry-edit" data-id="${ctx.escapeHtml(cache.id)}">编辑</button>` : ''}</div></div>` : '';
    return `<section class="card noise-controls" data-noise-controls aria-label="缓存与输入噪声">
      <div class="card-title"><h4>缓存与输入噪声</h4></div>
      ${cacheControl}
      <div class="noise-heading"><div><strong>输入噪声</strong><p>扰动输入，尝试减少标记影响。增加数量可能增强干扰，也可能分散注意力并增加输入消耗。</p></div><label class="switch" title="${value.enabled ? '关闭' : '开启'}"><input type="checkbox" role="switch" aria-label="输入噪声" data-action="noise-enabled" ${value.enabled ? 'checked' : ''} ${disabled}><span></span></label></div>
      ${value.supported ? '' : '<p class="warning">需要带有配套输出协议的预设，才能启用输入噪声。</p>'}
      <div class="noise-token-controls"><label class="noise-token-label" for="noise-segment-range">噪声段数</label><output data-noise-segment-value>${value.segments} 段 · 约 ${value.estimatedTokens} tokens</output><input id="noise-segment-range" type="range" min="10" max="48" step="1" value="${value.segments}" data-action="noise-segments" aria-label="噪声段数滑条" aria-valuetext="${value.segments} 段 · 约 ${value.estimatedTokens} tokens" ${disabled}><label class="noise-number-label">直接输入<input type="number" min="10" max="48" step="1" value="${value.segments}" data-action="noise-segment-number" aria-label="噪声段数" ${disabled}></label></div>
      <p class="noise-count">按预制段数估算，实际用量略有浮动。</p>
      <div class="noise-mode-controls"><div class="segmented" aria-label="噪声模式">${[['fixed', '固定'], ['random', '每次随机']].map(([mode, title]) => `<button type="button" data-action="noise-mode" data-value="${mode}" class="${value.mode === mode ? 'selected' : ''}" aria-pressed="${value.mode === mode}" ${disabled}>${title}</button>`).join('')}</div><button type="button" class="secondary-button" data-action="noise-regenerate" ${disabled || value.mode !== 'fixed' ? 'disabled' : ''}>换一份</button></div>
      <p class="noise-mode-help">${value.mode === 'fixed' ? '固定模式重复使用同一份噪声；“换一份”会更新内容。' : '每次实际生成时重新准备噪声；下方仅供预览。'}</p>
      <p class="field-error" data-noise-error role="status">${ctx.escapeHtml(value.error)}</p>
      <details class="noise-preview" data-disclosure="noise-preview" ${previewOpen ? 'open' : ''}><summary>噪声预览</summary><pre data-noise-preview-text>${ctx.escapeHtml(value.text || '尚无已准备的噪声。')}</pre></details>
    </section>`;
  }
  return { renderNoiseControls };
}

export function updateNoiseSegmentDraft(target, ctx) {
  const root = target.closest('[data-noise-controls]');
  if (!root) return;
  const value = Number(target.value);
  const valid = Number.isInteger(value) && value >= 10 && value <= 48;
  const error = root.querySelector('[data-noise-error]');
  if (!valid) {
    error.textContent = '请输入 10～48 之间的整数段数。';
    return;
  }
  error.textContent = '';
  for (const input of root.querySelectorAll('[data-action="noise-segments"], [data-action="noise-segment-number"]')) {
    if (input !== target) input.value = String(value);
    input.setAttribute('aria-valuetext', `${input.value} 段 · 约 ${Number(input.value) * 250} tokens`);
  }
  const preview = ctx.previewNoiseSegments(value);
  root.querySelector('[data-noise-segment-value]').textContent = `${value} 段 · 约 ${preview.estimatedTokens} tokens`;
  root.querySelector('[data-noise-preview-text]').textContent = preview.text;
  return value;
}
