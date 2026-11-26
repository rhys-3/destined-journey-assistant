// Gemini input escaping for Destined presets (story & discussion modes).
// Transforms only the selected sensitive payload regions inside the merged user
// body produced by 【命定之诗】消息后处理.js, leaving the model head (with
// optional input noise), unselected rule/variable sections, outer output
// contracts/protocols, and model tail untouched.

import { renderTextToImages, IMAGE_ESCAPE_DEFAULTS } from './input-escape-image.js';

export const INPUT_ESCAPE_MODES = Object.freeze(['light', 'heavy', 'image']);
export const INPUT_ESCAPE_LABELS = Object.freeze({
  light: '轻度转义',
  heavy: '重度转义',
  image: '图片转义',
});

export const INPUT_ESCAPE_SECTIONS = Object.freeze([
  'history',
  'world',
  'writing',
  'memory',
  'reference',
  'runtime',
]);

// Order of sections as they appear inside the merged Destined body message.
const BODY_SECTION_ORDER = Object.freeze([
  'world',
  'reference',
  'memory',
  'history',
  'writing',
  'runtime',
]);

export const DEFAULT_INPUT_ESCAPE_SECTIONS = Object.freeze({
  world: true,
  reference: false,
  memory: true,
  history: true,
  writing: true,
  runtime: false,
});

export const DEFAULT_INPUT_ESCAPE_SETTINGS = Object.freeze({
  enabled: false,
  mode: 'light',
  maxThreeImages: false,
  sections: DEFAULT_INPUT_ESCAPE_SECTIONS,
});

export const DEFAULT_GEMINI_LOW_REASONING = true;

export function normalizeGeminiLowReasoning(value) {
  return value !== false;
}

export const ESCAPED_ENVELOPE_OPEN = '<VOID_attached_manuscript';
export const LIGHT_SEPARATOR_NOTE = '<!-- Middle dots (·) between Chinese characters in escaped sections below are reading separators only; omit them and write normal continuous Chinese in your reply. -->';
export const LIGHT_OUTPUT_REMINDER = '[Formatting: Middle dots (·) inserted between Chinese characters in the input are reading separators only. Omit them completely and write normal continuous Chinese in prose, names, and variable fields.]';
export const HEAVY_ENTITY_NOTE = '<!-- Sections below use standard XML numeric character references; reply in normal plain text. -->';
export const HEAVY_OUTPUT_REMINDER = '[Formatting: Sections encoded with XML numeric character references (&#xXXXX;) in the input are normal text; always reply in normal plain text.]';

const LIGHT_SEPARATOR = '·';
const CJK_CHAR_PAIR = /([\u3400-\u9fff\uf900-\ufaff])(?=[\u3400-\u9fff\uf900-\ufaff])/gu;
const CJK_CHAR_SINGLE = /[\u3400-\u9fff\uf900-\ufaff\u{20000}-\u{2fa1f}]/gu;

const OUTPUT_CONTRACT_MARKER = '<VOID_output_contract id="RECORDER_OUTPUT">';
const ROLE_CORE_CLOSE = '</role_core>';
const WORLD_OPEN = '<VOID_world>';
const WORLD_CLOSE = '</VOID_world>';
const REFERENCE_OPEN = '<VOID_reference>';
const REFERENCE_CLOSE = '</VOID_reference>';
const MEMORY_OPEN = '<VOID_memory>';
const MEMORY_CLOSE = '</VOID_memory>';
const HISTORY_OPEN = '<historical_record>';
const HISTORY_CLOSE = '</historical_record>';
const WRITING_OPEN = '<writing_guidance>';
const WRITING_CLOSE = '</writing_guidance>';
const RUNTIME_OPEN = '<VOID_runtime>';
const RUNTIME_CLOSE = '</VOID_runtime>';
const BODY_PROTOCOLS_MARKER = '<VOID_body_protocols';
const OUTPUT_ASSEMBLER_MARKER = '<VOID_output_assembler>';
const OUTPUT_ASSEMBLER_CLOSE = '</VOID_output_assembler>';
const VOID_INFO_PATTERN = /(<VOID_info>)([\s\S]*?)(<\/VOID_info>)/u;

