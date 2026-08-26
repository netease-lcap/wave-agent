---
name: "流式输出"
description: "助手消息和工具参数的实时内容流式传输"
order: 110
---

# 功能规格说明：实时内容流式传输

**创建日期**：2025-11-19

## 用户场景与测试 _（必填）_

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

**为什么是这个优先级**：当前每次流式 chunk 都会触发 `onMessagesChange` 全量回调，CLI 侧随之全量 `setMessages`、插件宿主经 stdio 全量下发消息列表，序列化与传输成本随会话长度线性增长，是长会话流式卡顿的主要来源；且它与增量回调在时间上重复（同一 chunk 同时触发 `onAssistantContentUpdated` 与 `onMessagesChange`），造成数据冗余与竞态。为此移除 `onMessagesChange`，使流式更新全链路走增量通道；bash 模式命令以 user 消息 + bash tool block 承载，经 `userMessageAdded`/`toolBlockUpdated` 增量定位，完整消息列表仅在"拉取"场景（初始化、compact、rewind、clear、restore）传输。进一步地，增量负载从"chunk + accumulated 并存"收敛为"纯 chunk delta"（tool block streaming 只携带 `parametersChunk`），SDK 回调与跨进程（stdio）通知统一不再携带 `accumulated`，使单个通知的序列化成本与已流式内容总长度解耦，从根源消除传输层随流式累积的内存/带宽压力；进程内消费者（CLI、print-cli）改为消费纯 chunk 并自行累积追加（详见下方"状态管理架构"与 2026-08-08 会议记录）。

**独立测试**：构造一个包含数百条消息的长会话并发送一条消息触发流式响应：CLI 消息内容增量就地更新、无整屏刷新闪烁；插件侧记录 CLI stdout，流式期间只出现增量通知、无全量消息推送。执行 `!` bash 模式命令后消息列表正确显示命令输出。

**验收场景**：

1. **假设**会话已积累大量消息，**当**助手开始流式响应时，**则**CLI 与插件界面通过增量回调就地更新，不整屏刷新、不卡顿
2. **假设**助手响应正在流式传输，**当**每个内容 chunk 到达时，**则**SDK 只触发 `onAssistantContentUpdated` 等增量回调，不再触发任何携带完整消息列表的回调
3. **假设**CLI 正在渲染流式响应，**当**新 chunk 到达时，**则**消息内容就地更新，不再执行全量 `setMessages`
4. **假设**CLI 收到 bash 模式命令消息增量（`userMessageAdded` 创建 user 消息，`onToolBlockUpdated` 更新 `name: "Bash"` 的 tool block），**当**需要渲染命令消息时，**则**按 messageId 就地创建/更新消息块，无需读取 `agent.messages`
5. **假设**插件 webview 需要完整会话（webviewReady / compact / rewind / clearChat / restoreSession），**当**触发上述任一场景时，**则**宿主主动调用 `getMessages` 请求拉取并下发全量渲染，而非订阅持续的全量推送
6. **假设**子代理（subagent）运行中，**当**其消息变更时，**则** `SubagentManager` 通过 `instance.messageManager.getMessages()` 拉取最新列表维护 `instance.messages` 与 `usedTools`，并继续转发 `onSubagentMessagesChange`，不再依赖子代理的 `onMessagesChange`
7. **假设**助手响应正在流式传输，**当**每个内容/推理 chunk 到达时，**则**增量回调与 stdio 增量通知都只携带 `chunk`（增量片段）+ `messageId` + `stage`，不再携带 `accumulated` 累积值；进程内消费者（CLI、print-cli）与跨进程宿主（agentBridge）统一消费纯 chunk，自行累积追加
8. **假设**工具参数正在经 stdio 流式传输，**当** `stage="streaming"` 通知到达时，**则**只携带 `parametersChunk`（增量），不再携带累积 `parameters`；**当** `stage="end"` 通知到达时，**则**携带全量 `parameters` + `result` 作为一次性权威值
9. **假设**宿主（VSCE/桌面/CLI）对增量通知做了节流（如 16ms/500ms 窗口），**当**窗口内累积了多个 chunk 时，**则**按到达顺序将窗口内所有 chunks 拼接为一个合并 delta 发送，而非 last-value-wins 丢弃中间值——丢弃中间 chunk 会造成内容永久缺失，只能由后续 `getMessages` 拉取自愈
10. **假设**webview 正在追加流式 delta，**当**触发 `getMessages` 拉取全量列表时，**则**全量响应整体替换消息块为权威快照，随后到达的 delta 继续追加；管道 FIFO 保证拉取响应包含其之前发出的所有 chunk，不发生重复或错乱

---

### 用户故事：增量消费端以快照推入消息（优先级：P1）

