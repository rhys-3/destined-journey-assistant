/**
 * worldbook.js
 * 世界书绑定、条目管理、楼层可见性
 * 依赖: config.js, utils.js, storage.js, errorHandler.js
 */

let _cachedChatWbName = null;
const AUTO_HIDDEN_FLOORS_VAR_KEY = "summary_assistant_auto_hidden_floors";

// ---- 世界书名称与绑定 ----

const generateDefaultWorldbookName = () => {
  const suffix =
    Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  return `${CONFIG.WORLDBOOK_NAME_PREFIX}_${suffix}`;
};

const readChatWorldbookBinding = () => {
  try {
    const vars = getVariables({ type: "chat" });
    const name = vars?.[CONFIG.CHAT_WB_VAR_KEY];
    return name && typeof name === "string" ? name : null;
  } catch (e) {
    return null;
  }
};

const writeChatWorldbookBinding = (name) => {
  try {
    insertOrAssignVariables(
      { [CONFIG.CHAT_WB_VAR_KEY]: name || "" },
      { type: "chat" },
    );
    _cachedChatWbName = name || null;
  } catch (e) {
    console.warn("写入聊天世界书绑定失败:", e);
  }
};

const clearChatWorldbookBinding = () => {
  try {
    insertOrAssignVariables({ [CONFIG.CHAT_WB_VAR_KEY]: "" }, { type: "chat" });
    _cachedChatWbName = null;
  } catch (e) {
    console.warn("清除聊天世界书绑定失败:", e);
  }
};

const getActiveWorldbookName = () => {
  if (_cachedChatWbName) return _cachedChatWbName;
  const name = readChatWorldbookBinding();
  _cachedChatWbName = name;
  return name;
};

const isChatWorldbookBound = () => {
  return !!getActiveWorldbookName();
};

// ---- 世界书绑定/解绑 ----

const bindWorldbookToChat = errorCatched(async (name) => {
  if (!name) return;
  const names = await getWorldbookNames();
  if (!names.includes(name)) {
    await createWorldbook(name, []);
    toastr.info(`已创建新世界书: "${name}"`, "", {
      positionClass: "toast-top-right",
    });
  }
  if (
    typeof getGlobalWorldbookNames === "function" &&
    typeof rebindGlobalWorldbooks === "function"
  ) {
    const globalNames = getGlobalWorldbookNames() || [];
    if (!globalNames.includes(name)) {
      await rebindGlobalWorldbooks([...new Set([...globalNames, name])]);
    }
  }
  writeChatWorldbookBinding(name);
});

const unbindWorldbookFromChat = errorCatched(async () => {
  const name = getActiveWorldbookName();
  if (!name) return;
  if (
    typeof getGlobalWorldbookNames === "function" &&
    typeof rebindGlobalWorldbooks === "function"
  ) {
    const globalNames = getGlobalWorldbookNames() || [];
    if (globalNames.includes(name)) {
      await rebindGlobalWorldbooks(globalNames.filter((n) => n !== name));
    }
  }
  clearChatWorldbookBinding();
});

// ---- 聊天切换处理 ----

const onChatChanged = errorCatched(async () => {
  const oldName = _cachedChatWbName;
  if (
    oldName &&
    typeof getGlobalWorldbookNames === "function" &&
    typeof rebindGlobalWorldbooks === "function"
  ) {
    const globalNames = getGlobalWorldbookNames() || [];
    if (globalNames.includes(oldName)) {
      await rebindGlobalWorldbooks(globalNames.filter((n) => n !== oldName));
    }
  }
  _cachedChatWbName = null;
  const newName = readChatWorldbookBinding();
  _cachedChatWbName = newName;
  if (newName) {
    const names = await getWorldbookNames();
    if (names.includes(newName)) {
      if (
        typeof getGlobalWorldbookNames === "function" &&
        typeof rebindGlobalWorldbooks === "function"
      ) {
        const globalNames = getGlobalWorldbookNames() || [];
        if (!globalNames.includes(newName)) {
          await rebindGlobalWorldbooks([...new Set([...globalNames, newName])]);
        }
      }
    } else {
      clearChatWorldbookBinding();
      toastr.warning(`绑定的世界书 "${newName}" 不存在，已自动解绑`);
    }
  }
});