const SECTION_TAG_LABELS = Object.freeze({
  world: '<VOID_world>',
  reference: '<VOID_reference>',
  memory: '<VOID_memory>',
  history: '<historical_record>',
  writing: '<writing_guidance>',
});

function buildImageAttachOpen(sectionKeys) {
  const tags = sectionKeys.map(key => SECTION_TAG_LABELS[key]).filter(Boolean);
  const labelText = tags.length > 1
    ? `${tags.slice(0, -1).join(', ')}, and ${tags.at(-1)}`
    : (tags[0] ?? 'selected');
  return [
    `<VOID_attached_manuscript format="pages" sections="${sectionKeys.join(',')}">`,
    `[The ${labelText} section${tags.length === 1 ? ' follows' : 's follow'} as sequential page images. Treat ${tags.length === 1 ? 'it' : 'them'} as the literal section${tags.length === 1 ? '' : 's'} and reply in normal plain text without referencing images or OCR.]`,
  ].join('\n');
}

const IMAGE_ATTACH_CLOSE = '</VOID_attached_manuscript>';

export function normalizeInputEscapeSections(value) {
  const source = value && typeof value === 'object' ? value : {};
  const normalized = {};
  for (const key of BODY_SECTION_ORDER) {
    normalized[key] = typeof source[key] === 'boolean' ? source[key] : DEFAULT_INPUT_ESCAPE_SECTIONS[key];
  }
  if (!BODY_SECTION_ORDER.some(key => normalized[key])) {
    normalized.history = true;
  }
  return normalized;
}

export function normalizeInputEscapeSettings(value) {
  const source = value && typeof value === 'object' ? value : {};
  const mode = INPUT_ESCAPE_MODES.includes(source.mode) ? source.mode : DEFAULT_INPUT_ESCAPE_SETTINGS.mode;
  return {
    enabled: source.enabled === true,
    mode,
    maxThreeImages: source.maxThreeImages === true,
    sections: normalizeInputEscapeSections(source.sections),
  };
}

/**
 * Inserts a visible middle-dot separator (`·`) between consecutive CJK
 * characters so outer text classifiers cannot normalize/strip it away, while
 * keeping ASCII tags, keys, numbers, punctuation, and whitespace untouched.
 * Idempotent if already applied.
 */
export function encodeLightSeparator(text) {
  const source = String(text ?? '');
  return source.replace(CJK_CHAR_PAIR, `$1${LIGHT_SEPARATOR}`);
}

/**
 * Encodes CJK ideographs into standard XML hexadecimal numeric character
 * references (`&#xXXXX;`), leaving ASCII tags, keys, numbers, punctuation,
 * whitespace, and non-CJK symbols literal. Naturally idempotent because the
 * output is pure ASCII for encoded characters.
 */
export function encodeHeavyCodepoint(text) {
  const source = String(text ?? '');
  return source.replace(CJK_CHAR_SINGLE, ch => `&#x${ch.codePointAt(0).toString(16)};`);
}

function normalizeParts(content) {
  if (typeof content === 'string') return [{ type: 'text', text: content }];
  if (!Array.isArray(content)) return [];
  return content.map(part => structuredClone(part));
}

function isPlainTextPart(part) {
  return part?.type === 'text' && typeof part.text === 'string' && Object.keys(part).every(key => key === 'type' || key === 'text');
}

function compactParts(parts) {
  const result = [];
  for (const part of parts) {
    if (!part) continue;
    if (isPlainTextPart(part)) {
      if (part.text === '') continue;
      if (isPlainTextPart(result.at(-1))) result.at(-1).text += part.text;
      else result.push({ type: 'text', text: part.text });
    } else {
      result.push(structuredClone(part));
    }
  }
  return result;
}

function toMessageContent(parts) {
  const cleaned = compactParts(parts);
  if (cleaned.length === 0) return '';
  return cleaned.every(isPlainTextPart) ? cleaned.map(part => part.text).join('') : cleaned;
}

function findFirstMarker(parts, marker, from = { partIndex: 0, offset: 0 }, before = null) {
  const maxPart = before ? Math.min(before.partIndex, parts.length - 1) : parts.length - 1;
  for (let i = from.partIndex; i <= maxPart; i += 1) {
    const part = parts[i];
    if (part?.type !== 'text' || typeof part.text !== 'string') continue;
    const start = i === from.partIndex ? from.offset : 0;
    const end = before && i === before.partIndex ? before.offset : part.text.length;
    if (start >= end) continue;
    const at = part.text.indexOf(marker, start);
    if (at >= 0 && at + marker.length <= end) return { partIndex: i, offset: at };
  }
  return null;
}

