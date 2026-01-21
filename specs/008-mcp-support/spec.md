# Spec: MCP Support

## Goal
Provide a robust and extensible implementation of the Model Context Protocol (MCP) within the Wave Agent, allowing it to leverage external tools and context sources seamlessly.

## Architecture

### McpManager
The `McpManager` is responsible for the lifecycle of MCP server connections and tool execution.

#### Key Responsibilities:
- **Configuration Management**: Load and save `.mcp.json` configuration.
- **Connection Management**: Establish and maintain connections to MCP servers using `StdioClientTransport`.
- **Tool Discovery**: List available tools from connected servers.
- **Tool Execution**: Execute tools and format results for the AI.
- **Status Tracking**: Maintain the state of each configured server (connected, disconnected, error, etc.).

### Tool Integration
MCP tools are integrated into the agent's tool registry via the `ToolManager`.

#### Naming Convention:
To prevent name collisions and identify the source server, MCP tools are registered with a prefixed name:
`mcp__[serverName]__[toolName]`

#### Schema Compatibility:
MCP tool schemas are cleaned to remove fields not supported by common LLM APIs (e.g., OpenAI, Gemini). This includes removing `$schema`, `exclusiveMinimum`, and `exclusiveMaximum`.

### Agent API
The `Agent` class provides high-level methods for interacting with MCP:
- `getMcpServers()`: Returns the status of all configured MCP servers.
- `connectMcpServer(serverName)`: Manually connect to a server.
- `disconnectMcpServer(serverName)`: Manually disconnect from a server.

## Data Flow

### Initialization
1. `Agent.create()` is called.
2. `McpManager` is instantiated.
3. `agent.initialize()` calls `mcpManager.initialize(workdir, true)`.
4. `McpManager` loads `.mcp.json`.
5. `McpManager` attempts to connect to all servers defined in the config.
6. For each successful connection, tools are listed and stored.

### Tool Execution
1. AI decides to call a tool (e.g., `mcp__weather__get_forecast`).
2. `ToolManager.execute()` is called.
3. `ToolManager` detects the `mcp__` prefix.
4. `ToolManager` calls `mcpManager.executeMcpToolByRegistry()`.
5. `McpManager` identifies the server (`weather`) and tool (`get_forecast`).
6. `McpManager` sends the request to the MCP server via `StdioClientTransport`.
7. The server returns the result.
8. `McpManager` parses the result (handling text, images, and resources).
9. The result is returned to the AI.

## Configuration
The `.mcp.json` file should be located in the agent's working directory.

```json
{
  "mcpServers": {
    "my-server": {
      "command": "node",
      "args": ["path/to/server.js"],
      "env": {
        "API_KEY": "secret"
      }
    }
  }
}
```

## Error Handling
- Connection failures are logged, and the server status is set to `error`.
- Tool execution failures return an error message to the AI.
- Transport errors (e.g., process crashes) are caught and update the server status.

## Security
- MCP servers run as child processes with the same permissions as the agent.
- Environment variables can be passed to MCP servers via configuration.
- Future: Integration with the agent's permission system to restrict which MCP tools can be called.