作为 CLI 或其他进程内增量消费端，我推入自己的消息状态时使用 SDK 消息对象的快照而非活引用，以便流式增量期间 SDK 就地更新消息块不会与消费端自己的累积追加相互污染。

**为什么是这个优先级**：2026-08-08 起 SDK 回调只携带纯 chunk delta，消费端必须自行累积追加（`content += chunk`）；而 SDK 内部仍将累积全文写入消息块（先写全量、再按"新值 slice 当前长度"计算并回调 chunk delta）。若消费端在 `onAssistantMessageAdded`/`onUserMessageAdded` 时直接把 `agent.messages` 中的消息对象活引用推入自己的状态，第一个 delta 到达时 SDK 已把共享块内容替换为完整累积值，消费端追加逻辑会读到此已更新值再拼接该 delta——首个 delta 被重复计数，表现为"reasoning 第一个单词重复"（如 `LetLet me think about this.`）。文本内容同理受影响，只是文本流通常在消息解耦后才出现而不易暴露。

2026-08-17 补充：快照必须**在回调触发时刻立即捕获**（`onAssistantMessageAdded`/`onUserMessageAdded` 被调用时同步执行 `snapshotMessage(msg)` 并保存结果），不能在 React state updater 内延迟执行。原因是 React 会把同一同步 tick 内的多次 `setMessages` 批处理，updater 函数到 flush 时才运行——而 SDK 的 `addAssistantMessage()` → 就地写入首个 chunk → 首个 delta 回调恰好处于同一同步 tick（`aiManager.ts` 的 `onContentUpdate`/`onReasoningUpdate`），flush 时延迟快照复制到的已是变异后的消息块，首个 delta 再追加即翻倍（`HelloHello`）。该竞态表现为"推理流结束后正文首个单词重复"（首个 content delta 与 messageAdded 落入同一批时），或首个 reasoning delta 重复（reasoning 折叠区，不易察觉）。

**独立测试**：构造一个带 reasoning 流式的会话，用与 CLI 相同的消费模式（推入活引用 + 追加 reducer）验证出现首词重复；改用快照推入（`{ ...m, blocks: m.blocks.map(b => ({ ...b })) }`）后同一断言通过。另有同批回归测试：在**同一同步 tick** 内连续调用 `onAssistantMessageAdded` → 就地变异消息块 → 首个 delta 回调（无 await 间隔，与真实 SDK 顺序一致），断言消息内容不翻倍（content `Hello` 非 `HelloHello`、reasoning `Let` 非 `LetLet`、reasoning 收尾后首个 content chunk 同批时两通道均不重复）。

**验收场景**：

1. **假设**增量消费端（CLI）收到 `onAssistantMessageAdded`/`onUserMessageAdded`，**当**将消息加入自己的状态时，**则**推入的是消息对象及其 blocks 的快照（深拷贝至少一层：消息与 blocks），而非 SDK 内部消息对象的活引用
2. **假设**助手消息流式输出 reasoning，**当**消费端按 `chunk` delta 累积追加时，**则**追加结果与 SDK 存储的完整推理内容一致，首个 delta 不重复（首个单词不翻倍）
3. **假设**消费端通过拉取通道（`agent.messages` / `getMessages`）获取全量列表，**当**把拉取结果推入状态时，**则**同样以快照推入，不与 SDK 内部对象共享引用
4. **假设**消费端已按快照推入消息，**当** SDK 继续就地更新其内部消息块时，**则**消费端状态不受影响，仅通过后续 delta 回调获得更新
5. **假设**消息创建回调与首个 delta 回调落在同一 React 批处理内（同一同步 tick：`addAssistantMessage()` → 就地写入首个 chunk → 首个 delta 回调），**当**消费端把快照推入状态时，**则**快照在回调触发时刻立即捕获（updater 外），复制的是变异前的空块；首个 delta 追加后首个单词不翻倍

---

### 用户故事：CLI 消息状态经单一节流更新函数统一渲染，全量刷新时快照安全取消（优先级：P1）

作为 CLI 使用者，我希望助手流式输出、工具运行与所有消息状态更新经同一个 500ms 窗口节流入口合并渲染（leading edge 立即、窗口内更新按到达顺序排队、end 立即冲刷），使高频更新（含工具 running 阶段的 `shortResult`/`result`）不逐 chunk 触发 React commit 造成布局跳动，同时流式期间触发 /clear、/compact、/rewind 或折叠等全量刷新时内容不与权威快照重复。