function findLastMarker(parts, marker, before = null, from = null) {
  const maxPart = before ? Math.min(before.partIndex, parts.length - 1) : parts.length - 1;
  const minPart = from ? from.partIndex : 0;
  for (let i = maxPart; i >= minPart; i -= 1) {
    const part = parts[i];
    if (part?.type !== 'text' || typeof part.text !== 'string') continue;
    const limit = before && i === before.partIndex ? before.offset : part.text.length;
    const start = from && i === from.partIndex ? from.offset : 0;
    if (limit <= start) continue;
    const searchIn = part.text.slice(0, limit);
    const at = searchIn.lastIndexOf(marker);
    if (at >= start) return { partIndex: i, offset: at };
  }
  return null;
}

function comparePos(a, b) {
  if (a.partIndex !== b.partIndex) return a.partIndex - b.partIndex;
  return a.offset - b.offset;
}

function advancePos(pos, delta) {
  return { partIndex: pos.partIndex, offset: pos.offset + delta };
}

function sliceParts(parts, start, end) {
  const s = start ?? { partIndex: 0, offset: 0 };
  const e = end ?? { partIndex: parts.length, offset: 0 };
  if (comparePos(s, e) >= 0) return [];
  const out = [];
  for (let i = s.partIndex; i <= Math.min(e.partIndex, parts.length - 1); i += 1) {
    const part = parts[i];
    if (i === e.partIndex && e.offset === 0) break;
    if (part?.type !== 'text' || typeof part.text !== 'string') {
      if (i > s.partIndex || s.offset === 0) out.push(structuredClone(part));
      continue;
    }
    const from = i === s.partIndex ? s.offset : 0;
    const to = i === e.partIndex ? e.offset : part.text.length;
    const text = part.text.slice(from, to);
    if (text) out.push({ ...part, text });
  }
  return out;
}

/**
 * Locates the merged Destined body message and every individual section range
 * (`world`, `reference`, `memory`, `history`, `writing`, `runtime`).
 *
 * Pre-history sections are scanned forward from `</role_core>`; post-history
 * sections are scanned backward from `<VOID_body_protocols>` /
 * `<VOID_output_assembler>`. That converges on `<historical_record>` from both
 * ends so literal XML tags quoted inside chat history never confuse section
 * boundaries.
 */
