# 开发与发布

Node 22、pnpm 10。src/ 是唯一 ES 模块运行时源码；新版 dist 由 pnpm build 生成。旧 dist/destined-journey-summarizer.js 是冻结兼容资产，不删除、不覆盖。

## 验证

安装冻结依赖后运行 pnpm test、pnpm build，顺序运行 tests/ui/test-ui.cjs、test-assistant.cjs、test-themes.cjs、test-settings.cjs。浏览器需要 Chrome，可设置 CHROME_PATH。产物位于 .ui-review/。模拟测试不得写成真实酒馆实测。

## 发布

1. 修改源码并执行本地验证；准备发布时更新 package 版本、loader 固定版本、发布说明与版本断言。提交源码即可，不必提交本地 dist。
2. 推送主分支，等待 Verify and release 完成测试与浏览器回归，自动提交通过验证的 dist。之后拉取机器人提交。若 main 在验证期间改变，工作流拒绝提交过时产物，请基于最新 main 重新运行。
3. 手动运行工作流并选择 release。发布依赖验证成功，标签已存在时失败，禁止覆盖。
4. 校验新版固定 CDN 内容与 dist 相同，运行 scripts/check-legacy-links.mjs 检查旧地址。
5. 再同步预设 split 的 loader 与元数据，移除独立总结运行入口；保留 source，执行工作区 scripts/workspace.ps1 build。
6. 完整 JSON 仅留在本地预设工作区，禁止提交本仓库或附加到 Release；记录真实环境未完成项。

scripts/github-release.mjs 使用现有 Git 凭据维护本次改名和 GitHub 状态，不打印令牌；日常发布不需要 rename。

## 类型声明

`Update Tavern Helper types` 每三天及手动触发，从原上游 `https://gitlab.com/novi028/JS-Slash-Runner/-/raw/main/dist/@types.zip` 同步。该地址当前返回 TAR，更新器也支持 ZIP；先在内存中校验路径、文件类型和必需声明，再更新 `@types/function` 与 `@types/iframe`。下载或校验失败不会清空本地声明。仅有换行差异不会产生机器人提交。

本地可用 Python 3 运行 `python scripts/update-types.py`。`@types` 是编辑器声明，不是酒馆助手运行时，不进入浏览器构建，也不等同于类型检查已通过。当前 JavaScript 回归由 Node 与浏览器测试负责；声明更新工作流不自动升级依赖或发布版本。

## 测试数据

`tests/fixtures/preset.json` 只包含回归所需的提示词、顺序和流式设置，不含扩展脚本及完整预设包装；`spreset.json` 是分区后处理测试夹具。完整可导入预设不属于此仓库。

设置与总结统一通过 platform/store.js 写脚本变量。新增字段先明确配置范围，分享使用白名单；Key、世界书、绑定、聊天、总结记录不进入配置、恢复点或发布包。改变旧键或条目格式必须提供迁移。
