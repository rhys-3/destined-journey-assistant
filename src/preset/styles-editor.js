// Dependencies use live accessors so asynchronous operations share the current state.
export function createStylesEditor(ctx) {
  function openStyleEditor(id = '', requestedGroupId = 'main-style') {
    if(!ctx.state.editorUnlocked)return;
    const prompt = id ? ctx.getPrompt(ctx.state.preset, id) : null;
    const groupId = prompt?.extra?.destined_ui?.group ?? requestedGroupId;
    const definition = ctx.USER_CREATABLE_GROUPS[groupId];
    if (!definition) return ctx.showErrorToast(new Error('该分组不支持创建自定义条目。'));
    if (id && !ctx.isUserCreatedGroupPrompt(prompt, groupId)) {
      return ctx.showErrorToast(new Error(`只能编辑由预设设置创建的${definition.label}。`));
    }
    const managedContent = prompt ? ctx.readStylePromptContent(prompt, groupId) : { ok: true, value: '' };
    if (prompt && !managedContent.ok) {
      return ctx.showErrorToast(new Error(managedContent.error || `${definition.label}的 XML 包装异常，已停止编辑。`));
    }
    ctx.state.styleEditor = prompt
      ? { id: prompt.id, groupId, title: ctx.groupPromptTitle(prompt, groupId), content: managedContent.value }
      : { id: '', groupId, title: '', content: '' };
    ctx.state.activeTab = 'style';
    ctx.renderActiveContent(true);
    ctx.renderStyleEditorLayer();
    queueMicrotask(() => ctx.shadow.querySelector('[data-action="style-title"]')?.focus());
  }

  async function saveStyleEditor() {
    if(!ctx.state.editorUnlocked)return;
    const titleInput = ctx.shadow.querySelector('[data-action="style-title"]');
    const contentInput = ctx.shadow.querySelector('[data-action="style-content"]');
    const groupId = ctx.state.styleEditor?.groupId ?? '';
    const definition = ctx.USER_CREATABLE_GROUPS[groupId];
    if (!definition) return ctx.showErrorToast(new Error('该分组不支持创建自定义条目。'));
    const title = ctx.normalizeName(titleInput?.value)
      .replace(new RegExp(`^${definition.label}\\s*[｜|]\\s*`, 'u'), '')
      .trim();
    const content = String(contentInput?.value ?? '').trim();
    const editorId = ctx.state.styleEditor?.id ?? '';
    if (!title || !content) return ctx.showErrorToast(new Error(`${definition.label}名称和正文都不能为空。`));
    if (content.includes(`</${definition.tag}>`)) {
      return ctx.showErrorToast(new Error(`${definition.label}正文不能包含 </${definition.tag}>，否则会截断受管区域。`));
    }
    const newId = editorId || ctx.createPromptId();
    try {
      await ctx.queuePresetMutation(editorId ? `编辑自定义${definition.label}` : `新增自定义${definition.label}`, preset => {
        const duplicate = (preset.prompts ?? []).some(prompt =>
          prompt.id !== editorId
          && ctx.getPromptGroupId(prompt) === groupId
          && ctx.groupPromptTitle(prompt, groupId).toLocaleLowerCase('zh-CN') === title.toLocaleLowerCase('zh-CN'),
        );
        if (duplicate) throw new Error(`${definition.label}“${title}”已经存在。`);
        if (editorId) {
          const prompt = ctx.requirePrompt(preset, editorId);
          if (!ctx.isUserCreatedGroupPrompt(prompt, groupId)) throw new Error(`该条目不是预设设置创建的${definition.label}。`);
          if (!ctx.readStylePromptContent(prompt, groupId).ok) throw new Error(`${definition.label}的 XML 包装异常，已停止写入。`);
          prompt.name = `${definition.prefix}${title}`;
          prompt.content = ctx.buildStylePromptContent(groupId, content);
        } else {
          for (const [optionId] of ctx.getGroupOptions(groupId, preset)) {
            ctx.requirePrompt(preset, optionId).enabled = false;
          }
          const prompt = {
            id: newId,
            name: `${definition.prefix}${title}`,
            enabled: true,
            position: { type: 'relative' },
            role: 'system',
            content: ctx.buildStylePromptContent(groupId, content),
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
            if (ctx.getPromptGroupId(preset.prompts[index]) === groupId) insertAt = index;
          }
          ctx.writePlacement(prompt,groupId,0,preset);
          preset.prompts.splice(insertAt < 0 ? ctx.nativePlacementIndex(preset,groupId,'',prompt.id) : insertAt + 1, 0, prompt);
        }
      });
      ctx.state.styleEditor = null;
      ctx.renderActiveContent(true);
      ctx.renderStyleEditorLayer();
    } catch (error) {
      ctx.showErrorToast(error);
    }
  }

  async function deleteUserStyle(id) {
    const prompt=ctx.getPrompt(ctx.state.preset,id);
    if(!ctx.isUserCreatedGroupPrompt(prompt))return ctx.showErrorToast(new Error('只能删除自建的基调或主文风。'));
    if(!ctx.state.editorUnlocked)return;
    ctx.openPromptEditor(id);return ctx.editEntryAction('entry-delete');
  }

  function setStreaming(enabled) {
    ctx.queuePresetMutation('流式输出', preset => {
      preset.settings.should_stream = enabled;
    }).catch(ctx.showErrorToast);
  }

  async function ensurePromptMetadata() {
    // Only this preset owns these required entries; never repair another preset's placeholders.
    if (ctx.state.workspaceBusy || ctx.metadataEnriching || !ctx.getPrompt(ctx.state.preset, '03adb1e6-e613-48ad-844e-035444017ec4')) return;
    const missing = ctx.state.preset.prompts.filter(p => ctx.PROTECTED_IDS.has(p.id) && !p.enabled);
    if (!missing.length) return;
    ctx.metadataEnriching = true;
    try {
      await ctx.queuePresetMutation('恢复必需条目', preset => {
        for (const prompt of preset.prompts ?? []) if (ctx.PROTECTED_IDS.has(prompt.id)) prompt.enabled = true;
      });
    } catch (error) { console.warn('[命定设置] 基础条目恢复失败', error); }
    finally { ctx.metadataEnriching = false; }
  }

  function inferPromptMeta(prompt) {
    if (prompt.id === ctx.IDS.globalPreference) return { section: 'system', control: 'managed-content', order: 5 };
    if (prompt.id === ctx.IDS.userAdditional) return { section: 'content', control: 'managed-content', order: 5 };
    if (ctx.AFTER_BODY_IDS.includes(prompt.id)) return { section: 'output', control: 'toggle', order: 50 + ctx.AFTER_BODY_IDS.indexOf(prompt.id) * 10 };
    const explicit = prompt.extra?.destined_ui;
    if (explicit?.version === 1 && explicit.section in ctx.SECTION_LABELS) return explicit;
    if (ctx.PROTECTED_IDS.has(prompt.id)) return { section: 'system', control: 'readonly', protected: true, order: 0 };
    if (ctx.MODEL_IDS.has(prompt.id)) return { section: 'model', control: 'single-option', group: 'model-adapter', order: 10 };
    const groupId = ctx.ID_TO_GROUP.get(prompt.id);
    if (groupId) return { section: ctx.GROUPS[groupId].section, control: 'single-option', group: groupId, order: 20 };
    if ([ctx.IDS.dialogue, ctx.IDS.outputLength].includes(prompt.id)) return { section: 'output', control: 'managed-field', order: 10 };
    if (prompt.id === ctx.IDS.narration) return { section: 'narrative', control: 'managed-field', order: 10 };

    const name = ctx.normalizeName(prompt.name);
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

  return { openStyleEditor, saveStyleEditor, deleteUserStyle, setStreaming, ensurePromptMetadata, inferPromptMeta };
}
