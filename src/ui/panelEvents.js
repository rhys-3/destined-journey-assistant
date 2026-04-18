/**
 * ui/panelEvents.js
 * 面板事件绑定与交互逻辑
 * 依赖: config.js, utils.js, storage.js, summary.js, worldbook.js, api.js,
 *       ui/panel.js, ui/renderer.js, errorHandler.js
 */

// ---- 显示设置面板 ----

const showSettingsPopup = errorCatched(async () => {
  const doc = window.top?.document || document;
  const win = window.top || window;
  if (_panelEl) {
    _panelEl.remove();
    _panelEl = null;
  }
  await loadSettings();
  const settings = getSettings();
  const overlay = doc.createElement("div");
  overlay.className = "sa-overlay";
  overlay.innerHTML = PANEL_STYLES + buildPanelHtml(settings);
  doc.body.appendChild(overlay);
  _panelEl = overlay;
  const fitOverlay = () => {
    const vp = win.visualViewport || {
      width: win.innerWidth,
      height: win.innerHeight,
      offsetTop: 0,
      offsetLeft: 0,
    };
    const w = vp.width || win.innerWidth;
    const h = vp.height || win.innerHeight;
    overlay.style.cssText = `
      position: fixed !important; top: ${vp.offsetTop || 0}px !important; left: ${vp.offsetLeft || 0}px !important;
      width: ${w}px !important; height: ${h}px !important;
      max-width: none !important; max-height: none !important; margin: 0 !important; padding: 0 !important;
      z-index: 10000 !important; display: flex !important; align-items: center !important; justify-content: center !important;
      background: rgba(5,6,15,0.80) !important; backdrop-filter: blur(8px) !important; -webkit-backdrop-filter: blur(8px) !important;
      overflow: hidden !important;
    `;
    const panel = overlay.querySelector(".sa-panel");
    if (panel && w <= 768) {
      panel.style.cssText = `width: ${w}px !important; height: ${h}px !important; max-width: none !important; max-height: none !important; border-radius: 0 !important; border: none !important; margin: 0 !important;`;
    } else if (panel) {
      panel.style.cssText = "";
    }
  };
  fitOverlay();
  const vpObj = win.visualViewport;
  if (vpObj) {
    vpObj.addEventListener("resize", fitOverlay);
    vpObj.addEventListener("scroll", fitOverlay);
  }
  win.addEventListener("resize", fitOverlay);
  overlay._cleanupResize = () => {
    if (vpObj) {
      vpObj.removeEventListener("resize", fitOverlay);
      vpObj.removeEventListener("scroll", fitOverlay);
    }
    win.removeEventListener("resize", fitOverlay);
  };
  bindPanelEvents(overlay, settings);
  await refreshEntryList(overlay);
  await refreshMegaEntryList(overlay);
  await refreshStatus(overlay);
});

// ---- 设置收集 ----

const collectBlocksFromPanel = (
  overlay,
  containerId = "#sa-blocks-container",
) => {
  const container = overlay.querySelector(containerId);
  if (!container) return [];
  const blockEls = container.querySelectorAll(".sa-block");
  const blocks = [];
  blockEls.forEach((el) => {
    const id = el.getAttribute("data-block-id");
    if (!id) return;
    const enableCb = el.querySelector(`[data-block-enable="${id}"]`);
    const roleSelect = el.querySelector(`#sa-block-role-${id}`);
    const contentArea = el.querySelector(`[data-block-content="${id}"]`);
    const leadTextInput = el.querySelector(`[data-block-lead-text="${id}"]`);
    const nameEl = el.querySelector(".sa-block-name");
    const typeBadge = el.querySelector(".sa-block-type-badge");
    let type = BLOCK_TYPES.PROMPT;
    const badgeText = typeBadge?.textContent?.trim();
    if (badgeText === "内置") type = BLOCK_TYPES.BUILTIN_GROUP;
    else if (badgeText === "总结") type = BLOCK_TYPES.OLD_SUMMARY;
    else if (badgeText === "消息") type = BLOCK_TYPES.CHAT_MESSAGES;
    const block = {
      id,
      type,
      name: nameEl?.textContent?.trim() || id,
      enabled: enableCb ? enableCb.checked : true,
    };
    if (roleSelect) block.role = roleSelect.value;
    if (contentArea) block.content = contentArea.value;
    if (leadTextInput) block.leadText = leadTextInput.value;
    blocks.push(block);
  });
  return blocks;
};

const collectSettingsFromPanel = (overlay) => {
  const val = (id) => overlay.querySelector(`#${id}`)?.value ?? "";
  const checked = (id) => overlay.querySelector(`#${id}`)?.checked ?? false;
  return {
    triggerFloorCount: clampInt(val("sa-trigger-count"), 10, 999),
    keepFloorCount: clampInt(val("sa-keep-count"), 1, 999),
    includeOldSummary: checked("sa-include-old-summary"),
    autoTriggerConfirm: checked("sa-auto-confirm"),
    autoHideSummarizedFloors: checked("sa-auto-hide-summarized"),
    noTransTag: checked("sa-no-trans-tag"),
    noTransTagValue: val("sa-no-trans-tag-value") || "<|no-trans|>",
    userPrefix: val("sa-user-prefix") || "{{user}}",
    assistantPrefix: val("sa-assistant-prefix") || "{{char}}",
    apiMode:
      overlay.querySelector('input[name="sa-api-mode"]:checked')?.value ||
      "tavern",
    customApiUrl: val("sa-api-url"),
    customApiKey: val("sa-api-key"),
    customApiModel: val("sa-api-model"),
    temperature: val("sa-temperature") || "same_as_preset",
    maxTokens: val("sa-max-tokens") || "same_as_preset",
    includeTags: parseTagString(val("sa-include-tags")),
    excludeTags: parseTagString(val("sa-exclude-tags")),
    excludeHtmlComments: checked("sa-exclude-html-comments"),
    promptBlocks: collectBlocksFromPanel(overlay, "#sa-blocks-container"),
    megaPromptBlocks: collectBlocksFromPanel(
      overlay,
      "#sa-mega-blocks-container",
    ),
  };
};