// ---- 旧版迁移 ----

const migrateOldWorldbookName = errorCatched(async () => {
  if (readChatWorldbookBinding()) return;
  try {
    const scriptVars = getVariables({ type: "script" });
    const settings = scriptVars?.[CONFIG.SETTINGS_VAR_KEY];
    if (settings && settings.worldbookName) {
      const oldName = settings.worldbookName;
      const names = await getWorldbookNames();
      if (names.includes(oldName)) {
        await bindWorldbookToChat(oldName);
        toastr.info(`已将旧版世界书绑定迁移到当前聊天: "${oldName}"`);
      }
      delete settings.worldbookName;
      insertOrAssignVariables(
        { [CONFIG.SETTINGS_VAR_KEY]: settings },
        { type: "script" },
      );
      return;
    }
  } catch (e) {}
  const oldName = CONFIG.WORLDBOOK_NAME_PREFIX;
  const names = await getWorldbookNames();
  if (names.includes(oldName)) {
    await bindWorldbookToChat(oldName);
    toastr.info(`已自动绑定旧版世界书: "${oldName}"`);
  }
});

// ---- 世界书条目迁移 ----

const migrateWorldbookEntries = errorCatched(async (oldName, newName) => {
  if (oldName === newName) return;
  const names = await getWorldbookNames();
  if (!names.includes(newName)) {
    await createWorldbook(newName, []);
  }
  if (names.includes(oldName)) {
    const oldEntries = normalizeWorldbookEntries(await getWorldbook(oldName));
    const summaryEntries = oldEntries.filter(
      (e) => e && parseSummaryEntryName(e.name),
    );
    if (summaryEntries.length > 0) {
      const newEntries = normalizeWorldbookEntries(await getWorldbook(newName));
      const newByName = new Map(newEntries.map((e) => [e.name, e]));
      for (const entry of summaryEntries) {
        newByName.set(entry.name, { ...entry });
      }
      await replaceWorldbook(newName, [...newByName.values()]);
      const remaining = oldEntries.filter(
        (e) => !e || !parseSummaryEntryName(e.name),
      );
      if (remaining.length === 0) {
        await deleteWorldbook(oldName);
        if (
          typeof getGlobalWorldbookNames === "function" &&
          typeof rebindGlobalWorldbooks === "function"
        ) {
          const globalNames = getGlobalWorldbookNames() || [];
          if (globalNames.includes(oldName)) {
            await rebindGlobalWorldbooks(
              globalNames.filter((n) => n !== oldName),
            );
          }
        }
      } else {
        await replaceWorldbook(oldName, remaining);
      }
      toastr.success(
        `已将 ${summaryEntries.length} 个总结条目从 "${oldName}" 迁移到 "${newName}"`,
      );
    }
  }
  if (
    typeof getGlobalWorldbookNames === "function" &&
    typeof rebindGlobalWorldbooks === "function"
  ) {
    const globalNames = getGlobalWorldbookNames() || [];
    if (!globalNames.includes(newName)) {
      await rebindGlobalWorldbooks([...new Set([...globalNames, newName])]);
    }
  }
  writeChatWorldbookBinding(newName);
});

// ---- 条目读写 ----

const getWorldbookEntriesSafe = errorCatched(async () => {
  const wbName = getActiveWorldbookName();
  if (!wbName) return [];
  const names = await getWorldbookNames();
  if (!names.includes(wbName)) return [];
  const wb = await getWorldbook(wbName);
  return normalizeWorldbookEntries(wb);
});

