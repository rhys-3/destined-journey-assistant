import { errorCatched } from './errorHandler.js';
import { DEFAULT_MEGA_SUMMARY_PROMPT_BLOCKS } from './config.js';
import { parseSummaryEntryName } from './utils.js';
import { getSettings, getMegaSummaryMapping } from './storage.js';
import { getRawMessages, processMessagesByTags, messagesToMergedText, getRawChatTextForScan } from './messages.js';
import { getWorldbookEntriesSafe, getAllSummaryContents, getSummaryContentsBefore, getAllMegaSummaryEntriesForDisplay, getMegaSummaryContentsBefore } from './worldbook.js';
/**
 * prompt.js
 * 总结提示词参数构建
 * 依赖: storage.js, messages.js, worldbook.js, errorHandler.js
 */

const buildSummaryPromptParams = errorCatched(async (startFloor, endFloor) => {
  const settings = getSettings();
  const rawMsgs = await getRawMessages(startFloor, endFloor);
  const processed = processMessagesByTags(rawMsgs, settings.includeTags, settings.excludeTags, settings.excludeHtmlComments);
  if (processed.length === 0) {
    throw new Error(`楼层 ${startFloor}-${endFloor} 中没有提取到任何有效内容`);
  }
  const mergedChatText = messagesToMergedText(
    processed,
    settings.userPrefix,
    settings.assistantPrefix
  );
  let oldSummaryContent = '';
  if (settings.includeOldSummary) {
    const allSummaries = await getAllSummaryContents();
    if (allSummaries.length > 0) {
      oldSummaryContent = allSummaries
        .map((s) => `[${s.name}]\n${s.content}`)
        .join('\n\n');
    }
  }
  const scanText = await getRawChatTextForScan(startFloor, endFloor);
  return {
    promptBlocks: settings.promptBlocks || [],
    oldSummaryContent,
    mergedChatText,
    scanText,
  };
});

const buildRegeneratePromptParams = errorCatched(async (entryName) => {
  const settings = getSettings();
  const parsed = parseSummaryEntryName(entryName);
  if (!parsed) throw new Error('条目名不符合"总结x-y楼"格式');
  const { start, end } = parsed;
  const lastId = getLastMessageId();
  const actualEnd = Math.min(end, lastId);
  const rawMsgs = await getRawMessages(start, actualEnd);
  const processed = processMessagesByTags(rawMsgs, settings.includeTags, settings.excludeTags, settings.excludeHtmlComments);
  if (processed.length === 0) {
    throw new Error(`楼层 ${start}-${actualEnd} 中没有提取到任何有效内容`);
  }
  const mergedChatText = messagesToMergedText(
    processed,
    settings.userPrefix,
    settings.assistantPrefix
  );
  let oldSummaryContent = '';
  if (settings.includeOldSummary) {
    const beforeSummaries = await getSummaryContentsBefore(entryName);
    if (beforeSummaries.length > 0) {
      oldSummaryContent = beforeSummaries
        .map((s) => `[${s.name}]\n${s.content}`)
        .join('\n\n');
    }
  }
  const scanText = await getRawChatTextForScan(start, actualEnd);
  return {
    promptBlocks: settings.promptBlocks || [],
    oldSummaryContent,
    mergedChatText,
    scanText,
  };
});

const buildMegaSummaryPromptParams = errorCatched(async (summaryNames, entryName = null) => {
  const settings = getSettings();
  
  // 获取所有要大总结的总结条目内容
  const entries = await getWorldbookEntriesSafe();
  const summaryContents = [];
  for (const name of summaryNames) {
    const entry = entries.find((e) => e && e.name === name);
    if (entry && entry.content) {
      summaryContents.push(`[${name}]\n${entry.content}`);
    }
  }
  
  if (summaryContents.length === 0) {
    throw new Error('没有找到任何有效的总结条目内容');
  }
  
  const mergedSummaryText = summaryContents.join('\n\n');
  
  // 获取已有的大总结内容（如果是重新生成）
  let oldMegaSummaryContent = '';
  if (entryName) {
    const beforeMegaSummaries = await getMegaSummaryContentsBefore(entryName);
    if (beforeMegaSummaries.length > 0) {
      oldMegaSummaryContent = beforeMegaSummaries
        .map((s) => `[${s.name}]\n${s.content}`)
        .join('\n\n');
    }
  } else {
    // 如果不是重新生成，获取所有已有的大总结
    const allMegaSummaries = await getAllMegaSummaryEntriesForDisplay();
    const megaContents = [];
    for (const mega of allMegaSummaries) {
      if (mega.disabled) continue;
      const entry = entries.find((e) => e && e.name === mega.name);
      if (entry && entry.content) {
        megaContents.push(`[${mega.name}]\n${entry.content}`);
      }
    }
    if (megaContents.length > 0) {
      oldMegaSummaryContent = megaContents.join('\n\n');
    }
  }
  
  return {
    promptBlocks: settings.megaPromptBlocks || DEFAULT_MEGA_SUMMARY_PROMPT_BLOCKS || [],
    oldMegaSummaryContent,
    mergedSummaryText,
  };
});

const buildRegenerateMegaSummaryPromptParams = errorCatched(async (entryName) => {
  const summaryNames = await getMegaSummaryMapping(entryName);
  if (!summaryNames || summaryNames.length === 0) {
    throw new Error('未找到该大总结的原始总结条目映射');
  }
  
  return await buildMegaSummaryPromptParams(summaryNames, entryName);
});

export { buildSummaryPromptParams, buildRegeneratePromptParams, buildMegaSummaryPromptParams, buildRegenerateMegaSummaryPromptParams };
