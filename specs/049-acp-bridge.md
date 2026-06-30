# 功能规格说明：ACP Bridge

**特性分支**：`049-acp-bridge`
**创建日期**：2026-03-16

## 用户场景与测试 *（必填）*

### 用户故事 1 - 通过 ACP 连接外部客户端（优先级：P1）

作为使用 IDE（如 VS Code）的开发者，我希望使用 Agent Control Protocol（ACP）将 IDE 连接到 Wave Agent，以便可以直接从编辑器与 agent 交互。

**为什么是这个优先级**：这是 ACP bridge 的核心功能。它支持与外部工具和 IDE 的集成。

**独立测试**：可以通过以 ACP 模式运行 agent（例如 `wave-code acp`）并通过 `stdin` 发送符合 ACP 的 JSON-RPC 消息并验证 `stdout` 上的响应来进行测试。

**验收场景**：

1. **假设** agent 以 ACP 模式启动，**当**客户端发送 `initialize` 请求时，**则** agent 以其能力和版本信息响应。
2. **假设** agent 已初始化，**当**客户端发送带有 `cwd` 的 `newSession` 请求时，**则** agent 在该目录中创建新会话并返回会话 ID 和可用模式。
3. **假设**有活跃会话，**当**客户端发送带有文本的 `prompt` 请求时，**则** agent 处理提示并通过 `sessionUpdate` 通知发回 `agent_message_chunk` 和 `agent_thought_chunk` 更新。
4. **假设**有活跃会话，**当**客户端发送带有 `resource_link` 块的 `prompt` 请求时，**则** agent 接收带有 markdown 格式链接（例如 `[name](uri)`）的提示，并可以使用其工具读取引用的资源。

---

### 用户故事 2 - 通过 ACP 处理工具权限（优先级：P1）

作为通过外部客户端与 agent 交互的用户，我希望在客户端 UI 中被提示工具权限，以便控制 agent 的操作。

**为什么是这个优先级**：当 agent 在外部环境中运行时，安全性和用户控制至关重要。

**验收场景**：

1. **假设** agent 想要使用受限工具（例如 `Write`），**当** agent 处于 `default` 模式时，**则**它通过 ACP 向客户端发送 `requestPermission` 请求。
2. **假设**已发送 `requestPermission` 请求，**当**用户在客户端中选择"Yes, proceed"时，**则** agent 继续执行工具。
3. **假设**已发送 `requestPermission` 请求，**当**用户在客户端中选择"Cancel"（附带原因）时，**则** agent 收到"denied"响应并相应处理。

---

### 用户故事 3 - 同步任务和计划（优先级：P2）

作为用户，我希望在外部客户端中看到 agent 的当前任务列表和计划，以便跟踪其在复杂任务上的进度。

**为什么是这个优先级**：提供对 agent 推理和进度的可见性，这对长时间运行或多步骤任务很重要。

**验收场景**：

1. **假设** agent 正在处理任务，**当**任务列表发生变化（例如任务完成或新任务添加）时，**则** agent 通过 `sessionUpdate` 向客户端发送 `plan` 更新。

---

### 用户故事 4 - 通过 ACP 支持 MCP 服务器（优先级：P2）

作为 ACP 客户端，我希望在创建或加载会话时提供 MCP 服务器配置，以便 agent 可以使用来自这些服务器的外部工具。

**为什么是这个优先级**：使 ACP 客户端能够以编程方式配置 MCP 服务器，而不依赖磁盘上的 `.mcp.json` 文件。

**验收场景**：

1. **假设** agent 已初始化，**当**客户端发送带有 `mcpServers` 的 `newSession` 请求时，**则** agent 连接到这些 MCP 服务器并使其工具可用。
2. **假设**有带 MCP 服务器的活跃会话，**当** MCP 服务器的连接状态变化时，**则** agent 通过 `sessionUpdate` 向客户端发送 `mcp_server_status` 更新。

---

### 用户故事 5 - 结构化交互的扩展方法（优先级：P2）

作为 ACP 客户端开发者，我希望接收结构化的扩展方法调用来处理问题和计划批准，以便我可以渲染适当的 UI 而不是解析权限选项。

**为什么是这个优先级**：改善客户端开发者体验，并支持超越通用权限请求机制的更丰富 UI 交互。

**验收场景**：

