---
name: "钩子系统"
description: "扩展 Wave 行为的事件钩子系统"
order: 10
---

# 功能规格说明：Hooks 支持

**创建日期**：2024-12-19

## Hook 输出

Hook 有两种方式将输出返回给 Wave Agent。输出传达是否阻止以及任何应反馈给 Wave 和用户的信息。

### 简单方式：退出码

Hook 通过退出码、stdout 和 stderr 传达状态：

- **退出码 0**：成功。stdout 仅在 `UserPromptSubmit` 时添加到上下文中。
- **退出码 2**：阻止性错误。`stderr` 反馈给 Wave 进行自动处理。参见下方各 hook 事件的行为。
- **其他退出码**：非阻止性错误。`stderr` 显示给用户，执行继续。

::: warning
提醒：如果退出码为 0，Wave Agent 不会看到 stdout，除了 `UserPromptSubmit` hook 的 stdout 会作为上下文注入。
:::

#### 退出码 2 行为

| Hook 事件           | 行为                                                                                                                      |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `PreToolUse`        | 阻止工具调用，向 Wave 显示 stderr                                                                                         |
| `PostToolUse`       | 向 Wave 显示 stderr 并允许 AI 继续（工具已执行）                                                                          |
| `UserPromptSubmit`  | 阻止提示处理，清除提示，仅向用户显示 stderr                                                                               |
| `Stop`              | 阻止停止（AI 继续对话），向 Wave 显示 stderr                                                                              |
| `SubagentStop`      | 阻止停止（子代理继续），向 Wave 显示 stderr                                                                               |
| `PermissionRequest` | 阻止（拒绝）权限，仅向用户显示 stderr                                                                                     |
| `WorktreeCreate`    | 接管创建（Path return）：stdout 输出 worktree path；所有 hook 均失败或无输出时创建被阻止                                  |
| `WorktreeRemove`    | 接管 hook-based worktree 的删除（wave 不执行 `git worktree remove`）；失败仅记录（非阻止），worktree 是否残留由 hook 负责 |
| `PreCompact`        | 非阻止；stderr 不显示给用户（静默丢弃），压缩继续                                                                         |
| `PostCompact`       | 仅向用户显示 stderr（非阻止）                                                                                             |

## 用户场景与测试 _（必填）_

### 用户故事：配置 Hook 进行代码质量检查（优先级：P1）

作为开发者，我希望配置在文件编辑操作后自动运行代码质量检查的 hook，以便无需手动干预即可维护一致的代码标准。

**为什么是这个优先级**：这是 hook 最常见的用例——自动化质量保证。它通过在开发过程早期发现问题来提供即时价值。

**独立测试**：可以通过为 Edit 操作配置 PostToolUse hook、编辑文件并验证质量检查命令执行并提供反馈来完整测试。

**验收场景**：

1. **假设**项目配置了 PostToolUse Edit 操作的 hook，**当**我使用 Edit 工具编辑文件时，**则**配置的代码质量脚本自动执行
2. **假设**同一事件配置了多个 hook，**当**触发事件发生时，**则**所有匹配的 hook 按定义顺序执行
3. **假设**hook 命令失败，**当**hook 执行时，**则**失败被记录但不中断主工具操作

---

### 用户故事：在处理前验证用户提示（优先级：P2）

作为项目维护者，我希望在 Wave 处理用户提示之前进行验证，以便自动执行项目特定的指南或添加上下文信息。

**为什么是这个优先级**：实现了对 AI 交互的主动控制，可以通过添加上下文来提高响应质量，但不如操作后验证那样关键。

**独立测试**：可以通过配置 UserPromptSubmit hook、提交各种提示并验证验证/上下文添加逻辑正确执行来完整测试。

**验收场景**：

1. **假设**配置了 UserPromptSubmit hook，**当**用户提交提示时，**则**验证脚本在 Wave 处理提示之前执行
2. **假设**提示验证脚本修改了上下文，**当**验证运行时，**则**额外的上下文可供 Wave 处理使用

---

### 用户故事：AI 响应完成后执行任务（优先级：P3）

作为开发者，我希望在 Wave 完成生成响应（无更多工具调用）时运行收尾任务，以便在每次 AI 交互周期后执行后处理或状态更新。

**为什么是这个优先级**：适用于响应后的工作流，如日志记录、状态更新或触发后续流程，但对基本 hook 功能不是关键。

