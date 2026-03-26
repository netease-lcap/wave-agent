# Model Context Protocol (MCP) Configuration

The Model Context Protocol (MCP) allows Wave to connect to external servers that provide additional tools and context. This document explains how to configure and use MCP servers in Wave.

## Configuration File: `.mcp.json`

MCP servers are configured in a `.mcp.json` file. Wave looks for this file in your project root:

1.  **Project Scope**: `.mcp.json` in your project root (Project-specific MCP servers)

## Configuration Structure

The `.mcp.json` file contains a list of MCP server configurations.

```json
{
  "mcpServers": {
    "sqlite": {
      "command": "uvx",
      "args": ["mcp-server-sqlite", "--db-path", "/path/to/your/database.db"]
    },
    "github": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-github"],
      "env": {
        "GITHUB_PERSONAL_ACCESS_TOKEN": "your-token-here"
      }
    }
  }
}
```

### Fields for each server:

- `command`: The executable to run (e.g., `npx`, `uvx`, `python`, `node`).
- `args`: An array of command-line arguments for the executable.
- `env`: (Optional) A record of environment variables for the server process.

## Using MCP Tools

Once configured, Wave will automatically connect to the MCP servers when it starts. Tools provided by these servers will be available to the agent with a prefix:

`mcp__[serverName]__[toolName]`

For example, if you have a server named `sqlite` with a tool named `query`, it will be available as `mcp__sqlite__query`.

## Permissions for MCP Tools

By default, MCP tools require user permission before execution. When you grant permission, you can choose to "Allow always" for a specific tool. These persistent rules are stored in your `settings.json` under the `permissions` field.

## Troubleshooting

- **Server Connection**: If a server fails to connect, Wave will log an error. You can check the status of MCP servers by asking the agent.
- **Tool Availability**: If a tool is not appearing, ensure the server is running and the `.mcp.json` configuration is correct.
- **Logs**: MCP server `stderr` is often used for logging and can be helpful for debugging connection issues.