1. **假设** agent 调用 `AskUserQuestion`，**当**客户端支持 `wave/ask_question` 时，**则**客户端接收带选项的结构化问题并返回所选答案。
2. **假设** agent 调用 `ExitPlanMode`，**当**客户端支持 `wave/create_plan` 时，**则**客户端接收带有 todo 的计划内容并返回接受/拒绝。
3. **假设**客户端不支持某个扩展方法，**当** agent 调用它时，**则** agent 回退到标准的 `requestPermission` 机制。

---

### 边界情况

- **连接关闭**：如果 ACP 连接（stdio）被关闭，agent 应清理所有活动会话和资源。
- **无效会话 ID**：如果客户端发送带有无效或不存在的会话 ID 的请求，agent 应返回适当的错误。
- **格式错误的 JSON**：如果客户端通过 ACP 流发送格式错误的 JSON，bridge 应优雅处理而不崩溃。
- **中止消息**：如果客户端发送 `cancel` 通知，agent 应中止当前消息处理。

## 需求 *（必填）*

### 功能需求

- **FR-001**：系统必须使用 NDJSON 在 `stdin`/`stdout` 上实现 Agent Control Protocol（ACP）。
- **FR-002**：系统必须支持 `initialize` 方法来报告 agent 能力。
- **FR-003**：系统必须支持会话管理：`newSession`、`loadSession`、`listSessions` 和 `unstable_closeSession`。
- **FR-004**：系统必须支持 `prompt` 方法用于向 agent 发送文本和图像输入。
- **FR-005**：系统必须支持 `cancel` 通知以中止当前 agent 操作。
- **FR-006**：系统必须支持 `requestPermission` 用于工具执行控制。
- **FR-007**：系统必须提供 `sessionUpdate` 通知用于：
    - `agent_message_chunk`：流式助手响应文本。
    - `agent_thought_chunk`：流式助手推理/思考文本。
    - `tool_call`：新工具调用的通知。
    - `tool_call_update`：工具调用状态的更新（pending、in_progress、completed、failed）。
    - `plan`：agent 任务列表的更新。
    - `current_mode_update`：权限模式更改的通知。
    - `available_commands_update`：可用斜杠命令的通知。
- **FR-008**：系统必须支持通过 `setSessionMode` 或 `setSessionConfigOption` 设置会话模式（例如 `default`、`acceptEdits`、`plan`、`bypassPermissions`）。
- **FR-009**：系统必须在可能的情况下为 `Write` 和 `Edit` 工具调用在 `tool_call` 内容中提供 diff。
- **FR-010**：系统必须特殊处理 `ExitPlanMode` 工具调用，将权限选项限制为"Approve Plan"和"Reject Plan"，并在批准后自动转换到 `default` 模式。
- **FR-011**：系统必须在 `ExitPlanMode` 工具调用的 `tool_call` 内容中包含 `plan_content`。
- **FR-012**：系统必须支持 `prompt` 方法中的 `resource_link` 和 `resource` 块，将它们格式化为 markdown 风格的链接 `[name](uri)` 或 `[Resource](uri)` 以向 agent 提供上下文。
- **FR-013**：系统必须使用换行符连接提示内容块以分隔不同的内容块（text、resource_link、resource）。
- **FR-014**：系统必须在初始化期间在 `promptCapabilities` 中公布对 `image` 和 `embeddedContext` 的支持。
- **FR-015**：系统必须在 `initialize` 响应中公布 `mcpCapabilities`（http + sse），以通知客户端支持的 MCP 传输类型。
- **FR-016**：系统必须在 `newSession` 和 `loadSession` 请求中接受 `mcpServers`，将它们从 ACP 格式转换为 SDK `McpServerConfig`，并传递给 `Agent.create()`。
- **FR-017**：当 MCP 服务器状态变化时（connected、disconnected、connecting、error），系统必须通过 `sessionUpdate` 发送 `mcp_server_status` 更新。

### 关键实体

- **ACP Bridge**：在 ACP JSON-RPC 消息和 Wave Agent SDK 之间进行翻译的组件。
- **Session**：客户端和 agent 之间的有状态交互上下文，绑定到特定的工作目录。
- **Tool Call**：agent 尝试执行工具，可能需要用户权限。
- **Task/Plan**：agent 为满足请求而打算采取的步骤列表。
