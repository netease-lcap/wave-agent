# 功能规格说明：Hooks 支持

**特性分支**：`005-hooks`  
**创建日期**：2024-12-19  

## Hook 输出

Hook 有两种方式将输出返回给 Wave Agent。输出传达是否阻止以及任何应反馈给 Wave 和用户的信息。

### 简单方式：退出码

Hook 通过退出码、stdout 和 stderr 传达状态：

* **退出码 0**：成功。stdout 仅在 `UserPromptSubmit` 时添加到上下文中。
* **退出码 2**：阻止性错误。`stderr` 反馈给 Wave 进行自动处理。参见下方各 hook 事件的行为。
* **其他退出码**：非阻止性错误。`stderr` 显示给用户，执行继续。

<Warning>
  提醒：如果退出码为 0，Wave Agent 不会看到 stdout，除了 `UserPromptSubmit` hook 的 stdout 会作为上下文注入。
</Warning>

#### 退出码 2 行为

| Hook 事件            | 行为                                                               |
| ------------------ | ------------------------------------------------------------------ |
| `PreToolUse`       | 阻止工具调用，向 Wave 显示 stderr                                    |
| `PostToolUse`      | 向 Wave 显示 stderr 并允许 AI 继续（工具已执行）                       |
| `UserPromptSubmit` | 阻止提示处理，清除提示，仅向用户显示 stderr                             |
| `Stop`             | 阻止停止（AI 继续对话），向 Wave 显示 stderr                          |
| `SubagentStop`     | 阻止停止（子代理继续），向 Wave 显示 stderr                            |
| `PermissionRequest`| 阻止（拒绝）权限，仅向用户显示 stderr                                  |
| `WorktreeCreate`   | 仅向用户显示 stderr（非阻止）                                         |
| `PreCompact`      | 仅向用户显示 stderr（非阻止）                                         |
| `PostCompact`     | 仅向用户显示 stderr（非阻止）                                         |

## 用户场景与测试 *（必填）*

### 用户故事 1 - 配置 Hook 进行代码质量检查（优先级：P1）

作为开发者，我希望配置在文件编辑操作后自动运行代码质量检查的 hook，以便无需手动干预即可维护一致的代码标准。

**为什么是这个优先级**：这是 hook 最常见的用例——自动化质量保证。它通过在开发过程早期发现问题来提供即时价值。

**独立测试**：可以通过为 Edit 操作配置 PostToolUse hook、编辑文件并验证质量检查命令执行并提供反馈来完整测试。

**验收场景**：

1. **假设**项目配置了 PostToolUse Edit 操作的 hook，**当**我使用 Edit 工具编辑文件时，**则**配置的代码质量脚本自动执行
2. **假设**同一事件配置了多个 hook，**当**触发事件发生时，**则**所有匹配的 hook 按定义顺序执行
3. **假设**hook 命令失败，**当**hook 执行时，**则**失败被记录但不中断主工具操作

---

### 用户故事 2 - 在处理前验证用户提示（优先级：P2）

作为项目维护者，我希望在 Wave 处理用户提示之前进行验证，以便自动执行项目特定的指南或添加上下文信息。

**为什么是这个优先级**：实现了对 AI 交互的主动控制，可以通过添加上下文来提高响应质量，但不如操作后验证那样关键。

**独立测试**：可以通过配置 UserPromptSubmit hook、提交各种提示并验证验证/上下文添加逻辑正确执行来完整测试。

**验收场景**：

1. **假设**配置了 UserPromptSubmit hook，**当**用户提交提示时，**则**验证脚本在 Wave 处理提示之前执行
2. **假设**提示验证脚本修改了上下文，**当**验证运行时，**则**额外的上下文可供 Wave 处理使用

---

### 用户故事 3 - AI 响应完成后执行任务（优先级：P3）

作为开发者，我希望在 Wave 完成生成响应（无更多工具调用）时运行收尾任务，以便在每次 AI 交互周期后执行后处理或状态更新。

**为什么是这个优先级**：适用于响应后的工作流，如日志记录、状态更新或触发后续流程，但对基本 hook 功能不是关键。

