# 功能规格说明：Workflow — 确定性多子 Agent 编排

**特性分支**：`workflow`
**创建日期**：2026-06-07

## 用户场景与测试 *（必填）*

### 用户故事 1 - 运行工作流探索代码库（优先级：P1）

作为用户，我希望要求 agent"使用工作流"探索代码库，以便它并行编排多个子 agent（扫描、逐文件分析、综合），而不是在一个上下文中顺序执行。

**为什么是这个优先级**：这是核心用例——单个对话轮次无法协调的大规模并行多 agent 工作。

**独立测试**：创建示例项目，发送消息要求 agent"use a workflow to explore this project"，验证 Workflow 工具被调用，脚本包含 `agent()`、`pipeline()` 和 `phase()`，最终结果是综合的概览。

**验收场景**：

1. **假设**有包含源文件的项目目录，**当**用户说"use a workflow to explore this project"时，**则** agent 调用 Workflow 工具，使用包含 `agent()`、`pipeline()` 和 `phase()` 的 JS 脚本。
2. **假设**有运行中的工作流，**当**工作流完成时，**则** `<task-notification>` 被注入对话中，agent 报告结果。
3. **假设**有包含多个阶段的工作流，**当**用户运行 `/workflows` 时，**则**系统列出运行记录，包含名称、状态、agent 计数和 token 使用量。

---

### 用户故事 2 - 选择加入强制执行（优先级：P1）

作为用户，我希望 Workflow 工具仅在我显式请求多 agent 编排时才被调用，以便 agent 不会为简单任务默默生成数十个 agent。

**为什么是这个优先级**：没有选择加入，工作流可能在用户不知情的情况下消耗大量 token。

**独立测试**：发送不请求工作流的简单问题，验证 agent 使用 Agent 工具或直接回答——不使用 Workflow 工具。

**验收场景**：

1. **假设**用户说"find all TODO comments"，**当** agent 处理请求时，**则** agent 不调用 Workflow 工具（使用 Agent 工具或直接回答）。
2. **假设**用户说"use a workflow to find all TODO comments"，**当** agent 处理请求时，**则** agent 调用 Workflow 工具。
3. **假设**用户调用 `/deep-research <question>`，**当**斜杠命令执行时，**则** Workflow 工具被调用并附带 deep-research 脚本。

---

### 用户故事 3 - 从日志恢复工作流（优先级：P2）

作为用户，我希望从中断处恢复停止的工作流，以便已完成的 agent 不重新运行且不浪费 token。

**为什么是这个优先级**：恢复为被中断或需要在运行中编辑的长工作流节省大量 token。

**独立测试**：运行工作流，在执行中停止，使用 `resumeFromRunId` 调用 Workflow，验证缓存的 agent 结果立即返回，只有新/更改的 agent 实时运行。

**验收场景**：

1. **假设**工作流运行在停止前完成了 10 个 agent 中的 5 个，**当**用户使用 `resumeFromRunId` 恢复时，**则** agent 0-4 立即返回缓存结果，agent 5-9 实时运行。
2. **假设**有恢复的工作流，**当**脚本相同且参数相同时，**则** 100% 的 agent 调用返回缓存结果（完全缓存命中）。

---

### 用户故事 4 - 来自 agent 的结构化输出（优先级：P2）

作为用户，我希望工作流 agent 返回匹配 schema 的结构化 JSON，以便下游阶段可以可靠地处理结果而无需脆弱的文本解析。

**为什么是这个优先级**：多阶段管道需要阶段之间的机器可读数据流。

**独立测试**：调用 `agent('List all files', {schema: {type: 'object', properties: {files: {type: 'array'}}, required: ['files']}})`，验证结果是经过验证的对象而非字符串。

**验收场景**：

1. **假设** agent 调用带有 `opts.schema`，**当**子 agent 完成时，**则**结果是匹配 schema 的经过验证的对象。
2. **假设** agent 调用带有 `opts.schema` 但子 agent 没有调用 StructuredOutput，**当** agent 完成时，**则**系统回退到对最终文本进行 JSON.parse。
3. **假设** agent 调用不带 `opts.schema`，**当**子 agent 完成时，**则**结果是 agent 的最终文本字符串。

---

### 用户故事 5 - IDE 插件工作流管理对话框（优先级：P2）

作为 IDE 用户，我希望通过 `/workflows` 斜杠命令打开对话框查看工作流运行详情（名称、状态、阶段、agent 数、token、经过时间），并能停止运行中的工作流，以便在不切换到 CLI 的情况下监控多 agent 编排。

**为什么是这个优先级**：CLI 已有 `/workflows`（FR-016）；IDE 用户需要对等能力以在工作流运行时观察进度与资源消耗。

