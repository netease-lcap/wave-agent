# 功能规格说明：支持计划模式

**特性分支**：`036-plan-mode`
**创建日期**：2026-01-19

## 用户场景与测试 *（必填）*

### 用户故事 1 - 切换到计划模式（优先级：P1）

作为用户，我希望将系统切换到"计划模式"，以便我可以让 LLM 分析代码库并提出计划，而不会意外修改任何文件。

**为什么是这个优先级**：这是功能的核心，允许用户安全地探索和规划复杂更改。

**独立测试**：可以通过按 Shift+Tab 并验证系统进入计划模式且新计划文件被创建来测试。

**验收场景**：

1. **假设**系统处于 "default" 模式，**当**用户按下 Shift+Tab 时，**则**系统切换到 "acceptEdits" 模式。
2. **假设**系统处于 "acceptEdits" 模式，**当**用户按下 Shift+Tab 时，**则**系统切换到 "plan" 模式。
3. **假设**系统处于 "plan" 模式，**当**用户按下 Shift+Tab 时，**则**系统切换回 "default" 模式（除非启动时启用了 `bypassPermissions`）。
4. **假设**系统启动时带有绕过标志，**当**用户处于 "plan" 模式并按下 Shift+Tab 时，**则**系统切换到 "bypassPermissions" 模式。
5. **假设**系统切换到 "plan" 模式，**当**模式活动时，**则**在 `~/.wave/plans/` 中确定带有随机英文名称的计划文件路径。
6. **假设**系统处于 "plan" 模式，**当** LLM 在指定计划文件上使用 `Write` 或 `Edit` 工具时，**则**操作被允许。
7. **假设**系统处于 "plan" 模式，**当**用户查看 UI 时，**则**有清晰的视觉指示器表明计划模式已激活。

---

### 用户故事 2 - 计划模式中的规划和限制（优先级：P1）

作为用户，我希望 LLM 在计划模式下只能编辑计划文件，以便我的代码库在规划阶段保持不变。

**为什么是这个优先级**：这确保规划过程中代码库的安全性和完整性。

**独立测试**：可以通过在计划模式下尝试编辑非计划文件并验证它被阻止来测试。

**验收场景**：

1. **假设**系统处于 "plan" 模式，**当** LLM 尝试读取文件时，**则**操作被允许。
2. **假设**系统处于 "plan" 模式，**当** LLM 尝试编辑指定计划文件以外的文件时，**则**操作被阻止。
3. **假设**系统处于 "plan" 模式，**当** LLM 尝试执行 bash 命令时，**则**操作被允许。
4. **假设**系统处于 "plan" 模式，**当** LLM 编辑计划文件时，**则**操作被允许。

---

### 用户故事 3 - 系统提示引导（优先级：P2）

作为用户，我希望 LLM 被明确告知在计划模式下如何行为，以便它有效地使用计划文件。

**为什么是这个优先级**：确保 LLM 理解其约束和预期工作流。

**独立测试**：可以通过检查计划模式活动时发送给 LLM 的系统提示来测试。

**验收场景**：

1. **假设**系统处于 "plan" 模式，**当**消息发送到主 agent 时，**则**提醒包含计划文件信息并指示 agent 通过写入或编辑计划文件来增量构建计划。
2. **假设**系统处于 "plan" 模式，**当**消息发送到子 agent 时，**则**提醒告诉子 agent 以文本输出形式返回发现，并且不指示它写入或编辑计划文件（因为子 agent 缺少 Write/Edit 工具）。

---

### 用户故事 4 - 通过 ExitPlanMode 批准计划（优先级：P1）

作为计划模式中的 agent，我希望在完成将计划写入指定计划文件后使用 `ExitPlanMode` 工具，以便用户可以审查该文件中的计划内容并提供批准或反馈。

**为什么是这个优先级**：这是请求的核心功能。它基于实际计划文件内容，在用户监督下实现从规划到执行的过渡。

**独立测试**：可以通过将 agent 置于计划模式、将计划写入文件、调用 `ExitPlanMode` 并验证用户看到计划文件内容并被提示确认来测试。

**验收场景**：

1. **假设** agent 处于计划模式并已写入计划到指定文件，**当** agent 调用 `ExitPlanMode` 时，**则**用户看到计划文件的内容，并通过标准 `canUseTool` 机制被提示确认，提供三个选项（可通过方向键导航）。
2. **假设**用户正在审查文件中的计划，**当**用户选择 "Default" 时，**则**工具成功，agent 退出计划模式进入默认执行状态。
3. **假设**用户正在审查文件中的计划，**当**用户选择 "Accept Edits" 时，**则**工具成功，agent 退出计划模式进入后续编辑自动接受的状态。
4. **假设**用户正在审查文件中的计划，**当**用户选择 "Tell agent what to do" 时，**则**用户提供反馈，工具将此反馈返回给 agent，agent 保持在计划模式中以优化计划。