**为什么是这个优先级**：2026-08-17 曾因节流器 trailing edge 冲刷与全量列表替换（`refreshMessages`）交错导致内容重复而移除 CLI 节流（见下方 2026-08-17 会议记录）；2026-08-19 决定恢复节流并在竞态源头修复——`refreshMessages` 拉取权威快照后立即取消节流窗口：pending 内的旧更新在拉取前已写入 SDK 消息状态，必然已包含在快照中，丢弃无损失；拉取之后到达的更新开启全新窗口、追加在快照之上。2026-08-19 同次会议决定把三通道节流器（content/reasoning/tool）统一为一个 `updateMessages(updater)` 入口，`initializeAgent` 中全部消息状态更新回调（消息新增、文本/推理 delta、工具全阶段、error 块）都经它排队——bash 等前台工具逐 chunk 的 running 阶段 `shortResult`/`result` 更新由此同样受 500ms 窗口约束，短结果行数（1-4 行）变化至多每窗口一次，消除高度跳动闪烁。节流恢复与统一带来渲染频率上限（React commit 由 500ms 窗口合并，终端写入由 Ink 内置 30fps 兜底），同时竞态从机制上消除。

**独立测试**：构造带 reasoning 流式的会话，在流式期间触发一次全量刷新（/clear、/compact、/rewind 或折叠切换），验证最终消息内容与 SDK 权威内容逐字节一致、无重复片段（`useChat.test.tsx`：refresh-interleave 场景在节流恢复 + 快照取消下通过）；构造 bash 前台任务，连续触发 running 阶段 `shortResult` 更新，断言窗口内多次更新合并为一次渲染（`ToolDisplay` 行数不逐 chunk 跳变）；观察流式期间界面按节流频率平滑更新、无整屏闪烁。

**验收场景**：

1. **假设** CLI 正在消费消息状态更新，**当**任一消息更新回调到达时，**则**更新以 updater 形式（`(prev: Message[]) => Message[]`）经统一入口 `updateMessages` 处理：leading edge 立即应用首个更新并开启 500ms 窗口，窗口内后续更新按到达顺序排队，窗口关闭时以单个组合 updater 一次性应用（顺序 = 到达顺序，无更新丢失）；`stage="end"`/收尾事件先 `flush()` 冲刷排队更新再应用收尾信号
2. **假设**流式期间发生了全量列表替换（`refreshMessages`，/clear、/compact、/rewind、Ctrl+O 折叠触发），**当**替换发生时，**则**统一节流窗口在拉取快照后立即 `cancel()`——排队中的旧更新被丢弃（其内容已包含在权威快照中），trailing edge 不会把刷新前的更新重新追加到快照之上
3. **假设**全量刷新替换完成，**当**其后仍有流式 delta 到达时，**则**新 delta 开启全新节流窗口并追加在权威快照之上，内容不丢失、不重复
4. **假设**工具参数流式传输中发生全量刷新，**当**替换发生时，**则**窗口内各 tool 的 pending `parametersChunk` 一并丢弃（SDK 内部已累积，快照含权威 `parameters`），不产生参数重复
5. **假设**工具运行阶段逐 chunk 更新 `shortResult`/`result`（bash 前台任务经 `onToolBlockUpdated` `stage="running"` 高频到达），**当**同一窗口内到达多个更新时，**则**它们与文本/推理/tool 更新共用同一窗口排队合并，窗口内至多一次渲染，短结果行数不逐 chunk 跳变（工具卡片高度稳定）
6. **假设**同一窗口内工具 streaming 参数 chunk 与 running 权威快照交错到达，**当**排队应用时，**则**按到达顺序先应用 chunk 追加、再应用 running 权威替换，最终 `stage="running"`、`parameters` 为权威值——FIFO 顺序从机制上杜绝"stale streaming 晚于 running 冲刷导致阶段回退"（取代 2026-08-12 `createToolStreamingThrottle` 的"running 丢弃该 tool buffered deltas"逻辑）
7. **假设**窗口打开期间到达一次性结构更新（消息新增、error 块、工具块终结），**当**其与流式更新同窗时，**则**结构更新经统一入口入队后**立即 `flush()` 冲刷**（按到达顺序与窗口内已有更新一起应用，不丢失、不重排）——结构性更新为一发式、无合并价值，且立即冲刷避免其以 leading edge 占用窗口导致随后首个流式 delta 被延迟；消息卡片/错误块即时可见
8. **假设** CLI 以节流频率触发 React commit，**当**模型以高频（如 30ms/chunk）产出 delta 时，**则**终端输出写入仍受 Ink 内置 `maxFps: 30` 节流约束，不出现逐 chunk 整屏重绘或闪烁
9. **假设**长会话中流式输出，**当**消息不断积累时，**则**界面依然平滑即时更新，不因节流统一而卡顿（与「长会话流式输出保持流畅」验收场景 1 一致）
10. **假设**存在内容重复的回归测试，**当**运行现有双计数回归测试（content/reasoning 同批 double-count、refresh-interleave duplication）时，**则**测试继续通过，且不依赖移除节流后的无窗口语义