const ensureWorldbookExists = errorCatched(async () => {
  let wbName = getActiveWorldbookName();
  if (!wbName) {
    wbName = generateDefaultWorldbookName();
    await bindWorldbookToChat(wbName);
    toastr.info(`已自动创建并绑定世界书: "${wbName}"`, "", {
      positionClass: "toast-top-right",
    });
    return;
  }
  const names = await getWorldbookNames();
  if (!names.includes(wbName)) {
    await createWorldbook(wbName, []);
    toastr.info(`已创建新世界书: "${wbName}"`);
  }
  if (
    typeof getGlobalWorldbookNames === "function" &&
    typeof rebindGlobalWorldbooks === "function"
  ) {
    const globalNames = getGlobalWorldbookNames() || [];
    if (!globalNames.includes(wbName)) {
      const next = [...new Set([...globalNames, wbName])];
      await rebindGlobalWorldbooks(next);
      toastr.info(`已将世界书加入全局启用: "${wbName}"`);
    }
  }
});

// ---- 楼层可见性 ----

const VISIBILITY_CHUNK_SIZE = 200;

const isEntryDisabled = (e) => {
  if (!e || typeof e !== "object") return true;
  if (typeof e.enabled === "boolean") return !e.enabled;
  if (typeof e.disable === "boolean") return e.disable;
  if (typeof e.disabled === "boolean") return e.disabled;
  return false;
};

const applyEntryDepthAndOrder = (entry, order) => {
  if (!entry || typeof entry !== "object") return;
  entry.strategy = {
    ...(entry.strategy && typeof entry.strategy === "object"
      ? entry.strategy
      : {}),
    type: "constant",
    keys: Array.isArray(entry.strategy?.keys)
      ? entry.strategy.keys
      : [entry.name || ""],
    keys_secondary: entry.strategy?.keys_secondary || {
      logic: "and_any",
      keys: [],
    },
    scan_depth: entry.strategy?.scan_depth ?? "same_as_global",
  };
  entry.position = {
    type: "at_depth",
    role: CONFIG.ENTRY_ROLE,
    depth: CONFIG.ENTRY_DEPTH,
    order,
  };
};

const addFloorRangeToSet = (set, parsed, lastId) => {
  if (!set || !parsed || lastId < 0) return;
  const start = Math.max(0, parsed.start);
  const end = Math.min(lastId, parsed.end);
  for (let i = start; i <= end; i++) {
    set.add(i);
  }
};

const buildSummarizedFloorSet = (entries, lastId, megaSummaryMap = {}) => {
  const set = new Set();
  if (!Array.isArray(entries) || lastId < 0) return set;

  for (const e of entries) {
    if (!e || isEntryDisabled(e)) continue;

    const summaryParsed = parseSummaryEntryName(e.name);
    if (summaryParsed) {
      addFloorRangeToSet(set, summaryParsed, lastId);
      continue;
    }

    const megaParsed = parseMegaSummaryEntryName(e.name);
    if (!megaParsed) continue;

    addFloorRangeToSet(set, megaParsed, lastId);

    const mappedSummaryNames = megaSummaryMap?.[e.name];
    if (!Array.isArray(mappedSummaryNames)) continue;
    for (const summaryName of mappedSummaryNames) {
      const mappedParsed = parseSummaryEntryName(summaryName);
      if (mappedParsed) {
        addFloorRangeToSet(set, mappedParsed, lastId);
      }
    }
  }

  return set;
};

const loadAutoHiddenFloorIds = () => {
  try {
    const vars = getVariables({ type: "chat" });
    const value = vars?.[AUTO_HIDDEN_FLOORS_VAR_KEY];
    if (!Array.isArray(value)) return new Set();
    return new Set(
      value
        .map((id) => Number.parseInt(id, 10))
        .filter((id) => Number.isFinite(id) && id >= 0),
    );
  } catch (e) {
    console.warn("加载自动隐藏楼层记录失败:", e);
    return new Set();
  }
};

