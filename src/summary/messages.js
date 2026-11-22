import { errorCatched } from './errorHandler.js';
import { expandIdentityMacros } from '../platform/identity-macros.js';
import { isDiscussionMessage } from '../discussion/protocol.js';
import { omitRanges, scanTaggedText } from './taggedText.js';
/**
 * messages.js
 * 聊天消息的提取、标签过滤、合并处理
 * 依赖: taggedText.js, errorHandler.js
 */

const replaceMacros = (text) => {
  if (!text || typeof text !== "string") return text || "";
  return expandIdentityMacros(text);
};

const getRawMessages = errorCatched(async (startFloor, endFloor) => {
  const lastId = getLastMessageId();
  if (lastId < 0) return [];
  const s = Math.max(0, startFloor);
  const e = Math.min(lastId, endFloor);
  if (s > e) return [];
  const msgs = getChatMessages(`${s}-${e}`, {
    role: "all",
    hide_state: "all",
    include_swipes: false,
  });
  return msgs.map((m) => ({
    id: m.message_id,
    role: m.role,
    name: m.name,
    message: m.message,
    swipe_id: m.swipe_id ?? null,
    extra: structuredClone(m.extra ?? {}),
  }));
});

const getAllRawMessages = errorCatched(async () => {
  const lastId = getLastMessageId();
  if (lastId < 0) return [];
  return await getRawMessages(0, lastId);
});

const getDiscussionMessageIds = errorCatched(async () =>
  (await getAllRawMessages()).filter(isSummaryDiscussion).map(message => message.id),
);

const discussionTags = new Set(['discussion_record', 'destined_discussion']);
const reasoningTags = new Set(['recorder_thinking', 'thinking', 'think', 'archive_plan']);
const executableTags = new Set(['script', 'style']);
const recorderShells = new Set(['recorder_output', 'recorder_body', 'recorder_after_format', 'recorder_done']);
const tagSet = names => new Set((names ?? []).map(name => name.trim().toLowerCase()));

export function isSummaryDiscussion(message) {
  if (isDiscussionMessage(message)) return true;
  if (message?.role === 'user') return false;
  const text = removeHtmlComments(message?.message ?? '');
  if (!/^<(?:discussion_record|destined_discussion)(?=[\s>])/i.test(text)) return false;
  const [first] = scanTaggedText(text).sections;
  return discussionTags.has(first?.name) && first.closeStart !== undefined && first.end === text.length;
}

function stripLeadingReasoning(text, includeTags) {
  const { sections, tokens } = scanTaggedText(text);
  const firstIndex = tokens.findIndex(token => reasoningTags.has(token.name));
  const first = tokens[firstIndex];
  if (!first?.orphan) return text;
  const enclosed = sections.some(section => section.start < first.start && section.end >= first.end && !recorderShells.has(section.name));
  if (enclosed) return text;

  let end = first.end, nextIndex = firstIndex + 1;
  while (tokens[nextIndex]?.orphan && reasoningTags.has(tokens[nextIndex].name) && !text.slice(end, tokens[nextIndex].start).trim()) {
    end = tokens[nextIndex].end;
    nextIndex++;
  }
  const prefix = omitRanges(text.slice(0, first.start), tokens.slice(0, firstIndex).filter(token => recorderShells.has(token.name))).trim();
  const next = tokens[nextIndex];
  const atBody = next && !next.closing && !text.slice(end, next.start).trim() &&
    (next.name === 'recorder_body' || tagSet(includeTags).has(next.name));
  return !prefix || atBody ? text.slice(end) : text;
}