export function locateDestinedBody(messages) {
  if (!Array.isArray(messages)) return null;
  for (let index = 0; index < messages.length; index += 1) {
    const message = messages[index];
    if (message?.role !== 'user') continue;
    const parts = normalizeParts(message.content);
    const fullText = parts.filter(part => part?.type === 'text').map(part => part.text).join('');
    if (!fullText.includes(OUTPUT_CONTRACT_MARKER) || !fullText.includes(OUTPUT_ASSEMBLER_MARKER)) continue;
    if (fullText.includes(ESCAPED_ENVELOPE_OPEN)) return { index, alreadyEscaped: true };

    const contractPos = findFirstMarker(parts, OUTPUT_CONTRACT_MARKER);
    const roleCoreEnd = contractPos ? findFirstMarker(parts, ROLE_CORE_CLOSE, contractPos) : null;
    if (!roleCoreEnd) continue;
    const afterRoleCore = advancePos(roleCoreEnd, ROLE_CORE_CLOSE.length);

    const worldOpen = findFirstMarker(parts, WORLD_OPEN, afterRoleCore);
    if (!worldOpen) continue;

    const assemblerPos = findLastMarker(parts, OUTPUT_ASSEMBLER_MARKER);
    if (!assemblerPos) continue;
    const assemblerClose = findFirstMarker(parts, OUTPUT_ASSEMBLER_CLOSE, assemblerPos);
    const bodyProtocolsPos = findLastMarker(parts, BODY_PROTOCOLS_MARKER, assemblerPos);
    const tailAnchor = bodyProtocolsPos ?? assemblerPos;

    const runtimeClose = findLastMarker(parts, RUNTIME_CLOSE, tailAnchor, worldOpen);
    if (!runtimeClose || comparePos(runtimeClose, worldOpen) <= 0) continue;
    const sensitiveEnd = advancePos(runtimeClose, RUNTIME_CLOSE.length);
    const runtimeOpen = findLastMarker(parts, RUNTIME_OPEN, runtimeClose, worldOpen);

    // Backward anchors for writing_guidance (keep outer <narrative_reference> wrapper intact in discussion mode)
    const writingSearchBefore = runtimeOpen ?? runtimeClose;
    const writingClose = findLastMarker(parts, WRITING_CLOSE, writingSearchBefore, worldOpen);
    const writingOpen = writingClose ? findLastMarker(parts, WRITING_OPEN, writingClose, worldOpen) : null;
    const writingRangeEnd = writingClose ? advancePos(writingClose, WRITING_CLOSE.length) : null;

    // Forward anchors for world / reference / memory / history start, bounded before writingOpen / runtimeOpen
    const forwardLimit = writingOpen ?? runtimeOpen ?? runtimeClose;
    const worldClose = findFirstMarker(parts, WORLD_CLOSE, advancePos(worldOpen, WORLD_OPEN.length), forwardLimit);
    const afterWorld = worldClose ? advancePos(worldClose, WORLD_CLOSE.length) : advancePos(worldOpen, WORLD_OPEN.length);

    const refOpen = findFirstMarker(parts, REFERENCE_OPEN, afterWorld, forwardLimit);
    const refClose = refOpen ? findFirstMarker(parts, REFERENCE_CLOSE, advancePos(refOpen, REFERENCE_OPEN.length), forwardLimit) : null;
    const afterRef = refClose ? advancePos(refClose, REFERENCE_CLOSE.length) : afterWorld;

    const memOpen = findFirstMarker(parts, MEMORY_OPEN, afterRef, forwardLimit);
    const memClose = memOpen ? findFirstMarker(parts, MEMORY_CLOSE, advancePos(memOpen, MEMORY_OPEN.length), forwardLimit) : null;
    const afterMem = memClose ? advancePos(memClose, MEMORY_CLOSE.length) : afterRef;

    const histOpen = findFirstMarker(parts, HISTORY_OPEN, afterMem, forwardLimit);
    const histClose = histOpen ? findLastMarker(parts, HISTORY_CLOSE, forwardLimit, advancePos(histOpen, HISTORY_OPEN.length)) : null;

    const sectionRanges = {
      world: worldClose ? { start: worldOpen, end: advancePos(worldClose, WORLD_CLOSE.length) } : null,
      reference: refOpen && refClose ? { start: refOpen, end: advancePos(refClose, REFERENCE_CLOSE.length) } : null,
      memory: memOpen && memClose ? { start: memOpen, end: advancePos(memClose, MEMORY_CLOSE.length) } : null,
      history: histOpen && histClose ? { start: histOpen, end: advancePos(histClose, HISTORY_CLOSE.length) } : null,
      writing: writingOpen && writingRangeEnd ? { start: writingOpen, end: writingRangeEnd } : null,
      runtime: runtimeOpen ? { start: runtimeOpen, end: sensitiveEnd } : null,
    };

    return {
      index,
      alreadyEscaped: false,
      parts,
      worldStart: worldOpen,
      sensitiveEnd,
      runtimeOpen,
      imageEnd: writingRangeEnd,
      assemblerEnd: assemblerClose ? advancePos(assemblerClose, OUTPUT_ASSEMBLER_CLOSE.length) : null,
      sectionRanges,
    };
  }
  return null;
}

function escapeVoidInfoInPrefix(prefixParts, encoder = encodeLightSeparator) {
  let touched = false;
  const next = prefixParts.map(part => {
    if (part?.type !== 'text' || typeof part.text !== 'string' || !VOID_INFO_PATTERN.test(part.text)) return part;
    const replaced = part.text.replace(VOID_INFO_PATTERN, (_whole, open, inner, close) => {
      const encoded = encoder(inner);
      if (encoded !== inner) touched = true;
      return `${open}${encoded}${close}`;
    });
    return { ...part, text: replaced };
  });
  return { parts: next, touched };
}

