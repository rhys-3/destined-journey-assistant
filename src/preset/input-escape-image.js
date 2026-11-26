// Browser Canvas text-to-image renderer for Gemini image input escaping.
// Produces crisp, high-contrast paginated PNG data URLs sized for multimodal
// vision encoders without extreme aspect ratios that cause downscaling blur.

export const IMAGE_ESCAPE_DEFAULTS = Object.freeze({
  width: 1120,
  maxHeight: 1560,
  paddingX: 32,
  paddingTop: 46,
  paddingBottom: 28,
  fontSize: 20,
  lineHeight: 29,
  maxPages: 40,
  maxTotalBytes: 24 * 1024 * 1024,
  fontFamily: '"PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Noto Sans CJK SC", "WenQuanYi Micro Hei", sans-serif',
  background: '#ffffff',
  foreground: '#111111',
  headerColor: '#555555',
});

// Progressive density tiers used only when the user opts into a strict page cap
// (e.g. max 3 images for relays with a 3-image limit). Picks the clearest tier
// that fits within the page budget.
export const COMPACT_IMAGE_TIERS = Object.freeze([
  { width: 1120, fontSize: 20, lineHeight: 29, maxHeight: 1560 },
  { width: 1360, fontSize: 18, lineHeight: 25, maxHeight: 2400 },
  { width: 1600, fontSize: 16, lineHeight: 22, maxHeight: 3600 },
  { width: 1840, fontSize: 14, lineHeight: 19, maxHeight: 5200 },
]);

function splitGraphemes(text) {
  if (typeof Intl !== 'undefined' && typeof Intl.Segmenter === 'function') {
    const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
    return [...segmenter.segment(text)].map(item => item.segment);
  }
  return Array.from(text);
}

/**
 * Wraps plain text into visual lines that fit within `maxWidth` pixels using
 * the provided `measureText(str)` function. Preserves explicit line breaks and
 * never splits surrogate pairs or grapheme clusters.
 */
