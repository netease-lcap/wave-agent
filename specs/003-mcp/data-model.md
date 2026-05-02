# Data Model: MCP Support

## Configuration

### McpConfig
The root configuration object for MCP.
- `mcpServers`: A record of server names to their configurations.

### McpServerConfig
Configuration for an individual MCP server (SDK format).
- `command`: The executable to run (for stdio transport).
- `args`: (Optional) Arguments for the command.
- `env`: (Optional) Environment variables for the child process.
- `url`: (Optional) Endpoint URL (for http/sse transport).

### ACP McpServer (ACP format)
Configuration from ACP clients, converted to `McpServerConfig`.
- `command` / `args` / `env`: For stdio transport.
- `url`: For http or sse transport.
- `transport`: One of `"stdio"`, `"http"`, `"sse"`.

### Config Merge Precedence
When multiple config sources exist, they are merged with the following precedence (highest to lowest):
1. **Constructor `mcpServers`**: Passed via `AgentOptions.mcpServers` or ACP session setup.
2. **Workspace `.mcp.json`**: Read from the working directory.
3. **Plugin servers**: Added by plugins at agent creation time.

Constructor-provided servers take precedence for duplicate names; workspace servers are appended if not already present; plugin servers form the base.

## Runtime State

### McpServerStatus
Represents the current state of an MCP server.
- `name`: The name of the server.
- `config`: The `McpServerConfig` used to start the server.
- `status`: One of `"disconnected"`, `"connected"`, `"connecting"`, or `"error"`.
- `tools`: (Optional) List of `McpTool` objects available on this server.
- `toolCount`: (Optional) Number of tools available.
- `capabilities`: (Optional) List of capabilities supported by the server (e.g., `"tools"`, `"resources"`).
- `lastConnected`: (Optional) Timestamp of the last successful connection.
- `error`: (Optional) Error message if the status is `"error"`.

### McpTool
Represents a tool provided by an MCP server.
- `name`: The name of the tool (unprefixed).
- `description`: (Optional) Description of what the tool does.
- `inputSchema`: JSON schema for the tool's input arguments.

## Internal Types

### McpConnection
Internal representation of an active connection.
- `client`: The MCP SDK `Client` instance.
- `transport`: The `StdioClientTransport` or `SSEClientTransport` instance.
- `process`: Currently `null` as transports manage the process internally.

## Tool Execution Results
The result of an MCP tool execution.
- `success`: Boolean indicating if the execution was successful.
- `content`: String representation of the result content.
- `serverName`: (Optional) Name of the server that executed the tool.
- `images`: (Optional) Array of image data objects.
  - `data`: Base64 encoded image data.
  - `mediaType`: MIME type of the image.

## ACP Notification
Status updates sent to ACP clients via `ext_notification`.
- `method`: `"mcp_server_status"`
- `params`: `McpServerStatus` object with current server state.

## MCP Capabilities
Advertised in ACP `initialize` response.
- `mcpCapabilities`: `{ transports: ["http", "sse"] }`
