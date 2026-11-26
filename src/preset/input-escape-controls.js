import { INPUT_ESCAPE_MODES, INPUT_ESCAPE_LABELS, INPUT_ESCAPE_SECTIONS } from './input-escape.js';

const MODE_DESCRIPTIONS = Object.freeze({
  light: '在所选板块的相邻汉字间插入可见间隔点（·）打散词组，并附去点输出提醒，保留 XML 标签、英文变量与数字；额外 token 较少。',
  heavy: '将所选板块内的汉字转为 XML 十六进制码点（&#xXXXX;），不留中文明文并保留 XML 标签、英文变量与数字；无需看图接口，但会明显增加输入 token。',
  image: '将所选叙事板块渲染为高清分页图片发送，未勾选板块保持明文（若勾选深度 0～2 则自动改用间隔点以防看错数值）；需所选接口支持看图。',
});

const SECTION_META = Object.freeze({
  history: {
    label: '历史记录与用户输入',
    hint: '上下文对话历史与本轮用户输入（默认开启）',
  },
  world: {
    label: '角色卡与基础世界书',
    hint: '角色设定、用户人设与角色定义前／后世界书',
  },
  writing: {
    label: '文风与 NSFW 板块',
    hint: '基调、主文风与 NSFW 露骨描写规则',
  },
  memory: {
    label: '总结记忆（深度 >900）',
    hint: '深度 900 以上世界书，如普通总结与大总结',
  },
  reference: {
    label: '参考规则（深度 3～900）',
    hint: '深度 3～900 世界书，多为系统、战斗与面板规则（默认关闭）',
  },
  runtime: {
    label: '变量与即时规则（深度 0～2）',
    hint: '深度 0～2 世界书，多为 MVU 变量状态与更新规则（默认关闭；图片模式改用间隔点）',
  },
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
    const selectedCount = INPUT_ESCAPE_SECTIONS.filter(key => value.sections?.[key]).length;
    return `<article class="card input-escape-controls" data-input-escape-controls aria-label="Gemini 输入转义">
      <div class="card-title">
        <div>
          <h4>Gemini 输入转义</h4>
          <p>仅在 Gemini 适配时生效，平时不用开；遇到 <code>PROHIBITED_CONTENT</code> 报错或固定道歉这类输入外审拦截时再临时开启，通过后即可关闭。剧情与讨论模式均生效，后台总结不转义，不改动本地聊天记录。</p>
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
      <div class="input-escape-sections" role="group" aria-label="转义范围">
        <div class="input-escape-sections-head">
          <span>转义范围</span>
          <small>先判断大致是哪个板块触发了外审，只勾选对应板块即可，不必全勾；未勾选部分保持明文</small>
        </div>
        <div class="input-escape-section-grid">
          ${INPUT_ESCAPE_SECTIONS.map(key => {
            const meta = SECTION_META[key];
            const checked = value.sections?.[key] === true;
            const lastSelected = checked && selectedCount <= 1;
            const boxDisabled = disabled || lastSelected ? 'disabled' : '';
            const title = lastSelected ? '至少保留一个转义板块；无需转义请关闭上方开关' : meta.hint;
            return `<label class="input-escape-section-item" title="${ctx.escapeHtml(title)}">
              <input type="checkbox" data-action="input-escape-section" data-section="${key}" aria-label="${ctx.escapeHtml(meta.label)}" ${checked ? 'checked' : ''} ${boxDisabled}>
              <span><strong>${ctx.escapeHtml(meta.label)}</strong><small>${ctx.escapeHtml(meta.hint)}</small></span>
            </label>`;
          }).join('')}
        </div>
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