export function wrapTextToLines(text, maxWidth, measureText) {
  const source = String(text ?? '').replace(/\r\n?/gu, '\n');
  const paragraphs = source.split('\n');
  const lines = [];
  for (const rawParagraph of paragraphs) {
    const paragraph = rawParagraph.replace(/\t/gu, '  ');
    if (paragraph === '') {
      lines.push('');
      continue;
    }
    if (measureText(paragraph) <= maxWidth) {
      lines.push(paragraph);
      continue;
    }
    const units = splitGraphemes(paragraph);
    let current = '';
    for (const unit of units) {
      const candidate = current + unit;
      if (current && measureText(candidate) > maxWidth) {
        // Prefer breaking after ASCII whitespace when mid-word on Latin text.
        const spaceAt = current.lastIndexOf(' ');
        if (spaceAt > 0 && spaceAt >= current.length - 18 && /^[A-Za-z0-9_'".,:;!?()[\]{}<>/-]+$/u.test(current.slice(spaceAt + 1) + unit)) {
          lines.push(current.slice(0, spaceAt));
          current = current.slice(spaceAt + 1) + unit;
        } else {
          lines.push(current);
          current = unit === ' ' ? '' : unit;
        }
      } else {
        current = candidate;
      }
    }
    if (current) lines.push(current);
  }
  while (lines.length && lines[0] === '') lines.shift();
  while (lines.length && lines.at(-1) === '') lines.pop();
  return lines;
}

export function paginateLines(lines, linesPerPage, balanced = false) {
  const limit = Math.max(1, Math.floor(linesPerPage));
  if (!lines.length) return [];
  const pageCount = Math.max(1, Math.ceil(lines.length / limit));
  const targetStep = balanced ? Math.ceil(lines.length / pageCount) : limit;
  const pages = [];
  let cursor = 0;
  while (cursor < lines.length) {
    const end = Math.min(cursor + targetStep, lines.length);
    const slice = lines.slice(cursor, end);
    while (slice.length > 1 && slice[0] === '') slice.shift();
    while (slice.length > 1 && slice.at(-1) === '') slice.pop();
    if (slice.some(line => line !== '')) pages.push(slice);
    cursor = end;
  }
  return pages;
}

function defaultCreateCanvas(host = globalThis) {
  const doc = host?.document ?? (typeof document !== 'undefined' ? document : null);
  if (doc && typeof doc.createElement === 'function') return () => doc.createElement('canvas');
  return null;
}

function chooseLayout(normalized, baseConfig, probeCtx) {
  const pageOffset = Number.isInteger(baseConfig.pageOffset) && baseConfig.pageOffset >= 0 ? baseConfig.pageOffset : 0;
  const strictCap = Number.isInteger(baseConfig.strictMaxPages) && baseConfig.strictMaxPages > 0 ? baseConfig.strictMaxPages : null;

  if (strictCap) {
    const tiers = Array.isArray(baseConfig.compactTiers) && baseConfig.compactTiers.length
      ? baseConfig.compactTiers
      : COMPACT_IMAGE_TIERS;
    for (const tier of tiers) {
      const cfg = { ...baseConfig, ...tier };
      const font = `${cfg.fontSize}px ${cfg.fontFamily}`;
      probeCtx.font = font;
      const lines = wrapTextToLines(normalized, cfg.width - cfg.paddingX * 2, value => probeCtx.measureText(value).width);
      const linesPerPage = Math.max(1, Math.floor((cfg.maxHeight - cfg.paddingTop - cfg.paddingBottom) / cfg.lineHeight));
      const pages = paginateLines(lines, linesPerPage, true);
      if (pages.length <= strictCap) {
        return { config: cfg, font, pages };
      }
    }
    throw new Error(`正文过长，开启最多 3 张图限制后仍超出单图清晰度上限（本段上限 ${strictCap} 页）。请关闭三张限制、开启后台总结或改用轻度转义。`);
  }

  const font = `${baseConfig.fontSize}px ${baseConfig.fontFamily}`;
  probeCtx.font = font;
  const lines = wrapTextToLines(normalized, baseConfig.width - baseConfig.paddingX * 2, value => probeCtx.measureText(value).width);
  if (!lines.length) return { config: baseConfig, font, pages: [] };
  const linesPerPage = Math.max(1, Math.floor((baseConfig.maxHeight - baseConfig.paddingTop - baseConfig.paddingBottom) / baseConfig.lineHeight));
  const pages = paginateLines(lines, linesPerPage, false);
  if (pageOffset + pages.length > baseConfig.maxPages) {
    throw new Error(`图片转义需要渲染 ${pageOffset + pages.length} 页，超出上限（${baseConfig.maxPages} 页）。请改用轻度转义，或开启后台总结／缩短上下文后重试。`);
  }
  return { config: baseConfig, font, pages };
}

/**
 * Renders text into an array of `{ dataUrl, width, height, lineCount, bytes }` pages.
 * Throws a user-facing Chinese error when the environment lacks Canvas or when
 * the rendered output exceeds the page/payload safety budget.
 */
export function renderTextToImages(text, options = {}) {
  const baseConfig = { ...IMAGE_ESCAPE_DEFAULTS, ...options };
  const normalized = String(text ?? '').trim();
  if (!normalized) return [];

  const createCanvas = typeof baseConfig.createCanvas === 'function'
    ? baseConfig.createCanvas
    : defaultCreateCanvas(baseConfig.host);
  if (!createCanvas) {
    throw new Error('当前环境不支持 Canvas 渲染，无法使用图片转义，请改用轻度转义。');
  }

  const probeCanvas = createCanvas();
  const probeCtx = probeCanvas?.getContext?.('2d');
  if (!probeCtx) {
    throw new Error('无法初始化浏览器 2D 画布上下文，请改用轻度转义。');
  }

  const { config, font, pages } = chooseLayout(normalized, baseConfig, probeCtx);
  if (!pages.length) return [];

  const pageOffset = Number.isInteger(config.pageOffset) && config.pageOffset >= 0 ? config.pageOffset : 0;
  const showTotal = config.showTotal !== false;
  const pageTotal = Number.isInteger(config.pageTotal) && config.pageTotal >= pageOffset + pages.length
    ? config.pageTotal
    : pageOffset + pages.length;

  let totalBytes = Number.isFinite(config.bytesSoFar) ? config.bytesSoFar : 0;
  const results = [];
  for (let index = 0; index < pages.length; index += 1) {
    const pageLines = pages[index];
    const height = Math.min(
      config.maxHeight,
      Math.max(
        config.paddingTop + config.paddingBottom + config.lineHeight,
        config.paddingTop + config.paddingBottom + pageLines.length * config.lineHeight,
      ),
    );
    const canvas = createCanvas();
    canvas.width = config.width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = config.background;
    ctx.fillRect(0, 0, config.width, height);

    ctx.textBaseline = 'top';
    ctx.fillStyle = config.headerColor;
    ctx.font = `14px ${config.fontFamily}`;
    const pageLabel = showTotal
      ? `[Document Page ${pageOffset + index + 1} / ${pageTotal}]`
      : `[Document Page ${pageOffset + index + 1}]`;
    ctx.fillText(pageLabel, config.paddingX, 14);

    ctx.fillStyle = config.foreground;
    ctx.font = font;
    let y = config.paddingTop;
    for (const line of pageLines) {
      if (line) ctx.fillText(line, config.paddingX, y);
      y += config.lineHeight;
    }

    const dataUrl = canvas.toDataURL('image/png');
    if (typeof dataUrl !== 'string' || !dataUrl.startsWith('data:image/')) {
      throw new Error('画布导出图片失败，无法完成图片转义，请改用轻度转义。');
    }
    totalBytes += dataUrl.length;
    if (totalBytes > config.maxTotalBytes) {
      throw new Error('图片转义生成的请求体积超出安全上限，请改用轻度转义或缩短上下文后重试。');
    }
    results.push({ dataUrl, width: config.width, height, lineCount: pageLines.length, bytes: dataUrl.length });
  }
  return results;
}
