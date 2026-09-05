import { assertCurrent } from '../platform/lifecycle.js';
/**
 * errorHandler.js
 * 全局错误处理包装器
 * 将 async 函数包装为自动捕获异常并显示 toastr 提示的版本
 */

/**
 * 从错误对象中提取 HTTP 状态码信息
 * 尝试多种方式获取状态码以适配酒馆内部错误格式
 */
const extractHttpStatus = (error) => {
  // 1. 直接检查 error.status 属性（酒馆内部可能设置）
  if (error.status && typeof error.status === 'number') {
    return error.status;
  }
  // 2. 检查 error.statusCode 属性
  if (error.statusCode && typeof error.statusCode === 'number') {
    return error.statusCode;
  }
  // 3. 检查 error.response?.status
  if (error.response && typeof error.response.status === 'number') {
    return error.response.status;
  }
  // 4. 从错误消息中提取状态码（如 "HTTP 403"、"(403)"、"status 500" 等）
  if (error.message) {
    const match = error.message.match(/\b(HTTP\s*)?(\d{3})\b/i);
    if (match) {
      const code = parseInt(match[2], 10);
      if (code >= 400 && code <= 599) return code;
    }
  }
  return null;
};

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

function errorCatched(fn) { return async (...args) => { assertCurrent(); const result = await fn(...args); assertCurrent(); return result; }; }

export { extractHttpStatus, formatErrorMessage, errorCatched };
