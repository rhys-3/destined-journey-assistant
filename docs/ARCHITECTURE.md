# 架构与运行依据

## 模块

| 路径 | 职责 |
| --- | --- |
| src/index.js | 单实例启动、卸载及启动错误传播 |
| src/preset/assistant.js | 实例状态、模块组装、启动与宿主事件接线 |
| src/preset/definitions.js | 预设条目 UUID、受管字段和界面默认值 |
| src/preset/store.js | 预设读写队列、同步、失败回滚 |
| src/preset/models.js、connections.js、managed.js | 模型选择、连接、受管宏和字段 |
| src/preset/tool-output.js | Gemini 工具输出的请求补充与回复还原 |
| src/preset/setting-items.js、setting-lists.js | 自定义设定列表、兼容迁移、文本展开与内联编辑 |
| src/preset/worldbook.js | 变量世界书与预设模式联动 |
| src/preset/styles-editor.js、prompt-editor.js、placement.js | 文风、条目编辑、排序与分区位置 |
| src/preset/descriptions.js | 条目及专用卡片简介、旧说明回退与编辑字段 |
| src/preset/configuration-schema.js、configurations.js、custom-models.js | 配置白名单、导入导出、恢复与自定义模型 |
| src/preset/render.js、appearance.js、events.js | 页面渲染、主题与布局、交互与清理 |
| src/summary/service.js | 一次迁移、事件、嵌入页面、聊天切换 |
| src/summary/summary.js、batchPlan.js | 触发、整轮范围、按完整回复拆分批次与恢复入口 |
| src/summary/taskRunner.js | 串行／并发生成、顺序提交、逐批重试与暂停 |
| src/summary/api.js、prompt.js、messages.js | generateRaw、提示词与标签正文 |
| src/summary/worldbook.js | 绑定、普通／大总结、映射与楼层显隐 |
| src/summary/storage.js、settingsSchema.js | 总结参数缓存与白名单校验 |
| src/summary/taskState.js、provenance.js、result.js | 持久任务状态、来源指纹、结果协议 |
| src/summary/macros.js、archiveDefaults.js | 宏展开、场景快照、档案模板 |
| src/summary/ui/taskView.js、promptTools.js | 顶部提示、按钮权限、宏与请求预览 |
| src/summary/ui/floorBrowser.js、visibilityView.js | 楼层概览、延迟展开、分页与筛选 |
| src/summary/ui/batchSettings.js、tagEditor.js | 推荐批次方案、并发设置与逐项标签编辑 |
| src/platform/store.js | 共享变量读写协调 |
| src/platform/lifecycle.js、ambient.js | 互斥、上下文令牌、取消与宿主 API |
| src/platform/storage-keys.js | 按版本命名空间生成持久化键名 |
| src/flavor.js | 构建期版本标识、界面名称与存储命名空间 |
| src/ui/、src/summary/ui/ | 设置主题、统一弹窗与总结子页面 |
| src/summary/presetDefaults.js | 旧版默认提示词，仅用于迁移识别 |
| loader.js | 固定版本加载与重试 |

只有一份 ES 模块运行时源码，构建按版本生成命定版（`dist/destined-journey-assistant.js`）与通用角色扮演版（`dist/destined-journey-assistant-general.js`）两个自包含 bundle：无模块导入、无 CDN 引用，可直接作为酒馆助手脚本内容；旧总结 dist 是冻结兼容资产。两个 bundle 的代码路径、界面与功能一致，区别只在 `src/flavor.js` 的标识和命名空间：脚本按钮与面板标题、全局单例键、界面元素前缀、总结脚本变量与聊天变量前缀、总结世界书名称前缀、讨论模式聊天变量。命定版沿用已发布标识，通用版使用 `general_summary_`、`general_discussion_mode` 与 `通用总结世界书_<后缀>`，因此两个助手可以同时安装而不会互相读取或覆盖设置、绑定、档案与显隐记录。构建期只注入所选版本，产物不包含另一方的标识。

