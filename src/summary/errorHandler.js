import { assertCurrent, captureContext, checkContext } from '../platform/lifecycle.js';

export const NO_AI_BODY_MESSAGE = '本次范围没有可归档的 AI 正文，请检查提取标签';
/**
 * errorHandler.js
 * 全局错误处理包装器
 * 异步操作前后校验上下文，由调用方显示错误反馈。
 */

/**
 * 从错误对象中提取 HTTP 状态码信息
 * 尝试多种方式获取状态码以适配酒馆内部错误格式
 */
const extractHttpStatus = (error) => {
  // 1. 直接检查 error.status 属性（酒馆内部可能设置）
  if (typeof error?.status === 'number') {
    return error.status;
  }
  // 2. 检查 error.statusCode 属性
  if (typeof error?.statusCode === 'number') {
    return error.statusCode;
  }
  // 3. 检查 error.response?.status
  if (typeof error?.response?.status === 'number') {
    return error.response.status;
  }
  // 4. 从错误消息中提取状态码（如 "HTTP 403"、"(403)"、"status 500" 等）
  const message = String(error?.message ?? error ?? '');
  const match = message.match(/\b(?:HTTP|status)\s*[:=]?\s*([45]\d\d)\b/i) ?? message.match(/\b([45]\d\d)\b/);
  return match ? Number(match[1]) : null;
};

export function summaryRequestMessage(error, streamGeneration) {
  const status = extractHttpStatus(error);
  if (status === 401 || status === 403) return '连接认证失败，请检查密钥和权限';
  if (status === 429) return '接口繁忙或额度受限';
  if (status === 524 || status === 504) {
    const advice = streamGeneration ? '请检查中转是否及时转发流式内容，或换用其他连接。' : '可在总结的连接设置中开启流式，或换用等待时间更长的连接。';
    return `总结请求遇到网关超时（HTTP ${status}）。${advice}`;
  }
  if (error.message.includes('总结请求超过 5 分钟')) return '本次请求已达到助手的 5 分钟等待上限。可缩短总结内容或换用更快的连接。';
  if (status === 408 || /time[ -]?out|timed out|超时/i.test(error.message)) {
    return streamGeneration ? '总结请求超时。请检查连接是否及时返回流式内容，或缩短总结内容后重试。' : '总结请求超时。可开启流式生成总结，或缩短总结内容后重试。';
  }
  if (streamGeneration && /(?:not support|unsupported|不支持).*?(?:stream|流式)|(?:stream|流式).*?(?:not supported|unsupported|不支持)/i.test(error.message)) {
    return '接口不支持本次流式请求。请关闭“流式生成总结”后重试。';
  }
  if (['接口未返回正文', '未得到响应', 'Response body is null'].includes(error.message)) {
    return streamGeneration ? '流式请求没有收到正文。请检查接口是否支持流式，或关闭总结流式后重试。' : '接口未返回正文，请检查连接和模型后重试。';
  }
  if (/failed to fetch|network\s?error|network connection|load failed|terminated|ECONNRESET|socket hang up|ERR_(?:NETWORK|CONNECTION_|INCOMPLETE_CHUNKED)|premature close|AbortError|接口中断了请求|连接中断|连接重置/i.test(error.message)) {
    return streamGeneration ? '流式请求未能完成。请检查网络或中转连接，若反复中断，可关闭总结流式后重试。' : '总结连接失败或中断，请检查网络或中转连接后重试。';
  }
  return '请求未完成，请检查连接后重试';
}

/**
 * 格式化错误消息，包含 HTTP 状态码
 */
const formatErrorMessage = (error) => {
  const status = extractHttpStatus(error);
  const baseMsg = error.message || '未知错误';
  if (status) {
    // 如果消息中已包含状态码，不重复添加
    if (baseMsg.includes(String(status))) {
      return `[HTTP ${status}] ${baseMsg}`;
    }
    return `[HTTP ${status}] ${baseMsg}`;
  }
  return baseMsg;
};

function errorCatched(fn) { return async (...args) => { assertCurrent(); const token = captureContext(); const result = await fn(...args); checkContext(token); return result; }; }

export function safeErrorDetails(error, secrets = []) {
  let text = String(error?.message ?? error ?? '未知错误');
  for (const secret of secrets.filter(Boolean)) text = text.split(secret).join('[已隐藏]');
  return text.replace(/https?:\/\/[^\s<>"']+/gi, '[接口地址已隐藏]').replace(/(Bearer\s+|(?:key|token|authorization)["'\s:=]+)[^\s,;"'}]+/gi, '$1[已隐藏]').slice(0, 1200);
}

export { extractHttpStatus, formatErrorMessage, errorCatched };
