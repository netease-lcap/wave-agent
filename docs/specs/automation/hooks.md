---
name: "钩子系统"
description: "`PreToolUse`、`PostToolUse`、`Stop`、`PreCompact` 等事件钩子的配置、退出码语义与设置页管理"
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
- **注入的 user 消息一律带 `isMeta: true`**：hook 产生的上下文与反馈（`UserPromptSubmit` 的 stdout、`PostToolUse` / `Stop` / `SubagentStop` 的 stderr）对模型可见，但不显示在 CLI 与 Webview 的对话里，与 Claude Code 同形。

::: warning
提醒：如果退出码为 0，Wave Agent 不会看到 stdout，除了 `UserPromptSubmit` hook 的 stdout 会作为上下文注入。
:::

#### 退出码 2 行为

| Hook 事件           | 行为                                                                                                                                                                            |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `PreToolUse`        | 阻止工具调用；模型看到的工具结果变为失败，文本为 `PreToolUse:<工具名> hook error: <stderr>`                                                                                     |
| `PostToolUse`       | 向模型注入一条 `isMeta: true` 的用户角色消息，内容为 `PostToolUse:<工具名> hook blocking error from command: "<命令原文>": <stderr>`，原始工具结果不改写，AI 继续（工具已执行） |
| `UserPromptSubmit`  | 阻止提示处理，清除提示，仅向用户显示 stderr                                                                                                                                     |
| `Stop`              | 阻止停止（AI 继续对话），向 Wave 显示 stderr（`isMeta: true` 的用户角色消息）                                                                                                   |
| `SubagentStop`      | 阻止停止（子代理继续），向 Wave 显示 stderr（`isMeta: true` 的用户角色消息）                                                                                                    |
| `PermissionRequest` | 阻止（拒绝）权限，仅向用户显示 stderr                                                                                                                                           |
| `WorktreeCreate`    | 接管创建（Path return）：stdout 输出 worktree path；所有 hook 均失败或无输出时创建被阻止                                                                                        |
| `WorktreeRemove`    | 接管 hook-based worktree 的删除（wave 不执行 `git worktree remove`）；失败仅记录（非阻止），worktree 是否残留由 hook 负责                                                       |
| `PreCompact`        | 非阻止；stderr 不显示给用户（静默丢弃），压缩继续                                                                                                                               |
| `PostCompact`       | 仅向用户显示 stderr（非阻止）                                                                                                                                                   |

### 结构化方式：JSON 输出

Hook 也可以在 stdout 输出一个 JSON 对象，通过 `hookSpecificOutput` 传回结构化结果。当前 wave 支持 `additionalContext` 一个字段（对齐 Claude Code）：

- **读取通道与退出码正交**：只要 stdout 是含 `hookSpecificOutput.additionalContext` 的合法 JSON 就注入，**不需要用退出码 2**。这是它与「退出码 2 + stderr」的核心差别——不是「能不能送到」而是**档位**：同一个通道在 exit 2 下送达的文本被当作"hook 报错"，`additionalContext` 则是非错误的附加上下文。Claude Code 同样在退出码判定之前解析 stdout JSON。
- **注入形态**：文本以 `<system-reminder>` 包裹，作为一条 `isMeta: true` 的用户角色消息追加到对话中，与 SessionStart 钩子的注入方式一致（见 `session-hooks.md`）。
- **支持的事件**：`UserPromptSubmit`、`PreToolUse`、`PostToolUse`、`SessionStart`。与 Claude Code 一致，`Stop` / `SubagentStop` **不支持**该字段——要它们继续干活仍用退出码 2。
- **`UserPromptSubmit` 的 stdout 语义收窄**：该事件的 stdout 若是合法 JSON，注入其 `additionalContext` 值而**不是**把 JSON 原文塞进上下文；不是 JSON 时按原行为把文本注入。
- **`hookEventName` 必须与触发事件一致**：不一致视为非法 JSON 输出，按"非阻止性错误"呈现给用户，不注入上下文。
- **其余字段本次不做**：`updatedToolOutput` / `updatedMCPToolOutput`（改写工具结果）、`PreToolUse` 的 `updatedInput`（改写入参）。它们要改写**既有事实**（已发生的工具结果、模型已发出的入参），不是新增一段文本，需要单独定安全语义。

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
3. **假设**异步 hook（`async: true` 且未开 `asyncRewake`）产生了输出，**当**它完成时，**则**其输出被记录但不会传递到对话中（**例外**：`asyncRewake: true` 的 hook 在退出码 2 时会回灌唤醒模型，见下一条用户故事）