---

### 用户故事：CLI 静态块 reopen 不重复渲染冻结前缀（优先级：P1）

作为 CLI 使用者，我希望推理/正文块在一次 AI 调用内交错续写（同块 `end` → `streaming` 重新打开）时，屏幕上已显示的内容不重复，流式增量继续实时可见。

**为什么是这个优先级**：CLI 用 Ink `<Static>` 渲染历史消息，其 append-only 语义（`items.slice(index)` 只追加新项、已渲染项永不更新）与消息列表的"静态/动态分区"叠加产生渲染层重复：文本/推理块一旦进入静态区，其内容就冻结在终端输出中；当同一块因模型交错输出（如 `T→R→T` 或 `R→T→R`）重新打开（`stage` 从 `end` 回到 `streaming`）时，该块从静态区迁移回动态区，动态区以**全量累积内容**重新渲染——屏幕上"冻结前缀 + 全量内容"首词重复（如正文 `The answer is 42` 的 `The answer` 出现两次）。这是第三类首词重复（前两类为状态层：活引用/批处理快照、节流残留竞态），根因在渲染层而非状态层——SDK→CLI 状态始终一致，纯 delta 追加无重复，重复发生在 Ink 输出拼接。

**独立测试**：构造单条消息的阶段序列（推理流 → 收尾 → 正文流 → 推理 reopen 续写 → 收尾），逐阶段 `rerender` 并收集 `ink-testing-library` 全部帧，断言每一帧中每个块内容至多出现一次（`MessageList.block-reopen-duplication.test.tsx`：推理 reopen、正文 reopen=用户症状、reopen 期间增量可见三类用例）。无修复时断言失败（冻结前缀 + 动态全量 → 计数 2），修复后通过。

**验收场景**：

