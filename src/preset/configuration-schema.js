import * as summary from '../summary/service.js';

// Dependencies use live accessors so asynchronous operations share the current state.
export function createConfigurationSchema(ctx) {
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
    const used = new Set(Object.values(ctx.BUILTIN_MODEL_ADAPTERS).flatMap(a => [...a.ids, ...a.tails]));
    const names = Object.keys(ctx.BUILTIN_MODEL_ADAPTERS).map(name => ({ id: name, name }));
    const ids = new Set(Object.keys(ctx.BUILTIN_MODEL_ADAPTERS));
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

  function modelRegistry(config = ctx.state.config) {
    const registry = { ...ctx.BUILTIN_MODEL_ADAPTERS };
    if (!config.configuration_error) for (const model of config.custom_models ?? []) {
      registry[model.id] = { ...model, tails: [], custom: true };
    }
    return registry;
  }

  function rebuildModelRegistry() {
    ctx.MODEL_ADAPTERS = modelRegistry();
    ctx.MODEL_IDS = new Set(Object.values(ctx.MODEL_ADAPTERS).flatMap(a => [...a.ids, ...a.tails]));
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
    for (const id of Object.keys(modelRegistry({ custom_models }))) bindings[id] = ctx.sanitizeBinding(config.connection_link?.bindings?.[id]);
    return {
      managed_values: ctx.sanitizeManagedValues(config.managed_values),
      entry_points: ctx.sanitizeEntryPoints(config.entry_points),
      custom_models,
      connection_link: { enabled: config.connection_link?.enabled === true, bindings },
      model_tail_modes: { Gemini: config.model_tail_modes?.Gemini === 'prefill' ? 'prefill' : 'no-prefill' },
    };
  }

  function capturePresetConfiguration(preset = getPreset('in_use'), config = ctx.state.config) {
    const result = {
      version: 1, settings: pickSettings(preset.settings),
      prompts: preset.prompts.map(snapshotPrompt), prompts_unused: (preset.prompts_unused ?? []).map(snapshotPrompt),
      config: snapshotConfig(config),
      author: preset.extensions?.destined_author ? ctx.validateAuthorLayout(preset.extensions.destined_author) : null,
    };
    const tail = ctx.getGeminiTail(preset);
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
      author: value.author == null ? null : ctx.validateAuthorLayout(value.author),
    };
    const seen = new Set();
    for (const prompt of [...result.prompts, ...result.prompts_unused]) {
      assertData(!seen.has(prompt.id), '配置包含重复条目 ID');
      seen.add(prompt.id);
    }
    for (const id of ctx.PROTECTED_IDS) assertData(result.prompts.some(p => p.id === id && p.enabled), '配置缺少或禁用了基础条目：' + id);
    for (const adapter of Object.values(modelRegistry(result.config))) {
      for (const id of [...adapter.ids, ...adapter.tails]) assertData(result.prompts.some(p => p.id === id), '配置缺少模型条目：' + id);
    }
    const mode = ctx.variablePresetMode(result);
    assertData(mode === 'main' || mode === 'extra', '配置中的变量模式必须二选一');
    return result;
  }

  function selectedScopes(snapshot) { return { preset: !!snapshot.preset, summary: !!snapshot.summary }; }

  function captureConfiguration(preset = getPreset('in_use'), config = ctx.state.config, scopes = ctx.configurationScopes) {
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
    return ctx.state.config.configuration_error ? emptyLibrary() : ctx.state.config.configuration_library;
  }

  function workspaceContextKey() {
    return ctx.captureWorldContext().key;
  }

  async function flushPendingSaves() {
    const tasks = [...ctx.debounceTimers.values()].map(item => item.flush?.()).filter(Boolean);
    await Promise.all(tasks);
    await ctx.saveChain;
    await summary.flush();
  }

  return {
    emptyLibrary,
    plainObject,
    assertData,
    validName,
    validateCustomModels,
    modelRegistry,
    rebuildModelRegistry,
    settingsKeys,
    pickSettings,
    snapshotPrompt,
    snapshotConfig,
    capturePresetConfiguration,
    validatePresetSnapshot,
    selectedScopes,
    captureConfiguration,
    validateSnapshot,
    validateLibrary,
    configLibrary,
    workspaceContextKey,
    flushPendingSaves
  };
}
