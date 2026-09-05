// Preset identifiers, managed fields and interface defaults.
export const SCRIPT_NAME = '【命定之诗】预设设置';

export const BUTTON_NAME = '命定预设设置';

export const LEGACY_BUTTON_NAME = '命定设置';

export const UI_THEMES = Object.freeze([
  { id: 'midnight', label: '曜石黑金' },
  { id: 'forest', label: '翡翠秘林' },
  { id: 'ember', label: '龙血余烬' },
  { id: 'parchment', label: '羊皮古卷' },
]);

export const SAVE_DELAY = 300;

export const PROFILE_TIMEOUT = 5000;

export const PRESET_SYNC_INTERVAL = 1500;

export const MANAGED_VALUES_VERSION = 2;

export const STYLE_STRUCTURE_VERSION = 1;

export const MOBILE_BREAKPOINT = 720;

export const PANEL_VIEWPORT_MARGIN = 12;

export const PANEL_MIN_WIDTH = 620;

export const PANEL_MIN_HEIGHT = 460;

export const DEFAULT_MANAGED_VALUES = Object.freeze({
  min_hanzi: '1500',
  dialogue_ratio: '40',
  dialogue_round_trips: '3',
  combat_rounds: '1',
  narration_person: 'third',
  body_language: '简体中文',
  thinking_language: '简体中文',
  global_preference: '',
});

export const MANAGED_MACROS = Object.freeze({
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

export const MANAGED_MACRO_PATTERN = /<\|(字数|对白比例|对白轮次|战斗回合|人称|人称要求|正文语言|思维链语言|全局偏好)\|>/gu;

export const UNKNOWN_DESTINED_MACRO_PATTERN = /<\|命定[^|>]*\|>/gu;

export const USER_ADDITIONAL_OPEN = '{{#setvar 用户设定}}';

export const USER_ADDITIONAL_CLOSE = '{{/setvar}}';

export const USER_ADDITIONAL_TRIM = '{{trim}}';

export const USER_ADDITIONAL_DEFAULT = [
  '- 避免将<user>的言行描述成过于自信，不自量力的爽文/俗套小说主角',
  '- 避免将<user>言行描述为支配与命令等不平等权力关系内容',
  '- 避免油腻/性骚扰, 强迫女性, 苦大仇深/阴郁, 刻板说教',
].join('\n');

export const IDS = Object.freeze({
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

export const BUILTIN_MODEL_ADAPTERS = Object.freeze({
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

export const GROUPS = Object.freeze({
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

export const PROTECTED_IDS = new Set([
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

export const SECTION_LABELS = Object.freeze({
  model: '模型',
  output: '输出',
  narrative: '叙事',
  style: '文风',
  content: '内容',
  system: '系统',
  other: '新增 / 其他',
});

export const CURATED_TOGGLES = Object.freeze({
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

export const BEAUTIFY_IDS = Object.freeze([
  'c10c1fdb-cb0b-435b-8d39-7b2e1f1c5e1e',
  '7d83b417-2887-4c66-8d40-bf166f51c4c4',
  'b6e338e2-d3dc-46a2-ad4e-1685c3b97598',
  '1cabd885-7332-4e1b-bd8e-c0e1a6226285',
  'd963ded2-4d8a-467e-943d-1af5d9458c09',
]);

export const AFTER_BODY_IDS = Object.freeze([IDS.outputSummary, IDS.actionOptions, IDS.antiEmpty]);

export const FIXED_UI_IDS = new Set([IDS.globalPreference, IDS.userAdditional, ...AFTER_BODY_IDS]);

export const DEFAULT_GROUP_OPTION_IDS = Object.freeze({
  'base-tone': 'e50a8252-ed29-43a9-9f32-636bfb867c1e',
  'main-style': '3e3e6335-662b-4b0d-bd86-8d7195f7363e',
});

export const USER_CREATABLE_GROUPS = Object.freeze({
  'base-tone': { label: '基调', prefix: '🎭 ', tag: 'base_tone' },
  'main-style': { label: '主文风', prefix: '✒️ ', tag: 'main_writing_style' },
});

export const VARIABLE_WORLD_ENTRIES = Object.freeze({
  main: 'output_format_(随AI输出开，主API)',
  extra: '[mvu_update]output_format_(使用额外模型更新变量开)',
  input: '[mvu_update]用户最新输入(使用额外模型更新变量开)',
});

export const WORLD_TIMEOUT = 3500;

export const FIELD_DEFINITIONS = Object.freeze({
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

export const LANGUAGE_DEFINITIONS = Object.freeze({
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

export const LANGUAGE_PRESETS = Object.freeze([
  ['简体中文', '简体中文'],
  ['繁体中文', '繁体中文'],
  ['English', '英语'],
  ['日本語', '日语'],
]);

export const PLACEHOLDER_IDS = new Set(['worldInfoBefore', 'personaDescription', 'charDescription', 'charPersonality', 'scenario', 'worldInfoAfter', 'dialogueExamples', 'chatHistory']);

export const SYSTEM_PROMPT_IDS = new Set(['main', 'nsfw', 'jailbreak', 'enhanceDefinitions']);
