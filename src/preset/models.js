// Dependencies use live accessors so asynchronous operations share the current state.
export function createModels(ctx) {
  function getGroupOptions(groupId, preset = ctx.state.preset) {
    const options = [];
    for (const prompt of preset?.prompts ?? []) {
      const promptGroup = getPromptGroupId(prompt, preset);
      if (promptGroup === groupId) options.push([prompt.id, String(prompt.name ?? prompt.id)]);
    }
    return options;
  }

  function getPromptGroupId(prompt, preset = ctx.state.preset) {
    if (!prompt) return null;
    const meta=prompt.extra?.destined_ui;
    if(meta?.version===3)return meta.group||null;
    if(meta?.version===2&&!ctx.authorDependency(prompt))return ctx.authorLayout(preset).blocks.find(b=>b.id===meta.block)?.kind==='single'?meta.block:null;
    return ctx.ID_TO_GROUP.get(prompt.id) ?? (ctx.inferPromptMeta(prompt).control==='single-option'?ctx.inferPromptMeta(prompt).group:ctx.legacyAuthorBlock(prompt)==='unclassified'?ctx.inferNativePlacement(prompt,preset).group:null);
  }

  function applyGroup(groupId, selectedId) {
    if (groupId === 'variable-mode') {
      const index = ctx.GROUPS['variable-mode'].options.findIndex(([id]) => id === selectedId);
      if (index >= 0) return ctx.selectVariableMode(index === 0 ? 'main' : 'extra');
      return;
    }
    const group = ctx.GROUPS[groupId];
    const options = getGroupOptions(groupId);
    const customGroup = ctx.authorLayout().blocks.find(b => b.id === groupId && b.kind === 'single');
    if (!options.some(([id]) => id === selectedId) && !(selectedId === '' && customGroup?.allowNone)) return;
    const task = ctx.queuePresetMutation(group?.label ?? groupId, preset => {
      for (const [id] of getGroupOptions(groupId, preset)) ctx.requirePrompt(preset, id).enabled = id === selectedId;
    });
    for (const button of ctx.shadow.querySelectorAll('[data-action="group"]')) {
      if (button.dataset.group === groupId) {
        button.classList.toggle('selected', button.dataset.value === selectedId);

      }
    }
    task.catch(ctx.showErrorToast);
  }

  function detectModelAdapter(preset = ctx.state.preset, registry = ctx.MODEL_ADAPTERS) {
    const matches = [];
    for (const [name, adapter] of Object.entries(registry)) {
      const required = adapter.ids.every(id => ctx.getPrompt(preset, id)?.enabled);
      const otherIds = Object.entries(registry)
        .filter(([other]) => other !== name)
        .flatMap(([, item]) => [...item.ids, ...item.tails]);
      const othersDisabled = otherIds.every(id => !ctx.getPrompt(preset, id)?.enabled);
      const tailValid = name !== 'Gemini'
        || adapter.tails.filter(id => ctx.getPrompt(preset, id)?.enabled).length === 1;
      if (required && othersDisabled && tailValid) matches.push(name);
    }
    return matches.length === 1 ? matches[0] : null;
  }

  function getGeminiTail(preset = ctx.state.preset) {
    const [prefill, noPrefill] = ctx.MODEL_ADAPTERS.Gemini.tails;
    if (ctx.getPrompt(preset, prefill)?.enabled && !ctx.getPrompt(preset, noPrefill)?.enabled) return 'prefill';
    if (!ctx.getPrompt(preset, prefill)?.enabled && ctx.getPrompt(preset, noPrefill)?.enabled) return 'no-prefill';
    return null;
  }

  function applyModelToPreset(preset, adapterName) {
    const geminiTail = getGeminiTail(preset) ?? ctx.state.config.model_tail_modes?.Gemini ?? 'no-prefill';
    for (const [name, adapter] of Object.entries(ctx.MODEL_ADAPTERS)) {
      for (const id of adapter.ids) ctx.requirePrompt(preset, id).enabled = name === adapterName;
      for (const id of adapter.tails) {
        ctx.requirePrompt(preset, id).enabled = name === adapterName
          && (geminiTail === 'prefill' ? id === adapter.tails[0] : id === adapter.tails[1]);
      }
    }
  }

  async function selectModelAdapter(adapterName) {
    if (!ctx.MODEL_ADAPTERS[adapterName]) return;
    return ctx.runWorkspaceOperation('切换模型', async current => {
      const config = ctx.clone(ctx.state.config);
      const tail = getGeminiTail();
      if (tail) config.model_tail_modes.Gemini = tail;
      await ctx.withLinkedConnection(config, adapterName, current, async () => {
        const preset = ctx.clone(getPreset('in_use'));
        applyModelToPreset(preset, adapterName);
        await ctx.writeWorkspace(preset, config, current);
      });
    }).catch(ctx.showErrorToast);
  }

  function setGeminiTail(mode) {
    return ctx.runWorkspaceOperation('Gemini 尾部模式', async current => {
      ctx.assertData(['prefill', 'no-prefill'].includes(mode), '尾部必须二选一');
      ctx.assertData(detectModelAdapter() === 'Gemini', '请先切换到 Gemini 适配');
      const preset = ctx.clone(getPreset('in_use'));
      const [prefill, noPrefill] = ctx.BUILTIN_MODEL_ADAPTERS.Gemini.tails;
      ctx.requirePrompt(preset, prefill).enabled = mode === 'prefill';
      ctx.requirePrompt(preset, noPrefill).enabled = mode === 'no-prefill';
      const config = ctx.clone(ctx.state.config);
      config.model_tail_modes.Gemini = mode;
      await ctx.writeWorkspace(preset, config, current);
    }).catch(ctx.showErrorToast);
  }

  return { getGroupOptions, getPromptGroupId, applyGroup, detectModelAdapter, getGeminiTail, applyModelToPreset, selectModelAdapter, setGeminiTail };
}
