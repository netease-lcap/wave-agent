---
name: "流式输出"
description: "助手消息和工具参数的实时内容流式传输"
order: 110
---

# 功能规格说明：实时内容流式传输

**创建日期**：2025-11-19  

## 用户场景与测试 *（必填）*

### 用户故事：实时助手消息流式传输（优先级：P1）

用户在助手响应生成过程中体验即时、增量的更新，类似于 ChatGPT 的打字效果。

**为什么是这个优先级**：这是面向用户的核心体验改进，提供即时视觉反馈，使系统感觉更响应和引人入胜。

**独立测试**：可以通过向助手发送任何消息并观察响应文本逐字符增量出现，而不是完成后一次性出现来完整测试。

**验收场景**：

1. **假设**用户发送了消息，**当**助手开始生成响应时，**则**文本内容在 CLI 消息列表中逐字符出现
2. **假设**助手正在流式传输响应，**当**新内容块到达时，**则**消息内容增量更新而不刷新整个界面
3. **假设**流式传输响应被中断，**当**用户中止消息时，**则**部分内容保持可见且格式正确

---

### 用户故事：实时工具参数流式传输（优先级：P2）

用户在 AI 构建函数调用时看到工具调用参数被增量构建，提供对 AI 推理过程的透明度。

**为什么是这个优先级**：通过实时展示 AI 的决策过程来增强用户信任和理解，对具有许多参数的复杂工具调用特别有价值。

**独立测试**：可以通过请求触发工具调用的操作并观察参数在折叠视图中增量出现，而展开视图显示进入展开模式时参数的快照来测试。

**验收场景**：

1. **假设**助手正在生成工具调用，**当**参数数据流式传入时，**则**compactParams 显示在折叠视图中实时更新
2. **假设**用户启用了展开视图，**当**工具参数正在生成时，**则**显示展示进入展开模式时参数的静态快照
3. **假设**多个工具调用正在生成，**当**处于折叠视图时，**则**每个工具的 compactParams 独立实时更新

---

### 用户故事：无缝视图模式切换（优先级：P3）

用户可以在折叠和展开视图模式之间切换，折叠模式显示实时流式传输，展开模式显示完全静态的内容，在内容生成期间不进行任何更新。

**为什么是这个优先级**：确保流式传输在折叠模式下最佳工作，同时在展开模式下提供完全稳定、无干扰的阅读体验，在内容生成期间永不变化。

**独立测试**：可以通过触发流式传输内容并在流式传输过程中在折叠/展开模式之间切换来测试。

**验收场景**：

1. **假设**内容在折叠模式下流式传输，**当**用户切换到展开模式时，**则**流式传输停止，内容显示为切换时刻的静态快照
2. **假设**用户处于展开模式，**当**新内容开始生成时，**则**显示保持为进入展开模式时的静态快照
3. **假设**用户处于展开模式，**当**在生成期间切换到折叠模式时，**则**流式传输从当前完成点恢复

---

### 用户故事：工具块阶段更新（优先级：P2）

SDK 集成者希望通过确定性阶段（start、streaming、running、end）追踪工具执行的生命周期，以提供准确的 UI 反馈。

**为什么是这个优先级**：对"启动中"、"流式输出中"、"仍在运行"和"已完成"状态的清晰区分使集成者能够显示准确的状态消息和最终结果。

**独立测试**：订阅 `onToolBlockUpdated`，触发工具执行，并验证事件按正确顺序以预期的 `stage` 值到达。

**验收场景**：

1. **假设**工具执行开始，**当**`onToolBlockUpdated`触发时，**则**收到的第一个事件包含 `stage="start"` 和工具的显示名称
2. **假设**工具发出流式输出，**当**`onToolBlockUpdated`以 `stage="streaming"` 触发时，**则**每个事件包含最新的 `parametersChunk`
3. **假设**长时间运行的工具，**当**进度更新发生但没有新块时，**则**`onToolBlockUpdated`发出 `stage="running"`
4. **假设**工具处于 `running` 阶段，**当**其产生增量结果或短结果时，**则**每次 `stage="running"` 事件都必须携带该工具调用自始至终不变的稳定展示字段（`compactParams`、`name`），而不是只在首次 running 事件携带——消费端（如 CLI）以 last-value-wins 节流丢弃中间事件后，仍能在 running 阶段正确渲染 compactParams
5. **假设**工具完成，**当**`onToolBlockUpdated`发出最终更新时，**则**事件使用 `stage="end"` 并携带最终输出或错误摘要
6. **假设**任何 `onToolBlockUpdated` 事件，**则**有效载荷不包含已弃用的 `isRunning` 标志