**独立测试**：可以通过配置 Stop hook、让 Wave 完成无更多工具调用的响应周期并验证配置的任务正确执行来完整测试。

**验收场景**：

1. **假设**配置了 Stop hook，**当** Wave 完成无更多工具调用的响应周期时，**则**配置的命令执行
2. **假设**Stop hook 配置了项目特定脚本，**当**AI 响应完成时，**则**后处理任务自动运行

---

### 用户故事：PreToolUse Hook 数据访问（优先级：P1）

开发者创建 PreToolUse hook 需要在执行前分析传入的工具命令及其参数。Hook 通过 stdin 接收包含会话上下文、工具信息和输入参数的结构化 JSON 数据，使其能够做出关于是否允许、修改或阻止工具执行的明智决策。

**为什么是这个优先级**：这是 hook 最常见的用例——基于上下文和参数拦截并可能修改工具执行。

**独立测试**：可以使用 `jq` 通过配置 PreToolUse hook 并验证 JSON 字段可访问来测试：`jq -r '.session_id, .transcript_path, .cwd, .hook_event_name, .tool_name, .tool_input'`

**验收场景**：

1. **假设**配置了 PreToolUse hook 且 Write 工具即将执行，**当**hook 进程启动时，**则**它通过 stdin 接收 JSON，包含 session*id、transcript_path（路径格式为 ~/.wave/sessions/session*[id].json）、cwd、hook_event_name "PreToolUse"、tool_name "Write"，以及包含 file_path 和 content 字段的 tool_input
2. **假设**配置了 PreToolUse hook 且 Read 工具即将执行，**当**hook 进程启动时，**则**它通过 stdin 接收包含 Read 工具相应 tool_input 模式的 JSON

---

### 用户故事：PostToolUse Hook 响应分析（优先级：P2）

开发者创建 PostToolUse hook 需要分析工具执行结果并可能执行后续操作。Hook 接收包含原始工具输入和工具响应/输出的 JSON 数据，实现全面的执行后处理。

**为什么是这个优先级**：对审计跟踪、错误处理和基于工具结果的自动后续操作至关重要。

**独立测试**：可以使用 `jq` 通过配置 PostToolUse hook 并验证 JSON 包含输入和响应来测试：`jq -r '.tool_input, .tool_response'`

**验收场景**：

1. **假设**配置了 PostToolUse hook 且 Write 工具已成功完成，**当**hook 进程启动时，**则**它接收包含会话上下文、tool_name "Write"、原始 tool_input 以及包含成功状态和文件路径的 tool_response 的 JSON
2. **假设**配置了 PostToolUse hook 且工具执行失败，**当**hook 进程启动时，**则**它接收包含错误信息的 tool_response 的 JSON

---

### 用户故事：通过 Transcript Path 访问会话（优先级：P2）

Hook 需要访问完整的对话历史以做出上下文感知的决策。Hook 使用 JSON 输入中的 transcript_path 字段加载完整的会话数据，从而分析之前的交互和对话上下文。

**为什么是这个优先级**：对需要对话上下文进行智能决策的 hook 至关重要。

**独立测试**：可以使用 `jq` 通过配置任何 hook 并验证可以加载会话数据来测试：`jq -r '.transcript_path' | xargs cat | jq '.state.messages'`

**验收场景**：

1. **假设**hook 接收到包含 transcript_path 字段的 JSON，**当**hook 读取该路径的文件时，**则**它成功加载包含所有消息和元数据的完整会话数据
2. **假设**存在一个长对话会话，**当**任何 hook 被触发时，**则**transcript_path 指向包含所有累积对话历史的当前会话文件

---

### 用户故事：UserPromptSubmit Hook 监控（优先级：P3）

开发者创建 UserPromptSubmit hook 用于监控和分析用户输入，进行安全扫描、内容过滤或使用分析。Hook 接收包含用户提示文本和会话上下文的 JSON 数据。

**为什么是这个优先级**：对安全、合规和分析有用，但对核心功能不是必需的。

**独立测试**：可以使用 `jq` 通过配置 UserPromptSubmit hook 并验证提示文本可访问来测试：`jq -r '.prompt'`

**验收场景**：

