/**
 * Model Context Protocol types
 * Dependencies: None
 */

export interface McpServerConfig {
  command: string;
  args?: string[];
  env?: Record<string, string>;
}

export interface McpConfig {
  mcpServers: Record<string, McpServerConfig>;
}

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
