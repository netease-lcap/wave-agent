/**
 * Model Context Protocol types
 * Dependencies: None
 */

export interface McpServerConfig {
  type?: "stdio" | "sse" | "http";
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
  headers?: Record<string, string>;
  /** Internal: plugin directory path when the server is registered by a plugin */
  pluginRoot?: string;
  /**
   * Tool names (as declared by the server, without the `mcp__` prefix) that must
   * always be declared individually instead of participating in deferred
   * loading — the escape hatch for tools whose parameters need the full schema.
   * The other tools of the same server are unaffected.
   */
  alwaysLoadTools?: string[];
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
  /** Pre-resolution URL with template variables preserved for safe display */
  originalUrl?: string;
  /** Config source: user (~/.wave/mcp.json), project (<workdir>/.mcp.json),
   *  or plugin (registered from a plugin manifest) */
  scope?: "user" | "project" | "plugin";
  status:
    | "disconnected"
    | "connected"
    | "connecting"
    | "reconnecting"
    | "error";
  tools?: McpTool[];
  toolCount?: number;
  capabilities?: string[];
  lastConnected?: number;
  error?: string;
}
