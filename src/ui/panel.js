/**
 * ui/panel.js
 * 设置面板 UI、HTML 构建、事件绑定
 * 依赖: config.js, utils.js, storage.js, summary.js, worldbook.js,
 *       ui/styles.js, ui/renderer.js, errorHandler.js
 */

let _panelEl = null;

// ---- 辅助渲染函数 ----

const buildRoleSelect = (id, selected) => {
  const roles = ["system", "user", "assistant"];
  const options = roles
    .map(
      (r) =>
        `<option value="${r}" ${r === selected ? "selected" : ""}>${r}</option>`,
    )
    .join("");
  return `<select class="sa-select" id="${id}" style="max-width:140px">${options}</select>`;
};

const getBlockTypeName = (type) => {
  switch (type) {
    case BLOCK_TYPES.PROMPT:
      return "提示词";
    case BLOCK_TYPES.BUILTIN_GROUP:
      return "内置";
    case BLOCK_TYPES.OLD_SUMMARY:
      return "总结";
    case BLOCK_TYPES.CHAT_MESSAGES:
      return "消息";
    default:
      return type;
  }
};

const BUILTIN_BLOCK_IDS = [
  "jailbreak",
  "summary_rules",
  "summary_instruction",
  "mega_jailbreak",
  "mega_summary_rules",
  "mega_summary_instruction",
];

const renderBlock = (block, index, total) => {
  const isPrompt = block.type === BLOCK_TYPES.PROMPT;
  const isBuiltin = block.type === BLOCK_TYPES.BUILTIN_GROUP;
  const isChatMessages = block.type === BLOCK_TYPES.CHAT_MESSAGES;
  const hasRole = !isBuiltin;
  const hasContent = isPrompt;
  const isCustom = isPrompt && !BUILTIN_BLOCK_IDS.includes(block.id);
  const hasLeadText = isChatMessages;
  return `
    <div class="sa-block ${block.enabled ? "" : "sa-block-disabled"}" data-block-id="${escapeHtml(block.id)}" draggable="true">
      <div class="sa-block-header collapsed" data-block-toggle="${escapeHtml(block.id)}">
        <span class="sa-block-drag" title="拖拽排序">⠿</span>
        <label class="sa-block-enable">
          <input type="checkbox" data-block-enable="${escapeHtml(block.id)}" ${block.enabled ? "checked" : ""}>
        </label>
        <span class="sa-block-name">${escapeHtml(block.name)}</span>
        <span class="sa-block-type-badge">${getBlockTypeName(block.type)}</span>
        ${isCustom ? `<button class="sa-block-delete-btn" data-block-delete="${escapeHtml(block.id)}" title="删除板块">✕</button>` : ""}
        <span class="sa-block-chevron">▼</span>
      </div>
      <div class="sa-block-body collapsed" data-block-body="${escapeHtml(block.id)}">
        ${
          hasRole
            ? `
          <div class="sa-block-role-row">
            <span class="sa-block-role-label">Role</span>
            ${buildRoleSelect(`sa-block-role-${block.id}`, block.role || "system")}
          </div>
        `
            : ""
        }
        ${
          hasContent
            ? `
          <textarea class="sa-textarea ${block.content && block.content.length > 200 ? "sa-textarea-tall" : ""}"
            data-block-content="${escapeHtml(block.id)}"
            style="min-height:${block.content && block.content.length > 500 ? "200px" : "80px"}"
          >${escapeHtml(block.content || "")}</textarea>
        `
            : ""
        }
        ${
          hasLeadText
            ? `
          <div class="sa-block-role-row" style="margin-top:6px">
            <span class="sa-block-role-label">引导语</span>
            <input class="sa-input" data-block-lead-text="${escapeHtml(block.id)}" type="text"
              value="${escapeHtml(block.leadText || "")}" placeholder="发送内容前的引导文字">
          </div>
          <div class="sa-hint">运行时自动填充内容。引导语会添加在内容前面。可设置发送时的 role。</div>
        `
            : ""
        }
        ${
          isBuiltin
            ? `
          <div class="sa-hint">包含：world_info_before, persona_description, char_description, char_personality, scenario, world_info_after, dialogue_examples</div>
        `
            : ""
        }
        ${
          block.type === BLOCK_TYPES.OLD_SUMMARY
            ? `
          <div class="sa-hint">运行时自动填充已有总结内容。可设置发送时的 role。</div>
        `
            : ""
        }
      </div>
    </div>
  `;
};

