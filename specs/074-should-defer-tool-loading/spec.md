# Feature Specification: Deferred Tool Loading (shouldDefer)

**Feature Branch**: `074-should-defer-tool-loading`
**Created**: 2026-05-03
**Input**: Implement `shouldDefer` tool loading pattern matching Claude Code's deferred tool discovery mechanism.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Save context tokens by deferring rarely-used tools (Priority: P1)

As a developer using the AI agent, I want the system to exclude rarely-used tools from the initial API call so that more context tokens are available for the conversation, reducing the risk of context overflow.

**Why this priority**: This is the core benefit of deferred tool loading — saving tokens for more relevant context.

**Independent Test**: Can be verified by checking that deferred tools (e.g., `CronCreate`, `WebFetch`, `EnterWorktree`) do NOT appear in the API call's `tools` parameter until discovered via `ToolSearch`.

**Acceptance Scenarios**:

1. **Given** the agent is initialized with deferred tools, **When** the first AI cycle makes an API call, **Then** the `tools` parameter should NOT include any deferred tools except `ToolSearch`.
2. **Given** `ToolSearch` has returned the schema for `CronCreate`, **When** the next AI cycle makes an API call, **Then** the `tools` parameter should include `CronCreate` alongside non-deferred tools.

---

### User Story 2 - Discover deferred tools via ToolSearch (Priority: P1)

As the AI model, I want to discover a deferred tool's full schema via `ToolSearch` so that I can invoke it correctly with proper parameters.

**Why this priority**: Without tool discovery, the model cannot invoke deferred tools since their schemas are not in the initial prompt.

**Independent Test**: Can be tested by calling `ToolSearch` with `query="select:CronCreate"` and verifying the full JSONSchema is returned.

**Acceptance Scenarios**:

1. **Given** `CronCreate` is a deferred tool, **When** I call `ToolSearch` with `query="select:CronCreate"`, **Then** the result should include `CronCreate`'s full function name, description, and parameter schema.
2. **Given** multiple tools match a keyword query, **When** I call `ToolSearch` with `query="cron"`, **Then** the result should include all matching cron tools (`CronCreate`, `CronDelete`, `CronList`) ranked by relevance.

---

### User Story 3 - MCP tools are auto-deferred (Priority: P2)

As a user who connects to MCP servers, I want MCP tools to be automatically deferred so that they don't consume context tokens until the AI model actually needs them.

**Why this priority**: MCP servers can provide many tools; loading all of them upfront wastes significant context tokens.

**Independent Test**: Can be verified by connecting an MCP server and checking that MCP tools are excluded from the initial API call.

**Acceptance Scenarios**:

1. **Given** an MCP server is connected with 10 tools, **When** the agent makes an API call, **Then** none of the MCP tools should appear in the `tools` parameter until discovered via `ToolSearch`.

---

### Edge Cases

- **ToolSearch always available**: `ToolSearch` itself must NEVER be deferred; it must always be in the API call so the model can discover other tools.
- **Discovery persists across turns**: Once a tool is discovered, it should remain available for subsequent turns in the same session.
- **select: fallback to non-deferred**: If `select:ToolName` queries a non-deferred tool, the schema should still be returned.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Tools marked with `shouldDefer: true` MUST be excluded from the API call's `tools` parameter until discovered.
- **FR-002**: MCP tools MUST be automatically treated as deferred (`isMcp: true` implies deferral).
- **FR-003**: `ToolSearch` tool MUST always be available (never deferred) so the model can discover other tools.
- **FR-004**: The system prompt MUST list deferred tool names in `<available-deferred-tools>` so the model knows they exist.
- **FR-005**: `ToolSearch` MUST support `select:ToolName` query format for direct tool selection.
- **FR-006**: `ToolSearch` MUST support keyword search with relevance scoring.
- **FR-007**: `ToolSearch` MUST support `+prefix` syntax for required terms that must all match.
- **FR-008**: Once a tool is discovered, it MUST remain available for all subsequent turns in the session.
- **FR-009**: `ToolSearch` MUST return tool schemas in `<functions>` block format matching Claude Code's output.

### Key Entities

- **Deferred Tool**: A tool whose schema is not sent to the API until discovered via `ToolSearch`.
  - **shouldDefer**: Boolean flag on the tool configuration.
  - **isMcp**: Boolean flag indicating the tool is from an MCP server (auto-deferred).
  - **alwaysLoad**: Boolean flag to force a tool to always be loaded (overrides `shouldDefer`).
- **ToolSearch**: A built-in tool that discovers deferred tool schemas on demand.
  - **Query formats**: `select:ToolName`, keyword search, `+required optional`.
  - **Scoring**: Exact part match (10 pts), partial match (5 pts), MCP tools get higher weight (12/6 pts), description match (2 pts).
- **Discovered Tools Set**: A session-level Set tracking which deferred tools have been discovered and should be included in subsequent API calls.