// ---- 板块管理 ----

let _draggedBlockId = null;

const rerenderBlocks = (
  overlay,
  blocks,
  containerId = "#sa-blocks-container",
) => {
  const container = overlay.querySelector(containerId);
  if (!container) return;
  container.innerHTML = renderBlocks(blocks, containerId.replace("#", ""));
};

const addNewBlock = async (overlay, containerId = "#sa-blocks-container") => {
  const result = await SillyTavern.callGenericPopup(
    "请输入新板块的名称：",
    SillyTavern.POPUP_TYPE.INPUT,
    "自定义提示词",
    { rows: 1, okButton: "创建", cancelButton: "取消" },
  );
  if (
    result === SillyTavern.POPUP_RESULT.CANCELLED ||
    typeof result !== "string" ||
    !result.trim()
  )
    return;
  const blocks = collectBlocksFromPanel(overlay, containerId);
  blocks.push({
    id: generateBlockId(),
    type: BLOCK_TYPES.PROMPT,
    name: result.trim(),
    role: "system",
    content: "",
    enabled: true,
  });
  rerenderBlocks(overlay, blocks, containerId);
};

const deleteBlock = async (
  overlay,
  blockId,
  containerId = "#sa-blocks-container",
) => {
  const cfm = await SillyTavern.callGenericPopup(
    "确定要删除这个自定义板块吗？",
    SillyTavern.POPUP_TYPE.CONFIRM,
  );
  if (cfm !== SillyTavern.POPUP_RESULT.AFFIRMATIVE) return;
  const blocks = collectBlocksFromPanel(overlay, containerId).filter(
    (b) => b.id !== blockId,
  );
  rerenderBlocks(overlay, blocks, containerId);
};

const resetBlocks = async (
  overlay,
  containerId = "#sa-blocks-container",
  defaultBlocks = DEFAULT_PROMPT_BLOCKS,
) => {
  const cfm = await SillyTavern.callGenericPopup(
    "确定要重置所有提示词板块为默认值吗？",
    SillyTavern.POPUP_TYPE.CONFIRM,
  );
  if (cfm !== SillyTavern.POPUP_RESULT.AFFIRMATIVE) return;
  const defaults = defaultBlocks.map((b) => ({ ...b }));
  rerenderBlocks(overlay, defaults, containerId);
  toastr.success("提示词板块已重置");
};

const viewEditEntry = async (overlay, entryName) => {
  const entries = await getWorldbookEntriesSafe();
  const entry = entries.find((e) => e && e.name === entryName);
  if (!entry) {
    toastr.error(`未找到条目: ${entryName}`);
    return;
  }
  const result = await SillyTavern.callGenericPopup(
    `查看/编辑条目「${escapeHtml(entryName)}」：`,
    SillyTavern.POPUP_TYPE.INPUT,
    entry.content || "",
    { rows: 15, wide: true, okButton: "保存修改", cancelButton: "取消" },
  );
  if (
    result === SillyTavern.POPUP_RESULT.CANCELLED ||
    typeof result !== "string"
  )
    return;
  await upsertSummaryEntryByName(entryName, result);
  toastr.success(`已保存条目: ${entryName}`);
  await refreshEntryList(overlay);
  await refreshStatus(overlay);
};

// ---- 板块事件绑定 ----