预设归属由 `src/preset/definitions.js` 的 `presetBelongsToFlavor` 判定：`FLAVOR.ownPresetPromptIds` 为空时不做限制（命定版保持原行为），否则当前预设必须带有全部标记条目。通用版以三个变量模式条目为标记，因此切换到命定预设后不会写入、迁移或联动它，界面顶部显示“当前预设不是通用预设”，受管字段与条目开关的写入被拒绝。变量处理模式同样按版本展开：命定版是“主 API / 额外 API”，通用版是“主接口变量 / 额外接口变量 / 无变量”；无变量只切换预设条目，不读写世界书，也不会被世界书状态自动翻转。

命定 1.9 的消息处理器由两个预设共用，因此 `destined_discussion`、`<discussion_record>`、`__destinedDiscussionV1`、`__destinedPrimeMessageProcessor` 与 `本轮场外讨论` 保持共享；这些名字描述的是预设与消息协议，不是助手私有数据。助手私有的讨论模式聊天变量按版本命名，`destined_discussion_mode` 仅属命定版。

两个版本共用预设结构约定：受管短宏与未知宏名称、Prime 正文起止边界、讨论桥接名（`__destinedPrimeMessageProcessor`、`__destinedDiscussionV1`）、预设扩展键 `destined_discussion` 与配置文件格式 `destined-configurations`。这些名字属于预设数据格式，不随助手版本变化；配套预设需自行提供对应条目、讨论配置与桥接脚本。通用版不迁移旧独立总结脚本，也不停用命定版脚本。

NSFW 条目通过 `nsfw-mode` 单选组与 `nsfw-extra` 开关板块识别。`destined_ui` v3 的 `block` 只确定展示位置，`group` 才决定单选关系，四个模式必须显式填写 `group: "nsfw-mode"`，独立附加项使用空组。兼容早期误填数据时，仅对仍位于该板块、单选组缺失或为空的四个内置模式 UUID 回退到该单选组；保留明确的自定义分组、移动后的条目与自建独立开关。1.3.1 及更早的预设使用 `adult-mode`／`adult-extra`，读取时归一化到当前标识并迁移作者布局。回退不自动替用户决定已有多选状态，重新选择一个模式后互斥保存。显示层仅在两块位于同页且相邻时合并折叠，不改变原生发送顺序。旧作者布局补充附加板块时保留自定义页面与标题；起止标签 UUID 纳入必需条目保护。回归夹具仅含九个条目的显示元数据及中性测试文字，不包含正式提示词正文。

设置模块以工厂函数创建，每次启动拥有独立的状态与函数。模块间通过显式的实时访问器共享当前状态，避免异步保存、拖动、聊天切换和清理期间持有旧值；没有字符串拼接或运行时 eval。esbuild 将模块依赖打包为单文件。预设 split 中只维护固定版本加载器，完整预设 JSON 只在独立的本地工作区生成。

主分支工作流在所有测试通过后提交下载自同一次验证任务的构建产物，发布任务使用该提交打标签。PR 不回写仓库，已发布标签不覆盖；并发主分支更新会阻止过时产物写入。独立的类型声明工作流每三天检查上游，只提交 `@types/` 的内容变化。

## 摘要与请求

预设生成回复中的 summary，预设原生正则 07 在 maxDepth=10 范围去掉摘要，08 在 minDepth=11 范围保留时间地点与摘要。它们改变发送消息的处理结果，不是助手世界书记录。

助手通过 getChatMessages 读原始楼层，包含隐藏消息；范围计数与标签提取独立。默认提取 tp／gametxt 并去除 HTML 注释，排除标签默认为空。排除仅作用于提取后的 AI 正文，支持属性与同名嵌套；用户输入不受包含／排除标签限制。每段材料附原始楼层编号、发言角色与意图／事实说明。覆盖集合由实际来源楼层构成，不能用最大结束楼层代替。

