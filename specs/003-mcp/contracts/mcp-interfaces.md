# MCP Interfaces

## SDK Configuration

```typescript
export interface McpServerConfig {
  type?: "stdio" | "sse" | "http";
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
  headers?: Record<string, string>;
  /** Internal: plugin directory path when the server is registered by a plugin */
  pluginRoot?: string;
}

export interface McpConfig {
  mcpServers: Record<string, McpServerConfig>;
}
```

## ACP McpServer (Input from ACP Clients)

```typescript
export interface McpServer {
  name: string;
  command?: string;
  args?: string[];
  env?: Array<{ name: string; value: string }>;
  url?: string;
  headers?: Array<{ name: string; value: string }>;
  type?: "stdio" | "http" | "sse";
}
```

## Runtime Status

```typescript
export interface McpTool {
  name: string;
  description?: string;
  inputSchema: Record<string, unknown>;
}

export interface McpServerStatus {
  name: string;
  config: McpServerConfig;
  /** Pre-resolution URL with template variables preserved for safe display */
  originalUrl?: string;
  status: "disconnected" | "connected" | "connecting" | "reconnecting" | "error";
  tools?: McpTool[];
  toolCount?: number;
  capabilities?: string[];
  lastConnected?: number;
  error?: string;
}
```

## Manager Callbacks

```typescript
export interface McpManagerCallbacks {
  onMcpServersChange?: (servers: McpServerStatus[]) => void;
}
```

## Agent Options

```typescript
export interface AgentOptions {
  // ... other options
  mcpServers?: Record<string, McpServerConfig>;
}
```

## McpManager Options

```typescript
export interface McpManagerOptions {
  callbacks?: McpManagerCallbacks;
  logger?: Logger;
  mcpServers?: Record<string, McpServerConfig>;
}
```

## ACP Capabilities (in initialize response)

```typescript
{
  capabilities: {
    mcpCapabilities: {
      http: true,
      sse: true
    }
  }
}
```

## Transport Dispatch (connectServer)

When connecting an MCP server, the `type` field in `McpServerConfig` determines the transport:

| `type` value | Transport | Required fields |
|---|---|---|
| `"http"` | `StreamableHTTPClientTransport` | `url` |
| `"sse"` | `SSEClientTransport` | `url` |
| `"stdio"` | `StdioClientTransport` | `command` |
| _(omitted)_ + `url` | `StreamableHTTPClientTransport` (default) | `url` |
| _(omitted)_ + `command` | `StdioClientTransport` (default) | `command` |
| unknown | _throws error_ | — |

**No fallback**: When `type` is `"http"` (or defaulted), a failed Streamable HTTP connection does NOT fall back to SSE. Users must set `type: "sse"` explicitly.
