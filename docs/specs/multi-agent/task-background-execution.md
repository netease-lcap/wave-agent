# 功能规格说明：任务后台执行与管理

**特性分支**：`task-background-execution`
**创建日期**：2026-02-09

## 用户场景与测试 *（必填）*

### 用户故事：后台任务执行（优先级：P1）

作为用户，我希望能够在后台运行复杂或长时间运行的任务，以便在任务处理期间继续与 agent 交互。

**为什么是这个优先级**：这是实现非阻塞工作流的核心功能，对于处理耗时操作时的生产力至关重要。

**独立测试**：可以通过使用 `run_in_background: true` 启动任务并验证 agent 立即返回控制权并附带任务 ID，同时任务继续运行来进行测试。

**验收场景**：

1. **假设**有一个需要大量时间的任务，**当**我使用 `run_in_background: true` 执行它时，**则**我应立即收到唯一的任务 ID 和实时输出日志文件的路径，agent 应准备好接受下一个命令。
2. **假设**后台任务正在运行，**当**我检查系统状态时，**则**我应看到该任务被列为活动状态。
3. **假设**后台任务正在运行，**当**我读取提供的日志文件路径时，**则**我应看到任务的实时输出。

---

### 用户故事：任务输出获取（优先级：P1）

作为用户，我希望能够获取后台任务的输出（无论是在运行中还是完成后），以便查看我所请求操作的结果。

**为什么是这个优先级**：如果无法检查结果，后台任务就毫无用处。这提供了对后台操作的必要可见性。通过日志文件进行实时监控提供了更好的长时间运行任务体验。

**独立测试**：可以通过使用 `Read` 工具读取任务启动时提供的 `outputPath` 来进行测试。

**验收场景**：

1. **假设**后台任务已启动，**当**我使用 `Read` 工具访问 `outputPath` 文件时，**则**我应看到到目前为止生成的输出。
2. **假设**后台任务正在运行，**当**我读取提供的日志文件路径时，**则**我应看到任务的实时输出。

---

### 用户故事：任务终止（优先级：P2）

作为用户，我希望能够停止正在运行的后台任务，如果我意识到它不再需要或行为异常。

**为什么是这个优先级**：提供对系统资源的控制，并允许用户取消错误或失控的操作。

**独立测试**：可以通过对正在运行的任务使用 `TaskStop` 工具并验证任务被终止且其状态更新为已停止/已取消来进行测试。

**验收场景**：

1. **假设**有一个正在运行的后台任务，**当**我使用 `TaskStop` 并传入任务 ID 时，**则**任务应立即终止，我应收到确认信息。

---

### 用户故事：任务管理命令（优先级：P2）

作为用户，我希望在 CLI 中使用 `/tasks` 命令来列出和管理所有后台任务，以便有一个集中的地方来监控进度。

**为什么是这个优先级**：提供用户友好的任务管理界面，无需记住特定的任务 ID 或直接使用底层工具。

**独立测试**：可以在 CLI 中运行 `/tasks` 并验证它显示当前和最近任务的列表及其状态。

**验收场景**：

1. **假设**已启动了多个后台任务，**当**我运行 `/tasks` 时，**则**我应看到一个格式化列表，显示每个任务的任务 ID、类型、状态和启动时间。
2. **假设**遗留的 `/bashes` 命令曾经存在，**当**我尝试使用它时，**则**它应被移除或重定向到 `/tasks` 并附带弃用通知。

---

### 用户故事：前台工具后台化（优先级：P1）

作为在后台运行长时间 bash 命令或子 agent 任务的用户，我希望能够使用 Ctrl-B 将其移到后台，以便在不等待完成的情况下继续使用 CLI 处理其他任务。

**为什么是这个优先级**：这在最初在前台启动的长时间操作期间通过解除用户阻塞来提供即时价值。

**独立测试**：可以通过运行一个长 bash 命令（例如 `sleep 60`）、按 Ctrl-B 并验证 CLI 返回提示符而命令在后台继续运行来进行测试。

**验收场景**：

1. **假设**bash 或任务工具在前台运行，**当**用户看到提示 `[Ctrl-B] Background` 并按 Ctrl-B 时，**则**工具的前台执行结束，任务在后台继续运行。
2. **假设**工具已通过 Ctrl-B 后台化，**当**用户通过 `/tasks` 检查任务状态时，**则**该工具应作为后台任务可见。

---

### 用户故事：任务完成通知（优先级：P1）

作为用户，我希望在后台任务完成、失败或被终止时在聊天中自动收到通知，这样我不必手动检查就能知道结果。

**为什么是这个优先级**：如果没有自动通知，用户必须轮询任务状态或记得检查输出，这就违背了后台执行的目的。