自动触发一次确定整轮范围，batchPlan 将连续可用楼层组成以 AI 回复结束的单元，根据每批目标及约 20% 浮动确定最少可行批数，再按实际提取正文长度均衡切分。不可分割的长单元允许单独超出目标，未完成的尾部用户发言留到下轮。computeSummaryPreview 与执行共用规划，预览不写状态；新任务保存 floorCount 和最近保留区快照。指定范围及已有记录重生成均使用单个原范围，不经自动分批。batchPreset 仅由用户选择推荐或编辑数字决定，不检测摘要状态；parallelBatches 默认 false，batchConcurrency 默认 2。behaviorVersion 标记默认值迁移，仅将旧默认 think 与大总结 8/6 更新为空和 15/10，保留自定义值。

taskRunner 为一轮建立一个互斥任务，设置快照在整轮固定。串行逐批准备，能读取之前批次的新记忆；并发按数量分组准备与生成，同组结果不互相进入请求。每组生成结束后按楼层顺序提交世界书，写入不并发。各批保留来源、正文、阶段和错误；任务根字段映射当前选中批次，兼容单批恢复。继续跳过已完成／已跳过批次，明确编辑或重生成只操作选中批次。持久恢复信息不保存设置快照、编译请求或密钥。

楼层统计保留一次全聊天快照，刷新时线性扫描以核对来源与覆盖。明细折叠时不创建表格行；展开后在快照上按类型、显隐筛选，每页最多 30 楼。翻页使用缓存，原文查看只调用所选范围的 getChatMessages，不随总楼数扩大。

世界书普通／大总结分别深度 9998／9999。配套预设的「消息处理」脚本将历史中的 system 注入按 901 以上、3～900、0～2 分别放入 VOID_memory、VOID_reference、VOID_runtime；头尾保持独立，正文合成 user。脚本与结构边界在私有预设工作区维护，完整预设不进入本仓库。旧 SP 配置夹具仅保留作历史格式兼容测试。

主连接与自定义 API 都经 generateRaw。准备阶段以目标材料 dry-run 扫描世界书，显式展开角色、用户和场景宏；先移除自身总结，不读取深度条目。请求由普通或大总结中启用的条目直接展开；max_chat_history=0 与空历史覆盖阻止夹带实时 RP 历史。配置只传给当前请求，不替换主连接。自动重试复用展开后的材料和请求参数。

api 直接将编译好的自然 role、顺序和内容交给 generateRaw，不注入防合并标记，不注册发送事件或序列化补丁。配套预设只处理含其完整正文边界的请求，总结因此自然跳过。酒馆连接的后处理、停止词与接口角色转换保持原设置；助手不再承担旧全局 SP 合并器的隔离。独立 generation_id、取消、超时和上下文核对仍由 lifecycle 负责。

## Gemini 工具输出

Gemini 尾部按 `GEMINI_TAIL_MODES` 顺序对应预填充、非预填充、工具一次调用、工具两次调用四个条目，四者互斥。两个工具条目以 `<|命定_工具输出|>` 开头；两次调用条目另含 `<|命定_续写开始|>`…`<|命定_续写结束|>` 包裹的续写提示。受管宏展开时保留这些标记，不作为未知命定宏移除。

助手启动时包装酒馆页面的 fetch，卸载时恢复；已被其他脚本再次包装时只停用自身。只有发往 `/api/backends/chat-completions/generate` 且消息含该标记的请求会被处理：移除标记，取出并移除续写提示，追加唯一的 `submit_recorder_output` 函数工具（参数 `content`）并设置 `tool_choice: auto`。调用方已指定 `none`、`required` 或具体工具时只移除标记与续写提示，不追加工具。其他请求、总结和 generateRaw 不受影响。

响应在酒馆读取前改写：OpenAI 兼容格式的 `tool_calls` 参数按片段增量解码为 `delta.content`／`message.content`，`finish_reason: tool_calls` 改为 `stop`；Google 格式的 `functionCall` 按 `partialArgs` 或完整 `args` 改为文本 part，思考 part 原样保留。一轮回复可含多次调用，按到达顺序拼接：OpenAI 兼容格式按调用 index 区分，缺少 index 时以带名称的片段在上一调用结束后开始新调用；Google 格式的 `partialArgs` 在 `willContinue` 为真时继续同一调用。拼接处缺少换行时补一个换行。统计记录调用次数，以及从请求发出起算的各段到达时间。其他函数调用、非 JSON 数据行与错误响应不改动。酒馆因此按普通回复渲染、流式、swipe 与继续生成，不经过自身的函数调用流程，聊天记录中也没有工具消息。模型未调用工具时正文原样通过并提示。工具输出请求返回 524，或错误正文中含 524 时，另行提示等待完整参数导致的超时；错误响应本身仍原样交给酒馆。

