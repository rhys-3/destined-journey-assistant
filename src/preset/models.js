// Dependencies use live accessors so asynchronous operations share the current state.
import { NSFW_GROUP, normalizeBlockId, GEMINI_TAIL_MODES, GEMINI_TAIL_LABELS, OPTIONAL_MODEL_PROMPT_IDS, geminiTailMode } from './definitions.js';

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
    if(meta?.version===3){
      // Early NSFW-section presets shipped these built-in modes with an empty group and an adult block id.
      const block=normalizeBlockId(meta.block);
      if(!meta.group&&block===NSFW_GROUP&&ctx.ID_TO_GROUP.get(prompt.id)===NSFW_GROUP)return NSFW_GROUP;
      return meta.group||null;
    }
    if(meta?.version===2&&!ctx.authorDependency(prompt))return ctx.authorLayout(preset).blocks.find(b=>b.id===meta.block)?.kind==='single'?meta.block:null;
    return ctx.ID_TO_GROUP.get(prompt.id) ?? (ctx.inferPromptMeta(prompt).control==='single-option'?ctx.inferPromptMeta(prompt).group:ctx.legacyAuthorBlock(prompt)==='unclassified'?ctx.inferNativePlacement(prompt,preset).group:null);
  }

  function applyGroup(groupId, selectedId) {
    if (groupId === 'variable-mode') {
      // Match by entry id instead of position so the general flavor's third
      // 无变量 option routes correctly and prime keeps its two choices.
      const mode = ctx.VARIABLE_MODE_BY_ID.get(selectedId);
      if (mode) return ctx.selectVariableMode(mode);
      return;
    }
    const group = ctx.GROUPS[groupId];
    const options = getGroupOptions(groupId);
    const customGroup = ctx.authorLayout().blocks.find(b => b.id === groupId && b.kind === 'single');
    if (!options.some(([id]) => id === selectedId) && !(selectedId === '' && customGroup?.allowNone)) return;
    const task = ctx.queuePresetMutation(group?.label ?? ctx.authorLayout().blocks.find(b=>b.id===groupId)?.label ?? groupId, preset => {
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
    const enabled = ctx.MODEL_ADAPTERS.Gemini.tails
      .map((id, index) => ctx.getPrompt(preset, id)?.enabled ? GEMINI_TAIL_MODES[index] : null)
      .filter(Boolean);
    return enabled.length === 1 ? enabled[0] : null;
  }

  // The tool-output tail is absent from presets that predate it.
  function geminiTailAvailable(mode, preset = ctx.state.preset) {
    return !!ctx.getPrompt(preset, ctx.BUILTIN_MODEL_ADAPTERS.Gemini.tails[GEMINI_TAIL_MODES.indexOf(mode)]);
  }

  function applyModelToPreset(preset, adapterName) {
    let geminiTail = geminiTailMode(getGeminiTail(preset) ?? ctx.state.config.model_tail_modes?.Gemini);
    if (!geminiTailAvailable(geminiTail, preset)) geminiTail = 'no-prefill';
    for (const [name, adapter] of Object.entries(ctx.MODEL_ADAPTERS)) {
      for (const id of adapter.ids) ctx.requirePrompt(preset, id).enabled = name === adapterName;
      adapter.tails.forEach((id, index) => {
        const prompt = OPTIONAL_MODEL_PROMPT_IDS.has(id) ? ctx.getPrompt(preset, id) : ctx.requirePrompt(preset, id);
        if (prompt) prompt.enabled = name === adapterName && GEMINI_TAIL_MODES[index] === geminiTail;
      });
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
      ctx.assertData(GEMINI_TAIL_MODES.includes(mode), '尾部模式无效');
      ctx.assertData(detectModelAdapter() === 'Gemini', '请先切换到 Gemini 适配');
      const preset = ctx.clone(getPreset('in_use'));
      ctx.assertData(geminiTailAvailable(mode, preset), '当前预设没有「' + GEMINI_TAIL_LABELS[mode] + '」尾部条目，请更新预设。');
      ctx.BUILTIN_MODEL_ADAPTERS.Gemini.tails.forEach((id, index) => {
        const prompt = ctx.getPrompt(preset, id);
        if (prompt) prompt.enabled = GEMINI_TAIL_MODES[index] === mode;
      });
      const config = ctx.clone(ctx.state.config);
      config.model_tail_modes.Gemini = mode;
      await ctx.writeWorkspace(preset, config, current);
    }).catch(ctx.showErrorToast);
  }

  return { getGroupOptions, getPromptGroupId, applyGroup, detectModelAdapter, getGeminiTail, geminiTailAvailable, applyModelToPreset, selectModelAdapter, setGeminiTail };
}