---

### 边界情况

- **目录创建**：如果 `~/.wave/plans` 不存在，系统应该自动创建。
- **名称冲突**：随机英文名称生成器应该最小化冲突的可能性，但如果文件已存在，应该处理（如生成新名称）。
- **会话持久化**：如果会话重启或消息被压缩，系统必须重用现有的计划文件路径。这通过使用 `rootSessionId`（链中第一个会话的 ID）作为确定性名称生成的种子来实现。
- **`ExitPlanMode` 在计划模式外被调用怎么办？** `ExitPlanMode` 工具始终在工具列表中可见。当 agent 不在计划模式时，工具通过运行时守卫返回错误信息。
- **系统如何处理多次调用 `ExitPlanMode`？** 如果已在退出中或第一次调用待处理，后续调用应该被优雅地处理（如忽略或返回为待处理）。

### 用户故事 5 - 计划模式重新进入引导（优先级：P1）

作为之前已退出计划模式的用户，我希望系统在我重新进入计划模式时能够识别，以便 agent 知道现有计划文件并可以决定继续还是重新开始。

**为什么是这个优先级**：没有重新进入引导，agent 可能忽略现有计划文件或假设它仍然相关，导致工作浪费或计划不正确。

**独立测试**：进入计划模式，写入计划，批准 ExitPlanMode，重新进入计划模式，验证 agent 收到关于现有计划文件的重新进入提醒。

**验收场景**：

1. **假设** agent 已退出计划模式且计划文件存在，**当**用户重新进入计划模式时，**则**注入重新进入 `<system-reminder>`，指示模型读取现有计划、评估任务是否相同或不同，并在 ExitPlanMode 之前始终编辑计划文件。
2. **假设** agent 已退出计划模式但没有计划文件存在，**当**重新进入计划模式时，**则**不注入重新进入提醒（视为首次进入）。
3. **假设**重新进入提醒已注入一次，**当**计划模式中后续轮次发生时，**则**重新进入提醒不再被注入（仅一次）。

---

### 用户故事 6 - 模式转换意识（优先级：P1）

作为在对话中途从 default/acceptEdits 模式切换到计划模式的用户，我希望 agent 立即理解它必须停止编辑并切换到规划，即使对话历史包含最近的 Edit/Write 工具调用。

**为什么是这个优先级**：没有模式边界意识，模型可能基于最近的工具调用历史继续编辑，忽略计划模式约束。

**独立测试**：进行包含 Edit/Write 调用的对话，然后进入计划模式，验证计划模式提醒作为最后一条指令出现，带有明确的覆盖语言。

**验收场景**：

1. **假设**对话包含最近的 Edit/Write 工具调用且用户进入计划模式，**当**下一次 API 调用发生时，**则**计划模式 `<system-reminder>` 作为模型看到的最后一条指令注入（在所有先前的工具调用之后），明确声明 "This supercedes any other instructions you have received."
2. **假设** agent 处于计划模式，**当** agent 尝试在计划文件以外的任何文件上使用 Edit 或 Write 时，**则**权限系统在运行时阻止该操作。

---

### 用户故事 7 - 计划模式退出通知（优先级：P2）

作为刚刚批准计划的用户，我希望 agent 被明确告知已退出计划模式并可以执行操作，以便对模式转换没有混淆。

**为什么是这个优先级**：防止 agent 在批准后继续表现得像仍在计划模式中。

**独立测试**：批准 ExitPlanMode 并验证"已退出计划模式"的 system-reminder 出现在下一个轮次。

**验收场景**：

1. **假设** ExitPlanMode 被批准，**当**下一个 API 轮次开始时，**则**注入"已退出计划模式"的 `<system-reminder>` 作为一次性消息。
2. **假设**退出通知已注入，**当**后续轮次开始时，**则**退出通知不再被注入（仅一次）。

---

### 用户故事 8 - 一次性计划进入提醒（优先级：P2）

作为进入计划模式的用户，我希望 agent 在进入计划模式并发送消息时恰好收到一次计划模式指令，以便 token 不会浪费在重复提醒上。

**为什么是这个优先级**：之前的节流机制（扫描消息中的元提醒）已损坏——提醒是临时的，从未存储，所以节流从未触发，每次 AI 调用都注入完整的约 90 行提醒。简化方法在每次计划模式进入时恰好触发一次提醒。

**独立测试**：进入计划模式，发送消息，验证提醒出现。发送另一条消息，验证没有提醒。退出并重新进入计划模式，验证提醒再次出现。

**验收场景**：

