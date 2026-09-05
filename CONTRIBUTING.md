# 开发指南

## 环境与命令

运行时源码使用 JavaScript ES 模块。开发环境为 Node.js 22、pnpm 10；类型声明同步工具另需 Python 3。

```sh
pnpm install --frozen-lockfile
pnpm test
pnpm build
node tests/ui/test-ui.cjs
node tests/ui/test-assistant.cjs
node tests/ui/test-themes.cjs
node tests/ui/test-settings.cjs
```

上面的命令是单项检查入口，无需每次全部执行。日常使用 `pnpm verify -- --plan` 查看范围、`pnpm verify` 执行，已提交改动加 `--base <提交>`，完整验证加 `--full`。规则见 [验证说明](docs/VERIFICATION.md)。浏览器回归需要 Chrome，可用 `CHROME_PATH` 指定路径。四组测试顺序执行，结果和截图写入 `.ui-review/`。

## 源码组织

`src/index.js` 管理助手单实例。`src/preset/assistant.js` 组装预设功能模块并持有实例状态；`src/summary/service.js` 负责总结服务。模块职责见 [架构说明](docs/ARCHITECTURE.md)。

界面样式位于 `src/ui/` 与 `src/summary/ui/`。总结页面嵌入设置面板，使用相同主题变量和弹窗组件。配置持久化统一经过 `src/platform/store.js`，避免设置保存覆盖总结的新值。

新增字段时应明确存储位置、分享范围和兼容策略。命名配置及导出使用白名单；密钥、世界书、聊天绑定和总结记录不进入配置快照。改变 UUID、变量键或世界书条目格式时，需要提供迁移。

## 构建与版本

`pnpm build` 用于本地验证。提交源码后，Actions 在回归通过时自动提交新版 dist；无需手工提交生成文件。旧 `dist/destined-journey-summarizer.js` 是冻结的兼容产物，不能用新版构建覆盖。

版本按语义化版本号维护，通过 Git 标签分发。准备版本、工作流行为和 CDN 校验见 [版本管理](docs/VERSIONING.md)。

## 类型声明与依赖

`Update Tavern Helper types` 每三天或手动运行，从酒馆助手上游同步 `@types/function/` 与 `@types/iframe/`。本地命令：

```sh
python -m unittest discover -s tests -p test_update_types.py
python scripts/update-types.py
```

更新器支持上游的 TAR 和 ZIP 格式，先校验全部文件，再写入声明。下载或校验失败不清空本地声明；没有实质变化时不产生提交。声明供编辑器使用，不会更新酒馆助手运行时，也不进入浏览器 bundle。

Dependabot 单独检查 pnpm 依赖和 GitHub Actions 版本。依赖修改应保留单一 `pnpm-lock.yaml`，通过验证后合并。

## 测试夹具与预设集成

`tests/fixtures/preset.json` 包含回归所需的提示词、顺序和流式设置，没有完整预设包装及扩展脚本；`spreset.json` 提供分区处理测试配置。夹具不存储个人密钥或聊天记录。

完整预设在独立工作区维护，不提交本仓库或作为附件上传。集成助手时，预设的脚本内容仅保存固定版本加载器，保留脚本身份和变量。完整预设的校验与打包由对应工作区执行。

## 许可

提交贡献前确认有权按本项目适用的非商业许可提供相关内容；引入第三方内容时保留原有署名和许可。范围与历史版本例外见 [使用许可](docs/LICENSING.md)。
