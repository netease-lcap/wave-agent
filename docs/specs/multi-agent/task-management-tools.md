---
name: "任务管理工具"
description: "TaskCreate/TaskGet/TaskUpdate/TaskList，`~/.wave/tasks/` 存储和任务列表 UI"
order: 70
---

# 功能规格说明：任务管理工具与 UI

**特性分支**：`task-management-tools`
**创建日期**：2026-02-11

## 用户场景与测试 *（必填）*

### 用户故事：创建和跟踪任务（优先级：P1）

作为用户，我希望创建一个新任务，以便跟踪我在特定目标上的进度。

**为什么是这个优先级**：这是核心功能。没有任务创建，其他工具就没有数据可以操作。

**独立测试**：可以通过调用 TaskCreate 并验证在正确目录中创建了具有预期内容的 JSON 文件来进行完整测试。

**验收场景**：

1. **假设**会话处于活动状态，**当**我使用主题和描述调用 TaskCreate 时，**则**创建一个具有唯一 ID 的新任务并存储在 `~/.wave/tasks/{taskListId}/{taskId}.json` 中。
2. **假设**任务已创建，**当**我使用 taskId 调用 TaskGet 时，**则**我收到该任务的完整详情。

---

### 用户故事：更新任务进度（优先级：P2）

作为用户，我希望更新任务状态并添加评论，以便保持我的进度记录为最新。

**为什么是这个优先级**：任务管理是动态的；能够更新状态和添加注释对于跟踪工作进度至关重要。

**独立测试**：可以通过对现有任务调用 TaskUpdate 然后通过 TaskGet 验证更改或检查 JSON 文件来进行测试。

**验收场景**：

1. **假设**存在一个现有任务，**当**我使用新状态（例如"in_progress"、"completed"）调用 TaskUpdate 时，**则**任务的状态在存储中被更新。
2. **假设**存在一个现有任务，**当**我使用元数据或描述更改调用 TaskUpdate 时，**则**任务被相应更新。

---

### 用户故事：列出所有任务（优先级：P3）

作为用户，我希望看到当前会话的所有任务列表，以便获得工作概览。

**为什么是这个优先级**：提供跨多个任务的可见性，这对于管理复杂工作流很重要。

**独立测试**：可以通过创建多个任务并调用 TaskList 来确保所有任务都被返回来进行测试。

**验收场景**：

1. **假设**当前任务列表存在多个任务，**当**我调用 TaskList 时，**则**我收到所有任务的摘要列表，包括其 ID、主题和当前状态。

---

### 用户故事：在聊天 UI 中查看任务列表（优先级：P1）

作为用户，我希望在消息列表底部看到当前任务的摘要，以便始终跟踪进度而无需手动列出任务。

**为什么是这个优先级**：这在对话流程中提供对任务状态的即时可见性。

**独立测试**：可以通过创建任务并验证任务列表组件出现在聊天界面底部来进行测试。

**验收场景**：

1. **假设**当前会话中有活动任务，**当**我查看消息列表时，**则**任务列表摘要显示在底部。
2. **假设**任务列表已显示，**当**任务状态更改时，**则**任务列表 UI 更新以反映新状态。
3. **假设**一个已保存会话的任务全部处于已完成状态，**当**我打开或切换到该会话时，**则**任务列表立即保持隐藏，不会先短暂显示再于数秒后消失。

---

### 用户故事：废弃遗留 TodoWrite 工具（优先级：P4）

作为系统维护者，我希望移除遗留的 TodoWrite 工具，以便 agent 专门使用新的任务管理系统。

**为什么是这个优先级**：确保向新系统的平稳过渡，并防止旧任务管理方法与新方法之间的混淆。

**独立测试**：验证 `TodoWrite` 不再出现在 agent 的工具集中。

**验收场景**：

1. **假设** agent 已初始化，**当**我列出可用工具时，**则** `TodoWrite` 不在列表中。

---

### 用户故事：任务提醒注入（优先级：P3）

作为系统，我必须定期提醒 agent 使用任务跟踪工具，以确保 agent 不会遗忘对任务进度的管理。

**为什么是这个优先级**：任务提醒是辅助性功能，提升 agent 自主管理任务的意识，但不影响核心任务 CRUD 操作。

**独立测试**：可以通过模拟连续 10 个 assistant turn 不使用 TaskCreate/TaskUpdate，然后验证下一次 API 调用中注入了提醒消息来进行测试。

**验收场景**：