const bindBlockEventsForContainer = (overlay, containerId, defaultBlocks) => {
  const container = overlay.querySelector(containerId);
  if (!container || container._blockEventsBound) return;
  container._blockEventsBound = true;

  container.addEventListener("click", (e) => {
    const target = e.target;
    if (target.closest(".sa-block-enable") || target.tagName === "INPUT")
      return;
    if (
      target.closest("[data-action-add-block]") ||
      target.closest("[data-action-add-mega-block]")
    ) {
      addNewBlock(overlay, containerId);
      return;
    }
    if (target.closest("[data-action-reset-blocks]")) {
      resetBlocks(overlay, containerId, DEFAULT_PROMPT_BLOCKS);
      return;
    }
    if (target.closest("[data-action-reset-mega-blocks]")) {
      resetBlocks(overlay, containerId, DEFAULT_MEGA_SUMMARY_PROMPT_BLOCKS);
      return;
    }
    const deleteEl = target.closest("[data-block-delete]");
    if (deleteEl) {
      e.stopPropagation();
      deleteBlock(
        overlay,
        deleteEl.getAttribute("data-block-delete"),
        containerId,
      );
      return;
    }
    const toggleEl = target.closest("[data-block-toggle]");
    if (toggleEl) {
      const blockId = toggleEl.getAttribute("data-block-toggle");
      const body = container.querySelector(`[data-block-body="${blockId}"]`);
      toggleEl.classList.toggle("collapsed");
      body.classList.toggle("collapsed");
    }
  });

  container.addEventListener("change", (e) => {
    const enableEl = e.target.closest("[data-block-enable]");
    if (enableEl) {
      const blockId = enableEl.getAttribute("data-block-enable");
      const blockEl = container.querySelector(`[data-block-id="${blockId}"]`);
      if (blockEl)
        blockEl.classList.toggle("sa-block-disabled", !enableEl.checked);
    }
  });

  // 桌面端拖拽排序
  container.addEventListener("dragstart", (e) => {
    const block = e.target.closest(".sa-block");
    if (!block) return;
    _draggedBlockId = block.getAttribute("data-block-id");
    block.classList.add("sa-block-dragging");
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", _draggedBlockId);
  });
  container.addEventListener("dragend", () => {
    container.querySelectorAll(".sa-block").forEach((b) => {
      b.classList.remove(
        "sa-block-dragging",
        "sa-block-drag-over-top",
        "sa-block-drag-over-bottom",
      );
    });
    _draggedBlockId = null;
  });
  container.addEventListener("dragover", (e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    const block = e.target.closest(".sa-block");
    container.querySelectorAll(".sa-block").forEach((b) => {
      b.classList.remove("sa-block-drag-over-top", "sa-block-drag-over-bottom");
    });
    if (block && block.getAttribute("data-block-id") !== _draggedBlockId) {
      const rect = block.getBoundingClientRect();
      const midY = rect.top + rect.height / 2;
      block.classList.add(
        e.clientY < midY
          ? "sa-block-drag-over-top"
          : "sa-block-drag-over-bottom",
      );
    }
  });
  container.addEventListener("drop", (e) => {
    e.preventDefault();
    const targetBlock = e.target.closest(".sa-block");
    if (!targetBlock || !_draggedBlockId) return;
    const targetId = targetBlock.getAttribute("data-block-id");
    if (targetId === _draggedBlockId) return;
    const blocks = collectBlocksFromPanel(overlay, containerId);
    const fromIdx = blocks.findIndex((b) => b.id === _draggedBlockId);
    const toIdx = blocks.findIndex((b) => b.id === targetId);
    if (fromIdx < 0 || toIdx < 0) return;
    const rect = targetBlock.getBoundingClientRect();
    const insertBefore = e.clientY < rect.top + rect.height / 2;
    const [moved] = blocks.splice(fromIdx, 1);
    let newIdx = blocks.findIndex((b) => b.id === targetId);
    if (!insertBefore) newIdx += 1;
    blocks.splice(newIdx, 0, moved);
    rerenderBlocks(overlay, blocks, containerId);
    _draggedBlockId = null;
  });

  // 移动端触摸拖拽排序
  let _touchDragEl = null;
  let _touchClone = null;
  let _touchStartY = 0;
  let _touchBlockId = null;

  container.addEventListener(
    "touchstart",
    (e) => {
      const dragHandle = e.target.closest(".sa-block-drag");
      if (!dragHandle) return;
      const block = dragHandle.closest(".sa-block");
      if (!block) return;
      _touchBlockId = block.getAttribute("data-block-id");
      _touchDragEl = block;
      _touchStartY = e.touches[0].clientY;
      _touchDragEl._touchTimer = setTimeout(() => {
        block.classList.add("sa-block-dragging");
        const rect = block.getBoundingClientRect();
        _touchClone = block.cloneNode(true);
        _touchClone.className = "sa-block sa-block-touch-clone";
        _touchClone.style.width = rect.width + "px";
        _touchClone.style.left = rect.left + "px";
        _touchClone.style.top = rect.top + "px";
        const doc = window.top?.document || document;
        doc.body.appendChild(_touchClone);
      }, 150);
    },
    { passive: true },
  );

  container.addEventListener(
    "touchmove",
    (e) => {
      if (!_touchBlockId || !_touchDragEl) return;
      const touch = e.touches[0];
      if (_touchClone) {
        _touchClone.style.top = touch.clientY - 20 + "px";
      }
      container.querySelectorAll(".sa-block").forEach((b) => {
        b.classList.remove(
          "sa-block-drag-over-top",
          "sa-block-drag-over-bottom",
        );
      });
      const elUnder = document.elementFromPoint(touch.clientX, touch.clientY);
      const blockUnder = elUnder?.closest?.(".sa-block");
      if (
        blockUnder &&
        blockUnder.getAttribute("data-block-id") !== _touchBlockId
      ) {
        const rect = blockUnder.getBoundingClientRect();
        const midY = rect.top + rect.height / 2;
        blockUnder.classList.add(
          touch.clientY < midY
            ? "sa-block-drag-over-top"
            : "sa-block-drag-over-bottom",
        );
      }
    },
    { passive: true },
  );

  container.addEventListener("touchend", (e) => {
    if (_touchDragEl?._touchTimer) clearTimeout(_touchDragEl._touchTimer);
    if (!_touchBlockId) return;
    const touch = e.changedTouches?.[0];
    if (touch && _touchClone) {
      const elUnder = document.elementFromPoint(touch.clientX, touch.clientY);
      const targetBlock = elUnder?.closest?.(".sa-block");
      if (targetBlock) {
        const targetId = targetBlock.getAttribute("data-block-id");
        if (targetId && targetId !== _touchBlockId) {
          const blocks = collectBlocksFromPanel(overlay, containerId);
          const fromIdx = blocks.findIndex((b) => b.id === _touchBlockId);
          const toIdx = blocks.findIndex((b) => b.id === targetId);
          if (fromIdx >= 0 && toIdx >= 0) {
            const rect = targetBlock.getBoundingClientRect();
            const insertBefore = touch.clientY < rect.top + rect.height / 2;
            const [moved] = blocks.splice(fromIdx, 1);
            let newIdx = blocks.findIndex((b) => b.id === targetId);
            if (!insertBefore) newIdx += 1;
            blocks.splice(newIdx, 0, moved);
            rerenderBlocks(overlay, blocks, containerId);
          }
        }
      }
    }
    container.querySelectorAll(".sa-block").forEach((b) => {
      b.classList.remove(
        "sa-block-dragging",
        "sa-block-drag-over-top",
        "sa-block-drag-over-bottom",
      );
    });
    if (_touchClone && _touchClone.isConnected) _touchClone.remove();
    _touchClone = null;
    _touchDragEl = null;
    _touchBlockId = null;
  });
};

const bindBlockEvents = (overlay) => {
  bindBlockEventsForContainer(
    overlay,
    "#sa-blocks-container",
    DEFAULT_PROMPT_BLOCKS,
  );
  bindBlockEventsForContainer(
    overlay,
    "#sa-mega-blocks-container",
    DEFAULT_MEGA_SUMMARY_PROMPT_BLOCKS,
  );
};

