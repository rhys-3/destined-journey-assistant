# 开发与发布

Node 22、pnpm 10。src/ 是唯一 ES 模块运行时源码；新版 dist 由 pnpm build 生成。旧 dist/destined-journey-summarizer.js 是冻结兼容资产，不删除、不覆盖。

## 验证

安装冻结依赖后运行 pnpm test、pnpm build，顺序运行 tests/ui/test-ui.cjs、test-assistant.cjs、test-themes.cjs、test-settings.cjs。浏览器需要 Chrome，可设置 CHROME_PATH。产物位于 .ui-review/。模拟测试不得写成真实酒馆实测。

## 发布

1. 更新 package 版本、loader 固定版本、发布说明与版本断言，构建并提交 dist。
2. 推送主分支，等待 Verify and release 通过。
3. 手动运行工作流并选择 release。发布依赖验证成功，标签已存在时失败，禁止覆盖。
4. 校验新版固定 CDN 内容与 dist 相同，运行 scripts/check-legacy-links.mjs 检查旧地址。
5. 再同步预设 split 的 loader 与元数据，移除独立总结运行入口；保留 source，执行工作区 scripts/workspace.ps1 build。
6. 校验 JSON 后可附加到 Release；记录真实环境未完成项。

scripts/github-release.mjs 使用现有 Git 凭据维护本次改名和 GitHub 状态，不打印令牌；日常发布不需要 rename。

设置与总结统一通过 platform/store.js 写脚本变量。新增字段先明确配置范围，分享使用白名单；Key、世界书、绑定、聊天、总结记录不进入配置、恢复点或发布包。改变旧键或条目格式必须提供迁移。