---

### 用户故事：实时工具结果流式传输（优先级：P2）

用户在长时间运行的工具（如 `bash`）执行时实时看到其输出，提供对工具进度的即时反馈。

**为什么是这个优先级**：对监控长时间运行的操作和提供响应式用户体验至关重要。

**独立测试**：运行长时间运行的 bash 命令并验证工具块的结果内容在 UI 中增量更新。

**验收场景**：

1. **假设**工具处于 `running` 阶段，**当**它产生增量结果时，**则**`onResultUpdate` 回调必须被触发，携带最新的累积结果
2. **假设**工具处于 `running` 阶段，**当**它产生增量短结果时，**则**`onShortResultUpdate` 回调必须被触发，携带最新的短结果
3. **假设**工具正在流式传输结果，**当**UI 接收更新时，**则**它必须相应更新工具块的 result 和 shortResult

---

### 用户故事：思考用时展示（优先级：P2）

用户在查看助手的推理（思考）块时，希望看到本次思考所花费的时间：进行中实时跳动计时，结束后显示最终耗时，历史会话重新加载后仍能看到最终耗时。

**为什么是这个优先级**：思考耗时让用户对 AI 的推理成本有直观感知，进行中的实时计时提供"仍在工作"的反馈，结束后的固定耗时便于回顾历史会话。

**独立测试**：触发一次会产生推理块的对话，观察思考块头部在进行中每秒递增，结束后锁定为固定耗时；随后刷新或重新加载该历史会话，验证仍显示相同的最终耗时。

**验收场景**：

1. **假设**推理块正在生成（`stage="streaming"`），**当**时间流逝时，**则**思考块头部基于该块的开始时间每秒动态递增显示当前已用秒数（如"思考中 9s"）
2. **假设**推理块生成结束（`stage="end"`），**当**头部更新时，**则**停止动态计时并显示由起止时间算出的固定最终耗时（如"思考 (用时 15s)"）
3. **假设**历史会话被重新加载或界面刷新，**当**推理块以 `stage="end"` 出现时，**则**头部直接静态显示持久化的最终耗时，而不重新从零计时
4. **假设**推理块开始时间缺失或起止时间异常（如结束早于开始），**当**头部渲染时，**则**不显示耗时而非显示负值或错误值

---

### 用户故事：长会话流式输出保持流畅（优先级：P1）

作为 CLI 或 IDE 插件的使用者，我希望在积累了大量消息的会话中，助手流式输出时界面依然即时、平滑地更新，以便消息越多时交互越不卡顿。

**为什么是这个优先级**：当前每次流式 chunk 都会触发 `onMessagesChange` 全量回调，CLI 侧随之全量 `setMessages`、插件宿主经 stdio 全量下发消息列表，序列化与传输成本随会话长度线性增长，是长会话流式卡顿的主要来源；且它与增量回调在时间上重复（同一 chunk 同时触发 `onAssistantContentUpdated` 与 `onMessagesChange`），造成数据冗余与竞态。为此移除 `onMessagesChange`，使流式更新全链路走增量通道；bang 信号携带 `messageId` 支持增量定位，完整消息列表仅在"拉取"场景（初始化、compact、rewind、clear、restore）传输。进一步地，增量负载从"chunk + accumulated 并存"收敛为"纯 chunk delta"（tool block streaming 只携带 `parametersChunk`），SDK 回调与跨进程（stdio）通知统一不再携带 `accumulated`，使单个通知的序列化成本与已流式内容总长度解耦，从根源消除传输层随流式累积的内存/带宽压力；进程内消费者（CLI、print-cli）改为消费纯 chunk 并自行累积追加（详见下方"状态管理架构"与 2026-08-08 会议记录）。