**独立测试**：可以通过配置 Stop hook、让 Wave 完成无更多工具调用的响应周期并验证配置的任务正确执行来完整测试。

**验收场景**：

1. **假设**配置了 Stop hook，**当** Wave 完成无更多工具调用的响应周期时，**则**配置的命令执行
2. **假设**Stop hook 配置了项目特定脚本，**当**AI 响应完成时，**则**后处理任务自动运行

---

### 用户故事 4 - PreToolUse Hook 数据访问（优先级：P1）

开发者创建 PreToolUse hook 需要在执行前分析传入的工具命令及其参数。Hook 通过 stdin 接收包含会话上下文、工具信息和输入参数的结构化 JSON 数据，使其能够做出关于是否允许、修改或阻止工具执行的明智决策。

**为什么是这个优先级**：这是 hook 最常见的用例——基于上下文和参数拦截并可能修改工具执行。

**独立测试**：可以使用 `jq` 通过配置 PreToolUse hook 并验证 JSON 字段可访问来测试：`jq -r '.session_id, .transcript_path, .cwd, .hook_event_name, .tool_name, .tool_input'`

**验收场景**：

1. **假设**配置了 PreToolUse hook 且 Write 工具即将执行，**当**hook 进程启动时，**则**它通过 stdin 接收 JSON，包含 session_id、transcript_path（路径格式为 ~/.wave/sessions/session_[id].json）、cwd、hook_event_name "PreToolUse"、tool_name "Write"，以及包含 file_path 和 content 字段的 tool_input
2. **假设**配置了 PreToolUse hook 且 Read 工具即将执行，**当**hook 进程启动时，**则**它通过 stdin 接收包含 Read 工具相应 tool_input 模式的 JSON

---

### 用户故事 5 - PostToolUse Hook 响应分析（优先级：P2）

开发者创建 PostToolUse hook 需要分析工具执行结果并可能执行后续操作。Hook 接收包含原始工具输入和工具响应/输出的 JSON 数据，实现全面的执行后处理。

**为什么是这个优先级**：对审计跟踪、错误处理和基于工具结果的自动后续操作至关重要。

**独立测试**：可以使用 `jq` 通过配置 PostToolUse hook 并验证 JSON 包含输入和响应来测试：`jq -r '.tool_input, .tool_response'`

**验收场景**：

1. **假设**配置了 PostToolUse hook 且 Write 工具已成功完成，**当**hook 进程启动时，**则**它接收包含会话上下文、tool_name "Write"、原始 tool_input 以及包含成功状态和文件路径的 tool_response 的 JSON
2. **假设**配置了 PostToolUse hook 且工具执行失败，**当**hook 进程启动时，**则**它接收包含错误信息的 tool_response 的 JSON

---

### 用户故事 6 - 通过 Transcript Path 访问会话（优先级：P2）

Hook 需要访问完整的对话历史以做出上下文感知的决策。Hook 使用 JSON 输入中的 transcript_path 字段加载完整的会话数据，从而分析之前的交互和对话上下文。

**为什么是这个优先级**：对需要对话上下文进行智能决策的 hook 至关重要。

**独立测试**：可以使用 `jq` 通过配置任何 hook 并验证可以加载会话数据来测试：`jq -r '.transcript_path' | xargs cat | jq '.state.messages'`

**验收场景**：

1. **假设**hook 接收到包含 transcript_path 字段的 JSON，**当**hook 读取该路径的文件时，**则**它成功加载包含所有消息和元数据的完整会话数据
2. **假设**存在一个长对话会话，**当**任何 hook 被触发时，**则**transcript_path 指向包含所有累积对话历史的当前会话文件

---

### 用户故事 7 - UserPromptSubmit Hook 监控（优先级：P3）

开发者创建 UserPromptSubmit hook 用于监控和分析用户输入，进行安全扫描、内容过滤或使用分析。Hook 接收包含用户提示文本和会话上下文的 JSON 数据。

**为什么是这个优先级**：对安全、合规和分析有用，但对核心功能不是必需的。

**独立测试**：可以使用 `jq` 通过配置 UserPromptSubmit hook 并验证提示文本可访问来测试：`jq -r '.prompt'`