1. **假设**配置了 UserPromptSubmit hook，**当**用户提交提示时，**则**hook 接收包含 session_id、transcript_path、cwd、hook_event_name "UserPromptSubmit" 以及用户提示文本的 JSON
2. **假设**UserPromptSubmit hook 需要访问对话历史，**当**它加载 transcript_path 时，**则**它可以分析完整的对话上下文以及新提示

---

### 用户故事：Stop Hook 清理操作（优先级：P3）

开发者创建 Stop hook 在会话结束时执行清理操作。Hook 接收指示会话终止的最小 JSON 数据，并可以执行最终操作，如保存摘要或清理临时资源。

**为什么是这个优先级**：对清理和收尾有用，但对核心操作不是关键。

**独立测试**：可以使用 `jq` 通过配置 Stop hook 并验证事件名称可访问来测试：`jq -r '.hook_event_name'`

**验收场景**：

1. **假设**配置了 Stop hook，**当**会话结束时，**则**hook 接收包含 session_id、transcript_path 和 hook_event_name "Stop" 的 JSON
2. **假设**Stop hook 需要执行清理，**当**它接收到停止通知时，**则**它可以通过 transcript_path 访问最终会话状态

---

### 用户故事：异步 Hook 执行（优先级：P2）

作为开发者，我希望将测试或后台分析等长时间运行的任务作为 hook 运行而不阻止 Wave 的响应，以便在任务在后台执行时继续我的交互。

**为什么是这个优先级**：在不牺牲 AI 代理响应性的情况下实现强大的后台工作流。

**独立测试**：可以通过配置带有 `sleep` 命令的异步 hook 并验证 Wave 立即继续而不等待 sleep 完成来测试。

**验收场景**：

1. **假设**配置了 `async: true` 的异步 hook，**当**触发事件发生时，**则**hook 命令在后台开始执行，Wave 立即继续其工作流
2. **假设**配置了自定义 `timeout` 的异步 hook，**当**hook 执行时，**则**它允许运行到指定的超时时间后才被终止
3. **假设**异步 hook 产生了输出，**当**它完成时，**则**其输出被记录但不会传递到对话中

---

### 用户故事：权限请求 Hook（优先级：P2）

作为开发者，我希望在 Wave 请求使用工具权限时运行 hook，以便自动授权或在我手动批准之前执行额外检查。

**为什么是这个优先级**：实现权限流程的自动化，并为 hook 提供正在授权的工具调用的完整上下文。

**独立测试**：可以通过配置 PermissionRequest hook、触发需要权限的工具并验证 hook 接收 tool_name 和 tool_input 来测试。

**验收场景**：

1. **假设**配置了 PermissionRequest hook，**当**Wave 需要权限使用工具时，**则**hook 接收包含会话上下文、hook_event_name "PermissionRequest"、tool_name 和 tool_input 的 JSON
2. **假设**PermissionRequest hook 分析工具输入，**当**它运行时，**则**它可以使用提供的 tool_input 来决定后续操作

---

### 用户故事：Hook 成功反馈（优先级：P1）

当 hook 脚本成功执行时，用户需要知道操作已完成，并且任何相关上下文都应被捕获以供下游处理。

**为什么是这个优先级**：这是启用基本 hook 功能的核心成功路径，必须对任何 hook 系统有用。

**独立测试**：可以通过执行返回退出码 0 的 hook 并使用 agent.messages 验证 stdout 处理行为因 hook 类型而异来完整测试。

**验收场景**：

1. **假设**`UserPromptSubmit` hook 返回退出码 0 并带有 stdout 内容，**当**hook 完成时，**则**stdout 内容被注入到 Wave Agent 的上下文中，且 `agent.messages` 包含两条用户角色消息，第二条包含 hook stdout
2. **假设**任何其他 hook 类型返回退出码 0 并带有 stdout 内容，**当**hook 完成时，**则**stdout 内容被忽略，Wave Agent 不可见
3. **假设**任何 hook 返回退出码 0 并带有 stderr 内容，**当**hook 完成时，**则**stderr 内容被忽略，执行正常继续

---

### 用户故事：Hook 阻止性错误处理（优先级：P1）

当 hook 脚本遇到应阻止进一步执行的关键错误时，用户需要系统停止操作并向适当的接收者提供错误反馈。

**为什么是这个优先级**：阻止性错误对维护系统完整性和阻止不需要的操作继续至关重要。

**独立测试**：可以通过执行返回退出码 2 的 hook 并通过 agent.messages 验证模式验证不同 hook 类型的不同阻止行为来完整测试。