const saveAutoHiddenFloorIds = (floorIds) => {
  try {
    const list = [...new Set([...floorIds])]
      .filter((id) => Number.isFinite(id) && id >= 0)
      .sort((a, b) => a - b);
    insertOrAssignVariables(
      { [AUTO_HIDDEN_FLOORS_VAR_KEY]: list },
      { type: "chat" },
    );
  } catch (e) {
    console.warn("保存自动隐藏楼层记录失败:", e);
  }
};

const applySummarizedFloorsVisibility = errorCatched(async () => {
  const settings = getSettings();
  const shouldAutoHide = settings.autoHideSummarizedFloors !== false;
  const lastId = getLastMessageId();
  if (lastId < 0) return false;
  const entries = await getWorldbookEntriesSafe();
  const megaSummaryMap = await getMegaSummaryMap();
  const summarizedSet = buildSummarizedFloorSet(
    entries,
    lastId,
    megaSummaryMap,
  );
  const previousAutoHiddenSet = loadAutoHiddenFloorIds();
  let maxSummarizedFloor = -1;
  for (const id of summarizedSet) {
    if (id > maxSummarizedFloor) maxSummarizedFloor = id;
  }
  const updates = [];
  const nextAutoHiddenSet = new Set();
  if (shouldAutoHide && maxSummarizedFloor >= 0) {
    const msgs = getChatMessages(`0-${maxSummarizedFloor}`, {
      role: "all",
      hide_state: "all",
      include_swipes: false,
    });
    for (const msg of msgs) {
      const id = msg?.message_id;
      if (!Number.isFinite(id)) continue;
      const currentHidden = !!msg?.is_hidden;
      const targetHidden = summarizedSet.has(id);
      if (targetHidden) {
        nextAutoHiddenSet.add(id);
      }
      if (currentHidden !== targetHidden) {
        updates.push({ message_id: id, is_hidden: targetHidden });
      }
    }

    for (const id of previousAutoHiddenSet) {
      if (!Number.isFinite(id) || nextAutoHiddenSet.has(id)) continue;
      updates.push({ message_id: id, is_hidden: false });
    }
  } else if (!shouldAutoHide || maxSummarizedFloor < 0) {
    for (const id of previousAutoHiddenSet) {
      if (!Number.isFinite(id)) continue;
      updates.push({ message_id: id, is_hidden: false });
    }
  }
  if (updates.length === 0) {
    saveAutoHiddenFloorIds(nextAutoHiddenSet);
    return false;
  }
  for (let i = 0; i < updates.length; i += VISIBILITY_CHUNK_SIZE) {
    const isLast = i + VISIBILITY_CHUNK_SIZE >= updates.length;
    await setChatMessages(updates.slice(i, i + VISIBILITY_CHUNK_SIZE), {
      refresh: isLast ? "all" : "none",
    });
  }
  saveAutoHiddenFloorIds(nextAutoHiddenSet);
  return true;
});

// ---- 条目排序与写入 ----

const buildSummaryOrderMap = (worldbookEntries, extraNameToInclude = null) => {
  const names = new Set();
  for (const e of worldbookEntries || []) {
    if (!e || typeof e.name !== "string") continue;
    if (parseSummaryEntryName(e.name)) names.add(e.name);
  }
  if (extraNameToInclude && parseSummaryEntryName(extraNameToInclude))
    names.add(extraNameToInclude);
  const list = [...names]
    .map((n) => ({ name: n, ...parseSummaryEntryName(n) }))
    .sort((a, b) => a.start - b.start || a.end - b.end);
  const map = new Map();
  list.forEach((item, idx) => {
    map.set(item.name, CONFIG.ENTRY_START_ORDER + idx);
  });
  return map;
};

