import { requestGeneration } from '../platform/lifecycle.js';
import { extractHttpStatus, errorCatched } from './errorHandler.js';
import { BLOCK_TYPES, BUILTIN_PROMPTS } from './config.js';
import { getSettings } from './storage.js';
import { replaceMacros } from './messages.js';
import { assertCurrent } from '../platform/lifecycle.js';
/**
 * api.js
 * API 调用逻辑（酒馆主API / 自定义API）
 * 依赖: config.js, storage.js, messages.js, errorHandler.js
 */

const parseOptionalNumberSetting = (value, fieldLabel) => {
  if (value === undefined || value === null) return undefined;
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;

  const normalized = String(value).trim();
  if (!normalized || normalized === 'same_as_preset') return undefined;

  const unquoted = normalized.replace(/^(["'])(.*)\1$/, '$2').trim();
  if (!unquoted || unquoted === 'same_as_preset') return undefined;

  const parsed = Number(unquoted);
  if (!Number.isFinite(parsed)) {
    throw new Error(`${fieldLabel} 必须是数字或 same_as_preset`);
  }
  return parsed;
};

const buildCustomApiConfig = (settings) => {
  if (settings.apiMode !== 'custom') return undefined;
  if (!settings.customApiUrl || !settings.customApiModel) {
    throw new Error('自定义API模式下必须填写API地址和模型名称');
  }
  const config = {
    apiurl: settings.customApiUrl,
    model: settings.customApiModel,
    source: settings.customApiSource || 'openai',
  };
  const temperature = parseOptionalNumberSetting(settings.temperature, '温度');
  const maxTokens = parseOptionalNumberSetting(settings.maxTokens, '最大Tokens');
  if (settings.customApiKey) config.key = settings.customApiKey;
  if (temperature !== undefined) config.temperature = temperature;
  if (maxTokens !== undefined) config.max_tokens = maxTokens;
  return config;
};

const callSummaryApi = errorCatched(
  async ({ promptBlocks, oldSummaryContent, mergedChatText, scanText }) => {
    const settings = getSettings();
    const customApi = buildCustomApiConfig(settings);
    const useNoTrans = settings.noTransTag !== false;
    const NO_TRANS = settings.noTransTagValue || '<|no-trans|>';
    const wrapContent = (text) => (useNoTrans ? `${NO_TRANS}${text}` : text);

    const orderedPrompts = [];
    for (const block of promptBlocks) {
      if (!block.enabled) continue;
      switch (block.type) {
        case BLOCK_TYPES.PROMPT: {
          const content = replaceMacros(block.content || '');
          if (content.trim()) {
            orderedPrompts.push({
              role: block.role || 'system',
              content: wrapContent(content),
            });
          }
          break;
        }
        case BLOCK_TYPES.BUILTIN_GROUP: {
          orderedPrompts.push(...BUILTIN_PROMPTS);
          break;
        }
        case BLOCK_TYPES.OLD_SUMMARY: {
          if (oldSummaryContent && oldSummaryContent.trim()) {
            orderedPrompts.push({
              role: block.role || 'system',
              content: wrapContent(
                `<existing_summary>\n${oldSummaryContent}\n</existing_summary>`
              ),
            });
          }
          break;
        }
        case BLOCK_TYPES.CHAT_MESSAGES: {
          if (mergedChatText && mergedChatText.trim()) {
            const lead = block.leadText || '以下是本次需要总结的聊天内容：';
            const xmlTag = block.xmlTag || 'chat_content';
            orderedPrompts.push({
              role: block.role || 'user',
              content: wrapContent(
                `${lead}\n<${xmlTag}>\n${mergedChatText}\n</${xmlTag}>`
              ),
            });
          }
          break;
        }
      }
    }

    const injects = [];
    if (scanText && scanText.trim()) {
      injects.push({
        role: 'system',
        content: scanText,
        position: 'none',
        should_scan: true,
      });
    }

    const config = { should_silence: true, ordered_prompts: orderedPrompts, injects };
    if (customApi) config.custom_api = customApi;

    let generateRawFn =
      (typeof generateRaw !== 'undefined' ? generateRaw : undefined) ||
      (typeof window !== 'undefined'
        ? window.generateRaw || (window.parent && window.parent.generateRaw)
        : undefined);

    if (generateRawFn) {
      try {
        const result = await requestGeneration(generateRawFn, config);
        assertCurrent();
        return result ? String(result).trim() : '';
      } catch (e) {
        if (e.name === "AbortError") throw e;
        const status = extractHttpStatus(e);
        const statusInfo = status ? ` [HTTP ${status}]` : '';
        throw new Error(`API请求失败${statusInfo}: ${e.message || '未知错误'}`);
      }
    }

    throw new Error('需要酒馆助手 generateRaw 接口，请更新或启用酒馆助手。');
  }
);

const callMegaSummaryApi = errorCatched(
  async ({ promptBlocks, oldMegaSummaryContent, mergedSummaryText }) => {
    const settings = getSettings();
    const customApi = buildCustomApiConfig(settings);
    const useNoTrans = settings.noTransTag !== false;
    const NO_TRANS = settings.noTransTagValue || '<|no-trans|>';
    const wrapContent = (text) => (useNoTrans ? `${NO_TRANS}${text}` : text);

    const orderedPrompts = [];
    for (const block of promptBlocks) {
      if (!block.enabled) continue;
      switch (block.type) {
        case BLOCK_TYPES.PROMPT: {
          const content = replaceMacros(block.content || '');
          if (content.trim()) {
            orderedPrompts.push({
              role: block.role || 'system',
              content: wrapContent(content),
            });
          }
          break;
        }
        case BLOCK_TYPES.BUILTIN_GROUP: {
          orderedPrompts.push(...BUILTIN_PROMPTS);
          break;
        }
        case BLOCK_TYPES.OLD_SUMMARY: {
          if (oldMegaSummaryContent && oldMegaSummaryContent.trim()) {
            orderedPrompts.push({
              role: block.role || 'system',
              content: wrapContent(
                `<existing_mega_summary>\n${oldMegaSummaryContent}\n</existing_mega_summary>`
              ),
            });
          }
          break;
        }
        case BLOCK_TYPES.CHAT_MESSAGES: {
          if (mergedSummaryText && mergedSummaryText.trim()) {
            const lead = block.leadText || '以下是需要进行大总结的总结条目内容：';
            const xmlTag = block.xmlTag || 'summary_records';
            orderedPrompts.push({
              role: block.role || 'user',
              content: wrapContent(
                `${lead}\n<${xmlTag}>\n${mergedSummaryText}\n</${xmlTag}>`
              ),
            });
          }
          break;
        }
      }
    }

    const config = { should_silence: true, ordered_prompts: orderedPrompts };
    if (customApi) config.custom_api = customApi;

    let generateRawFn =
      (typeof generateRaw !== 'undefined' ? generateRaw : undefined) ||
      (typeof window !== 'undefined'
        ? window.generateRaw || (window.parent && window.parent.generateRaw)
        : undefined);

    if (generateRawFn) {
      try {
        const result = await requestGeneration(generateRawFn, config);
        assertCurrent();
        return result ? String(result).trim() : '';
      } catch (e) {
        if (e.name === "AbortError") throw e;
        const status = extractHttpStatus(e);
        const statusInfo = status ? ` [HTTP ${status}]` : '';
        throw new Error(`API请求失败${statusInfo}: ${e.message || '未知错误'}`);
      }
    }

    throw new Error('需要酒馆助手 generateRaw 接口，请更新或启用酒馆助手。');
  }
);

const fetchModelList = errorCatched(async (apiUrl, apiKey) => {
  if (!apiUrl) throw new Error('请先填写API地址');
  const params = { apiurl: apiUrl };
  if (apiKey) params.key = apiKey;

  let getModelListFn = undefined;
  try {
    if (typeof getModelList !== 'undefined') getModelListFn = getModelList;
    else if (typeof window !== 'undefined' && window.getModelList)
      getModelListFn = window.getModelList;
    else if (typeof window !== 'undefined' && window.parent && window.parent.getModelList)
      getModelListFn = window.parent.getModelList;
  } catch (e) {}

  if (getModelListFn) {
    try {
      const result = await getModelListFn(params);
      // 验证返回结果是否为有效的模型列表
      if (result && Array.isArray(result) && result.length > 0) {
        console.log('Successfully fetched models via getModelList:', result.length);
        return result;
      }
      console.warn('getModelList returned invalid data, falling back to fetch:', result);
    } catch (e) {
      console.warn('Global getModelList failed, falling back to fetch', e);
      // 如果是明确的错误（如权限问题），不要fallback
      const status = extractHttpStatus(e);
      if (status && (status === 401 || status === 403)) {
        throw new Error(`API认证失败 [HTTP ${status}]: ${e.message || '请检查API密钥'}`);
      }
    }
  }

  let url = apiUrl.trim();
  if (!url.endsWith('/')) url += '/';
  if (!url.endsWith('models/') && !url.endsWith('models')) {
    url += 'models';
  }
  const headers = { 'Content-Type': 'application/json' };
  if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;

  try {
    console.log('Fetching models from:', url);
    const res = await fetch(url, { method: 'GET', headers });
    if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
    const data = await res.json();
    if (data && Array.isArray(data.data)) {
      return data.data.map((x) => x.id);
    }
    if (Array.isArray(data)) {
      return data.map((x) => x.id || x);
    }
    throw new Error('响应格式无法解析');
  } catch (e) {
    throw new Error(`获取模型列表失败: ${e.message} (尝试 URL: ${url})`);
  }
});

export { parseOptionalNumberSetting, buildCustomApiConfig, callSummaryApi, callMegaSummaryApi, fetchModelList };
