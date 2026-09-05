// Dependencies use live accessors so asynchronous operations share the current state.
export function createWorldbook(ctx) {
  function worldEntryKey(name) {
    return String(name ?? '').normalize('NFKC').replace(/[\s_]/gu, '').toLowerCase();
  }

  function variableEntryRole(entry) {
    const key = worldEntryKey(entry.name);
    return Object.keys(ctx.VARIABLE_WORLD_ENTRIES).find(role => worldEntryKey(ctx.VARIABLE_WORLD_ENTRIES[role]) === key) ?? '';
  }

  function variablePresetMode(preset = ctx.state.preset) {
    const options = ctx.GROUPS['variable-mode'].options;
    const main = ctx.getPrompt(preset, options[0][0])?.enabled === true;
    const extra = ctx.getPrompt(preset, options[1][0])?.enabled === true;
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
    const context = ctx.getContext();
    const sorted = [...names].sort();
    const key = JSON.stringify([getLoadedPresetName(), context?.characterId, context?.groupId, context?.chatId, sorted]);
    return { key, names: sorted, errors };
  }

  function worldContextIsCurrent(context, epoch) {
    if (ctx.destroyed || ctx.worldEpoch !== epoch) return false;
    try { return captureWorldContext().key === context.key; } catch { return false; }
  }

  function withWorldTimeout(promise, label, timeout = ctx.WORLD_TIMEOUT) {
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
    else if (missing.length) issue = `缺少：${missing.map(role => ctx.VARIABLE_WORLD_ENTRIES[role]).join('、')}`;
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
    const deadline = Date.now() + ctx.WORLD_TIMEOUT * 2;
    let index = 0;
    // At most three reads in flight; repeated events reuse unresolved requests.
    await Promise.all(Array.from({ length: Math.min(3, context.names.length) }, async () => {
      while (index < context.names.length) {
        const name = context.names[index++];
        if (Date.now() >= deadline) { issues.push(`${name}：本次检查时间已用完，请重新检查`); continue; }
        try {
          let request = ctx.worldReads.get(name);
          if (!request) {
            if (ctx.worldReads.size >= 3) throw new Error('已有世界书读取等待返回，请稍后重新检查');
            request = Promise.resolve().then(() => getWorldbook(name));
            ctx.worldReads.set(name, request);
            const release = () => { if (ctx.worldReads.get(name) === request) ctx.worldReads.delete(name); };
            request.then(release, release);
          }
          const entries = await withWorldTimeout(request, `读取 ${name}`, Math.min(ctx.WORLD_TIMEOUT, deadline - Date.now()));
          const book = inspectVariableBook(name, entries);
          if (book) books.push(book);
        } catch (error) { issues.push(`${name}：${error.message ?? error}`); }
      }
    }));
    books.sort((a, b) => a.name.localeCompare(b.name));
    return { books, issues };
  }

  function renderVariableSlot() {
    const slot = ctx.shadow?.querySelector('.variable-slot');
    if (!slot) return;
    const detailsOpen = slot.querySelector('.world-link-details')?.open === true;
    const active = ctx.shadow.activeElement;
    const value = slot.contains(active) ? active?.dataset?.value : null;
    slot.innerHTML = renderVariablePanel();
    if (detailsOpen && slot.querySelector('.world-link-details')) slot.querySelector('.world-link-details').open = true;
    if (value) [...slot.querySelectorAll('button')].find(button => button.dataset.value === value && !button.disabled)?.focus({ preventScroll: true });
  }

  function showWorldLink(phase, message, result = null) {
    ctx.worldLink.phase = phase;
    ctx.worldLink.message = message;
    if (result) { ctx.worldLink.books = result.books; ctx.worldLink.issues = result.issues; }
    renderVariableSlot();
  }

  function saveVariablePreset(mode, context, epoch) {
    const guard = () => worldContextIsCurrent(context, epoch);
    const task = ctx.saveChain.then(() => {
      if (!guard()) throw new Error('聊天、预设或世界书绑定已变化，本次切换已停止');
      return ctx.commitPresetMutation('变量模式', preset => {
        const options = ctx.GROUPS['variable-mode'].options;
        for (const [id] of options) ctx.requirePrompt(preset, id);
        options.forEach(([id], index) => { ctx.requirePrompt(preset, id).enabled = index === (mode === 'main' ? 0 : 1); });
      }, guard);
    });
    ctx.saveChain = task.catch(() => {});
    return ctx.trackPresetOperation(task);
  }

  function scheduleWorldbookScan() {
    if (ctx.destroyed) return;
    if (ctx.worldLink.busy) {
      try {
        if (captureWorldContext().key !== ctx.worldOperationContext) { ctx.worldEpoch += 1; ctx.worldLink.dirty = true; }
      } catch { ctx.worldEpoch += 1; ctx.worldLink.dirty = true; }
      return;
    }
    ctx.worldEpoch += 1;
    ctx.worldLink.dirty = true;
    clearTimeout(ctx.worldTimer);
    ctx.worldTimer = setTimeout(() => { ctx.worldTimer = 0; scanWorldbookMode(); }, 280);
  }

  function scanWorldbookMode({ follow = true } = {}) {
    if (ctx.destroyed || ctx.state.workspaceBusy || ctx.worldLink.busy || ctx.worldWrites.size) return Promise.resolve();
    if (ctx.worldScan) { ctx.worldLink.dirty = true; return ctx.worldScan; }
    const epoch = ctx.worldEpoch;
    ctx.worldLink.dirty = false;
    ctx.worldScan = (async () => {
      let context;
      let ownsBusy = false;
      try {
        context = captureWorldContext();
        // Unrelated presets must never receive automatic changes.
        if (!ctx.GROUPS['variable-mode'].options.every(([id]) => ctx.getPrompt(ctx.state.preset, id))) {
          showWorldLink('warning', '当前预设缺少变量模式选项，无法联动。');
          return;
        }
        showWorldLink('checking', '正在检查当前绑定的世界书…');
        const result = await readVariableBooks(context);
        if (!worldContextIsCurrent(context, epoch)) return;
        const modes = new Set(result.books.map(book => book.mode));
        const mode = result.issues.length === 0 && result.books.length > 0 && modes.size === 1 && !modes.has(null)
          ? result.books[0].mode : null;
        const pending = ctx.configLibrary().pendingWorld;
        if (pending?.key === context.key) follow = false;
        if (mode && follow && variablePresetMode() !== mode) {
          ownsBusy = true;
          ctx.worldLink.busy = true;
          ctx.worldOperationContext = context.key;
          await saveVariablePreset(mode, context, epoch);
        }
        if (!worldContextIsCurrent(context, epoch)) return;
        const hasIssue = result.issues.length > 0 || result.books.some(book => book.issue) || !mode || pending?.key === context.key;
        const message = pending?.key === context.key ? '配置已应用，世界书待同步。点击重新检查可重试同步。' : result.books.length === 0
          ? (result.issues.length ? '世界书未完整读取，保留当前预设选择。可稍后重新检查。' : '当前绑定的世界书中未找到变量条目。你仍可选择预设模式，绑定世界书后再检查。')
          : mode ? `世界书使用${mode === 'main' ? '主 API' : '额外 API'}${hasIssue ? '，部分条目需要检查。' : '，预设模式已对应。'}`
          : '世界书状态不明确或彼此不一致，保留当前选择。选择一种模式可统一已有条目的开关。';
        showWorldLink(hasIssue ? 'warning' : 'ready', message, result);
      } catch (error) { if (!ctx.destroyed && (!context || worldContextIsCurrent(context, epoch))) showWorldLink('warning', `检查未完成：${error.message ?? error}`); }
      finally { if (ownsBusy) ctx.worldLink.busy = false; renderVariableSlot(); }
    })().finally(() => {
      ctx.worldScan = null;
      if (ctx.worldLink.dirty && !ctx.destroyed) scheduleWorldbookScan();
    });
    return ctx.worldScan;
  }

  async function selectVariableMode(mode) {
    if (!['main', 'extra'].includes(mode) || ctx.worldLink.busy || ctx.worldWrites.size) return;
    clearTimeout(ctx.worldTimer);
    ctx.worldTimer = 0;
    const epoch = ++ctx.worldEpoch;
    ctx.worldLink.dirty = false;
    ctx.worldLink.busy = true;
    let context;
    try {
      context = captureWorldContext();
      ctx.worldOperationContext = context.key;
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
          ctx.worldWrites.add(request);
          const release = () => {
            ctx.worldWrites.delete(request);
            if (cancelled && !ctx.destroyed) scheduleWorldbookScan();
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
      if (!incomplete && verified.length && ctx.configLibrary().pendingWorld?.key === context.key) {
        ctx.state.config.configuration_library.pendingWorld = null;
        await ctx.saveScriptConfig('世界书同步状态');
      }
      showWorldLink(incomplete || !verified.length ? 'warning' : 'ready', !verified.length
        ? '预设模式已保存；尚未联动到世界书。绑定后重新选择此模式即可同步。'
        : incomplete ? '预设模式已保存；世界书存在未完成项，见下方说明。已找到的可更新条目已处理。'
        : '预设与世界书条目已同步。请同时确认下方 MVU 更新方式。', { books: verified, issues });
    } catch (error) {
      if (!ctx.destroyed && (!context || worldContextIsCurrent(context, epoch))) showWorldLink('warning', `切换未完成：${error.message ?? error}`);
    } finally {
      ctx.worldLink.busy = false;
      renderVariableSlot();
      if (ctx.worldLink.dirty && !ctx.destroyed) scheduleWorldbookScan();
    }
  }

  function renderVariablePanel() {
    const mode = variablePresetMode();
    const unavailable = !ctx.GROUPS['variable-mode'].options.every(([id]) => ctx.getPrompt(ctx.state.preset, id));
    const disabled = ctx.worldLink.busy || ctx.worldWrites.size > 0 || unavailable;
    return `<article class="card variable-card" data-anchor="variables">
      <div class="card-title"><div><span class="step-label">开始前 · 变量更新</span><h4>由谁来更新世界状态？</h4><p>选择后联动当前绑定世界书中的变量条目。</p></div><span class="badge">${mode === 'main' ? '主 API' : mode === 'extra' ? '额外 API' : '待选择'}</span></div>
      <div class="variable-options">
        ${[['main', '主 API', '随正文一起更新变量'], ['extra', '额外 API', '额外模型单独解析变量']].map(([value, title, hint]) => `<button type="button" data-action="variable-mode" data-value="${value}" aria-pressed="${mode === value}" class="${mode === value ? 'selected' : ''}" ${disabled ? 'disabled' : ''}><strong>${title}</strong><small>${hint}</small><span aria-hidden="true">${mode === value ? '✓' : '○'}</span></button>`).join('')}
      </div>
      <p class="mvu-reminder">${mode ? `请在 <strong>MVU 变量框架</strong> 中，将 <strong>变量更新方式</strong> 设为 <strong>${mode === 'main' ? '随 AI 输出' : '额外模型解析'}</strong>。` : '请选择一种变量模式；世界书状态明确时会自动匹配。'}<small>这里联动预设与世界书，不会代改 MVU 框架设置。</small></p>
      <div class="world-link-status ${ctx.worldLink.phase}" role="status"><span>${ctx.escapeHtml(ctx.worldLink.message)}</span><button type="button" class="text-button" data-action="refresh-worldbook" ${ctx.worldLink.busy ? 'disabled' : ''}>重新检查</button></div>
      ${ctx.worldWrites.size ? '<p class="inline-warning">世界书写入尚未返回确认，暂不重复切换；其他设置可以继续使用。</p>' : ''}
      ${ctx.worldLink.books.length || ctx.worldLink.issues.length ? `<details class="world-link-details"><summary>联动详情 · ${ctx.worldLink.books.length} 本世界书${ctx.worldLink.issues.length || ctx.worldLink.books.some(book => book.issue) ? ' · 需要检查' : ''}</summary>${ctx.worldLink.books.map(book => `<div><strong>${ctx.escapeHtml(book.name)}</strong><small>${['main', 'extra', 'input'].map(role => `${({main:'主 API 输出',extra:'额外模型输出',input:'用户最新输入'})[role]}：${book.roles[role].length === 1 ? book.roles[role][0].enabled ? '开' : '关' : book.roles[role].length ? '重复' : '缺失'}`).join(' · ')}</small>${book.issue ? `<p>${ctx.escapeHtml(book.issue)}</p>` : ''}</div>`).join('')}${ctx.worldLink.issues.map(issue => `<p>${ctx.escapeHtml(issue)}</p>`).join('')}<small>只调整已有条目的启用状态；缺失条目需要在世界书中补齐。共享世界书的更改也会影响其他使用它的聊天。</small></details>` : ''}
    </article>`;
  }

  return {
    worldEntryKey,
    variableEntryRole,
    variablePresetMode,
    captureWorldContext,
    worldContextIsCurrent,
    withWorldTimeout,
    inspectVariableBook,
    readVariableBooks,
    renderVariableSlot,
    showWorldLink,
    saveVariablePreset,
    scheduleWorldbookScan,
    scanWorldbookMode,
    selectVariableMode,
    renderVariablePanel
  };
}