const extractTagContent = (text, tagNames) => {
  if (!text || !tagNames?.length) return { matched: false, content: '' };
  const include = tagSet(tagNames);
  const { sections } = scanTaggedText(text);
  const results = [];
  let selectedEnd = 0, hiddenEnd = 0;
  for (const section of sections) {
    if (reasoningTags.has(section.name) || discussionTags.has(section.name)) hiddenEnd = Math.max(hiddenEnd, section.end);
    if (section.start < selectedEnd || section.start < hiddenEnd || executableTags.has(section.name) || !include.has(section.name) || (section.closeStart === undefined && !section.selfClosing)) continue;
    const content = text.slice(section.openEnd, section.closeStart ?? section.openEnd).trim();
    if (content) results.push(content);
    selectedEnd = section.end;
  }
  return { matched: selectedEnd > 0, content: results.join("\n") };
};

const excludeTagContent = (text, tagNames) => {
  if (!text || !tagNames || tagNames.length === 0) return text || "";
  const exclude = tagSet(tagNames);
  const { sections } = scanTaggedText(text);
  return omitRanges(text, sections.filter(section => exclude.has(section.name) && !section.htmlSummary)).trim();
};

function cleanFallback(text, excludeTags) {
  const { sections } = scanTaggedText(text);
  let contentEnd = 0;
  const technical = sections.filter(section => {
    if (reasoningTags.has(section.name)) return section.start >= contentEnd;
    if (section.closeStart !== undefined && !recorderShells.has(section.name)) contentEnd = Math.max(contentEnd, section.end);
    return false;
  });
  const cleaned = excludeTagContent(omitRanges(text, technical), excludeTags);
  return omitRanges(cleaned, scanTaggedText(cleaned).tokens.filter(token => recorderShells.has(token.name))).trim();
}

const removeHtmlComments = (text) => {
  if (!text) return text || "";
  return text.replace(/<!--[\s\S]*?(?:-->|$)/g, "").trim();
};

const processMessagesByTags = (
  messages,
  includeTags,
  excludeTags,
  excludeHtmlComments,
) => {
  const results = [];
  for (const msg of messages) {
    if (isSummaryDiscussion(msg)) continue;
    let content = msg.message || "";
    if (msg.role !== 'user') {
      if (excludeHtmlComments) content = removeHtmlComments(content);
      if (/<(?:style|script)\b/i.test(content)) content = excludeTagContent(content, ['style', 'script']);
      content = stripLeadingReasoning(content, includeTags);
      const extracted = extractTagContent(content, includeTags);
      content = extracted.matched ? excludeTagContent(extracted.content, excludeTags) : cleanFallback(content, excludeTags);
    }
    if (!content.trim()) continue;
    results.push({
      id: msg.id,
      role: msg.role,
      name: msg.name,
      content: content.trim(),
    });
  }
  return results;
};

const messagesToMergedText = (
  processedMessages,
  userPrefix = "{{user}}",
  assistantPrefix = "AI",
) => {
  const resolvedUserPrefix = replaceMacros(userPrefix);
  const resolvedAssistantPrefix = replaceMacros(assistantPrefix);
  const lines = [];
  for (const msg of processedMessages) {
    const speaker = msg.name?.trim();
    const assistantLabel = [resolvedAssistantPrefix, speaker !== resolvedAssistantPrefix.trim() ? speaker : ''].filter(Boolean).join(' · ');
    const label = msg.role === 'user'
      ? `用户输入（意图，未必实现） · ${resolvedUserPrefix}`
      : msg.role === 'assistant' ? `${msg.id === 0 ? '开局 · ' : ''}AI 正文（实际剧情）` + (assistantLabel ? ` · ${assistantLabel}` : '') : '系统消息（补充材料）';
    lines.push(`[第 ${msg.id} 楼 · ${label}]\n${msg.content}`);
  }
  return lines.join("\n\n");
};

const getRawChatTextForScan = errorCatched(async (startFloor, endFloor) => {
  const msgs = await getRawMessages(startFloor, endFloor);
  return msgs.filter(message => !isSummaryDiscussion(message)).map((m) => m.message).join("\n");
});

export { replaceMacros, getRawMessages, getAllRawMessages, getDiscussionMessageIds, extractTagContent, excludeTagContent, removeHtmlComments, processMessagesByTags, messagesToMergedText, getRawChatTextForScan };