function escapePartsWithEncoder(parts, encoder) {
  let changed = false;
  const mapped = parts.map(part => {
    if (part?.type === 'text' && typeof part.text === 'string') {
      const encoded = encoder(part.text);
      if (encoded !== part.text) changed = true;
      return { ...part, text: encoded };
    }
    return structuredClone(part);
  });
  return { parts: mapped, changed };
}

function escapePartsLight(parts) {
  return escapePartsWithEncoder(parts, encodeLightSeparator);
}

function escapePartsHeavy(parts) {
  return escapePartsWithEncoder(parts, encodeHeavyCodepoint);
}

function allocateStrictBudgets(textSegments, totalBudget) {
  if (textSegments.length === 0) return [];
  if (totalBudget < textSegments.length) {
    throw new Error(`当前选中的转义区段与已有原图共被切分为 ${textSegments.length} 段，剩余图片配额仅 ${totalBudget} 张，无法满足最多 3 张图限制。请关闭三张限制、减少附加原图或调整勾选板块。`);
  }
  const budgets = textSegments.map(() => 1);
  let remaining = totalBudget - textSegments.length;
  while (remaining > 0) {
    let best = 0;
    let bestScore = -1;
    for (let i = 0; i < textSegments.length; i += 1) {
      const score = textSegments[i].length / budgets[i];
      if (score > bestScore) { bestScore = score; best = i; }
    }
    budgets[best] += 1;
    remaining -= 1;
  }
  return budgets;
}

function tokenizePartsForImages(parts) {
  const tokens = [];
  let buffer = '';
  let preservedMedia = 0;
  for (const part of parts) {
    if (part?.type === 'text' && typeof part.text === 'string') {
      buffer += part.text;
    } else if (part) {
      if (buffer.trim()) tokens.push({ kind: 'text', text: buffer.trim() });
      buffer = '';
      tokens.push({ kind: 'media', part: structuredClone(part) });
      preservedMedia += 1;
    }
  }
  if (buffer.trim()) tokens.push({ kind: 'text', text: buffer.trim() });
  return { tokens, preservedMedia };
}

function appendOutputReminder(suffixParts, reminder) {
  if (!reminder) return suffixParts;
  const suffixText = suffixParts.filter(p => p?.type === 'text').map(p => p.text).join('');
  if (suffixText.includes(reminder)) return suffixParts;
  return [...suffixParts, { type: 'text', text: `\n\n${reminder}` }];
}

function buildSectionRangesList(target, selectedSections) {
  const items = [];
  for (const key of BODY_SECTION_ORDER) {
    const range = target.sectionRanges[key];
    if (!range) continue;
    items.push({ key, selected: selectedSections[key] === true, start: range.start, end: range.end });
  }
  return items;
}

/**
 * Rewrites a chat-completion request body according to the active escape mode
 * and selected sections. Returns `{ body, stats }` when applied, or `null`
 * when skipped (disabled, non-Destined request such as summary `generateRaw`,
 * or already escaped).
 */