---

### 用户故事：异步 Hook 回灌唤醒（`asyncRewake`）（优先级：P2）

作为 hook 作者，我希望把回合结束后的复核（如安全扫描、测试完整性检查）作为后台 hook 运行，并在它发现问题时把结论回灌给 Wave 让它继续处理，以便复核既不拖慢本次回复，又不会因为"跑完没人看"而白跑。

**为什么是这个优先级**：现有 `async: true` 的 hook 跑完结果被丢弃（见上一条场景 3），因此任何"后台发现 → 需要模型处置"的流程在 wave 上都不成立——只能退回同步执行，代价是把回复卡在扫描上。Claude Code 用 `asyncRewake` 解决这个问题。

**独立测试**：配置一个 `asyncRewake: true` 的 Stop hook（`sleep 1` 后 `echo 发现硬编码密钥 >&2; exit 2`），发送一条消息；断言回复立即返回、不等待 sleep，随后模型自动获得一条 `<system-reminder>` 包裹的、内容含该 stderr 的通知并继续对话；再把 hook 换成 exit 0 的版本，断言没有任何后续唤醒。

**验收场景**：

1. **假设**配置了 `asyncRewake: true` 的 hook，**当**触发事件发生，**则** hook 在后台开始执行，Wave 立即继续（与 `async: true` 相同，不等待它结束）
2. **假设**该后台 hook 以退出码 2 结束，**当**它结束时，**则**其 stderr（stderr 为空时取 stdout）以 `<system-reminder>` 包裹、作为一条通知投递并**唤醒模型**：会话空闲时开启新回合，正在处理时作为排队消息注入当前回合
3. **假设**该后台 hook 以退出码 0 或其他退出码结束，**当**它结束时，**则**不唤醒模型、不注入任何消息（输出仅记入日志）
4. **假设** `asyncRewake: true` 且未显式写 `async`，**当** hook 被执行时，**则**按异步处理（`asyncRewake` 隐含 `async`）
5. **假设**用户在 hook 后台运行期间提交了新的消息，**当** hook 以退出码 2 结束，**则**唤醒照常投递（提交新消息不取消已启动的后台 hook）；用户显式中断当前回合时 hook 被终止、不投递
6. **假设**该后台 hook 超时或进程启动失败，**当**它结束时，**则**不唤醒模型，仅按非阻止性错误记入日志

---

### 用户故事：Hook 用 JSON 输出注入附加上下文（优先级：P2）

作为 hook 作者，我希望在**不制造错误**的前提下把一段文本送进模型上下文（例如"这次改动碰了鉴权路径，注意同步改测试"），以便让 hook 的发现以"上下文"而非"阻塞错误"的身份出现。字段与支持范围对齐 Claude Code 的 `hookSpecificOutput.additionalContext`。

**为什么是这个优先级**：wave 今天只能靠退出码 2 + stderr 注入文本（见「退出码 2 行为」），而 exit 2 在所有事件上都是**错误**语义——用它送一条善意提示，模型和用户看到的是"hook 报错了"。差别不在送达能力（能送到），而在**档位**。

**独立测试**：配置一个 PostToolUse hook，以 exit 0 输出 `{"hookSpecificOutput":{"hookEventName":"PostToolUse","additionalContext":"X"}}`，编辑一个文件；断言 `agent.messages` 新增一条 `isMeta: true` 的用户角色消息、其文本含 X 且被 `<system-reminder>` 包裹，且全程不出现错误块。

**验收场景**：