1. **假设**推理块已收尾（`stage="end"`，内容已进入静态区），**当**同一块重新打开流式续写（`stage="streaming"`）时，**则**屏幕上该块已显示的前缀不重复出现，动态区只渲染续写增量（`content` 超出冻结前缀的部分）
2. **假设**正文块已收尾（如模型先输出正文、再推理、再继续正文，正文块 `end` → `streaming`），**当**正文续写流式输出时，**则**正文首词不重复（用户可感知症状：推理流结束后正文首个单词重复）
3. **假设**reopen 块在动态区以增量渲染，**当**新增量到达时，**则**续写内容实时可见（增量 + 冻结前缀拼接后等于完整内容，视觉上无跳变）
4. **假设**reopen 块再次收尾，**当**其回到静态区时，**则**不因位置已被冻结项占据而重新渲染全量内容，屏幕保持稳定
5. **假设**reopen 块曾被静态写入过多次（多次 reopen），**当**后续续写流式输出时，**则**增量始终相对**首次**冻结内容计算（静态区永不更新已渲染项），多轮续写拼接正确
6. **假设**消息被 rewind/clear 移除，**当**再次渲染时，**则**冻结内容记录随块移除而清理，不残留过期键

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
- **SDK 回调负载**：`onAssistantContentUpdated`/`onAssistantReasoningUpdated` 只提供 `chunk`（增量）+ `messageId` + `stage`，不再携带 `accumulated` 累积值，进程内消费者（CLI、print-cli）自行累积追加；`onToolBlockUpdated` 在 `stage="streaming"` 时只提供 `parametersChunk`（增量），`start`/`running`/`end` 阶段携带权威 `parameters`（end 为最终值，一次性权威）。SDK 内部仍将 chunk 追加进内存 `toolBlock.parameters` 保持累积，只是累积值不再暴露到外部回调
- **跨进程 wire 负载（纯 delta）**：agentBridge 原样透传增量回调负载——`assistantContentUpdated`/`assistantReasoningUpdated` 只携带 `{messageId, chunk, stage}`（SDK 回调本身已无累积字段，无需剥离）；`toolBlockUpdated` 在 `stage="streaming"` 时只携带 `parametersChunk`，`stage="end"` 时携带全量 `parameters` + `result` 作为权威值。消费端负责累积（追加），丢失的 delta 由 `getMessages` 拉取的全量快照自愈
- **UI 状态流**：CLI 直接订阅增量回调就地更新消息，全部消息状态更新（消息新增、文本/推理 delta、工具全阶段、error 块）经**单一节流入口** `updateMessages(updater)` 排队应用——一个 500ms 窗口承载所有通道（含工具 running 阶段 `shortResult`/`result` 高频更新），leading edge 立即应用、窗口内更新按到达顺序 FIFO 排队、收尾时 `flush()` 冲刷，渲染频率由节流窗口与 Ink 内置 30fps 输出节流共同兜底（见「CLI 消息状态经单一节流更新函数统一渲染，全量刷新时快照安全取消」用户故事）；插件/桌面经 stdio 增量通知（`userMessageAdded`、`assistantContentUpdated`、`toolBlockUpdated` 等，纯 delta 负载）驱动 webview 增量 reducer——文本/推理块追加 chunk、工具块追加 `parametersChunk`，end 时以权威值终结；bash 模式命令（`!ls`）以 user 消息 + bash tool block 承载，输出实时性由 `toolBlockUpdated` 增量通知驱动，无需拉取全量列表；需要完整列表的场景（初始化、compact、rewind、clear）主动拉取，拉取响应整体替换为权威快照。进程内消费端把 SDK 消息对象推入自有状态时**必须克隆**（消息 + blocks 至少一层）且**在回调触发时刻立即捕获**（不得在 React state updater 内延迟求值——批处理 flush 晚于 SDK 就地变异，见"增量消费端以快照推入消息"用户故事），不得持有 SDK 内部活引用——SDK 会就地更新共享块，与消费端累积追加叠加会重复计数（见"增量消费端以快照推入消息"用户故事）。**渲染层**：CLI 消息列表的静态/动态分区必须遵守 append-only 约束——进入 `<Static>` 区的块（其内容已冻结在终端输出中）若因同块 reopen（`end` → `streaming`）回到动态区，动态区只能渲染"超出冻结前缀"的增量（`content.slice(冻结长度)`），否则冻结前缀与全量重渲染叠加造成首词重复（见「CLI 静态块 reopen 不重复渲染冻结前缀」用户故事）；冻结内容按块 key 记录（写入静态区的时刻），多轮 reopen 恒相对首次冻结内容计算
- **节流语义**：SDK 回调与 wire 通知均只携带纯 delta。CLI 进程内消费端使用**单一 500ms window-concat 节流入口** `updateMessages`（取代早期 content/reasoning/tool 三通道节流器，见「CLI 消息状态经单一节流更新函数统一渲染，全量刷新时快照安全取消」用户故事）：所有消息状态更新以 `(prev: Message[]) => Message[]` updater 形式提交，leading edge 立即应用并开启窗口，窗口内更新按到达顺序排队，窗口关闭时以单个组合 updater 一次性应用（顺序 = 到达顺序，无更新丢失、无 last-value-wins 丢弃中间值）；`stage="end"`/收尾事件先 `flush()` 冲刷排队更新再应用收尾信号。统一后 running 阶段 `shortResult`/`result` 更新与流式 delta 共用同一窗口，bash 短结果行数变化不逐 chunk 触发 React commit（消除闪烁）；FIFO 顺序保证 streaming chunk 与 running 权威值按到达顺序应用（streaming 先、running 后），从机制上杜绝 stale 冲刷晚于 running 的阶段回退（取代 `createToolStreamingThrottle` 的"running 丢弃该 tool buffered deltas"逻辑）。**全量刷新与节流窗口的交互**：任何把 CLI 消息状态整体替换为权威快照的操作（`refreshMessages`：/clear、/compact、/rewind、Ctrl+O 折叠）必须在拉取快照后 `cancel()` 节流窗口——pending 内更新已包含在快照中，丢弃无损失；拉取后的更新开启新窗口追加在快照之上，保证刷新前后内容既不重复也不丢失。为配合该语义，SDK 必须在每次 running 事件中重复携带 `compactParams` 等稳定展示字段（见"工具块阶段更新"验收场景 4），保证丢弃中间事件不丢失这些字段
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

### 2026-08-11 会议（SDK tool 回调 streaming 移除累积 parameters）

- 问：`onToolBlockUpdated` 的 `stage="streaming"` 是否继续携带累积 `parameters` → 答：移除（对齐 2026-08-08 content/reasoning 决策）。streaming 只携带 `parametersChunk`（增量）+ `messageId` + `stage`；`start`/`running`/`end` 仍携带权威 `parameters`（end 为最终值）。SDK 内部 messageOperations 仍将 chunk 追加进内存 `toolBlock.parameters` 保持累积，`getMessages` 快照对账自愈不回归——只是累积值不再暴露到外部回调
- 问：CLI 多 tool 场景下第一个 tool 不显示 compact params 的根因 → 答：CLI useChat 对 tool 更新误用普通 throttle（last-value-wins，单 lastArgs 槽），多 tool 交错 streaming 时首 tool 的 chunks 被后续事件覆盖，trailing 只应用最后一个 tool 的累积值 → 违反"节流语义"（window-concat）；修复为按 tool id 的 window-concat 节流，窗口内各 tool 的 chunks 独立累积拼接，end 时先冲刷窗口内 pending 增量再应用权威参数
- 问：受影响范围 → 答：aiService（streaming 不再发 `parameters`）、aiManager（`parameters` 条件转发，避免 `undefined` 泄漏进回调载荷）、messageOperations（chunk 追加进内存 `parameters`）、CLI useChat（按 tool 窗口拼接节流）；wire/agentBridge 自 2026-08-04 起已纯 delta，webview/desktop 消费端已按 `parametersChunk` 追加，均无需改动