export function applyInputEscapeToRequest(body, settings, options = {}) {
  const normalized = normalizeInputEscapeSettings(settings);
  if (!normalized.enabled || !body || !Array.isArray(body.messages)) return null;

  const target = locateDestinedBody(body.messages);
  if (!target || target.alreadyEscaped) return null;

  const { index, parts, worldStart, sensitiveEnd } = target;
  const fullText = parts.filter(p => p?.type === 'text').map(p => p.text).join('');
  const rawPrefix = sliceParts(parts, { partIndex: 0, offset: 0 }, worldStart);
  const voidInfoEncoder = normalized.mode === 'heavy' ? encodeHeavyCodepoint : encodeLightSeparator;
  const { parts: prefix, touched: prefixChanged } = escapeVoidInfoInPrefix(rawPrefix, voidInfoEncoder);
  let suffix = sliceParts(parts, sensitiveEnd, { partIndex: parts.length, offset: 0 });

  const sectionItems = buildSectionRangesList(target, normalized.sections);
  const stats = { mode: normalized.mode, pages: 0, totalBytes: 0, preservedMedia: 0 };
  const middle = [];

  if (normalized.mode === 'light' || normalized.mode === 'heavy') {
    const encoder = normalized.mode === 'heavy' ? escapePartsHeavy : escapePartsLight;
    const headNote = normalized.mode === 'heavy' ? HEAVY_ENTITY_NOTE : LIGHT_SEPARATOR_NOTE;
    const tailReminder = normalized.mode === 'heavy' ? HEAVY_OUTPUT_REMINDER : LIGHT_OUTPUT_REMINDER;
    let cursor = worldStart;
    let anySectionChanged = false;
    let noteInserted = fullText.includes(headNote);

    for (const item of sectionItems) {
      if (comparePos(cursor, item.start) < 0) {
        middle.push(...sliceParts(parts, cursor, item.start));
      }
      const sectionParts = sliceParts(parts, item.start, item.end);
      if (item.selected) {
        const { parts: transformed, changed } = encoder(sectionParts);
        if (changed) anySectionChanged = true;
        if (!noteInserted && (changed || prefixChanged)) {
          middle.push({ type: 'text', text: `${headNote}\n` });
          noteInserted = true;
        }
        middle.push(...transformed);
      } else {
        middle.push(...sectionParts);
      }
      cursor = item.end;
    }
    if (comparePos(cursor, sensitiveEnd) < 0) {
      middle.push(...sliceParts(parts, cursor, sensitiveEnd));
    }
    if (!anySectionChanged && !prefixChanged) return null;
    if (!noteInserted) {
      middle.unshift({ type: 'text', text: `${headNote}\n` });
    }
    suffix = appendOutputReminder(suffix, tailReminder);
  } else if (normalized.mode === 'image') {
    const renderImages = options.renderImages ?? renderTextToImages;
    // Group adjacent selected non-runtime sections into contiguous image runs;
    // keep unselected sections verbatim; if `runtime` is selected, light-escape
    // it so structured variable keys and numeric values stay exact.
    const runs = [];
    for (const item of sectionItems) {
      if (item.selected && item.key !== 'runtime') {
        const prev = runs.at(-1);
        if (prev && prev.kind === 'image-group') {
          prev.end = item.end;
          prev.keys.push(item.key);
        } else {
          runs.push({ kind: 'image-group', start: item.start, end: item.end, keys: [item.key] });
        }
      } else if (item.selected && item.key === 'runtime') {
        runs.push({ kind: 'runtime-light', start: item.start, end: item.end, keys: ['runtime'] });
      } else {
        runs.push({ kind: 'plain', start: item.start, end: item.end, keys: [item.key] });
      }
    }

    // Tokenize all image groups upfront so strict maxThreeImages budget is
    // shared globally across every rendered group and existing images.
    const imageGroups = [];
    let totalPreservedInGroups = 0;
    for (const run of runs) {
      if (run.kind !== 'image-group') continue;
      const slice = sliceParts(parts, run.start, run.end);
      const tokenized = tokenizePartsForImages(slice);
      run.tokenized = tokenized;
      totalPreservedInGroups += tokenized.preservedMedia;
      imageGroups.push(run);
    }

    const allTextTokens = imageGroups.flatMap(group => group.tokenized.tokens.filter(t => t.kind === 'text'));
    let strictBudgets = null;
    if (normalized.maxThreeImages && allTextTokens.length > 0) {
      const totalExistingImages = body.messages.reduce((count, message) => {
        const msgParts = normalizeParts(message?.content);
        return count + msgParts.filter(p => p?.type === 'image_url').length;
      }, 0);
      const remainingForText = Math.max(0, 3 - totalExistingImages);
      if (remainingForText <= 0) {
        throw new Error(`当前请求原有图片已达 ${totalExistingImages} 张，无法在最多 3 张图限制下再渲染正文图片。请关闭三张限制或改用轻度／重度转义。`);
      }
      strictBudgets = allocateStrictBudgets(allTextTokens.map(t => t.text), remainingForText);
    }

    const hasMultipleGroupsOrMedia = imageGroups.length > 1 || totalPreservedInGroups > 0;
    let cursor = worldStart;
    let textTokenIndex = 0;
    let usedLightFallback = false;

    for (const run of runs) {
      if (comparePos(cursor, run.start) < 0) {
        middle.push(...sliceParts(parts, cursor, run.start));
      }
      if (run.kind === 'plain') {
        middle.push(...sliceParts(parts, run.start, run.end));
      } else if (run.kind === 'runtime-light') {
        const runtimeSlice = sliceParts(parts, run.start, run.end);
        const { parts: escapedRuntime, changed } = escapePartsLight(runtimeSlice);
        if (changed) usedLightFallback = true;
        middle.push(...escapedRuntime);
      } else if (run.kind === 'image-group') {
        const renderedParts = [];
        for (const token of run.tokenized.tokens) {
          if (token.kind === 'media') {
            renderedParts.push(token.part);
            continue;
          }
          const strictMaxPages = strictBudgets ? strictBudgets[textTokenIndex] : undefined;
          textTokenIndex += 1;
          const rendered = renderImages(token.text, {
            ...IMAGE_ESCAPE_DEFAULTS,
            host: options.host,
            ...options.imageOptions,
            ...(strictMaxPages ? { strictMaxPages } : {}),
            showTotal: !hasMultipleGroupsOrMedia,
            pageOffset: stats.pages,
            bytesSoFar: stats.totalBytes,
          });
          for (const page of rendered) {
            renderedParts.push({ type: 'image_url', image_url: { url: page.dataUrl } });
            stats.pages += 1;
            stats.totalBytes += page.bytes ?? page.dataUrl.length;
          }
        }
        stats.preservedMedia += run.tokenized.preservedMedia;
        if (renderedParts.length > 0) {
          middle.push(
            { type: 'text', text: `${buildImageAttachOpen(run.keys)}\n` },
            ...renderedParts,
            { type: 'text', text: `\n${IMAGE_ATTACH_CLOSE}` },
          );
        } else {
          middle.push(...sliceParts(parts, run.start, run.end));
        }
      }
      cursor = run.end;
    }
    if (comparePos(cursor, sensitiveEnd) < 0) {
      middle.push(...sliceParts(parts, cursor, sensitiveEnd));
    }

    if (stats.pages === 0 && !usedLightFallback && !prefixChanged) return null;
    if (usedLightFallback || prefixChanged) {
      suffix = appendOutputReminder(suffix, LIGHT_OUTPUT_REMINDER);
    }
  } else {
    return null;
  }

  const nextContent = toMessageContent([...prefix, ...middle, ...suffix]);
  const nextMessages = body.messages.map((message, position) => (position === index ? { ...message, content: nextContent } : message));
  return {
    body: { ...body, messages: nextMessages },
    stats,
  };
}