1. **假设**会话处于活动状态且 TaskCreate/TaskUpdate 工具可用，**当**连续 10 个 assistant turn 未调用 TaskCreate 或 TaskUpdate，且距上次提醒也已过去至少 10 个 assistant turn 时，**则**系统在下一次 API 调用中注入一条 user 消息形式的任务提醒，并将该提醒持久化到会话历史中作为 `isMeta: true` 消息，确保后续轮次的计数器能检测到该提醒。
2. **假设**提醒已注入，**当** agent 收到提醒时，**则**提醒内容指示 agent 不得向用户提及该提醒的存在。
3. **假设**当前存在活动任务，**当**提醒触发时，**则**提醒消息末尾附加当前任务列表，格式为 `#id [status] subject`。
4. **假设**当前任务列表为空，**当**提醒触发时，**则**提醒消息仍然注入，作为通用提醒，不包含任务列表。
5. **假设** agent 调用了 TaskCreate 或 TaskUpdate，**当**工具执行完成后，**则** `turnsSinceLastTaskManagement` 计数器重置为 0。
6. **假设** agent 调用了 TaskList 或 TaskGet（只读工具），**当**工具执行完成后，**则** `turnsSinceLastTaskManagement` 计数器**不**被重置。

---

### 边界情况

- **任务 ID 不存在时会发生什么？** TaskGet 和 TaskUpdate 应返回清晰的错误消息，指示任务未找到。
- **系统如何处理无效的状态转换？** 系统应验证提供的状态是允许值之一。
- **如果存储目录不可写会怎样？** 工具应优雅地处理文件系统错误。
- **任务很多时会发生什么？** `TaskManager.listTasks()` 始终按 ID 升序返回；TaskList 组件在此稳定顺序之上，使用终端自适应显示限制、优先级排序、折叠摘要和自动隐藏已完成任务来处理长任务列表。
- **如果 TaskCreate/TaskUpdate 工具不可用会怎样？** 系统必须完全跳过任务提醒注入，不发送任何提醒消息。
- **如果任务列表为空会怎样？** 提醒仍然触发，作为通用提醒鼓励 agent 使用任务跟踪，但不附加任务列表。
- **并发创建任务时会发生什么？** 系统使用会话级排他文件锁串行化"读取最大 ID + 写入任务文件"这一临界区，确保并发 `TaskCreate` 调用获得唯一递增 ID，不会产生重复或冲突。
- **进程在持有锁时崩溃会怎样？** 后续获取者检测到锁文件 mtime 超过陈旧阈值（10 秒）时，判定持有者已不活跃，将其删除后重试，不会因遗留锁文件而永久卡死。
- **Windows 上释放锁后立即重新获取会怎样？** Windows 文件系统在删除文件后存在 pending-delete 窗口，此时以 `wx` 方式打开可能返回 `EPERM` 而非 `EEXIST`；系统将 `EPERM` 视为瞬时错误进行有界重试，而非硬失败。

## 需求 *（必填）*

### 功能需求