**验收场景**：

1. **假设**配置了 UserPromptSubmit hook，**当**用户提交提示时，**则**hook 接收包含 session_id、transcript_path、cwd、hook_event_name "UserPromptSubmit" 以及用户提示文本的 JSON
2. **假设**UserPromptSubmit hook 需要访问对话历史，**当**它加载 transcript_path 时，**则**它可以分析完整的对话上下文以及新提示

---

### 用户故事 8 - Stop Hook 清理操作（优先级：P3）

开发者创建 Stop hook 在会话结束时执行清理操作。Hook 接收指示会话终止的最小 JSON 数据，并可以执行最终操作，如保存摘要或清理临时资源。

**为什么是这个优先级**：对清理和收尾有用，但对核心操作不是关键。

**独立测试**：可以使用 `jq` 通过配置 Stop hook 并验证事件名称可访问来测试：`jq -r '.hook_event_name'`

**验收场景**：

1. **假设**配置了 Stop hook，**当**会话结束时，**则**hook 接收包含 session_id、transcript_path 和 hook_event_name "Stop" 的 JSON
2. **假设**Stop hook 需要执行清理，**当**它接收到停止通知时，**则**它可以通过 transcript_path 访问最终会话状态

---

### 用户故事 9 - 异步 Hook 执行（优先级：P2）

作为开发者，我希望将测试或后台分析等长时间运行的任务作为 hook 运行而不阻止 Wave 的响应，以便在任务在后台执行时继续我的交互。

**为什么是这个优先级**：在不牺牲 AI 代理响应性的情况下实现强大的后台工作流。

**独立测试**：可以通过配置带有 `sleep` 命令的异步 hook 并验证 Wave 立即继续而不等待 sleep 完成来测试。

**验收场景**：

1. **假设**配置了 `async: true` 的异步 hook，**当**触发事件发生时，**则**hook 命令在后台开始执行，Wave 立即继续其工作流
2. **假设**配置了自定义 `timeout` 的异步 hook，**当**hook 执行时，**则**它允许运行到指定的超时时间后才被终止
3. **假设**异步 hook 产生了输出，**当**它完成时，**则**其输出被记录但不会传递到对话中

---

### 用户故事 10 - 权限请求 Hook（优先级：P2）

作为开发者，我希望在 Wave 请求使用工具权限时运行 hook，以便自动授权或在我手动批准之前执行额外检查。

**为什么是这个优先级**：实现权限流程的自动化，并为 hook 提供正在授权的工具调用的完整上下文。

**独立测试**：可以通过配置 PermissionRequest hook、触发需要权限的工具并验证 hook 接收 tool_name 和 tool_input 来测试。

**验收场景**：

1. **假设**配置了 PermissionRequest hook，**当**Wave 需要权限使用工具时，**则**hook 接收包含会话上下文、hook_event_name "PermissionRequest"、tool_name 和 tool_input 的 JSON
2. **假设**PermissionRequest hook 分析工具输入，**当**它运行时，**则**它可以使用提供的 tool_input 来决定后续操作

---

### 用户故事 11 - Hook 成功反馈（优先级：P1）

当 hook 脚本成功执行时，用户需要知道操作已完成，并且任何相关上下文都应被捕获以供下游处理。

**为什么是这个优先级**：这是启用基本 hook 功能的核心成功路径，必须对任何 hook 系统有用。

**独立测试**：可以通过执行返回退出码 0 的 hook 并使用 agent.messages 验证 stdout 处理行为因 hook 类型而异来完整测试。

**验收场景**：

1. **假设**`UserPromptSubmit` hook 返回退出码 0 并带有 stdout 内容，**当**hook 完成时，**则**stdout 内容被注入到 Wave Agent 的上下文中，且 `agent.messages` 包含两条用户角色消息，第二条包含 hook stdout
2. **假设**任何其他 hook 类型返回退出码 0 并带有 stdout 内容，**当**hook 完成时，**则**stdout 内容被忽略，Wave Agent 不可见
3. **假设**任何 hook 返回退出码 0 并带有 stderr 内容，**当**hook 完成时，**则**stderr 内容被忽略，执行正常继续