const reorderAllSummaryEntries = errorCatched(async () => {
  const wbName = getActiveWorldbookName();
  if (!wbName) return;
  const entries = await getWorldbookEntriesSafe();
  const orderMap = buildSummaryOrderMap(entries);
  if (orderMap.size === 0) return;
  await updateWorldbookWith(wbName, (wb) => {
    const arr = normalizeWorldbookEntries(wb);
    for (const e of arr) {
      if (!e || typeof e.name !== "string") continue;
      if (orderMap.has(e.name)) {
        applyEntryDepthAndOrder(e, orderMap.get(e.name));
      }
    }
    return Array.isArray(wb) ? arr : { ...wb, entries: arr };
  });
});

const upsertSummaryEntryByName = errorCatched(async (entryName, content) => {
  await ensureWorldbookExists();
  const wbName = getActiveWorldbookName();
  const entries = await getWorldbookEntriesSafe();
  const orderMap = buildSummaryOrderMap(entries, entryName);
  const order = orderMap.get(entryName) ?? CONFIG.ENTRY_START_ORDER;
  const existing = entries.find((e) => e && e.name === entryName);

  if (existing) {
    const keepDisabled = isEntryDisabled(existing);
    await updateWorldbookWith(wbName, (wb) => {
      const arr = normalizeWorldbookEntries(wb);
      const target = arr.find((e) => e && e.name === entryName);
      if (target) {
        target.content = content;
        target.enabled = !keepDisabled;
        target.disable = keepDisabled;
        if ("disabled" in target) target.disabled = keepDisabled;
        applyEntryDepthAndOrder(target, order);
      }
      return Array.isArray(wb) ? arr : { ...wb, entries: arr };
    });
  } else {
    await createWorldbookEntries(wbName, [
      {
        name: entryName,
        content,
        enabled: true,
        strategy: {
          type: "constant",
          keys: [entryName],
          keys_secondary: { logic: "and_any", keys: [] },
          scan_depth: "same_as_global",
        },
        position: {
          type: "at_depth",
          role: CONFIG.ENTRY_ROLE,
          depth: CONFIG.ENTRY_DEPTH,
          order,
        },
        probability: 100,
        recursion: {
          prevent_incoming: true,
          prevent_outgoing: true,
          delay_until: null,
        },
        effect: { sticky: null, cooldown: null, delay: null },
      },
    ]);
  }
  await reorderAllSummaryEntries();
  const settings = getSettings();
  if (settings.autoHideSummarizedFloors !== false) {
    await applySummarizedFloorsVisibility();
  }
});

const deleteSummaryEntry = errorCatched(async (entryName) => {
  const wbName = getActiveWorldbookName();
  if (!wbName) return;
  await updateWorldbookWith(wbName, (wb) => {
    const arr = normalizeWorldbookEntries(wb);
    const filtered = arr.filter((e) => e && e.name !== entryName);
    return Array.isArray(wb) ? filtered : { ...wb, entries: filtered };
  });
  await reorderAllSummaryEntries();
  await applySummarizedFloorsVisibility();
});

// ---- 条目查询 ----

const getAllSummaryEntriesForDisplay = errorCatched(async () => {
  const entries = await getWorldbookEntriesSafe();
  return entries
    .filter((e) => e && parseSummaryEntryName(e.name))
    .map((e) => ({ name: e.name, disabled: isEntryDisabled(e) }))
    .sort(
      (a, b) =>
        (parseSummaryEntryName(a.name)?.start ?? 0) -
        (parseSummaryEntryName(b.name)?.start ?? 0),
    );
});

const getLastSummarizedFloor = errorCatched(async () => {
  const entries = await getWorldbookEntriesSafe();
  let max = -1;
  for (const e of entries) {
    if (!e || isEntryDisabled(e)) continue;
    // 检查普通总结条目
    const parsed = parseSummaryEntryName(e.name);
    if (parsed && parsed.end > max) {
      max = parsed.end;
    }
    // 同时检查大总结条目（大总结启用后，其对应的普通总结条目会被禁用）
    const megaParsed = parseMegaSummaryEntryName(e.name);
    if (megaParsed && megaParsed.end > max) {
      max = megaParsed.end;
    }
  }
  return max;
});