**独立测试**：构造一个包含数百条消息的长会话并发送一条消息触发流式响应：CLI 消息内容增量就地更新、无整屏刷新闪烁；插件侧记录 CLI stdout，流式期间只出现增量通知、无全量消息推送。执行 `!` bang 命令后消息列表正确显示命令输出。

**验收场景**：

1. **假设**会话已积累大量消息，**当**助手开始流式响应时，**则**CLI 与插件界面通过增量回调就地更新，不整屏刷新、不卡顿
2. **假设**助手响应正在流式传输，**当**每个内容 chunk 到达时，**则**SDK 只触发 `onAssistantContentUpdated` 等增量回调，不再触发任何携带完整消息列表的回调
3. **假设**CLI 正在渲染流式响应，**当**新 chunk 到达时，**则**消息内容就地更新，不再执行全量 `setMessages`
4. **假设**CLI 收到 bang 信号（`onAddBangMessage(command, messageId)`/`onUpdateBangMessage(command, output, messageId)`/`onCompleteBangMessage(command, exitCode, messageId)`，携带 messageId），**当**需要渲染命令消息时，**则**按 messageId 就地创建/更新 bang 消息块，无需读取 `agent.messages`
5. **假设**插件 webview 需要完整会话（webviewReady / compact / rewind / clearChat / restoreSession），**当**触发上述任一场景时，**则**宿主主动调用 `getMessages` 请求拉取并下发全量渲染，而非订阅持续的全量推送
6. **假设**子代理（subagent）运行中，**当**其消息变更时，**则** `SubagentManager` 通过 `instance.messageManager.getMessages()` 拉取最新列表维护 `instance.messages` 与 `usedTools`，并继续转发 `onSubagentMessagesChange`，不再依赖子代理的 `onMessagesChange`
7. **假设**助手响应正在流式传输，**当**每个内容/推理 chunk 到达时，**则**增量回调与 stdio 增量通知都只携带 `chunk`（增量片段）+ `messageId` + `stage`，不再携带 `accumulated` 累积值；进程内消费者（CLI、print-cli）与跨进程宿主（agentBridge）统一消费纯 chunk，自行累积追加
8. **假设**工具参数正在经 stdio 流式传输，**当** `stage="streaming"` 通知到达时，**则**只携带 `parametersChunk`（增量），不再携带累积 `parameters`；**当** `stage="end"` 通知到达时，**则**携带全量 `parameters` + `result` 作为一次性权威值
9. **假设**宿主（VSCE/桌面/CLI）对增量通知做了节流（如 16ms/500ms 窗口），**当**窗口内累积了多个 chunk 时，**则**按到达顺序将窗口内所有 chunks 拼接为一个合并 delta 发送，而非 last-value-wins 丢弃中间值——丢弃中间 chunk 会造成内容永久缺失，只能由后续 `getMessages` 拉取自愈
10. **假设**webview 正在追加流式 delta，**当**触发 `getMessages` 拉取全量列表时，**则**全量响应整体替换消息块为权威快照，随后到达的 delta 继续追加；管道 FIFO 保证拉取响应包含其之前发出的所有 chunk，不发生重复或错乱

---

### 边界情况

- 当网络连接较差且流式块乱序到达或延迟时会发生什么？
- 系统如何处理可能跨流式块分割的部分 UTF-8 字符？
- 如果用户在内容流式传输时从折叠切换到展开模式会发生什么？
- 如果流式传输因 API 速率限制或错误而中断，界面行为如何？
- 当非常长的内容流超过终端显示限制时会发生什么？
- 当推理块的开始时间存在但结束时间缺失（流被中止）时，耗时如何展示？
- 如果某个增量通知在传输中丢失（进程异常、节流实现错误），UI 内容如何恢复？→ 丢失的 delta 由后续 `getMessages` 拉取的全量权威快照整体替换自愈
- 如果在追加流式 delta 期间插入了一次 `getMessages` 拉取（如恢复会话），是否会重复或丢失内容？→ 不会：管道 FIFO 保证拉取响应按序到达且包含其之前全部 chunk；UI 以响应快照为准整体替换，后续 delta 继续追加