1. **假设** `PostToolUse` hook 以退出码 0 输出含 `hookSpecificOutput.additionalContext` 的合法 JSON，**当** hook 完成时，**则**该文本以 `<system-reminder>` 包裹作为一条 `isMeta: true` 的用户角色消息注入，工具原始结果不变，且不产生错误反馈
2. **假设** `PreToolUse` hook 以退出码 0 输出同样的 JSON，**当** hook 完成时，**则**注入同上，且工具继续正常执行（exit 0 不阻止）
3. **假设** `UserPromptSubmit` hook 以退出码 0 输出带 `additionalContext` 的合法 JSON，**当** hook 完成时，**则**注入的是 `additionalContext` 的值，**不是** JSON 原文
4. **假设** `UserPromptSubmit` hook 以退出码 0 输出普通文本（不是 JSON），**当** hook 完成时，**则**按现状把该文本注入上下文（原行为不变）
5. **假设** hook 以退出码 2 输出含 `additionalContext` 的 JSON，**当** hook 完成时，**则**退出码 2 的既有行为照旧执行，**且** `additionalContext` 也注入（读取通道与退出码正交）
6. **假设** hook 输出的 JSON 中 `hookEventName` 与触发事件不一致，**当**解析时，**则**视为非法输出按"非阻止性错误"呈现给用户，不注入任何上下文
7. **假设** `Stop` 或 `SubagentStop` hook 输出含 `additionalContext` 的 JSON，**当** hook 完成时，**则**不注入该上下文（这两个事件不支持该字段，与 Claude Code 一致），仅退出码 2 的 stderr 生效
8. **假设** `additionalContext` 为空字符串，**当**解析时，**则**视为未提供，不注入消息

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

1. **假设**`UserPromptSubmit` hook 返回退出码 0 并带有 stdout 内容，**当**hook 完成时，**则**stdout 内容被注入到 Wave Agent 的上下文中，且 `agent.messages` 包含两条用户角色消息，第二条包含 hook stdout 且标记为 `isMeta: true`
2. **假设**任何其他 hook 类型返回退出码 0 并带有 stdout 内容，**当**hook 完成时，**则**stdout 内容被忽略，Wave Agent 不可见
3. **假设**任何 hook 返回退出码 0 并带有 stderr 内容，**当**hook 完成时，**则**stderr 内容被忽略，执行正常继续

---

### 用户故事：Hook 阻止性错误处理（优先级：P1）

当 hook 脚本遇到应阻止进一步执行的关键错误时，用户需要系统停止操作并向适当的接收者提供错误反馈。

**为什么是这个优先级**：阻止性错误对维护系统完整性和阻止不需要的操作继续至关重要。

**独立测试**：可以通过执行返回退出码 2 的 hook 并通过 agent.messages 验证模式验证不同 hook 类型的不同阻止行为来完整测试。

**验收场景**：

1. **假设**`PreToolUse` hook 返回退出码 2 并带有 stderr，**当**hook 完成时，**则**工具调用被阻止，且 `agent.messages` 包含一个 `ToolBlock`，其失败文本为 `PreToolUse:<工具名> hook error: <stderr>`
2. **假设**`PostToolUse` hook 返回退出码 2 并带有 stderr，**当**hook 完成时，**则**`agent.messages` 包含一条 `isMeta: true` 的用户角色消息，内容为 `PostToolUse:<工具名> hook blocking error from command: "<命令原文>": <stderr>`，AI 继续处理
3. **假设**`UserPromptSubmit` hook 返回退出码 2 并带有 stderr，**当**hook 完成时，**则**提示处理被阻止，提示被清除，且 `agent.messages` 包含助手消息中的 `ErrorBlock`，以 stderr 内容为内容（仅用户可见）
4. **假设**`Stop` hook 返回退出码 2 并带有 stderr，**当**hook 完成时，**则**停止被阻止，且 `agent.messages` 包含带有 stderr 内容的 `isMeta: true` 用户角色消息

---

### 用户故事：Hook 非阻止性错误报告（优先级：P2）

当 hook 脚本遇到非关键错误时，用户需要看到错误信息，但系统应继续正常运行。

**为什么是这个优先级**：非阻止性错误提供有价值的调试信息而不中断工作流，重要但不关键。

**独立测试**：可以通过执行返回除 0 或 2 以外的退出码的 hook 并验证错误显示与继续执行来完整测试。

**验收场景**：

1. **假设**任何 hook 返回除 0 或 2 以外的退出码并带有 stderr 内容，**当**hook 完成时，**则**stderr 显示给用户，执行正常继续
2. **假设**任何 hook 返回除 0 或 2 以外的退出码并带有 stdout 内容，**当**hook 完成时，**则**stdout 被忽略，执行正常继续

---

### 用户故事：工具事件的 hook 反馈与 Claude Code 同形（优先级：P2）

作为 hook 作者，我希望 PreToolUse / PostToolUse 喂回模型的那两条文本与 Claude Code 逐字同形，以便我在 Claude Code 里写的 hook（及它自己的文档）搬到 wave 时行为一致，不需要重新推理一遍"这里会看到什么"。