const getAllSummaryContents = errorCatched(async () => {
  const entries = await getWorldbookEntriesSafe();
  return entries
    .filter(
      (e) =>
        e && e.content && !isEntryDisabled(e) && parseSummaryEntryName(e.name),
    )
    .sort(
      (a, b) =>
        (parseSummaryEntryName(a.name)?.start ?? 0) -
        (parseSummaryEntryName(b.name)?.start ?? 0),
    )
    .map((e) => ({ name: e.name, content: e.content }));
});

const getSummaryContentsBefore = errorCatched(async (entryName) => {
  const all = await getAllSummaryContents();
  const targetStart = parseSummaryEntryName(entryName)?.start;
  if (targetStart === undefined) return all;
  return all.filter(
    (e) => (parseSummaryEntryName(e.name)?.start ?? Infinity) < targetStart,
  );
});

// ---- 大总结条目管理 ----

const upsertMegaSummaryEntry = errorCatched(
  async (entryName, content, summaryNames) => {
    await ensureWorldbookExists();
    const wbName = getActiveWorldbookName();
    const entries = await getWorldbookEntriesSafe();

    // 计算大总结条目的 order（从1开始）
    const megaEntries = entries
      .filter((e) => e && isMegaSummaryEntry(e.name))
      .sort((a, b) => {
        const aStart = parseMegaSummaryEntryName(a.name)?.start ?? 0;
        const bStart = parseMegaSummaryEntryName(b.name)?.start ?? 0;
        return aStart - bStart;
      });

    let order = 1;
    const parsed = parseMegaSummaryEntryName(entryName);
    if (parsed) {
      const existingIndex = megaEntries.findIndex((e) => e.name === entryName);
      if (existingIndex >= 0) {
        order = existingIndex + 1;
      } else {
        // 找到应该插入的位置
        let insertIndex = 0;
        for (let i = 0; i < megaEntries.length; i++) {
          const eStart =
            parseMegaSummaryEntryName(megaEntries[i].name)?.start ?? 0;
          if (eStart < parsed.start) {
            insertIndex = i + 1;
          }
        }
        order = insertIndex + 1;
      }
    }

    const existing = entries.find((e) => e && e.name === entryName);
    if (existing) {
      await updateWorldbookWith(wbName, (wb) => {
        const arr = normalizeWorldbookEntries(wb);
        const target = arr.find((e) => e && e.name === entryName);
        if (target) {
          target.content = content;
          target.enabled = true;
          target.strategy = {
            ...(target.strategy && typeof target.strategy === "object"
              ? target.strategy
              : {}),
            type: "constant",
            keys: [entryName],
            keys_secondary: { logic: "and_any", keys: [] },
            scan_depth: "same_as_global",
          };
          target.position = {
            type: "at_depth",
            role: CONFIG.ENTRY_ROLE,
            depth: CONFIG.MEGA_SUMMARY_DEPTH,
            order,
          };
          target.disable = false;
          if ("disabled" in target) target.disabled = false;
        }
        return Array.isArray(wb) ? arr : { ...wb, entries: arr };
      });
    } else {
      await createWorldbookEntries(wbName, [
        {
          name: entryName,
          content,
          enabled: true,
          strategy: {
            type: "constant",
            keys: [entryName],
            keys_secondary: { logic: "and_any", keys: [] },
            scan_depth: "same_as_global",
          },
          position: {
            type: "at_depth",
            role: CONFIG.ENTRY_ROLE,
            depth: CONFIG.MEGA_SUMMARY_DEPTH,
            order,
          },
          probability: 100,
          recursion: {
            prevent_incoming: true,
            prevent_outgoing: true,
            delay_until: null,
          },
          effect: { sticky: null, cooldown: null, delay: null },
        },
      ]);
    }

    // 保存大总结映射
    await setMegaSummaryMapping(entryName, summaryNames);

    // 重新排序所有大总结条目
    await reorderAllMegaSummaryEntries();

    const settings = getSettings();
    if (settings.autoHideSummarizedFloors !== false) {
      await applySummarizedFloorsVisibility();
    }
  },
);