### 2026-08-12 会议（CLI reasoning 首词重复缺陷）

- 问：CLI 中所有 reasoning 第一个单词重复的根因 → 答：进程内增量消费端（CLI useChat）在 `onAssistantMessageAdded` 时把 `agent.messages` 中的 SDK 消息对象**活引用**推入 React 状态；`updateCurrentMessageReasoning` 先就地替换共享块为完整累积值、再按"新值 slice 当前长度"计算并回调 chunk delta。首个 delta 到达时消费端追加逻辑（`content += chunk`）读到已被 SDK 更新的完整值再拼接该 chunk → 首词翻倍（`Let` + `Let me think about this.`）；首个 delta 处理完成、消息与 SDK 解耦后，后续 delta 正常
- 问：修复位置 → 答：消费端边界。CLI 在推入消息时必须克隆（`{ ...m, blocks: m.blocks.map(b => ({ ...b })) }`），不得持有 SDK 内部消息对象活引用；SDK 就地更新与回调顺序（先写全量、再回 delta）不变。覆盖所有推入点：`onAssistantMessageAdded`、`onUserMessageAdded`、拉取全量（`refreshMessages`、初始 `setMessages(agent.messages)`）
- 问：快照放在 React state updater 里执行行不行 → 答：不行。`onAssistantMessageAdded` 与首个 delta 回调落在同一同步 tick（`addAssistantMessage()` → 就地写入 → delta 回调），React 将同一 tick 的 `setMessages` 批处理，updater 到 flush 时才运行——此时快照复制的是已被 SDK 写入首个 chunk 的消息块，首个 delta 追加后首词翻倍（`HelloHello`）。快照必须在**回调触发时刻**（`snapshotMessage(msg)` 在 `setMessages` 之外、`onAssistantMessageAdded` 内立即执行）捕获变异前状态。同批回归测试：同一 tick 内依次调用 messageAdded → 变异 → 首个 delta（无 await 间隔），断言不翻倍
- 问：为什么不在 SDK 侧改 → 答：SDK 就地更新是 `getMessages` 权威快照的基础，先写全量再回 delta 保证回调时刻 SDK 状态已一致；改为先回调再写会让拉取与回调交错时读到过期值。快照克隆成本只在消息创建时发生一次，与流式 delta 数量无关

### 2026-08-17 会议（CLI 移除 500ms 节流、原始频率渲染）

- 问：为什么移除 CLI 的 500ms window-concat 节流 → 答：2026-08-12 修复（快照推入）解决了首词重复的活引用根因，但调研复现了另一残留竞态：节流器 trailing edge 冲刷 pending 窗口内已合并 chunk 时，若期间发生全量列表替换（`refreshMessages`，/clear、/compact、/rewind、Ctrl+O 折叠触发），pending 内旧 delta 会追加到已含全部内容的权威快照之上，造成内容重复（如 `Let me think about me think about this...`）。移除节流后每个 delta 同步立即应用、无 pending 窗口，竞态从机制上消除——用忠实复刻 throttle+reducer 逻辑的模拟脚本验证：500ms 节流 + 流中刷新稳定复现重复，wait=0（无节流）同场景永不重复
- 问：渲染性能是否受影响 → 答：不会。Ink 7.1.1 内置输出节流（`maxFps: 30` → ~34ms，leading+trailing）约束终端写入频率，与消费端节流无关；`<Static>` append-only 使历史消息永不重绘（`fullStaticOutput += staticOutput`）；`renderInteractiveFrame` 仅在 `output !== lastOutput` 时写入，log-update 再做增量 diff。React commit 频率等于 delta 到达频率，每次 commit 对全量可见消息做 `flatMap` + 元素重建，典型会话规模（≤30 条可见消息）为亚毫秒级
- 问：受影响范围 → 答：仅 CLI 进程内消费端（`packages/code/src/contexts/useChat.tsx`）——移除内容/reasoning 通道的 `createStreamingWindowThrottle`（500ms）与 tool 通道的 `createToolStreamingThrottle`（同一 pending 窗口 + 全量刷新竞态结构、同一逐 token 高频来源），每个 delta 立即经 reducer 应用。VSCE/桌面跨进程通道保留 window-concat 节流语义不变（wire 通知频率较低，非首词重复来源）
- 问：原「每秒 2-3 次内容更新」假设为何移除 → 答：该假设是 500ms 节流的设计依据；移除节流后更新频率由模型产出速率决定，终端写入频率由 Ink 30fps 兜底，无需人为限频

