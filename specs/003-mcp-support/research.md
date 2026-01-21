# Research: MCP Support

## Overview
The Model Context Protocol (MCP) is an open protocol that enables seamless integration between AI models and their context sources, including tools, datasets, and services. This research document outlines the current implementation of MCP support in the Wave Agent.

## Current Implementation

### Core Components
- **McpManager**: The central manager for MCP servers. It handles:
  - Loading configuration from `.mcp.json`.
  - Connecting to MCP servers using `StdioClientTransport`.
  - Managing server lifecycles (connect, disconnect, status tracking).
  - Listing and executing tools from connected servers.
- **McpUtils**: Utility functions for:
  - Converting MCP tools to OpenAI function tool format.
  - Cleaning JSON schemas to ensure compatibility with AI models.
  - Creating tool plugin wrappers for MCP tools.
- **Types**: Defined in `packages/agent-sdk/src/types/mcp.ts`, including `McpServerConfig`, `McpConfig`, `McpTool`, and `McpServerStatus`.

### Integration
- **Agent**: Integrates `McpManager` to provide MCP tools to the AI. It initializes the manager with the working directory and auto-connects to configured servers.
- **ToolManager**: Uses `McpManager` to list and execute MCP tools alongside built-in tools. MCP tools are prefixed with `mcp__[serverName]__[toolName]` to avoid name collisions.
- **PluginManager**: Also has access to `McpManager`, allowing plugins to interact with MCP servers.

### Configuration
MCP servers are configured in a `.mcp.json` file located in the agent's working directory. The format follows the standard MCP configuration:
```json
{
  "mcpServers": {
    "server-name": {
      "command": "command-to-run",
      "args": ["arg1", "arg2"],
      "env": {
        "KEY": "VALUE"
      }
    }
  }
}
```

### Tool Execution Flow
1. AI requests a tool with the prefix `mcp__`.
2. `ToolManager` identifies it as an MCP tool and delegates execution to `McpManager`.
3. `McpManager` parses the server name and tool name from the prefixed name.
4. `McpManager` calls the tool on the corresponding MCP server via the established connection.
5. Results (text, images, resources) are collected and returned to the AI.

## Key Features
- **Auto-connection**: Servers configured in `.mcp.json` are automatically connected during agent initialization.
- **Dynamic Management**: Servers can be connected or disconnected at runtime via the `Agent` API.
- **Schema Cleaning**: Automatically removes unsupported fields (like `$schema`, `exclusiveMinimum`) from tool schemas to ensure compatibility with various LLMs.
- **Multi-server Support**: Multiple MCP servers can be connected simultaneously.
- **Image Support**: Handles image data returned by MCP tools.

## Future Considerations
- Support for other transport types (e.g., SSE).
- Enhanced resource and prompt support from MCP.
- Better error handling and recovery for disconnected servers.
- Permission system integration for MCP tools (currently they are treated as regular tools).