const renderBlocks = (blocks, containerId = "sa-blocks-container") => {
  const resetAction =
    containerId === "sa-mega-blocks-container"
      ? "data-action-reset-mega-blocks"
      : "data-action-reset-blocks";
  const addAction =
    containerId === "sa-mega-blocks-container"
      ? "data-action-add-mega-block"
      : "data-action-add-block";
  return (
    blocks.map((b, i) => renderBlock(b, i, blocks.length)).join("") +
    `<div class="sa-add-block-row">
      <button class="sa-add-block-btn" ${addAction}>＋ 添加自定义提示词板块</button>
      <button class="sa-btn sa-btn-sm sa-btn-danger" ${resetAction}>重置提示词</button>
    </div>`
  );
};

// ---- 面板 HTML 构建 ----

const buildPanelHtml = (settings) => `
<div class="sa-panel">
  <div class="sa-header">
    <span>命定之诗总结助手 ✨ V2.8.2</span>
    <button class="sa-close" id="sa-close">&times;</button>
  </div>
  <div class="sa-tabs">
    <button class="sa-tab-item active" data-tab="status">📊 状态</button>
    <button class="sa-tab-item" data-tab="settings">⚙️ 设置</button>
    <button class="sa-tab-item" data-tab="prompts">📝 提示词</button>
    <button class="sa-tab-item" data-tab="about">ℹ️ 关于</button>
  </div>
  <div class="sa-status-bar" style="padding:10px 16px;border-bottom:1px solid var(--sa-border);background:var(--sa-bg);flex-shrink:0;">
    <div id="sa-status-info" class="sa-status">加载中...</div>
  </div>
  <div class="sa-body">
    <div class="sa-tab-pane active" data-pane="status">
      <div class="sa-section">
        <div class="sa-section-header">
          <span>📚 总结条目列表</span>
          <button class="sa-btn sa-btn-sm sa-btn-primary" id="sa-start-mega-summary" style="margin-left:auto">开始大总结</button>
        </div>
        <div class="sa-section-body">
          <div id="sa-entry-list" class="sa-entry-list"><div class="sa-empty">加载中...</div></div>
        </div>
      </div>
      <div class="sa-section" style="margin-top:16px">
        <div class="sa-section-header"><span>🔷 大总结条目列表</span></div>
        <div class="sa-section-body">
          <div id="sa-mega-entry-list" class="sa-entry-list"><div class="sa-empty">加载中...</div></div>
        </div>
      </div>
    </div>
    <div class="sa-tab-pane" data-pane="settings">
      <div class="sa-settings-layout">
        <div class="sa-settings-nav">
          <a class="sa-settings-nav-item active" data-sub-nav="core"><span>核心总结</span></a>
          <a class="sa-settings-nav-item" data-sub-nav="api"><span>API & 模型</span></a>
          <a class="sa-settings-nav-item" data-sub-nav="worldbook"><span>世界书</span></a>
          <a class="sa-settings-nav-item" data-sub-nav="tags"><span>标签过滤</span></a>
          <a class="sa-settings-nav-item" data-sub-nav="visibility"><span>楼层显隐</span></a>
        </div>
        <div class="sa-settings-content">
          <div class="sa-settings-pane active" data-sub-pane="core">
            <div class="sa-row sa-row-pair">
              <div class="sa-pair-item"><span class="sa-label">触发楼层数</span><input class="sa-input" id="sa-trigger-count" type="number" min="10" max="999" value="${settings.triggerFloorCount}"></div>
              <div class="sa-pair-item"><span class="sa-label">保留楼层数</span><input class="sa-input" id="sa-keep-count" type="number" min="1" max="999" value="${settings.keepFloorCount}"></div>
            </div>
            <div class="sa-hint">每累积"触发楼层数"条未总结消息时触发总结，保留最近"保留楼层数"条不参与总结。</div>
            <div class="sa-checkbox-grid">
              <label><input type="checkbox" id="sa-include-old-summary" ${settings.includeOldSummary ? "checked" : ""}> 发送已有总结</label>
              <label><input type="checkbox" id="sa-auto-confirm" ${settings.autoTriggerConfirm ? "checked" : ""}> 自动触发时确认</label>
              <label><input type="checkbox" id="sa-auto-hide-summarized" ${settings.autoHideSummarizedFloors !== false ? "checked" : ""}> 自动隐藏楼层</label>
              <label class="sa-no-trans-label"><input type="checkbox" id="sa-no-trans-tag" ${settings.noTransTag !== false ? "checked" : ""}> 防合并标记(kemini或noass脚本开)<input class="sa-input sa-no-trans-input" id="sa-no-trans-tag-value" type="text" placeholder="<|no-trans|>" value="${escapeHtml(settings.noTransTagValue || "<|no-trans|>")}" title="自定义防合并标记"></label>
            </div>
            <div class="sa-row" style="margin-top:12px"><span class="sa-label">用户前缀</span><input class="sa-input" id="sa-user-prefix" type="text" placeholder="{{user}}" value="${escapeHtml(settings.userPrefix || "{{user}}")}"></div>
            <div class="sa-row"><span class="sa-label">AI前缀</span><input class="sa-input" id="sa-assistant-prefix" type="text" placeholder="{{char}}" value="${escapeHtml(settings.assistantPrefix || "{{char}}")}"></div>
            <div class="sa-hint">每条消息前的发言者标识。支持酒馆宏 {{user}}、{{char}}。</div>
          </div>
          <div class="sa-settings-pane" data-sub-pane="api">
            <div class="sa-row"><span class="sa-label">API 模式</span>
              <div class="sa-radio-group">
                <label><input type="radio" name="sa-api-mode" value="tavern" ${settings.apiMode === "tavern" ? "checked" : ""}> 酒馆主API</label>
                <label><input type="radio" name="sa-api-mode" value="custom" ${settings.apiMode === "custom" ? "checked" : ""}> 自定义API</label>
              </div>
            </div>
            <div id="sa-custom-api-fields" style="${settings.apiMode === "custom" ? "" : "display:none"}">
              <div class="sa-row"><span class="sa-label">API 地址</span><input class="sa-input" id="sa-api-url" type="text" placeholder="https://api.example.com/v1" value="${escapeHtml(settings.customApiUrl)}"></div>
              <div class="sa-row"><span class="sa-label">API 密钥</span><input class="sa-input" id="sa-api-key" type="password" placeholder="sk-..." value="${escapeHtml(settings.customApiKey)}"></div>
              <div class="sa-row"><span class="sa-label">模型</span><select class="sa-select" id="sa-api-model" style="flex:1">${settings.customApiModel ? `<option value="${escapeHtml(settings.customApiModel)}" selected>${escapeHtml(settings.customApiModel)}</option>` : '<option value="">请先获取模型列表</option>'}</select><button class="sa-btn sa-btn-sm" id="sa-fetch-models">获取列表</button></div>
            </div>
            <div class="sa-row sa-row-pair" style="margin-top:12px">
              <div class="sa-pair-item"><span class="sa-label">温度</span><input class="sa-input" id="sa-temperature" type="text" placeholder="same_as_preset" value="${settings.temperature}"></div>
              <div class="sa-pair-item"><span class="sa-label">最大Tokens</span><input class="sa-input" id="sa-max-tokens" type="text" placeholder="same_as_preset" value="${settings.maxTokens}"></div>
            </div>
          </div>
          <div class="sa-settings-pane" data-sub-pane="worldbook">
            <div class="sa-row"><span class="sa-label">绑定状态</span><span class="sa-status-value" id="sa-wb-bind-status">${isChatWorldbookBound() ? `✅ 已绑定: ${escapeHtml(getActiveWorldbookName())}` : "❌ 未绑定"}</span></div>
            <div class="sa-hint">总结条目将写入绑定的世界书。</div>
            <div class="sa-row" style="margin-top:12px"><span class="sa-label">选择已有</span><select class="sa-select" id="sa-wb-select" style="flex:1"><option value="">-- 加载中 --</option></select></div>
            <div class="sa-row"><span class="sa-label">或新建</span><input class="sa-input" id="sa-new-wb-name" type="text" placeholder="输入新的世界书名称（留空则自动生成）"></div>
            <div class="sa-btn-group" style="margin-top:8px">
              <button class="sa-btn sa-btn-sm sa-btn-primary" id="sa-bind-worldbook">绑定世界书</button>
              <button class="sa-btn sa-btn-sm" id="sa-switch-worldbook" ${!isChatWorldbookBound() ? "disabled" : ""}>迁移</button>
              <button class="sa-btn sa-btn-sm sa-btn-danger" id="sa-unbind-worldbook" ${!isChatWorldbookBound() ? "disabled" : ""}>解绑</button>
            </div>
          </div>
           <div class="sa-settings-pane" data-sub-pane="tags">
            <div class="sa-row"><span class="sa-label">提取标签</span><input class="sa-input" id="sa-include-tags" type="text" placeholder="tp, gametxt" value="${escapeHtml(tagsToString(settings.includeTags))}"></div>
            <div class="sa-hint">只提取这些标签内的内容发给AI。多个标签用逗号分隔。留空则发送完整消息。</div>
            <div class="sa-row" style="margin-top:12px"><span class="sa-label">排除标签</span><input class="sa-input" id="sa-exclude-tags" type="text" placeholder="think, hidden" value="${escapeHtml(tagsToString(settings.excludeTags))}"></div>
            <div class="sa-hint">排除这些标签内的内容。在提取之前执行。</div>
            <div class="sa-row" style="margin-top:12px">
              <label><input type="checkbox" id="sa-exclude-html-comments" ${settings.excludeHtmlComments !== false ? "checked" : ""}> 隐藏HTML注释 (&lt;!-- ... --&gt;)</label>
            </div>
            <div class="sa-hint">隐藏消息中被 &lt;!-- 和 --&gt; 包裹的内容。</div>
          </div>
          <div class="sa-settings-pane" data-sub-pane="visibility">
            <div class="sa-row sa-row-pair">
              <div class="sa-pair-item"><span class="sa-label">起始楼层</span><input class="sa-input" id="sa-vis-from" type="number" min="0" placeholder="0" value="0"></div>
              <div class="sa-pair-item"><span class="sa-label">结束楼层</span><input class="sa-input" id="sa-vis-to" type="number" min="0" placeholder="0" value=""></div>
            </div>
            <div class="sa-btn-group" style="margin-top:8px">
              <button class="sa-btn sa-btn-sm" id="sa-vis-hide-range">隐藏范围</button>
              <button class="sa-btn sa-btn-sm" id="sa-vis-show-range">显示范围</button>
            </div>
            <div class="sa-btn-group" style="margin-top:10px">
              <button class="sa-btn sa-btn-sm sa-btn-primary" id="sa-vis-hide-summarized">一键隐藏已总结</button>
              <button class="sa-btn sa-btn-sm" id="sa-vis-show-all">一键显示全部</button>
            </div>
          </div>
        </div>
      </div>
    </div>
    <div class="sa-tab-pane" data-pane="prompts">
      <div class="sa-section">
        <div class="sa-section-header"><span>📝 总结提示词板块（可排序）</span></div>
        <div class="sa-section-body">
            <div class="sa-hint" style="margin-bottom:10px">拖拽板块调整顺序。板块按从上到下的顺序发送给AI。</div>
            <div id="sa-blocks-container" class="sa-blocks-container">${renderBlocks(settings.promptBlocks || [], "sa-blocks-container")}</div>
        </div>
      </div>
      <div class="sa-section" style="margin-top:16px">
        <div class="sa-section-header"><span>🔷 大总结提示词板块（可排序）</span></div>
        <div class="sa-section-body">
            <div class="sa-hint" style="margin-bottom:10px">拖拽板块调整顺序。大总结时按从上到下的顺序发送给AI。</div>
            <div id="sa-mega-blocks-container" class="sa-blocks-container">${renderBlocks(settings.megaPromptBlocks || [], "sa-mega-blocks-container")}</div>
        </div>
      </div>
    </div>
    <div class="sa-tab-pane" data-pane="about">
        <div class="sa-about-content">
            <h3>命定之诗总结助手</h3>
            <p>版本: 2.8.2</p>
            <p>作者: Rhys_z_瑞</p>
            <br>
            <p>命定之诗角色卡专用，用于其它卡不保证效果</p>
        </div>
    </div>
  </div>
  <div class="sa-footer">
    <div class="sa-footer-left"><button class="sa-btn sa-btn-danger" id="sa-reset">重置所有设置</button></div>
    <div class="sa-footer-right">
      <button class="sa-btn" id="sa-start-custom-summary">指定楼层总结</button>
      <button class="sa-btn sa-btn-primary" id="sa-start-summary">手动开始总结</button>
    </div>
  </div>
</div>
`;
