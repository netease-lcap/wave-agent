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
  /**
   * Server-level opt-out from the turn's 5 s connection deadline
   * (spec ecosystem/mcp.md「连接 MCP 服务器的时机与超时」场景 4): the dial starts at
   * creation like every other server's, but a turn waits for *this* server to
   * connect or fail before it builds its tools, however long that takes.
   *
   * Not the same thing as the tool-level `_meta["anthropic/alwaysLoad"]` below:
   * that one is a server asking for one of its *tools* to be declared flat
   * instead of loaded on demand through the REPL pool — a question of how a tool
   * is announced, answered after the connection exists. This one is about
   * whether the connection exists by the time the turn starts.
   */
  alwaysLoad?: boolean;
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
  /**
   * The tool's `_meta` as the server listed it, passed through untouched. The only
   * key read from it today is `anthropic/alwaysLoad` — a server asking for this tool
   * to be declared flat instead of loaded on demand (see `utils/mcpUtils.ts`).
   *
   * Carried raw rather than picked apart at the connection site: which keys matter is
   * a question for the code that reads them, and this field's job is only to survive
   * the trip from `tools/list`.
   */
  _meta?: Record<string, unknown>;
}

/**
 * What one MCP tool call produced. Two audiences, two fields:
 *
 * - `content` is the display text the flat path hands the model — a placeholder
 *   when the tool said nothing (`No content`) or returned only images.
 * - `output` is what a sandbox `await` resolves to: the server's
 *   `structuredContent` when it returned one, otherwise its text, otherwise
 *   `null`. A signature renders its return type from this same rule, so a
 *   signature can never promise a shape the sandbox does not deliver.
 */
export interface McpToolCallResult {
  success: boolean;
  content: string;
  /**
   * The tool's structured result: the server's `content` blocks as it returned
   * them (Claude Code's MCP Output — see `mcpManager.executeToolOnConnection`).
   *
   * It exists for the two audiences `output` cannot serve: the PostToolUse
   * hook's `tool_response` (which must be the tool's own data, not a text
   * rendering) and a REPL script that wants the blocks. It never reaches the
   * transcript: MCP tools have no entry in `tools/resultData/`, so the block
   * still stores `result` text.
   */
  data?: unknown;
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
   * cap — and already truncated by the time it lands here.
   * Retained across a reconnecting server (like `tools`) and cleared once the
   * server is gone, so a dropped server cannot keep talking to the model.
   */
  instructions?: string;
  lastConnected?: number;
  /**
   * Tool snapshot from this server's last successful connection, read from the
   * machine-local display cache (`~/.wave/mcp-tools-cache.json`). A conversation
   * that has not finished connecting (or whose dial the turn did not wait for)
   * has no tool list yet, but the panel still has to say what the server brings.
   *
   * Display only — never a source of tool declarations or calls (spec
   * ecosystem/mcp.md 场景 18), which is why only name/description are carried.
   * Absent when the config changed since the snapshot (the old tools are no
   * longer trustworthy) or when the server never connected on this machine.
   */
  toolsFromCache?: Array<{ name: string; description?: string }>;
  /** When `toolsFromCache` was captured (ms since epoch). */
  toolsCachedAt?: number;
  error?: string;
}
