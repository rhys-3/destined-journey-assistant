import { omitRanges, scanTaggedText } from './taggedText.js';

export class IncompleteSummaryError extends Error {}

const publicNotes = new Set(['archive_plan', 'archive_check', 'archive_finalize', 'thinking', 'think']);
const resultTag = 'summary_result';
const stripOuterFence = text => text.trim().replace(/^```[^\n`]*\r?\n([\s\S]*?)\r?\n```$/, '$1').trim();
const isUnclosed = section => !section.selfClosing && section.closeStart === undefined;
const publicSections = text => scanTaggedText(text).sections.filter(section => publicNotes.has(section.name));

export function extractSummaryResult(output, { prefill = '', format = 'free' } = {}) {
  const reply = stripOuterFence(String(output ?? ''));
  const continuation = scanTaggedText(prefill).sections.findLast(section =>
    isUnclosed(section) && (section.name === resultTag || publicNotes.has(section.name)));
  const echoedPrefill = continuation && scanTaggedText(omitRanges(reply, publicSections(reply).filter(section =>
    section.name !== continuation.name && !isUnclosed(section)))).sections.some(section => section.name === continuation.name);
  const text = echoedPrefill ? reply : `${prefill}${reply}`;
  const result = omitRanges(text, publicSections(text).filter(section => !isUnclosed(section)));
  if (publicSections(result).some(isUnclosed)) {
    throw new IncompleteSummaryError('总结的规划、核对或思考标签未完整闭合');
  }
  const tags = [...result.matchAll(/<\/?summary_result\b[^>]*>/gi)];
  if (tags.length === 1 && tags[0][0].toLowerCase() === '<summary_result>') {
    // A supplied result opener alone does not establish where a plain reply stopped.
    const fragment = reply.match(/<\/\w*$/)?.[0]?.toLowerCase();
    if (!continuation || echoedPrefill || (fragment && '</summary_result>'.startsWith(fragment))) {
      throw new IncompleteSummaryError('总结缺少完整的 </summary_result> 结束标签');
    }
  }
  if (tags.length !== 2 || tags[0][0].toLowerCase() !== '<summary_result>' || tags[1][0].toLowerCase() !== '</summary_result>') {
    throw new Error('需要且只能有一组完整的 <summary_result> 结果标签');
  }
  if ((result.match(/<\/?summary_result\b/gi) ?? []).length !== 2) throw new Error('结果标签重复或未闭合');
  return validateResultBody(result.slice(tags[0].index + tags[0][0].length, tags[1].index), format);
}

const timelineError = '时间地点档案需要 --- 分隔、日期 | 地点: 标题，以及缩进的时间和事件正文';
function normalizeTimeline(text) {
  const segments = text.split(/^[\t \u3000]*---[\t \u3000]*$/m);
  if (segments.shift() !== '' || !segments.length) throw new Error(timelineError);
  return segments.map(segment => {
    const [heading, ...lines] = segment.trim().split('\n');
    const match = /^([^|｜]+)[|｜]([^|｜]+)[:：]$/.exec(heading.trim());
    if (!match?.[1].trim() || !match[2].trim()) throw new Error(timelineError);
    const content = lines.filter(line => line.trim());
    if (content.some(line => !/^(?: {2,}|[\t\u3000]| +[\t\u3000])\s*\S/.test(line)) ||
      !content.some(line => !/^(?:【[^】]+】|[-*+]\s|\d+[.)]\s|•)/.test(line.trimStart()))) throw new Error(timelineError);
    const normalized = lines.map(line => line.trim() ? `  ${line.trim()}` : '');
    return ['---', `${match[1].trim()} | ${match[2].trim()}:`, ...normalized].join('\n');
  }).join('\n');
}

const archiveHeadings = ['时空与事件', '信息与关系变化', '约定与未决事项'];
function normalizeArchive(text) {
  let prior = -1, hasBullet = false;
  const missingEvent = '分项档案需要“【时空与事件】”标题和至少一条事件';
  const lines = text.split('\n').map(line => {
    const value = line.trim();
    const heading = /^【([^】]+)】\s*[:：]?$/.exec(value);
    if (heading) {
      const name = heading[1].trim(), index = archiveHeadings.indexOf(name);
      if (prior < 0 && index !== 0) throw new Error(missingEvent);
      if (index <= prior) throw new Error('分项档案的分类标题或顺序不符合所选格式');
      if (prior >= 0 && !hasBullet) throw new Error('分项档案的每个分类至少需要一条正文');
      prior = index;
      hasBullet = false;
      return `【${name}】`;
    }
    if (!value) return '';
    if (prior < 0) throw new Error(missingEvent);
    const bullet = /^[-*•]\s*(\S.*)$/.exec(value);
    if (bullet) {
      hasBullet = true;
      return `- ${bullet[1]}`;
    }
    if (hasBullet && /^\s/.test(line) && !value.startsWith('【')) return `  ${value}`;
    throw new Error('分项档案的分类正文需要使用项目列表');
  });
  if (prior < 0 || (prior === 0 && !hasBullet)) throw new Error(missingEvent);
  if (!hasBullet) throw new Error('分项档案的每个分类至少需要一条正文');
  return lines.join('\n');
}

export function validateResultBody(body, format = 'free') {
  const text = stripOuterFence(String(body ?? ''));
  if (!text) throw new Error('总结正文为空');
  if (/<\/?summary_result\b/i.test(text)) throw new Error('正文内不能嵌套结果标签');
  if (format === 'legacy') return normalizeTimeline(text.replace(/\r\n/g, '\n'));
  if (format === 'archive') return normalizeArchive(text.replace(/\r\n/g, '\n'));
  return text;
}
