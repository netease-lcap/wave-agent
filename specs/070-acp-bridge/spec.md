# Feature Specification: ACP Bridge

**Feature Branch**: `070-acp-bridge`  
**Created**: 2026-03-16  
**Input**: User description: "read @packages/code/src/acp/ and write 070 spec in @specs/"

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Connect External Client via ACP (Priority: P1)

As a developer using an IDE (like VS Code), I want to connect my IDE to Wave Agent using the Agent Control Protocol (ACP) so that I can interact with the agent directly from my editor.

**Why this priority**: This is the core functionality of the ACP bridge. It enables integration with external tools and IDEs.

**Independent Test**: Can be tested by running the agent in ACP mode (e.g., `wave-code acp`) and sending ACP-compliant JSON-RPC messages over `stdin` and verifying the responses on `stdout`.

**Acceptance Scenarios**:

1. **Given** the agent is started in ACP mode, **When** a client sends an `initialize` request, **Then** the agent responds with its capabilities and version information.
2. **Given** the agent is initialized, **When** a client sends a `newSession` request with a `cwd`, **Then** the agent creates a new session in that directory and returns the session ID and available modes.
3. **Given** an active session, **When** a client sends a `prompt` request with text, **Then** the agent processes the prompt and sends back `agent_message_chunk` and `agent_thought_chunk` updates via `sessionUpdate` notifications.

---

### User Story 2 - Handle Tool Permissions via ACP (Priority: P1)

As a user interacting with the agent through an external client, I want to be prompted for tool permissions in my client UI so that I can control what the agent does.

**Why this priority**: Security and user control are critical when the agent is running in an external environment.

**Acceptance Scenarios**:

1. **Given** the agent wants to use a restricted tool (e.g., `Write`), **When** the agent is in `default` mode, **Then** it sends a `requestPermission` request to the client via ACP.
2. **Given** a `requestPermission` request is sent, **When** the user selects "Yes, proceed" in the client, **Then** the agent proceeds with the tool execution.
3. **Given** a `requestPermission` request is sent, **When** the user selects "Cancel" (with reason) in the client, **Then** the agent receives a "denied" response and handles it accordingly.

---

### User Story 3 - Synchronize Tasks and Plans (Priority: P2)

As a user, I want to see the agent's current task list and plan in my external client so that I can track its progress on complex tasks.

**Why this priority**: Provides visibility into the agent's reasoning and progress, which is important for long-running or multi-step tasks.

**Acceptance Scenarios**:

1. **Given** the agent is working on a task, **When** the task list changes (e.g., a task is completed or a new one is added), **Then** the agent sends a `plan` update via `sessionUpdate` to the client.

---

### Edge Cases

- **Connection Closure**: If the ACP connection (stdio) is closed, the agent should clean up all active sessions and resources.
- **Invalid Session ID**: If a client sends a request with an invalid or non-existent session ID, the agent should return an appropriate error.
- **Malformed JSON**: If the client sends malformed JSON over the ACP stream, the bridge should handle it gracefully without crashing.
- **Aborted Messages**: If a client sends a `cancel` notification, the agent should abort the current message processing.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST implement the Agent Control Protocol (ACP) over `stdin`/`stdout` using NDJSON.
- **FR-002**: System MUST support the `initialize` method to report agent capabilities.
- **FR-003**: System MUST support session management: `newSession`, `loadSession`, `listSessions`, and `unstable_closeSession`.
- **FR-004**: System MUST support the `prompt` method for sending text and image inputs to the agent.
- **FR-005**: System MUST support the `cancel` notification to abort current agent operations.
- **FR-006**: System MUST support `requestPermission` for tool execution control.
- **FR-007**: System MUST provide `sessionUpdate` notifications for:
    - `agent_message_chunk`: Streaming assistant response text.
    - `agent_thought_chunk`: Streaming assistant reasoning/thought text.
    - `tool_call`: Notification of a new tool call.
    - `tool_call_update`: Updates on tool call status (pending, in_progress, completed, failed).
    - `plan`: Updates to the agent's task list.
    - `current_mode_update`: Notification of permission mode changes.
    - `available_commands_update`: Notification of available slash commands.
- **FR-008**: System MUST support setting session modes (e.g., `default`, `acceptEdits`, `plan`, `bypassPermissions`) via `setSessionMode` or `setSessionConfigOption`.
- **FR-009**: System MUST provide diffs for `Write` and `Edit` tool calls in the `tool_call` content when possible.
- **FR-010**: System MUST handle `ExitPlanMode` tool calls specially by restricting permission options to "Approve Plan" and "Reject Plan", and automatically transitioning to `default` mode upon approval.
- **FR-011**: System MUST include `plan_content` in the `tool_call` content for `ExitPlanMode` tool calls.

### Key Entities

- **ACP Bridge**: The component that translates between ACP JSON-RPC messages and the Wave Agent SDK.
- **Session**: A stateful interaction context between the client and the agent, tied to a specific working directory.
- **Tool Call**: An attempt by the agent to execute a tool, which may require user permission.
- **Task/Plan**: A list of steps the agent intends to take to fulfill a request.