**验收场景**：

1. **假设**`PreToolUse` hook 返回退出码 2 并带有 stderr，**当**hook 完成时，**则**工具调用被阻止，且 `agent.messages` 包含一个 `ToolBlock`，其 result 字段包含 stderr 内容
2. **假设**`PostToolUse` hook 返回退出码 2 并带有 stderr，**当**hook 完成时，**则**`agent.messages` 包含带有 stderr 内容的用户角色消息，AI 继续处理
3. **假设**`UserPromptSubmit` hook 返回退出码 2 并带有 stderr，**当**hook 完成时，**则**提示处理被阻止，提示被清除，且 `agent.messages` 包含助手消息中的 `ErrorBlock`，以 stderr 内容为内容（仅用户可见）
4. **假设**`Stop` hook 返回退出码 2 并带有 stderr，**当**hook 完成时，**则**停止被阻止，且 `agent.messages` 包含带有 stderr 内容的用户角色消息

---

### 用户故事：Hook 非阻止性错误报告（优先级：P2）

当 hook 脚本遇到非关键错误时，用户需要看到错误信息，但系统应继续正常运行。

**为什么是这个优先级**：非阻止性错误提供有价值的调试信息而不中断工作流，重要但不关键。

**独立测试**：可以通过执行返回除 0 或 2 以外的退出码的 hook 并验证错误显示与继续执行来完整测试。

**验收场景**：

1. **假设**任何 hook 返回除 0 或 2 以外的退出码并带有 stderr 内容，**当**hook 完成时，**则**stderr 显示给用户，执行正常继续
2. **假设**任何 hook 返回除 0 或 2 以外的退出码并带有 stdout 内容，**当**hook 完成时，**则**stdout 被忽略，执行正常继续

---

### 用户故事：编程式 Hook 配置（优先级：P2）

作为 SDK 用户，我希望通过 `Agent.create({ hooks })` 以编程方式注入 hook 配置，以便配置运行时决定的 hook，而无需访问私有成员或仅依赖静态配置文件。

**为什么是这个优先级**：支持在静态配置文件中无法表达的编程用例（例如，基于运行时标志的条件 hook）。遵循与 `mcpServers` 和 `customTools` 选项相同的模式。

**独立测试**：可以通过使用 `hooks` 选项创建 Agent 并验证 `hookManager.hasHooks()` 对配置的事件返回 true 来完整测试。

**验收场景**：

1. **假设**`Agent.create()` 调用带有 `hooks: { Stop: [{ hooks: [{ type: "command", command: "echo done" }] }] }`，**当**agent 创建时，**则**HookManager 配置了 Stop hook，且 `hookManager.hasHooks("Stop")` 返回 true
2. **假设**`Agent.create()` 调用不带 `hooks` 选项，**当**agent 创建时，**则**HookManager 没有编程式 hook，且 `hookManager.hasHooks("Stop")` 返回 false
3. **假设**`AgentOptions.hooks` 和基于文件的 hook 配置了同一事件（如 Stop），**当**agent 创建时，**则**编程式和基于文件的 hook 共存并按顺序全部执行（编程式优先，然后是基于文件的）

---

### 用户故事：PreCompact Hook 用于压缩定制（优先级：P2）

作为开发者，我希望在对话压缩发生之前运行 hook，以便注入自定义指令来引导摘要生成或执行预压缩操作。

**为什么是这个优先级**：实现压缩过程的定制，允许团队确保在摘要过程中保留特定信息。

**独立测试**：配置通过 stdout 输出指令的 PreCompact hook，触发压缩，并验证指令包含在摘要提示中。

**验收场景**：

1. **假设**配置了 PreCompact hook，**当**压缩被触发（自动或手动）时，**则**hook 在摘要 API 调用之前执行
2. **假设**PreCompact hook 向 stdout 输出文本，**当**压缩运行时，**则**stdout 内容与用户提供的自定义指令合并并传递到摘要提示
3. **假设**PreCompact hook 失败，**当**压缩运行时，**则**失败被记录但不阻止压缩继续

---

### 用户故事：PostCompact Hook 用于压缩后操作（优先级：P2）

作为开发者，我希望在对话压缩完成后运行 hook，以便执行压缩后操作，如日志记录、通知或状态同步。

**为什么是这个优先级**：使下游系统能够响应压缩事件，对审计跟踪和外部状态管理有用。

