
/**
 * utils.js
 * 通用工具函数
 */

const clampInt = (v, min, max) => {
  const n = parseInt(v, 10);
  if (!Number.isFinite(n)) return min;
  return Math.max(min, Math.min(max, n));
};

const escapeHtml = (s) =>
  String(s ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');

const compressRanges = (ids) => {
  if (!Array.isArray(ids) || ids.length === 0) return '无（0层）';
  const arr = [...new Set(ids.filter((x) => Number.isFinite(x)))].sort((a, b) => a - b);
  if (arr.length === 0) return '无（0层）';
  const ranges = [];
  let start = arr[0];
  let prev = arr[0];
  for (let i = 1; i < arr.length; i++) {
    const cur = arr[i];
    if (cur === prev + 1) {
      prev = cur;
      continue;
    }
    ranges.push(start === prev ? `${start}` : `${start}-${prev}`);
    start = prev = cur;
  }
  ranges.push(start === prev ? `${start}` : `${start}-${prev}`);
  return `${ranges.join(', ')}（共${arr.length}层）`;
};

const makeSummaryEntryName = (startFloor, endFloor) =>
  `总结${startFloor}-${endFloor}楼`;

const parseSummaryEntryName = (name) => {
  const m = /^总结(\d+)-(\d+)楼$/.exec(String(name || ''));
  if (!m) return null;
  const start = parseInt(m[1], 10);
  const end = parseInt(m[2], 10);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
  return { start, end };
};

const makeMegaSummaryEntryName = (startOrder, endOrder) =>
  `大总结${startOrder}-${endOrder}楼`;

const parseMegaSummaryEntryName = (name) => {
  const m = /^大总结(\d+)-(\d+)楼$/.exec(String(name || ''));
  if (!m) return null;
  const start = parseInt(m[1], 10);
  const end = parseInt(m[2], 10);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
  return { start, end };
};

const isMegaSummaryEntry = (name) => {
  return parseMegaSummaryEntryName(name) !== null;
};

const normalizeWorldbookEntries = (wb) => {
  if (Array.isArray(wb)) return wb;
  if (wb && Array.isArray(wb.entries)) return wb.entries;
  return [];
};

const parseTagString = (str) => {
  if (!str || typeof str !== 'string') return [];
  return str
    .split(/[,，]/)
    .map((s) => s.trim())
    .filter(Boolean);
};

const tagsToString = (tags) => {
  if (!Array.isArray(tags)) return '';
  return tags.filter(Boolean).join(', ');
};

const escapeRegex = (str) => str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export { clampInt, escapeHtml, compressRanges, makeSummaryEntryName, parseSummaryEntryName, makeMegaSummaryEntryName, parseMegaSummaryEntryName, isMegaSummaryEntry, normalizeWorldbookEntries, parseTagString, tagsToString, escapeRegex };