1. **假设**用户进入计划模式，**当**第一条消息发送时，**则**注入完整的计划模式 `<system-reminder>`（包括 5 阶段工作流）。
2. **假设**计划进入提醒已注入，**当**同一计划模式会话中发送后续消息时，**则**不注入计划模式提醒。
3. **假设**用户退出计划模式并重新进入，**当**下一条消息发送时，**则**注入重新进入提醒（关于读取现有计划文件的小提醒）。

### 用户故事 9 - 通过 EnterPlanMode 工具进入计划模式（优先级：P1）

作为 AI agent，我希望在判断任务较为复杂时主动请求进入计划模式，以便在修改多文件、开发新功能或修复复杂 bug 之前先制定计划。

**为什么是这个优先级**：允许 agent 自主判断何时需要规划，提升复杂任务的处理质量，同时通过用户确认保持人类监督。

**独立测试**：在对话中让 agent 判断任务复杂性，验证其调用 `EnterPlanMode` 工具后触发用户确认，批准后进入计划模式。

**验收场景**：

1. **假设** agent 判断当前任务较为复杂（多文件更改、新功能、复杂 bug 修复），**当** agent 调用 `EnterPlanMode` 工具时，**则**系统通过 `canUseTool` 机制向用户显示确认请求，用户批准后系统进入计划模式。
2. **假设** agent 调用 `EnterPlanMode`，**当**用户拒绝确认请求时，**则**agent 收到 "User declined to enter plan mode. Proceed in current mode." 的返回信息，继续在当前模式中执行。
3. **假设** agent 已在计划模式中，**当** agent 调用 `EnterPlanMode` 时，**则**工具返回错误信息 "Already in plan mode"，不重复进入。
4. **假设** agent 调用 `EnterPlanMode` 触发用户确认，**当**确认对话框显示时，**则**不得显示"始终允许"选项（`hidePersistentOption = true`）。

---

## 需求 *（必填）*

### 功能需求

- **FR-001**：系统必须支持 "plan" 权限状态。
- **FR-002**：用户必须能够使用 Shift+Tab 键盘快捷键按以下顺序切换权限模式：default -> acceptEdits -> bypassPermissions -> plan -> default。
- **FR-002.1**：`bypassPermissions` 必须仅在会话以 `--dangerously-skip-permissions` 或 `--permission-mode bypassPermissions` 启动时才包含在循环中。
- **FR-003**：在计划模式时，系统必须将 LLM 限制为对所有文件的只读操作，指定计划文件除外。
- **FR-004**：在计划模式时，系统必须允许 LLM 执行命令。
- **FR-005**：当计划模式激活时，系统必须在 `~/.wave/plans/` 中确定计划文件路径，使用人类可读的名称（形容词-名词格式）。此名称必须通过使用 `rootSessionId` 作为种子在会话链中保持确定性，确保即使消息压缩或会话恢复后也重用相同的计划文件。
- **FR-006**：当计划模式活动时，系统必须将 `<system-reminder>` 包装的用户消息（isMeta: true）注入对话消息中。这通过保持系统提示跨模式变化不变来保护提示缓存。提醒内容取决于接收者：
  - **主 agent**：提醒必须包含计划文件信息并指示 agent 通过写入或编辑计划文件来增量构建计划：
    ```text
    Plan mode is active. ... you MUST NOT make any edits (with the exception of the plan file mentioned below) ...

    ## Plan File Info:
    ${planFileInfo}
    You should build your plan incrementally by writing to or editing this file. NOTE that this is the only file you are allowed to edit - other than this is the only allowed to take READ-ONLY actions.
    ```
  - **子 agent**：提醒不得指示子 agent 写入或编辑计划文件，因为子 agent（特别是 Plan 子 agent）无法访问 Write/Edit 工具。相反，它必须告诉子 agent 以文本输出形式返回发现，父 agent 将写入计划文件。子 agent 提醒可以在文件已存在时包含计划文件路径以供读取上下文：
    ```text
    Plan mode is active. ... your role is to explore the codebase and return your findings as text output. Do NOT attempt to write or edit any files — the parent agent will write the plan file based on your text response.

    ## Plan File Info:
    ${subagentPlanFileInfo}
    ```
- **FR-007**：系统必须确保在创建计划文件之前 `~/.wave/plans/` 目录存在。
- **FR-008**：系统必须向用户提供指示当前权限模式的视觉反馈。
- **FR-009**：系统必须提供名为 `ExitPlanMode` 的工具。
- **FR-009.1**：工具描述必须包含："Use this tool when you are in plan mode and have finished writing your plan to the plan file and are ready for user approval."
- **FR-009.2**：工具文档必须解释 agent 应该已经将计划写入系统消息中指定的文件，并且该工具不接受计划内容作为参数。
- **FR-010**：`ExitPlanMode` 工具必须触发向用户的确认请求，提供三个特定选择：
    - **选项 1：Default**：退出计划模式并以标准执行继续。
    - **选项 2：Accept Edits**：退出计划模式并以编辑自动接受的模式继续。
    - **选项 3：Feedback**：向 agent 提供指令/反馈并保持在计划模式中。