**为什么是这个优先级**：不是核心能力，但"同形"是可持续的前提——工具事件是 hooks 里唯一模型可见的输出，两端文案一旦漂移，按 Claude Code 文档写的预期就落空。它也决定了嵌套调用该喂什么文本（见 `exec-tool.md` 的嵌套 hook 故事），所以必须先钉死这一份模板。

**独立测试**：让 PreToolUse / PostToolUse hook 分别以 exit 2 退出，断言模型侧文本逐字等于模板（含 `PreToolUse:<工具名>` / `PostToolUse:<工具名>` 前缀与命令原文）；再断言 exit ≠ 0、2 的 stderr 与 exit 0 的 stdout 都不进模型。

**验收场景**：

1. **假设**`PreToolUse` hook 对 `Write` 以 exit 2 退出并输出 stderr，**当**hook 完成时，**则**模型可见的工具结果文本为 `PreToolUse:Write hook error: <stderr>`，其中工具名是模型发出的那个工具名（MCP 工具即 `mcp__<server>__<tool>`）。
2. **假设**`PostToolUse` hook 对 `Write` 以 exit 2 退出并输出 stderr，**当**hook 完成时，**则**对话新增一条 `isMeta: true` 的用户角色消息 `PostToolUse:Write hook blocking error from command: "<该 hook 的命令原文>": <stderr>`，且工具的原始结果不被改写。
3. **假设**工具事件的 hook 以除 0、2 以外的退出码退出，**当**hook 完成时，**则**stderr 只呈现给用户（错误块），模型侧不新增消息、工具结果不变。
4. **假设**工具事件的 hook 以 exit 0 退出并带有 stdout，**当**hook 完成时，**则**stdout 不进模型——只有 `UserPromptSubmit` 的 stdout 进上下文。
5. **假设**多个 hook 在同一工具上都以 exit 2 退出，**当**处理结果时，**则**模型可见文本取自按配置顺序的第一个（后续 hook 的阻塞结果不再处理），与现状一致。

---

### 用户故事：hook 的 cwd 与 `$WAVE_PROJECT_DIR` 锚点（优先级：P2）

作为 hook 作者，我希望 hook 进程的工作目录与 `$WAVE_PROJECT_DIR` 的语义是钉死的，以便我写 `"$WAVE_PROJECT_DIR"/.wave/hooks/x.sh` 这种命令时，无论模型在会话里 `cd` 到哪都能跑通。

**为什么是这个优先级**：`$WAVE_PROJECT_DIR` 是 hook 唯一能拿到的路径锚点。它一旦跟着 bash `cd` 漂移，所有按它写的 hook 命令都会在模型 `cd` 之后集体失效，而且失败形态是「hook 报错但看不出原因」——相对路径解析到错误目录、或 spawn 到一个已被删除的目录。对齐 Claude Code：它的 `CLAUDE_PROJECT_DIR` 取「启动时的 project root」，明确不随 worktree 与 `cd` 变化。

**独立测试**：会话里先 `cd packages/code` 再触发一个打印 `pwd` 与 `$WAVE_PROJECT_DIR` 的 hook，断言 `$WAVE_PROJECT_DIR` 仍是会话根、spawn cwd 是当前 workdir；再把会话 workdir 指向一个已删除的目录，断言 hook 仍能启动而不是报 ENOENT。

**验收场景**：

1. **假设** 模型在 shell 里 `cd` 到仓库子目录（会话 workdir 随之更新），**当** 工具事件 hook 执行时，**则** hook 进程的 cwd 是该子目录，而 `$WAVE_PROJECT_DIR` 仍是会话创建时的工作目录。
2. **假设** 会话已经 EnterWorktree 进入 worktree，**当** 任何 hook 执行时，**则** `$WAVE_PROJECT_DIR` 仍是会话创建时的工作目录，不切换到 worktree 路径（对齐 `CLAUDE_PROJECT_DIR`）。
3. **假设** 会话 workdir 已被删除（例如手动删掉了 worktree 目录），**当** hook 执行时，**则** 进程在 `$WAVE_PROJECT_DIR` 下启动而不是 spawn 失败。
4. **假设** 调用方没有提供会话根（如 CLI 启动期创建 worktree），**当** hook 执行时，**则** `$WAVE_PROJECT_DIR` 回落到 hook 的 spawn 目录，行为与改动前一致。

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