**独立测试**：在 IDE 中输入 `/workflows`，验证弹出对话框列出工作流运行；选中运行中的工作流进入详情视图显示阶段列表与 token 统计；点击停止按钮终止运行。

**验收场景**：

1. **假设** 存在工作流运行，**当** 用户在 IDE 输入 `/workflows`，**则** 打开工作流管理对话框，列表显示每个运行的名称、状态、agent 数、token、经过时间。
2. **假设** 对话框已打开且工作流有阶段，**当** 用户选中某个运行，**则** 详情视图显示 runId、描述、状态、起止时间、运行时长、agent 数、token、脚本路径、错误（若有）及阶段列表（每阶段标题/agent 数/token/经过时间）。
3. **假设** 选中运行中的工作流，**当** 用户点击停止，**则** 通过 `stopWorkflowRun` 请求终止该运行，列表随后反映新状态。
4. **假设** 工作流后台任务状态变化，**当** 客户端收到 `backgroundTasksChange` 通知，**则** 自动调用 `getWorkflowRuns` 刷新运行列表并推送 `updateWorkflowRuns` 给 webview。

---

### 边界情况

- **脚本中的禁止模式**：包含 `require()`、`process.env`、`Date.now()`、`Math.random()`、`import`、`eval()` 的脚本在验证时被拒绝。
- **常见英语单词允许**：描述中的"process"（例如 `{title: 'Process', detail: 'process each item'}`）不触发禁止模式检查——只有 `process.`（属性访问）被禁止。
- **超出 agent 限制**：如果脚本生成超过 1000 个 agent，第 1001 个 agent() 调用抛出错误。
- **超出预算**：如果设置了 token 预算并超出，进一步的 agent() 调用抛出。
- **运行中中止**：如果用户停止工作流，所有飞行中的 agent 被取消，运行状态设置为"aborted"。
- **子 agent 中的 Workflow 工具**：Workflow 工具在子 agent 中被禁止（防止无限递归）。
- **脚本持久化**：每次 Workflow 调用都将脚本持久化到会话目录，即使执行失败。

## 需求 *（必填）*

### 功能需求

