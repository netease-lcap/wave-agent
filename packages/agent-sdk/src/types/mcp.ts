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
}

export interface McpConfig {
  mcpServers: Record<string, McpServerConfig>;
}

export interface McpTool {
  name: string;
  description?: string;
  inputSchema: Record<string, unknown>;
  /**
   * The schema the server declared for its *output*, raw as listed. Not passed
   * through `cleanSchema` like `inputSchema`: that cleaning exists because the
   * input schema travels inside a request, and this one is only ever rendered as
   * a return type. Absent for most servers today, and degenerate
   * (`{ type: "object" }`) when present.
   */
  outputSchema?: Record<string, unknown>;
}

/**
 * What one MCP tool call produced. Two audiences, two fields:
 *
 * - `content` is the display text the flat path hands the model — a placeholder
 *   when the tool said nothing (`No content`) or returned only images.
 * - `output` is what a sandbox `await` resolves to: the server's
 *   `structuredContent` when it returned one, otherwise its text, otherwise
 *   `null`. The catalog renders its return types from this same rule, so a
 *   signature can never promise a shape the sandbox does not deliver.
 */
export interface McpToolCallResult {
  success: boolean;
  content: string;
  output: unknown;
  serverName?: string;
  images?: Array<{ data: string; mediaType?: string }>;
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
  /**
   * Usage notes the server described about itself during `initialize`
   * (`instructions`): rate limits, preconditions, how the server is meant to be
   * used. Server-level prose, announced once in the conversation instead of the
   * system prompt — see `utils/mcpInstructions.ts` for why, and for the per-server
   * cap — and already truncated by the time it lands here, unlike a tool
   * description, which the catalog compresses.
   * Retained across a reconnecting server (like `tools`) and cleared once the
   * server is gone, so a dropped server cannot keep talking to the model.
   */
  instructions?: string;
  lastConnected?: number;
  error?: string;
}
