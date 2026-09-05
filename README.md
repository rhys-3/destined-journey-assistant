# 命定预设助手

适配 **命定之诗专用预设** 的 SillyTavern 脚本。提供预设设置、模型与连接管理、提示词编辑和聊天总结，在同一个面板中使用。

助手的版本号独立于预设版本号。适配依赖预设中的条目 ID、受管宏和扩展配置；预设名称相同并不保证经过大幅修改的结构仍然兼容。

## 功能

- 预设设置：字数、语言、叙事人称、文风、偏好和功能开关，与酒馆原生预设界面双向同步。
- 模型与连接：模型适配、Connection Profile 联动、自定义模型、变量世界书模式联动。
- 条目编辑：正文、角色、启停、位置与顺序，支持桌面拖动和触屏排序。
- 聊天总结：自动、手动和指定楼层生成，结果审查、重试，普通总结与大总结管理，世界书绑定和楼层显隐。
- 配置管理：按预设设置、总结设置分别保存、切换、恢复和导入导出。
- 界面：四套主题、透明度、桌面拖动缩放、手机布局，以及悬浮球、输入框按钮、魔术棒菜单三个入口。

## 运行环境

需要 SillyTavern、酒馆助手和命定之诗专用预设。助手调用酒馆助手的预设、脚本变量、世界书、事件和 `generateRaw` 等接口；启动检查最低版本为 4.0.0，旧脚本迁移还依赖 `getScriptTrees` 和 `updateScriptTreesWith`。是否具备全部接口，以已安装的酒馆助手版本为准。

本仓库分发助手脚本，不分发完整预设。

## 安装与更新

在预设的酒馆助手脚本列表中，将 **【命定之诗】预设设置** 的内容替换为 [loader.js](loader.js)，保留脚本 UUID 和已有变量。标准 UUID 为 `3a01f9c2-f6e8-4754-ad75-347741051662`。加载器通过固定版本地址载入助手：

```text
https://cdn.jsdelivr.net/gh/rhys-3/destined-journey-assistant@v3.0.0/dist/destined-journey-assistant.js
```

加载失败时会显示版本、原因和重试按钮。重试使用同一个版本，不会切换到开发分支。

可用版本见 [Git 标签](https://github.com/rhys-3/destined-journey-assistant/tags)。安装指定版本时使用该标签下的加载器；`main` 可能包含尚未发布的改动。更新固定版本需要替换加载器，已安装脚本不会自动跟随 `main`。

总结新装默认关闭，在“总结”页面启用并绑定当前聊天的总结世界书。由旧独立总结脚本升级时，可迁移的参数与启用状态会被保留。详见 [迁移说明](docs/MIGRATION.md)。

## 数据与总结机制

回复中的 `<summary>` 由预设生成，摘要正则控制它在不同消息深度的发送方式。助手另行把聊天内容整理成世界书总结，两者是独立机制。

默认累计 30 条未总结的原始消息楼层时触发，保留最近 10 条；正文提取 `tp`、`gametxt`，排除 `think` 与 HTML 注释。普通总结和大总结的世界书深度分别为 9998、9999；SPreset 的分区处理见 [架构说明](docs/ARCHITECTURE.md)。

API Key 独立保存，不进入命名配置、恢复点或配置导出。世界书、聊天绑定和总结记录也不属于配置文件。关闭总结不会删除记录或解除已有世界书绑定。

## 开发

使用 Node.js 22 与 pnpm 10：

```sh
pnpm install --frozen-lockfile
pnpm test
pnpm build
node tests/ui/test-ui.cjs
node tests/ui/test-assistant.cjs
node tests/ui/test-themes.cjs
node tests/ui/test-settings.cjs
```

`src/` 为 ES 模块源码，`src/preset/` 按功能拆分。esbuild 生成单个 `dist/destined-journey-assistant.js`。推送到主分支后，Actions 自动测试、打包并提交产物；版本号增加时创建对应 Git 标签，无需 GitHub Release。

准备下一个修复版本：

```sh
pnpm version:prepare patch
```

完整流程见 [版本管理](docs/VERSIONING.md)。酒馆助手类型声明由独立工作流每三天检查，依赖更新由 Dependabot 管理。

## 文档

- [使用说明](docs/USAGE.md)：面板、总结、配置管理。
- [迁移说明](docs/MIGRATION.md)：旧版本、数据迁移和回退。
- [架构说明](docs/ARCHITECTURE.md)：模块、运行链路和数据边界。
- [开发指南](CONTRIBUTING.md)：开发环境、源码维护和验证。
- [版本管理](docs/VERSIONING.md)：版本号、自动构建、标签与 CDN。
- [验证说明](docs/VERIFICATION.md)：测试范围和环境限制。
- [更新日志](CHANGELOG.md)：版本变更。

[MIT 许可](LICENSE) · [问题反馈](https://github.com/rhys-3/destined-journey-assistant/issues)
