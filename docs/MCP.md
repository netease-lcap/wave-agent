# MCP (Model Context Protocol) Support

The code package now supports MCP (Model Context Protocol) to extend the available tools through external MCP servers.

## How to Use MCP

### 1. Create MCP Configuration

Create a `mcp.json` file in your project root directory with the following structure:

```json
{
  "mcpServers": {
    "server-name": {
      "command": "command-to-run",
      "args": ["arg1", "arg2"],
      "type": "stdio",
      "env": {
        "ENV_VAR": "value"
      }
    }
  }
}
```

### 2. Configuration Options

- **command**: The command to execute the MCP server
- **args**: Arguments to pass to the command
- **type**: Transport type (`stdio` or `sse`)
- **env**: Environment variables to set for the server
- **url**: Required for SSE servers

### 3. Example Configuration

See `examples/mcp.json` for a complete example with common MCP servers.

### 4. Available MCP Servers

Popular MCP servers you can use:

- **@modelcontextprotocol/server-filesystem**: File system operations
- **@modelcontextprotocol/server-brave-search**: Web search using Brave
- **@modelcontextprotocol/server-github**: GitHub API access
- **@modelcontextprotocol/server-postgres**: PostgreSQL database access
- **@modelcontextprotocol/server-sqlite**: SQLite database access
- **@modelcontextprotocol/server-memory**: Persistent memory for conversations

### 5. How It Works

1. On startup, the application looks for `mcp.json` in your working directory
2. If found, it connects to all configured MCP servers
3. Tools from MCP servers are made available alongside built-in tools
4. MCP tool names are prefixed with the server name (e.g., `github_search_repositories`)
5. The AI can use these tools just like built-in tools

### 6. Tool Naming

MCP tools are automatically prefixed with the server name to avoid conflicts:
- Server name: `github`
- Tool name: `search_repositories`
- Final tool name: `github_search_repositories`

### 7. Error Handling

- If MCP configuration is missing or invalid, the application continues with built-in tools only
- If an MCP server fails to connect, it's logged as a warning and other servers continue
- Tool execution errors are reported back to the AI for handling

### 8. Debugging

To debug MCP issues:
1. Check the console output for MCP connection messages
2. Verify your MCP server commands work independently
3. Ensure all required environment variables are set
4. Test with a simple MCP server first

### 9. Example Usage

After configuring MCP servers, you can use them in your conversations:

```
User: Search for React repositories on GitHub
AI: I'll search for React repositories using the GitHub MCP server.
[Uses github_search_repositories tool]
```

### 10. Security Notes

- MCP servers run with the same permissions as the main application
- Be cautious with servers that have file system or network access
- Review MCP server code before using in production environments
- Use environment variables for sensitive configuration like API keys