---

### 用户故事 12 - Hook 阻止性错误处理（优先级：P1）

当 hook 脚本遇到应阻止进一步执行的关键错误时，用户需要系统停止操作并向适当的接收者提供错误反馈。

**为什么是这个优先级**：阻止性错误对维护系统完整性和阻止不需要的操作继续至关重要。

**独立测试**：可以通过执行返回退出码 2 的 hook 并通过 agent.messages 验证模式验证不同 hook 类型的不同阻止行为来完整测试。

**验收场景**：

1. **假设**`PreToolUse` hook 返回退出码 2 并带有 stderr，**当**hook 完成时，**则**工具调用被阻止，且 `agent.messages` 包含一个 `ToolBlock`，其 result 字段包含 stderr 内容
2. **假设**`PostToolUse` hook 返回退出码 2 并带有 stderr，**当**hook 完成时，**则**`agent.messages` 包含带有 stderr 内容的用户角色消息，AI 继续处理
3. **假设**`UserPromptSubmit` hook 返回退出码 2 并带有 stderr，**当**hook 完成时，**则**提示处理被阻止，提示被清除，且 `agent.messages` 包含助手消息中的 `ErrorBlock`，以 stderr 内容为内容（仅用户可见）
4. **假设**`Stop` hook 返回退出码 2 并带有 stderr，**当**hook 完成时，**则**停止被阻止，且 `agent.messages` 包含带有 stderr 内容的用户角色消息

---

### 用户故事 13 - Hook 非阻止性错误报告（优先级：P2）

当 hook 脚本遇到非关键错误时，用户需要看到错误信息，但系统应继续正常运行。

**为什么是这个优先级**：非阻止性错误提供有价值的调试信息而不中断工作流，重要但不关键。

**独立测试**：可以通过执行返回除 0 或 2 以外的退出码的 hook 并验证错误显示与继续执行来完整测试。

**验收场景**：

1. **假设**任何 hook 返回除 0 或 2 以外的退出码并带有 stderr 内容，**当**hook 完成时，**则**stderr 显示给用户，执行正常继续
2. **假设**任何 hook 返回除 0 或 2 以外的退出码并带有 stdout 内容，**当**hook 完成时，**则**stdout 被忽略，执行正常继续

---

### 用户故事 14 - 编程式 Hook 配置（优先级：P2）

作为 SDK 用户，我希望通过 `Agent.create({ hooks })` 以编程方式注入 hook 配置，以便配置运行时决定的 hook，而无需访问私有成员或仅依赖静态配置文件。

**为什么是这个优先级**：支持在静态配置文件中无法表达的编程用例（例如，基于运行时标志的条件 hook）。遵循与 `mcpServers` 和 `customTools` 选项相同的模式。

**独立测试**：可以通过使用 `hooks` 选项创建 Agent 并验证 `hookManager.hasHooks()` 对配置的事件返回 true 来完整测试。

**验收场景**：

1. **假设**`Agent.create()` 调用带有 `hooks: { Stop: [{ hooks: [{ type: "command", command: "echo done" }] }] }`，**当**agent 创建时，**则**HookManager 配置了 Stop hook，且 `hookManager.hasHooks("Stop")` 返回 true
2. **假设**`Agent.create()` 调用不带 `hooks` 选项，**当**agent 创建时，**则**HookManager 没有编程式 hook，且 `hookManager.hasHooks("Stop")` 返回 false
3. **假设**`AgentOptions.hooks` 和基于文件的 hook 配置了同一事件（如 Stop），**当**agent 创建时，**则**编程式和基于文件的 hook 共存并按顺序全部执行（编程式优先，然后是基于文件的）

---

### 用户故事 15 - PreCompact Hook 用于压缩定制（优先级：P2）

作为开发者，我希望在对话压缩发生之前运行 hook，以便注入自定义指令来引导摘要生成或执行预压缩操作。

**为什么是这个优先级**：实现压缩过程的定制，允许团队确保在摘要过程中保留特定信息。

**独立测试**：配置通过 stdout 输出指令的 PreCompact hook，触发压缩，并验证指令包含在摘要提示中。