// ---- 条目列表操作 ----

const handleEntryAction = async (overlay, action, entryName) => {
  switch (action) {
    case "view-edit":
      await viewEditEntry(overlay, entryName);
      break;
    case "regenerate": {
      await regenerateAndReplaceEntry(entryName);
      await refreshEntryList(overlay);
      await refreshStatus(overlay);
      break;
    }
    case "delete": {
      const cfm = await SillyTavern.callGenericPopup(
        `确定要删除总结条目「${escapeHtml(entryName)}」吗？`,
        SillyTavern.POPUP_TYPE.CONFIRM,
      );
      if (cfm !== SillyTavern.POPUP_RESULT.AFFIRMATIVE) return;
      await deleteSummaryEntry(entryName);
      toastr.success(`已删除条目 "${entryName}"`);
      await refreshEntryList(overlay);
      await refreshStatus(overlay);
      break;
    }
  }
};

const refreshEntryList = async (panel, enableSelection = false) => {
  const el = panel.querySelector("#sa-entry-list");
  if (!el) return;
  try {
    const allEntries = await getAllSummaryEntriesForDisplay();
    const megaMap = await getMegaSummaryMap();

    // 获取实际存在的大总结条目名称，用于验证 mapping 的有效性
    const megaEntries = await getAllMegaSummaryEntriesForDisplay();
    const existingMegaNames = new Set(megaEntries.map((e) => e.name));
    const activeMegaNames = new Set(
      megaEntries.filter((e) => !e.disabled).map((e) => e.name),
    );

    const usedInMega = new Set();
    let needCleanup = false;
    for (const [megaName, summaryNames] of Object.entries(megaMap)) {
      if (!existingMegaNames.has(megaName)) {
        // 大总结条目已不存在，标记需要清理该 mapping
        needCleanup = true;
        continue;
      }
      // 只有启用的大总结才将其对应的总结条目标记为已被大总结
      if (!activeMegaNames.has(megaName)) continue;
      if (Array.isArray(summaryNames)) {
        summaryNames.forEach((name) => usedInMega.add(name));
      }
    }

    // 异步清理孤立的 mapping（不阻塞 UI）
    if (needCleanup) {
      (async () => {
        for (const megaName of Object.keys(megaMap)) {
          if (!existingMegaNames.has(megaName)) {
            await deleteMegaSummaryMapping(megaName);
          }
        }
      })();
    }

    // 找到第一个未被大总结的有效条目的索引
    let firstUnmegaIdx = -1;
    for (let i = 0; i < allEntries.length; i++) {
      const e = allEntries[i];
      const parsed = parseSummaryEntryName(e.name);
      if (parsed && !e.disabled && !usedInMega.has(e.name)) {
        firstUnmegaIdx = i;
        break;
      }
    }

    // 标记哪些条目可以被选择用于大总结
    // 规则：从第一个未被大总结的条目开始，所有连续的未被大总结条目都可选
    const entries = allEntries.map((e, idx) => {
      const parsed = parseSummaryEntryName(e.name);
      const isUsedInMega = usedInMega.has(e.name);

      if (!parsed || e.disabled || isUsedInMega) {
        return {
          ...e,
          selectable: false,
          selectableReason: isUsedInMega ? "mega" : "",
        };
      }

      // 只有从第一个未被大总结的条目开始的连续条目才可选
      let canSelect = false;
      if (firstUnmegaIdx >= 0 && idx >= firstUnmegaIdx) {
        // 检查从 firstUnmegaIdx 到 idx 之间是否所有条目都是可选的（没有被大总结的中断）
        canSelect = true;
        for (let i = firstUnmegaIdx; i < idx; i++) {
          const midEntry = allEntries[i];
          const midParsed = parseSummaryEntryName(midEntry.name);
          if (!midParsed || midEntry.disabled) {
            // 跳过非总结条目或已禁用的
            continue;
          }
          if (usedInMega.has(midEntry.name)) {
            // 中间有已被大总结的条目，断开了连续性
            canSelect = false;
            break;
          }
        }
      }

      return { ...e, selectable: enableSelection && canSelect };
    });

    el.innerHTML = renderEntryList(entries, enableSelection);
    el.querySelectorAll("button[data-action]").forEach((btn) => {
      btn.addEventListener("click", () => {
        handleEntryAction(panel, btn.dataset.action, btn.dataset.name);
      });
    });

    // 在选择模式下，绑定 checkbox 联动逻辑
    if (enableSelection) {
      bindMegaSelectionLogic(el);
    }
  } catch (err) {
    el.innerHTML = `<div class="sa-empty">加载条目列表失败: ${err.message}</div>`;
  }
};

// 绑定大总结选择的联动逻辑：确保选中的条目从头开始连续
// 规则：勾选第N个时，自动勾选0~N-1；取消第N个时，自动取消N+1以后的
const bindMegaSelectionLogic = (container) => {
  const checkboxes = Array.from(
    container.querySelectorAll(".sa-entry-checkbox"),
  );
  if (checkboxes.length === 0) return;

  const onCheckboxChange = (e) => {
    const changedCb = e.target;
    const changedIdx = checkboxes.indexOf(changedCb);
    if (changedIdx < 0) return;

    if (changedCb.checked) {
      // 勾选第N个：自动勾选前面所有（0 ~ N-1）
      for (let i = 0; i < changedIdx; i++) {
        checkboxes[i].checked = true;
      }
    } else {
      // 取消第N个：自动取消后面所有（N+1 ~ end）
      for (let i = changedIdx + 1; i < checkboxes.length; i++) {
        checkboxes[i].checked = false;
      }
    }

    updateSelectionCount(container);
  };

  checkboxes.forEach((cb) => {
    cb.addEventListener("change", onCheckboxChange);
  });

  // 添加全选/全不选按钮
  addSelectionControls(container, checkboxes);
};

