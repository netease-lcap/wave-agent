# Data Model: MCP Support

## Configuration

### McpConfig
The root configuration object for MCP.
- `mcpServers`: A record of server names to their configurations.

### McpServerConfig
Configuration for an individual MCP server.
- `command`: The executable to run.
- `args`: (Optional) Arguments for the command.
- `env`: (Optional) Environment variables for the child process.

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
- `transport`: The `StdioClientTransport` instance.
- `process`: Currently `null` as `StdioClientTransport` manages the process internally.

## Tool Execution Results
The result of an MCP tool execution.
- `success`: Boolean indicating if the execution was successful.
- `content`: String representation of the result content.
- `serverName`: (Optional) Name of the server that executed the tool.
- `images`: (Optional) Array of image data objects.
  - `data`: Base64 encoded image data.
  - `mediaType`: MIME type of the image.