### 2026-08-18 会议（CLI Static 块 reopen 渲染层首词重复）

- 问：本次（第三类）首词重复与之前两类的区别 → 答：前两类在状态层——活引用/批处理快照（2026-08-12）与节流残留竞态（2026-08-17），状态先重复再渲染；本次在渲染层——SDK→CLI 状态始终一致（纯 delta 追加、逐帧对账无重复），重复只出现在 Ink 输出拼接。根因：CLI 消息列表的静态/动态分区中，文本/推理块一旦收尾就进入 `<Static>` 区被冻结；同块因模型交错输出（`T→R→T` 或 `R→T→R`）重新打开（`end`→`streaming`）时迁移回动态区，动态区以全量累积内容渲染，与屏幕上已冻结的前缀叠加 → 首词重复。复现概率低，因为需要单次调用内交错续写
- 问：为什么不能用"reopen 块永久留在静态区"修复 → 答：静态区 append-only、永不更新已渲染项，块留在静态区后续写内容永远不会显示，消息后半段的流式反馈会整体冻结（屏幕停在首个 reopen 时刻），流式体验退化
- 问：为什么不能整条消息动态化 → 答：reopen 只发生在消息运行期，但"消息运行"包含长工具执行（分钟级）——整条消息动态化会让已完成的超长文本块在每次工具状态更新时全量重建（性能回归），且冻结过的块回到动态区同样重复
- 问：修复方案 → 答：按块 key 记录"写入静态区时刻的内容"（冻结前缀，镜像 `<Static>` 内部 index 判断哪些项真正被追加）；reopen 块在动态区只渲染 `content.slice(冻结长度)` 增量——冻结前缀 + 动态增量拼接等于完整内容，无重叠、无重复、续写实时可见。多轮 reopen 恒相对首次冻结内容计算（静态区从不更新已渲染项）
- 问：如何确定哪些静态项真正被写入终端 → 答：镜像 `<Static>` 的 index 语义（`useLayoutEffect` 后 index = 上次 `items.length`），静态列表位置 ≥ index 的项在本 pass 被追加写入，其内容才记录为冻结；位置 < index 的项（reopen 时被顶到已占用位置的"填充块"）从未写入，不记录——它们后续 reopen 时仍以全量渲染（从未显示过，无重复问题）
- 问：回归测试如何捕获转瞬重复 → 答：逐阶段 `rerender` 后断言**每一帧**（ink-testing-library `frames`）中每个块内容至多出现一次，而非只断言末帧——重复只在 reopen 流式窗口内存在，末帧（块回到静态区）已无重复。无修复时全部 3 用例失败（帧计数 2），修复后通过

### 2026-08-19 会议（CLI 恢复 500ms 窗口节流 + 全量刷新快照安全取消）

- 问：为什么恢复 CLI 的 500ms window-concat 节流 → 答：移除节流后模型逐 token 高频产出（如 30ms/chunk）时每次 delta 都触发 React commit，bash 等长任务运行期间界面更新过密、短结果行数变化导致布局跳动（闪烁）。恢复 `createStreamingWindowThrottle`（content/reasoning，500ms）与 `createToolStreamingThrottle`（tool 参数，500ms）：leading edge 立即应用、窗口内 chunk 拼接、end 立即冲刷，渲染频率被节流窗口限制
- 问：2026-08-17 记录的节流残留竞态如何解决 → 答：在竞态源头修复而非移除节流——`refreshMessages`（全量快照替换的唯一入口，/clear、/compact、/rewind、Ctrl+O 折叠均经此）在**拉取快照之后、应用快照之前** `cancel()` 三个节流窗口。pending 内旧 delta 在拉取前已写入 SDK 消息状态，必然已包含在权威快照中，丢弃无损失；拉取之后到达的 delta 开启全新窗口、按 React 入队顺序追加在快照之上。刷新前后内容既不重复也不丢失
- 问：为什么 cancel 必须在拉取之后 → 答：若先 cancel 再拉取，cancel 与拉取之间到达的 delta 会同时出现在新窗口与快照中 → 重复；反之（先拉取后 cancel），cancel 与拉取之间不可能插入 delta（同步代码块），拉取前到达的 delta 要么已含于快照、要么在 pending 中被丢弃，两种情况下最终内容都与 SDK 权威状态一致
- 问：tool 节流窗口的 pending 参数 chunk 被 cancel 丢弃是否安全 → 答：安全。SDK 内部始终累积 `toolBlock.parameters`，拉取的快照携带权威 `parameters`；丢弃的只是 CLI 侧尚未刷新的增量，内容不丢失
- 问：受影响范围 → 答：仅 CLI 进程内消费端（`packages/code/src/contexts/useChat.tsx`）——恢复三个节流器并在 `refreshMessages` 中取消；VSCE/桌面跨进程通道的 window-concat 节流语义不变。回归测试：恢复后的 refresh-interleave 场景（流中 /clear 触发全量刷新 + 冲刷残留定时器）在快照取消下内容保持 `Let me`，无 `Let me me` 重复；同批 double-count 测试（2026-08-12 快照捕获修复）不受节流恢复影响，继续通过

