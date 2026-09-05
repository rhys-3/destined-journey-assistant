# 命定预设助手

- `src/` 是唯一运行时源码；`dist/destined-journey-assistant.js` 由 `pnpm build` 生成，不手改。
- 保留设置脚本 UUID、聊天变量键和世界书条目格式。设置与总结的脚本变量写入统一经过 `src/platform/store.js`。
- 不向配置快照、导出文件、测试夹具或发布包写入个人 API Key、聊天记录、总结记录。
- 完整预设 JSON 只留在独立的本地预设工作区，禁止提交本仓库或上传 Release。发布附件只允许助手脚本和验证报告。
- 主分支的 dist 由 Actions 在全部回归通过后自动提交；日常提交源码，不手工提交生成产物。旧总结 dist 和已发布标签保持冻结。
- `@types/` 由独立的定时工作流同步，不能在整理构建流程时移除该能力。
- `loader.js` 必须固定版本；更新版本时同步 package、发布说明与加载器。不得覆盖已发布标签。
- 验证：`pnpm test`、`pnpm build`，以及顺序运行 `tests/ui/test-ui.cjs`、`test-assistant.cjs`、`test-themes.cjs`、`test-settings.cjs`。
- 浏览器测试需要 Chrome，可通过 `CHROME_PATH` 指定。测试使用隔离浏览器与模拟酒馆 API，不能声称是真实酒馆或模型接口实测。
- 测试产物在 `.ui-review/`，不纳入 Git。测试夹具只保存可公开的预设和 SPreset 配置。
- 同步关联预设工作区时遵守其 AGENTS.md：只改 `split/`，不覆盖 `source/`；完成后必须校验并构建可导入 JSON。
