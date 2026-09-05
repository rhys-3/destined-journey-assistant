import { formatErrorMessage, errorCatched } from './errorHandler.js';
import { escapeHtml, makeSummaryEntryName, parseSummaryEntryName, parseMegaSummaryEntryName, normalizeWorldbookEntries } from './utils.js';
import { getSettings, getMegaSummaryMapping } from './storage.js';
import { callSummaryApi, callMegaSummaryApi } from './api.js';
import { getActiveWorldbookName, applySummarizedFloorsVisibility, upsertSummaryEntryByName, getLastSummarizedFloor, upsertMegaSummaryEntry } from './worldbook.js';
import { buildSummaryPromptParams, buildRegeneratePromptParams, buildMegaSummaryPromptParams, buildRegenerateMegaSummaryPromptParams } from './prompt.js';
import { assertCurrent, getHost, SillyTavern, updateWorldbookWith } from '../platform/lifecycle.js';
const showSummaryHint = (text, variant = 'info') => getHost().status(text, variant);
const hideSummaryHint = () => {};
const showSummaryHintFor = showSummaryHint;
const chooseSummaryFailureAction = options => { assertCurrent(); return getHost().chooseFailure(options); };
// ---- 返回内容校验 ----

const SUMMARY_INVALID_PATTERNS = [
  /^(?:error|invalid request|rate limit|context length exceeded|server error|network error|unauthorized|forbidden)\b[\s\S]*$/i,
  /^(?:请求失败|连接失败|服务错误|服务器错误|上下文长度超限|余额不足|未授权|无权限|模型忙)[：:，,\s]*[\s\S]*$/i,
  /^(?:HTTP\s*)?\d{3}\b[\s\S]*(?:error|invalid request|server error|network error|unauthorized|forbidden|请求失败|连接失败|服务错误|服务器错误|未授权|无权限)/i,
];

const SUMMARY_LAZY_PATTERNS = [
  /(其余省略|类似上文|照旧|同前|以下省略|无需赘述)/i,
];

const SUMMARY_HEADER_PATTERN = /^---\s*[\r\n]+[^\r\n:][^\r\n]*:\s*$/m;

const SUMMARY_WRAPPER_LINE_PATTERNS = [
  /^\s*以下是(?:本次)?(?:总结|整合结果|整合后的记录|记录内容)[：:]\s*$/i,
  /^\s*(?:总结|整合)(?:如下)?[：:]\s*$/i,
];

const stripMarkdownCodeFence = (content) => {
  let text = typeof content === "string" ? content.trim() : "";
  if (!text) return "";

  while (true) {
    const fencedMatch = text.match(/^```[^\r\n]*\r?\n([\s\S]*?)\r?\n```$/);
    if (fencedMatch) {
      text = fencedMatch[1].trim();
      continue;
    }

    const lines = text.split(/\r?\n/);
    if (
      lines.length >= 3 &&
      SUMMARY_WRAPPER_LINE_PATTERNS.some((pattern) => pattern.test(lines[0])) &&
      /^```[^\r\n]*\s*$/.test(lines[1]) &&
      /^\s*```\s*$/.test(lines[lines.length - 1])
    ) {
      text = lines.slice(2, -1).join("\n").trim();
      continue;
    }

    break;
  }

  return text;
};