**验收场景**：

1. **假设**配置了 PreCompact hook，**当**压缩被触发（自动或手动）时，**则**hook 在摘要 API 调用之前执行
2. **假设**PreCompact hook 向 stdout 输出文本，**当**压缩运行时，**则**stdout 内容与用户提供的自定义指令合并并传递到摘要提示
3. **假设**PreCompact hook 失败，**当**压缩运行时，**则**失败被记录但不阻止压缩继续

---

### 用户故事 16 - PostCompact Hook 用于压缩后操作（优先级：P2）

作为开发者，我希望在对话压缩完成后运行 hook，以便执行压缩后操作，如日志记录、通知或状态同步。

**为什么是这个优先级**：使下游系统能够响应压缩事件，对审计跟踪和外部状态管理有用。

**独立测试**：配置 PostCompact hook，触发压缩，并验证 hook 接收压缩摘要文本。

**验收场景**：

1. **假设**配置了 PostCompact hook，**当**压缩成功完成时，**则**hook 执行并在 JSON 输入中接收压缩摘要
2. **假设**PostCompact hook 失败，**当**压缩运行时，**则**失败被记录但不影响压缩结果
3. **假设**压缩失败，**当**错误被处理时，**则**PostCompact hook 不会执行

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

## 需求 *（必填）*

### 功能需求