---

### 用户故事：按来源 Tab 展示钩子（优先级：P1）

作为 GUI 用户，我希望设置页「钩子」选项卡按来源以 Tab 形式展示钩子（用户级 / 项目级 / 插件），其中项目级在「项目级钩子」Tab 下平铺展示（仅当前项目，不做多项目分组），以便快速定位某个来源下的钩子，并知道它属于哪一类（用户 / 项目 / 插件）。

**为什么是这个优先级**：钩子来源决定其适用范围（用户级全局生效 / 项目级仅当前项目），Tab 化让长列表可扫读，与技能页形态统一（2026-08-29 用户拍板：钩子与技能页一致，按来源 Tab + 项目分组卡片展示；钩子创建成功后默认开启，用户可选择关闭；2026-09-01 用户拍板：设置页只针对当前项目，删除项目分组卡片，项目 Tab 直接平铺）。

**独立测试**：在具备用户级、项目级、插件钩子的环境中打开设置页钩子选项卡，验证来源 Tab 存在、项目级钩子在「项目级钩子」Tab 平铺列出并可执行管理操作。

**验收场景**：

1. **假设** 环境中存在用户级、项目级、插件来源的钩子，**当** 钩子选项卡打开，**则** 顶部展示来源 Tab（用户级钩子 / 项目级钩子 / 插件钩子），点击切换显示对应来源的钩子
2. **假设** 存在项目级钩子，**当** 用户位于「项目级钩子」Tab，**则** 钩子平铺展示（不按项目分组、无项目卡片）
3. **假设** 项目 Tab 下存在多个钩子，**当** 列表展示，**则** 列出所有钩子（事件、描述、命令），并提供「编辑」「删除」操作入口
4. **假设** 用户级钩子配置存在，**当** 用户位于「用户级钩子」Tab，**则** 列出 `~/.wave/settings.json` 中定义的所有钩子
5. **假设** 某来源没有任何钩子，**当** 切换到该来源 Tab，**则** 显示空状态提示，不渲染空白分组

---

### 用户故事：新建钩子（优先级：P1）

作为 GUI 用户，我希望在钩子页点击「新增钩子」后打开 AI 对话框并预填一条新建钩子提示词，通过自然语言描述事件、匹配器、命令与超时/异步即可创建钩子，新钩子创建后出现在对应来源分组中。

**为什么是这个优先级**：手动编辑 settings.json 配置钩子门槛高；由 AI 根据自然语言生成配置是用户需求的核心（2026-08-29 用户需求：打开 AI 对话框，给出新建钩子提示词）。

**独立测试**：在钩子页点击「新增钩子」，验证 AI 对话框打开并预填提示词；补充描述发送后钩子配置被写入 settings.json；返回钩子页验证新钩子出现在对应来源分组。

**验收场景**：

1. **假设** 用户在钩子页「用户级钩子」Tab，**当** 用户点击「新增用户级钩子」，**则** 关闭设置页回到会话视图，AI 对话框打开并预填用户级提示词，如 `帮我配一个用户级钩子：<事件>时，<matcher 工具>，跑<命令>，<超时/异步>`
2. **假设** 用户在「项目级钩子」Tab 点击「新增」，**当** 输入框预填，**则** 预填项目级提示词并带上项目名，如 `帮我在【项目名称】新建钩子：<事件>时，<matcher 工具>，跑<命令>，<超时/异步>`
3. **假设** 提示词已预填，**当** 用户补充事件、匹配器、命令与超时/异步后发送，**则** 消息以普通用户消息发送（预填文本可编辑），由 AI 更新对应 settings.json 的 hooks 配置
4. **假设** 钩子创建成功，**当** 钩子列表刷新，**则** 新钩子出现在对应来源分组（Tab）中，并带来源标识（用户 / 项目 / 插件）
5. **假设** 新建的是项目级钩子，**当** 钩子页「项目级钩子」Tab 展示，**则** 新钩子出现在该 Tab 的列表中

---

### 用户故事：编辑钩子（优先级：P2）

作为 GUI 用户，我希望在钩子页点击「编辑」后打开 AI 对话框并预填一条编辑提示词，由 AI 更新钩子配置。