### 状态管理架构

- **Agent SDK 职责**：在内部管理所有消息状态并更新消息；变更通过增量回调（`onUserMessageAdded`、`onAssistantMessageAdded`、`onAssistantContentUpdated`、`onAssistantReasoningUpdated`、`onToolBlockUpdated`、`onErrorBlockAdded` 等）对外发布；完整列表通过 `agent.messages` getter（同进程）或 `getMessages` 请求（stdio 跨进程）按需获取。`onMessagesChange` 全量回调已移除
- **增量回调用途**：为第三方集成、扩展、CLI 与示例（如 `packages/code/src/print-cli.ts` 和 `packages/agent-sdk/examples`）提供实时流式数据；增量回调是消息状态同步的唯一推送通道
- **SDK 回调负载**：`onAssistantContentUpdated`/`onAssistantReasoningUpdated` 只提供 `chunk`（增量）+ `messageId` + `stage`，不再携带 `accumulated` 累积值，进程内消费者（CLI、print-cli）自行累积追加；`onToolBlockUpdated` 提供 `parametersChunk`（增量）与 `parameters`（累积）并存
- **跨进程 wire 负载（纯 delta）**：agentBridge 原样透传增量回调负载——`assistantContentUpdated`/`assistantReasoningUpdated` 只携带 `{messageId, chunk, stage}`（SDK 回调本身已无累积字段，无需剥离）；`toolBlockUpdated` 在 `stage="streaming"` 时只携带 `parametersChunk`，`stage="end"` 时携带全量 `parameters` + `result` 作为权威值。消费端负责累积（追加），丢失的 delta 由 `getMessages` 拉取的全量快照自愈
- **UI 状态流**：CLI 直接订阅增量回调就地更新消息（chunk 追加 + 500ms 窗口拼接节流）；插件/桌面经 stdio 增量通知（`userMessageAdded`、`assistantContentUpdated`、`toolBlockUpdated` 等，纯 delta 负载）驱动 webview 增量 reducer——文本/推理块追加 chunk、工具块追加 `parametersChunk`，end 时以权威值终结；需要完整列表的场景（初始化、compact、rewind、clear、bang）主动拉取，拉取响应整体替换为权威快照
- **节流语义**：SDK 回调与 wire 通知均只携带纯 delta，节流器一律按到达顺序拼接窗口内所有 chunks 为一个合并 delta（window-concat），绝不能 last-value-wins 丢弃中间值。为配合该语义，SDK 必须在每次 running 事件中重复携带 `compactParams` 等稳定展示字段（见"工具块阶段更新"验收场景 4），保证丢弃中间事件不丢失这些字段
- **清晰分离**：增量回调是消息状态管理的正式对外通道；全量数据按需获取，避免随每次流式 chunk 序列化整个列表

## 澄清

### 2025-11-19 会议

- 问：展开模式流式行为 → 答：展开模式下永不流式传输 - 所有内容仅在完成后出现
- 问：展开模式在生成完成时的内容更新 → 答：即使内容完成也不更新
- 问：展开模式中的内容可见性 → 答：显示切换到展开模式时内容的快照
- 问：onAssistantContentUpdated 回调数据格式 → 答：两个参数：(chunk: string, accumulated: string)
- 问：onToolBlockUpdated 回调参数格式 → 答：现有签名加上用于增量更新的新 `parametersChunk` 字段与累积参数并存
- 问：onAssistantMessageAdded 回调参数 → 答：不接收参数，内容/工具由专用流式回调处理
- 问：流式传输期间的状态管理 → 答：Agent SDK 在内部管理消息状态并通过增量回调对外发布；完整列表按需拉取（`agent.messages` / `getMessages`）。流式回调为第三方集成、扩展和示例提供数据（2026-08-04 起 `onMessagesChange` 已移除，见下方会议记录）

### 2026-04-09 会议（PR #928）

