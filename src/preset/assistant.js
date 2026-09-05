import * as summary from '../summary/service.js';
import { writePresetStore } from '../platform/store.js';
import { createDialogs, DIALOG_STYLES } from '../ui/dialogs.js';
import { PANEL_CSS } from '../ui/styles.js';
import { SUMMARY_STYLES } from '../summary/ui/styles.js';
export async function startPresetAssistant() {
  'use strict';

  const SCRIPT_ID = getScriptId();
  const SCRIPT_NAME = '【命定之诗】预设设置';
  const BUTTON_NAME = '命定预设设置';
  const LEGACY_BUTTON_NAME = '命定设置';
  const HOST_ID = `destined-settings-${SCRIPT_ID}`;
  const WAND_CONTAINER_ID = `destined-settings-wand-${SCRIPT_ID}`;
  const STORAGE_KEY = `destined-settings-ui:${SCRIPT_ID}`;
  const UI_THEMES = Object.freeze([
    { id: 'midnight', label: '曜石黑金' },
    { id: 'forest', label: '翡翠秘林' },
    { id: 'ember', label: '龙血余烬' },
    { id: 'parchment', label: '羊皮古卷' },
  ]);
  const SAVE_DELAY = 300;
  const PROFILE_TIMEOUT = 5000;
  const PRESET_SYNC_INTERVAL = 1500;
  const MANAGED_VALUES_VERSION = 2;
  const STYLE_STRUCTURE_VERSION = 1;
  const MOBILE_BREAKPOINT = 720;
  const PANEL_VIEWPORT_MARGIN = 12;
  const PANEL_MIN_WIDTH = 620;
  const PANEL_MIN_HEIGHT = 460;

  const DEFAULT_MANAGED_VALUES = Object.freeze({
    min_hanzi: '1500',
    dialogue_ratio: '40',
    dialogue_round_trips: '3',
    combat_rounds: '1',
    narration_person: 'third',
    body_language: '简体中文',
    thinking_language: '简体中文',
    global_preference: '',
  });

  const MANAGED_MACROS = Object.freeze({
    hanzi: '<|字数|>',
    dialogueRatio: '<|对白比例|>',
    dialogueRounds: '<|对白轮次|>',
    combatRounds: '<|战斗回合|>',
    narrationPerson: '<|人称|>',
    narrationRequirement: '<|人称要求|>',
    bodyLanguage: '<|正文语言|>',
    thinkingLanguage: '<|思维链语言|>',
    globalPreference: '<|全局偏好|>',
  });

  const MANAGED_MACRO_PATTERN = /<\|(字数|对白比例|对白轮次|战斗回合|人称|人称要求|正文语言|思维链语言|全局偏好)\|>/gu;
  const UNKNOWN_DESTINED_MACRO_PATTERN = /<\|命定[^|>]*\|>/gu;
  const USER_ADDITIONAL_OPEN = '{{#setvar 用户设定}}';
  const USER_ADDITIONAL_CLOSE = '{{/setvar}}';
  const USER_ADDITIONAL_TRIM = '{{trim}}';
  const USER_ADDITIONAL_DEFAULT = [
    '- 避免将<user>的言行描述成过于自信，不自量力的爽文/俗套小说主角',
    '- 避免将<user>言行描述为支配与命令等不平等权力关系内容',
    '- 避免油腻/性骚扰, 强迫女性, 苦大仇深/阴郁, 刻板说教',
  ].join('\n');

  const IDS = Object.freeze({
    dialogue: '8a5ba9bd-22f3-46f7-9660-8765d5e64e61',
    outputLength: '31f1341f-e48c-415e-b917-207d46ea5e77',
    narration: '138bdad2-d0b5-42d9-9af9-09a4b9b8d6b7',
    multiView: '30f70049-47c8-479d-8e16-79bde1ee5239',
    globalPreference: '77302724-02ff-406e-a104-4702ded1230a',
    userAdditional: '4b61fcc0-7e06-4d7e-8c43-6480f4649a85',
    eventChain: '4851aa12-04ef-4f56-a549-1b68e6761fbf',
    recap: '6c746d0d-fd50-40c9-8488-88de250e9ea8',
    selfCheck: '0f021cf0-c39f-400b-bd93-982caff67f62',
    actionOptions: 'e8ead062-215f-419a-bfe1-95620672533b',
    antiEmpty: 'fda70f73-997d-480f-83da-1e6e76e8071a',
    outputSummary: 'fae61edb-c404-4640-8371-71fa654f81e6',
    adultVocabulary: 'a48ce6ca-bb4a-459e-a18e-214ac82b35b0',
    writingEnd: 'a1acb123-3786-41d4-9287-ff3499d7895a',
    resetCache: '72c1e074-152f-424f-818a-adcf32c58779',
    sceneInfo: '49524930-ad3f-4499-a300-564c5e995159',
  });

  const BUILTIN_MODEL_ADAPTERS = Object.freeze({
    Gemini: {
      label: 'Gemini',
      ids: [
        'ecc2c6ea-0d97-4640-8aa4-2ff1544e688f',
        '7ecc16c0-7a77-468f-92e2-8154e508cf2c',
      ],
      tails: [
        '771b8391-c2d9-428e-8a36-9871cdb41c50',
        '8f1a8391-1cb6-46fc-bc47-11bcb0fc256f',
      ],
    },
    Claude: {
      label: 'Claude',
      ids: [
        '043ce90e-42b6-4f00-be11-a704c63684f8',
        '288f30b6-b600-4024-a947-957e597f99c6',
        'ba5857a5-b277-4412-9f4a-67d157087626',
      ],
      tails: [],
    },
    DeepSeek: {
      label: 'DeepSeek',
      ids: [
        '889ae158-3205-4070-b95a-258c2488282f',
        '4417cb2c-621d-41a7-8684-353c1d2502c1',
        '6dd3dc6c-f7cd-4f7c-9a92-552940f12646',
      ],
      tails: [],
    },
  });

  const GROUPS = Object.freeze({
    'base-tone': {
      label: '基础基调',
      section: 'style',
      options: [
        ['3de438b0-7e87-4664-8594-f90df1c3a027', '白描去八股'],
        ['e50a8252-ed29-43a9-9f32-636bfb867c1e', '细节叙事'],
        ['9ffdc08c-0cdc-49ce-a059-02f947e77abc', '🎭 基调｜细节叙事·允许心理描写'],
      ],
    },
    'main-style': {
      label: '主文风',
      section: 'style',
      options: [
        ['0149d66b-dbc8-42e3-849c-9e706801ee75', '日式轻小说'],
        ['20195b9d-5421-4a7f-8afd-cef379ef17b5', '史诗奇幻 · 尘土与长歌'],
        ['3e3e6335-662b-4b0d-bd86-8d7195f7363e', '西方奇幻'],
        ['80133594-b175-404f-8953-14355025dbdb', '西方奇幻 · 阴郁'],
        ['4e673ba4-c0cf-4504-9438-1d1c47d660b5', '歌剧式西方奇幻'],
      ],
    },
    'plot-pace': {
      label: '剧情推进',
      section: 'narrative',
      options: [
        ['841a5af6-4c0b-4e4e-8ce7-f79a4499fad3', '慢速'],
        ['13082ca7-3935-4c4f-b47d-e0476331b5b0', '均衡'],
        ['2a8c05c6-7780-467a-9e43-fbdc44b2f5e9', '快速'],
        ['5296c1fd-da3b-4d55-9fca-3e8f8dff46b8', '大纲展开'],
      ],
    },
    'actor-control': {
      label: '抢话控制',
      section: 'narrative',
      options: [
        ['6691f61f-7fc0-4d79-8c04-f6167eeab395', '允许抢话'],
        ['0354ab2d-2cc8-40cf-ad23-6a70455efec3', '禁止抢话'],
      ],
    },
    retelling: {
      label: '输入转述',
      section: 'narrative',
      options: [
        ['2670f668-f6dc-4380-80cd-822320607e7b', '融入转述'],
        ['4ebb1755-ee24-496d-8d62-52a61a930ad2', '禁止转述'],
      ],
    },
    ending: {
      label: '结尾方式',
      section: 'narrative',
      options: [
        ['500cd665-3383-4560-832d-900da674c50f', '物理事实结尾'],
        ['87053b89-8f2f-4f4d-9096-9c750ecc4e27', '非用户角色结尾'],
      ],
    },
    'adult-mode': {
      label: '成人内容适配',
      section: 'content',
      options: [
        ['ccd244e5-ae1a-40b9-b937-ebedbc3f9af4', '通用适配'],
        ['9f88c31c-5a0e-4ec3-835f-f072a90ed0b6', '男性向'],
        ['6ca3ad39-0a35-475d-a645-8d2893868872', '女性向'],
      ],
    },
    'variable-mode': {
      label: '变量处理模式',
      section: 'system',
      options: [
        ['85c7f45b-e3b4-430c-bbab-822498d93de2', '主 API'],
        ['9103b46e-5810-4ed9-b06e-4365070fca35', '附加 API'],
      ],
    },
  });

  const PROTECTED_IDS = new Set([
    'worldInfoBefore', 'personaDescription', 'charDescription', 'charPersonality',
    'scenario', 'worldInfoAfter', 'dialogueExamples', 'chatHistory',
    '1a89dc9a-f80a-453b-be7d-d685b40778a2', 'b85ed092-7ec1-4a17-91c7-e2820bc569d3',
    'f6ea6fcd-9fee-4f85-a4a4-5cc8556dd23c', 'ac4b2615-382f-4d26-b526-946cc90d6447',
    'eea4da73-cbc0-49c0-8907-59f90420826e', '3201a47c-47a4-4120-9360-445b4a399c14',
    IDS.sceneInfo,
    '03adb1e6-e613-48ad-844e-035444017ec4',
    'dafd56fc-9b51-4936-98b5-bc16f7c37db9',
    'f7feb57e-6fd8-4c7a-b872-cdc3980f62e4',
    '900cb71c-f6a6-441f-a78c-056ddfc8db10',
    'a7c417bc-d976-414f-a507-f142833d1b3e',
    IDS.writingEnd,
  ]);

  let MODEL_ADAPTERS = { ...BUILTIN_MODEL_ADAPTERS };
  let MODEL_IDS = new Set(
    Object.values(MODEL_ADAPTERS).flatMap(adapter => [...adapter.ids, ...adapter.tails]),
  );
  const ID_TO_GROUP = new Map();
  for (const [groupId, group] of Object.entries(GROUPS)) {
    for (const [id] of group.options) ID_TO_GROUP.set(id, groupId);
  }

  const SECTION_LABELS = Object.freeze({
    model: '模型',
    output: '输出',
    narrative: '叙事',
    style: '文风',
    content: '内容',
    system: '系统',
    other: '新增 / 其他',
  });

  const CURATED_TOGGLES = Object.freeze({
    narrative: [
      IDS.multiView,
      '15a38201-7025-4b2c-b0df-d9eba7147bd2',
      '99c5f183-cfee-4fbd-a1ce-1c63be52d807',
      'ffd89cfe-057b-4a45-97a9-0b97c30d9718',
      'e5e96cc0-b3b0-4061-b3c8-b7d7ba087b0e',
    ],
    style: [
      '9c4ef2a1-949c-41b1-b821-4197b705380a',
      '09e69bd8-1576-4e1e-87a2-5daeb49ea4a3',
    ],
    content: [
      IDS.adultVocabulary,
      'e22d0082-c28b-4105-b787-5d9555eacd14',
      'f81de893-dc60-4682-96e4-6a374bde513d',
      '928d98d6-2128-4f9d-8406-440fa2d70f87',
    ],
    system: [
      IDS.eventChain,
      IDS.recap,
      IDS.selfCheck,
    ],
  });

  const BEAUTIFY_IDS = Object.freeze([
    'c10c1fdb-cb0b-435b-8d39-7b2e1f1c5e1e',
    '7d83b417-2887-4c66-8d40-bf166f51c4c4',
    'b6e338e2-d3dc-46a2-ad4e-1685c3b97598',
    '1cabd885-7332-4e1b-bd8e-c0e1a6226285',
    'd963ded2-4d8a-467e-943d-1af5d9458c09',
  ]);

  const AFTER_BODY_IDS = Object.freeze([IDS.outputSummary, IDS.actionOptions, IDS.antiEmpty]);
  const FIXED_UI_IDS = new Set([IDS.globalPreference, IDS.userAdditional, ...AFTER_BODY_IDS]);
  const DEFAULT_GROUP_OPTION_IDS = Object.freeze({
    'base-tone': 'e50a8252-ed29-43a9-9f32-636bfb867c1e',
    'main-style': '3e3e6335-662b-4b0d-bd86-8d7195f7363e',
  });
  const USER_CREATABLE_GROUPS = Object.freeze({
    'base-tone': { label: '基调', prefix: '🎭 ', tag: 'base_tone' },
    'main-style': { label: '主文风', prefix: '✒️ ', tag: 'main_writing_style' },
  });

  const state = {
    activeTab: 'daily',
    entryFilter: 'all',
    disclosures: new Set(),
    config: loadScriptConfig(),
    open: false,
    preset: null,
    profiles: [],
    profileLoading: false,
    saveMessage: '修改后自动保存，下次生成时使用',
    saveState: 'idle',
    search: '',
    styleEditor: null,
    promptEditor: null,
    editorUnlocked: false,
    reorderSaving: false,
    reorderUndo: null,
    workspaceBusy: false,
    modelDraft: { name: '', tailMode: 'no-prefill', binding: '' },
    configurationName: '',
  };

  let volatileUiState = {};
  let currentTheme = UI_THEMES.some(theme => theme.id === loadUiState().theme) ? loadUiState().theme : 'midnight';
  let currentTransparency = normalizeTransparency(loadUiState().transparency);
  let host;
  let shadow;
  let app;
  let saveChain = Promise.resolve();
  let destroyed = false;
  let dialogs = null;
  let configurationScopes = { preset: true, summary: true };
  let exportScopes = { preset: true, summary: true };
  let metadataEnriching = false;
  let suppressOrbClick = false;
  let commitInProgress = false;
  let reconcilePending = false;
  let presetFingerprint = '';
  let syncInterval = 0;
  let pendingPresetOperations = 0;
  let savedScriptConfig;
  const debounceTimers = new Map();
  const eventStops = [];
  const macroStops = [];

  function clone(value) {
    return typeof structuredClone === 'function'
      ? structuredClone(value)
      : JSON.parse(JSON.stringify(value));
  }

  savedScriptConfig = clone(state.config);
  rebuildModelRegistry();

  function escapeHtml(value) {
    return String(value ?? '')
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#39;');
  }

  function normalizeName(value) {
    return String(value ?? '')
      .replace(/[📋🎯🧭📄✒️✨⚙️🎭🏁📚📤🔌🔥🛟🛡️🧠🧩🧪🧱]/gu, '')
      .trim();
  }

  function sanitizeIntegerSetting(value, fallback) {
    const normalized = String(value ?? '').trim();
    return /^-?\d+$/u.test(normalized) ? normalized : fallback;
  }

  function sanitizeManagedValues(value) {
    const source = value && typeof value === 'object' ? value : {};
    const person = ['first', 'second', 'third'].includes(source.narration_person)
      ? source.narration_person
      : DEFAULT_MANAGED_VALUES.narration_person;
    return {
      min_hanzi: sanitizeIntegerSetting(source.min_hanzi, DEFAULT_MANAGED_VALUES.min_hanzi),
      dialogue_ratio: sanitizeIntegerSetting(source.dialogue_ratio, DEFAULT_MANAGED_VALUES.dialogue_ratio),
      dialogue_round_trips: sanitizeIntegerSetting(source.dialogue_round_trips, DEFAULT_MANAGED_VALUES.dialogue_round_trips),
      combat_rounds: sanitizeIntegerSetting(source.combat_rounds, DEFAULT_MANAGED_VALUES.combat_rounds),
      narration_person: person,
      body_language: sanitizeLanguageSetting(source.body_language, DEFAULT_MANAGED_VALUES.body_language),
      thinking_language: sanitizeLanguageSetting(source.thinking_language, DEFAULT_MANAGED_VALUES.thinking_language),
      global_preference: typeof source.global_preference === 'string' ? source.global_preference : DEFAULT_MANAGED_VALUES.global_preference,
    };
  }

  function sanitizeLanguageSetting(value, fallback = '简体中文') {
    const normalized = String(value ?? '').trim();
    return normalized
      && normalized.length <= 80
      && !/[\u0000-\u001f\u007f<>{}]/u.test(normalized)
      ? normalized
      : fallback;
  }

  function loadScriptConfig() {
    let raw = {};
    try {
      raw = getVariables({ type: 'script' }) ?? {};
    } catch (error) {
      console.warn(`[${SCRIPT_NAME}] 无法读取脚本变量，使用默认配置。`, error);
    }
    const source = raw.connection_link ?? {};
    const bindings = source.bindings ?? {};
    const result = {
      ...raw,
      managed_values_version: Number(raw.managed_values_version) || 0,
      style_structure_version: Number(raw.style_structure_version) || 0,
      managed_values: sanitizeManagedValues(raw.managed_values),
      entry_points: sanitizeEntryPoints(raw.entry_points),
      connection_link: {
        enabled: source.enabled === true,
        bindings: {
          ...Object.fromEntries(Object.entries(bindings).map(([key, value]) => [key, sanitizeBinding(value)])),
          Gemini: sanitizeBinding(bindings.Gemini),
          Claude: sanitizeBinding(bindings.Claude),
          DeepSeek: sanitizeBinding(bindings.DeepSeek),
        },
      },
    };
    try {
      delete result.configuration_error;
      result.custom_models = validateCustomModels(raw.custom_models ?? []);
      result.configuration_library = validateLibrary(raw.configuration_library ?? emptyLibrary());
      result.model_tail_modes = { Gemini: 'no-prefill', ...raw.model_tail_modes };
    } catch (error) {
      result.configuration_error = '配置数据未载入：' + error.message + '。原始数据已保留，请先导出备份。';
      console.error('[' + SCRIPT_NAME + ']', error);
    }
    return result;
  }

  function sanitizeEntryPoints(source) {
    const value = source && typeof source === 'object' ? source : {};
    const points = {
      floating_orb: value.floating_orb !== false,
      input_button: value.input_button !== false,
      wand_menu: value.wand_menu !== false,
    };
    if (!Object.values(points).some(Boolean)) points.floating_orb = true;
    return points;
  }

  function sanitizeBinding(binding) {
    if (!binding || typeof binding !== 'object') return null;
    const id = typeof binding.id === 'string' ? binding.id : '';
    const name = typeof binding.name === 'string' ? binding.name : '';
    return id || name ? { id, name } : null;
  }

  function saveScriptConfig(message = '连接配置已保存') {
    return enqueueScriptConfigSave(message);
  }

  async function commitScriptConfig(label) {
    setSaveStatus('saving', `正在保存：${label}`);
    try {
      writePresetStore(state.config);
      savedScriptConfig = clone(state.config);
      rebuildModelRegistry();
      setSaveStatus('saved', `已保存：${label}`);
    } catch (error) {
      state.config = clone(savedScriptConfig);
      rebuildModelRegistry();
      renderActiveContent(true);
      const message = error instanceof Error ? error.message : String(error);
      setSaveStatus('error', `保存失败：${message}`);
      throw error;
    }
  }

  function enqueueScriptConfigSave(label, debounceKey = null) {
    const enqueueConfig = () => {
      const task = saveChain.then(() => commitScriptConfig(label));
      saveChain = task.catch(error => console.error(`[${SCRIPT_NAME}] ${label} 失败。`, error));
      return task;
    };
    if (!debounceKey) return enqueueConfig();
    const key = `config:${debounceKey}`;
    const previous = debounceTimers.get(key);
    if (previous) {
      clearTimeout(previous.timer);
      previous.resolve({ superseded: true });
    }
    return new Promise((resolve, reject) => {
      const flush = () => {
        clearTimeout(timer);
        debounceTimers.delete(key);
        const task = enqueueConfig();
        task.then(resolve, reject);
        return task;
      };
      const timer = setTimeout(flush, SAVE_DELAY);
      debounceTimers.set(key, { timer, resolve, reject, flush });
    });
  }

  function getContext() {
    try {
      return SillyTavern.getContext?.() ?? SillyTavern;
    } catch {
      return SillyTavern;
    }
  }

  function getPrompt(preset, id) {
    return preset?.prompts?.find(prompt => prompt.id === id);
  }

  function requirePrompt(preset, id) {
    const prompt = getPrompt(preset, id);
    if (!prompt) throw new Error(`找不到预设条目：${id}`);
    return prompt;
  }

  function fingerprintPresetValue(preset) {
    if (!preset) return '';
    return JSON.stringify({
      settings: preset.settings,
      author: preset.extensions?.destined_author,
      prompts: (preset.prompts ?? []).map(prompt => ({
        id: prompt.id,
        name: prompt.name,
        enabled: prompt.enabled,
        position: prompt.position,
        role: prompt.role,
        content: prompt.content,
        extra: prompt.extra,
      })),
      prompts_unused: (preset.prompts_unused ?? []).map(prompt => ({
        id: prompt.id,
        name: prompt.name,
        enabled: prompt.enabled,
        position: prompt.position,
        role: prompt.role,
        content: prompt.content,
        extra: prompt.extra,
      })),
    });
  }

  function refreshPreset(shouldRender = true) {
    try {
      state.preset = clone(getPreset('in_use'));
      presetFingerprint = fingerprintPresetValue(state.preset);
      if (shouldRender) renderActiveContent(true);
    } catch (error) {
      state.preset = null;
      setSaveStatus('error', `读取当前预设失败：${error instanceof Error ? error.message : String(error)}`);
    }
  }

  function setSaveStatus(kind, message) {
    state.saveState = kind;
    state.saveMessage = message;
    renderStatus();
  }

  async function commitPresetMutation(label, mutator, guard = null, fromCurrent = false) {
    const startingName = getLoadedPresetName();
    const callerGuard = guard;
    guard = () => !destroyed && getLoadedPresetName() === startingName && (!callerGuard || callerGuard());
    if (guard && !guard()) throw new Error('上下文已变化，已停止保存');
    setSaveStatus('saving', `正在保存：${label}`);

    const loadedName = getLoadedPresetName();
    const targets = loadedName && loadedName !== 'in_use' ? [loadedName, 'in_use'] : ['in_use'];
    const before = new Map();
    const after = new Map();
    const current = fromCurrent ? clone(getPreset('in_use')) : null;

    for (const target of targets) {
      const snapshot = clone(getPreset(target));
      before.set(target, snapshot);
      const next = clone(current ?? snapshot);
      mutator(next);
      after.set(target, next);
    }

    const written = [];
    commitInProgress = true;
    try {
      for (const target of targets) {
        if (guard && !guard()) throw new Error('上下文已变化，已停止保存');
        written.push(target);
        await replacePreset(target, after.get(target), {
          render: target === 'in_use' ? 'debounced' : 'none',
        });
        if (fingerprintPresetValue(getPreset(target)) !== fingerprintPresetValue(after.get(target))) throw new Error('保存结果与预期不一致，可能存在外部并发修改。');
        if (destroyed || getLoadedPresetName() !== startingName) throw new Error('上下文已变化，已停止保存');
      }
      state.preset = clone(getPreset('in_use'));
      presetFingerprint = fingerprintPresetValue(state.preset);
      setSaveStatus('saved', `已保存：${label}`);
    } catch (error) {
      const rollbackIssues = [];
      for (const target of written.reverse()) {
        if (target === 'in_use' && (destroyed || getLoadedPresetName() !== startingName)) { rollbackIssues.push(target + '（上下文已变化）'); continue; }
        try {
          const actual = fingerprintPresetValue(getPreset(target));
          if (actual === fingerprintPresetValue(before.get(target))) continue;
          if (actual !== fingerprintPresetValue(after.get(target))) { rollbackIssues.push(target + '（外部修改，未覆盖）'); continue; }
          await replacePreset(target, before.get(target), {
            render: target === 'in_use' ? 'debounced' : 'none',
          });
        } catch (rollbackError) {
          rollbackIssues.push(target);
          console.error(`[${SCRIPT_NAME}] 回滚 ${target} 失败。`, rollbackError);
        }
      }
      if (rollbackIssues.length) error.message += '；回滚失败：' + rollbackIssues.join('、');
      state.preset = clone(getPreset('in_use'));
      presetFingerprint = fingerprintPresetValue(state.preset);
      renderActiveContent(true);
      const message = error instanceof Error ? error.message : String(error);
      setSaveStatus('error', `保存失败：${message}`);
      throw error;
    } finally {
      commitInProgress = false;
      if (reconcilePending) {
        reconcilePending = false;
        queueMicrotask(() => reconcilePreset('保存后同步'));
      }
    }
  }

  function trackPresetOperation(task) {
    pendingPresetOperations += 1;
    return task.finally(() => {
      pendingPresetOperations = Math.max(0, pendingPresetOperations - 1);
      if (pendingPresetOperations === 0 && reconcilePending && !commitInProgress) {
        reconcilePending = false;
        queueMicrotask(() => reconcilePreset('本地保存后同步'));
      }
    });
  }

  function queuePresetMutation(label, mutator, debounceKey = null) {
    try {
      const optimistic = clone(state.preset);
      mutator(optimistic);
      state.preset = optimistic;
    } catch (error) {
      return Promise.reject(error);
    }
    if (debounceKey) {
      const previous = debounceTimers.get(debounceKey);
      if (previous) {
        clearTimeout(previous.timer);
        previous.resolve({ superseded: true });
      }
      return trackPresetOperation(new Promise((resolve, reject) => {
        const flush = () => {
          clearTimeout(timer);
          debounceTimers.delete(debounceKey);
          const task = enqueue(label, mutator);
          task.then(resolve, reject);
          return task;
        };
        const timer = setTimeout(flush, SAVE_DELAY);
        debounceTimers.set(debounceKey, { timer, resolve, reject, flush });
      }));
    }
    return trackPresetOperation(enqueue(label, mutator));
  }

  function enqueue(label, mutator) {
    const presetName = getLoadedPresetName();
    const task = saveChain.then(() => commitPresetMutation(label, mutator, () => getLoadedPresetName() === presetName));
    saveChain = task.catch(error => {
      console.error(`[${SCRIPT_NAME}] ${label} 失败。`, error);
    });
    return task;
  }

  function reconcilePreset(reason = '外部预设变化') {
    if (destroyed) return;
    if (commitInProgress || pendingPresetOperations > 0 || state.workspaceBusy) {
      reconcilePending = true;
      return;
    }
    try {
      const next = clone(getPreset('in_use'));
      const nextFingerprint = fingerprintPresetValue(next);
      if (state.promptEditor && state.promptEditor.presetName !== getLoadedPresetName()) renderStyleEditorLayer();
      if (nextFingerprint === presetFingerprint) return;
      state.preset = next;
      presetFingerprint = nextFingerprint;
      if (state.open) {
        renderActiveContent(true);
        ensurePromptMetadata();
      }
      setSaveStatus('saved', `已同步：${reason}`);
    } catch (error) {
      console.warn(`[${SCRIPT_NAME}] 同步外部预设变化失败。`, error);
    }
  }

  // Only bound books are inspected. Worldbook I/O never enters the preset save queue.
  const VARIABLE_WORLD_ENTRIES = Object.freeze({
    main: 'output_format_(随AI输出开，主API)',
    extra: '[mvu_update]output_format_(使用额外模型更新变量开)',
    input: '[mvu_update]用户最新输入(使用额外模型更新变量开)',
  });
  const WORLD_TIMEOUT = 3500;
  const worldLink = { phase: 'idle', message: '打开后检查当前绑定的世界书。', books: [], issues: [], busy: false, dirty: false };
  const worldReads = new Map();
  const worldWrites = new Set();
  let worldEpoch = 0;
  let worldTimer = 0;
  let worldScan = null;
  let worldOperationContext = '';

  function worldEntryKey(name) {
    return String(name ?? '').normalize('NFKC').replace(/[\s_]/gu, '').toLowerCase();
  }

  function variableEntryRole(entry) {
    const key = worldEntryKey(entry.name);
    return Object.keys(VARIABLE_WORLD_ENTRIES).find(role => worldEntryKey(VARIABLE_WORLD_ENTRIES[role]) === key) ?? '';
  }

  function variablePresetMode(preset = state.preset) {
    const options = GROUPS['variable-mode'].options;
    const main = getPrompt(preset, options[0][0])?.enabled === true;
    const extra = getPrompt(preset, options[1][0])?.enabled === true;
    return main !== extra ? (main ? 'main' : 'extra') : null;
  }

  function captureWorldContext() {
    const names = new Set();
    const errors = [];
    const add = name => { if (typeof name === 'string' && name.trim()) names.add(name); };
    try {
      const bound = getCharWorldbookNames('current');
      add(bound?.primary);
      for (const name of bound?.additional ?? []) add(name);
    } catch { errors.push('角色世界书绑定未读取到'); }
    try { for (const name of getGlobalWorldbookNames()) add(name); } catch { errors.push('全局世界书绑定未读取到'); }
    try { add(getChatWorldbookName('current')); } catch { errors.push('聊天世界书绑定未读取到'); }
    const context = getContext();
    const sorted = [...names].sort();
    const key = JSON.stringify([getLoadedPresetName(), context?.characterId, context?.groupId, context?.chatId, sorted]);
    return { key, names: sorted, errors };
  }

  function worldContextIsCurrent(context, epoch) {
    if (destroyed || worldEpoch !== epoch) return false;
    try { return captureWorldContext().key === context.key; } catch { return false; }
  }

  function withWorldTimeout(promise, label, timeout = WORLD_TIMEOUT) {
    let timer;
    return Promise.race([
      promise,
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`${label}超时，未确认完成`)), timeout); }),
    ]).finally(() => clearTimeout(timer));
  }

  function inspectVariableBook(name, entries) {
    if (!Array.isArray(entries)) throw new Error('世界书返回格式不正确');
    const roles = { main: [], extra: [], input: [] };
    for (const entry of entries) {
      const role = variableEntryRole(entry);
      if (role) roles[role].push({ uid: entry.uid, name: entry.name, enabled: entry.enabled === true });
    }
    if (!Object.values(roles).some(items => items.length)) return null;
    const missing = Object.keys(roles).filter(role => roles[role].length === 0);
    const duplicate = Object.keys(roles).filter(role => roles[role].length > 1);
    let mode = null;
    let issue = '';
    if (duplicate.length) issue = '发现同名变量条目，未自动修改；请先清理重复条目';
    else if (missing.length) issue = `缺少：${missing.map(role => VARIABLE_WORLD_ENTRIES[role]).join('、')}`;
    else {
      const main = roles.main[0].enabled;
      const extra = roles.extra[0].enabled;
      const input = roles.input[0].enabled;
      if (main && !extra) {
        mode = 'main';
        if (input) issue = '主 API 输出已开，但额外模型的用户输入仍开着；重新选择主 API 可修正';
      } else if (extra && !main) {
        mode = 'extra';
        if (!input) issue = '额外模型输出已开，但用户最新输入未开；重新选择额外 API 可补开';
      } else issue = main ? '两种输出格式同时开启，请选择一种模式修正' : '两种输出格式均未开启，请选择一种模式';
    }
    return { name, roles, missing, duplicate, mode, issue };
  }

  async function readVariableBooks(context) {
    const books = [];
    const issues = [...context.errors];
    const deadline = Date.now() + WORLD_TIMEOUT * 2;
    let index = 0;
    // At most three reads in flight; repeated events reuse unresolved requests.
    await Promise.all(Array.from({ length: Math.min(3, context.names.length) }, async () => {
      while (index < context.names.length) {
        const name = context.names[index++];
        if (Date.now() >= deadline) { issues.push(`${name}：本次检查时间已用完，请重新检查`); continue; }
        try {
          let request = worldReads.get(name);
          if (!request) {
            if (worldReads.size >= 3) throw new Error('已有世界书读取等待返回，请稍后重新检查');
            request = Promise.resolve().then(() => getWorldbook(name));
            worldReads.set(name, request);
            const release = () => { if (worldReads.get(name) === request) worldReads.delete(name); };
            request.then(release, release);
          }
          const entries = await withWorldTimeout(request, `读取 ${name}`, Math.min(WORLD_TIMEOUT, deadline - Date.now()));
          const book = inspectVariableBook(name, entries);
          if (book) books.push(book);
        } catch (error) { issues.push(`${name}：${error.message ?? error}`); }
      }
    }));
    books.sort((a, b) => a.name.localeCompare(b.name));
    return { books, issues };
  }

  function renderVariableSlot() {
    const slot = shadow?.querySelector('.variable-slot');
    if (!slot) return;
    const detailsOpen = slot.querySelector('.world-link-details')?.open === true;
    const active = shadow.activeElement;
    const value = slot.contains(active) ? active?.dataset?.value : null;
    slot.innerHTML = renderVariablePanel();
    if (detailsOpen && slot.querySelector('.world-link-details')) slot.querySelector('.world-link-details').open = true;
    if (value) [...slot.querySelectorAll('button')].find(button => button.dataset.value === value && !button.disabled)?.focus({ preventScroll: true });
  }

  function showWorldLink(phase, message, result = null) {
    worldLink.phase = phase;
    worldLink.message = message;
    if (result) { worldLink.books = result.books; worldLink.issues = result.issues; }
    renderVariableSlot();
  }

  function saveVariablePreset(mode, context, epoch) {
    const guard = () => worldContextIsCurrent(context, epoch);
    const task = saveChain.then(() => {
      if (!guard()) throw new Error('聊天、预设或世界书绑定已变化，本次切换已停止');
      return commitPresetMutation('变量模式', preset => {
        const options = GROUPS['variable-mode'].options;
        for (const [id] of options) requirePrompt(preset, id);
        options.forEach(([id], index) => { requirePrompt(preset, id).enabled = index === (mode === 'main' ? 0 : 1); });
      }, guard);
    });
    saveChain = task.catch(() => {});
    return trackPresetOperation(task);
  }

  function scheduleWorldbookScan() {
    if (destroyed) return;
    if (worldLink.busy) {
      try {
        if (captureWorldContext().key !== worldOperationContext) { worldEpoch += 1; worldLink.dirty = true; }
      } catch { worldEpoch += 1; worldLink.dirty = true; }
      return;
    }
    worldEpoch += 1;
    worldLink.dirty = true;
    clearTimeout(worldTimer);
    worldTimer = setTimeout(() => { worldTimer = 0; scanWorldbookMode(); }, 280);
  }

  function scanWorldbookMode({ follow = true } = {}) {
    if (destroyed || state.workspaceBusy || worldLink.busy || worldWrites.size) return Promise.resolve();
    if (worldScan) { worldLink.dirty = true; return worldScan; }
    const epoch = worldEpoch;
    worldLink.dirty = false;
    worldScan = (async () => {
      let context;
      let ownsBusy = false;
      try {
        context = captureWorldContext();
        // Unrelated presets must never receive automatic changes.
        if (!GROUPS['variable-mode'].options.every(([id]) => getPrompt(state.preset, id))) {
          showWorldLink('warning', '当前预设缺少变量模式选项，无法联动。');
          return;
        }
        showWorldLink('checking', '正在检查当前绑定的世界书…');
        const result = await readVariableBooks(context);
        if (!worldContextIsCurrent(context, epoch)) return;
        const modes = new Set(result.books.map(book => book.mode));
        const mode = result.issues.length === 0 && result.books.length > 0 && modes.size === 1 && !modes.has(null)
          ? result.books[0].mode : null;
        const pending = configLibrary().pendingWorld;
        if (pending?.key === context.key) follow = false;
        if (mode && follow && variablePresetMode() !== mode) {
          ownsBusy = true;
          worldLink.busy = true;
          worldOperationContext = context.key;
          await saveVariablePreset(mode, context, epoch);
        }
        if (!worldContextIsCurrent(context, epoch)) return;
        const hasIssue = result.issues.length > 0 || result.books.some(book => book.issue) || !mode || pending?.key === context.key;
        const message = pending?.key === context.key ? '配置已应用，世界书待同步。点击重新检查可重试同步。' : result.books.length === 0
          ? (result.issues.length ? '世界书未完整读取，保留当前预设选择。可稍后重新检查。' : '当前绑定的世界书中未找到变量条目。你仍可选择预设模式，绑定世界书后再检查。')
          : mode ? `世界书使用${mode === 'main' ? '主 API' : '额外 API'}${hasIssue ? '，部分条目需要检查。' : '，预设模式已对应。'}`
          : '世界书状态不明确或彼此不一致，保留当前选择。选择一种模式可统一已有条目的开关。';
        showWorldLink(hasIssue ? 'warning' : 'ready', message, result);
      } catch (error) { if (!destroyed && (!context || worldContextIsCurrent(context, epoch))) showWorldLink('warning', `检查未完成：${error.message ?? error}`); }
      finally { if (ownsBusy) worldLink.busy = false; renderVariableSlot(); }
    })().finally(() => {
      worldScan = null;
      if (worldLink.dirty && !destroyed) scheduleWorldbookScan();
    });
    return worldScan;
  }

  async function selectVariableMode(mode) {
    if (!['main', 'extra'].includes(mode) || worldLink.busy || worldWrites.size) return;
    clearTimeout(worldTimer);
    worldTimer = 0;
    const epoch = ++worldEpoch;
    worldLink.dirty = false;
    worldLink.busy = true;
    let context;
    try {
      context = captureWorldContext();
      worldOperationContext = context.key;
      showWorldLink('checking', '正在保存预设模式并同步世界书…');
      // Finish the preset transaction first; unavailable worldbooks never block other preset saves.
      await saveVariablePreset(mode, context, epoch);
      if (!worldContextIsCurrent(context, epoch)) return;
      const result = await readVariableBooks(context);
      if (!worldContextIsCurrent(context, epoch)) return;
      const issues = [...result.issues];
      const verified = [];
      for (const book of result.books) {
        if (!worldContextIsCurrent(context, epoch)) break;
        if (book.duplicate.length) { issues.push(`${book.name}：${book.issue}`); verified.push(book); continue; }
        const desired = role => role === 'main' ? mode === 'main' : mode === 'extra';
        const needsWrite = Object.entries(book.roles).some(([role, entries]) => entries.some(entry => entry.enabled !== desired(role)));
        if (!needsWrite) { verified.push(book); continue; }
        let cancelled = false;
        try {
          const original = JSON.stringify(book.roles);
          const request = Promise.resolve().then(() => updateWorldbookWith(book.name, entries => {
            if (cancelled || !worldContextIsCurrent(context, epoch)) throw new Error('上下文已变化或操作已超时，停止写入');
            const fresh = inspectVariableBook(book.name, entries);
            if (!fresh || JSON.stringify(fresh.roles) !== original) throw new Error('变量条目刚刚被其他操作修改，请重新选择模式');
            return entries.map(entry => {
              const role = variableEntryRole(entry);
              return role ? { ...entry, enabled: desired(role) } : entry;
            });
          }, { render: 'debounced' }));
          worldWrites.add(request);
          const release = () => {
            worldWrites.delete(request);
            if (cancelled && !destroyed) scheduleWorldbookScan();
          };
          request.then(release, release);
          const updated = await withWorldTimeout(request, `保存 ${book.name}`);
          const check = inspectVariableBook(book.name, updated);
          if (!check || Object.entries(check.roles).some(([role, entries]) => entries.some(entry => entry.enabled !== desired(role)))) throw new Error('返回的条目开关未与所选模式一致，请重新检查');
          verified.push(check);
        } catch (error) { cancelled = true; issues.push(`${book.name}：${error.message ?? error}`); verified.push(book); }
      }
      if (!worldContextIsCurrent(context, epoch)) return;
      const incomplete = verified.some(book => book.missing.length || book.duplicate.length || book.issue) || issues.length > 0;
      if (!incomplete && verified.length && configLibrary().pendingWorld?.key === context.key) {
        state.config.configuration_library.pendingWorld = null;
        await saveScriptConfig('世界书同步状态');
      }
      showWorldLink(incomplete || !verified.length ? 'warning' : 'ready', !verified.length
        ? '预设模式已保存；尚未联动到世界书。绑定后重新选择此模式即可同步。'
        : incomplete ? '预设模式已保存；世界书存在未完成项，见下方说明。已找到的可更新条目已处理。'
        : '预设与世界书条目已同步。请同时确认下方 MVU 更新方式。', { books: verified, issues });
    } catch (error) {
      if (!destroyed && (!context || worldContextIsCurrent(context, epoch))) showWorldLink('warning', `切换未完成：${error.message ?? error}`);
    } finally {
      worldLink.busy = false;
      renderVariableSlot();
      if (worldLink.dirty && !destroyed) scheduleWorldbookScan();
    }
  }

  function renderVariablePanel() {
    const mode = variablePresetMode();
    const unavailable = !GROUPS['variable-mode'].options.every(([id]) => getPrompt(state.preset, id));
    const disabled = worldLink.busy || worldWrites.size > 0 || unavailable;
    return `<article class="card variable-card" data-anchor="variables">
      <div class="card-title"><div><span class="step-label">开始前 · 变量更新</span><h4>由谁来更新世界状态？</h4><p>选择后联动当前绑定世界书中的变量条目。</p></div><span class="badge">${mode === 'main' ? '主 API' : mode === 'extra' ? '额外 API' : '待选择'}</span></div>
      <div class="variable-options">
        ${[['main', '主 API', '随正文一起更新变量'], ['extra', '额外 API', '额外模型单独解析变量']].map(([value, title, hint]) => `<button type="button" data-action="variable-mode" data-value="${value}" aria-pressed="${mode === value}" class="${mode === value ? 'selected' : ''}" ${disabled ? 'disabled' : ''}><strong>${title}</strong><small>${hint}</small><span aria-hidden="true">${mode === value ? '✓' : '○'}</span></button>`).join('')}
      </div>
      <p class="mvu-reminder">${mode ? `请在 <strong>MVU 变量框架</strong> 中，将 <strong>变量更新方式</strong> 设为 <strong>${mode === 'main' ? '随 AI 输出' : '额外模型解析'}</strong>。` : '请选择一种变量模式；世界书状态明确时会自动匹配。'}<small>这里联动预设与世界书，不会代改 MVU 框架设置。</small></p>
      <div class="world-link-status ${worldLink.phase}" role="status"><span>${escapeHtml(worldLink.message)}</span><button type="button" class="text-button" data-action="refresh-worldbook" ${worldLink.busy ? 'disabled' : ''}>重新检查</button></div>
      ${worldWrites.size ? '<p class="inline-warning">世界书写入尚未返回确认，暂不重复切换；其他设置可以继续使用。</p>' : ''}
      ${worldLink.books.length || worldLink.issues.length ? `<details class="world-link-details"><summary>联动详情 · ${worldLink.books.length} 本世界书${worldLink.issues.length || worldLink.books.some(book => book.issue) ? ' · 需要检查' : ''}</summary>${worldLink.books.map(book => `<div><strong>${escapeHtml(book.name)}</strong><small>${['main', 'extra', 'input'].map(role => `${({main:'主 API 输出',extra:'额外模型输出',input:'用户最新输入'})[role]}：${book.roles[role].length === 1 ? book.roles[role][0].enabled ? '开' : '关' : book.roles[role].length ? '重复' : '缺失'}`).join(' · ')}</small>${book.issue ? `<p>${escapeHtml(book.issue)}</p>` : ''}</div>`).join('')}${worldLink.issues.map(issue => `<p>${escapeHtml(issue)}</p>`).join('')}<small>只调整已有条目的启用状态；缺失条目需要在世界书中补齐。共享世界书的更改也会影响其他使用它的聊天。</small></details>` : ''}
    </article>`;
  }

  function getGroupOptions(groupId, preset = state.preset) {
    const options = [];
    for (const prompt of preset?.prompts ?? []) {
      const promptGroup = getPromptGroupId(prompt, preset);
      if (promptGroup === groupId) options.push([prompt.id, String(prompt.name ?? prompt.id)]);
    }
    return options;
  }

  function getPromptGroupId(prompt, preset = state.preset) {
    if (!prompt) return null;
    const meta=prompt.extra?.destined_ui;
    if(meta?.version===3)return meta.group||null;
    if(meta?.version===2&&!authorDependency(prompt))return authorLayout(preset).blocks.find(b=>b.id===meta.block)?.kind==='single'?meta.block:null;
    return ID_TO_GROUP.get(prompt.id) ?? (inferPromptMeta(prompt).control==='single-option'?inferPromptMeta(prompt).group:legacyAuthorBlock(prompt)==='unclassified'?inferNativePlacement(prompt,preset).group:null);
  }

  function applyGroup(groupId, selectedId) {
    if (groupId === 'variable-mode') {
      const index = GROUPS['variable-mode'].options.findIndex(([id]) => id === selectedId);
      if (index >= 0) return selectVariableMode(index === 0 ? 'main' : 'extra');
      return;
    }
    const group = GROUPS[groupId];
    const options = getGroupOptions(groupId);
    const customGroup = authorLayout().blocks.find(b => b.id === groupId && b.kind === 'single');
    if (!options.some(([id]) => id === selectedId) && !(selectedId === '' && customGroup?.allowNone)) return;
    const task = queuePresetMutation(group?.label ?? groupId, preset => {
      for (const [id] of getGroupOptions(groupId, preset)) requirePrompt(preset, id).enabled = id === selectedId;
    });
    for (const button of shadow.querySelectorAll('[data-action="group"]')) {
      if (button.dataset.group === groupId) {
        button.classList.toggle('selected', button.dataset.value === selectedId);

      }
    }
    task.catch(showErrorToast);
  }

  function detectModelAdapter(preset = state.preset, registry = MODEL_ADAPTERS) {
    const matches = [];
    for (const [name, adapter] of Object.entries(registry)) {
      const required = adapter.ids.every(id => getPrompt(preset, id)?.enabled);
      const otherIds = Object.entries(registry)
        .filter(([other]) => other !== name)
        .flatMap(([, item]) => [...item.ids, ...item.tails]);
      const othersDisabled = otherIds.every(id => !getPrompt(preset, id)?.enabled);
      const tailValid = name !== 'Gemini'
        || adapter.tails.filter(id => getPrompt(preset, id)?.enabled).length === 1;
      if (required && othersDisabled && tailValid) matches.push(name);
    }
    return matches.length === 1 ? matches[0] : null;
  }

  function getGeminiTail(preset = state.preset) {
    const [prefill, noPrefill] = MODEL_ADAPTERS.Gemini.tails;
    if (getPrompt(preset, prefill)?.enabled && !getPrompt(preset, noPrefill)?.enabled) return 'prefill';
    if (!getPrompt(preset, prefill)?.enabled && getPrompt(preset, noPrefill)?.enabled) return 'no-prefill';
    return null;
  }

  function applyModelToPreset(preset, adapterName) {
    const geminiTail = getGeminiTail(preset) ?? state.config.model_tail_modes?.Gemini ?? 'no-prefill';
    for (const [name, adapter] of Object.entries(MODEL_ADAPTERS)) {
      for (const id of adapter.ids) requirePrompt(preset, id).enabled = name === adapterName;
      for (const id of adapter.tails) {
        requirePrompt(preset, id).enabled = name === adapterName
          && (geminiTail === 'prefill' ? id === adapter.tails[0] : id === adapter.tails[1]);
      }
    }
  }

  async function selectModelAdapter(adapterName) {
    if (!MODEL_ADAPTERS[adapterName]) return;
    return runWorkspaceOperation('切换模型', async current => {
      const config = clone(state.config);
      const tail = getGeminiTail();
      if (tail) config.model_tail_modes.Gemini = tail;
      await withLinkedConnection(config, adapterName, current, async () => {
        const preset = clone(getPreset('in_use'));
        applyModelToPreset(preset, adapterName);
        await writeWorkspace(preset, config, current);
      });
    }).catch(showErrorToast);
  }

  function setGeminiTail(mode) {
    return runWorkspaceOperation('Gemini 尾部模式', async current => {
      assertData(['prefill', 'no-prefill'].includes(mode), '尾部必须二选一');
      assertData(detectModelAdapter() === 'Gemini', '请先切换到 Gemini 适配');
      const preset = clone(getPreset('in_use'));
      const [prefill, noPrefill] = BUILTIN_MODEL_ADAPTERS.Gemini.tails;
      requirePrompt(preset, prefill).enabled = mode === 'prefill';
      requirePrompt(preset, noPrefill).enabled = mode === 'no-prefill';
      const config = clone(state.config);
      config.model_tail_modes.Gemini = mode;
      await writeWorkspace(preset, config, current);
    }).catch(showErrorToast);
  }

  function countOccurrences(content, token) {
    return String(content ?? '').split(token).length - 1;
  }

  function hasManagedMacro(promptId, token, minimum = 1, preset = state.preset) {
    const prompt = getPrompt(preset, promptId);
    return countOccurrences(prompt?.content, token) >= minimum;
  }

  function narrationRequirement(person = state.config.managed_values.narration_person) {
    return {
      first: '必须以第一人称有限视角创作正文',
      second: '必须以第二人称有限视角创作正文',
      third: '必须以第三人称有限视角创作正文',
    }[person] ?? '必须以第三人称有限视角创作正文';
  }

  function managedMacroValues() {
    const values = sanitizeManagedValues(state.config.managed_values);
    return {
      字数: values.min_hanzi,
      对白比例: values.dialogue_ratio,
      对白轮次: values.dialogue_round_trips,
      战斗回合: values.combat_rounds,
      人称: values.narration_person,
      人称要求: narrationRequirement(values.narration_person),
      正文语言: values.body_language,
      思维链语言: values.thinking_language,
      全局偏好: values.global_preference,
    };
  }

  function expandManagedMacros(content, reportUnknown = false) {
    const values = managedMacroValues();
    let expanded = String(content ?? '').replace(MANAGED_MACRO_PATTERN, (_whole, key) => values[key]);
    const residualPattern = new RegExp(MANAGED_MACRO_PATTERN.source, 'gu');
    const residual = expanded.match(residualPattern);
    if (residual?.length) {
      expanded = expanded.replace(new RegExp(MANAGED_MACRO_PATTERN.source, 'gu'), '');
      if (reportUnknown) {
        console.error(`[${SCRIPT_NAME}] 宏展开结果中仍有残留，已移除。`, residual);
        toastr.error('检测到短宏递归残留，已阻止其发送。', BUTTON_NAME);
      }
    }
    const unknown = expanded.match(UNKNOWN_DESTINED_MACRO_PATTERN);
    if (unknown?.length) {
      expanded = expanded.replace(UNKNOWN_DESTINED_MACRO_PATTERN, '');
      if (reportUnknown) {
        const names = [...new Set(unknown)].join('、');
        console.error(`[${SCRIPT_NAME}] 已移除未知命定宏：${names}`);
        toastr.error(`检测到未知命定宏，已阻止其发送：${names}`, BUTTON_NAME);
      }
    }
    return expanded;
  }

  function readGlobalPreference() {
    return {
      ok: hasManagedMacro(IDS.globalPreference, MANAGED_MACROS.globalPreference),
      value: state.config.managed_values.global_preference,
    };
  }

  function setGlobalPreference(value) {
    state.config.managed_values.global_preference = String(value ?? '').replace(/\r\n?/gu, '\n');
    return enqueueScriptConfigSave('全局偏好', 'global-preference');
  }

  function buildUserAdditionalContent(value) {
    const normalized = String(value ?? '').replace(/\r\n?/gu, '\n');
    return `${USER_ADDITIONAL_OPEN}\n${normalized}${normalized ? '\n' : ''}${USER_ADDITIONAL_CLOSE}${USER_ADDITIONAL_TRIM}`;
  }

  function readUserAdditionalSetting(preset = state.preset) {
    const prompt = getPrompt(preset, IDS.userAdditional);
    if (!prompt) return { ok: false, value: '', error: '找不到“用户附加设定”条目。' };
    const content = String(prompt.content ?? '').replace(/\r\n?/gu, '\n');
    const expression = /^\s*\{\{#setvar 用户设定\}\}\n?([\s\S]*?)\n?\{\{\/setvar\}\}(?:\{\{trim\}\})?\s*$/u;
    const match = content.match(expression);
    if (!match
      || countOccurrences(content, USER_ADDITIONAL_OPEN) !== 1
      || countOccurrences(content, USER_ADDITIONAL_CLOSE) !== 1) {
      return { ok: false, value: '', error: '用户附加设定的受管包装缺失或格式异常，已停止写入。' };
    }
    return { ok: true, value: match[1], error: '' };
  }

  function setUserAdditionalSetting(value) {
    const normalized = String(value ?? '').replace(/\r\n?/gu, '\n');
    if (normalized.includes('{{/setvar}}')) {
      return Promise.reject(new Error('用户附加设定不能包含 {{/setvar}}，否则会截断受管区域。'));
    }
    if (!readUserAdditionalSetting().ok) {
      return Promise.reject(new Error('用户附加设定的受管包装缺失或格式异常，请先恢复默认。'));
    }
    return queuePresetMutation('用户附加设定', preset => {
      const prompt = requirePrompt(preset, IDS.userAdditional);
      if (!readUserAdditionalSetting(preset).ok) throw new Error('用户附加设定的受管包装缺失或格式异常，请先恢复默认。');
      prompt.content = buildUserAdditionalContent(normalized);
    }, 'user-additional-setting');
  }

  function resetUserAdditionalSetting() {
    const pending = debounceTimers.get('user-additional-setting');
    if (pending) {
      clearTimeout(pending.timer);
      pending.resolve({ superseded: true });
      debounceTimers.delete('user-additional-setting');
    }
    return queuePresetMutation('恢复用户附加设定', preset => {
      requirePrompt(preset, IDS.userAdditional).content = buildUserAdditionalContent(USER_ADDITIONAL_DEFAULT);
    });
  }

  const FIELD_DEFINITIONS = Object.freeze({
    hanzi: {
      label: '正文字数',
      promptId: IDS.outputLength,
      configKey: 'min_hanzi',
      macro: MANAGED_MACROS.hanzi,
      minimumOccurrences: 1,
      presets: [800, 1500, 2500, 4000],
    },
    dialogueRatio: {
      label: '对白比例',
      promptId: IDS.dialogue,
      configKey: 'dialogue_ratio',
      macro: MANAGED_MACROS.dialogueRatio,
      minimumOccurrences: 2,
      presets: [20, 40, 60],
    },
    dialogueRounds: {
      label: '最低对白轮次',
      promptId: IDS.dialogue,
      configKey: 'dialogue_round_trips',
      macro: MANAGED_MACROS.dialogueRounds,
      minimumOccurrences: 2,
      presets: [0, 1, 3, 5],
    },
    combatRounds: {
      label: '单次战斗回合',
      promptId: IDS.outputLength,
      configKey: 'combat_rounds',
      macro: MANAGED_MACROS.combatRounds,
      minimumOccurrences: 2,
      presets: [1, 2],
    },
  });

  const LANGUAGE_DEFINITIONS = Object.freeze({
    body: {
      label: '正文语言',
      description: '正文、对白与正文内面板使用的语言',
      configKey: 'body_language',
      macro: MANAGED_MACROS.bodyLanguage,
    },
    thinking: {
      label: '思维链语言',
      description: '思维链或公开裁决记录使用的语言',
      configKey: 'thinking_language',
      macro: MANAGED_MACROS.thinkingLanguage,
    },
  });

  const LANGUAGE_PRESETS = Object.freeze([
    ['简体中文', '简体中文'],
    ['繁体中文', '繁体中文'],
    ['English', '英语'],
    ['日本語', '日语'],
  ]);

  function languagePromptIds(key, preset = state.preset) {
    if (key === 'body') return [IDS.outputLength];
    if (key !== 'thinking') return [];
    return [...new Set(Object.values(MODEL_ADAPTERS).map(adapter => adapter.ids?.[1]))]
      .filter(id => id && getPrompt(preset, id));
  }

  function hasLanguageMacro(key, preset = state.preset) {
    const definition = LANGUAGE_DEFINITIONS[key];
    const ids = languagePromptIds(key, preset);
    if (!definition || ids.length === 0) return false;
    if (key === 'body') return hasManagedMacro(ids[0], definition.macro, 1, preset);
    const current = detectModelAdapter(preset);
    const currentId = current ? MODEL_ADAPTERS[current]?.ids?.[1] : '';
    return currentId
      ? hasManagedMacro(currentId, definition.macro, 1, preset)
      : ids.some(id => hasManagedMacro(id, definition.macro, 1, preset));
  }

  function readLanguageField(key) {
    const definition = LANGUAGE_DEFINITIONS[key];
    if (!definition || !hasLanguageMacro(key)) return { ok: false, value: '' };
    return { ok: true, value: sanitizeLanguageSetting(state.config.managed_values[definition.configKey]) };
  }

  function setLanguageField(key, rawValue) {
    const definition = LANGUAGE_DEFINITIONS[key];
    if (!definition) return Promise.reject(new Error('不支持的语言设置。'));
    const value = String(rawValue ?? '').trim();
    if (!value) return Promise.reject(new Error(`${definition.label}不能为空。`));
    if (value.length > 80) return Promise.reject(new Error(`${definition.label}不能超过 80 个字符。`));
    if (/[\u0000-\u001f\u007f<>{}]/u.test(value)) return Promise.reject(new Error(`${definition.label}不能包含换行、控制字符、尖括号或花括号。`));
    if (!hasLanguageMacro(key)) return Promise.reject(new Error(`${definition.label}对应的短宏缺失或格式异常。`));
    state.config.managed_values[definition.configKey] = value;
    return enqueueScriptConfigSave(definition.label, `language:${key}`);
  }

  function readNumericField(key) {
    const definition = FIELD_DEFINITIONS[key];
    if (!hasManagedMacro(definition.promptId, definition.macro, definition.minimumOccurrences)) {
      return { ok: false, value: '' };
    }
    const value = String(state.config.managed_values[definition.configKey] ?? '').trim();
    return /^-?\d+$/u.test(value) ? { ok: true, value } : { ok: false, value: '' };
  }

  function setNumericField(key, rawValue) {
    const definition = FIELD_DEFINITIONS[key];
    const value = String(rawValue ?? '').trim();
    if (!/^-?\d+$/u.test(value)) {
      return Promise.reject(new Error(`${definition.label}必须是有效整数。`));
    }
    if (!hasManagedMacro(definition.promptId, definition.macro, definition.minimumOccurrences)) {
      return Promise.reject(new Error(`${definition.label}对应的短宏缺失或格式异常。`));
    }
    state.config.managed_values[definition.configKey] = value;
    return enqueueScriptConfigSave(definition.label, `field:${key}`);
  }

  function setNarrationPerson(person) {
    if (!['first', 'second', 'third'].includes(person)) return showErrorToast(new Error('不支持的叙事人称。'));
    if (!hasManagedMacro(IDS.narration, MANAGED_MACROS.narrationPerson)
      || !hasManagedMacro(IDS.narration, MANAGED_MACROS.narrationRequirement)) {
      return showErrorToast(new Error('叙事人称短宏缺失或格式异常。'));
    }
    state.config.managed_values.narration_person = person;
    const task = enqueueScriptConfigSave('叙事人称');
    for (const button of shadow.querySelectorAll('[data-action="person"]')) {
      button.classList.toggle('selected', button.dataset.value === person);
    }
    task.catch(showErrorToast);
  }

  function extractLegacyAttribute(preset, promptId, tag, attribute) {
    const prompt = getPrompt(preset, promptId);
    const openings = String(prompt?.content ?? '').match(new RegExp(`<${tag}\\b[^>]*>`, 'giu')) ?? [];
    if (openings.length !== 1) return null;
    const matches = openings[0].match(new RegExp(`\\b${attribute}="([^"]*)"`, 'giu')) ?? [];
    if (matches.length !== 1) return null;
    return matches[0].slice(matches[0].indexOf('="') + 2, -1);
  }

  function readLegacyManagedValues(preset) {
    const values = {};
    const minHanzi = extractLegacyAttribute(preset, IDS.outputLength, 'length_control', 'min_hanzi');
    const dialogueRatio = extractLegacyAttribute(preset, IDS.dialogue, 'dialogue', 'target_ratio')?.replace(/%$/u, '');
    const dialogueRounds = extractLegacyAttribute(preset, IDS.dialogue, 'dialogue', 'min_round_trips');
    const combatRounds = extractLegacyAttribute(preset, IDS.outputLength, 'combat_pacing', 'max_rounds_per_response');
    const narrationPerson = extractLegacyAttribute(preset, IDS.narration, 'narration', 'person');
    if (/^-?\d+$/u.test(minHanzi ?? '')) values.min_hanzi = minHanzi;
    if (/^-?\d+$/u.test(dialogueRatio ?? '')) values.dialogue_ratio = dialogueRatio;
    if (/^-?\d+$/u.test(dialogueRounds ?? '')) values.dialogue_round_trips = dialogueRounds;
    if (/^-?\d+$/u.test(combatRounds ?? '')) values.combat_rounds = combatRounds;
    if (['first', 'second', 'third'].includes(narrationPerson)) values.narration_person = narrationPerson;

    const preference = getPrompt(preset, IDS.globalPreference);
    const match = String(preference?.content ?? '').match(/<VOID_likes\b[^>]*>([\s\S]*?)<\/VOID_likes>/iu);
    if (match && !match[1].includes(MANAGED_MACROS.globalPreference)) {
      let content = match[1].replace(/\r\n?/gu, '\n');
      if (content.startsWith('\n')) content = content.slice(1);
      if (content.endsWith('\n')) content = content.slice(0, -1);
      values.global_preference = content;
    }
    return values;
  }

  function replaceTagAttribute(content, tag, attribute, value) {
    const openingExpression = new RegExp(`<${tag}\\b[^>]*>`, 'iu');
    const opening = String(content ?? '').match(openingExpression)?.[0];
    if (!opening) throw new Error(`找不到迁移标签：${tag}`);
    const attributeExpression = new RegExp(`\\b${attribute}="[^"]*"`, 'iu');
    if (!attributeExpression.test(opening)) throw new Error(`找不到迁移属性：${tag}.${attribute}`);
    const nextOpening = opening.replace(attributeExpression, `${attribute}="${value}"`);
    return String(content).replace(opening, nextOpening);
  }

  function migrateManagedPromptContent(promptId, content) {
    let next = String(content ?? '');
    if (promptId === IDS.dialogue) {
      next = next.replace(/\sdata-destined-ui="dialogue"/gu, '');
      if (!next.includes(MANAGED_MACROS.dialogueRounds)) next = replaceTagAttribute(next, 'dialogue', 'min_round_trips', MANAGED_MACROS.dialogueRounds);
      if (!next.includes(MANAGED_MACROS.dialogueRatio)) next = replaceTagAttribute(next, 'dialogue', 'target_ratio', `${MANAGED_MACROS.dialogueRatio}%`);
      next = next.replace('不低于`min_round_trips`所指定轮数', `不低于${MANAGED_MACROS.dialogueRounds}轮`);
      next = next.replace('对白约占普通叙事与对白的比例遵循`target_ratio`', `对白约占普通叙事与对白的${MANAGED_MACROS.dialogueRatio}%`);
      return next;
    }
    if (promptId === IDS.outputLength) {
      next = next.replace(/\sdata-destined-ui="output"/gu, '');
      next = next.replace(/(<length_control\b[^>]*?)\bmin_hanzi=/iu, '$1min_characters=');
      if (!next.includes(MANAGED_MACROS.hanzi)) next = replaceTagAttribute(next, 'length_control', 'min_characters', MANAGED_MACROS.hanzi);
      if (!next.includes(MANAGED_MACROS.combatRounds)) next = replaceTagAttribute(next, 'combat_pacing', 'max_rounds_per_response', MANAGED_MACROS.combatRounds);
      next = next.replace('本次推进回合数不得超过`max_rounds_per_response`；', `本次推进回合数不得超过${MANAGED_MACROS.combatRounds}回合；`);
      next = next.replace(/<language\b[^>]*>\s*正文使用简体中文。\s*<\/language>/iu, `<language target="recorder_body">正文、对白与正文内面板使用${MANAGED_MACROS.bodyLanguage}；角色专名、原文引用和代码可按语境保留原语言。</language>`);
      return next;
    }
    if (Object.values(MODEL_ADAPTERS).some(adapter => adapter.ids?.[1] === promptId)) {
      next = next.replace(/Language：(?:中文|简体中文)/gu, `Language：${MANAGED_MACROS.thinkingLanguage}`);
      next = next.replace(/Audit Header: (?:中文|简体中文) \|/gu, `Audit Header: ${MANAGED_MACROS.thinkingLanguage} |`);
      return next;
    }
    if (promptId === IDS.narration) {
      next = next.replace(/\sdata-destined-ui="narration"/gu, '');
      next = next.replace(/(<narration\b[^>]*>)(?:必须以第一人称有限视角创作正文|必须以第二人称有限视角创作正文|必须以第三人称有限视角创作正文)(<\/narration>)/iu, `$1${MANAGED_MACROS.narrationRequirement}$2`);
      if (!next.includes(MANAGED_MACROS.narrationPerson)) next = replaceTagAttribute(next, 'narration', 'person', MANAGED_MACROS.narrationPerson);
      return next;
    }
    if (promptId === IDS.globalPreference) {
      next = next.replace(/\sdata-destined-ui="global-preference"/gu, '');
      const expression = /(<VOID_likes\b[^>]*>)[\s\S]*?(<\/VOID_likes>)/iu;
      if (!expression.test(next)) throw new Error('全局偏好标签格式异常。');
      return next.replace(expression, `$1\n${MANAGED_MACROS.globalPreference}\n$2`);
    }
    return next;
  }

  function needsManagedPromptMigration(preset) {
    if (state.config.managed_values_version !== MANAGED_VALUES_VERSION) return true;
    return [IDS.dialogue, IDS.outputLength, IDS.narration, IDS.globalPreference, ...languagePromptIds('thinking', preset)]
      .some(id => String(getPrompt(preset, id)?.content ?? '').includes('data-destined-ui='));
  }

  async function initializeManagedSettings() {
    if (!state.preset || !needsManagedPromptMigration(state.preset)) return;
    const legacyValues = readLegacyManagedValues(state.preset);
    state.config.managed_values = sanitizeManagedValues({
      ...state.config.managed_values,
      ...(state.config.managed_values_version === MANAGED_VALUES_VERSION ? {} : legacyValues),
    });
    state.config.managed_values_version = MANAGED_VALUES_VERSION;
    await enqueueScriptConfigSave('迁移预设设置');
    await queuePresetMutation('迁移命定短宏', preset => {
      for (const id of [IDS.dialogue, IDS.outputLength, IDS.narration, IDS.globalPreference, ...languagePromptIds('thinking', preset)]) {
        const prompt = getPrompt(preset, id);
        if (!prompt) continue;
        prompt.content = migrateManagedPromptContent(id, prompt.content);
      }
    });
  }

  function registerManagedMacros() {
    try {
      const registration = registerMacroLike(
        new RegExp(MANAGED_MACRO_PATTERN.source, 'gu'),
        (_context, _substring, key) => managedMacroValues()[key],
      );
      if (registration) macroStops.push(registration);
    } catch (error) {
      console.error(`[${SCRIPT_NAME}] 注册短宏失败，将使用请求阶段保护。`, error);
      toastr.error('短宏注册失败，已启用请求阶段保护。', BUTTON_NAME);
    }
  }

  function expandOutgoingMessages(messages) {
    if (!Array.isArray(messages)) return;
    for (const message of messages) {
      if (typeof message?.content === 'string') {
        message.content = expandManagedMacros(message.content, true);
        continue;
      }
      if (!Array.isArray(message?.content)) continue;
      for (const part of message.content) {
        if (part?.type === 'text' && typeof part.text === 'string') {
          part.text = expandManagedMacros(part.text, true);
        }
      }
    }
  }

  function togglePrompt(id, enabled) {
    if (PROTECTED_IDS.has(id)) return showErrorToast(new Error('这是必需核心条目，不能从预设设置中关闭。'));
    if (MODEL_IDS.has(id)) {
      state.activeTab = 'tools';
      render();
      return toastr.info('模型相关条目请从“模型”页原子切换。', BUTTON_NAME);
    }
    const current = getPrompt(state.preset, id);
    if (!current) return;
    const groupId = getPromptGroupId(current);
    if (groupId) return enabled ? applyGroup(groupId, id) : authorLayout().blocks.find(b => b.id === groupId)?.allowNone ? applyGroup(groupId, '') : showErrorToast(new Error('互斥组选项不能单独关闭，请选择同组的另一个选项。'));
    queuePresetMutation(normalizeName(current.name), preset => {
      requirePrompt(preset, id).enabled = enabled;
    }).catch(showErrorToast);
  }

  function isUserCreatedGroupPrompt(prompt, groupId = '') {
    const meta = prompt?.extra?.destined_ui;
    return (meta?.created_by === SCRIPT_ID || meta?.created_by === 'destined-author' || (typeof meta?.created_by === 'string' && meta.created_by.length > 0 && meta?.version === 1))
      && meta.group in USER_CREATABLE_GROUPS
      && (!groupId || meta.group === groupId);
  }

  function groupPromptTitle(prompt, groupId = getPromptGroupId(prompt)) {
    const title = normalizeName(prompt?.name);
    const label = USER_CREATABLE_GROUPS[groupId]?.label;
    return label ? title.replace(new RegExp(`^${label}\\s*[｜|]\\s*`, 'u'), '').trim() : title;
  }

  function buildStylePromptContent(groupId, value) {
    const definition = USER_CREATABLE_GROUPS[groupId];
    if (!definition) throw new Error('该分组没有可用的文风标签。');
    const normalized = String(value ?? '').replace(/\r\n?/gu, '\n');
    return `<${definition.tag}>\n${normalized}${normalized.endsWith('\n') ? '' : '\n'}</${definition.tag}>{{trim}}`;
  }

  function readStylePromptContent(prompt, groupId = getPromptGroupId(prompt)) {
    const definition = USER_CREATABLE_GROUPS[groupId];
    if (!definition) return { ok: false, migratable: false, value: '', error: '该条目不属于可编辑的基调或主文风。' };
    const content = String(prompt?.content ?? '').replace(/\r\n?/gu, '\n');
    const escapedTag = definition.tag.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
    const expression = new RegExp(`^\\s*<${escapedTag}>\\n?([\\s\\S]*?)\\n?<\\/${escapedTag}>\\{\\{trim\\}\\}\\s*$`, 'u');
    const match = content.match(expression);
    if (match) return { ok: true, migratable: false, value: match[1], error: '' };

    if (groupId === 'base-tone') {
      const legacy = content.match(/^\s*<base_writing_guidance>\n?([\s\S]*?)\n?<\/base_writing_guidance>\s*(?:<Writing_style>)?\s*$/u);
      if (legacy) return { ok: false, migratable: true, value: legacy[1], error: '' };
    }
    if (/<\/?(?:base_tone|main_writing_style|base_writing_guidance|Writing_style)\b/iu.test(content)) {
      return { ok: false, migratable: false, value: '', error: `${definition.label}的 XML 包装缺失或格式异常。` };
    }
    return { ok: false, migratable: true, value: content, error: '' };
  }

  async function initializeStyleStructures() {
    if (!state.preset || state.config.style_structure_version >= STYLE_STRUCTURE_VERSION) return;
    const migratableIds = [];
    const malformedNames = [];
    for (const prompt of state.preset.prompts ?? []) {
      if (!isUserCreatedGroupPrompt(prompt)) continue;
      const result = readStylePromptContent(prompt);
      if (result.migratable) migratableIds.push(prompt.id);
      else if (!result.ok) malformedNames.push(prompt.name);
    }
    if (migratableIds.length > 0) {
      await queuePresetMutation('迁移自建文风标签', preset => {
        for (const id of migratableIds) {
          const prompt = requirePrompt(preset, id);
          const groupId = getPromptGroupId(prompt);
          const result = readStylePromptContent(prompt, groupId);
          if (!result.migratable) throw new Error(`无法安全迁移自建${USER_CREATABLE_GROUPS[groupId]?.label ?? '文风'}：${prompt.name}`);
          prompt.content = buildStylePromptContent(groupId, result.value);
        }
      });
    }
    state.config.style_structure_version = STYLE_STRUCTURE_VERSION;
    await enqueueScriptConfigSave('文风标签结构已更新');
    if (malformedNames.length > 0) {
      toastr.warning(`以下自建条目的 XML 包装异常，未自动改写：${malformedNames.join('、')}`, BUTTON_NAME);
    }
  }

  function createPromptId() {
    if (typeof globalThis.crypto?.randomUUID === 'function') return globalThis.crypto.randomUUID();
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/gu, character => {
      const random = Math.floor(Math.random() * 16);
      const value = character === 'x' ? random : (random & 0x3) | 0x8;
      return value.toString(16);
    });
  }

  function openStyleEditor(id = '', requestedGroupId = 'main-style') {
    if(!state.editorUnlocked)return;
    const prompt = id ? getPrompt(state.preset, id) : null;
    const groupId = prompt?.extra?.destined_ui?.group ?? requestedGroupId;
    const definition = USER_CREATABLE_GROUPS[groupId];
    if (!definition) return showErrorToast(new Error('该分组不支持创建自定义条目。'));
    if (id && !isUserCreatedGroupPrompt(prompt, groupId)) {
      return showErrorToast(new Error(`只能编辑由预设设置创建的${definition.label}。`));
    }
    const managedContent = prompt ? readStylePromptContent(prompt, groupId) : { ok: true, value: '' };
    if (prompt && !managedContent.ok) {
      return showErrorToast(new Error(managedContent.error || `${definition.label}的 XML 包装异常，已停止编辑。`));
    }
    state.styleEditor = prompt
      ? { id: prompt.id, groupId, title: groupPromptTitle(prompt, groupId), content: managedContent.value }
      : { id: '', groupId, title: '', content: '' };
    state.activeTab = 'style';
    renderActiveContent(true);
    renderStyleEditorLayer();
    queueMicrotask(() => shadow.querySelector('[data-action="style-title"]')?.focus());
  }

  async function saveStyleEditor() {
    if(!state.editorUnlocked)return;
    const titleInput = shadow.querySelector('[data-action="style-title"]');
    const contentInput = shadow.querySelector('[data-action="style-content"]');
    const groupId = state.styleEditor?.groupId ?? '';
    const definition = USER_CREATABLE_GROUPS[groupId];
    if (!definition) return showErrorToast(new Error('该分组不支持创建自定义条目。'));
    const title = normalizeName(titleInput?.value)
      .replace(new RegExp(`^${definition.label}\\s*[｜|]\\s*`, 'u'), '')
      .trim();
    const content = String(contentInput?.value ?? '').trim();
    const editorId = state.styleEditor?.id ?? '';
    if (!title || !content) return showErrorToast(new Error(`${definition.label}名称和正文都不能为空。`));
    if (content.includes(`</${definition.tag}>`)) {
      return showErrorToast(new Error(`${definition.label}正文不能包含 </${definition.tag}>，否则会截断受管区域。`));
    }
    const newId = editorId || createPromptId();
    try {
      await queuePresetMutation(editorId ? `编辑自定义${definition.label}` : `新增自定义${definition.label}`, preset => {
        const duplicate = (preset.prompts ?? []).some(prompt =>
          prompt.id !== editorId
          && getPromptGroupId(prompt) === groupId
          && groupPromptTitle(prompt, groupId).toLocaleLowerCase('zh-CN') === title.toLocaleLowerCase('zh-CN'),
        );
        if (duplicate) throw new Error(`${definition.label}“${title}”已经存在。`);
        if (editorId) {
          const prompt = requirePrompt(preset, editorId);
          if (!isUserCreatedGroupPrompt(prompt, groupId)) throw new Error(`该条目不是预设设置创建的${definition.label}。`);
          if (!readStylePromptContent(prompt, groupId).ok) throw new Error(`${definition.label}的 XML 包装异常，已停止写入。`);
          prompt.name = `${definition.prefix}${title}`;
          prompt.content = buildStylePromptContent(groupId, content);
        } else {
          for (const [optionId] of getGroupOptions(groupId, preset)) {
            requirePrompt(preset, optionId).enabled = false;
          }
          const prompt = {
            id: newId,
            name: `${definition.prefix}${title}`,
            enabled: true,
            position: { type: 'relative' },
            role: 'system',
            content: buildStylePromptContent(groupId, content),
            extra: {
              destined_ui: {
                version: 1,
                section: 'style',
                control: 'single-option',
                group: groupId,
                order: 90,
                protected: false,
                created_by: 'destined-author',
              },
            },
          };
          let insertAt = -1;
          for (let index = 0; index < preset.prompts.length; index += 1) {
            if (getPromptGroupId(preset.prompts[index]) === groupId) insertAt = index;
          }
          writePlacement(prompt,groupId,0,preset);
          preset.prompts.splice(insertAt < 0 ? nativePlacementIndex(preset,groupId,'',prompt.id) : insertAt + 1, 0, prompt);
        }
      });
      state.styleEditor = null;
      renderActiveContent(true);
      renderStyleEditorLayer();
    } catch (error) {
      showErrorToast(error);
    }
  }

  async function deleteUserStyle(id) {
    const prompt=getPrompt(state.preset,id);
    if(!isUserCreatedGroupPrompt(prompt))return showErrorToast(new Error('只能删除自建的基调或主文风。'));
    if(!state.editorUnlocked)return;
    openPromptEditor(id);return editEntryAction('entry-delete');
  }

  function setStreaming(enabled) {
    queuePresetMutation('流式输出', preset => {
      preset.settings.should_stream = enabled;
    }).catch(showErrorToast);
  }

  async function ensurePromptMetadata() {
    // Only this preset owns these required entries; never repair another preset's placeholders.
    if (state.workspaceBusy || metadataEnriching || !getPrompt(state.preset, '03adb1e6-e613-48ad-844e-035444017ec4')) return;
    const missing = state.preset.prompts.filter(p => PROTECTED_IDS.has(p.id) && !p.enabled);
    if (!missing.length) return;
    metadataEnriching = true;
    try {
      await queuePresetMutation('恢复必需条目', preset => {
        for (const prompt of preset.prompts ?? []) if (PROTECTED_IDS.has(prompt.id)) prompt.enabled = true;
      });
    } catch (error) { console.warn('[命定设置] 基础条目恢复失败', error); }
    finally { metadataEnriching = false; }
  }

  function inferPromptMeta(prompt) {
    if (prompt.id === IDS.globalPreference) return { section: 'system', control: 'managed-content', order: 5 };
    if (prompt.id === IDS.userAdditional) return { section: 'content', control: 'managed-content', order: 5 };
    if (AFTER_BODY_IDS.includes(prompt.id)) return { section: 'output', control: 'toggle', order: 50 + AFTER_BODY_IDS.indexOf(prompt.id) * 10 };
    const explicit = prompt.extra?.destined_ui;
    if (explicit?.version === 1 && explicit.section in SECTION_LABELS) return explicit;
    if (PROTECTED_IDS.has(prompt.id)) return { section: 'system', control: 'readonly', protected: true, order: 0 };
    if (MODEL_IDS.has(prompt.id)) return { section: 'model', control: 'single-option', group: 'model-adapter', order: 10 };
    const groupId = ID_TO_GROUP.get(prompt.id);
    if (groupId) return { section: GROUPS[groupId].section, control: 'single-option', group: groupId, order: 20 };
    if ([IDS.dialogue, IDS.outputLength].includes(prompt.id)) return { section: 'output', control: 'managed-field', order: 10 };
    if (prompt.id === IDS.narration) return { section: 'narrative', control: 'managed-field', order: 10 };

    const name = normalizeName(prompt.name);
    if (/主文风\s*[｜|]/.test(name)) return { section: 'style', control: 'single-option', group: 'main-style', order: 20 };
    if (/^基调\s*[｜|]/.test(name)) return { section: 'style', control: 'single-option', group: 'base-tone', order: 10 };
    if (/剧情推进\s*[·｜|]/.test(name)) return { section: 'narrative', control: 'single-option', group: 'plot-pace', order: 10 };
    if (/变量\s*[｜|].*API/i.test(name)) return { section: 'system', control: 'single-option', group: 'variable-mode', order: 10 };
    if (/主文风|基调|风格|文笔|书籍参考|美化/.test(name)) return { section: 'style', control: 'toggle', order: 100 };
    if (/剧情推进|叙事|视角|抢话|转述|结尾|对话量|全局设置/.test(name)) return { section: 'narrative', control: 'toggle', order: 100 };
    if (/成人内容|用户设定|防|禁用词|表达约束/.test(name)) return { section: 'content', control: 'toggle', order: 100 };
    if (/变量|事件链|摘要|总结|行动选项|输出协议|核心|宏与变量|排障|自查/.test(name)) return { section: 'system', control: 'toggle', order: 100 };
    if (/模型|Gemini|Claude|DeepSeek|思维链|头部|尾部/.test(name)) return { section: 'model', control: 'toggle', order: 100 };
    if (/语言与字数|时间 · 地点 · 天气/.test(name)) return { section: 'output', control: 'toggle', order: 100 };
    return { section: 'other', control: 'toggle', order: 100 };
  }

  async function loadProfiles(shouldRender = true) {
    const revision = state.profileLoadRevision = (state.profileLoadRevision ?? 0) + 1;
    state.profileLoading = true;
    if (shouldRender) render();
    let profiles = [];
    try {
      const service = getContext()?.ConnectionManagerRequestService;
      if (typeof service?.getSupportedProfiles === 'function') {
        profiles = (await withWorldTimeout(Promise.resolve(service.getSupportedProfiles()), '读取连接列表', PROFILE_TIMEOUT)).map(profile => ({
          api: String(profile.api ?? ''),
          id: String(profile.id ?? profile.name ?? ''),
          mode: String(profile.mode ?? ''),
          model: String(profile.model ?? ''),
          name: String(profile.name ?? profile.id ?? ''),
        }));
      }
    } catch (error) {
      console.warn(`[${SCRIPT_NAME}] 读取 ConnectionManagerRequestService 失败。`, error);
    }

    if (profiles.length === 0) {
      try {
        const result = await withWorldTimeout(Promise.resolve(triggerSlash('/profile-list')), '读取连接列表', PROFILE_TIMEOUT);
        profiles = parseProfileList(result);
      } catch (error) {
        console.warn(`[${SCRIPT_NAME}] /profile-list 不可用。`, error);
      }
    }

    if (destroyed || revision !== state.profileLoadRevision) return;
    state.profiles = profiles
      .filter(profile => profile.name)
      .sort((left, right) => left.name.localeCompare(right.name, 'zh-CN'));
    state.profileLoading = false;
    if (shouldRender) render();
  }

  function parseProfileList(result) {
    const text = String(result ?? '').trim();
    if (!text) return [];
    try {
      const parsed = JSON.parse(text);
      const list = Array.isArray(parsed) ? parsed : Object.values(parsed ?? {});
      return list.map(item => typeof item === 'string'
        ? { api: '', id: item, mode: '', model: '', name: item }
        : {
            api: String(item.api ?? ''),
            id: String(item.id ?? item.name ?? ''),
            mode: String(item.mode ?? ''),
            model: String(item.model ?? ''),
            name: String(item.name ?? item.id ?? ''),
          });
    } catch {
      return text
        .split(/\r?\n|,/u)
        .map(name => name.replace(/^[-*]\s*/u, '').trim())
        .filter(Boolean)
        .map(name => ({ api: '', id: name, mode: '', model: '', name }));
    }
  }

  function profileKey(profile) {
    return profile.id || profile.name;
  }

  function resolveBoundProfile(binding) {
    if (!binding) return null;
    const byId = binding.id ? state.profiles.filter(profile => profile.id === binding.id) : [];
    if (byId.length) return byId.length === 1 ? byId[0] : null;
    const byName = binding.name ? state.profiles.filter(profile => profile.name === binding.name) : [];
    return byName.length === 1 ? byName[0] : null;
  }

  async function getCurrentProfileName() {
    try {
      return String(await withWorldTimeout(Promise.resolve(triggerSlash('/profile')), '读取当前连接', PROFILE_TIMEOUT) ?? '').trim();
    } catch {
      return '';
    }
  }

  function slashQuote(value) {
    return `"${String(value).replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"`;
  }

  async function switchConnectionProfile(profile) {
    await triggerSlash(`/profile await=true timeout=${PROFILE_TIMEOUT} ${slashQuote(profile.name)}`);
    await new Promise(resolve => setTimeout(resolve, 150));
    const currentName = await getCurrentProfileName();
    if (!currentName || currentName !== profile.name) {
      throw new Error(`连接配置切换校验失败：期望“${profile.name}”，当前为“${currentName}”。`);
    }

    const context = getContext();
    const actualModel = String(context?.getChatCompletionModel?.() ?? '').trim();
    if (profile.model && actualModel && profile.model !== actualModel) {
      throw new Error(`模型校验失败：连接配置要求“${profile.model}”，当前为“${actualModel}”。`);
    }

    const actualSource = String(context?.chatCompletionSettings?.chat_completion_source ?? '').trim();
    const actualTextType = String(
      context?.textCompletionSettings?.type
      ?? context?.textCompletionSettings?.api_type
      ?? '',
    ).trim();
    if (profile.api) {
      if (profile.mode === 'cc' && actualSource && profile.api !== actualSource) {
        throw new Error(`API 来源校验失败：连接配置要求“${profile.api}”，当前为“${actualSource}”。`);
      }
      if (profile.mode === 'tc' && actualTextType && profile.api !== actualTextType) {
        throw new Error(`API 类型校验失败：连接配置要求“${profile.api}”，当前为“${actualTextType}”。`);
      }
    }
  }

  function updateConnectionLink(enabled) {
    if (enabled && state.profiles.length === 0) {
      return showErrorToast(new Error('未发现可用的 SillyTavern Connection Profile。'));
    }
    state.config.connection_link.enabled = enabled;
    saveScriptConfig(enabled ? '已开启连接配置联动' : '已关闭连接配置联动').catch(showErrorToast);
  }

  function updateEntryPoint(key, enabled, control) {
    if (!['floating_orb', 'input_button', 'wand_menu'].includes(key)) return;
    const previous = sanitizeEntryPoints(state.config.entry_points);
    if (!enabled && previous[key] && Object.values(previous).filter(Boolean).length <= 1) {
      if (control) control.checked = true;
      return showErrorToast(new Error('至少需要保留一个设置界面入口。'));
    }
    state.config.entry_points = { ...previous, [key]: enabled };
    syncEntryPoints();
    const labels = {
      floating_orb: '悬浮球入口',
      input_button: '输入框上方入口',
      wand_menu: '魔术棒菜单入口',
    };
    saveScriptConfig(`${labels[key]}已${enabled ? '开启' : '关闭'}`).catch(error => {
      syncEntryPoints();
      showErrorToast(error);
    });
  }

  function syncEntryPoints() {
    state.config.entry_points = sanitizeEntryPoints(state.config.entry_points);
    syncOrbVisibility();
    syncInputButtonEntry();
    syncWandEntry();
  }

  function syncInputButtonEntry() {
    const visible = state.config.entry_points.input_button === true;
    updateScriptButtonsWith(buttons => {
      const existing = buttons.find(button => button.name === BUTTON_NAME || button.name === LEGACY_BUTTON_NAME);
      const others = buttons.filter(button => button.name !== BUTTON_NAME && button.name !== LEGACY_BUTTON_NAME);
      return [...others, { ...existing, name: BUTTON_NAME, visible }];
    });
  }

  function syncWandEntry() {
    const parentDocument = window.parent.document;
    const existing = parentDocument.getElementById(WAND_CONTAINER_ID);
    if (state.config.entry_points.wand_menu !== true) {
      existing?.remove();
      return;
    }
    if (existing) return;
    const menu = parentDocument.getElementById('extensionsMenu');
    if (!menu) return;

    const container = parentDocument.createElement('div');
    container.id = WAND_CONTAINER_ID;
    container.className = 'extension_container';
    container.dataset.scriptId = SCRIPT_ID;
    container.setAttribute('script_id', SCRIPT_ID);
    const item = parentDocument.createElement('div');
    item.className = 'list-group-item flex-container flexGap5';
    item.tabIndex = 0;
    item.setAttribute('role', 'button');
    item.setAttribute('aria-label', BUTTON_NAME);
    item.title = BUTTON_NAME;
    const icon = parentDocument.createElement('i');
    icon.className = 'fa-solid fa-wand-magic-sparkles';
    icon.setAttribute('aria-hidden', 'true');
    const label = parentDocument.createElement('span');
    label.textContent = BUTTON_NAME;
    item.append(icon, label);
    item.addEventListener('click', event => {
      event.preventDefault();
      openPanel();
    });
    item.addEventListener('keydown', event => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      event.preventDefault();
      openPanel();
    });
    container.append(item);
    menu.append(container);
    const menuButton = parentDocument.getElementById('extensionsMenuButton');
    if (menuButton) menuButton.style.display = 'flex';
  }

  function updateProfileBinding(adapterName, key) {
    const profile = state.profiles.find(item => profileKey(item) === key);
    state.config.connection_link.bindings[adapterName] = profile
      ? { id: profile.id, name: profile.name }
      : null;
    saveScriptConfig(`${adapterName} 连接配置已保存`).catch(showErrorToast);
  }

  function showErrorToast(error) {
    const message = error instanceof Error ? error.message : String(error);
    toastr.error(message, BUTTON_NAME);
    console.error(`[${SCRIPT_NAME}]`, error);
  }

  function renderFeatherIcon() {
    return '<svg class="feather-icon" viewBox="0 0 32 32" aria-hidden="true" focusable="false"><path class="feather-vane" d="M27 4C19 2.5 9 7 7.5 15.5c-.5 3 .3 5.5 2.5 6.5 3.6 1.5 7.5-1.6 10.5-5.5C24 12 26 7.5 27 4Z"/><path d="M4 28C9 22 15 15.5 23 8M10 21l5 .5M14 17l5 .2M18 12.5l-.5-4M13.5 17.5l-.7-5"/></svg>';
  }

  function syncOrbVisibility() {
    if (!app) return;
    const existing = app.querySelector('.orb');
    if (state.config.entry_points.floating_orb !== true) {
      existing?.remove();
      return;
    }
    if (existing) return;
    const ui = loadUiState();
    app.insertAdjacentHTML('afterbegin', `
      <button class="orb" type="button" aria-label="打开${BUTTON_NAME}" title="${BUTTON_NAME}"
        style="${ui.orb ? `left:${ui.orb.x}px;top:${ui.orb.y}px;right:auto;bottom:auto;` : ''}">
        ${renderFeatherIcon()}
      </button>
    `);
    clampOrbToViewport();
  }

  function render() {
    if (destroyed || !app) return;
    if (!app.querySelector('.panel-slot')) app.innerHTML = '<div class="panel-slot"></div>';
    applyTheme();
    syncOrbVisibility();
    const slot = app.querySelector('.panel-slot');
    if (!state.open) {
      summary.detach();
      slot.replaceChildren();
      return;
    }
    if (!slot.querySelector('.panel')) { slot.innerHTML = renderPanel(); if(state.activeTab === 'summary') summary.mount(slot.querySelector('.summary-slot')); }
    else renderActiveContent(true);
    applyPanelGeometry();
    renderStyleEditorLayer();
    renderStatus();
  }

  function renderActiveContent(preserveScroll = false) {
    cancelPromptSort();
    if (!state.open || !shadow) return;
    const content = shadow.querySelector('.content');
    if (!content) return;
    if (!['advanced','configurations','settings','summary'].includes(state.activeTab) && !authorLayout().pages.some(p=>p.id===state.activeTab&&!p.hidden)) state.activeTab='daily';
    const nav = shadow.querySelector('.tabs');
    if (nav) nav.innerHTML = renderPlacementNavigation();
    for (const item of content.querySelectorAll('[data-disclosure]')) {
      if (item.open) state.disclosures.add(item.dataset.disclosure);
      else state.disclosures.delete(item.dataset.disclosure);
    }
    const scrollTop = preserveScroll ? content.scrollTop : 0;
    const active = shadow.activeElement;
    const focusKey = active && content.contains(active)
      ? ['action', 'field', 'key', 'id', 'model'].map(key => [key, active.dataset?.[key]]).filter(([, value]) => value)
      : [];
    const invalidDraft = active?.dataset?.action === 'field-number' && !/^-?\d+$/u.test(active.value.trim()) ? active.value : null;
    const selectionStart = typeof active?.selectionStart === 'number' ? active.selectionStart : null;
    const selectionEnd = typeof active?.selectionEnd === 'number' ? active.selectionEnd : null;
    content.className = `content content-${state.activeTab}`;
    if (state.activeTab === 'summary' && content.querySelector('.summary-slot')) { summary.refresh(); return; }
    summary.detach();
    content.innerHTML = state.preset ? renderActiveTab() : '<div class="empty">无法读取当前预设。</div>';
    if (state.activeTab === 'summary') summary.mount(content.querySelector('.summary-slot'));
    restoreContentScroll(content, scrollTop);
    for (const button of shadow.querySelectorAll('[data-action="tab"]')) {
      button.classList.toggle('active', button.dataset.tab === state.activeTab);
      if (button.closest('.tabs')) button.setAttribute('aria-current', button.dataset.tab === state.activeTab ? 'page' : 'false');
    }
    if (focusKey.length > 0) {
      const replacement = [...content.querySelectorAll('[data-action]')].find(element =>
        focusKey.every(([key, value]) => element.dataset?.[key] === value),
      );
      if (replacement) {
        if (invalidDraft !== null) {
          replacement.value = invalidDraft;
          const error = replacement.closest('.numeric-card')?.querySelector('.field-error');
          if (error) error.textContent = invalidDraft ? '请输入有效整数。' : '自定义数值不能为空。';
        }
        replacement.focus({ preventScroll: true });
        if (selectionStart !== null && typeof replacement.setSelectionRange === 'function') {
          replacement.setSelectionRange(selectionStart, selectionEnd);
        }
      }
    }
    renderStyleEditorLayer();
    updateWorkspaceUi();
  }

  function restoreContentScroll(content, requestedScrollTop) {
    const clamp = () => {
      if (!content.isConnected) return;
      const maxScrollTop = Math.max(0, content.scrollHeight - content.clientHeight);
      content.scrollTop = Math.min(Math.max(0, requestedScrollTop), maxScrollTop);
    };
    clamp();
    window.parent.requestAnimationFrame(() => {
      clamp();
      window.parent.requestAnimationFrame(clamp);
    });
  }

  function renderStyleEditorLayer() {
    const slot = shadow?.querySelector('.editor-layer-slot');
    if (!slot) return;
    const active = shadow.activeElement;
    const action = slot.contains(active) ? active?.dataset?.action : null;
    const selection = action && typeof active.selectionStart === 'number' ? [active.selectionStart, active.selectionEnd] : null;
    syncPromptEditor();
    const field = active?.dataset?.field;
    const bodyScroll = slot.querySelector('.prompt-editor-body')?.scrollTop ?? 0;
    const textScroll = slot.querySelector('textarea')?.scrollTop ?? 0;
    slot.innerHTML = state.promptEditor ? renderPromptEditor() : renderStyleEditor();
    const modal = slot.querySelector('[role="dialog"]');
    shadow.querySelector('.panel-layout')?.toggleAttribute('inert', !!modal);
    shadow.querySelector('.panel-head')?.toggleAttribute('inert', !!modal);
    if (slot.querySelector('.prompt-editor-body')) slot.querySelector('.prompt-editor-body').scrollTop = bodyScroll;
    if (slot.querySelector('textarea')) slot.querySelector('textarea').scrollTop = textScroll;
    if (action) {
      const input = [...slot.querySelectorAll('[data-action]')].find(item => item.dataset.action === action && (!field || item.dataset.field === field));
      input?.focus({ preventScroll: true });
      if (selection && input?.setSelectionRange && !['number','checkbox'].includes(input.type)) input.setSelectionRange(...selection);
    }
  }

  function renderStatus() {
    updateWorkspaceUi();
    const status = shadow?.querySelector('.status');
    if (!status) return;
    for (const button of shadow.querySelectorAll('button[aria-pressed]')) button.setAttribute('aria-pressed', String(button.classList.contains('selected')));
    for (const toggle of shadow.querySelectorAll('.switch input')) toggle.parentElement.title = toggle.checked ? '关闭' : '开启';
    status.className = `status status-${state.saveState}`;
    const undo = state.reorderUndo;
    const canUndo = state.editorUnlocked && undo && undo.presetName === getLoadedPresetName() && JSON.stringify(undo.order) === JSON.stringify(state.preset?.prompts?.map(p => p.id));
    status.innerHTML = `<span class="status-dot"></span><span>${escapeHtml(state.saveMessage)}</span>${canUndo ? `<button type="button" class="text-button sort-undo-button" data-action="sort-undo" ${state.reorderSaving ? 'disabled' : ''}>撤销排序</button>` : ''}`;
  }

  function renderPanel() {
    return `
      <section class="panel" data-tt-mobile-surface="free-window" role="dialog" aria-modal="false" aria-labelledby="destined-title">
        <header class="panel-head" data-panel-drag-handle title="拖动窗口">
          <div><span class="eyebrow">DESTINED JOURNEY</span><h2 id="destined-title">${renderFeatherIcon()}命定之诗 <span>预设设置</span></h2><p>按你的习惯，调整叙事与表达。</p></div>
          <div class="head-actions"><label class="edit-mode-switch"><input type="checkbox" data-action="edit-mode" aria-label="编辑模式" ${state.editorUnlocked?'checked':''} ${state.reorderSaving||state.promptEditor?.saving?'disabled':''}><span>编辑模式</span></label><button type="button" class="secondary-button" data-action="tab" data-tab="advanced">预设条目</button><button class="icon-button" type="button" data-action="close" aria-label="关闭设置">×</button></div>
        </header>
        <div class="configuration-shortcut">${renderConfigurationShortcut()}</div>
        <div class="panel-layout">
          <nav class="tabs" aria-label="设置页面">${renderPlacementNavigation()}</nav>
          <main class="content content-${state.activeTab}" tabindex="-1">${state.preset ? renderActiveTab() : '<div class="empty">无法读取当前预设，请确认已加载命定预设后重新打开。</div>'}</main>
        </div>
        <footer class="status status-${state.saveState}" role="status" aria-live="polite"><span class="status-dot"></span><span>${escapeHtml(state.saveMessage)}</span></footer>
        <span class="sr-only theme-feedback" role="status" aria-live="polite"></span><div class="editor-layer-slot">${renderStyleEditor()}</div><div class="panel-resize-handle" data-panel-resize-handle aria-hidden="true"></div>
      </section>`;
  }

  function renderFold(id, title, description, content) {
    return `<details class="settings-fold" data-disclosure="${id}" ${state.disclosures.has(id) ? 'open' : ''}><summary><span><strong>${escapeHtml(title)}</strong><small>${escapeHtml(description)}</small></span><span class="fold-chevron" aria-hidden="true">⌄</span></summary><div class="fold-body">${content}</div></details>`;
  }

  function renderActiveTab() {
    if (state.activeTab === 'summary') return '<div class="summary-slot"></div>';
    if (state.activeTab === 'settings') return renderSettingsTab();
    if (state.activeTab === 'configurations') return renderConfigurationsTab();
    if (state.activeTab === 'advanced') return renderAdvancedTab();
    return renderPlacementPage(state.activeTab);
  }

  function renderSectionHeader(title, description) {
    return `<div class="section-head"><div><h3>${escapeHtml(title)}</h3><p>${escapeHtml(description)}</p></div></div>`;
  }

  function renderSettingsTab() {
    const entryBlock = authorLayout().blocks.find(block => block.id === 'entry-points');
    return renderSectionHeader('设置', '调整界面外观与打开方式。')
      + '<article class="card appearance-card"><div class="card-title"><div><h4>界面外观</h4><p>主题与透明度仅保存在当前浏览器。</p></div></div>' + renderThemeControl() + '<p class="appearance-note">透明度越低，背景越实；0% 为完全不透明。</p></article>'
      + (entryBlock ? renderPlacementBlock(entryBlock) : renderEntryPointSettings());
  }

  function renderModelTab() {
    const current = detectModelAdapter();
    const tail = getGeminiTail();
    const link = state.config.connection_link;
    return `
      ${current ? '' : '<div class="warning">当前模型条目存在零选、多选或交叉启用。选择一个适配即可修复。</div>'}
      <div class="model-grid">
        ${Object.keys(MODEL_ADAPTERS).map(name => `
          <button type="button" class="model-card ${current === name ? 'selected' : ''}" data-action="model" data-model="${name}" aria-pressed="${current === name}" ${disabledAttribute()}>
            <span class="model-rune">${name === 'Gemini' ? '✦' : name === 'Claude' ? '◇' : '◆'}</span>
            <strong>${escapeHtml(MODEL_ADAPTERS[name].label)}</strong><small>${current === name ? '当前适配' : '点击切换'}</small>
          </button>
        `).join('')}
      </div>
      <article class="card">
        <div class="card-title"><div><h4>Gemini 尾部模式</h4><p>仅在 Gemini 适配时生效。</p></div></div>
        <div class="segmented">
          ${choiceButton('gemini-tail', 'prefill', '预填充', tail === 'prefill', current !== 'Gemini')}
          ${choiceButton('gemini-tail', 'no-prefill', '非预填充', tail === 'no-prefill', current !== 'Gemini')}
        </div>
      </article>
      <article class="card connection-card">
        <div class="card-title">
          <div><h4>切换模型时，一起切换连接</h4><p>为各模型绑定酒馆连接配置；关闭后只切换预设适配。</p></div>
          ${toggleHtml('connection-link', link.enabled, !link.enabled && state.profiles.length === 0)}
        </div>
        ${state.profiles.length === 0 ? `<div class="subtle">${state.profileLoading ? '正在读取连接配置…' : '未发现 Connection Profile；请先在 SillyTavern 中创建。'}</div>` : `
          <div class="profile-grid">
            ${Object.keys(MODEL_ADAPTERS).map(name => renderProfileSelect(name)).join('')}
          </div>
        `}
        <button type="button" class="text-button" data-action="refresh-profiles">刷新连接配置</button>
      </article>
      ${state.config.configuration_error ? '<div class="warning">' + escapeHtml(state.config.configuration_error) + '</div>' : renderCustomModelControls()}
    `;
  }

  function renderProfileSelect(adapterName) {
    const binding = state.config.connection_link.bindings[adapterName];
    const selected = resolveBoundProfile(binding);
    return `
      <label class="field-label"><span>${escapeHtml(MODEL_ADAPTERS[adapterName]?.label ?? adapterName)}</span>
        <select data-action="profile-binding" data-model="${adapterName}" ${disabledAttribute()}>
          <option value="">不绑定</option>
          ${state.profiles.map(profile => `<option value="${escapeHtml(profileKey(profile))}" ${selected && profileKey(selected) === profileKey(profile) ? 'selected' : ''}>${escapeHtml(profile.name)}${profile.model ? ` · ${escapeHtml(profile.model)}` : ''}</option>`).join('')}
        </select>
      </label>
    `;
  }

  function renderNumericControl(key) {
    const definition = FIELD_DEFINITIONS[key];
    const current = readNumericField(key);
    const mode = current.ok ? getNumericMode(key, current.value) : 'custom';
    return `
      <article class="card numeric-card">
        <div class="card-title"><div><h4>${escapeHtml(definition.label)}</h4><p>${escapeHtml(({ hanzi: '每次回复的正文篇幅要求', dialogueRatio: '对白在正文中的占比', dialogueRounds: '角色之间至少来回几轮对白', combatRounds: '每次回复推进几回合战斗' })[key])}</p></div>${['hanzi', 'dialogueRatio'].includes(key) && getPrompt(state.preset, definition.promptId) ? toggleHtml(`prompt:${definition.promptId}`, getPrompt(state.preset, definition.promptId).enabled) : ''}</div>
        <div class="chips">
          ${definition.presets.map(value => `<button type="button" data-action="field-preset" data-field="${key}" data-value="${value}" class="${current.ok && mode === 'preset' && current.value === String(value) ? 'selected' : ''}" ${current.ok ? disabledAttribute() : 'disabled'}>${value}${key === 'dialogueRatio' ? '%' : ''}</button>`).join('')}
          <button type="button" data-action="field-custom" data-field="${key}" class="${mode === 'custom' ? 'selected' : ''}" ${current.ok ? disabledAttribute() : 'disabled'}>自定义</button>
        </div>
        <label class="number-input"><span>自定义</span><input type="text" inputmode="numeric" data-action="field-number" data-field="${key}" value="${current.ok ? escapeHtml(current.value) : ''}" ${current.ok ? disabledAttribute() : 'disabled'}></label>
        <div class="field-error" data-field-error="${key}">${current.ok ? '' : '受管字段缺失或格式异常，已停止写入。'}</div>
      </article>
    `;
  }

  function renderLanguageControl(key) {
    const definition = LANGUAGE_DEFINITIONS[key];
    const current = readLanguageField(key);
    const preset = LANGUAGE_PRESETS.find(([value]) => value === current.value);
    return `
      <article class="card language-card">
        <div class="card-title"><div><h4>${escapeHtml(definition.label)}</h4><p>${escapeHtml(definition.description)}</p></div></div>
        <div class="chips">
          ${LANGUAGE_PRESETS.map(([value, label]) => `<button type="button" data-action="language-preset" data-language="${key}" data-value="${escapeHtml(value)}" class="${current.ok && preset?.[0] === value ? 'selected' : ''}" ${current.ok ? disabledAttribute() : 'disabled'}>${escapeHtml(label)}</button>`).join('')}
          <button type="button" data-action="language-custom" data-language="${key}" class="${current.ok && !preset ? 'selected' : ''}" ${current.ok ? disabledAttribute() : 'disabled'}>自定义</button>
        </div>
        <label class="language-input"><span>自定义</span><input type="text" data-action="language-input" data-language="${key}" value="${current.ok ? escapeHtml(current.value) : ''}" maxlength="80" placeholder="例如：Deutsch" ${current.ok ? disabledAttribute() : 'disabled'}></label>
        <div class="field-error" data-language-error="${key}">${current.ok ? '' : `${escapeHtml(definition.label)}短宏缺失或格式异常。`}</div>
      </article>
    `;
  }

  function renderStyleEditor() {
    const editor = state.styleEditor;
    if (!editor) return '';
    const definition = USER_CREATABLE_GROUPS[editor.groupId];
    if (!definition) return '';
    return `
      <div class="editor-layer" data-action="close-style-editor">
        <article class="card style-editor" role="dialog" aria-modal="true" aria-labelledby="style-editor-title">
          <div class="card-title"><div><h4 id="style-editor-title">${editor.id ? `编辑自定义${definition.label}` : `新增自定义${definition.label}`}</h4><p>预设设置会自动用 &lt;${definition.tag}&gt; 包裹正文。</p></div><button type="button" class="icon-button compact-close" data-action="cancel-style" aria-label="关闭编辑器">×</button></div>
          <label class="field-label"><span>${definition.label}名称</span><input type="text" data-action="style-title" value="${escapeHtml(editor.title)}" placeholder="${editor.groupId === 'base-tone' ? '例如：克制冷峻' : '例如：冷峻冒险史诗'}" ${disabledAttribute()}></label>
          <label class="field-label"><span>提示词正文</span><textarea data-action="style-content" rows="9" placeholder="输入这套${definition.label}需要模型遵循的规则……" ${disabledAttribute()}>${escapeHtml(editor.content)}</textarea></label>
          <div class="editor-actions">
            <button type="button" class="primary-button" data-action="save-style" ${disabledAttribute()}>保存${definition.label}</button>
            <button type="button" class="secondary-button" data-action="cancel-style">取消</button>
          </div>
        </article>
      </div>
    `;
  }

  function renderEntryPointSettings() {
    const points = sanitizeEntryPoints(state.config.entry_points);
    const items = [
      ['floating_orb', '悬浮球', '显示可自由拖动的羽毛悬浮球'],
      ['input_button', '输入框上方按钮', `显示“${BUTTON_NAME}”按钮`],
      ['wand_menu', '魔术棒菜单', '在酒馆魔术棒扩展菜单中显示入口'],
    ];
    return `
      <article class="card entry-point-card">
        <div class="card-title"><div><h4>设置界面入口</h4><p>三个入口可以同时开启；为避免无法再次打开设置，至少保留一个。</p></div></div>
        <div class="toggle-grid">
          ${items.map(([key, label, description]) => `
            <article class="mini-card">
              <div><strong>${escapeHtml(label)}</strong><small>${escapeHtml(description)}</small></div>
              ${toggleHtml(`entry:${key}`, points[key])}
            </article>
          `).join('')}
        </div>
      </article>
    `;
  }

  function defaultAuthorLayout() {
    const pages = [['daily', '日常调整'], ['style', '文风与偏好'], ['tools', '模型与工具']].map(([id, label], order) => ({ id, label, order, hidden: false }));
    const definitions = [
      ['variable', 'daily', '变量处理模式', 'builtin'], ['reply', 'daily', '回复篇幅与对话', 'builtin'],
      ['plot-pace', 'daily', '剧情推进', 'single'], ['person', 'daily', '叙事人称', 'builtin'],
      ['actor-control', 'daily', '抢话控制', 'single'], ['retelling', 'daily', '输入转述', 'single'],
      ['ending', 'daily', '结尾方式', 'single'], ['narrative-extra', 'daily', '叙事增强', 'toggles'],
      ['event-chain', 'daily', '配合世界书事件链', 'builtin'], ['after-body', 'daily', '正文后附加内容', 'toggles'],
      ['base-tone', 'style', '基调', 'single'], ['main-style', 'style', '主文风', 'single'],
      ['style-extra', 'style', '风格增强', 'toggles'], ['beautify', 'style', '美化', 'toggles'],
      ['preference', 'style', '长期叙事偏好', 'builtin'], ['user-additional', 'style', '用户附加设定', 'builtin'],
      ['adult-mode', 'style', '成人内容适配', 'single'], ['content-extra', 'style', '内容偏好与表达约束', 'toggles'],
      ['models', 'tools', '模型与连接', 'builtin'], ['streaming', 'tools', '流式输出', 'builtin'],
      ['helpers', 'tools', '回复辅助', 'toggles'], ['cache', 'tools', '重置命中缓存', 'builtin'],
      ['entry-points', 'tools', '设置入口', 'builtin'], ['unclassified', 'tools', '未分类条目', 'toggles'],
    ];
    return { version: 1, pages, blocks: definitions.map(([id, page, label, kind], order) => ({ id, page, label, kind, order, hidden: false, allowNone: false, defaultId: DEFAULT_GROUP_OPTION_IDS[id] ?? '' })), trash: [] };
  }

  function validateAuthorLayout(value) {
    assertData(plainObject(value) && value.version === 1, '不支持的作者布局版本');
    assertData(Array.isArray(value.pages) && value.pages.length <= 40 && Array.isArray(value.blocks) && value.blocks.length <= 200, '页面或板块数量无效');
    const base = defaultAuthorLayout();
    const ids = new Set();
    const text = (v, max = 100) => typeof v === 'string' && v.trim().length > 0 && v.length <= max;
    const common = item => {
      assertData(plainObject(item) && text(item.id) && /^[a-zA-Z0-9:_-]+$/u.test(item.id) && !['__proto__','constructor','prototype','advanced','author','configurations','settings','hidden'].includes(item.id) && !ids.has(item.id), '页面或板块 ID 无效或重复');
      ids.add(item.id);
      assertData(text(item.label) && Number.isFinite(item.order) && typeof item.hidden === 'boolean', '页面或板块名称、顺序或隐藏状态无效');
      return { id: item.id, label: item.label.trim(), order: item.order, hidden: item.hidden };
    };
    const pages = value.pages.map(common);
    assertData(pages.some(p => !p.hidden), '至少保留一个可见页面');
    // Separate namespaces allow a page and a block to share a legacy identifier.
    ids.clear();
    const blocks = value.blocks.map(item => {
      const result = common(item);
      assertData(pages.some(p => p.id === item.page) && ['builtin','toggles','single'].includes(item.kind), '板块页面或类型无效');
      const original = base.blocks.find(b => b.id === item.id);
      assertData(item.kind !== 'builtin' || original?.kind === 'builtin', '不能创建未知的专用控件');
      assertData(!original || original.kind === item.kind, '不能改变内置板块类型');
      assertData(typeof item.allowNone === 'boolean' && typeof item.defaultId === 'string', '单选组设置无效');
      return { ...result, page: item.page, kind: item.kind, allowNone: item.allowNone, defaultId: item.defaultId };
    });
    for (const block of base.blocks) assertData(blocks.some(b => b.id === block.id), '内置板块可以隐藏，不能删除：' + block.label);
    assertData(Array.isArray(value.trash ?? []) && (value.trash ?? []).length <= 100, '回收站最多保留 100 项，请先清理或导出');
    const trashIds = new Set();
    const trash = (value.trash ?? []).map(item => {
      assertData(plainObject(item) && typeof item.included === 'boolean' && Number.isSafeInteger(item.ordinal) && item.ordinal >= 1 && typeof item.deletedAt === 'string', '回收站记录无效');
      const prompt = snapshotPrompt(item.prompt);
      assertData(!trashIds.has(prompt.id), '回收站包含重复条目'); trashIds.add(prompt.id);
      return { prompt, included: item.included, ordinal: item.ordinal, deletedAt: item.deletedAt };
    });
    return { version: 1, pages, blocks, trash };
  }

  function authorLayout(preset = state.preset) {
    try { return preset?.extensions?.destined_author ? validateAuthorLayout(preset.extensions.destined_author) : defaultAuthorLayout(); }
    catch { return defaultAuthorLayout(); } // Read-only fallback; mutations below reject malformed source data.
  }

  function authorDependency(prompt) {
    if (!prompt) return '';
    if (PROTECTED_IDS.has(prompt.id)) return '基础结构依赖：必须保留并启用，可编辑正文；动态占位符正文由酒馆填入。';
    if (Object.values(BUILTIN_MODEL_ADAPTERS).some(a => [...a.ids, ...a.tails].includes(prompt.id))) return '内置模型适配依赖：通过模型控件切换，不能单独删除。';
    if (MODEL_IDS?.has(prompt.id)) return '自定义模型依赖：请在模型与工具中删除整套模型。';
    if (GROUPS['variable-mode'].options.some(([id]) => id === prompt.id)) return '世界书变量联动依赖：通过变量模式控件切换。';
    if ([IDS.dialogue, IDS.outputLength, IDS.narration, IDS.globalPreference, IDS.userAdditional].includes(prompt.id)) return '数值或文本控件依赖：请保留条目与受管短宏；可以调整显示位置或不显示。';
    if (['main','nsfw','jailbreak','enhanceDefinitions'].includes(prompt.id)) return '酒馆内置条目：可编辑，不能在这里删除。';
    return '';
  }

  function legacyAuthorBlock(prompt) {
    if (PROTECTED_IDS.has(prompt.id)) return 'hidden';
    if (MODEL_IDS.has(prompt.id)) return 'models';
    if (ID_TO_GROUP.has(prompt.id)) return ID_TO_GROUP.get(prompt.id) === 'variable-mode' ? 'variable' : ID_TO_GROUP.get(prompt.id);
    const special = { [IDS.dialogue]: 'reply', [IDS.outputLength]: 'reply', [IDS.narration]: 'person', [IDS.globalPreference]: 'preference', [IDS.userAdditional]: 'user-additional', [IDS.eventChain]: 'event-chain', [IDS.resetCache]: 'cache' };
    if (special[prompt.id]) return special[prompt.id];
    if (AFTER_BODY_IDS.includes(prompt.id)) return 'after-body';
    if (BEAUTIFY_IDS.includes(prompt.id)) return 'beautify';
    for (const [section, list] of Object.entries(CURATED_TOGGLES)) if (list.includes(prompt.id)) return { narrative:'narrative-extra', style:'style-extra', content:'content-extra', system:'helpers' }[section];
    const meta = inferPromptMeta(prompt);
    if (meta.control === 'single-option' && Object.hasOwn(GROUPS, meta.group) && meta.group !== 'variable-mode') return meta.group;
    return 'unclassified';
  }

  function placementEntry(prompt, preset = state.preset) {
    const meta = prompt?.extra?.destined_ui;
    let original = prompt ? legacyAuthorBlock(prompt) : 'unclassified';
    if(prompt&&original==='unclassified')original=inferNativePlacement(prompt,preset).block;
    let block = [2,3].includes(meta?.version) ? meta.block : original;
    if (block !== 'hidden' && !authorLayout(preset).blocks.some(b=>b.id===block)) block='unclassified';
    return { block, order: Number.isFinite(meta?.order) && [2,3].includes(meta.version) ? meta.order : 1000, label: typeof meta?.label==='string'?meta.label:'', description:typeof meta?.description==='string'?meta.description:'' };
  }

  function placementMembers(block, preset=state.preset) {
    return (preset?.prompts??[]).filter(p=>placementEntry(p,preset).block===block);
  }

  function placementSnapshot(preset,id) {
    const prompt=findEditorPrompt(preset,id), entry=placementEntry(prompt,preset);
    const members=placementMembers(entry.block,preset);
    const index=members.findIndex(p=>p.id===id);
    return {block:entry.block,before:index<0?'':members[index+1]?.id??''};
  }

  function writePlacement(prompt,block,order,preset) {
    assertData(block==='hidden'||authorLayout(preset).blocks.some(b=>b.id===block),'所选板块已不存在，请重新选择');
    const group=getPromptGroupId(prompt,preset), previous=prompt.extra?.destined_ui??{};
    prompt.extra??={};
    prompt.extra.destined_ui={version:3,block,order,group:group??'',label:previous.label??'',description:previous.description??'',...(previous.created_by?{created_by:previous.created_by}:{})};
  }

  // Existing prompt IDs and explicit display assignments serve as boundaries; no extra prompts are injected.
  function inferNativePlacement(prompt,preset) {
    const list=preset?.prompts??[],index=list.findIndex(p=>p.id===prompt.id);
    const fallback={block:'unclassified',group:null};
    if(index<0)return fallback;
    const anchor=p=>{
      if(p.id==='3201a47c-47a4-4120-9360-445b4a399c14')return {block:'base-tone',group:'base-tone'};
      if(p.id==='a1acb123-3786-41d4-9287-ff3499d7895a')return {block:'event-chain',group:null};
      const meta=p.extra?.destined_ui;
      const block=[2,3].includes(meta?.version)?meta.block:legacyAuthorBlock(p);
      if(block==='hidden'||block==='models'||PROTECTED_IDS.has(p.id)||MODEL_IDS.has(p.id))return fallback;
      if(block==='unclassified'&&!meta)return null;
      const inferred=inferPromptMeta(p);
      const group=meta?.version===3?meta.group||null:meta?.version===2?authorLayout(preset).blocks.find(b=>b.id===block)?.kind==='single'?block:null:ID_TO_GROUP.get(p.id)??(inferred.control==='single-option'?inferred.group:null);
      return {block,group:group==='variable-mode'?null:group};
    };
    for(let i=index-1;i>=0;i--){const result=anchor(list[i]);if(result)return result;}
    // At the beginning of the list, use the first following recognizable entry.
    for(let i=index+1;i<list.length;i++){const result=anchor(list[i]);if(result)return result;}
    return fallback;
  }

  function nativePlacementIndex(preset,block,before,id) {
    const list=preset.prompts.filter(p=>p.id!==id);
    if(before){
      const index=list.findIndex(p=>p.id===before);
      assertData(index>=0&&placementEntry(list[index],preset).block===block,'目标条目已移动或删除，请重新载入');
      return index;
    }
    const members=placementMembers(block,preset).filter(p=>p.id!==id);
    if(members.length)return list.findIndex(p=>p.id===members.at(-1).id)+1;
    // Empty sections reuse the closest surviving section on the same page.
    const blocks=authorLayout(preset).blocks,home=blocks.find(b=>b.id===block);
    if(home&&block!=='hidden'&&block!=='unclassified'){
      const siblings=blocks.filter(b=>b.page===home.page).sort((a,b)=>Math.abs(a.order-home.order)-Math.abs(b.order-home.order));
      for(const sibling of siblings){
        const candidates=list.filter(p=>placementEntry(p,preset).block===sibling.id&&!PROTECTED_IDS.has(p.id)&&!MODEL_IDS.has(p.id));
        if(candidates.length)return sibling.order<home.order?list.indexOf(candidates.at(-1))+1:list.indexOf(candidates[0]);
      }
    }
    return list.length;
  }

  function savePlacement(preset,prompt,entry,move=true) {
    const group=getPromptGroupId(prompt,preset);
    const included=preset.prompts.some(p=>p.id===prompt.id);
    const index=entry.block!=='hidden'&&move?nativePlacementIndex(preset,entry.block,entry.before,prompt.id):-1;
    writePlacement(prompt,entry.block,0,preset);prompt.extra.destined_ui.group=group??'';
    if(included&&index>=0){preset.prompts=preset.prompts.filter(p=>p.id!==prompt.id);preset.prompts.splice(index,0,prompt);}
  }

  function renderPlacementFields(editor,locked) {
    const value=editor.draft.authorUi,layout=authorLayout(),attr=locked?'disabled':'';
    const options=layout.pages.slice().sort((a,b)=>a.order-b.order).map(page=>`<optgroup label="${escapeHtml(page.label)}${page.hidden?'（页面已隐藏）':''}">${layout.blocks.filter(b=>b.page===page.id).sort((a,b)=>a.order-b.order).map(b=>`<option value="${escapeHtml(b.id)}" ${b.id===value.block?'selected':''}>${escapeHtml(b.label)}${b.hidden?'（板块已隐藏）':''}</option>`).join('')}</optgroup>`).join('');
    const others=placementMembers(value.block).filter(p=>p.id!==editor.id);
    return `<div class="placement-fields"><label class="field-label"><span>显示在哪个板块</span><select data-action="placement-field" data-field="block" ${attr}><option value="hidden" ${value.block==='hidden'?'selected':''}>不在设置页显示</option>${options}</select></label><label class="field-label"><span>板块内的位置</span><select data-action="placement-field" data-field="before" ${locked||value.block==='hidden'?'disabled':''}><option value="">放在最后</option>${others.map(p=>`<option value="${escapeHtml(p.id)}" ${p.id===value.before?'selected':''}>在「${escapeHtml(p.name)}」前面</option>`).join('')}</select></label><p class="subtle">位置会同步到原生发送列表。选择“不显示”只隐藏界面，开关与原有单选关系保持不变。</p></div>`;
  }

  function setPlacementField(field,value) {
    const editor=state.promptEditor;
    if(!editor||!state.editorUnlocked||editor.saving||editor.contextChanged)return;
    setEditorField('authorUi',{...editor.draft.authorUi,[field]:value,...(field==='block'?{before:''}:{})});
    editor.placementRequested=true;
    if(!editor.id)editor.draft.ordinal=nativePlacementIndex(state.preset,editor.draft.authorUi.block,editor.draft.authorUi.before,'')+1;
    renderStyleEditorLayer();
  }

  function renderPlacementNavigation() {
    const pages=authorLayout().pages.filter(p=>!p.hidden).sort((a,b)=>a.order-b.order);
    return [...pages,{id:'summary',label:'总结'},{id:'configurations',label:'配置管理'},{id:'settings',label:'设置'}].map((p,index)=>`<button type="button" data-action="tab" data-tab="${escapeHtml(p.id)}" class="${state.activeTab===p.id?'active':''}" aria-current="${state.activeTab===p.id?'page':'false'}"><span class="nav-index" aria-hidden="true">${String(index+1).padStart(2,'0')}</span><strong>${escapeHtml(p.label)}</strong></button>`).join('');
  }

  function placementEdit(prompt) {
    if(!state.editorUnlocked)return '';
    return `<button type="button" class="text-button placement-edit" data-action="entry-edit" data-id="${escapeHtml(prompt.id)}" aria-label="编辑 ${escapeHtml(prompt.name)}" title="编辑内容与显示位置">编辑</button>`;
  }

  function renderPlacedPrompt(prompt) {
    const meta=placementEntry(prompt),title=meta.label||prompt.name,group=getPromptGroupId(prompt);
    const description=meta.description||(prompt.id===IDS.eventChain?'配合世界书事件链使用；此处只切换预设条目。':prompt.id===IDS.resetCache?'排查命中异常时启用，恢复正常后关闭。':'');
    const edit=placementEdit(prompt);
    if(prompt.id===IDS.dialogue||prompt.id===IDS.outputLength){
      const keys=prompt.id===IDS.dialogue?['dialogueRatio','dialogueRounds']:['hanzi','combatRounds'];
      const languages=prompt.id===IDS.outputLength?'<div class="language-grid">'+['body','thinking'].map(renderLanguageControl).join('')+'</div>':'';
      return '<div class="placed-fields" data-placement-id="'+escapeHtml(prompt.id)+'">'+(edit?'<div class="numeric-edit">'+edit+'</div>':'')+languages+'<div class="field-grid">'+keys.map(renderNumericControl).join('')+'</div></div>';
    }
    let control='',content='';
    if(PROTECTED_IDS.has(prompt.id))control='<span class="badge">必需</span>';
    else if(MODEL_IDS.has(prompt.id)||group==='variable-mode')control='<span class="badge">联动管理</span>';
    else if(group)return '<article class="placed-choice" data-placement-id="'+escapeHtml(prompt.id)+'">'+choiceButton('group',prompt.id,title,prompt.enabled,false,group)+edit+'</article>';
    else control=toggleHtml('prompt:'+prompt.id,prompt.enabled);
    if(prompt.id===IDS.narration)content='<div class="segmented">'+[['first','第一人称'],['second','第二人称'],['third','第三人称']].map(([v,l])=>choiceButton('person',v,l,state.config.managed_values.narration_person===v,!hasManagedMacro(IDS.narration,MANAGED_MACROS.narrationPerson)||!hasManagedMacro(IDS.narration,MANAGED_MACROS.narrationRequirement))).join('')+'</div>';
    else if(prompt.id===IDS.globalPreference){const p=readGlobalPreference();content='<textarea aria-label="长期叙事偏好" data-action="global-preference" rows="4" '+(p.ok?'':'disabled')+'>'+escapeHtml(p.value)+'</textarea><div class="field-error" data-preference-error>'+(p.ok?'':'全局偏好短宏缺失或格式异常。')+'</div>';}
    else if(prompt.id===IDS.userAdditional){const p=readUserAdditionalSetting();content='<textarea aria-label="用户附加设定" data-action="user-additional" rows="4" '+(p.ok?'':'disabled')+'>'+escapeHtml(p.value)+'</textarea><div class="editor-actions"><button class="text-button" data-action="reset-user-additional">恢复默认</button></div><div class="field-error" data-user-additional-error>'+escapeHtml(p.error)+'</div>';}
    return '<article class="placed-prompt '+(content?'placed-wide':'')+'" data-placement-id="'+escapeHtml(prompt.id)+'"><div class="placed-head"><div class="placed-label"><strong>'+escapeHtml(title)+'</strong>'+(description?'<small>'+escapeHtml(description)+'</small>':'')+'</div><div class="placed-actions">'+control+edit+'</div></div>'+content+'</article>';
  }

  function renderPlacementBlock(block) {
    if(block.hidden)return '';
    let prompts=placementMembers(block.id);
    let dedicated='';
    if(block.id==='variable'){
      if(prompts.some(p=>getPromptGroupId(p)==='variable-mode'))dedicated=`<div class="variable-slot">${renderVariablePanel()}</div>`;
      prompts=prompts.filter(p=>getPromptGroupId(p)!=='variable-mode');
    }
    if(block.id==='models'){dedicated=renderModelTab();prompts=prompts.filter(p=>!MODEL_IDS.has(p.id));}
    if(block.id==='streaming')dedicated=`<article class="card"><div class="card-title"><h4>流式输出</h4>${toggleHtml('streaming',state.preset.settings.should_stream===true)}</div></article>`;
    if(block.id==='entry-points')dedicated=renderEntryPointSettings();
    const style=['base-tone','main-style'].includes(block.id);
    if(!dedicated&&!prompts.length&&!style&&!state.editorUnlocked)return '';
    const canAddEntry = !['models', 'streaming', 'entry-points'].includes(block.id);
    const add=!state.editorUnlocked||!canAddEntry?'':style?`<button class="text-button" data-action="new-style" data-group="${block.id}">＋ 新增${block.id==='base-tone'?'基调':'主文风'}</button>`:`<button class="text-button" data-action="entry-new-here" data-block="${escapeHtml(block.id)}">＋ 新增条目</button>`;
    return `<section class="placement-section" data-placement-block="${escapeHtml(block.id)}"><div class="card-title"><h4>${escapeHtml(block.label)}</h4>${add}</div>${dedicated}${prompts.length?`<div class="placement-list">${prompts.map(renderPlacedPrompt).join('')}</div>`:''}</section>`;
  }

  function renderPlacementPage(pageId) {
    const layout=authorLayout(),page=layout.pages.find(p=>p.id===pageId);
    if(!page)return '';
    let html=renderSectionHeader(page.label,state.editorUnlocked?'编辑模式已开启 · 可新增、修改和删除条目':'');
    const blocks=layout.blocks.filter(b=>b.page===pageId&&b.id!=='entry-points').sort((a,b)=>a.order-b.order);
    for(const block of blocks){const content=renderPlacementBlock(block);html+=['after-body','content-extra','adult-mode','entry-points','helpers'].includes(block.id)&&content?renderFold(block.id==='content-extra'?'content-options':block.id,block.label,'按需展开',content):content;}
    return html;
  }

  function repairPlacementGroup(preset,groupId) {
    if(!groupId||groupId==='variable-mode')return;
    const options=getGroupOptions(groupId,preset).map(([id])=>getPrompt(preset,id));
    if(options.some(p=>p.enabled))return;
    const legacy=authorLayout(preset).blocks.find(b=>b.id===groupId);
    if(legacy?.allowNone)return;
    const fallback=options.find(p=>p.id===(legacy?.defaultId||DEFAULT_GROUP_OPTION_IDS[groupId]))??options[0];
    if(fallback)fallback.enabled=true;
  }

  async function editEntryAction(action) {
    const editor=state.promptEditor;
    if(!editor||!state.editorUnlocked||editor.saving||editor.contextChanged)return;
    if(editor.dirty){editor.message='请先保存修改，再'+(action==='entry-copy'?'复制':'删除')+'。';return renderStyleEditorLayer();}
    if(action==='entry-delete'&&authorDependency(findEditorPrompt(state.preset,editor.id))){editor.message=authorDependency(findEditorPrompt(state.preset,editor.id));return renderStyleEditorLayer();}
    if(action==='entry-delete'&&!window.parent.confirm('删除这个条目？'))return;
    editor.saving=true;renderStyleEditorLayer();
    const presetName=editor.presetName,id=editor.id;let newId='';
    const task=saveChain.then(async()=>{
      assertData(getLoadedPresetName()===presetName&&state.promptEditor===editor&&state.editorUnlocked,'预设或编辑状态已变化');
      const latest=getPreset('in_use'),prompt=findEditorPrompt(latest,id);assertData(prompt,'条目已不存在');
      const expected=fingerprintPresetValue(latest);
      if(action==='entry-delete')assertData(!authorDependency(prompt),authorDependency(prompt));
      else assertData(!PLACEHOLDER_IDS.has(id),'动态占位符不能复制');
      newId=action==='entry-copy'?createPromptId():'';
      await commitPresetMutation(action==='entry-copy'?'复制条目':'删除条目',preset=>{
        const current=findEditorPrompt(preset,id),index=preset.prompts.findIndex(p=>p.id===id),group=getPromptGroupId(current,preset);
        if(action==='entry-copy'){
          const copy=snapshotPrompt(current);copy.id=newId;copy.name+=' · 副本';copy.enabled=false;
          // Copy content and display location, but do not inherit a model adapter identity.
          writePlacement(copy,placementEntry(current,preset).block,placementEntry(current,preset).order+0.5,preset);
          copy.extra.destined_ui.group=MODEL_IDS.has(id)||group==='variable-mode'?'':group??'';
          copy.extra.destined_ui.label='';
          if(index>=0)preset.prompts.splice(index+1,0,copy);else(preset.prompts_unused??=[]).push(copy);
        }else{
          preset.prompts=preset.prompts.filter(p=>p.id!==id);preset.prompts_unused=(preset.prompts_unused??[]).filter(p=>p.id!==id);
          repairPlacementGroup(preset,group);
          for(const b of preset.extensions?.destined_author?.blocks??[])if(b.defaultId===id)b.defaultId='';
        }
      },()=>getLoadedPresetName()===presetName&&state.promptEditor===editor&&state.editorUnlocked&&fingerprintPresetValue(getPreset('in_use'))===expected,true);
    });
    saveChain=task.catch(()=>{});
    try{await trackPresetOperation(task);state.promptEditor=null;renderActiveContent(true);if(newId)openPromptEditor(newId);}
    catch(error){editor.message=error.message;}
    finally{editor.saving=false;renderStyleEditorLayer();renderStatus();}
  }

  const PLACEHOLDER_IDS = new Set(['worldInfoBefore', 'personaDescription', 'charDescription', 'charPersonality', 'scenario', 'worldInfoAfter', 'dialogueExamples', 'chatHistory']);
  const SYSTEM_PROMPT_IDS = new Set(['main', 'nsfw', 'jailbreak', 'enhanceDefinitions']);

  function findEditorPrompt(preset, id) {
    return [...(preset.prompts ?? []), ...(preset.prompts_unused ?? [])].find(prompt => prompt.id === id);
  }

  function editorSnapshot(preset, id) {
    const prompt = findEditorPrompt(preset, id);
    if (!prompt) return null;
    const index = (preset.prompts ?? []).findIndex(item => item.id === id);
    return { name: prompt.name, content: prompt.content ?? '', role: prompt.role ?? 'system', enabled: !!prompt.enabled,
      position: clone(prompt.position ?? { type: 'relative' }), included: index >= 0, ordinal: index >= 0 ? index + 1 : preset.prompts.length + 1, authorUi: placementSnapshot(preset,id) };
  }

  function openPromptEditor(id = '') {
    refreshPreset(false);
    const base = id ? editorSnapshot(state.preset, id) : { name: '⚙️ 新条目', content: '', role: 'system', enabled: false, position: { type: 'relative' }, included: true, ordinal: state.preset.prompts.length + 1, authorUi: {block:'unclassified',before:''} };
    if (!base || (!id && !state.editorUnlocked)) return;
    state.promptEditor = { id, presetName: getLoadedPresetName(), base, draft: clone(base), order: state.preset.prompts.map(p => p.id), dirty: false, saving: false, message: '', contextChanged: false };
    state.promptEditor.authorLayout = JSON.stringify(state.preset.extensions?.destined_author ?? null);
    state.styleEditor = null;
    renderStyleEditorLayer();
    queueMicrotask(() => shadow.querySelector('[data-action="prompt-close"]')?.focus());
  }

  function syncPromptEditor() {
    const editor = state.promptEditor;
    if (!editor || editor.saving) return;
    editor.contextChanged = editor.presetName !== getLoadedPresetName();
    if (editor.contextChanged) {
      state.editorUnlocked = false;
      editor.message = '已切换预设，旧草稿保留供复制。关闭后重新打开条目再编辑。';
      return;
    }
    if (!editor.id) return;
    const live = editorSnapshot(state.preset, editor.id);
    if (!live) { editor.message = '该条目已被外部移除，草稿仍保留供复制。'; return; }
    if (!editor.dirty) {
      editor.base = live; editor.draft = clone(live); editor.order = state.preset.prompts.map(p => p.id);
    } else if (!editor.message && JSON.stringify(live) !== JSON.stringify(editor.base)) {
      editor.message = '酒馆中的条目已更新。你的草稿已保留；保存时会合并未编辑字段，同一字段冲突时停止保存。';
    }
  }

  function setEditorField(field, value) {
    const editor = state.promptEditor;
    if (!editor || !state.editorUnlocked || editor.saving || editor.contextChanged) return;
    if (field === 'positionType') editor.draft.position = value === 'in_chat' ? { type: 'in_chat', depth: 4, order: 100 } : { type: 'relative' };
    else if (field === 'depth' || field === 'order') editor.draft.position[field] = value;
    else editor.draft[field] = value;
    editor.dirty = JSON.stringify(editor.draft) !== JSON.stringify(editor.base);
    editor.confirmReload = false;
    editor.message = '';
  }

  function closePromptEditor(discard = false) {
    const editor = state.promptEditor;
    if (editor?.saving) return;
    if (editor?.dirty && !discard) {
      editor.confirmClose = true;
      return renderStyleEditorLayer();
    }
    const id = editor?.id;
    state.promptEditor = null;
    renderStyleEditorLayer();
    [...shadow.querySelectorAll('[data-action="prompt-open"]')].find(e => e.dataset.id === id)?.focus({ preventScroll: true });
  }

  async function savePromptEditor() {
    const editor = state.promptEditor;
    if (!editor || !state.editorUnlocked || editor.saving || editor.contextChanged) return;
    editor.saving = true; editor.message = ''; editor.confirmClose = false;
    renderStyleEditorLayer();
    const task = saveChain.then(async () => {
      if (getLoadedPresetName() !== editor.presetName) throw new Error('预设已切换，未保存旧草稿。');
      if (!state.editorUnlocked || state.promptEditor !== editor) throw new Error('编辑器已锁定，未保存。');
      const latest = clone(getPreset('in_use'));
      const draft = clone(editor.draft);
      draft.name = draft.name.trim();
      if (!draft.name) throw new Error('条目名称不能为空。');
      if (!['system', 'user', 'assistant'].includes(draft.role)) throw new Error('请选择有效的消息角色。');
      if (draft.position.type === 'in_chat') {
        for (const field of ['depth', 'order']) {
          const value = String(draft.position[field]);
          if (!/^\d+$/u.test(value) || !Number.isSafeInteger(Number(value))) throw new Error('深度和同层顺序必须为非负整数。');
          draft.position[field] = Number(value);
        }
      }
      if (!/^\d+$/u.test(String(draft.ordinal)) || !Number.isSafeInteger(Number(draft.ordinal)) || Number(draft.ordinal) < 1) throw new Error('列表序号必须为正整数。');
      draft.ordinal = Number(draft.ordinal);
      const live = editor.id ? editorSnapshot(latest, editor.id) : null;
      if (editor.id && !live) throw new Error('该条目已被外部移除，未覆盖。');
      const fields = ['name', 'content', 'role', 'enabled', 'position', 'included', 'ordinal', 'authorUi'];
      const changed = fields.filter(key => !editor.id || JSON.stringify(draft[key]) !== JSON.stringify(editor.base[key]));
      if (findEditorPrompt(latest,editor.id)?.extra?.destined_ui?.version !== 3 && !changed.includes('authorUi')) changed.push('authorUi');
      const names = { name: '名称', content: '正文', role: '消息角色', enabled: '启用状态', position: '插入位置', included: '列表位置', ordinal: '列表顺序', authorUi:'界面展示' };
      for (const field of changed) {
        if (live && JSON.stringify(live[field]) !== JSON.stringify(editor.base[field]) && JSON.stringify(live[field]) !== JSON.stringify(draft[field])) throw new Error(`「${names[field]}」已被酒馆中的其他操作修改。草稿已保留，请复制需要的文字后重新载入。`);
      }
      const placementMoving=(editor.placementRequested||!!editor.id)&&JSON.stringify(draft.authorUi)!==JSON.stringify(editor.base.authorUi)&&draft.authorUi.block!=='hidden';
      const moving = changed.includes('ordinal') || changed.includes('included');
      if (changed.includes('authorUi') && JSON.stringify(latest.extensions?.destined_author ?? null) !== editor.authorLayout) throw new Error('页面或分组已变化，请重新载入条目后调整展示设置。');
      if (editor.id && (moving||placementMoving) && JSON.stringify(latest.prompts.map(p => p.id)) !== JSON.stringify(editor.order)) throw new Error('列表顺序已在酒馆中改变，请重新载入后调整顺序。');
      if (PROTECTED_IDS.has(editor.id) && (!draft.enabled || !draft.included)) throw new Error('此项是必需基础条目，必须保留并启用。');
      const groupId = editor.id ? getPromptGroupId(findEditorPrompt(latest, editor.id)) : null;
      if ((MODEL_IDS.has(editor.id) || groupId === 'variable-mode') && (changed.includes('enabled') || changed.includes('included'))) throw new Error('模型和变量模式请通过对应的联动选项切换。');
      if (groupId && changed.includes('enabled') && !draft.enabled) throw new Error('互斥组选项请通过选择另一项关闭。');
      if (groupId && changed.includes('included') && authorDependency(findEditorPrompt(latest,editor.id))) throw new Error('互斥组条目需要保留在发送列表中。');
      const id = editor.id || createPromptId();
      const maxOrdinal = latest.prompts.length + (live?.included ? 0 : 1);
      if (draft.included && moving && draft.ordinal > maxOrdinal) throw new Error(`列表序号不能超过 ${maxOrdinal}。`);
      const expected = fingerprintPresetValue(latest);
      const guard = () => !destroyed && state.editorUnlocked && state.promptEditor === editor && getLoadedPresetName() === editor.presetName && fingerprintPresetValue(getPreset('in_use')) === expected;
      await commitPresetMutation('预设条目', preset => {
        let prompt = findEditorPrompt(preset, id);
        if (!prompt) { prompt = { id, name: draft.name, content: draft.content, role: draft.role, enabled: draft.enabled, position: draft.position }; (preset.prompts_unused ??= []).push(prompt); }
        for (const field of changed) {
          if (field === 'included' || field === 'ordinal' || field === 'authorUi') continue;
          if (field === 'content' && PLACEHOLDER_IDS.has(id)) continue;
          if (field === 'position' && SYSTEM_PROMPT_IDS.has(id)) continue;
          prompt[field] = clone(draft[field]);
        }
        if (changed.includes('authorUi')) {
          savePlacement(preset,prompt,draft.authorUi,false);
          prompt.extra.destined_ui.group=groupId??'';
        }
        if (changed.includes('name') && prompt.extra?.destined_ui) prompt.extra.destined_ui.label='';
        if (PROTECTED_IDS.has(id)) prompt.enabled = true;
        if (groupId && changed.includes('enabled') && draft.enabled) for (const other of preset.prompts) if (other.id !== id && getPromptGroupId(other) === groupId) other.enabled = false;
        if (moving || !editor.id) {
          preset.prompts = preset.prompts.filter(p => p.id !== id);
          preset.prompts_unused = (preset.prompts_unused ?? []).filter(p => p.id !== id);
          if (draft.included) preset.prompts.splice(draft.ordinal - 1, 0, prompt);
          else preset.prompts_unused.push(prompt);
        }
        if(draft.included&&placementMoving)savePlacement(preset,prompt,draft.authorUi);
        if(changed.includes('included'))repairPlacementGroup(preset,groupId);
      }, guard, true);
      editor.id = id;
      editor.base = editorSnapshot(state.preset, id); editor.draft = clone(editor.base); editor.order = state.preset.prompts.map(p => p.id);
      editor.dirty = false; editor.message = '已同步到酒馆当前预设，并保存到预设文件。';
      editor.authorLayout = JSON.stringify(state.preset.extensions?.destined_author ?? null);
    });
    saveChain = task.catch(() => {});
    try { await trackPresetOperation(task); }
    catch (error) { editor.message = error instanceof Error ? error.message : String(error); }
    finally { editor.saving = false; renderActiveContent(true); }
  }

  function renderPromptEditor() {
    const editor = state.promptEditor;
    if (!editor) return '';
    const d = editor.draft;
    const locked = !state.editorUnlocked || editor.saving || editor.contextChanged;
    const attr = locked ? 'disabled' : '';
    const readonly = locked ? 'readonly' : '';
    const required = PROTECTED_IDS.has(editor.id);
    const linked = MODEL_IDS.has(editor.id) || getPromptGroupId(findEditorPrompt(state.preset, editor.id)) === 'variable-mode';
    const placeholder = PLACEHOLDER_IDS.has(editor.id);
    const system = SYSTEM_PROMPT_IDS.has(editor.id);
    const group = getPromptGroupId(findEditorPrompt(state.preset, editor.id));
    const enabledLocked = locked || required || linked || (group && editor.base.enabled);
    return `<div class="editor-layer prompt-editor-layer"><article class="prompt-editor" role="dialog" aria-modal="true" aria-labelledby="prompt-editor-title">
      <header class="prompt-editor-head"><div><span class="eyebrow">PRESET EDITOR</span><h3 id="prompt-editor-title">${editor.id ? escapeHtml(editor.base.name) : '新建预设条目'}</h3><p>${locked ? '只读 · 可以选择、复制完整内容' : '编辑中 · 保存后同步到酒馆'}${editor.dirty ? ' · 有未保存修改' : ''}</p></div><button type="button" class="icon-button" data-action="prompt-close" aria-label="关闭条目编辑器" ${editor.saving ? 'disabled' : ''}>×</button></header>
      <div class="prompt-editor-body">
${required||placeholder?`<p class="editor-note">${required?'必需条目 · 保持启用':'酒馆动态占位符'}</p>`:''}
        ${linked ? '<p class="editor-note">模型与变量开关由联动选项管理，请在日常调整或模型与工具中切换。</p>' : ''}
        <label class="field-label"><span>条目名称</span><input data-action="prompt-field" data-field="name" value="${escapeHtml(d.name)}" ${readonly}></label>
        <div class="editor-checks"><label><input type="checkbox" aria-label="启用条目" data-action="prompt-field" data-field="enabled" ${d.enabled?'checked':''} ${enabledLocked?'disabled':''}>启用条目</label></div>
        ${renderPlacementFields(editor,locked)}
        <label class="field-label prompt-content-label"><span>完整正文${placeholder?' · 由酒馆在发送时填入':''}</span><textarea spellcheck="false" data-action="prompt-field" data-field="content" ${locked||placeholder?'readonly':''} placeholder="${placeholder?'这是动态占位符，实际内容来自角色卡、世界书或聊天记录。':'输入提示词正文；宏和模板代码会原样保存。'}">${escapeHtml(d.content)}</textarea></label>
        <div class="entry-operations">${editor.id ? `<button type="button" class="secondary-button" data-action="entry-copy" ${locked||placeholder?'disabled':''}>复制条目</button><button type="button" class="danger-button" data-action="entry-delete" ${locked||authorDependency(findEditorPrompt(state.preset,editor.id))?'disabled':''}>删除条目</button>` : ''}</div>
        <details class="editor-properties" ${editor.propertiesOpen ? 'open' : ''}><summary>发送设置 <small>${escapeHtml(d.role)} · ${d.included ? `列表第 ${escapeHtml(d.ordinal)} 项` : '未加入列表'}${d.position.type === 'in_chat' ? ` · 深度 ${escapeHtml(d.position.depth)}` : ''}</small></summary>
        <label class="field-label"><span>消息角色</span><select data-action="prompt-field" data-field="role" ${attr}>${['system','user','assistant'].map(role=>`<option value="${role}" ${d.role===role?'selected':''}>${({system:'系统',user:'用户',assistant:'助手'})[role]}</option>`).join('')}</select></label>
        <div class="editor-checks"><label><input type="checkbox" aria-label="加入发送列表" data-action="prompt-field" data-field="included" ${d.included?'checked':''} ${locked||required||linked?'disabled':''}>加入发送列表</label></div>
        <div class="prompt-position"><label class="field-label"><span>列表序号</span><span class="editor-order-control"><button type="button" data-action="prompt-step" data-value="-1" aria-label="上移一位" ${locked||!d.included||Number(d.ordinal)<=1?'disabled':''}>↑</button><input type="number" min="1" data-action="prompt-field" data-field="ordinal" value="${escapeHtml(d.ordinal)}" ${locked||!d.included?'disabled':''}><button type="button" data-action="prompt-step" data-value="1" aria-label="下移一位" ${locked||!d.included||Number(d.ordinal)>=(state.preset.prompts.length+(editor.base.included&&editor.id?0:1))?'disabled':''}>↓</button></span></label>
        <label class="field-label"><span>插入位置</span><select data-action="prompt-field" data-field="positionType" ${locked||system?'disabled':''}><option value="relative" ${d.position.type==='relative'?'selected':''}>按列表顺序</option><option value="in_chat" ${d.position.type==='in_chat'?'selected':''}>聊天内指定深度</option></select></label>
        ${d.position.type==='in_chat'?`<label class="field-label"><span>聊天深度</span><input type="number" min="0" data-action="prompt-field" data-field="depth" value="${escapeHtml(d.position.depth)}" ${attr}></label><label class="field-label"><span>同层顺序</span><input type="number" min="0" data-action="prompt-field" data-field="order" value="${escapeHtml(d.position.order)}" ${attr}></label>`:''}</div></details>
        <details class="editor-reference"><summary>条目信息</summary><code>${escapeHtml(editor.id||'保存时生成 ID')}</code><p>列表序号对应完整发送列表。聊天内条目还受深度和同层顺序控制；未加入列表的条目不会发送。</p></details>
      </div><footer class="prompt-editor-footer"><div class="editor-feedback" role="status" aria-live="polite">${escapeHtml(editor.message || (editor.dirty?'修改尚未保存。':'原生界面修改会同步到这里。'))}</div>
      ${editor.confirmClose?'<div class="editor-actions"><span>放弃尚未保存的修改？</span><button class="danger-button" data-action="prompt-discard">放弃修改</button><button class="secondary-button" data-action="prompt-continue">继续编辑</button></div>':`<div class="editor-actions"><button type="button" class="primary-button" data-action="prompt-save" ${locked||(!editor.dirty&&editor.id)?'disabled':''}>${editor.saving?'正在保存…':'保存修改'}</button><button type="button" class="secondary-button" data-action="prompt-reload" ${editor.saving||editor.contextChanged||!editor.id?'disabled':''}>重新载入</button><button type="button" class="secondary-button" data-action="prompt-close" ${editor.saving?'disabled':''}>返回列表</button></div>`}</footer></article></div>`;
  }

  let promptSort = null;
  let sortClickUntil = 0;

  function canSortPrompts() {
    return state.open && state.activeTab === 'advanced' && state.editorUnlocked && !state.promptEditor
      && !state.reorderSaving && state.entryFilter === 'all' && !state.search.trim();
  }

  function sortAnnouncement(message) {
    const live = shadow?.querySelector('.sort-live');
    if (live) live.textContent = message;
  }

  function cancelPromptSort(message = '') {
    const drag = promptSort;
    if (!drag) return;
    promptSort = null;
    clearTimeout(drag.timer);
    window.parent.cancelAnimationFrame(drag.frame);
    drag.dispose();
    drag.row.classList.remove('sort-source', 'sort-pending');
    drag.handle.removeAttribute('aria-pressed');
    drag.ghost?.remove(); drag.line?.remove();
    app?.classList.remove('sorting-prompts');
    try { drag.handle.releasePointerCapture(drag.pointerId); } catch { /* pointer already released */ }
    if (drag.active) sortClickUntil = Date.now() + 350;
    if (message) sortAnnouncement(message);
  }

  async function savePromptOrder(id, ordinal, expectedOrder, presetName, undo = false) {
    if (!state.editorUnlocked || state.reorderSaving || !state.open) return;
    state.reorderSaving = true;
    const task = saveChain.then(async () => {
      if (destroyed || !state.editorUnlocked || getLoadedPresetName() !== presetName) throw new Error('预设或编辑状态已变化，未调整顺序。');
      const latest = clone(getPreset('in_use'));
      const order = latest.prompts.map(prompt => prompt.id);
      if (JSON.stringify(order) !== JSON.stringify(expectedOrder)) throw new Error('酒馆中的条目顺序已变化，已保留最新列表，请重新拖动。');
      const from = order.indexOf(id);
      if (from < 0 || !Number.isInteger(ordinal) || ordinal < 1 || ordinal > order.length) throw new Error('目标位置已失效，请重新拖动。');
      if (from === ordinal - 1) return;
      const expected = fingerprintPresetValue(latest);
      const guard = () => !destroyed && state.editorUnlocked && getLoadedPresetName() === presetName && fingerprintPresetValue(getPreset('in_use')) === expected;
      await commitPresetMutation(undo ? '撤销拖动排序' : '拖动排序', preset => {
        const index = preset.prompts.findIndex(prompt => prompt.id === id);
        const [prompt] = preset.prompts.splice(index, 1);
        preset.prompts.splice(ordinal - 1, 0, prompt);
      }, guard, true);
      state.reorderUndo = undo ? null : { id, ordinal: from + 1, order: state.preset.prompts.map(p => p.id), presetName };
      setSaveStatus('saved', undo ? '已撤销排序，并同步到酒馆' : `已移至第 ${ordinal} 项，并同步到酒馆`);
    });
    saveChain = task.catch(() => {});
    renderActiveContent(true);
    try { await trackPresetOperation(task); }
    catch (error) { refreshPreset(false); setSaveStatus('error', error instanceof Error ? error.message : String(error)); }
    finally {
      state.reorderSaving = false;
      renderActiveContent(true);
      renderStatus();
      const row = [...(shadow?.querySelectorAll('.prompt-sort-row') ?? [])].find(row => row.dataset.sortId === id);
      row?.classList.add('sort-just-moved');
      row?.querySelector('.sort-handle')?.focus({ preventScroll: true });
    }
  }

  function handlePromptSortPointerDown(event) {
    const handle = event.target.closest('.sort-handle');
    if (!handle || handle.disabled || !canSortPrompts() || event.button !== 0 || event.isPrimary === false) return;
    cancelPromptSort();
    event.preventDefault(); event.stopPropagation();
    const row = handle.closest('.prompt-sort-row');
    const content = shadow.querySelector('.content');
    const order = state.preset.prompts.map(prompt => prompt.id);
    const id = row.dataset.sortId;
    const touch = event.pointerType === 'touch';
    const startScroll = content.scrollTop;
    const others = [...shadow.querySelectorAll('.prompt-sort-row')].filter(item => item !== row).map(item => {
      const rect = item.getBoundingClientRect();
      return { top: rect.top, bottom: rect.bottom, center: (rect.top + rect.bottom) / 2 };
    });
    const drag = { id, handle, row, content, order, others, startScroll, presetName: getLoadedPresetName(),
      pointerId: event.pointerId, x: event.clientX, y: event.clientY, startX: event.clientX, startY: event.clientY,
      touch, active: false, hasMoved: false, index: order.indexOf(id), frame: 0, timer: 0, lastTime: 0, dispose: () => {} };
    promptSort = drag;
    row.classList.add('sort-pending');
    handle.focus({ preventScroll: true });
    try { handle.setPointerCapture(event.pointerId); } catch { /* document listeners still track it */ }

    const frame = time => {
      if (promptSort !== drag || !drag.active) return;
      if (!canSortPrompts() || !row.isConnected || drag.presetName !== getLoadedPresetName()) return cancelPromptSort('列表已变化，拖动已取消。');
      const rect = content.getBoundingClientRect();
      const dt = Math.min(32, drag.lastTime ? time - drag.lastTime : 16);
      drag.lastTime = time;
      const insideX = drag.x >= rect.left && drag.x <= rect.right;
      const edge = Math.min(60, rect.height / 4);
      let speed = 0;
      if (drag.hasMoved && insideX && drag.y >= rect.top - 24 && drag.y <= rect.bottom + 24) {
        if (drag.y < rect.top + edge) speed = -650 * Math.min(1, (rect.top + edge - drag.y) / edge);
        else if (drag.y > rect.bottom - edge) speed = 650 * Math.min(1, (drag.y - rect.bottom + edge) / edge);
      }
      if (speed) content.scrollTop += speed * dt / 1000;
      const delta = content.scrollTop - startScroll;
      const index = others.findIndex(item => drag.y < item.center - delta);
      const next = index < 0 ? others.length : index;
      if (drag.index !== next) {
        drag.index = next;
        sortAnnouncement(`移至第 ${next + 1} 项，松开保存；Escape 取消。`);
      }
      const boundary = next < others.length ? others[next].top - delta - 4 : (others.at(-1)?.bottom ?? row.getBoundingClientRect().bottom) - delta + 4;
      drag.line.style.cssText = `left:${rect.left + 8}px;top:${Math.max(rect.top + 2, Math.min(rect.bottom - 3, boundary))}px;width:${Math.max(0, rect.width - 24)}px;display:${insideX ? 'block' : 'none'}`;
      const width = Math.min(280, rect.width - 24);
      drag.ghost.style.width = `${width}px`;
      drag.ghost.style.left = `${Math.max(rect.left + 8, Math.min(rect.right - width - 8, drag.x + 16))}px`;
      drag.ghost.style.top = `${Math.max(rect.top, Math.min(rect.bottom - 64, drag.y + (touch ? -76 : 16)))}px`;
      drag.ghost.querySelector('small').textContent = insideX ? `第 ${order.indexOf(id) + 1} 项 → 第 ${next + 1} 项 · 松开保存` : '移回列表继续，或松开取消';
      drag.frame = window.parent.requestAnimationFrame(frame);
    };
    const activate = () => {
      if (promptSort !== drag) return;
      drag.active = true;
      row.classList.remove('sort-pending'); row.classList.add('sort-source');
      app.classList.add('sorting-prompts'); handle.setAttribute('aria-pressed', 'true');
      drag.ghost = window.parent.document.createElement('div');
      drag.ghost.className = 'sort-ghost'; drag.ghost.setAttribute('aria-hidden', 'true');
      drag.ghost.innerHTML = `<strong>${escapeHtml(getPrompt(state.preset, id)?.name ?? '')}</strong><small></small>`;
      drag.line = window.parent.document.createElement('div'); drag.line.className = 'sort-drop-line';
      drag.line.setAttribute('aria-hidden', 'true'); app.append(drag.ghost, drag.line);
      sortAnnouncement(`正在移动 ${getPrompt(state.preset, id)?.name}。松开保存，Escape 取消。`);
      drag.frame = window.parent.requestAnimationFrame(frame);
    };
    const onMove = e => {
      if (e.pointerId !== drag.pointerId || promptSort !== drag) return;
      drag.x = e.clientX; drag.y = e.clientY;
      const distance = Math.hypot(drag.x - drag.startX, drag.y - drag.startY);
      if (!drag.active && touch && distance > 9) return cancelPromptSort('未进入拖动；可在条目文字区域滑动列表。');
      if (!drag.active && !touch && distance >= 5) activate();
      if (drag.active && distance >= 5) drag.hasMoved = true;
      if (drag.active) e.preventDefault();
    };
    const onUp = e => {
      if (e.pointerId !== drag.pointerId || promptSort !== drag) return;
      const rect = content.getBoundingClientRect();
      const valid = drag.active && e.clientX >= rect.left && e.clientX <= rect.right && e.clientY >= rect.top && e.clientY <= rect.bottom;
      // Recompute from the release position, even if pointerup arrives before the next animation frame.
      const delta = content.scrollTop - startScroll;
      const next = others.findIndex(item => e.clientY < item.center - delta);
      const ordinal = (next < 0 ? others.length : next) + 1;
      cancelPromptSort(valid ? '' : '已取消拖动，顺序未改变。');
      if (valid && ordinal !== order.indexOf(id) + 1) void savePromptOrder(id, ordinal, order, drag.presetName);
      else if (valid) sortAnnouncement('位置未改变。');
    };
    const onCancel = e => { if (e.pointerId === drag.pointerId) cancelPromptSort('已取消拖动，顺序未改变。'); };
    const onBlur = () => cancelPromptSort('已取消拖动，顺序未改变。');
    const onKey = e => { if (e.key === 'Escape' && promptSort === drag) { e.preventDefault(); e.stopPropagation(); cancelPromptSort('已取消拖动，顺序未改变。'); } };
    const doc = window.parent.document;
    doc.addEventListener('pointermove', onMove, { passive: false });
    doc.addEventListener('pointerup', onUp); doc.addEventListener('pointercancel', onCancel);
    doc.addEventListener('keydown', onKey, true);
    handle.addEventListener('lostpointercapture', onCancel);
    window.parent.addEventListener('blur', onBlur);
    drag.dispose = () => {
      doc.removeEventListener('pointermove', onMove); doc.removeEventListener('pointerup', onUp);
      doc.removeEventListener('pointercancel', onCancel); doc.removeEventListener('keydown', onKey, true);
      handle.removeEventListener('lostpointercapture', onCancel); window.parent.removeEventListener('blur', onBlur);
    };
    if (touch) drag.timer = setTimeout(activate, 180);
  }

  function renderAdvancedTab() {
    const query = state.search.trim().toLocaleLowerCase('zh-CN');
    const sortable = canSortPrompts();
    const used = (state.preset.prompts ?? []).map((prompt, nativeIndex) => ({ prompt, nativeIndex }));
    const unused = (state.preset.prompts_unused ?? []).map(prompt => ({ prompt, nativeIndex: -1 }));
    const source = state.entryFilter === 'unused' ? unused : used;
    const prompts = source.filter(({ prompt }) => !['enabled','disabled'].includes(state.entryFilter) || !!prompt.enabled === (state.entryFilter === 'enabled'))
      .filter(({ prompt }) => !query || `${prompt.name} ${prompt.id} ${prompt.content ?? ''}`.toLocaleLowerCase('zh-CN').includes(query));
    return `${renderSectionHeader('预设条目', `按酒馆发送列表排列 · ${used.length} 项，未加入 ${unused.length} 项`)}

      <div class="entry-filters segmented wrap">${[['all','发送列表'],['enabled','已启用'],['disabled','已关闭'],['unused','未加入']].map(([value,label])=>choiceButton('entry-filter',value,label,state.entryFilter===value)).join('')}${state.editorUnlocked?'<button type="button" data-action="prompt-new">＋ 新建条目</button>':''}</div>
      <label class="search"><span aria-hidden="true">⌕</span><input aria-label="搜索预设条目" type="search" data-action="search" value="${escapeHtml(state.search)}" placeholder="搜索名称或完整正文"></label>
      <div class="sort-help"><span>${state.reorderSaving ? '正在同步顺序…' : !state.editorUnlocked ? '顶部开启编辑模式后可修改条目。' : sortable ? '拖动左侧手柄排序；手机按住手柄再移动，文字区域可正常滑动。' : '排序需显示完整发送列表，避免遗漏隐藏条目。'}</span>${state.editorUnlocked && !sortable && !state.reorderSaving ? '<button type="button" class="text-button" data-action="sort-show-all">显示完整列表</button>' : ''}</div><div class="sort-live sr-only" role="status" aria-live="polite" aria-atomic="true"></div>
      <div class="advanced-list">${prompts.map(({prompt,nativeIndex})=>`<article class="advanced-item prompt-sort-row" data-sort-id="${escapeHtml(prompt.id)}">${state.editorUnlocked && nativeIndex >= 0 ? `<button type="button" class="sort-handle" data-action="sort-grip" data-id="${escapeHtml(prompt.id)}" aria-label="拖动排序：${escapeHtml(prompt.name)}" title="拖动排序；键盘可用 Alt + ↑ / ↓" ${sortable?'':'disabled'}><span aria-hidden="true">⠿</span></button>` : ''}<button type="button" class="prompt-row" data-action="prompt-open" data-id="${escapeHtml(prompt.id)}"><span class="prompt-index">${nativeIndex<0?'—':String(nativeIndex+1).padStart(2,'0')}</span><span class="entry-state ${nativeIndex>=0&&prompt.enabled?'on':'off'}"></span><span class="entry-title"><strong>${escapeHtml(prompt.name)}</strong><small>${nativeIndex<0?'未加入':prompt.enabled?'已启用':'已关闭'} · ${escapeHtml(prompt.role??'system')}${prompt.position?.type==='in_chat'?` · 深度 ${escapeHtml(prompt.position.depth)}`:''}</small></span>${PROTECTED_IDS.has(prompt.id)?'<span class="badge">必需</span>':''}<span class="row-arrow" aria-hidden="true">↗</span></button></article>`).join('')||'<div class="empty">没有匹配的条目。</div>'}</div>`;

  }

  function toggleHtml(key, checked, disabled = false) {
    const label = key.startsWith('prompt:') ? getPrompt(state.preset, key.slice(7))?.name : ({ streaming: '流式输出', 'connection-link': '联动连接配置', 'entry:floating_orb': '悬浮球入口', 'entry:input_button': '输入框按钮入口', 'entry:wand_menu': '魔术棒入口' })[key];
    return `<label class="switch" title="${checked ? '关闭' : '开启'}"><input type="checkbox" role="switch" aria-label="${escapeHtml(label || key)}" data-action="toggle" data-key="${escapeHtml(key)}" ${checked ? 'checked' : ''} ${disabled ? 'disabled' : ''}><span></span></label>`;
  }

  function choiceButton(action, value, label, selected, disabled = false, groupId = '') {
    return `<button type="button" data-action="${action}" aria-pressed="${selected}" data-value="${escapeHtml(value)}" ${groupId ? `data-group="${escapeHtml(groupId)}"` : ''} class="${selected ? 'selected' : ''}" ${disabled ? 'disabled' : ''}>${escapeHtml(label)}</button>`;
  }

  function disabledAttribute() {
    return '';
  }

  function loadUiState() {
    try {
      const parsed = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? '{}');
      return { ...(parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {}), ...volatileUiState };
    } catch {
      return { ...volatileUiState };
    }
  }

  function saveUiState(value) {
    volatileUiState = value;
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
      volatileUiState = {};
      return true;
    } catch {
      // Private mode / full storage must not prevent opening or moving settings.
      return false;
    }
  }

  function renderThemeControl() {
    return '<div class="appearance-controls"><label class="theme-control" title="界面主题，仅保存在当前浏览器"><span>主题</span><select data-action="ui-theme" aria-label="界面主题">'
      + UI_THEMES.map(theme => '<option value="' + theme.id + '"' + (currentTheme === theme.id ? ' selected' : '') + '>' + theme.label + '</option>').join('')
      + '</select></label><label class="transparency-control" title="0% 不透明，数值越大越通透；仅保存在当前浏览器"><span>透明度</span><input type="range" min="0" max="10" step="1" value="' + currentTransparency + '" data-action="ui-transparency" aria-label="界面透明度" aria-valuetext="' + currentTransparency + '%"><output data-transparency-value>' + currentTransparency + '%</output></label></div>';
  }

  function normalizeTransparency(value) {
    // Accept the previous 0–30 range when loading, then cap it at the new maximum.
    return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 30 ? Math.min(10, Math.round(value)) : 1;
  }

  function applyTransparency(value = currentTransparency, persist = false) {
    currentTransparency = normalizeTransparency(value);
    app?.style.setProperty('--panel-opacity', String(1 - currentTransparency / 100));
    const slider = shadow?.querySelector('[data-action="ui-transparency"]');
    if (slider) { if (Number(slider.value) !== currentTransparency) slider.value = currentTransparency; slider.setAttribute('aria-valuetext', currentTransparency + '%'); }
    const output = shadow?.querySelector('[data-transparency-value]');
    if (output) output.textContent = currentTransparency + '%';
    if (persist) {
      const saved = saveUiState({ ...loadUiState(), transparency: currentTransparency });
      const feedback = shadow?.querySelector('.theme-feedback');
      if (feedback) {
        feedback.textContent = '透明度已设为' + currentTransparency + '%' + (saved ? '' : '；浏览器存储不可用，本次会话有效。');
        feedback.classList.toggle('sr-only', saved);
      }
    }
  }

  function applyTheme(value = currentTheme, persist = false) {
    const theme = UI_THEMES.find(item => item.id === value) ?? UI_THEMES[0];
    currentTheme = theme.id;
    if (app) app.dataset.theme = currentTheme;
    applyTransparency();
    const select = shadow?.querySelector('[data-action="ui-theme"]');
    if (select) select.value = currentTheme;
    if (persist) {
      const saved = saveUiState({ ...loadUiState(), theme: currentTheme });
      const feedback = shadow?.querySelector('.theme-feedback');
      if (feedback) {
        feedback.textContent = saved ? '已切换为' + theme.label : '已切换为' + theme.label + '；浏览器存储不可用，本次会话有效。';
        feedback.classList.toggle('sr-only', saved);
      }
    }
  }

  function isMobileViewport() {
    const parentWindow = window.parent;
    const width = parentWindow.innerWidth;
    const height = parentWindow.innerHeight;
    const coarsePointer = parentWindow.matchMedia?.('(hover: none) and (pointer: coarse)')?.matches === true;
    const touchCapable = coarsePointer || Number(parentWindow.navigator?.maxTouchPoints ?? 0) > 0;
    const screenWidth = Number(parentWindow.screen?.width ?? width);
    const screenHeight = Number(parentWindow.screen?.height ?? height);
    const phoneSizedScreen = Math.min(screenWidth, screenHeight) <= MOBILE_BREAKPOINT;
    return width <= MOBILE_BREAKPOINT || (touchCapable && phoneSizedScreen);
  }

  function clampNumber(value, minimum, maximum) {
    return Math.min(Math.max(value, minimum), maximum);
  }

  function getViewportInsets() {
    const parentWindow = window.parent;
    const parentDocument = parentWindow.document;
    const rootStyle = parentWindow.getComputedStyle(parentDocument.documentElement);
    const bodyStyle = parentDocument.body ? parentWindow.getComputedStyle(parentDocument.body) : null;
    const readInset = name => {
      const value = Number.parseFloat(bodyStyle?.getPropertyValue(name) || rootStyle.getPropertyValue(name));
      return Number.isFinite(value) ? Math.max(0, value) : 0;
    };
    return {
      top: readInset('--tt-inset-top'),
      right: readInset('--tt-inset-right'),
      bottom: readInset('--tt-inset-bottom'),
      left: readInset('--tt-inset-left'),
    };
  }

  function getMobilePanelGeometry() {
    const parentWindow = window.parent;
    const viewport = parentWindow.visualViewport;
    const viewportWidth = viewport?.width || parentWindow.innerWidth;
    const viewportHeight = viewport?.height || parentWindow.innerHeight;
    const offsetLeft = viewport?.offsetLeft || 0;
    const offsetTop = viewport?.offsetTop || 0;
    const insets = getViewportInsets();
    const margin = 8;
    const x = offsetLeft + insets.left + margin;
    const y = offsetTop + insets.top + margin;
    const width = Math.max(1, viewportWidth - insets.left - insets.right - margin * 2);
    const height = Math.max(1, viewportHeight - insets.top - insets.bottom - margin * 2);
    return { x, y, width, height };
  }

  function clampPanelGeometry(raw = {}) {
    const viewportWidth = window.parent.innerWidth;
    const viewportHeight = window.parent.innerHeight;
    const maxWidth = Math.max(1, viewportWidth - PANEL_VIEWPORT_MARGIN * 2);
    const maxHeight = Math.max(1, viewportHeight - PANEL_VIEWPORT_MARGIN * 2);
    const minWidth = Math.min(PANEL_MIN_WIDTH, maxWidth);
    const minHeight = Math.min(PANEL_MIN_HEIGHT, maxHeight);
    const fallbackWidth = Math.min(1080, maxWidth);
    const fallbackHeight = Math.min(780, maxHeight);
    const requestedWidth = Number(raw.width);
    const requestedHeight = Number(raw.height);
    const width = clampNumber(Number.isFinite(requestedWidth) ? requestedWidth : fallbackWidth, minWidth, maxWidth);
    const height = clampNumber(Number.isFinite(requestedHeight) ? requestedHeight : fallbackHeight, minHeight, maxHeight);
    const fallbackX = Math.round((viewportWidth - width) / 2);
    const fallbackY = Math.round((viewportHeight - height) / 2);
    const requestedX = Number(raw.x);
    const requestedY = Number(raw.y);
    const x = clampNumber(
      Number.isFinite(requestedX) ? requestedX : fallbackX,
      PANEL_VIEWPORT_MARGIN,
      Math.max(PANEL_VIEWPORT_MARGIN, viewportWidth - width - PANEL_VIEWPORT_MARGIN),
    );
    const y = clampNumber(
      Number.isFinite(requestedY) ? requestedY : fallbackY,
      PANEL_VIEWPORT_MARGIN,
      Math.max(PANEL_VIEWPORT_MARGIN, viewportHeight - height - PANEL_VIEWPORT_MARGIN),
    );
    return { x: Math.round(x), y: Math.round(y), width: Math.round(width), height: Math.round(height) };
  }

  function savePanelGeometry(geometry) {
    const current = loadUiState();
    current.panel = clampPanelGeometry(geometry);
    saveUiState(current);
  }

  function applyPanelGeometry() {
    app?.classList.toggle('mobile-layout', isMobileViewport());
    const panel = shadow?.querySelector('.panel');
    if (!panel) return;
    if (isMobileViewport()) {
      const geometry = getMobilePanelGeometry();
      panel.style.setProperty('left', `${Math.round(geometry.x)}px`, 'important');
      panel.style.setProperty('top', `${Math.round(geometry.y)}px`, 'important');
      panel.style.setProperty('right', 'auto', 'important');
      panel.style.setProperty('bottom', 'auto', 'important');
      panel.style.setProperty('width', `${Math.round(geometry.width)}px`, 'important');
      panel.style.setProperty('height', `${Math.round(geometry.height)}px`, 'important');
      return;
    }
    panel.style.removeProperty('right');
    panel.style.removeProperty('bottom');
    const geometry = clampPanelGeometry(loadUiState().panel);
    panel.style.left = `${geometry.x}px`;
    panel.style.top = `${geometry.y}px`;
    panel.style.width = `${geometry.width}px`;
    panel.style.height = `${geometry.height}px`;
  }

  function handleViewportResize() {
    cancelPromptSort();
    app?.classList.toggle('mobile-layout', isMobileViewport());
    clampOrbToViewport();
    applyPanelGeometry();
  }

  function saveOrbPosition(x, y) {
    const current = loadUiState();
    current.orb = { x: Math.round(x), y: Math.round(y) };
    saveUiState(current);
  }

  function getNumericMode(key, currentValue) {
    const mode = loadUiState().numericModes?.[key];
    if (mode === 'custom' || mode === 'preset') return mode;
    return FIELD_DEFINITIONS[key].presets.map(String).includes(String(currentValue)) ? 'preset' : 'custom';
  }

  function setNumericMode(key, mode) {
    const current = loadUiState();
    current.numericModes = current.numericModes && typeof current.numericModes === 'object'
      ? current.numericModes
      : {};
    current.numericModes[key] = mode;
    saveUiState(current);
  }

  function clampOrbToViewport() {
    const orb = shadow?.querySelector('.orb');
    if (!orb) return;
    const rect = orb.getBoundingClientRect();
    const x = Math.min(Math.max(8, rect.left), window.parent.innerWidth - rect.width - 8);
    const y = Math.min(Math.max(8, rect.top), window.parent.innerHeight - rect.height - 8);
    orb.style.left = `${x}px`;
    orb.style.top = `${y}px`;
    orb.style.right = 'auto';
    orb.style.bottom = 'auto';
    saveOrbPosition(x, y);
  }

  function dismissExtensionsMenu() {
    const parentWindow = window.parent;
    const parentDocument = parentWindow.document;
    const menu = parentDocument.getElementById('extensionsMenu');
    if (!menu) return;
    const style = parentWindow.getComputedStyle(menu);
    const visible = style.display !== 'none' && style.visibility !== 'hidden' && menu.getClientRects().length > 0;
    if (!visible) return;
    parentDocument.getElementById('extensionsMenuButton')?.click();
  }

  function openPanel() {
    dismissExtensionsMenu();
    state.open = true;
    refreshPreset(false);
    scheduleWorldbookScan();
    // 先显示面板，再执行元数据和连接配置同步；移动网络或慢设备不应阻塞入口响应。
    render();
    if (!isMobileViewport()) queueMicrotask(() => shadow.querySelector('[data-action="close"]')?.focus());
    Promise.allSettled([loadProfiles(false), ensurePromptMetadata()]).finally(() => {
      if (!state.open) return;
      render();
    });
  }

  function closePanel() {
    cancelPromptSort();
    state.reorderUndo = null;
    state.styleEditor = null;
    state.promptEditor = null;
    state.editorUnlocked = false;
    state.open = false;
    render();
    queueMicrotask(() => shadow.querySelector('.orb')?.focus());
  }

  function handleClick(event) {
    if(event.target.closest('.summary-slot, .dj-dialog-backdrop')) return;
    const target = event.target.closest('[data-action], .orb');
    if (!target) return;
    if (target.classList.contains('orb')) {
      if (!suppressOrbClick) openPanel();
      suppressOrbClick = false;
      return;
    }
    const action = target.dataset.action;
    if (state.workspaceBusy) return;
    if (action === 'entry-edit') { if(state.editorUnlocked)return openPromptEditor(target.dataset.id);return; }
    if (action === 'entry-new-here') {if(!state.editorUnlocked)return;openPromptEditor();setPlacementField('block',target.dataset.block);return;}
    if (action === 'entry-copy' || action === 'entry-delete') return editEntryAction(action).catch(showErrorToast);
    if (/^(configuration-|model-(add|rename|delete)$)/u.test(action)) return handleConfigurationAction(action, target).catch(showErrorToast);
    if (action === 'sort-grip') return;
    if (promptSort || (action === 'prompt-open' && Date.now() < sortClickUntil)) return;
    if (action === 'sort-show-all') { state.entryFilter = 'all'; state.search = ''; return renderActiveContent(false); }
    if (action === 'sort-undo') {
      const undo = state.reorderUndo;
      if (undo) return savePromptOrder(undo.id, undo.ordinal, undo.order, undo.presetName, true);
      return;
    }
    if (action === 'prompt-open') return openPromptEditor(target.dataset.id);
    if (action === 'prompt-new') return openPromptEditor();
    if (action === 'prompt-save') return savePromptEditor();
    if (action === 'prompt-step') {
      const editor = state.promptEditor;
      if (!editor || !state.editorUnlocked || editor.saving) return;
      const max = state.preset.prompts.length + (editor.base.included && editor.id ? 0 : 1);
      setEditorField('ordinal', Math.max(1, Math.min(max, (Number(editor.draft.ordinal) || 1) + Number(target.dataset.value))));
      return renderStyleEditorLayer();
    }
    if (action === 'prompt-close') return closePromptEditor();
    if (action === 'prompt-discard') return closePromptEditor(true);
    if (action === 'prompt-continue') { state.promptEditor.confirmClose = false; return renderStyleEditorLayer(); }
    if (action === 'prompt-reload') {
      const editor = state.promptEditor;
      if (!editor || editor.saving || editor.contextChanged) return;
      if (editor.dirty && !editor.confirmReload) { editor.confirmReload = true; editor.message = '重新载入会丢弃草稿。再次点击“重新载入”确认；也可先复制正文。'; return renderStyleEditorLayer(); }
      return openPromptEditor(editor.id);
    }
    if (state.promptEditor) return;
    if (action === 'close') return closePanel();
    if (action === 'close-backdrop' && event.target === target) return closePanel();
    if (action === 'close-style-editor' && event.target === target) {
      state.styleEditor = null;
      return renderStyleEditorLayer();
    }
    if (action === 'tab') {
      state.activeTab = target.dataset.tab;
      return renderActiveContent(false);
    }
    if (action === 'variable-mode') return selectVariableMode(target.dataset.value);
    if (action === 'refresh-worldbook') {
      worldEpoch += 1;
      const pending = configLibrary().pendingWorld;
      if (pending?.key === workspaceContextKey()) return selectVariableMode(pending.mode);
      return scanWorldbookMode();
    }
    if (action === 'jump') {
      const anchor = [...shadow.querySelectorAll('[data-anchor]')].find(item => item.dataset.anchor === target.dataset.value);
      if (anchor) {
        anchor.scrollIntoView({ block: 'start' });
        anchor.setAttribute('tabindex', '-1');
        anchor.focus({ preventScroll: true });
      }
      return;
    }
    if (action === 'entry-filter') {
      state.entryFilter = target.dataset.value;
      return renderActiveContent(false);
    }
    if (action === 'model') return selectModelAdapter(target.dataset.model);
    if (action === 'gemini-tail') return setGeminiTail(target.dataset.value);
    if (action === 'person') return setNarrationPerson(target.dataset.value);
    if (action === 'group') return applyGroup(target.dataset.group, target.dataset.value);
    if (action === 'field-preset') {
      setNumericMode(target.dataset.field, 'preset');
      const task = setNumericField(target.dataset.field, target.dataset.value);
      const card = target.closest('.numeric-card');
      card?.querySelectorAll('.chips button').forEach(button => button.classList.toggle('selected', button === target));
      const input = card?.querySelector('[data-action="field-number"]');
      if (input) input.value = target.dataset.value;
      const error = card?.querySelector(`[data-field-error="${target.dataset.field}"]`);
      if (error) error.textContent = '';
      return task.catch(showErrorToast);
    }
    if (action === 'field-custom') {
      setNumericMode(target.dataset.field, 'custom');
      const card = target.closest('.numeric-card');
      card?.querySelectorAll('.chips button').forEach(button => button.classList.toggle('selected', button === target));
      return card?.querySelector('[data-action="field-number"]')?.focus();
    }
    if (action === 'language-preset') {
      const task = setLanguageField(target.dataset.language, target.dataset.value);
      const card = target.closest('.language-card');
      card?.querySelectorAll('.chips button').forEach(button => button.classList.toggle('selected', button === target));
      const input = card?.querySelector('[data-action="language-input"]');
      if (input) input.value = target.dataset.value;
      const error = card?.querySelector(`[data-language-error="${target.dataset.language}"]`);
      if (error) error.textContent = '';
      return task.catch(showErrorToast);
    }
    if (action === 'language-custom') {
      const card = target.closest('.language-card');
      card?.querySelectorAll('.chips button').forEach(button => button.classList.toggle('selected', button === target));
      return card?.querySelector('[data-action="language-input"]')?.focus();
    }
    if (action === 'new-style') return openStyleEditor('', target.dataset.group);
    if (action === 'edit-style') return openStyleEditor(target.dataset.id);
    if (action === 'delete-style') return deleteUserStyle(target.dataset.id);
    if (action === 'save-style') return saveStyleEditor();
    if (action === 'cancel-style') {
      state.styleEditor = null;
      return renderStyleEditorLayer();
    }
    if (action === 'reset-user-additional') {
      const textarea = shadow.querySelector('[data-action="user-additional"]');
      const error = shadow.querySelector('[data-user-additional-error]');
      if (textarea) {
        textarea.disabled = false;
        textarea.value = USER_ADDITIONAL_DEFAULT;
      }
      if (error) error.textContent = '';
      return resetUserAdditionalSetting().catch(showErrorToast);
    }
    if (action === 'refresh-profiles') return loadProfiles();
  }

  function handleChange(event) {
    const target = event.target;
    const action = target.dataset.action;
    if (action === 'configuration-scope') { const scopes=target.dataset.kind==='save'?configurationScopes:exportScopes; scopes[target.dataset.key]=target.checked; return; }
    if (action === 'ui-theme') return applyTheme(target.value, true);
    if (action === 'ui-transparency') return applyTransparency(Number(target.value), true);
    if (state.workspaceBusy) return;
    if (action === 'placement-field') return setPlacementField(target.dataset.field,target.value);
    if (action === 'model-draft') { state.modelDraft[target.dataset.field] = target.value; return; }
    if (action === 'configuration-switch') { if (target.value) applyConfiguration(target.value).catch(showErrorToast); else updateWorkspaceUi(); return; }
    if (action === 'configuration-file') {
      const file = target.files?.[0];
      if (file) { if (file.size > 20 * 1024 * 1024) showErrorToast(new Error('配置文件不能超过 20 MB')); else file.text().then(importConfigurations).catch(showErrorToast); }
      target.value = ''; return;
    }
    if (action === 'custom-tail') {
      const model = state.config.custom_models.find(item => item.id === target.dataset.model);
      const tail = model && getPrompt(state.preset, model.ids[2]);
      const edited = tail && (tail.content !== model.tailBaseline.content || tail.role !== model.tailBaseline.role);
      if (edited && !window.confirm('切换类型会替换当前自定义尾部的正文和角色，并保存恢复点。继续？')) { target.value = model.tailMode; return; }
      setCustomTail(target.dataset.model, target.value, !!edited).catch(showErrorToast); return;
    }
    if (action === 'edit-mode') {
      if (state.reorderSaving || state.promptEditor?.saving || state.promptEditor?.contextChanged) return;
      if(!target.checked&&(state.promptEditor?.dirty||state.styleEditor)){target.checked=true;setSaveStatus('error','请先保存或关闭条目编辑器，再退出编辑模式。');return;}
      state.editorUnlocked = target.checked;
      if(!target.checked){cancelPromptSort();state.promptEditor=null;state.styleEditor=null;}
      render();return;
    }
    if (action === 'prompt-field') {
      setEditorField(target.dataset.field, target.type === 'checkbox' ? target.checked : target.value);
      return renderStyleEditorLayer();
    }
    if (action === 'toggle') {
      const key = target.dataset.key;
      if (key?.startsWith('entry:')) return updateEntryPoint(key.slice('entry:'.length), target.checked, target);
      if (key === 'connection-link') return updateConnectionLink(target.checked);
      if (key === 'streaming') return setStreaming(target.checked);
      if (key?.startsWith('prompt:')) {
        const card = target.closest('.mini-card');
        const small = card?.querySelector('small');
        if (small) small.textContent = target.checked ? '已启用' : '已关闭';
        return togglePrompt(key.slice('prompt:'.length), target.checked);
      }
    }
    if (action === 'profile-binding') return updateProfileBinding(target.dataset.model, target.value);

  }

  function handleInput(event) {
    const target = event.target;
    const action = target.dataset.action;
    if (action === 'ui-transparency') return applyTransparency(Number(target.value));
    if (state.workspaceBusy) return;
    if (action === 'configuration-name') { state.configurationName = target.value; return; }
    if (action === 'model-draft') { state.modelDraft[target.dataset.field] = target.value; return; }
    if (action === 'prompt-field') {
      setEditorField(target.dataset.field, target.type === 'checkbox' ? target.checked : target.value);
      const editor = state.promptEditor;
      const button = shadow.querySelector('[data-action="prompt-save"]');
      if (button) button.disabled = !state.editorUnlocked || editor.saving || editor.contextChanged || (!editor.dirty && !!editor.id);
      const feedback = shadow.querySelector('.editor-feedback');
      if (feedback) feedback.textContent = editor.dirty ? '修改尚未保存。' : '原生界面修改会同步到这里。';
      return;
    }
    if (action === 'search') {
      state.search = target.value;
      return renderActiveContent(true);
    }
    if (action === 'field-number') {
      const key = target.dataset.field;
      const value = String(target.value ?? '').trim();
      setNumericMode(key, 'custom');
      const card = target.closest('.numeric-card');
      card?.querySelectorAll('.chips button').forEach(button => button.classList.toggle('selected', button.dataset.action === 'field-custom'));
      const error = card?.querySelector(`[data-field-error="${key}"]`);
      if (!/^-?\d+$/u.test(value)) {
        if (error) error.textContent = value ? '请输入有效整数。' : '自定义数值不能为空。';
        return;
      }
      if (error) error.textContent = '';
      return setNumericField(key, value).catch(showErrorToast);
    }
    if (action === 'language-input') {
      const key = target.dataset.language;
      const value = String(target.value ?? '').trim();
      const card = target.closest('.language-card');
      card?.querySelectorAll('.chips button').forEach(button => button.classList.toggle('selected', button.dataset.action === 'language-custom'));
      const error = card?.querySelector(`[data-language-error="${key}"]`);
      if (!value) {
        if (error) error.textContent = '自定义语言不能为空。';
        return;
      }
      if (/[\u0000-\u001f\u007f<>{}]/u.test(value)) {
        if (error) error.textContent = '不能包含换行、控制字符、尖括号或花括号。';
        return;
      }
      if (error) error.textContent = '';
      return setLanguageField(key, value).catch(showErrorToast);
    }
    if (action === 'global-preference') {
      const error = shadow.querySelector('[data-preference-error]');
      if (error) error.textContent = '';
      return setGlobalPreference(target.value).catch(showErrorToast);
    }
    if (action === 'user-additional') {
      const error = shadow.querySelector('[data-user-additional-error]');
      if (String(target.value ?? '').includes('{{/setvar}}')) {
        if (error) error.textContent = '不能包含 {{/setvar}}，否则会截断受管区域。';
        return;
      }
      if (error) error.textContent = '';
      return setUserAdditionalSetting(target.value).catch(showErrorToast);
    }
    if (action === 'style-title' && state.styleEditor) state.styleEditor.title = target.value;
    if (action === 'style-content' && state.styleEditor) state.styleEditor.content = target.value;
  }

  function handleKeydown(event) {
    if(shadow?.querySelector('.dj-dialog-backdrop')) return;
    if (event.altKey && ['ArrowUp', 'ArrowDown'].includes(event.key) && event.target.closest('.sort-handle') && canSortPrompts()) {
      event.preventDefault();
      const id = event.target.closest('.sort-handle').dataset.id;
      const order = state.preset.prompts.map(p => p.id);
      const ordinal = Math.max(1, Math.min(order.length, order.indexOf(id) + 1 + (event.key === 'ArrowUp' ? -1 : 1)));
      return savePromptOrder(id, ordinal, order, getLoadedPresetName());
    }
    if (event.key === 'Escape' && state.open) {
      event.preventDefault();
      if (state.promptEditor) return closePromptEditor();
      if (state.styleEditor) {
        state.styleEditor = null;
        renderStyleEditorLayer();
        return shadow.querySelector('[data-action="new-style"]')?.focus();
      }
      return closePanel();
    }
    if (state.promptEditor && (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') { event.preventDefault(); return savePromptEditor(); }
    if (!state.open || event.key !== 'Tab' || (!state.styleEditor && !state.promptEditor)) return;
    const focusScope = shadow.querySelector('.prompt-editor, .style-editor');
    if (!focusScope) return;
    const focusable = [...focusScope.querySelectorAll('button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), summary, [tabindex]:not([tabindex="-1"])')];
    if (focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && shadow.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && shadow.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  function handleOrbPointerDown(event) {
    const orb = event.target.closest('.orb');
    if (!orb || event.button !== 0) return;
    event.preventDefault();
    const parentWindow = window.parent;
    const startRect = orb.getBoundingClientRect();
    const startX = event.clientX;
    const startY = event.clientY;
    let moved = false;
    const pointerId = event.pointerId;
    try { orb.setPointerCapture?.(pointerId); } catch { /* 部分移动端不支持跨 Shadow DOM 捕获 */ }

    const onMove = moveEvent => {
      if (moveEvent.pointerId !== pointerId) return;
      const dx = moveEvent.clientX - startX;
      const dy = moveEvent.clientY - startY;
      if (Math.hypot(dx, dy) > 7) moved = true;
      const x = Math.min(Math.max(8, startRect.left + dx), parentWindow.innerWidth - startRect.width - 8);
      const y = Math.min(Math.max(8, startRect.top + dy), parentWindow.innerHeight - startRect.height - 8);
      orb.style.left = `${x}px`;
      orb.style.top = `${y}px`;
      orb.style.right = 'auto';
      orb.style.bottom = 'auto';
    };
    const finish = (upEvent, cancelled = false) => {
      if (upEvent?.pointerId !== undefined && upEvent.pointerId !== pointerId) return;
      window.parent.document.removeEventListener('pointermove', onMove);
      window.parent.document.removeEventListener('pointerup', onUp);
      window.parent.document.removeEventListener('pointercancel', onCancel);
      try { orb.releasePointerCapture?.(pointerId); } catch { /* ignore */ }
      const rect = orb.getBoundingClientRect();
      const x = Math.min(Math.max(8, rect.left), parentWindow.innerWidth - rect.width - 8);
      const y = Math.min(Math.max(8, rect.top), parentWindow.innerHeight - rect.height - 8);
      orb.style.left = `${x}px`;
      orb.style.top = `${y}px`;
      saveOrbPosition(x, y);
      // 某些移动端在 pointerdown 被阻止后不会派发 click；轻触在这里直接打开。
      if (!moved && !cancelled) {
        suppressOrbClick = true;
        openPanel();
        window.setTimeout(() => { suppressOrbClick = false; }, 0);
      } else {
        suppressOrbClick = moved;
      }
    };
    const onUp = upEvent => finish(upEvent, false);
    const onCancel = cancelEvent => finish(cancelEvent, true);
    window.parent.document.addEventListener('pointermove', onMove);
    window.parent.document.addEventListener('pointerup', onUp);
    window.parent.document.addEventListener('pointercancel', onCancel);
  }

  function handlePanelPointerDown(event) {
    if (isMobileViewport() || (event.pointerType === 'mouse' && event.button !== 0)) return;
    const resizeHandle = event.target.closest('[data-panel-resize-handle]');
    const dragHandle = event.target.closest('[data-panel-drag-handle]');
    if (!resizeHandle && !dragHandle) return;
    if (dragHandle && event.target.closest('button, input, label, textarea, select, summary, a')) return;

    const panel = event.target.closest('.panel');
    if (!panel) return;
    event.preventDefault();
    const parentDocument = window.parent.document;
    const startRect = panel.getBoundingClientRect();
    const startX = event.clientX;
    const startY = event.clientY;
    panel.classList.add(resizeHandle ? 'panel-resizing' : 'panel-moving');

    const onMove = moveEvent => {
      const dx = moveEvent.clientX - startX;
      const dy = moveEvent.clientY - startY;
      if (resizeHandle) {
        const maximumWidth = Math.max(1, window.parent.innerWidth - startRect.left - PANEL_VIEWPORT_MARGIN);
        const maximumHeight = Math.max(1, window.parent.innerHeight - startRect.top - PANEL_VIEWPORT_MARGIN);
        const minimumWidth = Math.min(PANEL_MIN_WIDTH, maximumWidth);
        const minimumHeight = Math.min(PANEL_MIN_HEIGHT, maximumHeight);
        panel.style.width = `${Math.round(clampNumber(startRect.width + dx, minimumWidth, maximumWidth))}px`;
        panel.style.height = `${Math.round(clampNumber(startRect.height + dy, minimumHeight, maximumHeight))}px`;
        return;
      }
      const maximumX = Math.max(PANEL_VIEWPORT_MARGIN, window.parent.innerWidth - startRect.width - PANEL_VIEWPORT_MARGIN);
      const maximumY = Math.max(PANEL_VIEWPORT_MARGIN, window.parent.innerHeight - startRect.height - PANEL_VIEWPORT_MARGIN);
      panel.style.left = `${Math.round(clampNumber(startRect.left + dx, PANEL_VIEWPORT_MARGIN, maximumX))}px`;
      panel.style.top = `${Math.round(clampNumber(startRect.top + dy, PANEL_VIEWPORT_MARGIN, maximumY))}px`;
    };

    const onUp = () => {
      parentDocument.removeEventListener('pointermove', onMove);
      parentDocument.removeEventListener('pointerup', onUp);
      parentDocument.removeEventListener('pointercancel', onUp);
      panel.classList.remove('panel-moving', 'panel-resizing');
      const rect = panel.getBoundingClientRect();
      savePanelGeometry({ x: rect.left, y: rect.top, width: rect.width, height: rect.height });
    };
    parentDocument.addEventListener('pointermove', onMove);
    parentDocument.addEventListener('pointerup', onUp);
    parentDocument.addEventListener('pointercancel', onUp);
  }

  function createUi() {
    const parentDocument = window.parent.document;
    parentDocument.getElementById(HOST_ID)?.remove();
    host = parentDocument.createElement('div');
    host.id = HOST_ID;
    host.dataset.scriptId = SCRIPT_ID;
    host.dataset.ttMobileSurface = 'free-window';
    host.setAttribute('script_id', SCRIPT_ID);
    host.style.position = 'fixed';
    host.style.inset = '0';
    host.style.zIndex = '2147481000';
    host.style.pointerEvents = 'none';
    parentDocument.body.appendChild(host);
    shadow = host.attachShadow({ mode: 'open' });
    const style = parentDocument.createElement('style');
    style.textContent = STYLES;
    app = parentDocument.createElement('div');
    app.className = `destined-root${isMobileViewport() ? ' mobile-layout' : ''}`;
    shadow.append(style, app);
    app.addEventListener('click', handleClick);
    app.addEventListener('change', handleChange);
    app.addEventListener('input', handleInput);
    app.addEventListener('toggle', event => {
      if (event.target.classList?.contains('editor-properties') && event.target.isConnected && state.promptEditor) state.promptEditor.propertiesOpen = event.target.open;
      const id = event.target.dataset?.disclosure;
      if (!id || !event.target.isConnected) return;
      if (event.target.open) state.disclosures.add(id);
      else state.disclosures.delete(id);
    }, true);
    app.addEventListener('pointerdown', handlePromptSortPointerDown);
    app.addEventListener('pointerdown', handleOrbPointerDown);
    app.addEventListener('pointerdown', handlePanelPointerDown);
    shadow.addEventListener('keydown', handleKeydown);
    render();
  }

  function subscribe(eventName, handler) {
    if (!eventName) return;
    try {
      const stop = eventOn(eventName, handler);
      if (stop) eventStops.push(stop);
    } catch (error) {
      console.warn(`[${SCRIPT_NAME}] 监听事件失败：${eventName}`, error);
    }
  }

  function subscribeLast(eventName, handler) {
    if (!eventName) return;
    try {
      const stop = eventMakeLast(eventName, handler);
      if (stop) eventStops.push(stop);
    } catch (error) {
      console.warn(`[${SCRIPT_NAME}] 注册末位监听失败，回退到普通监听：${eventName}`, error);
      subscribe(eventName, handler);
    }
  }

  function cleanup() {
    cancelPromptSort();
    if (destroyed) return;
    destroyed = true;
    summary.dispose();
    dialogs?.destroy();
    for (const item of debounceTimers.values()) { clearTimeout(item.timer); item.resolve({ cancelled: true }); }
    debounceTimers.clear();
    for (const stop of eventStops) {
      try { stop.stop?.(); } catch { /* ignore */ }
    }
    for (const stop of macroStops) {
      try { stop.unregister?.(); } catch { /* ignore */ }
    }
    if (syncInterval) window.clearInterval(syncInterval);
    worldEpoch += 1;
    clearTimeout(worldTimer);
    window.parent.document.getElementById(WAND_CONTAINER_ID)?.remove();
    host?.remove();
    window.parent.removeEventListener('resize', handleViewportResize);
    window.parent.visualViewport?.removeEventListener('resize', handleViewportResize);
    window.parent.visualViewport?.removeEventListener('scroll', handleViewportResize);
  }


  // Named configurations contain data only; never embed scripts, extensions or the library itself.
  function emptyLibrary() {
    return { version: 1, items: [], activeId: null, recovery: null, pendingWorld: null };
  }

  function plainObject(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
  }

  function assertData(condition, message) {
    if (!condition) throw new Error(message);
  }

  function validName(value, existing = [], ignored = '') {
    const name = String(value ?? '').trim();
    assertData(name.length > 0 && name.length <= 100, '名称须为 1—100 个字符。');
    assertData(!/[\u0000-\u001f\u007f]/u.test(name), '名称不能包含控制字符。');
    assertData(!existing.some(item => item.id !== ignored && item.name.trim().toLocaleLowerCase() === name.toLocaleLowerCase()), '名称已存在。');
    return name;
  }

  function validateCustomModels(value) {
    assertData(Array.isArray(value), '自定义模型列表格式错误');
    const used = new Set(Object.values(BUILTIN_MODEL_ADAPTERS).flatMap(a => [...a.ids, ...a.tails]));
    const names = Object.keys(BUILTIN_MODEL_ADAPTERS).map(name => ({ id: name, name }));
    const ids = new Set(Object.keys(BUILTIN_MODEL_ADAPTERS));
    return value.map(model => {
      assertData(plainObject(model) && typeof model.id === 'string' && /^model:[a-f0-9-]{36}$/iu.test(model.id) && !ids.has(model.id), '模型 ID 无效或重复');
      ids.add(model.id);
      const label = validName(model.label, names);
      names.push({ id: model.id, name: label });
      assertData(Array.isArray(model.ids) && model.ids.length === 3, '每个自定义模型必须有三个条目');
      for (const id of model.ids) {
        assertData(typeof id === 'string' && /^[a-f0-9-]{36}$/iu.test(id) && !used.has(id), '模型条目 ID 无效或重复');
        used.add(id);
      }
      assertData(['prefill', 'no-prefill'].includes(model.tailMode), '尾部类型无效');
      assertData(plainObject(model.tailBaseline) && typeof model.tailBaseline.content === 'string' && ['system', 'user', 'assistant'].includes(model.tailBaseline.role), '尾部模板基线缺失');
      return { id: model.id, label, ids: [...model.ids], tailMode: model.tailMode, tailBaseline: { content: model.tailBaseline.content, role: model.tailBaseline.role } };
    });
  }

  function modelRegistry(config = state.config) {
    const registry = { ...BUILTIN_MODEL_ADAPTERS };
    if (!config.configuration_error) for (const model of config.custom_models ?? []) {
      registry[model.id] = { ...model, tails: [], custom: true };
    }
    return registry;
  }

  function rebuildModelRegistry() {
    MODEL_ADAPTERS = modelRegistry();
    MODEL_IDS = new Set(Object.values(MODEL_ADAPTERS).flatMap(a => [...a.ids, ...a.tails]));
  }

  function settingsKeys() {
    return ('max_context max_completion_tokens reply_count should_stream temperature frequency_penalty presence_penalty top_p repetition_penalty min_p top_k top_a seed squash_system_messages reasoning_effort request_thoughts request_images enable_function_calling enable_web_search allow_sending_images allow_sending_videos character_name_prefix wrap_user_messages_in_quotes').split(' ');
  }

  function pickSettings(value) {
    assertData(plainObject(value), '生成参数格式错误');
    const booleans = new Set(('should_stream squash_system_messages request_thoughts request_images enable_function_calling enable_web_search allow_sending_videos wrap_user_messages_in_quotes').split(' '));
    const enums = {
      reasoning_effort: ['auto', 'min', 'low', 'medium', 'high', 'max'],
      allow_sending_images: ['disabled', 'auto', 'low', 'high'],
      character_name_prefix: ['none', 'default', 'content', 'completion'],
    };
    return Object.fromEntries(settingsKeys().filter(key => Object.hasOwn(value, key)).map(key => {
      const field = value[key];
      const valid = booleans.has(key) ? typeof field === 'boolean' : enums[key] ? enums[key].includes(field) : typeof field === 'number' && Number.isFinite(field);
      assertData(valid, '生成参数类型或取值无效：' + key);
      return [key, field];
    }));
  }

  function snapshotPrompt(prompt) {
    assertData(plainObject(prompt) && typeof prompt.id === 'string' && prompt.id.length > 0 && typeof prompt.name === 'string', '条目标识或名称无效');
    assertData(typeof prompt.enabled === 'boolean' && ['system', 'user', 'assistant'].includes(prompt.role), '条目开关或角色无效：' + prompt.name);
    const result = { id: prompt.id, name: prompt.name, enabled: prompt.enabled, role: prompt.role };
    if (prompt.content !== undefined) {
      assertData(typeof prompt.content === 'string', '条目正文必须是文本');
      result.content = prompt.content;
    }
    if (prompt.position !== undefined) {
      assertData(plainObject(prompt.position) && ['relative', 'in_chat'].includes(prompt.position.type), '条目插入位置无效');
      result.position = { type: prompt.position.type };
      if (prompt.position.type === 'in_chat') {
        for (const key of ['depth', 'order']) {
          assertData(Number.isSafeInteger(prompt.position[key]) && (key === 'order' || prompt.position[key] >= 0), '聊天深度须为非负整数，同层顺序须为整数');
          result.position[key] = prompt.position[key];
        }
      }
    }
    if (plainObject(prompt.extra)) {
      const ui = prompt.extra.destined_ui;
      if(ui?.version===3)assertData(typeof ui.block==='string'&&ui.block.length<=100&&Number.isFinite(ui.order)&&typeof ui.group==='string'&&typeof ui.label==='string'&&typeof ui.description==='string','条目显示位置格式无效：'+prompt.name);
      if (ui?.version === 2) {
        assertData(typeof ui.block === 'string' && ui.block.length <= 100 && typeof ui.label === 'string' && ui.label.length <= 100 && typeof ui.description === 'string' && ui.description.length <= 2000 && Number.isFinite(ui.order) && typeof ui.protected === 'boolean' && typeof ui.defaultEnabled === 'boolean', '条目展示设置格式无效：' + prompt.name);
      }
      result.extra = {};
      if (plainObject(ui)) result.extra.destined_ui = Object.fromEntries(
        ['version','section','control','group','block','order','label','description','protected','defaultEnabled','created_by']
          .filter(key => Object.hasOwn(ui,key) && ['string','number','boolean'].includes(typeof ui[key]))
          .map(key => [key,ui[key]])
      );
    }
    return result;
  }

  function snapshotConfig(config) {
    assertData(!config.configuration_error, config.configuration_error);
    const custom_models = validateCustomModels(config.custom_models ?? []);
    const bindings = {};
    for (const id of Object.keys(modelRegistry({ custom_models }))) bindings[id] = sanitizeBinding(config.connection_link?.bindings?.[id]);
    return {
      managed_values: sanitizeManagedValues(config.managed_values),
      entry_points: sanitizeEntryPoints(config.entry_points),
      custom_models,
      connection_link: { enabled: config.connection_link?.enabled === true, bindings },
      model_tail_modes: { Gemini: config.model_tail_modes?.Gemini === 'prefill' ? 'prefill' : 'no-prefill' },
    };
  }

  function capturePresetConfiguration(preset = getPreset('in_use'), config = state.config) {
    const result = {
      version: 1, settings: pickSettings(preset.settings),
      prompts: preset.prompts.map(snapshotPrompt), prompts_unused: (preset.prompts_unused ?? []).map(snapshotPrompt),
      config: snapshotConfig(config),
      author: preset.extensions?.destined_author ? validateAuthorLayout(preset.extensions.destined_author) : null,
    };
    const tail = getGeminiTail(preset);
    if (tail) result.config.model_tail_modes.Gemini = tail;
    return result;
  }

  function validatePresetSnapshot(value) {
    assertData(plainObject(value) && value.version === 1 && plainObject(value.config), '不支持的配置快照版本或格式');
    assertData(Array.isArray(value.prompts) && Array.isArray(value.prompts_unused), '配置缺少条目列表');
    const result = {
      version: 1, settings: pickSettings(value.settings),
      prompts: value.prompts.map(snapshotPrompt), prompts_unused: value.prompts_unused.map(snapshotPrompt),
      config: snapshotConfig(value.config),
      author: value.author == null ? null : validateAuthorLayout(value.author),
    };
    const seen = new Set();
    for (const prompt of [...result.prompts, ...result.prompts_unused]) {
      assertData(!seen.has(prompt.id), '配置包含重复条目 ID');
      seen.add(prompt.id);
    }
    for (const id of PROTECTED_IDS) assertData(result.prompts.some(p => p.id === id && p.enabled), '配置缺少或禁用了基础条目：' + id);
    for (const adapter of Object.values(modelRegistry(result.config))) {
      for (const id of [...adapter.ids, ...adapter.tails]) assertData(result.prompts.some(p => p.id === id), '配置缺少模型条目：' + id);
    }
    const mode = variablePresetMode(result);
    assertData(mode === 'main' || mode === 'extra', '配置中的变量模式必须二选一');
    return result;
  }

  function selectedScopes(snapshot) { return { preset: !!snapshot.preset, summary: !!snapshot.summary }; }
  function captureConfiguration(preset = getPreset('in_use'), config = state.config, scopes = configurationScopes) {
    assertData(scopes.preset || scopes.summary, '请至少选择预设配置或总结配置');
    return { version: 2, ...(scopes.preset ? { preset: capturePresetConfiguration(preset, config) } : {}), ...(scopes.summary ? { summary: summary.capture() } : {}) };
  }
  function validateSnapshot(value) {
    if (value?.version === 1) return { version: 2, preset: validatePresetSnapshot(value) };
    assertData(plainObject(value) && value.version === 2 && (value.preset || value.summary), '配置范围为空或版本无效');
    return { version: 2, ...(value.preset ? { preset: validatePresetSnapshot(value.preset) } : {}), ...(value.summary ? { summary: summary.validate(value.summary) } : {}) };
  }

  function validateLibrary(value) {
    assertData(plainObject(value) && value.version === 1 && Array.isArray(value.items), '不支持的配置库版本或格式');
    const ids = new Set();
    const names = [];
    const items = value.items.map(item => {
      assertData(plainObject(item) && typeof item.id === 'string' && item.id && !ids.has(item.id), '配置 ID 无效或重复');
      ids.add(item.id);
      const name = validName(item.name, names);
      names.push({ id: item.id, name });
      return { id: item.id, name, createdAt: String(item.createdAt ?? ''), updatedAt: String(item.updatedAt ?? ''), snapshot: validateSnapshot(item.snapshot) };
    });
    assertData(value.activeId == null || ids.has(value.activeId), '当前配置引用不存在');
    const recovery = value.recovery == null ? null : { createdAt: String(value.recovery.createdAt ?? ''), snapshot: validateSnapshot(value.recovery.snapshot) };
    const pending = value.pendingWorld;
    assertData(pending == null || (plainObject(pending) && typeof pending.key === 'string' && ['main', 'extra'].includes(pending.mode)), '世界书待同步状态无效');
    return { version: 1, items, activeId: value.activeId ?? null, recovery, pendingWorld: pending ? { key: pending.key, mode: pending.mode } : null };
  }

  function configLibrary() {
    return state.config.configuration_error ? emptyLibrary() : state.config.configuration_library;
  }

  function workspaceContextKey() {
    return captureWorldContext().key;
  }

  async function flushPendingSaves() {
    const tasks = [...debounceTimers.values()].map(item => item.flush?.()).filter(Boolean);
    await Promise.all(tasks);
    await saveChain;
    await summary.flush();
  }

  async function runWorkspaceOperation(label, operation) {
    if (state.workspaceBusy || summary.busy()) throw new Error('上一项操作尚未完成，请稍候。');
    assertData(!state.connectionRequest, '连接请求尚未结束，请等待完成后再操作。');
    assertData(!state.config.configuration_error, state.config.configuration_error);
    assertData(!state.promptEditor && !state.styleEditor, '请先保存或关闭条目编辑器，再操作配置。');
    assertData(![...(shadow?.querySelectorAll('[data-action="field-number"]') ?? [])].some(input => !/^-?\d+$/u.test(input.value.trim())), '请先修正当前页面尚未保存的无效数值。');
    assertData(!worldLink.busy && !worldWrites.size, '世界书同步尚未完成，请稍候。');
    const name = getLoadedPresetName();
    const contextKey = workspaceContextKey();
    const current = () => !destroyed && getLoadedPresetName() === name && workspaceContextKey() === contextKey;
    state.workspaceBusy = true;
    cancelPromptSort();
    worldEpoch += 1;
    clearTimeout(worldTimer);
    setSaveStatus('saving', label);
    updateWorkspaceUi();
    try {
      await flushPendingSaves();
      assertData(current(), '上下文已变化，操作已取消。');
      state.preset = clone(getPreset('in_use'));
      const result = await operation(current);
      assertData(current(), '上下文已变化，请检查当前状态。');
      setSaveStatus('saved', label + '完成');
      return result;
    } catch (error) {
      setSaveStatus('error', error.message ?? String(error));
      throw error;
    } finally {
      state.workspaceBusy = false;
      if (!destroyed) {
        rebuildModelRegistry();
        refreshPreset(false);
        syncEntryPoints();
        renderActiveContent(true);
        updateWorkspaceUi();
        if (reconcilePending) { reconcilePending = false; reconcilePreset(); }
      }
    }
  }

  function writeConfigurationData(next, current = () => !destroyed) {
    assertData(current(), '上下文已变化，未写入配置。');
    const before = clone(getVariables({ type: 'script' }));
    try {
      writePresetStore(next);
      assertData(current(), '上下文已变化，配置保存未完成。');
      const actual = getVariables({ type: 'script' });
      assertData(JSON.stringify(actual.configuration_library) === JSON.stringify(next.configuration_library), '配置持久化校验失败');
      state.config = clone(next);
      savedScriptConfig = clone(next);
      rebuildModelRegistry();
    } catch (error) {
      if (current()) {
        try { writePresetStore(before); }
        catch (rollbackError) { error.message += '；脚本设置回滚失败：' + rollbackError.message; }
      }
      throw error;
    }
  }

  async function writeWorkspace(nextPreset, nextConfig, current) {
    const beforeCurrent = clone(getPreset('in_use'));
    const name = getLoadedPresetName();
    const beforeNamed = name && name !== 'in_use' ? clone(getPreset(name)) : null;
    const fingerprint = fingerprintPresetValue(beforeCurrent);
    const guard = () => current() && fingerprintPresetValue(getPreset('in_use')) === fingerprint;
    // Apply only the snapshot-owned fields. Preserve each target's latest extensions.
    await commitPresetMutation('配置与模型条目', preset => {
      preset.settings = { ...preset.settings, ...nextPreset.settings };
      preset.prompts = clone(nextPreset.prompts);
      preset.prompts_unused = clone(nextPreset.prompts_unused ?? []);
      preset.extensions ??= {};
      const author = Object.hasOwn(nextPreset,'author') ? nextPreset.author : nextPreset.extensions?.destined_author;
      if (author) preset.extensions.destined_author = clone(author);
      else delete preset.extensions.destined_author;
    }, guard);
    try {
      writeConfigurationData(nextConfig, current);
    } catch (error) {
      const issues = [];
      for (const [target, before] of [[name, beforeNamed], ['in_use', beforeCurrent]]) {
        if (!before || !current()) { if (before) issues.push(target + '（上下文已变化）'); continue; }
        try { await replacePreset(target, before, { render: target === 'in_use' ? 'debounced' : 'none' }); }
        catch (rollbackError) { issues.push(target + '：' + rollbackError.message); }
      }
      if (issues.length) error.message += '；预设回滚未完成：' + issues.join('、');
      throw error;
    }
  }

  function saveRecovery(current, scopes) {
    const next = clone(state.config);
    next.configuration_library.recovery = { createdAt: new Date().toISOString(), snapshot: validateSnapshot(captureConfiguration(getPreset('in_use'), state.config, scopes)) };
    writeConfigurationData(next, current);
  }

  async function saveNamedConfiguration(name, overwriteId = '', scopes = configurationScopes) {
    return runWorkspaceOperation('保存配置', async current => {
      const next = clone(state.config);
      const library = next.configuration_library;
      const previous = overwriteId ? library.items.find(item => item.id === overwriteId) : null;
      assertData(!overwriteId || previous, '要覆盖的配置已不存在');
      const chosenName = validName(previous?.name ?? name, library.items, overwriteId);
      const now = new Date().toISOString();
      const item = { id: previous?.id ?? createPromptId(), name: chosenName, createdAt: previous?.createdAt ?? now, updatedAt: now, snapshot: validateSnapshot(captureConfiguration(getPreset('in_use'), state.config, scopes)) };
      if (previous) library.items[library.items.indexOf(previous)] = item;
      else library.items.push(item);
      library.activeId = item.id;
      writeConfigurationData(next, current);
      state.configurationName = '';
      return item.id;
    });
  }

  async function renameConfiguration(id, name) {
    return runWorkspaceOperation('重命名配置', async current => {
      const next = clone(state.config);
      const item = next.configuration_library.items.find(item => item.id === id);
      assertData(item, '配置已不存在');
      item.name = validName(name, next.configuration_library.items, id);
      item.updatedAt = new Date().toISOString();
      writeConfigurationData(next, current);
    });
  }

  async function deleteConfiguration(id) {
    return runWorkspaceOperation('删除配置', async current => {
      const next = clone(state.config);
      assertData(next.configuration_library.items.some(item => item.id === id), '配置已不存在');
      next.configuration_library.items = next.configuration_library.items.filter(item => item.id !== id);
      if (next.configuration_library.activeId === id) next.configuration_library.activeId = null;
      writeConfigurationData(next, current);
    });
  }

  async function withLinkedConnection(config, modelId, current, operation) {
    if (!config.connection_link.enabled) return operation();
    const expected = fingerprintPresetValue(getPreset('in_use'));
    const sourceContext = JSON.parse(workspaceContextKey()).slice(1);
    const sameChat = () => JSON.stringify(JSON.parse(workspaceContextKey()).slice(1)) === JSON.stringify(sourceContext);
    await loadProfiles(false);
    assertData(current() && fingerprintPresetValue(getPreset('in_use')) === expected, '上下文或预设内容已变化，未切换连接');
    const profile = resolveBoundProfile(config.connection_link.bindings[modelId]);
    assertData(profile, '所选模型没有有效且唯一的酒馆连接绑定。');
    const previousName = await getCurrentProfileName();
    assertData(previousName, '无法读取当前连接，已停止切换以保证可恢复。');
    assertData(current() && fingerprintPresetValue(getPreset('in_use')) === expected, '上下文或预设内容已变化，未切换连接');
    const rollback = async () => {
      assertData(!destroyed && sameChat(), '上下文已变化，未向新聊天写入旧连接');
      const actualName = await getCurrentProfileName();
      if (actualName === previousName) return;
      assertData(actualName === profile.name, '连接已被外部修改，未覆盖当前连接');
      await withWorldTimeout(Promise.resolve(triggerSlash('/profile await=true timeout=' + PROFILE_TIMEOUT + ' ' + slashQuote(previousName))), '恢复原连接', PROFILE_TIMEOUT);
      assertData(await getCurrentProfileName() === previousName, '原连接未恢复');
    };
    let settled = false;
    const request = Promise.resolve().then(() => switchConnectionProfile(profile));
    state.connectionRequest = request;
    request.then(() => { settled = true; }, () => { settled = true; });
    try {
      await withWorldTimeout(request, '切换连接', PROFILE_TIMEOUT);
      assertData(current(), '连接配置改变了当前预设或聊天，请使用绑定当前命定预设的连接配置。');
      assertData(fingerprintPresetValue(getPreset('in_use')) === expected, '连接切换期间预设内容发生变化，未覆盖。');
      return await operation();
    } catch (error) {
      if (!settled) {
        error.message += '；旧请求尚未结束，已暂停新的配置切换，结束后尝试恢复原连接。';
        const finish = async () => {
          try {
            await rollback();
            if (!destroyed) setSaveStatus('error', '连接请求曾超时，迟到请求已结束并恢复原连接；配置未应用。');
          } catch (lateError) {
            if (!destroyed) setSaveStatus('error', '迟到连接请求恢复未完成：' + lateError.message);
          } finally {
            if (state.connectionRequest === request) state.connectionRequest = null;
            if (!destroyed) updateWorkspaceUi();
          }
        };
        request.then(finish, finish);
      } else {
        try { await rollback(); }
        catch (rollbackError) { error.message += '；连接回滚失败：' + rollbackError.message; }
      }
      throw error;
    } finally {
      if (settled && state.connectionRequest === request) state.connectionRequest = null;
    }
  }

  async function applyConfiguration(id) {
    let worldMode = null;
    await runWorkspaceOperation('切换配置', async current => {
      const library = configLibrary();
      const source = id === '__recovery__' ? library.recovery : library.items.find(item => item.id === id);
      assertData(source, '配置或恢复点不存在。');
      const complete = validateSnapshot(clone(source.snapshot));
      const snapshot = complete.preset;
      const modelId = snapshot ? detectModelAdapter(snapshot, modelRegistry(snapshot.config)) : null;
      if(snapshot) assertData(modelId || !snapshot.config.connection_link.enabled, '配置的模型条目未正确互斥，无法联动连接。');
      saveRecovery(current, selectedScopes(complete));
      const apply = async () => {
        const previousSummary = summary.capture();
        const next = { ...clone(state.config), ...(snapshot ? clone(snapshot.config) : {}) };
        next.configuration_library.activeId = id === '__recovery__' ? null : id;
        if(snapshot) { worldMode = variablePresetMode(snapshot); next.configuration_library.pendingWorld = { key: workspaceContextKey(), mode: worldMode }; }
        try {
          if(complete.summary) await summary.apply(complete.summary);
          assertData(current(), '上下文已变化，配置已停止应用');
          if(snapshot) await writeWorkspace(snapshot, next, current);
          else writeConfigurationData(next, current);
        } catch(error) {
          if(complete.summary && current()) { try { await summary.apply(previousSummary); } catch(rollback) { error.message += '；总结配置回滚失败：' + rollback.message; } }
          throw error;
        }
        state.reorderUndo = null; state.editorUnlocked = false;
      };
      if(snapshot) await withLinkedConnection(snapshot.config, modelId, current, apply);
      else await apply();
    });
    if (worldMode && !destroyed) {
      await selectVariableMode(worldMode);
      if (configLibrary().pendingWorld?.key === workspaceContextKey()) setSaveStatus('idle', '配置已应用，世界书待同步；请在日常调整中重新检查。');
      else setSaveStatus('saved', '配置已应用，世界书同步完成。');
    }
  }

  function exportConfigurations(id = '', scopes = exportScopes) {
    assertData(scopes.preset || scopes.summary, '请至少勾选一类导出配置');
    assertData(!state.config.configuration_error, '当前配置数据异常，请使用“导出原始备份”。');
    const library = configLibrary();
    const candidates = id ? library.items.filter(item => item.id === id) : library.items;
    const items = candidates.map(item => {
      const complete=validateSnapshot(item.snapshot);
      const snapshot={ version:2, ...(scopes.preset && complete.preset ? {preset:complete.preset}:{}), ...(scopes.summary && complete.summary ? {summary:complete.summary}:{}) };
      return snapshot.preset || snapshot.summary ? {...item,snapshot}:null;
    }).filter(Boolean);
    assertData(items.length, '没有可导出的配置');
    return JSON.stringify({ format: 'destined-configurations', version: 2, items: redactSecrets(items) }, null, 2);
  }

  function redactSecrets(value) {
    if(Array.isArray(value))return value.map(redactSecrets);
    if(!plainObject(value))return value;
    return Object.fromEntries(Object.entries(value).filter(([key])=>!/(?:api[_-]?key|secrets|summary_assistant_(?:worldbook|mega_summary_map|auto_hidden_floors))/i.test(key)).map(([key,entry])=>[key,redactSecrets(entry)]));
  }

  function exportRecoverableConfigurations() {
    assertData(exportScopes.preset || exportScopes.summary, '请至少勾选一类导出配置');
    const raw=getVariables({type:'script'}).configuration_library;
    const items=[];
    for(const item of Array.isArray(raw?.items)?raw.items:[]) {
      try {
        const complete=validateSnapshot(item.snapshot);
        const snapshot={version:2,...(exportScopes.preset&&complete.preset?{preset:complete.preset}:{}),...(exportScopes.summary&&complete.summary?{summary:complete.summary}:{})};
        if(snapshot.preset||snapshot.summary) items.push({id:String(item.id ?? crypto.randomUUID()),name:String(item.name ?? '恢复的配置'),createdAt:String(item.createdAt ?? ''),updatedAt:String(item.updatedAt ?? ''),snapshot});
      } catch { /* Invalid records cannot be safely shared; the original remains stored. */ }
    }
    assertData(items.length, '没有可安全导出的有效配置；原始数据仍保留在脚本变量中');
    return JSON.stringify({format:'destined-configurations',version:2,items:redactSecrets(items)},null,2);
  }

  function rejectUnsafeKeys(value) {
    if (!value || typeof value !== 'object') return;
    for (const key of Object.keys(value)) {
      assertData(!['__proto__', 'constructor', 'prototype'].includes(key), '文件包含不支持的对象字段');
      rejectUnsafeKeys(value[key]);
    }
  }

  async function importConfigurations(text) {
    assertData(typeof text === 'string' && text.length <= 20 * 1024 * 1024, '配置文件超过 20 MB 或格式无效');
    const document = JSON.parse(text.replace(/^\uFEFF/u, ''));
    rejectUnsafeKeys(document);
    assertData(document.format === 'destined-configurations' && [1,2].includes(document.version), '不支持的命定配置文件或版本');
    const imported = validateLibrary({ ...emptyLibrary(), items: document.items }).items;
    return runWorkspaceOperation('导入配置', async current => {
      const next = clone(state.config);
      const library = next.configuration_library;
      for (const item of imported) {
        const originalName = item.name;
        let suffix = 2;
        while (library.items.some(other => other.name.toLocaleLowerCase() === item.name.toLocaleLowerCase())) item.name = originalName.slice(0, 88) + ' (' + suffix++ + ')';
        if (library.items.some(other => other.id === item.id)) item.id = createPromptId();
        library.items.push(item);
      }
      writeConfigurationData(next, current);
      return imported.length;
    });
  }

  function downloadConfiguration(text, name) {
    const blob = new Blob([text], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = name.replace(/[<>:"/\\|?*\u0000-\u001f]/gu, '_') + '.json';
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  async function addCustomModel(name, tailMode = 'no-prefill', bindingKey = '') {
    assertData(state.editorUnlocked,'请先打开编辑模式');
    return runWorkspaceOperation('新增模型', async current => {
      const config = clone(state.config);
      const label = validName(name, Object.entries(MODEL_ADAPTERS).map(([id, adapter]) => ({ id, name: adapter.label })));
      assertData(['prefill', 'no-prefill'].includes(tailMode), '尾部必须二选一');
      const preset = clone(getPreset('in_use'));
      const expected = fingerprintPresetValue(preset);
      const gemini = BUILTIN_MODEL_ADAPTERS.Gemini;
      const sourceIds = [gemini.ids[0], gemini.ids[1], gemini.tails[tailMode === 'prefill' ? 0 : 1]];
      const indices = sourceIds.map(id => preset.prompts.findIndex(prompt => prompt.id === id));
      assertData(indices.every(index => index >= 0) && indices[0] < indices[1] && indices[1] < indices[2], 'Gemini 模板缺失或头部、思维链、尾部区域顺序异常。');
      const id = 'model:' + createPromptId();
      const ids = sourceIds.map(() => createPromptId());
      const parts = ['head', 'thinking', 'tail'];
      const titles = ['🔌 ' + label + '头部', '🧠 ' + label + '思维链', '🔌 ' + label + (tailMode === 'prefill' ? '预填充' : '非预填充')];
      for (let part = 0; part < 3; part++) {
        const source = requirePrompt(preset, sourceIds[part]);
        const prompt = { ...clone(source), id: ids[part], name: titles[part], enabled: false };
        prompt.extra = { ...prompt.extra, destined_model: { id, part: parts[part] } };
        let index = preset.prompts.findIndex(item => item.id === source.id);
        const related = new Set(config.custom_models.filter(model => part !== 2 || model.tailMode === tailMode).map(model => model.ids[part]));
        while (related.has(preset.prompts[index + 1]?.id)) index++;
        preset.prompts.splice(index + 1, 0, prompt);
      }
      const sourceTail = requirePrompt(preset, sourceIds[2]);
      config.custom_models.push({ id, label, ids, tailMode, tailBaseline: { content: sourceTail.content, role: sourceTail.role } });
      if (bindingKey) {
        await loadProfiles(false);
        const matches = state.profiles.filter(profile => profileKey(profile) === bindingKey);
        assertData(matches.length === 1, '选择的连接已不存在或不唯一。');
        config.connection_link.bindings[id] = { id: matches[0].id, name: matches[0].name };
      } else config.connection_link.bindings[id] = null;
      assertData(current() && fingerprintPresetValue(getPreset('in_use')) === expected, '上下文或预设内容已变化，未新增模型。');
      await writeWorkspace(preset, config, current);
      state.modelDraft = { name: '', tailMode: 'no-prefill', binding: '' };
      return id;
    });
  }

  async function renameCustomModel(id, name) {
    assertData(state.editorUnlocked,'请先打开编辑模式');
    return runWorkspaceOperation('重命名模型', async current => {
      const next = clone(state.config);
      const model = next.custom_models.find(item => item.id === id);
      assertData(model, '自定义模型不存在');
      const previousLabel = model.label;
      model.label = validName(name, Object.entries(MODEL_ADAPTERS).map(([key, adapter]) => ({ id: key, name: adapter.label })), id);
      const preset = clone(getPreset('in_use'));
      const suffixes = ['头部', '思维链', model.tailMode === 'prefill' ? '预填充' : '非预填充'];
      model.ids.forEach((promptId, index) => {
        const prompt = requirePrompt(preset, promptId);
        const prefix = index === 1 ? '🧠 ' : '🔌 ';
        if (prompt.name === prefix + previousLabel + suffixes[index]) prompt.name = prefix + model.label + suffixes[index];
      });
      await writeWorkspace(preset, next, current);
    });
  }

  async function deleteCustomModel(id) {
    assertData(state.editorUnlocked,'请先打开编辑模式');
    return runWorkspaceOperation('删除模型', async current => {
      assertData(detectModelAdapter() !== id, '请先切换到其他模型，再删除当前模型。');
      const next = clone(state.config);
      const model = next.custom_models.find(item => item.id === id);
      assertData(model, '自定义模型不存在');
      assertData(!model.ids.some(promptId => getPrompt(state.preset, promptId)?.enabled), '该模型仍有启用条目，请先切换到其他模型。');
      const preset = clone(getPreset('in_use'));
      saveRecovery(current);
      next.configuration_library = clone(state.config.configuration_library);
      preset.prompts = preset.prompts.filter(prompt => !model.ids.includes(prompt.id));
      preset.prompts_unused = preset.prompts_unused.filter(prompt => !model.ids.includes(prompt.id));
      next.custom_models = next.custom_models.filter(item => item.id !== id);
      delete next.connection_link.bindings[id];
      await writeWorkspace(preset, next, current);
    });
  }

  async function setCustomTail(id, mode, replaceEdited = false) {
    assertData(state.editorUnlocked,'请先打开编辑模式');
    return runWorkspaceOperation('切换尾部类型', async current => {
      assertData(['prefill', 'no-prefill'].includes(mode), '尾部必须二选一');
      const next = clone(state.config);
      const model = next.custom_models.find(item => item.id === id);
      assertData(model, '自定义模型不存在');
      if (model.tailMode === mode) return;
      const preset = clone(getPreset('in_use'));
      const tail = requirePrompt(preset, model.ids[2]);
      const edited = tail.content !== model.tailBaseline.content || tail.role !== model.tailBaseline.role;
      assertData(!edited || replaceEdited, '尾部正文已修改，请确认替换后再切换。');
      const source = requirePrompt(preset, BUILTIN_MODEL_ADAPTERS.Gemini.tails[mode === 'prefill' ? 0 : 1]);
      saveRecovery(current);
      next.configuration_library = clone(state.config.configuration_library);
      tail.content = source.content;
      tail.role = source.role;
      tail.name = '🔌 ' + model.label + (mode === 'prefill' ? '预填充' : '非预填充');
      model.tailMode = mode;
      model.tailBaseline = { content: source.content, role: source.role };
      await writeWorkspace(preset, next, current);
    });
  }

  function updateWorkspaceUi() {
    if (!shadow) return;
    const editMode=shadow.querySelector('[data-action="edit-mode"]');
    if(editMode){editMode.checked=state.editorUnlocked;editMode.disabled=state.workspaceBusy||state.reorderSaving||!!state.promptEditor?.saving;}
    const slot = shadow.querySelector('.configuration-shortcut');
    if (slot) slot.innerHTML = renderConfigurationShortcut();
    for (const area of shadow.querySelectorAll('.panel-layout, .configuration-shortcut')) area.toggleAttribute('inert', state.workspaceBusy);
  }

  function configurationIsDirty() {
    const item = configLibrary().items.find(item => item.id === configLibrary().activeId);
    if (!item || !state.preset) return false;
    try { return JSON.stringify(captureConfiguration(state.preset, state.config, selectedScopes(validateSnapshot(item.snapshot)))) !== JSON.stringify(validateSnapshot(item.snapshot)); }
    catch { return true; }
  }

  function renderConfigurationShortcut() {
    const library = configLibrary();
    return '<label>当前配置 <select aria-label="切换配置" data-action="configuration-switch"><option value="">未命名的当前设置</option>'
      + library.items.map(item => '<option value="' + escapeHtml(item.id) + '" ' + (item.id === library.activeId ? 'selected' : '') + '>' + escapeHtml(item.name) + '</option>').join('')
      + '</select></label><span>' + (configurationIsDirty() ? '已修改' : '') + '</span>'
      + '<button type="button" class="text-button" data-action="tab" data-tab="configurations">配置管理</button>';
  }

  function configButton(action, label, id = '') {
    return '<button type="button" class="secondary-button" data-action="' + action + '" data-id="' + escapeHtml(id) + '">' + label + '</button>';
  }

  function scopeCheckboxes(kind, scopes) {
    return '<div class="configuration-actions" role="group" aria-label="' + (kind==='save'?'保存范围':'导出范围') + '"><strong>'+(kind==='save'?'保存范围':'导出范围')+'</strong>'
      + ['preset','summary'].map(key=>'<label><input type="checkbox" data-action="configuration-scope" data-kind="'+kind+'" data-key="'+key+'" '+(scopes[key]?'checked':'')+'>'+(key==='preset'?'预设配置':'总结配置')+'</label>').join('')+'</div>';
  }

  function renderConfigurationsTab() {
    if (state.config.configuration_error) return '<div class="warning">' + escapeHtml(state.config.configuration_error) + '</div>' + scopeCheckboxes('export',exportScopes) + configButton('configuration-raw', '导出可恢复配置');
    const library = configLibrary();
    return renderSectionHeader('配置管理', '按范围保存与切换。密钥、世界书和聊天记录不会导出。')
      + '<article class="card"><label class="field-label">新配置名称<input data-action="configuration-name" maxlength="100" value="' + escapeHtml(state.configurationName) + '"></label><div class="configuration-actions">'
      + scopeCheckboxes('save',configurationScopes) + configButton('configuration-save-new', '保存当前 / 另存为')
      + (library.activeId ? configButton('configuration-overwrite', '覆盖当前配置', library.activeId) : '') + '</div></article>'
      + scopeCheckboxes('export',exportScopes) + '<div class="configuration-actions">' + configButton('configuration-import', '导入 JSON') + configButton('configuration-export-all', '导出配置库')
      + (library.recovery ? configButton('configuration-recover', '恢复切换前设置') : '') + '</div>'
      + '<input type="file" accept=".json,application/json" data-action="configuration-file" hidden>'
      + (library.items.length ? library.items.map(item => '<article class="card configuration-row"><div><h4>' + escapeHtml(item.name)
        + (item.id === library.activeId ? ' · 当前' : '') + '</h4><p>' + escapeHtml(item.updatedAt) + ' · ' + (item.snapshot.preset ? item.snapshot.preset.prompts.length + ' 个发送条目' : '仅总结配置') + (item.snapshot.preset && item.snapshot.summary ? ' · 含总结配置' : '') + '</p></div><div class="configuration-actions">'
        + configButton('configuration-apply', '切换', item.id) + configButton('configuration-rename', '重命名', item.id)
        + configButton('configuration-export', '导出', item.id) + configButton('configuration-delete', '删除', item.id) + '</div></article>').join('')
        : '<p class="empty">还没有保存的配置。</p>');
  }

  function renderCustomModelControls() {
    if(!state.editorUnlocked)return '';
    const draft = state.modelDraft;
    return '<article class="card"><h4>新增自定义模型</h4><p>复制 Gemini 的头部、思维链和选中的一种尾部，共三个独立条目。</p>'
      + '<div class="field-grid"><label class="field-label">模型名称<input data-action="model-draft" data-field="name" maxlength="100" value="' + escapeHtml(draft.name) + '"></label>'
      + '<label class="field-label">尾部类型<select data-action="model-draft" data-field="tailMode"><option value="no-prefill" ' + (draft.tailMode === 'no-prefill' ? 'selected' : '') + '>非预填充</option><option value="prefill" ' + (draft.tailMode === 'prefill' ? 'selected' : '') + '>预填充</option></select></label>'
      + '<label class="field-label">酒馆连接配置<select data-action="model-draft" data-field="binding"><option value="">不绑定</option>'
      + state.profiles.map(profile => '<option value="' + escapeHtml(profileKey(profile)) + '" ' + (draft.binding === profileKey(profile) ? 'selected' : '') + '>' + escapeHtml(profile.name) + '</option>').join('')
      + '</select></label></div><div class="configuration-actions">' + configButton('model-add', '添加模型') + '</div></article>'
      + (state.config.custom_models ?? []).map(model => '<article class="card"><h4>' + escapeHtml(model.label) + '</h4><div class="configuration-actions">'
        + configButton('model-rename', '重命名', model.id) + configButton('model-delete', '删除', model.id)
        + model.ids.map((id, index) => configButton('prompt-open', ['头部', '思维链', '尾部'][index], id)).join('')
        + '</div><label class="field-label">尾部类型<select data-action="custom-tail" data-model="' + escapeHtml(model.id) + '"><option value="no-prefill" ' + (model.tailMode === 'no-prefill' ? 'selected' : '') + '>非预填充</option><option value="prefill" ' + (model.tailMode === 'prefill' ? 'selected' : '') + '>预填充</option></select></label></article>').join('');
  }

  async function handleConfigurationAction(action, target) {
    const id = target.dataset.id;
    if (action === 'configuration-save-new') return saveNamedConfiguration(state.configurationName);
    if (action === 'configuration-overwrite') {
      if (window.confirm('用当前设置覆盖这份命名配置？')) return saveNamedConfiguration('', id);
    }
    if (action === 'configuration-apply') return applyConfiguration(id);
    if (action === 'configuration-recover') return applyConfiguration('__recovery__');
    if (action === 'configuration-rename') {
      const item = configLibrary().items.find(item => item.id === id);
      const name = window.prompt('配置名称', item?.name ?? '');
      if (name !== null) return renameConfiguration(id, name);
    }
    if (action === 'configuration-delete' && window.confirm('删除这份命名配置？当前设置不会被删除。')) return deleteConfiguration(id);
    if (action === 'configuration-export') {
      const item = configLibrary().items.find(item => item.id === id);
      downloadConfiguration(exportConfigurations(id), item?.name ?? '命定配置');
    }
    if (action === 'configuration-export-all') downloadConfiguration(exportConfigurations(), '命定配置库');
    if (action === 'configuration-raw') downloadConfiguration(exportRecoverableConfigurations(), '命定配置恢复备份');
    if (action === 'configuration-import') shadow.querySelector('[data-action="configuration-file"]')?.click();
    if (action === 'model-add') return addCustomModel(state.modelDraft.name, state.modelDraft.tailMode, state.modelDraft.binding);
    if (action === 'model-rename') {
      const name = window.prompt('模型名称', MODEL_ADAPTERS[id]?.label ?? '');
      if (name !== null) return renameCustomModel(id, name);
    }
    if (action === 'model-delete' && window.confirm('删除该模型及其三个条目？已保存的配置保持不变。')) return deleteCustomModel(id);
  }

  const STYLES = PANEL_CSS + SUMMARY_STYLES + DIALOG_STYLES;

  globalThis.__destinedJourneyAssistant = { destroy: cleanup, open: openPanel };
  try {
    const version = await getTavernHelperVersion();
    if (typeof version === 'string' && typeof isVersionLessThan === 'function' && isVersionLessThan(version, '4.0.0')) {
      toastr.error(`${BUTTON_NAME}需要酒馆助手 4.0.0 或更高版本。`, '版本不兼容');
    }
  } catch {
    // 老版本可能没有版本比较函数，后续 API 错误会给出明确提示。
  }

  syncEntryPoints();

  createUi();
  dialogs = createDialogs({ getRoot: () => shadow, open: openPanel });
  await summary.initialize({
    popup: (...args) => dialogs.popup(...args),
    chooseFailure: options => dialogs.chooseFailure(options),
    status: (message, kind) => setSaveStatus(kind === 'error' ? 'error' : kind === 'success' ? 'saved' : 'idle', message),
    openSummary: () => { state.activeTab = 'summary'; openPanel(); },
    changed: () => { const slot = shadow?.querySelector('.configuration-shortcut'); if(slot)slot.innerHTML=renderConfigurationShortcut(); },
  });
  window.parent.addEventListener('resize', handleViewportResize);
  window.parent.visualViewport?.addEventListener('resize', handleViewportResize);
  window.parent.visualViewport?.addEventListener('scroll', handleViewportResize);
  handleViewportResize();
  registerManagedMacros();
  refreshPreset();
  (async () => {
    await initializeManagedSettings();
    await initializeStyleStructures();
  })().catch(error => {
    console.error(`[${SCRIPT_NAME}] 初始化受管设置失败。`, error);
    showErrorToast(error);
  });
  loadProfiles();
  subscribe(getButtonEvent(BUTTON_NAME), openPanel);
  for (const eventName of [
    tavern_events.PRESET_CHANGED,
    tavern_events.OAI_PRESET_CHANGED_AFTER,
    tavern_events.SETTINGS_UPDATED,
  ]) subscribe(eventName, () => reconcilePreset('酒馆预设界面'));
  subscribeLast(tavern_events.CHAT_COMPLETION_PROMPT_READY, eventData => {
    expandOutgoingMessages(eventData?.chat);
  });
  subscribeLast(tavern_events.GENERATE_AFTER_DATA, generateData => {
    expandOutgoingMessages(generateData?.prompt);
  });
  for (const eventName of [
    tavern_events.CONNECTION_PROFILE_LOADED,
    tavern_events.CONNECTION_PROFILE_CREATED,
    tavern_events.CONNECTION_PROFILE_DELETED,
    tavern_events.CONNECTION_PROFILE_UPDATED,
  ]) subscribe(eventName, () => loadProfiles());
  scheduleWorldbookScan();
  for (const eventName of [tavern_events.CHAT_CHANGED, tavern_events.CHARACTER_PAGE_LOADED, tavern_events.CHARACTER_EDITED, tavern_events.WORLDINFO_SETTINGS_UPDATED, tavern_events.PRESET_CHANGED, tavern_events.OAI_PRESET_CHANGED_AFTER]) {
    subscribe(eventName, () => { reconcilePreset('上下文变化'); scheduleWorldbookScan(); });
  }
  subscribe(tavern_events.WORLDINFO_UPDATED, name => {
    try { if (captureWorldContext().names.includes(name)) scheduleWorldbookScan(); } catch { /* next open retries */ }
  });
  syncInterval = window.setInterval(() => {
    if (window.parent.document.hidden) return;
    syncWandEntry();
    if (state.open) reconcilePreset('原生预设界面');
  }, PRESET_SYNC_INTERVAL);
  window.addEventListener('pagehide', cleanup, { once: true });
  return { destroy: cleanup, open: openPanel };
}