**独立测试**：配置 PostCompact hook，触发压缩，并验证 hook 接收压缩摘要文本。

**验收场景**：

1. **假设**配置了 PostCompact hook，**当**压缩成功完成时，**则**hook 执行并在 JSON 输入中接收压缩摘要
2. **假设**PostCompact hook 失败，**当**压缩运行时，**则**失败被记录但不影响压缩结果
3. **假设**压缩失败，**当**错误被处理时，**则**PostCompact hook 不会执行

---

### 用户故事：Stop Hook 后台工作感知（优先级：P3）

作为开发者，我希望 Stop hook 触发时能通过 JSON 输入得知当前还有哪些后台任务（shell 命令、后台 subagent、后台 workflow）和会话级定时任务（cron）在运行，以便决定是否通过退出码 2 阻止停止以等待后台工作完成，或执行相应的清理、通知、日志逻辑。字段对齐 Claude Code（v2.1.145+）的 Stop hook 输入格式。

**为什么是这个优先级**：Stop hook 默认在主代理回合结束的瞬间触发，不等待异步后台任务（bash 工具的 `run_in_background`、后台 subagent、后台 workflow），也不反映尚未触发的 cron 任务。没有这两个字段时，hook 无法区分"所有工作已结束"与"仍有后台工作在跑/等待唤醒"两种情况，无法实现"等后台完成再收尾"或"有定时任务在等就不收尾"的工作流。Claude Code 在 Stop hook 输入中提供 `background_tasks` 和 `session_crons` 两个数组字段，本特性对齐该设计。

**独立测试**：可以通过配置 Stop hook 输出 `jq -c '.background_tasks, .session_crons'`、启动一个后台 bash 命令、一个后台 subagent、一个后台 workflow 和一个 cron 任务、再让主代理结束回合，验证两个数组内容随后台/cron 状态变化来完整测试。

**验收场景**：

1. **假设**主代理回合结束时没有后台任务运行、也没有 cron 任务，**当** Stop hook 触发时，**则** JSON 输入包含 `background_tasks: []` 和 `session_crons: []`（空数组，字段始终存在）
2. **假设**主代理回合结束时有一个后台 subagent 在运行，**当** Stop hook 触发时，**则** JSON 输入的 `background_tasks` 数组包含 1 个元素，其 `type` 为 `"subagent"`、`status` 为 `"running"`、`agent_type` 为该 subagent 的类型、`description` 为其描述
3. **假设**主代理回合结束时有一个后台 bash 命令在运行（`run_in_background` 或超时自动转入后台），**当** Stop hook 触发时，**则** JSON 输入的 `background_tasks` 数组包含 1 个元素，其 `type` 为 `"shell"`、`status` 为 `"running"`、`command` 为该命令行、不含 `agent_type`/`name` 字段
4. **假设**主代理回合结束时有一个后台 workflow 在运行，**当** Stop hook 触发时，**则** JSON 输入的 `background_tasks` 数组包含 1 个元素，其 `type` 为 `"workflow"`、`status` 为 `"running"`、`name` 为该 workflow 名称、不含 `command`/`agent_type` 字段
5. **假设**主代理回合结束时有 1 个 cron 任务（recurring 或 one-shot），**当** Stop hook 触发时，**则** JSON 输入的 `session_crons` 数组包含 1 个元素，其 `id`、`schedule`（cron 表达式）、`recurring`、`prompt` 字段对应该任务
6. **假设** Stop hook 检测到 `background_tasks` 非空并返回退出码 2，**当** hook 完成时，**则**停止被阻止（stderr 作为用户消息注入，AI 继续对话）；后台任务完成后产生的通知将重启响应周期，Stop hook 在下一轮再次触发并看到更新后的 `background_tasks` 数组
7. **假设**后台任务在 Stop hook 构造输入与 hook 进程读取输入之间完成，**当** hook 读取字段时，**则**数组反映触发瞬间的快照状态（不要求与 hook 执行期间实时一致）；已完成（`completed`/`failed`/`killed`）的任务不出现在数组中
8. **假设** SubagentStop hook（子代理自身回合结束）触发，**当**其 JSON 输入被构造时，**则**不包含 `background_tasks` 和 `session_crons` 字段（这两个字段仅主 Stop 事件提供；子代理作用域内无独立后台/cron 概念）
9. **假设**某个后台任务的 `description` 或 `command` 超过 1000 字符，**当**构造 `background_tasks` 数组时，**则**该字段被截断至 1000 字符并以 `… [+N chars]` 标记被裁剪的字符数