- **FR-001**：系统必须支持在用户级（~/.wave/settings.json）和项目级（.wave/settings.json）设置文件中配置 hook
- **FR-002**：系统必须支持在工具处理开始前执行的 PreToolUse hook
- **FR-003**：系统必须支持在工具成功完成后执行的 PostToolUse hook
- **FR-004**：系统必须支持在用户提交提示时执行的 UserPromptSubmit hook
- **FR-005**：系统必须支持在 Wave 完成响应周期（无更多工具调用可生成）时执行的 Stop hook
- **FR-025**：系统必须支持在 Wave 请求使用工具权限时执行的 PermissionRequest hook
- **FR-026**：系统必须支持在子代理完成响应周期时执行的 SubagentStop hook
- **FR-027**：系统必须支持在创建新 worktree 时执行的 WorktreeCreate hook
- **FR-006**：系统必须支持工具名称模式匹配，包括精确字符串（不区分大小写）、glob 模式（使用 minimatch）和管道分隔的替代项（如 "Edit|Write"）
- **FR-007**：系统必须向 hook 命令提供 WAVE_PROJECT_DIR 环境变量以支持项目相对脚本执行
- **FR-008**：系统必须按配置顺序执行同一事件的多个 hook
- **FR-009**：系统必须记录 hook 执行结果和错误而不中断主工具操作
- **FR-010**：系统必须支持带有可配置 bash 命令的 command 类型 hook
- **FR-011**：系统必须通过 stdin 向 hook 进程提供 JSON 数据，包含所有 hook 事件的 session_id、transcript_path、cwd 和 hook_event_name 字段
- **FR-051**：系统必须向 hook 进程提供环境变量：`HOOK_EVENT`、`HOOK_TOOL_NAME`（如适用）和 `WAVE_PROJECT_DIR`
- **FR-052**：系统必须为 hook 执行继承父进程的环境变量，包括配置 `env` 设置中的变量
- **FR-012**：系统必须在 PreToolUse、PostToolUse 和 PermissionRequest 事件的 JSON 数据中包含 tool_name 和 tool_input 字段
- **FR-013**：系统必须在 PostToolUse 事件的 JSON 数据中包含包含工具执行结果的 tool_response 字段
- **FR-014**：系统必须在 UserPromptSubmit 事件的 JSON 数据中包含包含用户提交文本的 prompt 字段
- **FR-028**：系统必须在 hook 由子代理执行时在 JSON 数据中包含 subagent_type 字段
- **FR-029**：系统必须在 WorktreeCreate 事件的 JSON 数据中包含 name 字段
- **FR-015**：系统必须将 transcript_path 设置为存储会话数据的实际文件路径（格式：~/.wave/sessions/session_[shortId].json）
- **FR-016**：系统必须在 hook 被调用时将 cwd 设置为当前工作目录
- **FR-017**：系统必须确保 JSON 数据在发送到 hook 进程之前格式正确且有效
- **FR-018**：系统必须处理 hook 进程不从 stdin 读取的情况，不阻止或导致错误
- **FR-019**：系统必须维护与不期望 JSON 输入的现有 hook 的向后兼容性
- **FR-020**：系统必须按照 Constitution VII 组织 hook 组件：HookManager 在 managers/，executor 和 settings 作为 services/hook.ts 中的函数，matcher 在 utils/hookMatcher.ts，类型在 types/hooks.ts
- **FR-021**：系统必须确保测试文件结构反映源代码结构
- **FR-022**：系统必须支持 hook 配置中的 `async` 字段以允许后台执行
- **FR-023**：系统必须支持 hook 配置中的 `timeout` 字段（以秒为单位）以覆盖默认的 10 分钟超时
- **FR-024**：系统必须不将异步 hook 的 stdout/stderr 传递到对话中，以防止后台任务的意外消息注入
- **FR-030**：系统必须将 hook 退出码 0 解释为成功状态
- **FR-031**：系统必须将 hook 退出码 2 解释为阻止性错误状态
- **FR-032**：系统必须将任何其他 hook 退出码解释为非阻止性错误状态
- **FR-033**：系统必须在退出码为 0 时捕获 `UserPromptSubmit` hook 的 stdout 并注入到 Wave Agent 上下文中
- **FR-034**：系统必须忽略所有非 `UserPromptSubmit` hook 的 stdout，无论退出码如何
- **FR-035**：系统必须在 `PreToolUse` hook 返回退出码 2 时阻止工具执行
- **FR-036**：系统必须在 `PreToolUse` hook 返回退出码 2 时向 Wave Agent 显示 stderr
- **FR-037**：系统必须在 `PostToolUse` hook 返回退出码 2 时通过用户角色消息向 Wave Agent 显示 stderr，并允许 AI 继续处理（工具已执行）
- **FR-038**：系统必须在 `UserPromptSubmit` hook 返回退出码 2 时阻止提示处理
- **FR-039**：系统必须在 `UserPromptSubmit` hook 返回退出码 2 时清除当前提示
- **FR-040**：系统必须在 `UserPromptSubmit` hook 返回退出码 2 时仅向用户（非 Wave Agent）显示 stderr
- **FR-041**：系统必须在 `Stop` hook 返回退出码 2 时阻止停止
- **FR-042**：系统必须在 `Stop` hook 返回退出码 2 时向 Wave Agent 显示 stderr
- **FR-043**：系统必须对非阻止性错误（除 0 或 2 以外的退出码）向用户显示 stderr 并继续执行
- **FR-044**：系统必须区分不同的 hook 事件类型（`PreToolUse`、`PostToolUse`、`UserPromptSubmit`、`Stop`）以实现适当的行为
- **FR-053**：系统必须支持 `AgentOptions` 中的 `hooks` 选项以在 `Agent.create()` 时以编程方式注入 hook 配置
- **FR-054**：系统必须将 `AgentOptions.hooks` 的 hook 与基于文件的 hook 连接，使编程式和基于文件的 hook 对同一事件共存
- **FR-055**：系统必须使用与基于文件的 hook 配置相同的验证规则验证通过 `AgentOptions.hooks` 提供的 hook
- **FR-056**：系统必须支持在对话压缩之前执行的 PreCompact hook
- **FR-057**：系统必须将 PreCompact hook 的 stdout 与用户提供的自定义指令合并并传递到压缩摘要提示
- **FR-058**：系统必须支持在对话压缩成功之后执行的 PostCompact hook
- **FR-059**：系统必须在 PreCompact 事件的 JSON 数据中包含包含任何自定义指令的 `compact_instructions` 字段
- **FR-060**：系统必须在 PostCompact 事件的 JSON 数据中包含包含 AI 生成摘要的 `compact_summary` 字段
- **FR-061**：系统在压缩失败时不得执行 PostCompact hook
- **FR-062**：系统不得要求 PreCompact 或 PostCompact hook 配置使用 matcher

### 测试验证需求

