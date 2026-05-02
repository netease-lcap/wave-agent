# Feature Specification: MCP Support

**Feature Branch**: `003-mcp`
**Created**: 2026-01-21
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

### User Story 3 - Pass MCP Servers via Agent Constructor (Priority: P2)

As a developer integrating the SDK, I want to pass MCP server configurations directly to the `Agent` constructor so that I can configure servers programmatically without relying on a `.mcp.json` file.

**Why this priority**: Enables programmatic MCP configuration for SDK consumers (e.g., ACP bridge, custom integrations).

**Independent Test**: Create an `Agent` with `mcpServers` in options and verify servers connect without a `.mcp.json` file.

**Acceptance Scenarios**:

1. **Given** `mcpServers` is passed to `Agent.create()`, **When** the agent initializes, **Then** those servers MUST be registered and connected automatically.
2. **Given** both constructor `mcpServers` and a `.mcp.json` file exist, **When** the agent loads config, **Then** constructor-provided servers MUST take precedence for duplicate names.

---

### User Story 4 - ACP Clients Configure MCP Servers (Priority: P2)

As an ACP client, I want to specify MCP servers when creating or loading a session so that the agent connects to my configured servers automatically.

**Why this priority**: Enables ACP protocol users (e.g., external IDEs) to manage MCP servers through the session lifecycle.

**Independent Test**: Create an ACP session with `mcpServers` in `newSession` and verify the agent connects and reports status via `ext_notification`.

**Acceptance Scenarios**:

1. **Given** an ACP `newSession` request includes `mcpServers`, **When** the session starts, **Then** the agent MUST convert the ACP server formats (stdio/http/sse) and connect them.
2. **Given** a connected MCP server, **When** server status changes, **Then** the ACP bridge MUST send an `ext_notification` with `mcp_server_status` to the client.
3. **Given** the agent initializes with MCP support, **When** it responds to `initialize`, **Then** it MUST advertise `mcpCapabilities` (http + sse).

---

### Edge Cases

- **Server Crash**: If an MCP server process terminates unexpectedly, the `McpManager` MUST detect the transport error and update the server status to `error`.
- **Tool Name Collisions**: Tools with the same name from different servers are handled by prefixing them with `mcp__[serverName]__[toolName]`.
- **Unsupported Schema Fields**: MCP tool schemas containing fields like `$schema`, `exclusiveMinimum`, or `exclusiveMaximum` MUST be cleaned to ensure compatibility with LLM APIs.
- **Invalid Configuration**: If `.mcp.json` is malformed, the agent SHOULD log an error and proceed without MCP tools.
- **Config Merge**: When multiple config sources exist (constructor, `.mcp.json`, plugins), they are merged with precedence: constructor > workspace (.mcp.json) > plugin servers.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST support loading MCP server configurations from `.mcp.json` in the working directory.
- **FR-002**: System MUST use `StdioClientTransport` or `SSEClientTransport` to communicate with MCP servers.
- **FR-010**: System MUST support remote MCP servers via SSE (Server-Sent Events) by providing a `url` in the configuration.
- **FR-003**: MCP tools MUST be registered in the `ToolManager` with the prefix `mcp__[serverName]__[toolName]`.
- **FR-004**: MCP tool schemas MUST be cleaned of unsupported fields (`$schema`, `exclusiveMinimum`, `exclusiveMaximum`).
- **FR-005**: `McpManager` MUST track the status of each server (connected, disconnected, error).
- **FR-006**: `Agent` class MUST provide methods to get server status and manually manage connections.
- **FR-007**: MCP tool execution results MUST support text, images, and resources.
- **FR-008**: MCP tools MUST trigger permission requests before execution, consistent with built-in restricted tools.
- **FR-009**: System MUST support persistent "Allow always" rules for MCP tools, stored in the format `mcp__[serverName]__[toolName]`.
- **FR-011**: `AgentOptions` MUST accept an optional `mcpServers` field to pass MCP server configurations directly at construction time.
- **FR-012**: When multiple config sources exist (constructor `mcpServers`, `.mcp.json`, plugin-added servers), they MUST be merged with precedence: constructor > workspace > plugin.
- **FR-013**: ACP bridge MUST accept `mcpServers` in `newSession` and `loadSession` requests, converting ACP `McpServer[]` to SDK `McpServerConfig` format (supporting stdio, http, sse transports).
- **FR-014**: ACP bridge MUST send `ext_notification` with `mcp_server_status` event type when MCP server status changes.
- **FR-015**: ACP `initialize` response MUST include `mcpCapabilities` advertising support for http and sse transports.

### Key Entities *(include if feature involves data)*

- **McpServer**: Represents an external MCP server process or remote endpoint.
    - `name`: Unique identifier for the server.
    - `command`: Executable to run (for stdio).
    - `args`: Command-line arguments (for stdio).
    - `env`: Environment variables (for stdio).
    - `url`: Endpoint URL (for SSE).
    - `status`: Current connection state.
    - `transport`: Transport type (`stdio`, `http`, `sse`). (ACP format)
- **McpTool**: A tool provided by an MCP server.
    - `name`: Original tool name.
    - `registryName`: Prefixed name used in the agent (`mcp__[serverName]__[toolName]`).
    - `schema`: JSON schema for tool arguments.

## Assumptions

- MCP servers can be local processes (stdio) or remote endpoints (http/sse).
- The agent has sufficient permissions to execute the commands specified in `.mcp.json`.
- The `.mcp.json` file is located in the agent's working directory.
- MCP server configs can be provided via multiple sources: constructor options, workspace `.mcp.json`, plugin configuration, or ACP session setup.
