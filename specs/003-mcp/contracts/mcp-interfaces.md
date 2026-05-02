# MCP Interfaces

## SDK Configuration

```typescript
export interface McpServerConfig {
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
}

export interface McpConfig {
  mcpServers: Record<string, McpServerConfig>;
}
```

## ACP McpServer (Input from ACP Clients)

```typescript
export interface McpServer {
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
  transport?: "stdio" | "http" | "sse";
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
  status: "disconnected" | "connected" | "connecting" | "error";
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
  onServersChange?: (servers: McpServerStatus[]) => void;
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
      transports: ["http", "sse"];
    }
  }
}
```
