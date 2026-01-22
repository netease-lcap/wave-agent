# Feature Specification: MCP Support

**Feature Branch**: `003-mcp-support`
**Created**: 2026-01-21
**Status**: Implemented
**Input**: User description: "Provide a robust and extensible implementation of the Model Context Protocol (MCP) within the Wave Agent, allowing it to leverage external tools and context sources seamlessly."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Use External Tools via MCP (Priority: P1)

As a developer, I want to connect the agent to external MCP servers so that I can use specialized tools (like weather, database access, or custom scripts) that are not built into the agent.

**Why this priority**: This is the core functionality of MCP support, enabling extensibility.

**Independent Test**: Connect to a simple MCP server (e.g., a "hello world" server) and verify the agent can list and call its tools.

**Acceptance Scenarios**:

1. **Given** a valid `.mcp.json` configuration, **When** the agent starts, **Then** it MUST attempt to connect to the defined MCP servers.
2. **Given** a connected MCP server, **When** the agent lists tools, **Then** it MUST include the MCP tools with the `mcp__` prefix.
3. **Given** an AI decides to call an MCP tool, **When** the tool is executed, **Then** the request MUST be sent to the correct MCP server and the result returned to the AI.

---

### User Story 2 - Manage MCP Server Lifecycle (Priority: P2)

As a user, I want to manually connect or disconnect MCP servers and check their status so that I can troubleshoot connection issues or manage resources.

**Why this priority**: Provides necessary control and visibility over external dependencies.

**Independent Test**: Use `agent.getMcpServers()` to check status and `agent.connectMcpServer()` to reconnect a failed server.

**Acceptance Scenarios**:

1. **Given** an MCP server is configured, **When** `getMcpServers()` is called, **Then** it MUST return the current status (connected, error, etc.).
2. **Given** a disconnected server, **When** `connectMcpServer()` is called, **Then** it MUST attempt to re-establish the connection.

---

### Edge Cases

- **Server Crash**: If an MCP server process terminates unexpectedly, the `McpManager` MUST detect the transport error and update the server status to `error`.
- **Tool Name Collisions**: Tools with the same name from different servers are handled by prefixing them with `mcp__[serverName]__[toolName]`.
- **Unsupported Schema Fields**: MCP tool schemas containing fields like `$schema`, `exclusiveMinimum`, or `exclusiveMaximum` MUST be cleaned to ensure compatibility with LLM APIs.
- **Invalid Configuration**: If `.mcp.json` is malformed, the agent SHOULD log an error and proceed without MCP tools.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST support loading MCP server configurations from `.mcp.json` in the working directory.
- **FR-002**: System MUST use `StdioClientTransport` to communicate with MCP servers.
- **FR-003**: MCP tools MUST be registered in the `ToolManager` with the prefix `mcp__[serverName]__[toolName]`.
- **FR-004**: MCP tool schemas MUST be cleaned of unsupported fields (`$schema`, `exclusiveMinimum`, `exclusiveMaximum`).
- **FR-005**: `McpManager` MUST track the status of each server (connected, disconnected, error).
- **FR-006**: `Agent` class MUST provide methods to get server status and manually manage connections.
- **FR-007**: MCP tool execution results MUST support text, images, and resources.

### Key Entities *(include if feature involves data)*

- **McpServer**: Represents an external MCP server process.
    - `name`: Unique identifier for the server.
    - `command`: Executable to run.
    - `args`: Command-line arguments.
    - `env`: Environment variables.
    - `status`: Current connection state.
- **McpTool**: A tool provided by an MCP server.
    - `name`: Original tool name.
    - `registryName`: Prefixed name used in the agent (`mcp__[serverName]__[toolName]`).
    - `schema`: JSON schema for tool arguments.

## Assumptions

- MCP servers are local processes communicating via stdio.
- The agent has sufficient permissions to execute the commands specified in `.mcp.json`.
- The `.mcp.json` file is located in the agent's working directory.