回复按可见文本判断是否完整，工具交付与普通文本一并计入：文档在正文（`<recorder_body>` 或 `<gametxt>`）出现后以 `</recorder_output>` 闭合才算完成。正文出现前的闭合标签（包括跨片段的半个标签）先暂缓转交，后续还有内容时丢弃，回复就此结束时再补发。没有续写提示时只发一次请求，未完成则以 single 结束并提示。有续写提示时，本轮有新内容且文档未完成就追加一轮请求，在原请求消息后附上已交付文本（assistant）和续写指令（user），工具定义不变，最多三轮：正文出现前使用条目的续写提示，正文已开始则使用内置的接续指令（同样要求跳过原生推理、从停下处接着写）。续写用普通文本而不是函数调用历史，避免依赖服务商的调用签名。流式时各轮还原后的数据行依次转交给酒馆，只在最后发送一次 `[DONE]`；非流式时把后续轮次的文本并入首个响应。统计记录停止原因（complete、single、empty、limit、error、cancelled）；未写完就停止时提示。后续轮次失败时结束响应并提示，已转交的内容保留；酒馆停止生成时中止当前轮次且不再续请求。

多个助手实例各自包装时，外层先移除标记并追加工具，内层不再处理，回复只还原一次。旧预设和旧命名配置缺少工具条目时视为该选项不可用，模型切换回退到非预填充；应用旧配置时保留当前预设中的这些条目并关闭。

## 生命周期与存储

写操作与生成检查聊天、预设和生命周期代次。切换上下文或卸载使令牌失效；暂停自动处理允许已启动的一组完成，后续批次标为未执行。每个并发请求使用独立 generation_id；停止或上下文失效时取消本轮所有活动 ID。互斥阻止连续消息和重复点击重复提交。取消／超时结束等待，迟到结果不能写入。任务状态经同一发布接口驱动顶部提示、入口标记和面板；浏览、草稿编辑不占生成互斥。