---

### 用户故事：Stop/SubagentStop Hook 末条助手消息（优先级：P3）

作为开发者，我希望 Stop 和 SubagentStop hook 触发时能通过 JSON 输入直接获取停止前最后一条助手消息的文本内容（`last_assistant_message` 字段），而无需读取并解析 transcript 文件，以便在 hook 脚本中快速检查最终回复内容（如日志记录、内容校验、格式验证、触发后续流程）。字段对齐 Claude Code 的 Stop/SubagentStop hook 输入格式。

**为什么是这个优先级**：Stop hook 默认只能拿到 session_id 和 transcript_path，要查看最终回复必须读取并解析 JSONL transcript 文件。对于只需要最终回复文本的简单 hook（如记录日志、校验回复是否包含特定内容），这个开销不必要。Claude Code 在 Stop 和 SubagentStop hook 输入中提供 `last_assistant_message` 字段，本特性对齐该设计。

**独立测试**：可以通过配置 Stop hook 输出 `jq -r '.last_assistant_message'`、让主代理产生一条文本回复后结束回合，验证输出内容与最终回复文本一致来测试。

**验收场景**：

1. **假设**主代理回合结束且最后一条助手消息包含文本内容，**当** Stop hook 触发时，**则** JSON 输入包含 `last_assistant_message` 字段，其值为该助手消息所有文本块的文本内容以换行符拼接并去除首尾空白后的结果
2. **假设**子代理回合结束且最后一条助手消息包含文本内容，**当** SubagentStop hook 触发时，**则** JSON 输入包含 `last_assistant_message` 字段，其值同场景 1 的提取规则
3. **假设**最后一条助手消息仅包含工具调用块（无文本块），**当** Stop hook 触发时，**则** JSON 输入不包含 `last_assistant_message` 字段（提取结果为空字符串时视为无内容，字段省略）
4. **假设**最后一条助手消息同时包含文本块和工具调用块，**当** Stop hook 触发时，**则** `last_assistant_message` 字段值为文本块内容拼接（工具调用块不参与拼接）
5. **假设**某条非 Stop/SubagentStop 事件（如 PreToolUse、PostToolUse、UserPromptSubmit）的 hook 触发，**当**其 JSON 输入被构造时，**则**不包含 `last_assistant_message` 字段（该字段仅 Stop 和 SubagentStop 事件提供）

## 边界情况

- 当 hook 命令失败或超时会发生什么？
- 系统如何处理在 Wave 仍在处理时修改文件的 hook？
- 当同一事件配置了多个操作冲突的 hook 时会发生什么？
- 不同执行上下文中的环境变量如何处理？
- 当 hook 脚本不可执行或缺失时会发生什么？
- 格式错误的 JSON 数据处理
- 不读取 stdin 的 hook
- 当 hook 脚本在退出码为 0 时同时产生 stdout 和 stderr 会发生什么？
- 系统如何处理不产生任何输出（空 stdout/stderr）的 hook？
- 当 hook 脚本挂起或超时会发生什么？
- 如何管理极大的 stdout/stderr 输出？
- 当 stderr 包含非 UTF-8 或二进制内容时会发生什么？

### 测试验证需求

- 系统必须通过检查 `agent.sendMessage()` 使 `agent.messages` 包含两条用户角色消息（第二条包含 hook stdout 内容）来验证 `UserPromptSubmit` 成功
- 系统必须通过检查 `agent.messages` 包含 `ToolBlock`（其 result 字段包含 stderr 内容）来验证 `PreToolUse` 阻止性错误
- 系统必须通过检查 `agent.messages` 包含带有 stderr 内容的用户角色消息来验证 `PostToolUse` 错误反馈
- 系统必须通过检查 `agent.messages` 不包含用户角色消息且助手消息中包含以 stderr 为内容的 `ErrorBlock` 来验证 `UserPromptSubmit` 阻止性错误
- 系统必须确保 `ErrorBlock` 内容不被 `packages/agent-sdk/src/utils/convertMessagesForAPI.ts` 处理，使其仅用户可见且不发送给代理
- 系统必须通过检查 `agent.messages` 包含带有 stderr 内容的用户角色消息来验证 `Stop` hook 阻止行为
