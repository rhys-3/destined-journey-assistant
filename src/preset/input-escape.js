// Gemini input escaping for Destined presets (story & discussion modes).
// Transforms only the sensitive payload regions inside the merged user body
// produced by 【命定之诗】消息后处理.js, leaving the model head (with optional
// input noise), outer output contracts/protocols, and model tail untouched.

import { renderTextToImages, IMAGE_ESCAPE_DEFAULTS } from './input-escape-image.js';

export const INPUT_ESCAPE_MODES = Object.freeze(['light', 'heavy', 'image']);
export const INPUT_ESCAPE_LABELS = Object.freeze({
  light: '轻度转义',
  heavy: '重度转义',
  image: '图片转义',
});
export const DEFAULT_INPUT_ESCAPE_SETTINGS = Object.freeze({
  enabled: false,
  mode: 'light',
  maxThreeImages: false,
});

export const DEFAULT_GEMINI_LOW_REASONING = true;

export function normalizeGeminiLowReasoning(value) {
  return value !== false;
}

export const ESCAPED_ENVELOPE_OPEN = '<VOID_attached_manuscript';
export const HEAVY_ENTITY_NOTE = '<!-- Sections below use standard XML numeric character references; reply in normal plain text. -->';
const LIGHT_SEPARATOR = '·';
const CJK_CHAR_PAIR = /([\u3400-\u9fff\uf900-\ufaff])(?=[\u3400-\u9fff\uf900-\ufaff])/gu;
const CJK_CHAR_SINGLE = /[\u3400-\u9fff\uf900-\ufaff\u{20000}-\u{2fa1f}]/gu;
const OUTPUT_CONTRACT_MARKER = '<VOID_output_contract id="RECORDER_OUTPUT">';
const ROLE_CORE_CLOSE = '</role_core>';
const WORLD_OPEN = '<VOID_world>';
const WRITING_CLOSE = '</writing_guidance>';
const NARRATIVE_REF_CLOSE = '</narrative_reference>';
const RUNTIME_OPEN = '<VOID_runtime>';
const RUNTIME_CLOSE = '</VOID_runtime>';
const BODY_PROTOCOLS_MARKER = '<VOID_body_protocols';
const OUTPUT_ASSEMBLER_MARKER = '<VOID_output_assembler>';
const VOID_INFO_PATTERN = /(<VOID_info>)([\s\S]*?)(<\/VOID_info>)/u;

// Neutral, non-confrontational framing: benchmarked on Gemini 4 to avoid
// triggering anti-manipulation refusals while keeping native reasoning minimal.
const IMAGE_ATTACH_OPEN = [
  '<VOID_attached_manuscript format="pages">',
  '[The <VOID_world>, <VOID_reference>, <VOID_memory>, <historical_record>, and <writing_guidance> sections follow as sequential page images. Treat them as the literal sections and reply in normal plain text without referencing images or OCR.]',
].join('\n');

const IMAGE_ATTACH_CLOSE = '</VOID_attached_manuscript>';

