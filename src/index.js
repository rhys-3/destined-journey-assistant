/**
 * index.js
 * 主入口：注册按钮、绑定事件、初始化
 * 依赖: 所有其他模块
 */

// 注册脚本按钮
replaceScriptButtons([{ name: CONFIG.MAIN_BUTTON_NAME, visible: true }]);

// 点击按钮打开设置面板
eventOn(getButtonEvent(CONFIG.MAIN_BUTTON_NAME), showSettingsPopup);

// 收到新消息时自动检查是否需要触发总结
eventOn(tavern_events.MESSAGE_RECEIVED, async () => {
  try {
    await loadSettings();
    await autoTriggerSummary();
  } catch (e) {
    console.error("自动触发总结检查失败:", e);
  }
});

// 聊天切换时处理世界书绑定
eventOn(tavern_events.CHAT_CHANGED, async () => {
  try {
    await onChatChanged();
  } catch (e) {
    console.error("聊天切换处理失败:", e);
  }
});

// 初始化：加载设置 & 迁移旧版世界书
loadSettings()
  .then(async () => {
    await migrateOldWorldbookName();
    toastr.success("命定之诗总结助手 (V2.8.2) 已加载。");
  })
  .catch((e) => {
    console.warn("初始化加载设置失败:", e);
    toastr.success("命定之诗总结助手 (V2.8.2) 已加载（使用默认设置）。");
  });