聊天状态通过 writeVariableKeys 同步读取最新变量表、替换指定键的完整值，再读回校验；其他键原样保留。手动显隐覆盖、来源档案和大总结映射会删除旧成员，不能使用酒馆助手的递归合并接口保存，否则被移除的成员仍会保留。原生变量接口行为见[酒馆助手实现](https://github.com/N0VI028/JS-Slash-Runner/blob/main/src/function/variables.ts)。

宿主没有跨世界书、聊天变量和消息的数据库事务。写入前后及回调再次检查上下文；已被宿主接受的单次写入无法由浏览器原子撤销。真实宿主异步时序仍需实测。

| 范围 | 内容 |
| --- | --- |
| 设置脚本变量 | 原设置偏好、模型、configuration_library |
| 设置脚本变量 | summary_assistant_settings：白名单参数 |
| 设置脚本变量 | summary_assistant_secrets：按地址保存 Key |
| 设置脚本变量 | summary_assistant_migration：迁移版本 |
| 设置脚本变量 | summary_assistant_runtime：按预设／聊天上下文保存待处理任务，不含连接密钥 |
| 设置脚本变量 | summary_assistant_owned_books：实际加入全局的书；summary_assistant_books：独立总结书目录 |
| 聊天变量 | summary_assistant_worldbook：绑定 |
| 聊天变量 | summary_assistant_mega_summary_map：大总结来源 |
| 聊天变量 | summary_assistant_auto_hidden_floors：自动隐藏楼层 |
| 聊天变量 | summary_assistant_visibility_auto：本聊天自动隐藏开关 |
| 聊天变量 | summary_assistant_visibility_overrides：本面板手动显隐的来源与状态 |
| 聊天变量 | summary_assistant_archive：按书保存来源指纹、父记录与手动排除范围 |
| 聊天变量 | summary_assistant_binding_paused：主动解绑后暂停自动建书 |
| 世界书 | 普通／大总结正文 |

上表列出命定版的键名。键名由 `src/platform/storage-keys.js` 按版本前缀生成，通用角色扮演版使用 `general_summary_` 前缀，世界书为 `通用总结世界书_<后缀>`，两个助手因此不会共用设置、绑定、档案、任务状态与显隐记录。

设置整表写入先读取并保留最新总结字段；总结写入合并最新脚本变量。写入与读回验证失败均传播，不能显示成功或发布成功缓存。

绑定记在聊天变量中，生效沿用全局世界书列表。只移除助手实际添加过的书；预先启用的全局书不会被认领。显式绑定可选择酒馆全部世界书；不凭名称自动认领已有书。删除和刷新会清除失效绑定与目录项。关闭自动总结本身不解绑。

楼层自动隐藏开关按聊天保存，不进入命名配置、恢复点或配置导出。旧聊天尚无开关键时，有有效通用手动显隐记录则按暂停处理，否则沿用旧参数 autoHideSummarizedFloors 作为默认值。显式开关值优先，通用手动操作同时保存暂停状态。重新开启时清空通用手动记录，把这些楼层交回自动管理；独立讨论选择带 scope: discussion，保留在同一覆盖表中，不暂停全局自动隐藏。讨论操作按当前楼层与回复指纹校验来源，恢复自动只清除所选覆盖。随后按有效总结覆盖更新原生显隐，没有总结也能恢复。暂停保留现有显隐，但失去总结覆盖的自动隐藏仍需恢复。

讨论显隐由当前元数据和有效剧情覆盖共同计算，仅在两端剧情都已覆盖且中间全是连续讨论楼层时自动隐藏。讨论不进入剧情覆盖计数或归档来源，不修改已有来源校验。“讨论记录”页复用楼层快照，按页渲染和筛选，不新增定时全量扫描。

保存先建立未提交的来源记录，再写世界书；大总结启用和父记录停用在同一世界书更新内完成。读回通过后提交来源状态，随后同步显隐。显隐先记受管楼层，再用 refresh: affected 分批更新，避免 all 触发 CHAT_CHANGED；部分写入可按原阶段重试。详情见 [后台总结说明](SUMMARY.md)。

命名快照 v2 含可选 preset／summary，内部配置库版本仍为 1，分享文件外层版本为 2。v1 快照规范化为 preset 部分。所有分享路径采用白名单；Key、世界书、绑定、聊天、总结和隐藏记录不进入命名配置或恢复点。

受管设置版本 3 将 `managed_values.global_settings` 与 `user_additional_settings` 保存为 `{ id, text, enabled }` 数组，数组顺序即输出顺序。总开关仍属于原预设条目。短宏只序列化已启用的非空内容；旧 `global_preference` 在读取时迁移，缺少附加设定字段时先从对应预设正文提取，再替换受管区域。读取新版空数组不会恢复默认内容。列表编辑和配置切换共用保存队列，写入前验证编辑上下文，失败保留草稿；中文组合输入期间暂缓保存和内容重建。

角色名称宏在运行时通过 `src/platform/identity-macros.js` 统一解析，支持 `{{user}}`、`{{char}}`、`{{group}}`、`{{charIfNotGroup}}` 及对应尖括号写法，另兼容 `<bot>`。保存与导出的模板保留占位符。受管短宏回调先解析其返回文本；包含 Prime 正文起止边界的请求另处理变量回填、文风与模型条目中的残留角色宏。此过程只解析名称，不重复执行整段提示词中的变量、随机或其它有副作用的宏。

总结提示词、自定义宏、角色与世界书上下文使用本次请求的名称快照，材料前缀在准备材料时解析；聊天原文与历史总结不递归解析。无 Prime 正文起止边界的独立请求不进行全消息名称替换。