/**
 * Applies Gemini transport overrides (`reasoning_effort: 'low'` and optional
 * input escaping) to a Destined story or discussion request. Non-Destined
 * requests (such as summary `generateRaw`) are always skipped.
 */
export function applyGeminiRequestTransforms(body, {
  escapeSettings,
  lowReasoning = DEFAULT_GEMINI_LOW_REASONING,
} = {}, options = {}) {
  if (!body || !Array.isArray(body.messages)) return null;
  const target = locateDestinedBody(body.messages);
  if (!target) return null;

  let nextBody = body;
  let changed = false;
  const stats = { lowReasoning: false, mode: null, pages: 0, totalBytes: 0, preservedMedia: 0 };

  if (normalizeGeminiLowReasoning(lowReasoning) && nextBody.reasoning_effort !== 'low') {
    nextBody = { ...nextBody, reasoning_effort: 'low' };
    changed = true;
    stats.lowReasoning = true;
  }

  const escaped = applyInputEscapeToRequest(nextBody, escapeSettings, options);
  if (escaped) {
    nextBody = escaped.body;
    changed = true;
    Object.assign(stats, escaped.stats);
  }

  return changed ? { body: nextBody, stats } : null;
}

export function createInputEscape(ctx) {
  let error = '';
  let reasoningError = '';
  let disposed = false;

  const settings = () => normalizeInputEscapeSettings(ctx.state.config.input_escape);
  const lowReasoning = () => normalizeGeminiLowReasoning(ctx.state.config.gemini_low_reasoning);
  const supported = () => ctx.presetIsMine(ctx.state.preset) && ctx.detectModelAdapter() === 'Gemini';
  const render = () => { if (!disposed && !ctx.destroyed) ctx.renderActiveContent?.(true); };

  function readInputEscapeControl() {
    const value = settings();
    return {
      ...value,
      supported: supported(),
      error,
    };
  }

  function readGeminiReasoningControl() {
    return {
      enabled: lowReasoning(),
      supported: supported(),
      error: reasoningError,
    };
  }

  async function setGeminiLowReasoning(enabled) {
    if (ctx.state.workspaceBusy) throw new Error('上一项设置尚未保存，请稍候。');
    if (!supported()) throw new Error('该设置仅在 Gemini 适配时生效，请先切换到 Gemini 适配。');
    if (typeof enabled !== 'boolean') throw new Error('推理强度开关格式无效。');

    const origin = ctx.workspaceContextKey();
    const guard = () => !disposed && !ctx.destroyed && ctx.workspaceContextKey() === origin && supported();
    reasoningError = '';
    const task = ctx.enqueueScriptConfigSave('Gemini 低推理强度', 'gemini-low-reasoning', guard, config => {
      config.gemini_low_reasoning = enabled;
    });
    render();
    return task.catch(failure => {
      if (guard()) {
        reasoningError = failure.message ?? String(failure);
        render();
      }
      throw failure;
    });
  }

  async function setInputEscapeSetting(field, value) {
    if (ctx.state.workspaceBusy) throw new Error('上一项设置尚未保存，请稍候。');
    if (!supported()) throw new Error('输入转义仅在 Gemini 适配时生效，请先切换到 Gemini 适配。');
    if (field === 'enabled' && typeof value !== 'boolean') throw new Error('输入转义开关格式无效。');
    if (field === 'maxThreeImages' && typeof value !== 'boolean') throw new Error('三张图上限开关格式无效。');
    if (field === 'mode' && !INPUT_ESCAPE_MODES.includes(value)) throw new Error('不支持的输入转义档位。');
    if (!['enabled', 'mode', 'maxThreeImages'].includes(field)) throw new Error('不支持的输入转义设置。');

    const origin = ctx.workspaceContextKey();
    const guard = () => !disposed && !ctx.destroyed && ctx.workspaceContextKey() === origin && supported();
    const next = { ...settings(), [field]: value };
    error = '';
    const task = ctx.enqueueScriptConfigSave('Gemini 输入转义', 'input-escape', guard, config => {
      config.input_escape = next;
    });
    render();
    return task.catch(failure => {
      if (guard()) {
        error = failure.message ?? String(failure);
        render();
      }
      throw failure;
    });
  }

  async function setInputEscapeSection(section, enabled) {
    if (ctx.state.workspaceBusy) throw new Error('上一项设置尚未保存，请稍候。');
    if (!supported()) throw new Error('输入转义仅在 Gemini 适配时生效，请先切换到 Gemini 适配。');
    if (!INPUT_ESCAPE_SECTIONS.includes(section)) throw new Error('不支持的输入转义板块。');
    if (typeof enabled !== 'boolean') throw new Error('转义板块开关格式无效。');

    const current = settings();
    const nextSections = { ...current.sections, [section]: enabled };
    if (!INPUT_ESCAPE_SECTIONS.some(key => nextSections[key])) {
      const failure = new Error('至少需保留一个转义板块；如不需要转义，请关闭上方总开关。');
      error = failure.message;
      render();
      throw failure;
    }

    const origin = ctx.workspaceContextKey();
    const guard = () => !disposed && !ctx.destroyed && ctx.workspaceContextKey() === origin && supported();
    const next = { ...current, sections: nextSections };
    error = '';
    const task = ctx.enqueueScriptConfigSave('Gemini 输入转义范围', 'input-escape', guard, config => {
      config.input_escape = next;
    });
    render();
    return task.catch(failure => {
      if (guard()) {
        error = failure.message ?? String(failure);
        render();
      }
      throw failure;
    });
  }

  function transformOutgoingRequest(body) {
    if (disposed || ctx.destroyed) return null;
    if (!supported()) return null;
    const host = typeof window !== 'undefined' ? (window.parent ?? window) : globalThis;
    return applyGeminiRequestTransforms(body, {
      escapeSettings: settings(),
      lowReasoning: lowReasoning(),
    }, { host });
  }

  function disposeInputEscape() {
    disposed = true;
  }

  return {
    readInputEscapeControl,
    readGeminiReasoningControl,
    setGeminiLowReasoning,
    setInputEscapeSetting,
    setInputEscapeSection,
    transformOutgoingRequest,
    disposeInputEscape,
  };
}
