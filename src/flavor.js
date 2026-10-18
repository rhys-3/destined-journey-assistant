// Build-time flavor table. src/index.js stays the only runtime entry;
// build.js injects the selected entry as __ASSISTANT_FLAVOR__ so one source
// produces both bundles and neither artifact carries the other's identifiers.
// The prime values keep the published assistant identifier for compatibility.
export const FLAVORS = {
  prime: {
    id: 'prime',
    scriptName: '命定预设助手',
    buttonName: '命定预设助手',
    legacyButtonNames: ['命定预设设置', '命定设置'],
    panelTitleHtml: '命定·黄昏 Prime <span>预设助手</span>',
    presetLabel: '命定预设',
    exportLabel: '命定',
    singletonKey: '__destinedJourneyAssistant',
    elementIdPrefix: 'destined-settings',
    // Chat-scoped flag of the discussion mode. The assistant owns this value;
    // the preset and the message processor only read message metadata.
    discussionChatKey: 'destined_discussion_mode',
    summaryWorldbookPrefix: '命定之诗总结世界书',
    summaryVariablePrefix: 'summary_assistant',
    legacySummaryScriptIds: ['3eb6e3eb-7a14-47dc-900c-759cd2f0bf64'],
    legacySummaryScriptNames: ['【命定之诗】总结', '命定之诗总结助手'],
    // Variable-mode options this flavor exposes, in display order. Prime keeps
    // the two shipped choices; the general preset adds a third no-variable
    // entry, so the list stays per flavor instead of global.
    variableModes: [
      { key: 'main', id: '85c7f45b-e3b4-430c-bbab-822498d93de2', label: '主 API', hint: '随正文一起更新变量' },
      { key: 'extra', id: '9103b46e-5810-4ed9-b06e-4365070fca35', label: '额外 API', hint: '额外模型单独解析变量' },
    ],
    // Prompt ids the active preset must all carry before this flavor treats it
    // as its own. Prime keeps an empty list: it edits whatever preset is loaded
    // exactly as before.
    ownPresetPromptIds: [],
    // Managed short macros and settings controls this preset carries. Macros
    // outside this list are never injected into the preset.
    managed: {
      macros: ['hanzi', 'lengthRequirement', 'dialogueRatio', 'dialogueRounds', 'combatRounds', 'narrationPerson', 'narrationRequirement', 'bodyLanguage', 'thinkingLanguage', 'globalPreference', 'userAdditional'],
      controls: { dialogue: ['dialogueRatio', 'dialogueRounds'], length: ['hanzi', 'combatRounds'], languages: ['body', 'thinking'] },
    },
    output: 'dist/destined-journey-assistant.js',
  },
  general: {
    id: 'general',
    scriptName: '通用预设助手',
    buttonName: '通用预设助手',
    legacyButtonNames: [],
    panelTitleHtml: '通用角色扮演 <span>预设助手</span>',
    presetLabel: '通用预设',
    exportLabel: '通用',
    singletonKey: '__generalRoleplayAssistant',
    elementIdPrefix: 'general-settings',
    discussionChatKey: 'general_discussion_mode',
    summaryWorldbookPrefix: '通用总结世界书',
    summaryVariablePrefix: 'general_summary',
    // The general flavor replaces no earlier script, so it never adopts or
    // disables the legacy 命定 summarizer the prime assistant migrates from.
    legacySummaryScriptIds: [],
    legacySummaryScriptNames: [],
    // The general preset ships a third choice that opts out of variable
    // updates entirely; its prompt is 0257f4b5-bfa7-4729-8d79-96e9abf760bc.
    variableModes: [
      { key: 'main', id: '85c7f45b-e3b4-430c-bbab-822498d93de2', label: '主接口变量', hint: '随正文一起更新变量' },
      { key: 'extra', id: '9103b46e-5810-4ed9-b06e-4365070fca35', label: '额外接口变量', hint: '额外模型单独解析变量' },
      { key: 'none', id: '0257f4b5-bfa7-4729-8d79-96e9abf760bc', label: '无变量', hint: '不通过预设更新世界状态变量' },
    ],
    // Both assistants can be installed at once, so a preset switch to Prime must
    // never let this flavor write Prime's preset: it only acts on a preset that
    // carries its own variable-mode entries (Prime carries only the first two).
    ownPresetPromptIds: [
      '85c7f45b-e3b4-430c-bbab-822498d93de2',
      '9103b46e-5810-4ed9-b06e-4365070fca35',
      '0257f4b5-bfa7-4729-8d79-96e9abf760bc',
    ],
    // The general preset keeps a collaborative writing schema: no <|字数|>
    // floor, no <|战斗回合|> pacing and no model-entry thinking language. Those
    // migrations and controls are left out instead of failing, and the shared
    // fields keep the static defaults from DEFAULT_MANAGED_VALUES. The 'hanzi'
    // control renders the length card, which only reads <|字数要求|>.
    managed: {
      macros: ['lengthRequirement', 'dialogueRatio', 'dialogueRounds', 'narrationPerson', 'narrationRequirement', 'bodyLanguage', 'globalPreference', 'userAdditional'],
      controls: { dialogue: ['dialogueRatio', 'dialogueRounds'], length: ['hanzi'], languages: ['body'] },
    },
    output: 'dist/destined-journey-assistant-general.js',
  },
};

// build.js injects __ASSISTANT_FLAVOR__ plus the __ASSISTANT_FLAVOR_INJECTED__
// marker. The marker is a compile-time string, so bundling keeps the injected
// entry and drops the table; running from source (tests, scripts) keeps prime.
const injected = typeof __ASSISTANT_FLAVOR_INJECTED__ === 'string' ? __ASSISTANT_FLAVOR__ : FLAVORS.prime;
export const FLAVOR = Object.freeze({ ...injected });