- 问：TextBlock/ReasoningBlock 阶段追踪 → 答：为两种类型添加 `stage` 字段（`"streaming" | "end"`）
- 问：BangBlock 运行状态 → 答：用 `stage: "running" | "end"` 替换 `isRunning: boolean` 以保持一致性
- 问：何时终结流式块 → 答：在 `updateToolBlock` 和 `addToolBlock` 中添加工具块之前调用 `finalizeCurrentStreamingBlocks()`
- 问：MessageList 中的流式块渲染 → 答：过滤掉流式文本/推理块以避免流式传输期间的频繁高度变化
- 问：动态块渲染范围 → 答：如果消息中的任何块处于运行/流式状态，该消息中的所有块都是动态的
- 问：流式工具参数显示 → 答：当没有 `compactParams` 可用时，内联显示最后 30 个字符并展平换行符（`\n` → `\\n`）
- 问：流式模式默认值 → 答：在 useChat Agent 创建中将 `stream: false` 改为 `stream: true`
- 问：Token 状态更新器 → 答：将 `throttledSetTokens` 添加到 useCallback 依赖数组以防止渲染错误

### 2026-07-22 会议（思考用时）

- 问：思考耗时的数据从哪来 → 答：由 Agent SDK 记录 `ReasoningBlock` 的起止时间并随消息持久化，作为耗时"真值"；前端不自行估算
- 问：进行中如何展示 → 答：`stage="streaming"` 时前端基于开始时间每秒动态递增显示（如"思考中 9s"）
- 问：结束/历史加载如何展示 → 答：`stage="end"` 时停止计时并显示由起止时间算出的固定最终耗时；历史会话重新加载后直接静态显示，不重新计时
- 问：起止时间异常如何处理 → 答：缺少开始时间或结束早于开始时，不显示耗时而非显示负值

### 2026-08-04 会议（移除 `onMessagesChange` 全量回调）

- 问：移除哪个回调 → 答：仅移除 `onMessagesChange`（携带完整 `Message[]` 的全量回调）；`onTasksChange`、`onBackgroundTasksChange`、`onMcpServersChange`、`onQueuedMessagesChange`、`onConfiguredModelsChange` 等其他全量回调保留不动
- 问：CLI 如何更新消息 UI → 答：改为注册增量回调（`onUserMessageAdded`、`onAssistantMessageAdded`、`onAssistantContentUpdated`、`onAssistantReasoningUpdated`、`onToolBlockUpdated`、`onErrorBlockAdded`、bang 三回调）就地更新；bang 三回调新增 `messageId` 参数（`onAddBangMessage(command, messageId)` 等），CLI 按 messageId 就地创建/更新 bang 消息块，无需全量拉取
- 问：webview 如何获取全量数据 → 答：主动拉取。stdio 协议移除 `messagesChange` 通知；宿主在 webviewReady / compact / rewind / clearChat / restoreSession 后调用 `getMessages` 请求，以响应形式下发全量消息；流式期间仅流动增量通知，bang 信号经 stdio 增量通知携带 messageId
- 问：子代理消息如何维护 → 答：`SubagentManager` 在子代理增量回调中通过 `instance.messageManager.getMessages()` 拉取最新列表，维护 `instance.messages` / `usedTools` 并转发 `onSubagentMessagesChange`
- 问：vsce 宿主增量注册注意事项 → 答：`onUserMessageAdded` 与 `onAssistantMessageAdded` 需分别映射到 webview 的用户/助手消息追加通道（修复现有 `onUserMessageAdded` 误路由到 `onAssistantMessageAdded` 的问题），避免与全量拉取叠加导致消息重复

### 2026-08-04 会议（流式通知纯增量负载）

