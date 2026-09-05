# 版本管理

## 版本号与分发

助手使用独立的 `major.minor.patch` 版本号，与命定之诗专用预设的版本号无关。

| 变更 | 更新方式 | 示例 |
| --- | --- | --- |
| 修复、兼容性修正 | patch | 3.0.0 → 3.0.1 |
| 向后兼容的新功能 | minor | 3.0.1 → 3.1.0 |
| 不兼容的接口或数据变化 | major | 3.1.0 → 4.0.0 |

每个已发布版本对应一个不可覆盖的 Git 标签，例如 `v3.0.1`。jsDelivr 从标签中的文件提供固定版本外链，不需要创建 GitHub Release。旧 Release 可以作为历史记录保留，不参与新的版本流程。参见 [jsDelivr 的 GitHub 分发说明](https://www.jsdelivr.com/?docs=gh)。

## 准备版本

1. 拉取最新 main 和标签，完成源码改动与验证。
2. 将用户可感知的变化写入 `CHANGELOG.md` 的“未发布”章节。
3. 选择版本增量，运行下列命令之一：

```sh
pnpm version:prepare patch
pnpm version:prepare minor
pnpm version:prepare major
pnpm version:prepare 3.2.1
```

追加 `--dry-run` 可以预览，不写入文件。准备工具同步修改 `package.json`、`loader.js`、README 的安装地址和更新日志章节，不创建提交或标签。版本不能倒退，也不能复用已有本地标签；工作流还会保护远端已存在的标签。

4. 检查差异，将源码、版本文件和更新日志一起提交并推送 main。无需提交本地 dist。
5. 等待 `Build and version` 工作流完成，再拉取机器人提交与标签。

## 自动工作流

`Build and version` 在推送 main、PR 和手动运行时执行验证：冻结安装依赖、Node 测试、构建、四组浏览器回归。

主分支验证成功后，将同一次验证产生的单文件产物提交到 `dist/`。若 main 在验证期间已经变化，工作流拒绝写入过时产物，需基于最新 main 重新运行。PR 只验证，不提交产物或创建标签。

随后根据 `package.json` 版本号处理标签：

- 标签不存在：检查加载器、更新日志和构建版本，给包含产物的提交创建标签并推送。
- 标签已存在：保留原标签。本次 main 改动不会改变已发布版本，需要增加版本号才会发布新版本。

最后检查该标签的 CDN 内容与 Git 中的产物一致。此过程不创建 GitHub Release、不上传完整预设，也不会自动增加版本号。

## CDN 与安装

固定地址格式为：

```text
https://cdn.jsdelivr.net/gh/rhys-3/destined-journey-assistant@v<版本号>/dist/destined-journey-assistant.js
```

版本标签创建后可单独校验：

```sh
pnpm check:cdn
pnpm check:cdn 3.0.0
```

校验使用标签中的产物，不把 main 的未发布代码当成旧版本。若 CDN 暂时无法加载，可稍后重新运行；不要移动或重建标签。确认 CDN 可用后，再把该版本的加载器用于预设。

固定版本用户不会因 main 更新而自动升级。回退时使用已存在的旧版本，并同时考虑配置数据兼容性，见 [迁移说明](MIGRATION.md)。