const reorderAllMegaSummaryEntries = errorCatched(async () => {
  const wbName = getActiveWorldbookName();
  if (!wbName) return;
  const entries = await getWorldbookEntriesSafe();

  const megaEntries = entries
    .filter((e) => e && isMegaSummaryEntry(e.name))
    .sort((a, b) => {
      const aStart = parseMegaSummaryEntryName(a.name)?.start ?? 0;
      const bStart = parseMegaSummaryEntryName(b.name)?.start ?? 0;
      return aStart - bStart;
    });

  if (megaEntries.length === 0) return;

  await updateWorldbookWith(wbName, (wb) => {
    const arr = normalizeWorldbookEntries(wb);
    megaEntries.forEach((megaEntry, idx) => {
      const target = arr.find((e) => e && e.name === megaEntry.name);
      if (target) {
        target.strategy = {
          ...(target.strategy && typeof target.strategy === "object"
            ? target.strategy
            : {}),
          type: "constant",
          keys: [target.name],
          keys_secondary: { logic: "and_any", keys: [] },
          scan_depth: "same_as_global",
        };
        target.position = {
          type: "at_depth",
          role: CONFIG.ENTRY_ROLE,
          depth: CONFIG.MEGA_SUMMARY_DEPTH,
          order: idx + 1,
        };
      }
    });
    return Array.isArray(wb) ? arr : { ...wb, entries: arr };
  });
});

const deleteMegaSummaryEntry = errorCatched(async (entryName) => {
  const wbName = getActiveWorldbookName();
  if (!wbName) return;

  // 删除条目
  await updateWorldbookWith(wbName, (wb) => {
    const arr = normalizeWorldbookEntries(wb);
    const filtered = arr.filter((e) => e && e.name !== entryName);
    return Array.isArray(wb) ? filtered : { ...wb, entries: filtered };
  });

  // 删除映射
  await deleteMegaSummaryMapping(entryName);

  // 重新排序
  await reorderAllMegaSummaryEntries();

  await applySummarizedFloorsVisibility();
});

const restoreMegaSummaryToSummaries = errorCatched(async (megaSummaryName) => {
  const summaryNames = await getMegaSummaryMapping(megaSummaryName);
  if (!summaryNames || summaryNames.length === 0) {
    toastr.warning("未找到该大总结的原始总结条目映射");
    return;
  }

  // 删除大总结条目
  await deleteMegaSummaryEntry(megaSummaryName);

  // 恢复原始总结条目（它们应该还在世界书中，只是被禁用了）
  const wbName = getActiveWorldbookName();
  if (!wbName) return;

  await updateWorldbookWith(wbName, (wb) => {
    const arr = normalizeWorldbookEntries(wb);
    for (const summaryName of summaryNames) {
      const entry = arr.find((e) => e && e.name === summaryName);
      if (entry) {
        entry.enabled = true;
        entry.disable = false;
        if ("disabled" in entry) entry.disabled = false;
      }
    }
    return Array.isArray(wb) ? arr : { ...wb, entries: arr };
  });

  // 重新排序所有总结条目
  await reorderAllSummaryEntries();

  const settings = getSettings();
  if (settings.autoHideSummarizedFloors !== false) {
    await applySummarizedFloorsVisibility();
  }

  toastr.success(`已恢复大总结「${megaSummaryName}」的原始总结条目`);
});