- 问：为什么从"chunk + accumulated 并存"收敛为纯 delta → 答：节流只能减少通知条数，每个通知仍携带与已流式内容等长的累积 payload，总序列化/传输成本 O(n²)，长流时 stdio 内存与带宽压力持续存在；改为 wire 纯 delta 后通知负载与内容总长度解耦，总成本 O(n)
- 问：SDK 回调签名是否改变 → 答：不改。SDK 回调继续同时提供 chunk 与 accumulated（进程内消费者免费使用 accumulated）；剥离只发生在跨进程 wire 层（agentBridge），CLI/print-cli 进程内路径完全不动（注：2026-08-08 起此决定已被推翻——SDK 回调一并移除 accumulated，见下方会议记录）
- 问：tool block 流式通知负载 → 答：`stage="streaming"` 只携带 `parametersChunk`（增量），不再携带累积 `parameters`；`stage="end"` 仍携带全量 `parameters` + `result`（一次性权威值，UI 以此为最终值）
- 问：流结束信号如何表示 → 答：与现状一致——`chunk: ""`（空字符串）作为流结束标记，配合 `stage="end"`
- 问：webview 如何应用 delta → 答：reducer 追加——文本/推理块 `content += chunk`；工具块 `parameters += parametersChunk`；`getMessages` 拉取全量时整体替换为权威快照（自愈通道）
- 问：节流语义如何调整 → 答：从 last-value-wins（对累积值安全）改为窗口拼接（window-concat）：窗口内按到达顺序拼接所有 chunks 发送一个合并 delta；丢弃中间值会造成内容永久缺失
- 问：乱序/丢失如何保证正确性 → 答：管道 FIFO 保证通知与请求响应按序到达，"assistantMessageAdded 先于其首个 delta"、拉取响应包含其之前全部 chunk；偶发丢失由后续 `getMessages` 全量快照自愈
- 问：受影响范围 → 答：agentBridge（剥离累积字段）、各宿主 stdioAgent（透传 delta）、各宿主 webview 转发层（VSCE chatSession、桌面 desktopHost、JetBrains WaveSession 等的节流改为窗口拼接）；CLI/print-cli 进程内不变

### 2026-08-08 会议（SDK 回调移除 accumulated）

- 问：SDK 回调的 `accumulated` 是否保留 → 答：移除（breaking change，不留向后兼容）。`onAssistantContentUpdated`/`onAssistantReasoningUpdated` 与 wire 通知统一只携带 `{messageId, chunk, stage}`，进程内/跨进程只有一种负载模式，消除"两套语义"分裂，也避免消费者误用累积值造成 O(n²) 拷贝
- 问：SDK 内部累积逻辑是否一并移除 → 答：不移除。aiService 仍内部累积全文，messageManager 仍以"新值 slice 当前长度"计算 chunk delta——只是累积值不再暴露到外部回调
- 问：进程内消费者如何适配 → 答：CLI useChat 改为消费纯 chunk：新增窗口拼接节流器（window-concat，500ms），窗口内按到达顺序拼接 chunks 为一个合并 delta 发送，`stage="end"` 时先冲刷窗口内 pending 增量再转发 end 信号，最后一条 chunk 以空串 end 终结；print-cli 直接按 chunk 打印，无累积依赖
- 问：为什么 `stage="end"` 事件以 `chunk: ""` 结尾 → 答：end 是流结束信号，权威最终值由消费端自行累积得到，end 事件不再重复携带全量值

## 假设 *（必填）*

- 底层 AI 服务支持流式响应（增量内容传递）
- 网络连接对大多数用户通常稳定
- 终端/CLI 界面可以以 OpenAI 的流式速率处理实时文本更新（目标：每秒 2-3 次内容更新）
- 用户通常使用支持实时文本渲染的标准终端模拟器
- 在正常网络条件下内容流按时间顺序到达
- 消息变更通过增量回调对外发布，完整列表按需拉取（`agent.messages` / `getMessages` 请求）；每次流式 chunk 不触发全量列表推送
- 增量回调与跨进程通知一律只携带增量负载（chunk / parametersChunk），SDK 不再对外提供累积值；消费端负责累积追加，`getMessages` 全量快照负责对账自愈
- 工具参数流包含有效的 JSON 或结构化数据，可以使用新的 `extractStreamingParams` 工具函数（待实现）增量解析，该函数将验证 JSON 完整性并从部分流中提取有效的参数对象
- Agent SDK 在内部管理消息状态，并通过增量回调与按需读取（`agent.messages`）对外提供消息数据