// 更新选中计数显示
const updateSelectionCount = (container) => {
  const checkboxes = container.querySelectorAll(".sa-entry-checkbox");
  const checkedCount = container.querySelectorAll(
    ".sa-entry-checkbox:checked",
  ).length;
  const countEl = container.querySelector(".sa-selection-count");
  if (countEl) {
    countEl.textContent =
      checkedCount > 0
        ? `已选择 ${checkedCount}/${checkboxes.length} 个条目`
        : `共 ${checkboxes.length} 个可选条目，请从头开始勾选`;
  }
};

// 添加选择辅助控件
const addSelectionControls = (container, checkboxes) => {
  // 检查是否已经存在
  if (container.querySelector(".sa-selection-controls")) return;

  const controls = document.createElement("div");
  controls.className = "sa-selection-controls";
  controls.innerHTML = `
    <span class="sa-selection-count">共 ${checkboxes.length} 个可选条目，请从头开始勾选</span>
    <div class="sa-selection-btns">
      <button class="sa-btn sa-btn-sm sa-select-all">全选</button>
      <button class="sa-btn sa-btn-sm sa-select-none">全不选</button>
    </div>
  `;
  container.insertBefore(controls, container.firstChild);

  controls.querySelector(".sa-select-all").addEventListener("click", () => {
    checkboxes.forEach((cb) => {
      cb.checked = true;
    });
    updateSelectionCount(container);
  });
  controls.querySelector(".sa-select-none").addEventListener("click", () => {
    checkboxes.forEach((cb) => {
      cb.checked = false;
    });
    updateSelectionCount(container);
  });
};

const handleMegaEntryAction = async (overlay, action, entryName) => {
  switch (action) {
    case "view-edit-mega":
      await viewEditEntry(overlay, entryName);
      break;
    case "regenerate-mega": {
      await regenerateAndReplaceMegaEntry(entryName);
      await refreshMegaEntryList(overlay);
      await refreshEntryList(overlay);
      await refreshStatus(overlay);
      break;
    }
    case "deactivate-mega": {
      const cfm = await SillyTavern.callGenericPopup(
        `确定要回档大总结条目「${escapeHtml(entryName)}」吗？\n\n` +
          `回档后将关闭该大总结条目，并恢复其包含的原始总结条目。`,
        SillyTavern.POPUP_TYPE.CONFIRM,
      );
      if (cfm !== SillyTavern.POPUP_RESULT.AFFIRMATIVE) return;
      await deactivateMegaSummaryEntry(entryName);
      await refreshMegaEntryList(overlay);
      await refreshEntryList(overlay);
      await refreshStatus(overlay);
      break;
    }
    case "activate-mega": {
      const cfm = await SillyTavern.callGenericPopup(
        `确定要启用大总结条目「${escapeHtml(entryName)}」吗？\n\n` +
          `启用后将开启该大总结条目，并禁用其包含的原始总结条目。`,
        SillyTavern.POPUP_TYPE.CONFIRM,
      );
      if (cfm !== SillyTavern.POPUP_RESULT.AFFIRMATIVE) return;
      await activateMegaSummaryEntry(entryName);
      await refreshMegaEntryList(overlay);
      await refreshEntryList(overlay);
      await refreshStatus(overlay);
      break;
    }
    case "delete-mega": {
      const cfm = await SillyTavern.callGenericPopup(
        `确定要删除大总结条目「${escapeHtml(entryName)}」吗？\n\n` +
          `删除后将恢复该大总结包含的原始总结条目。`,
        SillyTavern.POPUP_TYPE.CONFIRM,
      );
      if (cfm !== SillyTavern.POPUP_RESULT.AFFIRMATIVE) return;
      await restoreMegaSummaryToSummaries(entryName);
      await refreshMegaEntryList(overlay);
      await refreshEntryList(overlay);
      await refreshStatus(overlay);
      break;
    }
  }
};

const refreshMegaEntryList = async (panel) => {
  const el = panel.querySelector("#sa-mega-entry-list");
  if (!el) return;
  try {
    const entries = await getAllMegaSummaryEntriesForDisplay();
    el.innerHTML = renderMegaEntryList(entries);
    el.querySelectorAll("button[data-action]").forEach((btn) => {
      btn.addEventListener("click", () => {
        handleMegaEntryAction(panel, btn.dataset.action, btn.dataset.name);
      });
    });
  } catch (err) {
    el.innerHTML = `<div class="sa-empty">加载大总结列表失败: ${err.message}</div>`;
  }
};

const refreshStatus = async (panel) => {
  const el = panel.querySelector("#sa-status-info");
  if (!el) return;
  try {
    el.innerHTML = await renderStatusInfo();
  } catch (err) {
    el.innerHTML = `加载状态失败: ${err.message}`;
  }
};

// ---- 面板事件绑定 ----

