# Quickstart: Using MCP with Wave Agent

## 1. Create Configuration
Create a `.mcp.json` file in your project's working directory:

```json
{
  "mcpServers": {
    "everything": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-everything"]
    }
  }
}
```

## 2. Initialize Agent
The agent will automatically connect to the configured MCP servers during initialization.

```typescript
import { Agent } from "@wave-ai/agent-sdk";

const agent = await Agent.create({
  workdir: process.cwd(),
  // other options...
});
```

## 3. Use MCP Tools
The AI can now use tools from the connected MCP servers. You can also manually interact with MCP servers via the agent API:

```typescript
// Get status of all MCP servers
const servers = agent.getMcpServers();
console.log(servers);

// Manually connect to a server
await agent.connectMcpServer("everything");

// Manually disconnect from a server
await agent.disconnectMcpServer("everything");
```

## 4. Tool Naming
MCP tools are automatically prefixed to avoid collisions:
`mcp__[serverName]__[toolName]`

For example, the `echo` tool from the `everything` server would be named:
`mcp__everything__echo`

## 5. Handling Results
MCP tools can return text and images. The Wave Agent handles these automatically and provides them to the AI model.
