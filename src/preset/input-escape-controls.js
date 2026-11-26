import { INPUT_ESCAPE_MODES, INPUT_ESCAPE_LABELS } from './input-escape.js';

const MODE_DESCRIPTIONS = Object.freeze({
  light: '在敏感区段的相邻汉字间插入可见间隔点（·）打散词组，避免被外审分类器剥离还原，同时保留全部 XML 标签、英文变量与数字；无解码壳，额外 token 较少。',
  heavy: '将敏感区段与 <VOID_info> 内的汉字转为 XML 十六进制码点（&#xXXXX;），不留中文明文并保留 XML 标签、英文变量与数字；无需看图接口，但会明显增加输入 token，部分模型也可能对长段编码更敏感。',
  image: '将世界书、总结记忆、历史对话、用户输入与文风／NSFW 渲染为高清分页图片发送，运行时变量区改用可见间隔点分隔以防看错字段；需所选接口支持看图。',
});

/** Presentation only; state persistence and fetch transformation live in input-escape.js. */
export function createInputEscapeControls(ctx) {
  function renderGeminiReasoningControl() {
    const value = ctx.readGeminiReasoningControl();
    const disabled = !value.supported || ctx.state.workspaceBusy ? 'disabled' : '';
    return `<article class="card input-escape-controls" data-gemini-reasoning-controls aria-label="Gemini 推理强度">
      <div class="card-title">
        <div>
          <h4>Gemini 随请求发送低推理强度（low）</h4>
          <p>仅在 Gemini 适配时生效，默认开启。随剧情与讨论请求附带 <code>reasoning_effort: low</code>，可配合预设稳定压制原生思考；关闭后改为跟随酒馆当前设置（后台总结不受影响）。</p>
        </div>
        <label class="switch" title="${value.enabled ? '关闭' : '开启'}">
          <input type="checkbox" role="switch" aria-label="Gemini 随请求发送低推理强度" data-action="gemini-low-reasoning" ${value.enabled ? 'checked' : ''} ${disabled}>
          <span></span>
        </label>
      </div>
      ${value.supported ? '' : '<p class="warning">仅在 Gemini 适配时生效；请先切换到 Gemini 适配。</p>'}
      <p class="field-error" data-gemini-reasoning-error role="status">${ctx.escapeHtml(value.error)}</p>
    </article>`;
  }

  function renderInputEscapeControls() {
    const value = ctx.readInputEscapeControl();
    const disabled = !value.supported || ctx.state.workspaceBusy ? 'disabled' : '';
    const capDisabled = !value.supported || ctx.state.workspaceBusy || value.mode !== 'image' ? 'disabled' : '';
    const modeHelp = MODE_DESCRIPTIONS[value.mode] ?? '';
    return `<article class="card input-escape-controls" data-input-escape-controls aria-label="Gemini 输入转义">
      <div class="card-title">
        <div>
          <h4>Gemini 输入转义</h4>
          <p>仅在 Gemini 适配时生效；撞外审、502 或严重拒答时按需开启。仅转义设定、历史、用户输入与文风／NSFW 区段，保留头部、输出协议与尾部明文；剧情与讨论模式均生效，后台总结不转义，不改动本地聊天记录。</p>
        </div>
        <label class="switch" title="${value.enabled ? '关闭' : '开启'}">
          <input type="checkbox" role="switch" aria-label="Gemini 输入转义" data-action="input-escape-enabled" ${value.enabled ? 'checked' : ''} ${disabled}>
          <span></span>
        </label>
      </div>
      ${value.supported ? '' : '<p class="warning">仅在 Gemini 适配时生效；请先切换到 Gemini 适配。</p>'}
      <div class="input-escape-mode-controls">
        <div class="segmented" aria-label="转义强度">
          ${INPUT_ESCAPE_MODES.map(mode => `<button type="button" data-action="input-escape-mode" data-value="${mode}" class="${value.mode === mode ? 'selected' : ''}" aria-pressed="${value.mode === mode}" ${disabled}>${INPUT_ESCAPE_LABELS[mode]}</button>`).join('')}
        </div>
        <span class="input-escape-mode-help">${ctx.escapeHtml(modeHelp)}</span>
      </div>
      <div class="input-escape-option-row">
        <label class="input-escape-checkbox">
          <input type="checkbox" data-action="input-escape-max-three" aria-label="图片最多三张" ${value.maxThreeImages ? 'checked' : ''} ${capDisabled}>
          <span>限制图片最多 3 张</span>
        </label>
        <span class="input-escape-mode-help">${value.mode === 'image' ? '适配最多支持 3 张图的渠道；默认关闭，开启后自动调整排版压缩至 3 张以内。' : '切换到「图片转义」后可启用此项。'}</span>
      </div>
      <p class="field-error" data-input-escape-error role="status">${ctx.escapeHtml(value.error)}</p>
    </article>`;
  }

  return { renderGeminiReasoningControl, renderInputEscapeControls };
}
