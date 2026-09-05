// Dependencies use live accessors so asynchronous operations share the current state.
export function createConnections(ctx) {
  async function loadProfiles(shouldRender = true) {
    const revision = ctx.state.profileLoadRevision = (ctx.state.profileLoadRevision ?? 0) + 1;
    ctx.state.profileLoading = true;
    if (shouldRender) ctx.render();
    let profiles = [];
    try {
      const service = ctx.getContext()?.ConnectionManagerRequestService;
      if (typeof service?.getSupportedProfiles === 'function') {
        profiles = (await ctx.withWorldTimeout(Promise.resolve(service.getSupportedProfiles()), '读取连接列表', ctx.PROFILE_TIMEOUT)).map(profile => ({
          api: String(profile.api ?? ''),
          id: String(profile.id ?? profile.name ?? ''),
          mode: String(profile.mode ?? ''),
          model: String(profile.model ?? ''),
          name: String(profile.name ?? profile.id ?? ''),
        }));
      }
    } catch (error) {
      console.warn(`[${ctx.SCRIPT_NAME}] 读取 ConnectionManagerRequestService 失败。`, error);
    }

    if (profiles.length === 0) {
      try {
        const result = await ctx.withWorldTimeout(Promise.resolve(triggerSlash('/profile-list')), '读取连接列表', ctx.PROFILE_TIMEOUT);
        profiles = parseProfileList(result);
      } catch (error) {
        console.warn(`[${ctx.SCRIPT_NAME}] /profile-list 不可用。`, error);
      }
    }

    if (ctx.destroyed || revision !== ctx.state.profileLoadRevision) return;
    ctx.state.profiles = profiles
      .filter(profile => profile.name)
      .sort((left, right) => left.name.localeCompare(right.name, 'zh-CN'));
    ctx.state.profileLoading = false;
    if (shouldRender) ctx.render();
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
    const byId = binding.id ? ctx.state.profiles.filter(profile => profile.id === binding.id) : [];
    if (byId.length) return byId.length === 1 ? byId[0] : null;
    const byName = binding.name ? ctx.state.profiles.filter(profile => profile.name === binding.name) : [];
    return byName.length === 1 ? byName[0] : null;
  }

  async function getCurrentProfileName() {
    try {
      return String(await ctx.withWorldTimeout(Promise.resolve(triggerSlash('/profile')), '读取当前连接', ctx.PROFILE_TIMEOUT) ?? '').trim();
    } catch {
      return '';
    }
  }

  function slashQuote(value) {
    return `"${String(value).replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"`;
  }

  async function switchConnectionProfile(profile) {
    await triggerSlash(`/profile await=true timeout=${ctx.PROFILE_TIMEOUT} ${slashQuote(profile.name)}`);
    await new Promise(resolve => setTimeout(resolve, 150));
    const currentName = await getCurrentProfileName();
    if (!currentName || currentName !== profile.name) {
      throw new Error(`连接配置切换校验失败：期望“${profile.name}”，当前为“${currentName}”。`);
    }

    const context = ctx.getContext();
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
    if (enabled && ctx.state.profiles.length === 0) {
      return showErrorToast(new Error('未发现可用的 SillyTavern Connection Profile。'));
    }
    ctx.state.config.connection_link.enabled = enabled;
    ctx.saveScriptConfig(enabled ? '已开启连接配置联动' : '已关闭连接配置联动').catch(showErrorToast);
  }

  function updateEntryPoint(key, enabled, control) {
    if (!['floating_orb', 'input_button', 'wand_menu'].includes(key)) return;
    const previous = ctx.sanitizeEntryPoints(ctx.state.config.entry_points);
    if (!enabled && previous[key] && Object.values(previous).filter(Boolean).length <= 1) {
      if (control) control.checked = true;
      return showErrorToast(new Error('至少需要保留一个设置界面入口。'));
    }
    ctx.state.config.entry_points = { ...previous, [key]: enabled };
    syncEntryPoints();
    const labels = {
      floating_orb: '悬浮球入口',
      input_button: '输入框上方入口',
      wand_menu: '魔术棒菜单入口',
    };
    ctx.saveScriptConfig(`${labels[key]}已${enabled ? '开启' : '关闭'}`).catch(error => {
      syncEntryPoints();
      showErrorToast(error);
    });
  }

  function syncEntryPoints() {
    ctx.state.config.entry_points = ctx.sanitizeEntryPoints(ctx.state.config.entry_points);
    ctx.syncOrbVisibility();
    syncInputButtonEntry();
    syncWandEntry();
  }

  function syncInputButtonEntry() {
    const visible = ctx.state.config.entry_points.input_button === true;
    updateScriptButtonsWith(buttons => {
      const existing = buttons.find(button => button.name === ctx.BUTTON_NAME || ctx.LEGACY_BUTTON_NAMES.includes(button.name));
      const others = buttons.filter(button => button.name !== ctx.BUTTON_NAME && !ctx.LEGACY_BUTTON_NAMES.includes(button.name));
      return [...others, { ...existing, name: ctx.BUTTON_NAME, visible }];
    });
  }

  function syncWandEntry() {
    const parentDocument = window.parent.document;
    const existing = parentDocument.getElementById(ctx.WAND_CONTAINER_ID);
    if (ctx.state.config.entry_points.wand_menu !== true) {
      existing?.remove();
      return;
    }
    if (existing) return;
    const menu = parentDocument.getElementById('extensionsMenu');
    if (!menu) return;

    const container = parentDocument.createElement('div');
    container.id = ctx.WAND_CONTAINER_ID;
    container.className = 'extension_container';
    container.dataset.scriptId = ctx.SCRIPT_ID;
    container.setAttribute('script_id', ctx.SCRIPT_ID);
    const item = parentDocument.createElement('div');
    item.className = 'list-group-item flex-container flexGap5';
    item.tabIndex = 0;
    item.setAttribute('role', 'button');
    item.setAttribute('aria-label', ctx.BUTTON_NAME);
    item.title = ctx.BUTTON_NAME;
    const icon = parentDocument.createElement('i');
    icon.className = 'fa-solid fa-wand-magic-sparkles';
    icon.setAttribute('aria-hidden', 'true');
    const label = parentDocument.createElement('span');
    label.textContent = ctx.BUTTON_NAME;
    item.append(icon, label);
    item.addEventListener('click', event => {
      event.preventDefault();
      ctx.openPanel();
    });
    item.addEventListener('keydown', event => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      event.preventDefault();
      ctx.openPanel();
    });
    container.append(item);
    menu.append(container);
    const menuButton = parentDocument.getElementById('extensionsMenuButton');
    if (menuButton) menuButton.style.display = 'flex';
  }

  function updateProfileBinding(adapterName, key) {
    const profile = ctx.state.profiles.find(item => profileKey(item) === key);
    ctx.state.config.connection_link.bindings[adapterName] = profile
      ? { id: profile.id, name: profile.name }
      : null;
    ctx.saveScriptConfig(`${adapterName} 连接配置已保存`).catch(showErrorToast);
  }

  function showErrorToast(error) {
    const message = error instanceof Error ? error.message : String(error);
    toastr.error(message, ctx.BUTTON_NAME);
    console.error(`[${ctx.SCRIPT_NAME}]`, error);
  }

  return {
    loadProfiles,
    parseProfileList,
    profileKey,
    resolveBoundProfile,
    getCurrentProfileName,
    slashQuote,
    switchConnectionProfile,
    updateConnectionLink,
    updateEntryPoint,
    syncEntryPoints,
    syncInputButtonEntry,
    syncWandEntry,
    updateProfileBinding,
    showErrorToast
  };
}
