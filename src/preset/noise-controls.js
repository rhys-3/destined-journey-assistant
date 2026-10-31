/** Presentation only; preparation, persistence and context guards live in the host. */
export function createNoiseControls(ctx) {
  function renderNoiseControls() {
    const value = ctx.readNoiseControl();
    const disabled = !value.supported || ctx.state.workspaceBusy ? 'disabled' : '';
    const previewOpen = ctx.state.disclosures.has('noise-preview');
    return `<section class="card noise-controls" data-noise-controls aria-label="输入噪声">
      <div class="card-title"><div><h4>输入噪声</h4><p>放在模型头部正文前（同角色），扰动输入以减轻重复标记影响，效果需实测；段数越多越耗输入，也可能分散注意力。</p></div><label class="switch" title="${value.enabled ? '关闭' : '开启'}"><input type="checkbox" role="switch" aria-label="输入噪声" data-action="noise-enabled" ${value.enabled ? 'checked' : ''} ${disabled}><span></span></label></div>
      ${value.supported ? '' : '<p class="warning">请启用一个带有配套噪声宏的模型头部。</p>'}
      <div class="noise-token-controls"><label class="noise-token-label" for="noise-segment-range">段数</label><input id="noise-segment-range" type="range" min="10" max="48" step="1" value="${value.segments}" data-action="noise-segments" aria-label="噪声段数滑条" aria-valuetext="${value.segments} 段 · 约 ${value.estimatedTokens} tokens" ${disabled}><input type="number" min="10" max="48" step="1" value="${value.segments}" data-action="noise-segment-number" aria-label="噪声段数" ${disabled}><output data-noise-segment-value title="按预制段数估算，实际用量略有浮动">约 ${value.estimatedTokens} tokens</output></div>
      <div class="noise-mode-controls"><div class="segmented" aria-label="噪声模式">${[['fixed', '固定'], ['random', '每次随机']].map(([mode, title]) => `<button type="button" data-action="noise-mode" data-value="${mode}" class="${value.mode === mode ? 'selected' : ''}" aria-pressed="${value.mode === mode}" ${disabled}>${title}</button>`).join('')}</div><button type="button" class="secondary-button" data-action="noise-regenerate" ${disabled || value.mode !== 'fixed' ? 'disabled' : ''}>换一份</button><span class="noise-mode-help">${value.mode === 'fixed' ? '重复使用同一份，“换一份”更新内容' : '每次生成时重新准备，预览仅作示例'}</span></div>
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
  root.querySelector('[data-noise-segment-value]').textContent = `约 ${preview.estimatedTokens} tokens`;
  root.querySelector('[data-noise-preview-text]').textContent = preview.text;
  return value;
}
