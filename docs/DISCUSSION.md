# 讨论模式

在酒馆魔法棒菜单点击“讨论”，或点击助手标题旁的对话图标，继续使用原聊天框交流、纠错、修改设定与规划。开启时图标高亮，输入框上方显示“讨论中”，消息徽标为“讨论”。模式按聊天保存，生成期间锁定切换。

## 设置在哪里

提示词在当前预设的各模型头部、思维链、Gemini 预填充、输出协议与最终输出格式中。条目内用条件宏选择剧情或讨论内容，Gemini 非预填充及 Claude、DeepSeek、GLM 尾部共用。直接编辑这些原条目即可，没有独立的讨论提示词设置页。

原生列表最底部、Gemini 非预填充下方的“💬 讨论模式”是控制入口，与助手标题图标、魔法棒同步启停；自身只含不会发送的注释。正文与布局随预设和命名配置保存，聊天模式不进入命名配置或配置导出，也不串到其他聊天。

配套新版预设的 Gemini、Claude、DeepSeek 与 GLM 配置均支持讨论。助手依据当前启用的头部、思维链与尾部判断支持情况，不以接口模型名决定。自定义模型继续复制 Gemini 的三个条目，副本包含讨论分支并可独立编辑。旧自定义内容不覆盖；缺少分支时可从当前 Gemini 手动复制。缺少讨论分支或启用不完整的模板仍会返回剧情并提示。新增普通条目不自动包讨论条件。

## 回答与记录

Recorder 既是记录者，也是 Participant 的助手；Participant 是场外交流者。讨论按明确要求完成解释、纠错、检索资料、修改、规划与试写，不把原叙事约定当作拒绝修改的理由。文风及剧情协议作为讨论资料，试写按要求使用相关部分。

回答保留 recorder_output 外壳。任务检查依次覆盖身份与需求、回顾检索、任务处理、适用范围、交付内容，按任务复杂度记录结论和必要依据。Gemini、Claude 使用 recorder_thinking；DeepSeek、GLM 使用原生 reasoning_content，正文不重复检查。recorder_body 使用自然语言或 Markdown，结束区只输出 recorder_done。明确修改指令无需再次确认，回复不会自动改写历史、世界书或变量。

预填充已提供 Recorder 开头，模型仅续写后半段。思维链美化沿用兼容 DS、Claude、Gemini 的通用提取，不要求输出整份 Recorder 协议才渲染；公开检查、剩余正文与 MVU 尾部各自保留。Recorder 外壳及讨论包装由现有显示正则隐藏，助手只负责模式和记录标记。

重生成、滑动生成和续写沿用目标回复的模式，标记跟随具体 swipe。结束事件与最终消息事件可能倒序，保存依靠 MESSAGE_RECEIVED 的实际楼层 ID，不把结束事件中的聊天数量当楼层。旧聊天默认剧情，不猜测未标记的旧讨论。

新记录为 `<discussion_record>…</discussion_record>`。旧 `<destined_discussion>` 继续兼容，发送历史时只规范化根标签，编辑时写新标签，不批量重写旧聊天。用户历史清理和摘要远层正则豁免完整根讨论包装，保留正文和额外追加的尾段；近层规则照常移除摘要块。正文中的代码或引用标签不冒充讨论。其他脚本及用户的正常隐藏仍生效。

两种模式都不再自动追加历史解释提示词，旧 history 设置也不发送。讨论遵循正常上下文容量，没有额外永久记忆，长期要求保存到已有设定功能。

## 总结与变量

总结先排除有讨论元数据的楼层，再按个人设置提取 tp、gametxt 等标签。讨论不参与关键词扫描、计数或归档来源；保留真实楼层编号，纯讨论不调用总结 API。普通总结和大总结可衔接仅隔着讨论的有效来源，不跨越缺失或失效的剧情来源。

“聊天总结 → 讨论记录”按楼层列出用户与 AI 的讨论，可筛选显隐和发言者、定位楼层、查看原文，或选择本页批量显示、隐藏、恢复自动。列表每页最多 30 条，最新记录在前；翻页与筛选使用已有快照，刷新才重新读取楼层。