**为什么是这个优先级**：钩子配置修改通过 AI 自然语言描述更顺畅（2026-09-02 用户拍板：移除钩子启停开关与 `enabled` 字段，钩子条目始终执行，无单钩子启停概念——对齐 Claude Code，CC 仅有全局 `disableAllHooks`）。

**独立测试**：在钩子页点击某钩子的「编辑」，验证 AI 对话框打开并预填编辑提示词；补充修改点并发送后钩子配置被更新。

**验收场景**：

1. **假设** 用户在钩子页某钩子条目上，**当** 用户点击「编辑」，**则** 关闭设置页回到会话视图，AI 对话框打开并预填编辑提示词，如 `帮我编辑钩子：把<事件/匹配/命令/超时>改成<新内容>`
2. **假设** 用户点击「编辑」，**则** 对应配置文件（用户级 `~/.wave/settings.json` 或项目 `.wave/settings.json`）同时打开便于对照修改（桌面端在右侧文件面板打开该文件，即消息中 read/edit/write 工具路径点击同款只读面板；IDE 在 VS Code / JetBrains 自身编辑器打开标签页）；该路径由宿主解析为**绝对路径**后随钩子列表回包下发，webview 不自造 `~` / 相对路径——宿主按 OS 绝对路径打开文件、无法展开 `~`
3. **假设** 编辑提示词已预填，**当** 用户补充具体修改点后发送，**则** 消息以普通用户消息发送，由 AI 更新对应 settings.json 的钩子配置
4. **假设** 钩子修改成功，**当** 钩子列表刷新，**则** 钩子的事件、描述、命令反映修改后的内容
5. **假设** 钩子为插件提供，**当** 列表展示，**则** 不提供「编辑」操作（只读来源不可修改）

---

### 用户故事：删除钩子（优先级：P1）

作为 GUI 用户，我希望在钩子页对用户级 / 项目级钩子执行「删除」时先出现二次确认，确认后钩子配置从对应 settings.json 中移除并从列表删除，以便清理不再需要的钩子。

**为什么是这个优先级**：删除配置不可逆，需要确认；用户需求明确「二次确认后删除」且删除不依赖 AI（2026-08-29 用户拍板：确认框 + 直接删除配置）。

**独立测试**：在钩子页点击某钩子「删除」，验证出现确认对话框；确认后钩子配置从 settings.json 移除、列表删除该钩子；取消则无任何变化。

**验收场景**：

1. **假设** 用户在钩子页某用户级 / 项目级钩子条目上，**当** 用户点击「删除」，**则** 弹出二次确认对话框，说明将删除的钩子及其配置文件路径
2. **假设** 确认对话框已显示，**当** 用户点击「取消」或关闭对话框，**则** 不执行删除，钩子保持原样
3. **假设** 确认对话框已显示，**当** 用户点击「确认删除」，**则** 钩子配置从对应 settings.json 中移除，列表删除该钩子，不经过 AI
4. **假设** 删除成功，**当** 钩子列表刷新，**则** 该钩子不再出现在任何来源分组中
5. **假设** 钩子为插件提供，**当** 列表展示，**则** 不提供「删除」入口（只读来源不可删除）

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
- **删除钩子失败怎么办？** host 更新 settings.json 失败（权限不足 / 文件不存在 / JSON 格式错误）时，向 webview 返回错误提示，列表保持修改前状态，不静默失败
- **项目级钩子的目标项目是哪个？** 三端设置页均为单项目模型——展示/管理当前会话 workdir 的项目级配置；「项目级钩子」Tab 平铺展示，无项目分组归属推断（2026-09-01 用户拍板：设置页只针对当前项目）
- **项目级钩子的目标项目是哪个？** 三端设置页均为单项目模型——展示/管理当前会话 workdir 的项目级配置；新建/编辑项目级钩子的目标项目 = 当前对话的 workdir，AI 对话框直接写入该项目目录（2026-08-29 用户拍板：不做跨项目选择）
- **新建/编辑钩子提示词中的 `/settings` 前缀怎么办？** GUI 中 `/settings` 不是可拦截的本地斜杠命令，预填文本作为普通用户消息原样发送给 AI；前缀仅作为自然语言指令的一部分提示 AI 处理钩子配置请求
- **IDE 侧「打开配置文件」与「关闭设置页」的先后顺序？** 两个动作都由设置页入口向宿主发出，且关闭动作会销毁设置页载体（VS Code 设置 WebviewPanel 被 dispose、JetBrains 设置文件编辑器被 close）；**打开文件必须先于关闭设置页发出**，否则销毁后到达的打开请求被丢弃——表现为四个视图（技能 / 子代理 / 钩子 / MCP 服务）点「编辑」都不打开文件（桌面端设置页与聊天共用一个 webview，不涉及此顺序）。同理，配置文件路径缺失时只预填提示词、不打开文件（不自造占位路径）

