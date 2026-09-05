# 命定预设助手

命定之诗预设的统一设置入口。v3.0.0 合并原「预设设置」和独立总结脚本，总结在原设置面板内运行，共用四套主题、透明度、桌面拖动缩放与手机布局。

## 安装与升级

把 [loader.js](loader.js) 全文替换到已有的 **【命定之诗】预设设置** 脚本中。完整预设包在独立的本地预设工作区维护，不提交到本仓库，也不上传到 Release。保留 UUID `3a01f9c2-f6e8-4754-ad75-347741051662` 和脚本数据。加载器固定使用：

```text
https://cdn.jsdelivr.net/gh/rhys-3/destined-journey-assistant@v3.0.0/dist/destined-journey-assistant.js
```

加载失败会显示版本和原因，提供“重新加载命定预设助手”按钮，重试仍用同一版本。无需把整个构建文件粘进预设。

**旧用户可以继续使用旧版。** 仓库沿原 Git 历史改名，保留 v2.7.0、v2.8.2、v2.8.3 标签和产物。主分支继续提供原 `dist/destined-journey-summarizer.js`，冻结为 v2.8.3，保护旧文件的 main、latest 和无版本外链。不要复用旧仓库名创建新仓库，以免破坏重定向。详见 [迁移说明](docs/MIGRATION.md)。

## 功能与运行依据

- 保留预设双向同步、模型与连接、变量世界书联动、条目编辑排序、自建文风、显示设置和三个入口。
- 总结页包含记录、参数、提示词：自动／手动／指定楼层总结、审查、重试、手工保存；普通与大总结的编辑、重生成、删除、启停、合并及还原；世界书新建、绑定、迁移、解绑。
- 命名配置按“预设配置／总结配置”保存、切换、恢复、导入导出。API Key 单独存放，不进入配置快照或导出。
- 新装默认关闭总结；迁移时沿用可访问旧脚本的启用状态。关闭不删记录、不解绑世界书，也不启动新总结。

需要 SillyTavern、酒馆助手和命定之诗预设。脚本使用助手的预设、脚本树、变量、世界书、generateRaw API；原设置最低版本检查为 4.0.0，迁移还需要 getScriptTrees / updateScriptTreesWith，实际以已安装助手的 API 为准。

回复中的 `<summary>` 由预设生成，SPreset 正则控制近层不发摘要、远层保留摘要，与助手保存的世界书总结是两套机制。助手按原始楼层计数，默认达到 30 条未总结消息触发、保留最近 10 条；默认提取 tp、gametxt，排除 think 和 HTML 注释。没有匹配标签的消息不会进入总结正文。

普通总结和大总结分别位于深度 9998、9999；当前 SPreset 将深度 900 以上的注入内容归入 VOID_memory。两种 API 模式均经 generateRaw 请求，默认防合并标记是 `<|no-trans|>`。文档以实际代码和当前配置为依据。

## 开发与发布

Node 22、pnpm 10：

```sh
pnpm install --frozen-lockfile
pnpm test
pnpm build
node tests/ui/test-ui.cjs
node tests/ui/test-assistant.cjs
node tests/ui/test-themes.cjs
node tests/ui/test-settings.cjs
```

浏览器测试需要 Chrome，可设置 CHROME_PATH。源码为 ES 模块，由 esbuild 构建单文件。旧总结 dist 是冻结资产，不从新源码重新构建。

推送源码到 main 后，Actions 自动测试、构建并执行浏览器回归，通过后将生成的 `dist/destined-journey-assistant.js` 提交回 main。无需手工提交构建产物。PR 只验证，不写入仓库。手动运行工作流并勾选 release 才会在包含构建产物的提交上发布 package 版本；已有标签拒绝覆盖。新版 CDN 验证后才同步本地正式预设包。

`src/preset/` 按预设存储、模型、受管字段、世界书联动、编辑排序、配置库、界面和生命周期拆分；`assistant.js` 负责组装。预设分区中仍只保留短加载器。

`Update Tavern Helper types` 工作流每三天检查原酒馆助手上游的声明文件，也可手动运行；仅在内容变化时提交 `@types/`。它不更新运行时脚本或发布版本。依赖包由 Dependabot 单独维护。

- [使用说明](docs/USAGE.md)
- [架构与数据边界](docs/ARCHITECTURE.md)
- [迁移与旧版兼容](docs/MIGRATION.md)
- [验证记录](docs/VERIFICATION.md)
- [开发与发布](CONTRIBUTING.md)
- [更新日志](CHANGELOG.md)

[MIT 许可](LICENSE) · [问题反馈](https://github.com/rhys-3/destined-journey-assistant/issues)