**独立测试**：启动一个后台任务，等待其完成，并验证聊天中出现通知，显示任务状态和摘要。

**验收场景**：

1. **假设**后台任务正在运行，**当**任务成功完成时，**则**聊天中应出现带有绿色指示器和摘要消息的通知。
2. **假设**后台任务正在运行，**当**任务失败时，**则**聊天中应出现带有红色指示器和错误摘要的通知。
3. **假设**后台任务正在运行，**当**任务被用户终止时，**则**聊天中应出现带有黄色指示器和摘要的通知。
4. **假设**多个后台任务在 agent 空闲时完成，**则**所有通知应出现在聊天中。
5. **假设**后台任务在 agent 活跃响应时完成，**则**通知应被排队并在当前响应完成后显示。
6. **假设**队列中已有待处理用户消息，**当**后台任务通知同时入队时，**则**系统必须串行处理二者，不会并发触发两个 AI turn，不会出现两个并行的响应 stream。
7. **假设**主 Agent 并发启动 N（N≥3）个后台 subagent 并等待全部完成通知，**当**所有 subagent 完成时，**则**主 Agent 必须收到恰好 N 条完成通知（每个 taskId 恰好一次），且任何通知不得出现在兄弟 subagent 的会话 transcript 中、不得因此重新唤起兄弟 subagent 额外执行一轮。
8. **假设**并发后台 subagent 完成通知入队期间，**当**某个兄弟 subagent 的 AIManager 回合结束时，**则**该 subagent 不得从主 Agent 的 MessageQueue 排空（`drainNotifications`）任何通知；subagent 的通知排空只能作用于其自身容器的独立队列。
9. **假设**主 Agent 在 print 模式（`wave -p`）下等待后台 subagent 完成，**当**最后一个 subagent 完成且其通知已被主 Agent 消费、生成最终响应后，**则**print 模式才允许退出（exit 0）；不得因通知被错误消费者取走导致 `hasPendingMessages`/`hasRunningBackgroundWork`/`isLoading` 提前为假而提前退出。

---

### 用户故事：IDE 插件后台任务管理对话框（优先级：P2）

作为 IDE 插件（VS Code 扩展与 JetBrains 插件）用户，我希望能在 IDE 中通过 `/tasks` 命令弹出对话框查看和管理后台任务（shell / 子 agent / 工作流），与 CLI 的 `/tasks` 弹窗体验一致，以便集中监控后台运行的长时间任务、查看输出、必要时终止任务。

**为什么是这个优先级**：IDE 插件以 stdio 子进程方式运行 Agent，目前 `AgentCallbacks.onBackgroundTasksChange` 回调未通过 stdio 协议转发，IDE 完全无法感知后台任务（`run_in_background`、超时自动后台化的任务）。后台任务的结果当前仅在 CLI 可见；IDE 用户无法查看或管理这些任务，与 CLI 体验不一致。

**独立测试**：在 IDE 插件中输入 `/tasks`，验证弹出对话框列出后台任务（id、类型、状态、描述、运行时长）；选择某任务查看详情输出；点停止按钮终止运行中任务；任务状态变化时列表实时刷新。

**验收场景**：

1. **假设**有后台任务运行，**当**用户在 IDE 输入 `/tasks` 时，**则**弹出对话框列出所有后台任务（运行中/已完成/失败/已终止），每项显示 id、类型、状态、描述/命令、运行时长
2. **假设**用户在列表中选择某任务，**当**进入详情视图时，**则**显示该任务的 stdout/stderr 输出（末尾若干行）、退出码、日志文件路径
3. **假设**某任务正在运行，**当**用户点击停止按钮时，**则**任务被终止，列表中该任务状态更新为已终止
4. **假设**后台任务状态变化（启动/完成/失败/终止），**当**子进程发送 `backgroundTasksChange` 通知时，**则**对话框实时刷新列表
5. **假设**无后台任务，**当**用户输入 `/tasks` 时，**则**对话框显示空状态提示
6. **假设**IDE 与 CLI 行为需一致，**则**二者任务列表数据模型一致（基于同一 `BackgroundTask` 类型）

---

### 边界情况