- 系统必须提供 `TaskCreate` 工具，接受 `subject`、`description`、`activeForm` 和可选的 `metadata`。
- 系统必须将任务存储为 `~/.wave/tasks/{taskListId}/{taskId}.json` 中的 JSON 文件。
- 系统必须提供 `TaskGet` 工具来检索特定 `taskId` 的所有信息。
- 系统必须提供 `TaskUpdate` 工具，允许使用 `taskId` 更新 `status`、`subject`、`description`、`activeForm`、`owner` 和 `metadata`。
- 系统必须允许通过 `TaskUpdate` 中的 `addBlocks` 和 `addBlockedBy` 管理任务依赖关系。
- 系统必须提供 `TaskList` 工具，返回与当前 `taskListId` 关联的所有任务。
- 任务必须包含字段：`taskId`、`subject`、`description`、`status`、`activeForm`、`owner`、`blocks`、`blockedBy` 和 `metadata`。
- 如果目录结构不存在，系统必须自动创建必要的目录结构。
- 系统必须移除 `TodoWrite` 工具的定义和实现。
- 系统必须使用 `WAVE_TASK_LIST_ID` 或 `rootSessionId` 确定 `taskListId`。
- 系统必须在 CLI 消息列表底部渲染任务列表组件。
- 任务列表标题必须包含可见性切换提示：`(Ctrl+T to hide)`。
- 列表中的每个任务必须显示其当前状态和主题。
- 任务列表必须在任务创建或更新时自动更新。
- 任务列表必须与"后台任务"（运行中的进程）区分开。
- TaskList 组件必须显示标题行，包含总任务数和分类：`N tasks (N done, N in progress, N open)`。
- TaskList 组件必须使用终端自适应显示限制：`Math.min(8, Math.max(3, rows - 12))`，其中 `rows` 来自 Ink 的 `useStdout()`。
- 当任务超过显示限制时，组件必须按优先级排序：最近完成（<30秒）→ in_progress → pending（未阻塞优先）→ pending 已阻塞 → 较早完成 → deleted。
- 当任务被显示限制隐藏时，组件必须显示折叠摘要行：`+N in progress, M pending, K completed`。
- TaskList 组件必须在所有活动任务完成后 5 秒自动隐藏，并在新非完成任务添加时重新出现；但打开或切换到任务已全部完成的会话时，任务列表必须立即保持隐藏，不得先短暂显示再消失（5 秒宽限仅适用于任务在用户当前观看期间变为全部完成的情况）。
- 任务主题文本必须使用 `wrap="truncate-end"` 来优雅地处理长主题。
- 组件必须通过 taskId → 完成时间戳的 ref map 跟踪最近完成的任务（30秒内），过期条目被修剪以触发重新渲染。
- 系统必须在每个 assistant turn 后追踪自上次 TaskCreate 或 TaskUpdate 调用以来的 turn 数（`turnsSinceLastTaskManagement`）。
- 系统必须在每个 assistant turn 后追踪自上次提醒注入以来的 turn 数（`turnsSinceLastReminder`）。
- 当 `turnsSinceLastTaskManagement >= 10` **且** `turnsSinceLastReminder >= 10` 同时满足时，系统必须在 API 调用中注入一条 user 消息形式的任务提醒。
- 只有 `TaskCreate` 和 `TaskUpdate` 工具调用必须重置 `turnsSinceLastTaskManagement` 计数器；只读工具（`TaskList`、`TaskGet`）不得重置该计数器。
- 当任务列表非空时，提醒消息末尾必须附加当前任务列表，格式为 `#id [status] subject`（每个任务一行）。
- 当任务列表为空时，提醒消息必须仍然注入，作为通用提醒鼓励 agent 使用任务跟踪功能，但不附加任务列表。
- 提醒消息的文本必须明确指示 agent 不得向用户提及该提醒的存在。
- 任务提醒必须持久化到会话历史中作为 `isMeta: true` 用户消息，确保轮次计数器能找到之前的提醒标记（`<!-- task-reminder -->`），避免每轮重复注入。
- 如果 TaskCreate 和 TaskUpdate 工具不在当前 agent 的可用工具集中，系统必须完全跳过任务提醒逻辑，不注入任何提醒消息。
- `TaskManager.listTasks()` 必须按任务 ID 升序返回任务，作为所有消费方（CLI、webview、SDK 内部）的唯一稳定排序来源。ID 为纯数字时按数值升序（即创建顺序，因 `getNextTaskId` 保证 ID 递增）；含非数字 ID 时回退字典序（`localeCompare`）。排序在 SDK 层完成，前端/CLI 不再重复排序。
- `TaskManager.createTask`/`updateTask`/`deleteTask` 必须通过会话级排他文件锁（`~/.wave/tasks/{taskListId}/.lock`）串行化临界区（读取当前最大 ID + 写入任务文件），防止并发 `TaskCreate` 产生重复 ID。
- 锁获取失败时，系统必须对瞬时错误进行有界重试。瞬时错误包括 `EEXIST`（锁已被持有）与 `EPERM`（Windows pending-delete 窗口或安全软件占用文件）；真实权限错误（`EACCES`）或父目录缺失（`ENOENT`）不得被当作可重试的锁竞争。
- 遇到 `EEXIST` 时，系统检查锁文件 mtime；若距当前时间超过陈旧阈值（10000 毫秒，与 Claude Code 的 proper-lockfile 默认值对齐），判定为陈旧锁并删除后重试获取，否则等待后重试。锁文件保持空（不写入持有者标识），陈旧判定仅依据文件年龄。

### 关键实体 *（如果功能涉及数据则包含）*

- **Task**：代表单个的工作单元。
  - **taskId**：唯一标识符（字符串）。
  - **subject**：简短标题（字符串）。
  - **description**：详细需求（字符串）。
  - **status**：当前状态（枚举：`pending`、`in_progress`、`completed`、`deleted`）。
  - **activeForm**：用于显示的现在进行时形式（字符串）。
  - **owner**：分配的 agent 或用户（字符串，可选）。
  - **blocks**：依赖于此任务的任务 ID 列表（字符串数组）。
  - **blockedBy**：此任务依赖的任务 ID 列表（字符串数组）。
  - **metadata**：任意键值对（对象）。
- **Task List**：任务的分组机制，由 `taskListId` 标识。