export function normalizeInputEscapeSettings(value) {
  const source = value && typeof value === 'object' ? value : {};
  const mode = INPUT_ESCAPE_MODES.includes(source.mode) ? source.mode : DEFAULT_INPUT_ESCAPE_SETTINGS.mode;
  return {
    enabled: source.enabled === true,
    mode,
    maxThreeImages: source.maxThreeImages === true,
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

function findFirstMarker(parts, marker, from = { partIndex: 0, offset: 0 }) {
  for (let i = from.partIndex; i < parts.length; i += 1) {
    const part = parts[i];
    if (part?.type !== 'text' || typeof part.text !== 'string') continue;
    const start = i === from.partIndex ? from.offset : 0;
    const at = part.text.indexOf(marker, start);
    if (at >= 0) return { partIndex: i, offset: at };
  }
  return null;
}

function findLastMarker(parts, marker, before = null) {
  const maxPart = before ? before.partIndex : parts.length - 1;
  for (let i = maxPart; i >= 0; i -= 1) {
    const part = parts[i];
    if (part?.type !== 'text' || typeof part.text !== 'string') continue;
    const searchIn = before && i === before.partIndex ? part.text.slice(0, before.offset) : part.text;
    const at = searchIn.lastIndexOf(marker);
    if (at >= 0) return { partIndex: i, offset: at };
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
 * Locates the merged Destined body message and its Option-A escape boundaries.
 * Anchors after </role_core> (avoiding discussion-mode <material_scope>
 * references to <VOID_world>) and before <VOID_body_protocols> / <VOID_output_assembler>.
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
    const worldStart = findFirstMarker(parts, WORLD_OPEN, advancePos(roleCoreEnd, ROLE_CORE_CLOSE.length));
    if (!worldStart) continue;

    const assemblerPos = findLastMarker(parts, OUTPUT_ASSEMBLER_MARKER);
    if (!assemblerPos) continue;
    const bodyProtocolsPos = findLastMarker(parts, BODY_PROTOCOLS_MARKER, assemblerPos);
    const tailAnchor = bodyProtocolsPos ?? assemblerPos;

    const runtimeClose = findLastMarker(parts, RUNTIME_CLOSE, tailAnchor);
    if (!runtimeClose || comparePos(runtimeClose, worldStart) <= 0) continue;
    const sensitiveEnd = advancePos(runtimeClose, RUNTIME_CLOSE.length);

    const runtimeOpen = findLastMarker(parts, RUNTIME_OPEN, runtimeClose);
    let imageEnd = null;
    if (runtimeOpen && comparePos(runtimeOpen, worldStart) > 0) {
      const writingClose = findLastMarker(parts, WRITING_CLOSE, runtimeOpen);
      if (writingClose && comparePos(writingClose, worldStart) > 0) {
        imageEnd = advancePos(writingClose, WRITING_CLOSE.length);
        const refClose = findFirstMarker(parts, NARRATIVE_REF_CLOSE, imageEnd);
        if (refClose && comparePos(refClose, runtimeOpen) < 0) {
          const between = sliceParts(parts, imageEnd, refClose).filter(p => p.type === 'text').map(p => p.text).join('');
          if (/^\s*$/u.test(between)) imageEnd = advancePos(refClose, NARRATIVE_REF_CLOSE.length);
        }
      }
    }

    return {
      index,
      alreadyEscaped: false,
      parts,
      worldStart,
      sensitiveEnd,
      runtimeOpen: runtimeOpen && comparePos(runtimeOpen, worldStart) > 0 ? runtimeOpen : null,
      imageEnd,
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
    throw new Error(`当前消息中已有原图将正文分为 ${textSegments.length} 段，剩余图片配额仅 ${totalBudget} 张，无法满足最多 3 张图限制。请关闭三张限制或减少附加原图。`);
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

function renderPartsAsImages(parts, renderImages, imageOptions = {}, maxTotalImages = null) {
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

  const textTokens = tokens.filter(token => token.kind === 'text');
  const hasInterleavedMedia = preservedMedia > 0;
  let strictBudgets = null;
  if (Number.isInteger(maxTotalImages) && maxTotalImages > 0 && textTokens.length > 0) {
    const remainingForText = maxTotalImages - preservedMedia;
    if (remainingForText <= 0) {
      throw new Error(`当前请求原有图片已达 ${preservedMedia} 张，无法在最多 ${maxTotalImages} 张图限制下再渲染正文图片。请关闭三张限制或改用轻度转义。`);
    }
    strictBudgets = allocateStrictBudgets(textTokens.map(t => t.text), remainingForText);
  }

  const output = [];
  const stats = { pages: 0, totalBytes: 0, preservedMedia };
  let textIndex = 0;
  for (const token of tokens) {
    if (token.kind === 'media') {
      output.push(token.part);
      continue;
    }
    const strictMaxPages = strictBudgets ? strictBudgets[textIndex] : undefined;
    textIndex += 1;
    const rendered = renderImages(token.text, {
      ...imageOptions,
      ...(strictMaxPages ? { strictMaxPages } : {}),
      showTotal: !hasInterleavedMedia,
      pageOffset: stats.pages,
      bytesSoFar: stats.totalBytes,
    });
    for (const page of rendered) {
      output.push({ type: 'image_url', image_url: { url: page.dataUrl } });
      stats.pages += 1;
      stats.totalBytes += page.bytes ?? page.dataUrl.length;
    }
  }
  return { parts: output, stats };
}

/**
 * Rewrites a chat-completion request body according to the active escape mode.
 * Returns `{ body, stats }` when applied, or `null` when skipped (disabled,
 * non-Destined request such as summary `generateRaw`, or already escaped).
 */
export function applyInputEscapeToRequest(body, settings, options = {}) {
  const normalized = normalizeInputEscapeSettings(settings);
  if (!normalized.enabled || !body || !Array.isArray(body.messages)) return null;

  const target = locateDestinedBody(body.messages);
  if (!target || target.alreadyEscaped) return null;

  const { index, parts, worldStart, sensitiveEnd, runtimeOpen, imageEnd } = target;
  const rawPrefix = sliceParts(parts, { partIndex: 0, offset: 0 }, worldStart);
  const voidInfoEncoder = normalized.mode === 'heavy' ? encodeHeavyCodepoint : encodeLightSeparator;
  const { parts: prefix, touched: prefixChanged } = escapeVoidInfoInPrefix(rawPrefix, voidInfoEncoder);
  const suffix = sliceParts(parts, sensitiveEnd, { partIndex: parts.length, offset: 0 });

  let escapedMiddle = [];
  const stats = { mode: normalized.mode, pages: 0, totalBytes: 0, preservedMedia: 0 };

  if (normalized.mode === 'light') {
    const sensitive = sliceParts(parts, worldStart, sensitiveEnd);
    const { parts: transformed, changed } = escapePartsLight(sensitive);
    if (!changed && !prefixChanged) return null;
    escapedMiddle = transformed;
  } else if (normalized.mode === 'heavy') {
    const sensitive = sliceParts(parts, worldStart, sensitiveEnd);
    const { parts: transformed, changed } = escapePartsHeavy(sensitive);
    if (!changed && !prefixChanged) return null;
    const prefixText = prefix.filter(p => p?.type === 'text').map(p => p.text).join('');
    const alreadyNoted = prefixText.includes(HEAVY_ENTITY_NOTE);
    escapedMiddle = alreadyNoted
      ? transformed
      : [{ type: 'text', text: `${HEAVY_ENTITY_NOTE}\n` }, ...transformed];
  } else if (normalized.mode === 'image') {
    const renderImages = options.renderImages ?? renderTextToImages;
    const imageRegionEnd = imageEnd ?? runtimeOpen ?? sensitiveEnd;
    const mainSensitive = sliceParts(parts, worldStart, imageRegionEnd);
    const runtimeSensitive = comparePos(imageRegionEnd, sensitiveEnd) < 0
      ? sliceParts(parts, imageRegionEnd, sensitiveEnd)
      : [];

    const existingOuterImages = body.messages.reduce((count, message, msgIndex) => {
      const msgParts = normalizeParts(message?.content);
      if (msgIndex !== index) return count + msgParts.filter(p => p?.type === 'image_url').length;
      const beforeImages = sliceParts(parts, { partIndex: 0, offset: 0 }, worldStart).filter(p => p?.type === 'image_url').length;
      const afterImages = sliceParts(parts, imageRegionEnd, { partIndex: parts.length, offset: 0 }).filter(p => p?.type === 'image_url').length;
      return count + beforeImages + afterImages;
    }, 0);
    const maxImagesForMain = normalized.maxThreeImages ? Math.max(0, 3 - existingOuterImages) : null;

    const rendered = renderPartsAsImages(mainSensitive, renderImages, {
      ...IMAGE_ESCAPE_DEFAULTS,
      host: options.host,
      ...options.imageOptions,
    }, maxImagesForMain);
    stats.pages = rendered.stats.pages;
    stats.totalBytes = rendered.stats.totalBytes;
    stats.preservedMedia = rendered.stats.preservedMedia;

    escapedMiddle = [
      { type: 'text', text: IMAGE_ATTACH_OPEN + '\n' },
      ...rendered.parts,
      { type: 'text', text: '\n' + IMAGE_ATTACH_CLOSE + '\n\n' },
    ];

    if (runtimeSensitive.length) {
      const { parts: escapedRuntime } = escapePartsLight(runtimeSensitive);
      escapedMiddle.push(...escapedRuntime, { type: 'text', text: '\n\n' });
    }
  } else {
    return null;
  }

  const nextContent = toMessageContent([...prefix, ...escapedMiddle, ...suffix]);
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
    transformOutgoingRequest,
    disposeInputEscape,
  };
}