const deactivateMegaSummaryEntry = errorCatched(async (megaSummaryName) => {
  const summaryNames = await getMegaSummaryMapping(megaSummaryName);
  if (!summaryNames || summaryNames.length === 0) {
    toastr.warning("未找到该大总结的原始总结条目映射");
    return;
  }

  const wbName = getActiveWorldbookName();
  if (!wbName) return;

  await updateWorldbookWith(wbName, (wb) => {
    const arr = normalizeWorldbookEntries(wb);
    // 禁用大总结条目
    const megaEntry = arr.find((e) => e && e.name === megaSummaryName);
    if (megaEntry) {
      megaEntry.enabled = false;
      megaEntry.disable = true;
    }
    // 启用对应的总结条目
    for (const summaryName of summaryNames) {
      const entry = arr.find((e) => e && e.name === summaryName);
      if (entry) {
        entry.enabled = true;
        entry.disable = false;
        if ("disabled" in entry) entry.disabled = false;
      }
    }
    return Array.isArray(wb) ? arr : { ...wb, entries: arr };
  });

  // 重新排序所有总结条目
  await reorderAllSummaryEntries();

  const settings = getSettings();
  if (settings.autoHideSummarizedFloors !== false) {
    await applySummarizedFloorsVisibility();
  }

  toastr.success(`已关闭大总结「${megaSummaryName}」，原始总结条目已恢复`);
});

const activateMegaSummaryEntry = errorCatched(async (megaSummaryName) => {
  const summaryNames = await getMegaSummaryMapping(megaSummaryName);
  if (!summaryNames || summaryNames.length === 0) {
    toastr.warning("未找到该大总结的原始总结条目映射");
    return;
  }

  const wbName = getActiveWorldbookName();
  if (!wbName) return;

  await updateWorldbookWith(wbName, (wb) => {
    const arr = normalizeWorldbookEntries(wb);
    // 启用大总结条目
    const megaEntry = arr.find((e) => e && e.name === megaSummaryName);
    if (megaEntry) {
      megaEntry.enabled = true;
      megaEntry.disable = false;
      if ("disabled" in megaEntry) megaEntry.disabled = false;
    }
    // 禁用对应的总结条目
    for (const summaryName of summaryNames) {
      const entry = arr.find((e) => e && e.name === summaryName);
      if (entry) {
        entry.enabled = false;
        entry.disable = true;
      }
    }
    return Array.isArray(wb) ? arr : { ...wb, entries: arr };
  });

  // 重新排序所有大总结条目
  await reorderAllMegaSummaryEntries();

  const settings = getSettings();
  if (settings.autoHideSummarizedFloors !== false) {
    await applySummarizedFloorsVisibility();
  }

  toastr.success(`已启用大总结「${megaSummaryName}」，对应总结条目已禁用`);
});

const getAllMegaSummaryEntriesForDisplay = errorCatched(async () => {
  const entries = await getWorldbookEntriesSafe();
  return entries
    .filter((e) => e && isMegaSummaryEntry(e.name))
    .map((e) => ({ name: e.name, disabled: isEntryDisabled(e) }))
    .sort(
      (a, b) =>
        (parseMegaSummaryEntryName(a.name)?.start ?? 0) -
        (parseMegaSummaryEntryName(b.name)?.start ?? 0),
    );
});

const getMegaSummaryContentsBefore = errorCatched(async (entryName) => {
  const entries = await getWorldbookEntriesSafe();
  const targetStart = parseMegaSummaryEntryName(entryName)?.start;
  if (targetStart === undefined) return [];

  return entries
    .filter((e) => {
      if (!e || !e.content || isEntryDisabled(e)) return false;
      const parsed = parseMegaSummaryEntryName(e.name);
      if (!parsed) return false;
      return parsed.start < targetStart;
    })
    .sort(
      (a, b) =>
        (parseMegaSummaryEntryName(a.name)?.start ?? 0) -
        (parseMegaSummaryEntryName(b.name)?.start ?? 0),
    )
    .map((e) => ({ name: e.name, content: e.content }));
});