const bindPanelEvents = (overlay, initialSettings) => {
  // 关闭按钮
  overlay.querySelector("#sa-close").addEventListener("click", () => {
    overlay._cleanupResize?.();
    overlay.remove();
    _panelEl = null;
  });
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) {
      overlay._cleanupResize?.();
      overlay.remove();
      _panelEl = null;
    }
  });

  // 主标签页切换
  overlay.querySelectorAll(".sa-tab-item").forEach((tab) => {
    tab.addEventListener("click", () => {
      const tabName = tab.dataset.tab;
      overlay.querySelector(".sa-tab-item.active").classList.remove("active");
      overlay.querySelector(".sa-tab-pane.active").classList.remove("active");
      tab.classList.add("active");
      overlay
        .querySelector(`.sa-tab-pane[data-pane="${tabName}"]`)
        .classList.add("active");
    });
  });

  // 二级导航切换
  overlay.querySelectorAll(".sa-settings-nav-item").forEach((navItem) => {
    navItem.addEventListener("click", (e) => {
      e.preventDefault();
      const subNavName = navItem.dataset.subNav;
      overlay
        .querySelector(".sa-settings-nav-item.active")
        .classList.remove("active");
      overlay
        .querySelector(".sa-settings-pane.active")
        .classList.remove("active");
      navItem.classList.add("active");
      overlay
        .querySelector(`.sa-settings-pane[data-sub-pane="${subNavName}"]`)
        .classList.add("active");
    });
  });

  // 板块折叠/展开
  overlay.addEventListener("click", (e) => {
    const header = e.target.closest("[data-block-toggle]");
    if (header) {
      const blockId = header.dataset.blockToggle;
      const body = overlay.querySelector(`[data-block-body="${blockId}"]`);
      header.classList.toggle("collapsed");
      body.classList.toggle("collapsed");
    }
  });

  // API 模式切换
  const updateApiModeDisplay = () => {
    const customFields = overlay.querySelector("#sa-custom-api-fields");
    if (!customFields) return;
    const selectedMode = overlay.querySelector(
      'input[name="sa-api-mode"]:checked',
    )?.value;
    customFields.style.display = selectedMode === "custom" ? "" : "none";
    const statusGrid = overlay.querySelector(".sa-status-grid");
    if (statusGrid) {
      const labels = statusGrid.querySelectorAll(".sa-status-label");
      labels.forEach((label) => {
        if (label.textContent.trim() === "API 模式") {
          const valueEl = label.nextElementSibling;
          if (valueEl) {
            const model = overlay.querySelector("#sa-api-model")?.value || "";
            valueEl.textContent =
              selectedMode === "custom"
                ? `自定义API${model ? ` (${model})` : ""}`
                : "酒馆主API";
          }
        }
      });
    }
  };
  overlay.querySelectorAll('input[name="sa-api-mode"]').forEach((radio) => {
    radio.addEventListener("change", updateApiModeDisplay);
  });

  // 获取模型列表
  overlay
    .querySelector("#sa-fetch-models")
    .addEventListener("click", async () => {
      const url = overlay.querySelector("#sa-api-url").value.trim();
      const key = overlay.querySelector("#sa-api-key").value.trim();
      if (!url) {
        toastr.warning("请先填写API地址");
        return;
      }
      try {
        toastr.info("正在获取模型列表...");
        const models = await fetchModelList(url, key);
        const select = overlay.querySelector("#sa-api-model");
        select.innerHTML = "";
        if (models && models.length > 0) {
          models.forEach((m) => select.add(new Option(m, m)));
          toastr.success(`获取到 ${models.length} 个模型`);
          // 自动选择第一个模型并触发自动保存
          if (select.value) {
            autoSave();
          }
        } else {
          select.innerHTML = '<option value="">未获取到模型</option>';
          toastr.warning("未获取到任何模型");
        }
      } catch (err) {
        toastr.error(`获取模型列表失败: ${err.message}`);
        console.error("获取模型列表详细错误:", err);
      }
    });

  // ---- 楼层隐藏/显示管理 ----
  const CHUNK = 200;
  const batchSetHidden = async (fromId, toId, hidden) => {
    const lastId = getLastMessageId();
    if (lastId < 0) return 0;
    const lo = Math.max(0, Math.min(fromId, toId));
    const hi = Math.min(lastId, Math.max(fromId, toId));
    const msgs = getChatMessages(`${lo}-${hi}`, {
      role: "all",
      hide_state: "all",
      include_swipes: false,
    });
    const updates = [];
    for (const msg of msgs) {
      const id = msg?.message_id;
      if (!Number.isFinite(id)) continue;
      if (!!msg?.is_hidden !== hidden) {
        updates.push({ message_id: id, is_hidden: hidden });
      }
    }
    if (updates.length === 0) return 0;
    for (let i = 0; i < updates.length; i += CHUNK) {
      const isLast = i + CHUNK >= updates.length;
      await setChatMessages(updates.slice(i, i + CHUNK), {
        refresh: isLast ? "all" : "none",
      });
    }
    return updates.length;
  };

  overlay
    .querySelector("#sa-vis-hide-range")
    .addEventListener("click", async () => {
      const from = parseInt(overlay.querySelector("#sa-vis-from").value, 10);
      const to = parseInt(overlay.querySelector("#sa-vis-to").value, 10);
      if (isNaN(from) || isNaN(to)) {
        toastr.warning("请输入有效的楼层范围");
        return;
      }
      const count = await batchSetHidden(from, to, true);
      toastr.success(`已隐藏 ${count} 条消息（${from}-${to} 楼）`);
      await refreshStatus(overlay);
    });
  overlay
    .querySelector("#sa-vis-show-range")
    .addEventListener("click", async () => {
      const from = parseInt(overlay.querySelector("#sa-vis-from").value, 10);
      const to = parseInt(overlay.querySelector("#sa-vis-to").value, 10);
      if (isNaN(from) || isNaN(to)) {
        toastr.warning("请输入有效的楼层范围");
        return;
      }
      const count = await batchSetHidden(from, to, false);
      toastr.success(`已显示 ${count} 条消息（${from}-${to} 楼）`);
      await refreshStatus(overlay);
    });
  overlay
    .querySelector("#sa-vis-hide-summarized")
    .addEventListener("click", async () => {
      await applySummarizedFloorsVisibility();
      toastr.success("已隐藏所有已总结楼层");
      await refreshStatus(overlay);
    });
  overlay
    .querySelector("#sa-vis-show-all")
    .addEventListener("click", async () => {
      const lastId = getLastMessageId();
      if (lastId < 0) {
        toastr.warning("聊天为空");
        return;
      }
      const count = await batchSetHidden(0, lastId, false);
      toastr.success(`已显示全部 ${count} 条已隐藏消息`);
      await refreshStatus(overlay);
    });

  // ---- 世界书绑定/解绑/迁移 ----
  const refreshWbBindStatus = () => {
    const statusEl = overlay.querySelector("#sa-wb-bind-status");
    if (statusEl) {
      statusEl.textContent = isChatWorldbookBound()
        ? `✅ 已绑定: ${getActiveWorldbookName()}`
        : "❌ 未绑定";
    }
    const unbindBtn = overlay.querySelector("#sa-unbind-worldbook");
    const switchBtn = overlay.querySelector("#sa-switch-worldbook");
    if (unbindBtn) unbindBtn.disabled = !isChatWorldbookBound();
    if (switchBtn) switchBtn.disabled = !isChatWorldbookBound();
  };
  const loadWbSelect = async () => {
    const select = overlay.querySelector("#sa-wb-select");
    if (!select) return;
    try {
      const names = await getWorldbookNames();
      const currentName = getActiveWorldbookName();
      select.innerHTML =
        '<option value="">-- 请选择 --</option>' +
        names
          .map(
            (n) =>
              `<option value="${escapeHtml(n)}" ${n === currentName ? "selected" : ""}>${escapeHtml(n)}</option>`,
          )
          .join("");
    } catch (e) {
      select.innerHTML = '<option value="">-- 加载失败 --</option>';
    }
  };
  loadWbSelect();

  overlay
    .querySelector("#sa-bind-worldbook")
    ?.addEventListener("click", async () => {
      const selectVal = overlay.querySelector("#sa-wb-select")?.value?.trim();
      const inputVal = overlay.querySelector("#sa-new-wb-name")?.value?.trim();
      const name = inputVal || selectVal;
      if (!name) {
        const autoName = generateDefaultWorldbookName();
        try {
          await bindWorldbookToChat(autoName);
          refreshWbBindStatus();
          await loadWbSelect();
          await refreshEntryList(overlay);
          await refreshStatus(overlay);
          toastr.success(`已自动创建并绑定世界书: "${autoName}"`);
        } catch (err) {
          toastr.error(`绑定失败: ${err.message}`);
        }
        return;
      }
      if (isChatWorldbookBound() && getActiveWorldbookName() === name) {
        toastr.info("当前聊天已绑定该世界书");
        return;
      }
      try {
        await bindWorldbookToChat(name);
        refreshWbBindStatus();
        await loadWbSelect();
        overlay.querySelector("#sa-new-wb-name").value = "";
        await refreshEntryList(overlay);
        await refreshStatus(overlay);
        toastr.success(`已绑定世界书: "${name}"`);
      } catch (err) {
        toastr.error(`绑定失败: ${err.message}`);
      }
    });

  overlay
    .querySelector("#sa-unbind-worldbook")
    ?.addEventListener("click", async () => {
      if (!isChatWorldbookBound()) {
        toastr.info("当前聊天未绑定世界书");
        return;
      }
      const currentName = getActiveWorldbookName();
      const cfm = await SillyTavern.callGenericPopup(
        `确定要解绑世界书「${escapeHtml(currentName)}」吗？\n解绑后世界书不会被删除，但不再对当前聊天生效。`,
        SillyTavern.POPUP_TYPE.CONFIRM,
      );
      if (cfm !== SillyTavern.POPUP_RESULT.AFFIRMATIVE) return;
      try {
        await unbindWorldbookFromChat();
        refreshWbBindStatus();
        await refreshEntryList(overlay);
        await refreshStatus(overlay);
        toastr.success(`已解绑世界书: "${currentName}"`);
      } catch (err) {
        toastr.error(`解绑失败: ${err.message}`);
      }
    });

  overlay
    .querySelector("#sa-switch-worldbook")
    ?.addEventListener("click", async () => {
      if (!isChatWorldbookBound()) {
        toastr.warning("当前聊天未绑定世界书，请先绑定");
        return;
      }
      const selectVal = overlay.querySelector("#sa-wb-select")?.value?.trim();
      const inputVal = overlay.querySelector("#sa-new-wb-name")?.value?.trim();
      const newName = inputVal || selectVal;
      if (!newName) {
        toastr.warning("请选择或输入目标世界书名称");
        return;
      }
      const oldName = getActiveWorldbookName();
      if (newName === oldName) {
        toastr.info("目标世界书与当前相同，无需迁移");
        return;
      }
      const cfm = await SillyTavern.callGenericPopup(
        `确定要将总结条目从「${escapeHtml(oldName)}」迁移到「${escapeHtml(newName)}」吗？\n迁移后当前聊天将绑定到新世界书。`,
        SillyTavern.POPUP_TYPE.CONFIRM,
      );
      if (cfm !== SillyTavern.POPUP_RESULT.AFFIRMATIVE) return;
      try {
        toastr.info("正在迁移世界书...");
        await migrateWorldbookEntries(oldName, newName);
        refreshWbBindStatus();
        await loadWbSelect();
        overlay.querySelector("#sa-new-wb-name").value = "";
        await refreshEntryList(overlay);
        await refreshStatus(overlay);
        toastr.success(`已迁移到世界书「${newName}」`);
      } catch (err) {
        toastr.error(`迁移失败: ${err.message}`);
      }
    });

  // ---- 自动保存（防抖） ----
  let _autoSaveTimer = null;
  const autoSave = () => {
    if (_autoSaveTimer) clearTimeout(_autoSaveTimer);
    _autoSaveTimer = setTimeout(async () => {
      try {
        const newSettings = collectSettingsFromPanel(overlay);
        await updateSettings(newSettings);
        toastr.info("设置已自动保存", "", {
          timeOut: 1200,
          positionClass: "toast-top-right",
        });
      } catch (e) {
        console.warn("自动保存失败:", e);
      }
    }, 800);
  };
  overlay
    .querySelectorAll(".sa-body input, .sa-body select, .sa-body textarea")
    .forEach((el) => {
      if (el.id === "sa-vis-from" || el.id === "sa-vis-to") return;
      const evtName =
        el.type === "checkbox" || el.type === "radio" || el.tagName === "SELECT"
          ? "change"
          : "input";
      el.addEventListener(evtName, autoSave);
    });

  // ---- 重置设置 ----
  overlay.querySelector("#sa-reset").addEventListener("click", async () => {
    const cfm = await SillyTavern.callGenericPopup(
      "确定要重置所有设置为默认值吗？",
      SillyTavern.POPUP_TYPE.CONFIRM,
    );
    if (cfm !== SillyTavern.POPUP_RESULT.AFFIRMATIVE) return;
    await resetSettings();
    await applySummarizedFloorsVisibility();
    overlay._cleanupResize?.();
    overlay.remove();
    _panelEl = null;
    await showSettingsPopup();
    toastr.success("设置已重置");
  });

  // ---- 手动开始总结 ----
  overlay
    .querySelector("#sa-start-summary")
    .addEventListener("click", async () => {
      if (_autoSaveTimer) clearTimeout(_autoSaveTimer);
      const newSettings = collectSettingsFromPanel(overlay);
      await updateSettings(newSettings);
      await startSummaryProcess();
      await refreshEntryList(overlay);
      await refreshMegaEntryList(overlay);
      await refreshStatus(overlay);
    });

  // ---- 指定楼层总结 ----
  overlay
    .querySelector("#sa-start-custom-summary")
    .addEventListener("click", async () => {
      if (_autoSaveTimer) clearTimeout(_autoSaveTimer);
      const newSettings = collectSettingsFromPanel(overlay);
      await updateSettings(newSettings);
      await startCustomRangeSummaryProcess();
      await refreshEntryList(overlay);
      await refreshMegaEntryList(overlay);
      await refreshStatus(overlay);
    });

  // ---- 开始大总结 ----
  overlay
    .querySelector("#sa-start-mega-summary")
    ?.addEventListener("click", async () => {
      // 切换选择模式
      const btn = overlay.querySelector("#sa-start-mega-summary");
      const isSelecting = btn.textContent.includes("取消");

      if (isSelecting) {
        // 取消选择模式
        btn.textContent = "开始大总结";
        btn.classList.remove("sa-btn-danger");
        btn.classList.add("sa-btn-primary");
        await refreshEntryList(overlay, false);
        const confirmBtn = overlay.querySelector("#sa-confirm-mega-summary");
        if (confirmBtn) confirmBtn.remove();
        return;
      }

      // 进入选择模式
      btn.textContent = "取消选择";
      btn.classList.remove("sa-btn-primary");
      btn.classList.add("sa-btn-danger");
      await refreshEntryList(overlay, true);

      // 添加确认大总结按钮
      const entryListContainer =
        overlay.querySelector("#sa-entry-list").parentElement;
      let confirmBtn = entryListContainer.querySelector(
        "#sa-confirm-mega-summary",
      );
      if (!confirmBtn) {
        confirmBtn = document.createElement("button");
        confirmBtn.id = "sa-confirm-mega-summary";
        confirmBtn.className = "sa-btn sa-btn-primary";
        confirmBtn.textContent = "确认大总结选中的条目";
        confirmBtn.style.marginTop = "10px";
        confirmBtn.style.width = "100%";
        entryListContainer.appendChild(confirmBtn);

        confirmBtn.addEventListener("click", async () => {
          const checkboxes = overlay.querySelectorAll(
            ".sa-entry-checkbox:checked",
          );
          if (checkboxes.length < 2) {
            toastr.warning("请至少选择 2 个总结条目进行大总结");
            return;
          }

          const selectedNames = Array.from(checkboxes).map(
            (cb) => cb.dataset.entryName,
          );

          // 验证选择的条目是否连续
          const allEntries = await getAllSummaryEntriesForDisplay();
          const selectedEntries = allEntries.filter((e) =>
            selectedNames.includes(e.name),
          );
          selectedEntries.sort((a, b) => {
            const aStart = parseSummaryEntryName(a.name)?.start ?? 0;
            const bStart = parseSummaryEntryName(b.name)?.start ?? 0;
            return aStart - bStart;
          });

          const firstParsed = parseSummaryEntryName(selectedEntries[0].name);
          const lastParsed = parseSummaryEntryName(
            selectedEntries[selectedEntries.length - 1].name,
          );

          if (!firstParsed || !lastParsed) {
            toastr.error("选中的条目格式不正确");
            return;
          }

          const entryName = makeMegaSummaryEntryName(
            firstParsed.start,
            lastParsed.end,
          );

          const confirm = await SillyTavern.callGenericPopup(
            `将对以下总结条目进行大总结：\n\n` +
              `选中条目数：${selectedNames.length}\n` +
              `楼层范围：${firstParsed.start}-${lastParsed.end}\n` +
              `大总结名称：${escapeHtml(entryName)}\n\n` +
              `继续吗？`,
            SillyTavern.POPUP_TYPE.CONFIRM,
          );
          if (confirm !== SillyTavern.POPUP_RESULT.AFFIRMATIVE) return;

          // 保存设置并关闭面板
          if (_autoSaveTimer) clearTimeout(_autoSaveTimer);
          const newSettings = collectSettingsFromPanel(overlay);
          await updateSettings(newSettings);
          overlay._cleanupResize?.();
          overlay.remove();
          _panelEl = null;

          // 执行大总结
          await executeMegaSummary(selectedNames, entryName, {
            requireReview: true,
          });
        });
      }
    });

  // ---- 绑定板块事件 ----
  bindBlockEvents(overlay);
};