- **FR-001**：系统必须提供 `Workflow` 工具，AI 模型使用 JavaScript `script`、可选 `args`、可选 `scriptPath` 和可选 `resumeFromRunId` 调用。
- **FR-002**：Workflow 工具必须仅在用户显式选择加入多 agent 编排时调用——通过直接请求、斜杠命令或命名工作流调用。
- **FR-003**：每个工作流脚本必须以 `export const meta = {name, description, phases?}` 开头，后跟纯 JavaScript 主体。meta 必须是纯字面量。
- **FR-004**：脚本必须在沙箱化的 async 上下文中通过 `new Function()` 执行，API 作为闭包变量注入：`agent()`、`parallel()`、`pipeline()`、`phase()`、`log()`、`args`、`budget`。
- **FR-005**：运行时必须拒绝包含禁止模式的脚本：`require()`、`process.`、`eval()`、`import`、`Date.now()`、`Math.random()`、无参 `new Date()`、`fs.*`/`require('fs')`、`child_process`、`__dirname`、`__filename`、`global.`、`globalThis`。
- **FR-006**：工作流必须在后台运行。Workflow 工具立即返回运行 ID 和脚本路径。
- **FR-007**：并发 `agent()` 调用必须限制在 `min(16, cpu_cores - 2)`。每次运行的总 agent 数必须限制在 1000。单个 `parallel()`/`pipeline()` 调用必须最多接受 4096 项。
- **FR-008**：`agent(prompt, opts?)` 必须接受 `opts.schema`、`opts.label`、`opts.phase`、`opts.model`、`opts.agentType`，在用户跳过或终端错误时返回 `null`，在生成前检查预算，并检查中止信号。
- **FR-009**：`pipeline(items, stage1, stage2, ...)` 必须独立地将每个项运行通过所有阶段，阶段之间无屏障。每个阶段回调接收 `(prevResult, originalItem, index)`。在第一阶段 `prevResult` 为 `undefined`。
- **FR-010**：`parallel(thunks)` 必须并发运行任务并在返回前等待所有。被拒绝的 thunk 解析为 `null`。
- **FR-011**：当 `agent()` 使用 `opts.schema` 调用时，系统必须注入 StructuredOutput 工具指令，注册临时 StructuredOutput 工具，完成后提取和验证结果，并回退到对 agent 最终文本的 JSON.parse。
- **FR-012**：每个 `agent()` 调用必须将其结果追加到 JSONL 日志。使用 `resumeFromRunId` 时，未更改前缀的缓存结果必须立即返回。
- **FR-013**：系统必须跟踪所有工作流 agent 的 token 使用量。`budget.total` 是上限，`budget.spent()` 返回总输出 token，`budget.remaining()` 返回剩余量。超出预算时 agent 调用必须抛出。
- **FR-014**：系统必须通过 `/workflows` 斜杠命令报告工作流进度：当前阶段、每阶段 agent 计数、token 总计、经过时间。
- **FR-015**：每次 Workflow 调用必须将其脚本持久化到会话目录。用户可以编辑并使用 `{scriptPath}` 重新调用。
- **FR-016**：系统必须提供 `/workflows` 斜杠命令，列出所有运行记录，包含名称、状态、agent 计数、token 使用量和经过时间。
- **FR-017**：系统必须提供 `/deep-research <question>` 斜杠命令，执行内置工作流：搜索 → 获取 → 验证 → 综合。
- **FR-018**：`WorkflowManager` 必须管理完整生命周期：创建、启动、停止、恢复、列出、清理。
- **FR-019**：工作流必须遵守 `AbortSignal`。停止将状态设置为"aborted"并取消飞行中的 agent。
- **FR-020**：工作流完成通知（`task-type=workflow`、`status=completed|failed|aborted`）必须通过 `NotificationQueue` 入队并自动注入到 AI 对话循环中。
- **FR-021**：stdio 协议必须支持 `getWorkflowRuns` 请求方法（无参数），调用 `Agent.getWorkflowRuns()`，返回序列化的运行列表，移除不可序列化的 `completionPromise` 字段，保留 `runId`、`meta`、`status`、`scriptPath`、`args`、`startTime`、`endTime`、`phases`、`totalAgents`、`totalTokens`、`result`、`error`、`resumeFromRunId`、`failedAgentIndex`、`failedAgentError`。
- **FR-022**：stdio 协议必须支持 `stopWorkflowRun` 请求方法，携带 `runId` 参数，调用 `Agent.stopWorkflowRun(runId)`，返回 `{ success: boolean }`。
- **FR-023**：IDE 插件的 stdio 客户端必须在收到 `backgroundTasksChange` 通知后，调用 `getWorkflowRuns` 请求刷新工作流运行列表，并通过 webview 消息 `updateWorkflowRuns` 将运行列表推送给 webview。该刷新复用 `backgroundTasksChange` 作为触发源，不引入独立工作流通知，避免双通知抖动（与 CLI 在 `onBackgroundTasksChange` 中刷新 `getWorkflowRuns()` 的行为一致）。
- **FR-024**：当用户在 IDE 输入 `/workflows` 时，插件必须将其识别为本地命令并打开工作流管理对话框，而非通过 `sendMessage` 将文本作为普通消息发送给模型。
- **FR-025**：webview 必须实现 `WorkflowManager` 对话框组件，包含列表视图（名称/状态/agent 数/token/经过时间）与详情视图，字段与交互与 CLI `WorkflowManager.tsx` 保持一致（选择→详情、停止运行中工作流、关闭）。
- **FR-026**：webview 详情视图必须显示阶段（phases）列表，每个阶段含标题、agent 计数、token、经过时间；并显示 runId、描述、状态、起止时间、运行时长、agent 总数、token 总量、脚本路径、错误（若有）。
- **FR-027**：webview 必须对运行中（status=running）的工作流提供停止按钮，通过 `stopWorkflowRun` 请求终止选中的工作流。
- **FR-028**：JetBrains 插件必须镜像 VS Code 扩展的 stdio 协议订阅、缓存与 webview 通知行为（StdioAgent 纯转发、WaveSession 缓存 `workflowRuns` 并通过 `updateWorkflowRuns` 推送）。
- **FR-029**：工作流运行列表必须在 `setInitialState` 时一并下发，使 webview 初始化即拥有当前运行状态。

### 关键实体

- **WorkflowRun**：`{runId, meta, status, scriptPath, args, startTime, endTime, phases[], totalAgents, totalTokens, result, error}` — 工作流运行的内存状态。
- **WorkflowMeta**：`{name, description, whenToUse?, phases[]}` — 每个工作流脚本顶部声明的脚本元数据。
- **JournalEntry**：`{agentIndex, prompt, opts, result, tokens}` — JSONL 日志中的一行，支持确定性恢复。
- **BudgetInfo**：`{total, spent(), remaining()}` — 脚本中可用的 token 预算跟踪对象。
- **WorkflowManager**：在 DI 容器中注册的生命周期管理器。委托给 `SubagentManager` 进行 agent 生成、`BackgroundTaskManager` 进行后台执行、`NotificationQueue` 进行完成通知。
- **ScriptRuntime**：验证脚本、解析 meta 并通过 `new Function()` 执行，注入 API 闭包。