const containsMarkdownCodeFence = (content) => {
  const text = typeof content === "string" ? content : "";
  return /(^|\r?\n)\s*```[^\r\n]*\s*(\r?\n|$)/.test(text);
};

const normalizeSummaryFormatting = (content) => {
  const text = typeof content === "string" ? content : "";
  if (!text) return "";

  let normalized = text.replace(
    /(^|\r?\n)\s*(?:\*\*\*|___)\s*(?=\r?\n|$)/g,
    "$1---",
  );

  const lines = normalized.split(/\r?\n/);
  const firstMeaningfulLineIndex = lines.findIndex((line) => line.trim());
  if (firstMeaningfulLineIndex >= 0) {
    const firstMeaningfulLine = lines[firstMeaningfulLineIndex].trim();
    const previousMeaningfulLine = lines
      .slice(0, firstMeaningfulLineIndex)
      .reverse()
      .find((line) => line.trim());

    const looksLikeHeader = /^[^\r\n:][^\r\n]*:\s*$/.test(firstMeaningfulLine);
    const hasLeadingSeparator = firstMeaningfulLine === "---";
    const hasPreviousSeparator =
      (previousMeaningfulLine || "").trim() === "---";

    if (looksLikeHeader && !hasLeadingSeparator && !hasPreviousSeparator) {
      lines.splice(firstMeaningfulLineIndex, 0, "---");
      normalized = lines.join("\n");
    }
  }

  return normalized;
};

const validateSummaryContent = (content, { kind = "总结" } = {}) => {
  const text = normalizeSummaryFormatting(stripMarkdownCodeFence(content));
  if (!text) {
    return `${kind}未保存：AI没有返回任何有效内容。`;
  }
  if (SUMMARY_INVALID_PATTERNS.some((pattern) => pattern.test(text))) {
    return `${kind}未保存：检测到返回内容包含疑似报错信息。`;
  }
  if (SUMMARY_LAZY_PATTERNS.some((pattern) => pattern.test(text))) {
    return `${kind}未保存：检测到“同前/省略/照旧”类偷懒表达。`;
  }
  if (containsMarkdownCodeFence(text)) {
    return `${kind}未保存：检测到残留的 Markdown 代码块围栏。`;
  }
  if (!text.includes("---")) {
    return `${kind}未保存：缺少 "---" 分段结构。`;
  }
  if (!SUMMARY_HEADER_PATTERN.test(text)) {
    return `${kind}未保存：缺少有效的分段标题格式。`;
  }
  return "";
};

const finalizeSummarySave = async (entryName, content, successText = null) => {
  await upsertSummaryEntryByName(entryName, content);
  showSummaryHintFor(
    successText || `总结已生成：${entryName}`,
    "success",
    3200,
  );
  toastr.success(successText || `总结已保存：${entryName}`);
};

const finalizeMegaSummarySave = async (
  entryName,
  content,
  summaryNames,
  successText = null,
) => {
  await upsertMegaSummaryEntry(entryName, content, summaryNames);

  const wbName = getActiveWorldbookName();
  if (wbName) {
    await updateWorldbookWith(wbName, (wb) => {
      const arr = normalizeWorldbookEntries(wb);
      for (const summaryName of summaryNames) {
        const entry = arr.find((e) => e && e.name === summaryName);
        if (entry) {
          entry.enabled = false;
          entry.disable = true;
          if ("disabled" in entry) entry.disabled = true;
        }
      }
      return Array.isArray(wb) ? arr : { ...wb, entries: arr };
    });

    const settings = getSettings();
    if (settings.autoHideSummarizedFloors !== false) {
      await applySummarizedFloorsVisibility();
    }
  }

  showSummaryHintFor(
    successText || `大总结已生成：${entryName}`,
    "success",
    3200,
  );
  toastr.success(successText || `大总结已保存：${entryName}`);
};

// ---- 总结计划 ----

const computeSummaryPlan = errorCatched(async () => {
  const settings = getSettings();
  const lastId = getLastMessageId();
  if (lastId < 0) return null;
  const lastSummarized = await getLastSummarizedFloor();
  const startFloor = lastSummarized + 1;
  const endFloor = lastId - settings.keepFloorCount;
  if (endFloor < startFloor) return null;
  return {
    startFloor,
    endFloor,
    entryName: makeSummaryEntryName(startFloor, endFloor),
    lastId,
    unsummarizedCount: lastId - lastSummarized,
  };
});

const shouldAutoTrigger = errorCatched(async () => {
  const settings = getSettings();
  const lastId = getLastMessageId();
  if (lastId < 0) return false;
  const lastSummarized = await getLastSummarizedFloor();
  const unsummarizedCount = lastId - lastSummarized;
  return unsummarizedCount >= settings.triggerFloorCount;
});

// ---- 执行总结 ----

const validateManualSummaryRange = async (startFloor, endFloor) => {
  const lastId = getLastMessageId();
  if (lastId < 0) {
    return { ok: false, message: "聊天为空，无法生成总结。" };
  }
  if (!Number.isInteger(startFloor) || !Number.isInteger(endFloor)) {
    return { ok: false, message: "请输入有效的整数楼层范围。" };
  }
  if (startFloor < 0 || endFloor < 0) {
    return { ok: false, message: "楼层范围不能小于 0。" };
  }
  if (startFloor > endFloor) {
    return { ok: false, message: "起始楼层不能大于结束楼层。" };
  }
  if (startFloor > lastId) {
    return {
      ok: false,
      message: `起始楼层超出当前聊天范围（最后一楼=${lastId}）。`,
    };
  }
  if (endFloor > lastId) {
    return {
      ok: false,
      message: `结束楼层超出当前聊天范围（最后一楼=${lastId}）。`,
    };
  }
  return { ok: true, lastId };
};

const startSummaryProcess = errorCatched(async () => {
  const plan = await computeSummaryPlan();
  if (!plan) {
    toastr.warning("当前没有需要总结的楼层。");
    return;
  }
  const confirm = await SillyTavern.callGenericPopup(
    `将总结以下楼层范围：\n\n` +
      `起始楼层：${plan.startFloor}\n` +
      `结束楼层：${plan.endFloor}\n` +
      `条目名称：${escapeHtml(plan.entryName)}\n\n` +
      `未总结消息数：${plan.unsummarizedCount}\n` +
      `继续吗？`,
    SillyTavern.POPUP_TYPE.CONFIRM,
  );
  if (confirm !== SillyTavern.POPUP_RESULT.AFFIRMATIVE) return;
  await executeSummary(plan.startFloor, plan.endFloor, plan.entryName, {
    requireReview: true,
  });
});

const startCustomRangeSummaryProcess = errorCatched(async () => {
  const settings = getSettings();
  const lastId = getLastMessageId();
  if (lastId < 0) {
    toastr.warning("聊天为空，无法生成总结。");
    return;
  }
  const lastSummarized = await getLastSummarizedFloor();
  const suggestedStart = Math.max(0, lastSummarized + 1);
  const suggestedEnd = Math.max(
    suggestedStart,
    lastId - settings.keepFloorCount,
  );
  const suggestedRange = `${suggestedStart}-${suggestedEnd}`;
  const result = await SillyTavern.callGenericPopup(
    `请输入需要总结的楼层范围（当前最后一楼：${lastId}）。\n\n` +
      `推荐范围：${suggestedRange}\n` +
      `格式示例：12-34`,
    SillyTavern.POPUP_TYPE.INPUT,
    suggestedRange,
    {
      rows: 1,
      okButton: "下一步",
      cancelButton: "取消",
    },
  );
  if (typeof result !== "string") return;
  const match = result.trim().match(/^(\d+)\s*-\s*(\d+)$/);
  if (!match) {
    toastr.warning('请输入正确格式的楼层范围，例如 "12-34"。');
    return;
  }
  const startFloor = Number.parseInt(match[1], 10);
  const endFloor = Number.parseInt(match[2], 10);
  const validation = await validateManualSummaryRange(startFloor, endFloor);
  if (!validation.ok) {
    toastr.error(validation.message);
    return;
  }
  const entryName = makeSummaryEntryName(startFloor, endFloor);
  const confirm = await SillyTavern.callGenericPopup(
    `将按指定范围生成总结：\n\n` +
      `起始楼层：${startFloor}\n` +
      `结束楼层：${endFloor}\n` +
      `条目名称：${escapeHtml(entryName)}\n\n` +
      `继续吗？`,
    SillyTavern.POPUP_TYPE.CONFIRM,
  );
  if (confirm !== SillyTavern.POPUP_RESULT.AFFIRMATIVE) return;
  await executeSummary(startFloor, endFloor, entryName, {
    requireReview: true,
  });
});

const executeSummary = errorCatched(
  async (startFloor, endFloor, entryName, { requireReview = false } = {}) => {
    assertCurrent();
    if (!getSettings().enabled) throw new Error("请先启用总结功能");
    showSummaryHint(
      `正在生成总结，请稍候...\n总结范围：${startFloor} - ${endFloor} 楼`,
    );
    try {
      const params = await buildSummaryPromptParams(startFloor, endFloor);
      const aiMessage = await callSummaryApi(params);
      const normalizedAiMessage = normalizeSummaryFormatting(
        stripMarkdownCodeFence(aiMessage),
      );
      const invalidReason = validateSummaryContent(normalizedAiMessage, {
        kind: "总结",
      });
      if (invalidReason) {
        showSummaryHintFor(invalidReason, "error", 4200);
        toastr.error(invalidReason);
        const action = await chooseSummaryFailureAction({
          title: "总结失败",
          message: `${invalidReason}\n\n请选择后续操作：`,
        });
        if (action === "retry") {
          await executeSummary(startFloor, endFloor, entryName, {
            requireReview,
          });
        } else if (action === "review") {
          const result = await SillyTavern.callGenericPopup(
            `总结生成失败，可在下方手动编辑后保存（${escapeHtml(entryName)}）：`,
            SillyTavern.POPUP_TYPE.INPUT,
            normalizedAiMessage || invalidReason,
            {
              rows: 12,
              wide: true,
              okButton: "确定保存",
              cancelButton: "取消",
            },
          );
          if (typeof result === "string") {
            await finalizeSummarySave(entryName, result);
          } else {
            showSummaryHintFor("已取消保存本次总结。", "info", 2200);
            toastr.info("操作已取消。");
          }
        }
        return;
      }
      let contentToSave = normalizedAiMessage;
      if (requireReview) {
        const result = await SillyTavern.callGenericPopup(
          `AI生成的总结（将保存为：${escapeHtml(entryName)}），可在下方编辑：`,
          SillyTavern.POPUP_TYPE.INPUT,
          normalizedAiMessage,
          { rows: 12, wide: true, okButton: "确定保存", cancelButton: "取消" },
        );
        if (typeof result !== "string") {
          showSummaryHintFor("已取消保存本次总结。", "info", 2200);
          toastr.info("操作已取消。");
          return;
        }
        contentToSave = result;
      }
      await finalizeSummarySave(entryName, contentToSave);
    } catch (error) {
      if (error.name === "AbortError") throw error;
      assertCurrent();
      console.error("总结过程中出错:", error);
      const errMsg = formatErrorMessage(error);
      const fullErrorMessage = `总结失败：${errMsg}`;
      showSummaryHintFor(fullErrorMessage, "error", 4200);
      toastr.error(`总结失败: ${errMsg}`);
      const action = await chooseSummaryFailureAction({
        title: "总结失败",
        message: `${fullErrorMessage}\n\n请选择后续操作：`,
      });
      if (action === "retry") {
        await executeSummary(startFloor, endFloor, entryName, {
          requireReview,
        });
      } else if (action === "review") {
        const result = await SillyTavern.callGenericPopup(
          `总结生成失败，可在下方手动编辑后保存（${escapeHtml(entryName)}）：`,
          SillyTavern.POPUP_TYPE.INPUT,
          fullErrorMessage,
          { rows: 12, wide: true, okButton: "确定保存", cancelButton: "取消" },
        );
        if (typeof result === "string") {
          await finalizeSummarySave(entryName, result);
        } else {
          showSummaryHintFor("已取消保存本次总结。", "info", 2200);
          toastr.info("操作已取消。");
        }
      }
    }
  },
);

// ---- 重新生成 ----

const regenerateAndReplaceEntry = errorCatched(async (entryName) => {
  const parsed = parseSummaryEntryName(entryName);
  if (!parsed) {
    toastr.error('条目名不符合"总结x-y楼"格式。');
    return;
  }
  const lastId = getLastMessageId();
  if (lastId < 0) {
    toastr.warning("聊天为空，无法生成。");
    return;
  }
  const { start, end } = parsed;
  if (start > lastId) {
    toastr.error(`条目起始楼层超出当前聊天（最后一楼=${lastId}）。`);
    return;
  }
  const confirm = await SillyTavern.callGenericPopup(
    `将对条目「${escapeHtml(entryName)}」执行重新生成。\n\n` +
      `流程：\n` +
      `1) 提取 ${start}-${Math.min(end, lastId)} 楼的标签内容\n` +
      `2) 发送该条目之前的总结作为上下文（不含该条目及之后的）\n` +
      `3) 调用API生成总结并替换该条目内容\n\n` +
      `继续吗？`,
    SillyTavern.POPUP_TYPE.CONFIRM,
  );
  if (confirm !== SillyTavern.POPUP_RESULT.AFFIRMATIVE) return;
  showSummaryHint(`正在重新生成条目，请稍候...\n目标条目：${entryName}`);
  try {
    const params = await buildRegeneratePromptParams(entryName);
    const aiMessage = await callSummaryApi(params);
    const normalizedAiMessage = normalizeSummaryFormatting(
      stripMarkdownCodeFence(aiMessage),
    );
    const invalidReason = validateSummaryContent(normalizedAiMessage, {
      kind: "总结",
    });
    if (invalidReason) {
      showSummaryHintFor(
        `${invalidReason}\n已打开审查窗口，可手动修正后替换保存。`,
        "error",
        5200,
      );
      toastr.warning(`${invalidReason} 已打开审查窗口，可手动修正后替换保存。`);
    }
    const reviewMessage = invalidReason
      ? `重新生成的总结检测到问题（${escapeHtml(invalidReason)}），但仍可在下方手动修正后替换：`
      : `重新生成的总结（${escapeHtml(entryName)}），可在下方编辑：`;
    const result = await SillyTavern.callGenericPopup(
      reviewMessage,
      SillyTavern.POPUP_TYPE.INPUT,
      normalizedAiMessage,
      { rows: 12, wide: true, okButton: "确定替换", cancelButton: "取消" },
    );
    if (typeof result !== "string") {
      showSummaryHintFor("已取消替换该条目。", "info", 2200);
      toastr.info("操作已取消。");
      return;
    }
    await upsertSummaryEntryByName(entryName, result);
    showSummaryHintFor(`条目已重新生成：${entryName}`, "success", 3200);
    toastr.success(`已重新生成并替换：${entryName}`);
  } catch (error) {
      if (error.name === "AbortError") throw error;
      assertCurrent();
    console.error("重新生成失败:", error);
    const errMsg = formatErrorMessage(error);
    showSummaryHintFor(`重新生成失败：${errMsg}`, "error", 4200);
    toastr.error(`重新生成失败: ${errMsg}`);
  }
});

// ---- 自动触发 ----

const autoTriggerSummary = errorCatched(async () => {
  if (!getSettings().enabled) return;
  const should = await shouldAutoTrigger();
  if (!should) return;
  const settings = getSettings();
  const plan = await computeSummaryPlan();
  if (!plan) return;
  if (settings.autoTriggerConfirm) {
    const confirm = await SillyTavern.callGenericPopup(
      `未总结消息已达 ${plan.unsummarizedCount} 条（触发阈值：${settings.triggerFloorCount}）。\n\n` +
        `是否开始总结 ${plan.startFloor}-${plan.endFloor} 楼？\n` +
        `确认后会在保存前提供结果审查窗口。`,
      SillyTavern.POPUP_TYPE.CONFIRM,
    );
    if (confirm !== SillyTavern.POPUP_RESULT.AFFIRMATIVE) return;
  }
  await executeSummary(plan.startFloor, plan.endFloor, plan.entryName, {
    requireReview: settings.autoTriggerConfirm,
  });
});

// ---- 大总结流程 ----

const executeMegaSummary = errorCatched(
  async (summaryNames, entryName, { requireReview = false } = {}) => {
    assertCurrent();
    if (!getSettings().enabled) throw new Error("请先启用总结功能");
    showSummaryHint(
      `正在生成大总结，请稍候...\n总结条目数：${summaryNames.length}`,
    );
    try {
      const params = await buildMegaSummaryPromptParams(summaryNames);
      const aiMessage = await callMegaSummaryApi(params);
      const normalizedAiMessage = normalizeSummaryFormatting(
        stripMarkdownCodeFence(aiMessage),
      );
      const invalidReason = validateSummaryContent(normalizedAiMessage, {
        kind: "大总结",
      });
      if (invalidReason) {
        showSummaryHintFor(invalidReason, "error", 4200);
        toastr.error(invalidReason);
        const action = await chooseSummaryFailureAction({
          title: "大总结失败",
          message: `${invalidReason}\n\n请选择后续操作：`,
        });
        if (action === "retry") {
          await executeMegaSummary(summaryNames, entryName, { requireReview });
        } else if (action === "review") {
          const result = await SillyTavern.callGenericPopup(
            `大总结生成失败，可在下方手动编辑后保存（${escapeHtml(entryName)}）：`,
            SillyTavern.POPUP_TYPE.INPUT,
            normalizedAiMessage || invalidReason,
            {
              rows: 12,
              wide: true,
              okButton: "确定保存",
              cancelButton: "取消",
            },
          );
          if (typeof result === "string") {
            await finalizeMegaSummarySave(entryName, result, summaryNames);
          } else {
            showSummaryHintFor("已取消保存本次大总结。", "info", 2200);
            toastr.info("操作已取消。");
          }
        }
        return;
      }
      let contentToSave = normalizedAiMessage;
      if (requireReview) {
        const result = await SillyTavern.callGenericPopup(
          `AI生成的大总结（将保存为：${escapeHtml(entryName)}），可在下方编辑：`,
          SillyTavern.POPUP_TYPE.INPUT,
          normalizedAiMessage,
          { rows: 12, wide: true, okButton: "确定保存", cancelButton: "取消" },
        );
        if (typeof result !== "string") {
          showSummaryHintFor("已取消保存本次大总结。", "info", 2200);
          toastr.info("操作已取消。");
          return;
        }
        contentToSave = result;
      }

      await finalizeMegaSummarySave(entryName, contentToSave, summaryNames);
    } catch (error) {
      if (error.name === "AbortError") throw error;
      assertCurrent();
      console.error("大总结过程中出错:", error);
      const errMsg = formatErrorMessage(error);
      const fullErrorMessage = `大总结失败：${errMsg}`;
      showSummaryHintFor(fullErrorMessage, "error", 4200);
      toastr.error(`大总结失败: ${errMsg}`);
      const action = await chooseSummaryFailureAction({
        title: "大总结失败",
        message: `${fullErrorMessage}\n\n请选择后续操作：`,
      });
      if (action === "retry") {
        await executeMegaSummary(summaryNames, entryName, { requireReview });
      } else if (action === "review") {
        const result = await SillyTavern.callGenericPopup(
          `大总结生成失败，可在下方手动编辑后保存（${escapeHtml(entryName)}）：`,
          SillyTavern.POPUP_TYPE.INPUT,
          fullErrorMessage,
          { rows: 12, wide: true, okButton: "确定保存", cancelButton: "取消" },
        );
        if (typeof result === "string") {
          await finalizeMegaSummarySave(entryName, result, summaryNames);
        } else {
          showSummaryHintFor("已取消保存本次大总结。", "info", 2200);
          toastr.info("操作已取消。");
        }
      }
    }
  },
);

const regenerateAndReplaceMegaEntry = errorCatched(async (entryName) => {
  const parsed = parseMegaSummaryEntryName(entryName);
  if (!parsed) {
    toastr.error('条目名不符合"大总结x-y楼"格式。');
    return;
  }

  const summaryNames = await getMegaSummaryMapping(entryName);
  if (!summaryNames || summaryNames.length === 0) {
    toastr.error("未找到该大总结的原始总结条目映射。");
    return;
  }

  const confirm = await SillyTavern.callGenericPopup(
    `将对大总结条目「${escapeHtml(entryName)}」执行重新生成。\n\n` +
      `流程：\n` +
      `1) 提取原始总结条目的内容（共${summaryNames.length}个）\n` +
      `2) 发送该大总结之前的大总结作为上下文（不含该大总结及之后的）\n` +
      `3) 调用API生成大总结并替换该条目内容\n\n` +
      `继续吗？`,
    SillyTavern.POPUP_TYPE.CONFIRM,
  );
  if (confirm !== SillyTavern.POPUP_RESULT.AFFIRMATIVE) return;

  showSummaryHint(`正在重新生成大总结条目，请稍候...\n目标条目：${entryName}`);
  try {
    const params = await buildRegenerateMegaSummaryPromptParams(entryName);
    const aiMessage = await callMegaSummaryApi(params);
    const normalizedAiMessage = normalizeSummaryFormatting(
      stripMarkdownCodeFence(aiMessage),
    );
    const invalidReason = validateSummaryContent(normalizedAiMessage, {
      kind: "大总结",
    });
    if (invalidReason) {
      showSummaryHintFor(
        `${invalidReason}\n已打开审查窗口，可手动修正后替换保存。`,
        "error",
        5200,
      );
      toastr.warning(`${invalidReason} 已打开审查窗口，可手动修正后替换保存。`);
    }
    const reviewMessage = invalidReason
      ? `重新生成的大总结检测到问题（${escapeHtml(invalidReason)}），但仍可在下方手动修正后替换：`
      : `重新生成的大总结（${escapeHtml(entryName)}），可在下方编辑：`;
    const result = await SillyTavern.callGenericPopup(
      reviewMessage,
      SillyTavern.POPUP_TYPE.INPUT,
      normalizedAiMessage,
      { rows: 12, wide: true, okButton: "确定替换", cancelButton: "取消" },
    );
    if (typeof result !== "string") {
      showSummaryHintFor("已取消替换该大总结条目。", "info", 2200);
      toastr.info("操作已取消。");
      return;
    }
    await upsertMegaSummaryEntry(entryName, result, summaryNames);
    showSummaryHintFor(`大总结条目已重新生成：${entryName}`, "success", 3200);
    toastr.success(`已重新生成并替换：${entryName}`);
  } catch (error) {
      if (error.name === "AbortError") throw error;
      assertCurrent();
    console.error("重新生成大总结失败:", error);
    const errMsg = formatErrorMessage(error);
    showSummaryHintFor(`重新生成失败：${errMsg}`, "error", 4200);
    toastr.error(`重新生成失败: ${errMsg}`);
  }
});

export { showSummaryHint, hideSummaryHint, showSummaryHintFor, chooseSummaryFailureAction, SUMMARY_INVALID_PATTERNS, SUMMARY_LAZY_PATTERNS, SUMMARY_HEADER_PATTERN, SUMMARY_WRAPPER_LINE_PATTERNS, stripMarkdownCodeFence, containsMarkdownCodeFence, normalizeSummaryFormatting, validateSummaryContent, finalizeSummarySave, finalizeMegaSummarySave, computeSummaryPlan, shouldAutoTrigger, validateManualSummaryRange, startSummaryProcess, startCustomRangeSummaryProcess, executeSummary, regenerateAndReplaceEntry, autoTriggerSummary, executeMegaSummary, regenerateAndReplaceMegaEntry };