开启“按总结自动隐藏”后，夹在有效已总结剧情之间的讨论会跟随隐藏，开头和最新讨论保留；不会跨越缺失或未总结的剧情。讨论仍不算剧情来源。此页的手动显示、隐藏单独保存，不暂停全局自动隐藏，重新开启全局开关也保留这些选择。选择“恢复自动”才解除对应记录的手动选择；总结失效后会恢复助手自动隐藏且已失去覆盖的讨论。

MVU 已加载时，助手通过 COMMAND_PARSED 拦截讨论的变量命令。完成包装前，必须与已知目标楼层及 swipe 的当前正文一致；保存后依据完整根包装判断，允许额外模型追加任意尾段。晚到的旧剧情不会仅因当前开关被拦截。该拦截不会取消外部额外模型请求。

上游行为参考：[MVU 消息处理](https://github.com/MagicalAstrogy/MagVarUpdate/blob/beta/src/function/update/on_message_received.ts)、[变量解析与保存](https://github.com/MagicalAstrogy/MagVarUpdate/blob/beta/src/function/update_variables.ts)。源码核对与模拟命令事件不能替代真实插件验证。

## 内部兼容

- 聊天变量 destined_discussion_mode 保存布尔值，缺失为剧情，兼容旧 discussion 字符串。
- 原生宏“本轮场外讨论”在生成开始时写入并读回 0 或 1，其作用域与酒馆助手聊天变量分开。内部宏名及标记不会出现在最终请求中。
- 原生总开关 ID 为 destined-discussion-toggle，extensions.destined_discussion v6 只保存版本标记，宏桥接为 v2。旧 v1～v5 配置可读取，不自动覆盖用户正文。
- message.extra.destined_discussion 保存 `{version: 1, mode: 'discussion'}`，当前页同步到 swipe_info[index].extra。实际使用 Recorder 预填充时额外保存 recorder_prefill:true，原思维链、签名、附件与其他页保留。
- __destinedDiscussionV1 提供冻结模式和生命周期桥接，两种模式共用 Prime 原有深度分区。

酒馆编辑预设与计数时的 dry run 不建立生成状态、不写本轮宏，也不修改正式请求的冻结模式。消息处理器仅整理预览中已展开的分支，临时不完整的预览不弹发送错误；正式生成开始时重新同步开关并固定宏，发送前仍检查边界与模式。

协议不匹配、宏不可用或 MVU 命令监听注册失败会显示具体错误。无命定边界的 generateRaw 总结不读取模式也不改写参数。其他插件若在讨论期间重叠调用原生 Generate('quiet')，会停止两个原生请求并保留已有讨论；它与独立 generateRaw 总结不同。讨论清除连接额外的 assistant_prefill，保留原生预填充条目；续写时若额外预填充非空，会报错避免误删已有正文。

## 开发验证

~~~sh
node --test tests/discussion-*.test.js
node tests/ui/test-discussion.cjs
node tests/ui/test-discussion-records.cjs
node tests/ui/test-discussion-settings.cjs
node scripts/check-message-processing.mjs --source "配套预设的消息后处理.js"
node scripts/check-discussion-output.mjs --source "配套预设的思维链美化.js"
~~~

跨仓库检查从私有 split 读取源码，不将完整预设复制到公共仓库。Gemini 两尾及自定义副本、Claude、DeepSeek、GLM 的剧情／讨论，结合三组字数／文风／变量配置和两种注册顺序，共 84 组发送组合；另有 Recorder 输出专项。EJS 不执行，深度插入和 API 为模拟。

浏览器检查覆盖快捷入口、状态、原生开关同步、聊天生命周期、模型副本与移动布局。讨论记录页使用独立模拟聊天，检查分页、原文、单条及批量显隐、自动策略、生成期间锁定和窄屏布局，并纳入总结界面验证组。本地结果不能标记为真实手机、酒馆、模型或 MVU 实测；交付包单独记录实际验证范围。