- **无效任务 ID**：系统如何处理带有不存在 ID 的 `TaskOutput` 或 `TaskStop` 请求？（预期：显示任务未找到的错误消息）。
- **任务已完成**：当 `TaskStop` 被调用在已完成的任务上时会发生什么？（预期：显示任务已完成的提示消息）。
- **输出获取超时**：当 `block: true` 时，`TaskOutput` 如何处理超过指定超时的任务？（预期：返回日志文件的最后几行，并附带仍在运行的状态指示）。
- **并发访问**：来自同一后台任务的多个输出请求。
- **没有工具运行时按 Ctrl-B**：系统应忽略该按键。
- **直接用户 bash 命令（`!command`）**：用户使用 `!` 前缀直接启动的命令不得受 Ctrl-B 影响。
- **超时自动后台化**：当前台 Bash 命令超时时，进程被自动后台化而不是被终止（除非命令以 `sleep` 开头）。这保留了只需要更多时间的长时间运行工作。
- **后台任务无超时**：显式后台化的任务（`run_in_background: true`）忽略默认和显式超时，运行直到完成或手动停止。
- **并发后台 subagent 通知错误路由**：当多个后台 subagent 并发完成时，若 subagent 容器未持有独立 MessageQueue，其 AIManager 回合末会经由 `Container.get()` 的 parent 回退抽干主 Agent 队列，将兄弟任务完成通知注入自身会话并重新唤起自身回合（`shouldRestart`），同时主 Agent 因收不到该通知而提前退出。修复要求每个 subagent 容器注册独立 MessageQueue，且完成通知仅投递并消费于主 Agent 队列。

## 需求 *（必填）*

### 功能需求

