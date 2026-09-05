# 架构与运行依据

## 模块

| 路径 | 职责 |
| --- | --- |
| src/index.js | 单实例启动、卸载及启动错误传播 |
| src/preset/assistant.js | 实例状态、模块组装、启动与宿主事件接线 |
| src/preset/definitions.js | 预设条目 UUID、受管字段和界面默认值 |
| src/preset/store.js | 预设读写队列、同步、失败回滚 |
| src/preset/models.js、connections.js、managed.js | 模型选择、连接、受管宏和字段 |
| src/preset/worldbook.js | 变量世界书与预设模式联动 |
| src/preset/styles-editor.js、prompt-editor.js、placement.js | 文风、条目编辑、排序与分区位置 |
| src/preset/configuration-schema.js、configurations.js、custom-models.js | 配置白名单、导入导出、恢复与自定义模型 |
| src/preset/render.js、appearance.js、events.js | 页面渲染、主题与布局、交互与清理 |
| src/summary/service.js | 一次迁移、事件、嵌入页面、聊天切换 |
| src/summary/summary.js | 触发、范围、生成、审查、重试与保存 |
| src/summary/api.js、prompt.js、messages.js | generateRaw、提示词与标签正文 |
| src/summary/worldbook.js | 绑定、普通／大总结、映射与楼层显隐 |
| src/summary/storage.js、settingsSchema.js | 总结参数缓存与白名单校验 |
| src/platform/store.js | 共享变量读写协调 |
| src/platform/lifecycle.js、ambient.js | 互斥、上下文令牌、取消与宿主 API |
| src/ui/、src/summary/ui/ | 设置主题、统一弹窗与总结子页面 |
| src/summary/presetDefaults.js | 当前预设两套默认提示词 |
| loader.js | 固定版本加载与重试 |

只有一份 ES 模块运行时源码与一个新版 bundle；旧总结 dist 是冻结兼容资产。

设置模块以工厂函数创建，每次启动拥有独立的状态与函数。模块间通过显式的实时访问器共享当前状态，避免异步保存、拖动、聊天切换和清理期间持有旧值；没有字符串拼接或运行时 eval。esbuild 将模块依赖打包为单文件。预设 split 中只维护固定版本加载器，完整预设 JSON 只在独立的本地工作区生成。

主分支工作流在所有测试通过后提交下载自同一次验证任务的构建产物，发布任务使用该提交打标签。PR 不回写仓库，已发布标签不覆盖；并发主分支更新会阻止过时产物写入。独立的类型声明工作流每三天检查上游，只提交 `@types/` 的内容变化。

## 摘要与请求

预设生成回复中的 summary，SPreset 正则 07 在 maxDepth=10 范围去掉摘要，08 在 minDepth=11 范围保留时间地点与摘要。它们改变发送消息的处理结果，不是助手世界书记录。

助手通过 getChatMessages 读原始楼层，包含隐藏消息；范围计数与标签提取独立。默认提取 tp／gametxt，排除 think／HTML 注释。无匹配标签的用户消息仍计入楼层，但不进入总结正文。

世界书普通／大总结分别深度 9998／9999。当前 SPreset 使用 Cut_900、Cut_2 锚点，将高深度缓冲内容归入 VOID_memory、中间内容归入 VOID_reference、低深度内容归入 VOID_runtime。测试直接执行实际配置的后处理函数；不是对任意 SPreset 的保证。

主连接与自定义 API 都经 generateRaw，按板块构建 ordered_prompts，支持仅供扫描的 injects，防合并标记与当前 ChatSquash 配置一致。没有绕过助手的备用生成端点。

## 生命周期与存储

写操作与生成检查聊天、预设和生命周期代次。切换上下文、停用或卸载使令牌失效；独立 generation_id 用于 stopGenerationById。互斥阻止连续消息和重复点击重复提交。取消／超时结束等待，迟到结果不继续审查保存。

宿主没有跨世界书、聊天变量和消息的数据库事务。写入前后及回调再次检查上下文；已被宿主接受的单次写入无法由浏览器原子撤销。真实宿主异步时序仍需实测。

| 范围 | 内容 |
| --- | --- |
| 设置脚本变量 | 原设置偏好、模型、configuration_library |
| 设置脚本变量 | summary_assistant_settings：白名单参数 |
| 设置脚本变量 | summary_assistant_secrets：按地址保存 Key |
| 设置脚本变量 | summary_assistant_migration：一次迁移标记 |
| 聊天变量 | summary_assistant_worldbook：绑定 |
| 聊天变量 | summary_assistant_mega_summary_map：大总结来源 |
| 聊天变量 | summary_assistant_auto_hidden_floors：自动隐藏楼层 |
| 世界书 | 普通／大总结正文 |

设置整表写入先读取并保留最新总结字段；总结写入合并最新脚本变量。写入与读回验证失败均传播，不能显示成功或发布成功缓存。

绑定记在聊天变量中，生效仍沿用全局世界书列表，切换时解绑前一本并加入当前书；关闭总结本身不解绑。

命名快照 v2 含可选 preset／summary，内部配置库版本仍为 1，分享文件外层版本为 2。v1 快照规范化为 preset 部分。所有分享路径采用白名单；Key、世界书、绑定、聊天、总结和隐藏记录不进入命名配置或恢复点。