### 2026-08-19 会议（CLI 消息状态更新统一为单一节流函数）

- 问：为什么把 content/reasoning/tool 三通道节流器统一为一个 `updateMessages` → 答：`initializeAgent` 中全部消息状态更新回调（`onUserMessageAdded`、`onAssistantMessageAdded`、`onAssistantContentUpdated`、`onAssistantReasoningUpdated`、`onToolBlockUpdated` 全阶段、`onErrorBlockAdded`、bang 三回调）本质都是"以更新函数改写 messages 状态"，此前只有文本/推理/tool 参数三通道走节流，而 bash 等前台工具逐 chunk 的 running 阶段 `shortResult`/`result` 更新走 `createToolStreamingThrottle` 的"running 立即应用"分支——不节流，行数（1-4 行）变化逐 chunk 触发 React commit 与 ToolDisplay 高度变化（闪烁源）。统一后全部更新经单一 500ms 窗口排队（FIFO、无 last-value-wins），running 高频更新与流式 delta 共用窗口，至多每窗口一次渲染，闪烁消除
- 问：统一窗口后如何保证 streaming→running 不产生阶段回退（原 a4d5767e 语义） → 答：由 FIFO 排队顺序从机制上保证——窗口内 streaming 参数 chunk 与 running 权威快照按到达顺序应用（streaming 先追加、running 后权威替换），组合 updater 一次性应用，最终 `stage="running"`、`parameters` 为权威值，不存在"buffered stale streaming 晚于 running 冲刷"的窗口（两者同窗同 flush），原"running 丢弃该 tool buffered deltas"的特殊逻辑随之移除
- 问：一次性结构更新（消息新增、error 块、bang 完成）经节流是否引入延迟 → 答：`updateMessages` 保留 leading edge 立即语义——窗口关闭时首个更新立即应用，窗口内到达的更新最多延迟 500ms 至窗口关闭冲刷；结构性更新（如消息新增）同窗排队时按到达顺序与流式 delta 一起应用，不丢失、不重排
- 问：统一后 `refreshMessages` 的取消语义是否变化 → 答：不变，只是从 cancel 三个窗口变为 cancel 单一窗口——拉取快照后 `cancel()` 丢弃排队中的 pending 更新（内容已含于权威快照），拉取后的更新开启新窗口追加在快照之上，刷新前后不重复不丢失
- 问：受影响范围 → 答：仅 CLI 进程内消费端（`packages/code/src/contexts/useChat.tsx`）——以单一 `updateMessages` 取代 `createStreamingWindowThrottle`（content/reasoning 两实例）与 `createToolStreamingThrottle`，`refreshMessages`、isExpanded 切换、卸载清理均改取消单一窗口；VSCE/桌面跨进程通道的 window-concat 节流语义不变。回归测试：既有 500ms 节流、tool 参数累积、同批 double-count、refresh-interleave 测试在统一入口下继续通过；`createToolStreamingThrottle` 单元测试改写为 `updateMessages` FIFO 排队语义测试（阶段回退防负断言保留）

## 假设 _（必填）_

- 底层 AI 服务支持流式响应（增量内容传递）
- 网络连接对大多数用户通常稳定
- 终端/CLI 界面可以以 OpenAI 的流式速率处理实时文本更新（目标：每秒 2-3 次内容更新）
- 用户通常使用支持实时文本渲染的标准终端模拟器
- 在正常网络条件下内容流按时间顺序到达
- 消息变更通过增量回调对外发布，完整列表按需拉取（`agent.messages` / `getMessages` 请求）；每次流式 chunk 不触发全量列表推送
- 增量回调与跨进程通知一律只携带增量负载（chunk / parametersChunk），SDK 不再对外提供累积值；消费端负责累积追加，`getMessages` 全量快照负责对账自愈
- 工具参数流包含有效的 JSON 或结构化数据，可以使用新的 `extractStreamingParams` 工具函数（待实现）增量解析，该函数将验证 JSON 完整性并从部分流中提取有效的参数对象
- Agent SDK 在内部管理消息状态，并通过增量回调与按需读取（`agent.messages`）对外提供消息数据