- `Task` 工具必须支持 `run_in_background` 布尔参数。
- 当 `run_in_background` 为 true 时，系统必须异步启动任务并立即返回唯一的 `task_id` 和指向实时日志文件的 `outputPath`。任务必须不受任何超时限制——后台任务持续运行直到完成或手动停止。
- 当前台 Bash 命令超时时，系统必须自动将其后台化（通过 `BackgroundTaskManager.adoptProcess`）而不是终止它，除非命令的基础命令在 `DISALLOWED_AUTO_BACKGROUND_COMMANDS`（当前为 `["sleep"]`）中。自动后台化的任务会收到与显式后台化任务相同的完成通知。
- 系统不得提供 `TaskOutput` 工具；agent 应该使用 `Read` 工具读取 `outputPath`。
- 系统必须提供 `TaskStop` 工具来终止正在运行的后台任务。
- `TaskStop` 必须支持 `task_id` 参数。
- `BashOutput` 和 `KillBash` 工具必须被移除/弃用，以支持统一的 `Read` 和 `TaskStop` 工具。
- `Read` 工具必须能够读取后台 shell 任务和异步 agent 任务的 `outputPath`。
- 后台任务在运行时不得更新其 `shortResult`，以防止不必要的消息更新和 UI 中的"unknown"工具块。
- CLI 必须实现 `/tasks` 命令来列出所有活动和最近完成的任务。
- 遗留的 `/bashes` 命令必须从 CLI 中移除。
- `/tasks` 命令输出必须包含任务 ID、状态和任务类型。
- 对于后台 shell 任务，系统必须将 `stdout` 和 `stderr` 实时管道到 `outputPath` 日志文件。
- 对于后台子 agent 任务，系统必须将工具执行详情（工具名称和紧凑参数）实时记录到 `outputPath` 日志文件。
- 当任务完成或停止时，`outputPath` 日志文件必须被正确关闭。
- 当可后台化的工具（Bash 或 Task）在前台运行时，CLI 必须显示 UI 提示（例如 `[Ctrl-B] Background`）。
- 当工具在前台执行时，CLI 必须监听 Ctrl-B 组合键。
- 当在 Bash 或 Task 工具执行期间按下 Ctrl-B 时，系统必须将工具的前台阶段转换为"结束"并在后台继续。
- 后台化工具的结果必须设置为"Command was manually backgrounded by user with ID [ID]"。
- 当按下 Ctrl-B 时，系统不得后台化用户使用 `!` 前缀直接启动的 bash 命令。
- 当后台任务完成、失败或被终止时，系统必须将任务完成通知入队到统一消息队列（与用户消息、bang 命令共用同一队列），而非独立的通知队列。
- 任务完成通知必须在聊天中渲染为结构化块（非原始 XML），带有颜色指示器：绿色表示完成，红色表示失败，黄色表示被终止。
- AI 必须以原始 XML 格式（`<task-notification>...`）接收任务完成通知，以便其可以解析并响应。
- 任务完成通知在 agent 空闲时必须立即处理，在 agent 忙碌时排队。
- 用户消息、bang 命令和后台任务通知必须统一进入同一消息队列，由单一调度路径（`tryDispatch` + 状态机）串行出队处理，确保任意时刻最多只有一个 AI turn 运行，避免并发 `sendAIMessage` 导致重复 stream。
- `sendAIMessage` 入口必须以 generation 计数器保护的互斥守卫防止并发进入：新 turn 递增 generation 并记录自身 generation；turn 结束时仅当 generation 匹配才释放 loading 状态；`abortAIMessage` 递增 generation 使被中断的旧 turn 末尾释放失效。
- `setIsLoading(false)` 必须在 `sendAIMessage` 的所有清理逻辑（session 保存、Stop hooks、通知排空）完成后才执行，而非清理逻辑中间，消除"已 idle 但 turn 未结束"的窗口。
- 用户中断（`abortMessage`）不得丢弃已入队的后台任务通知（clear 仅移除用户消息和 bang 命令，保留 notification 项），确保后台任务结果不会因中断而丢失。
- stdio 协议必须支持 `backgroundTasksChange` 服务端→客户端通知，携带后台任务摘要列表；每个摘要含 `id`、`type`、`status`、`startTime`、`endTime?`、`command?`、`description?`、`exitCode?`、`runtime?`、`outputPath?`，**不含** `stdout`/`stderr` 全文与不可序列化的 `process`/`onStop`，以控制通知体积。
- AgentBridge 必须将 `AgentCallbacks.onBackgroundTasksChange` 回调转发为 `backgroundTasksChange` 通知，并对每个任务做序列化裁剪（移除 `process`/`onStop`，剥离 `stdout`/`stderr` 全文）。
- stdio 协议必须支持 `getBackgroundTaskOutput` 请求方法，携带 `taskId` 参数，调用 `Agent.getBackgroundTaskOutput(taskId)`，返回 `{ stdout, stderr, status, outputPath?, type, exitCode? } | null`，供详情视图按需获取输出。
- stdio 协议必须支持 `stopBackgroundTask` 请求方法，携带 `taskId` 参数，调用 `Agent.stopBackgroundTask(taskId)`，返回 `{ success: boolean }`。
- 当用户在 IDE 输入 `/tasks` 时，插件必须将其识别为本地命令并打开后台任务管理对话框，而非通过 `sendMessage` 将文本作为普通消息发送给模型。
- IDE 插件（VS Code 扩展与 JetBrains 插件）的 stdio 客户端必须订阅 `backgroundTasksChange` 通知，缓存任务列表，并通过 webview 消息 `updateBackgroundTasks` 推送给 webview。
- webview 必须实现 `BackgroundTaskManager` 对话框组件，包含列表视图（id/类型/状态/描述/运行时长）与详情视图（stdout/stderr/退出码/日志路径），交互与字段与 CLI `BackgroundTaskManager.tsx` 保持一致（选择→详情、停止、关闭）。
- webview 详情视图必须通过 `getBackgroundTaskOutput` 请求按需获取输出，不在列表通知中携带全文 stdout/stderr。
- webview 必须提供停止按钮，通过 `stopBackgroundTask` 请求终止选中的运行中任务。
- 前台工具后台化（CLI 的 Ctrl-B）不在本迭代范围；IDE 插件仅支持查看与终止已有后台任务。
- 每个 Agent 与 subagent 的 DI 容器必须注册独立、会话级的 `MessageQueue` 实例。`SubagentManager.createInstance()` 创建子容器时必须为该 subagent 注册独立的 `MessageQueue`，子容器不得通过 `Container.get()`/`has()` 的 parent 回退继承主 Agent 的 `MessageQueue`。
- subagent 的 AIManager 回合末通知排空（`drainNotifications`）必须仅作用于其自身容器的 `MessageQueue`；不得抽干主 Agent 的 `MessageQueue`，不得将兄弟 subagent 的完成通知注入自身会话、不得因此重新唤起自身回合（`shouldRestart`）。
- 后台 subagent 完成通知必须投递到创建它的主 Agent 的 `MessageQueue`（由 `SubagentManager` 使用主容器入队），并仅由主 Agent 的 AIManager 回合末排空消费；兄弟 subagent 不得消费该通知。
- 必须提供并发集成测试：并行启动至少 5 个后台 subagent，断言每个 `taskId` 恰好一次出现在主 Agent transcript、且不出现在任何兄弟 subagent transcript；并断言 print 模式（`wave -p`）在收齐全部通知并生成最终响应后才退出（exit 0）。

### 关键实体 *（如果功能涉及数据则包含）*

- **Task**：代表一个执行单元（shell 命令或 agent 子任务）。
    - 属性：`task_id`（唯一标识符）、`status`（pending、running、completed、failed、stopped）、`output`（累积的日志/结果）、`type`（shell、agent）、`outputPath`（可选的实时日志文件路径）。
- **TaskNotificationBlock**：代表聊天中后台任务完成通知的结构化消息块。
    - 属性：`taskId`、`taskType`（"shell" | "agent"）、`status`（"completed" | "failed" | "killed"）、`summary`、`outputFile?`（用于 shell 任务）。
    - 发送到 AI API 时序列化为 XML（`<task-notification>...</task-notification>`）。
    - 在 CLI UI 中渲染为紧凑的状态行（彩色点 + 摘要）。