- **FR-045**：系统必须通过检查 `agent.sendMessage()` 使 `agent.messages` 包含两条用户角色消息（第二条包含 hook stdout 内容）来验证 `UserPromptSubmit` 成功
- **FR-046**：系统必须通过检查 `agent.messages` 包含 `ToolBlock`（其 result 字段包含 stderr 内容）来验证 `PreToolUse` 阻止性错误
- **FR-047**：系统必须通过检查 `agent.messages` 包含带有 stderr 内容的用户角色消息来验证 `PostToolUse` 错误反馈
- **FR-048**：系统必须通过检查 `agent.messages` 不包含用户角色消息且助手消息中包含以 stderr 为内容的 `ErrorBlock` 来验证 `UserPromptSubmit` 阻止性错误
- **FR-049**：系统必须确保 `ErrorBlock` 内容不被 `packages/agent-sdk/src/utils/convertMessagesForAPI.ts` 处理，使其仅用户可见且不发送给代理
- **FR-050**：系统必须通过检查 `agent.messages` 包含带有 stderr 内容的用户角色消息来验证 `Stop` hook 阻止行为

### 关键实体

- **Hook 配置**：包含事件映射、匹配器和命令定义的设置结构
- **Hook 事件**：Wave 执行周期中的特定触发点（PreToolUse、PostToolUse、UserPromptSubmit、Stop、PermissionRequest、SubagentStop、WorktreeCreate、PreCompact、PostCompact）
- **Hook 匹配器**：用于确定哪些 hook 适用于特定工具操作的模式匹配系统（位于 utils/hookMatcher.ts）
- **Hook 执行器**：用于执行 hook 命令的函数服务（位于 services/hook.ts）
- **Hook 设置**：用于加载和合并 hook 配置的服务（位于 services/hook.ts）
- **Hook 命令**：可访问 Wave 环境变量的可执行 bash 命令
- **Hook 输入 JSON**：包含会话上下文（session_id、transcript_path、cwd）、事件信息（hook_event_name）和事件特定数据（工具详情、提示、响应）
- **会话数据**：通过 transcript_path 可访问的完整对话历史和元数据
- **工具上下文**：关于工具执行的信息，包括名称、输入参数和工具相关事件的结果
- **Hook 输出**：包含 hook 执行的退出码、stdout 内容和 stderr 内容
- **错误上下文**：根据 hook 类型和错误严重程度确定错误消息的接收者（Wave Agent 或用户）
- **ToolBlock**：代理消息中包含工具执行结果和 PreToolUse 及 PostToolUse hook 错误信息的数据结构
- **ErrorBlock**：助手消息中包含 UserPromptSubmit hook 用户可见错误信息的数据结构，从 API 转换中排除
- **代理消息集合**：`agent.messages` 数组，作为测试 hook 行为正确性的主要验证点
- **编程式 Hook 配置**：`AgentOptions.hooks` 字段，类型为 `PartialHookConfiguration`，允许 SDK 用户在创建时注入 hook，补充基于文件的配置
- **PreCompact Hook**：在对话压缩之前触发的生命周期 hook，通过 stdin JSON 接收自定义指令并通过 stdout 返回额外指令
- **PostCompact Hook**：在成功压缩之后触发的生命周期 hook，通过 stdin JSON 接收压缩摘要
- **压缩指令**：引导 AI 在压缩期间进行摘要的自定义文本，从用户输入和 PreCompact hook stdout 合并

## 成功标准 *（必填）*

### 可衡量结果

- **SC-001**：所有 hook 执行在完成后 100ms 内正确解释退出码
- **SC-002**：UserPromptSubmit hook stdout 注入在 10KB 以下上下文时 200ms 内完成
- **SC-003**：阻止性错误在受影响的 hook 类型中 100% 阻止后续操作
- **SC-004**：错误消息根据 hook 类型和退出码 100% 到达正确的接收者（Wave Agent 或用户）
- **SC-005**：非阻止性错误在 100% 的情况下允许继续执行，同时仍向用户显示错误信息
- **SC-006**：所有 hook 行为通过 agent.messages 验证模式一致可测试，判断正确实现的准确率为 100%