- **`PostToolUse` 为什么注入一条消息、而不是把工具结果改成失败？** 工具确实已经执行完了，把结果改成失败是在伪造历史；Claude Code 的做法同样是注入一条 `isMeta` 用户消息（`hook_blocking_error` 附件），wave 对齐它——本文件里 hook 注入的 user 消息统统带 `isMeta: true`（对模型可见、UI 不显示）。因此"post 事件能拦下工具"这件事在两端都不成立——要拦必须用 `PreToolUse`。
- **`hookSpecificOutput.additionalContext` 做不做？** **做**（2026-10-13 用户拍板解冻）。原「本次不做」的理由是「它是新能力而不是呈现形态对齐」，实际判反了：会话恢复（`session-hooks.md`）早已用它在 `SessionStart` 注入上下文，其余事件只是把同一通道补齐，差别在**档位**（退出码 2 + stderr 送达的文本会被当成 hook 报错，`additionalContext` 则是非错误的附加上下文）。支持范围严格对齐 Claude Code：`UserPromptSubmit` / `PreToolUse` / `PostToolUse` / `SessionStart`，**不含 `Stop` / `SubagentStop`**。
- **注入的上下文算不算可信指令？** 一律包在 `<system-reminder>` 里注入，与 `SessionStart` 的注入方式一致。它不构成新的信任边界：能写 hook 配置的人（用户 / 项目 / 插件来源）本来就能跑任意命令与脚本，该字段只是把已有能力的结果喂进上下文。模型侧不得把其中文本当作新的用户指令用于提权或跳过权限确认。
- **Claude Code 的另外两个 hook 输出通道做不做？** 本次不做：`updatedToolOutput` / `updatedMCPToolOutput`（改写工具结果）、`PreToolUse` 的 `updatedInput`（改写入参）。它们要改写**既有事实**（已经发生的工具结果、模型已经发出的入参），不是新增一段文本，各自需要单独定安全语义，不裹进这次对齐。
- **`asyncRewake` 的唤醒投给哪个会话？** 投给发起该 hook 的那个会话（按 sessionId 归属），不跨会话投递；该会话已关闭或已被销毁时丢弃并记日志，不新建会话。
- **`asyncRewake` 唤醒会不会与用户正在进行的操作冲突？** 不会覆盖或抢占：会话空闲时它开启新回合，忙碌时它作为排队消息注入，与普通排队消息同序处理；它不改变用户的权限模式，也不跳过任何权限确认。
- **Exec 沙箱内嵌套调用的 hook 归谁管？** 工具事件的 hook 语义只有这一份（本文件），"嵌套调用也要触发"是执行路径的事，写在 `docs/specs/core/exec-tool.md`；两处不得各自定义一套 hook 行为。

### 测试验证需求

- 系统必须通过检查 `agent.sendMessage()` 使 `agent.messages` 包含两条用户角色消息（第二条包含 hook stdout 内容且 `isMeta: true`）来验证 `UserPromptSubmit` 成功
- 系统必须通过检查 `agent.messages` 包含 `ToolBlock`（其失败文本为 `PreToolUse:<工具名> hook error: <stderr>`）来验证 `PreToolUse` 阻止性错误
- 系统必须通过检查 `agent.messages` 包含内容为 `PostToolUse:<工具名> hook blocking error from command: "<命令>": <stderr>` 且 `isMeta: true` 的用户角色消息来验证 `PostToolUse` 错误反馈
- 系统必须通过检查 `agent.messages` 不包含用户角色消息且助手消息中包含以 stderr 为内容的 `ErrorBlock` 来验证 `UserPromptSubmit` 阻止性错误
- 系统必须确保 `ErrorBlock` 内容不被 `packages/agent-sdk/src/utils/convertMessagesForAPI.ts` 处理，使其仅用户可见且不发送给代理
- 系统必须通过检查 `agent.messages` 包含带有 stderr 内容的 `isMeta: true` 用户角色消息来验证 `Stop` hook 阻止行为