- **FR-011**：确认请求必须重用现有的 `canUseTool` 机制，必要时扩展它以支持这三种特定响应类型。
- **FR-011.1**：系统必须在确认过程中向用户显示计划文件的内容。
- **FR-012**：用户选择 "Default" 或 "Accept Edits" 后，系统必须将 agent 从 "plan mode" 转换到相应的目标模式。
- **FR-013**：用户选择 "Feedback" 后，agent 必须保持在 "plan mode" 中并接收用户输入作为工具的输出。
- **FR-014**：`ExitPlanMode` 工具必须始终在工具列表中可见，无论当前权限模式如何。当 agent 不在计划模式时，工具通过运行时守卫返回错误信息。
- **FR-015**：当 `permissionMode` 设置为 `bypassPermissions` 时，`ExitPlanMode` 不得可用。
- **FR-016**：当通过 ACP 桥接使用时，`ExitPlanMode` 可以提供简化的审批流程（如 "Approve Plan" 和 "Reject Plan"）并在批准后自动转换到 `default` 模式。
- **FR-017**：系统必须跟踪 `hasExitedPlanMode` 状态。当 agent 退出计划模式（通过 ExitPlanMode 或模式转换）时，此标志必须设置为 true。
- **FR-018**：当进入计划模式且 `hasExitedPlanMode` 为 true 且计划文件已存在时，系统必须注入重新进入 `<system-reminder>` 消息，指示模型：(a) 读取现有计划文件，(b) 评估用户请求是新任务还是继续，(c) 在调用 ExitPlanMode 之前始终编辑计划文件。标志必须在注入后清除（一次性）。
- **FR-019**：当计划模式活动时，系统必须在每次进入时恰好注入一次计划模式提醒——在进入计划模式后的第一次 AI 调用时。`PlanManager` 跟踪 `planEntryReminderPending` 标志，在进入计划模式时设置为 `true`，在提醒注入后消费（设置为 `false`）。后续轮次不注入重复或节流提醒。
- **FR-020**：退出计划模式时，系统必须在下一个轮次注入一次性"已退出计划模式" `<system-reminder>` 消息，通知模型现在可以进行编辑和执行操作。如果计划文件存在，消息必须包含计划文件路径以供参考。
- **FR-021**：所有计划模式 `<system-reminder>` 消息必须使用 `isMeta: true` 且不得在 UI 中渲染。
- **FR-022**：压缩后，如果计划模式活动，初始提醒中的计划模式指令保留在压缩摘要中。不需要重新注入，因为提醒是每次进入一次性的。
- **FR-023**：`hasExitedPlanMode` 标志必须在 `PermissionManager` 中跟踪，并在同一会话内的模式转换中持久化。
- **FR-024**："需要计划模式退出附件"标志（`needsPlanModeExitAttachment`）必须在离开计划模式时设置，并在退出 `<system-reminder>` 注入后清除（一次性）。
- **FR-025**：系统必须提供名为 `EnterPlanMode` 的工具，允许 agent 主动请求进入计划模式。
- **FR-026**：`EnterPlanMode` 工具必须通过 `canUseTool` 机制触发用户确认请求。确认请求不得显示"始终允许"选项（`hidePersistentOption = true`）。
- **FR-027**：用户批准 `EnterPlanMode` 后，系统必须通过 `requestPermissionModeChange("plan")` 执行完整的模式转换，包括：(a) 更新权限模式容器注册，(b) 调用 `planManager.handlePlanModeTransition()` 管理计划文件生命周期，(c) 触发 UI 回调通知界面更新。
- **FR-028**：`EnterPlanMode` 工具必须始终在工具列表中可见（不在 plan mode 时通过运行时守卫拒绝执行），而非根据模式动态添加/移除。
- **FR-029**：当 agent 已在计划模式中调用 `EnterPlanMode` 时，工具必须返回错误而非重复进入。
- **FR-030**：权限模式转换必须通过 `requestPermissionModeChange()` 方法执行（而非直接调用 `setPermissionMode()`），以确保计划模式生命周期管理（计划文件创建/清理、提醒注入标志）和 UI 通知的完整性。

### 关键实体

- **权限模式**：表示系统当前的限制级别（如 default、plan）。
- **计划文件**：位于 `~/.wave/plans/` 中的 Markdown 文件，LLM 在计划模式期间用于记录其计划。
- **计划模式状态**：agent 生命周期中生成或提议一系列操作的状态。
- **ExitPlanMode 工具**：用于从计划模式状态转换出来的特定工具。
- **EnterPlanMode 工具**：允许 agent 主动请求进入计划模式的特定工具。
