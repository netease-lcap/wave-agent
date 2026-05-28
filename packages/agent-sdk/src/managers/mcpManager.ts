import { promises as fs } from "fs";
import { join } from "path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { ChatCompletionFunctionTool } from "openai/resources.js";
import { createMcpToolPlugin, findToolServer } from "../utils/mcpUtils.js";
import type { ToolPlugin, ToolResult, ToolContext } from "../tools/types.js";
import { Container } from "../utils/container.js";
import type {
  Logger,
  McpServerConfig,
  McpConfig,
  McpTool,
  McpServerStatus,
} from "../types/index.js";

interface McpConnection {
  client: Client;
  transport: Transport;
  process: null; // StdioClientTransport manages process internally
}

export interface McpManagerCallbacks {
  onMcpServersChange?: (servers: McpServerStatus[]) => void;
}

import { logger } from "../utils/globalLogger.js";

export interface McpManagerOptions {
  callbacks?: McpManagerCallbacks;
  logger?: Logger;
  /** Pre-configured MCP servers passed from constructor options */
  mcpServers?: Record<string, McpServerConfig>;
}

/**
 * Expand environment variables in a string value.
 * Supports ${VAR} and ${VAR:-default} patterns.
 */
const WAVE_TEMPLATE_VARS = ["WAVE_PLUGIN_ROOT"];

export function expandEnvVars(value: string): string {
  return value.replace(/\$\{([^}]+)\}/g, (_match, expr: string) => {
    const [varName, ...rest] = expr.split(":-");
    const defaultValue = rest.join(":-");
    // Skip Wave-specific template variables — they are handled at spawn time
    if (WAVE_TEMPLATE_VARS.includes(varName)) {
      return _match; // return original ${...} string untouched
    }
    return process.env[varName] ?? defaultValue;
  });
}

/**
 * Walk an MCP config and resolve environment variables in all string fields.
 * Only expands ${VAR} from process.env (skipping WAVE_PLUGIN_ROOT which is
 * handled at spawn time).
 */
export function resolveMcpConfig(config: McpConfig): McpConfig {
  const resolved: McpConfig = { mcpServers: {} };

  for (const [name, serverConfig] of Object.entries(config.mcpServers)) {
    const resolvedServer: McpServerConfig = { ...serverConfig };

    if (resolvedServer.command) {
      resolvedServer.command = expandEnvVars(resolvedServer.command);
    }

    if (resolvedServer.args) {
      resolvedServer.args = resolvedServer.args.map(expandEnvVars);
    }

    if (resolvedServer.env) {
      const resolvedEnv: Record<string, string> = {};
      for (const [key, val] of Object.entries(resolvedServer.env)) {
        resolvedEnv[key] = expandEnvVars(val);
      }
      resolvedServer.env = resolvedEnv;
    }

    if (resolvedServer.url) {
      resolvedServer.url = expandEnvVars(resolvedServer.url);
    }

    if (resolvedServer.headers) {
      const resolvedHeaders: Record<string, string> = {};
      for (const [key, val] of Object.entries(resolvedServer.headers)) {
        resolvedHeaders[key] = expandEnvVars(val);
      }
      resolvedServer.headers = resolvedHeaders;
    }

    resolved.mcpServers[name] = resolvedServer;
  }

  return resolved;
}

export class McpManager {
  private config: McpConfig | null = null;
  private servers: Map<string, McpServerStatus> = new Map();
  private connections: Map<string, McpConnection> = new Map();
  private configPath: string = "";
  private workdir: string = "";
  private callbacks: McpManagerCallbacks;
  private mcpServers: Record<string, McpServerConfig> | undefined;

  private reconnectTimers: Map<string, NodeJS.Timeout> = new Map();
  private reconnectAttempts: Map<string, number> = new Map();

  constructor(
    private container: Container,
    options: McpManagerOptions = {},
  ) {
    this.callbacks = options.callbacks || {};
    this.mcpServers = options.mcpServers;
  }

  /**
   * Initialize MCP manager with working directory and optionally auto-connect
   */
  async initialize(
    workdir: string,
    autoConnect: boolean = false,
  ): Promise<void> {
    this.configPath = join(workdir, ".mcp.json");
    this.workdir = workdir;

    // Register constructor-provided servers before loading .mcp.json
    if (this.mcpServers) {
      for (const [name, config] of Object.entries(this.mcpServers)) {
        this.addServer(name, config);
      }
    }

    if (autoConnect) {
      logger?.debug("Initializing MCP servers...");

      // Load workspace MCP configuration (always read, merge with any plugin servers already added)
      await this.loadConfig();

      const config = this.config;

      if (config && config.mcpServers) {
        // Connect to all configured servers in background to avoid blocking agent initialization
        Object.keys(config.mcpServers).forEach((serverName) => {
          logger?.debug(`Connecting to MCP server: ${serverName}`);
          this.connectServer(serverName)
            .then((success) => {
              if (success) {
                logger?.debug(
                  `Successfully connected to MCP server: ${serverName}`,
                );
              } else {
                logger?.warn(`Failed to connect to MCP server: ${serverName}`);
              }
            })
            .catch((error) => {
              logger?.error(
                `Background connection to MCP server ${serverName} failed:`,
                error,
              );
            });
        });
      }

      logger?.debug("MCP servers initialization started in background");
      // Trigger state change callback after starting initialization
      this.callbacks.onMcpServersChange?.(this.getAllServers());
    }
  }

  async ensureConfigLoaded(): Promise<McpConfig | null> {
    if (!this.config) {
      return this.loadConfig();
    }
    return this.config;
  }

  async loadConfig(): Promise<McpConfig | null> {
    if (!this.configPath) {
      logger?.warn("MCP config path not set. Call initialize() first.");
      return null;
    }

    try {
      const configContent = await fs.readFile(this.configPath, "utf-8");
      const rawConfig: McpConfig = JSON.parse(configContent);
      const workspaceConfig = resolveMcpConfig(rawConfig);

      // Extract original (pre-resolution) URLs for safe display
      const originalUrls: Record<string, string | undefined> = {};
      for (const [name, serverConfig] of Object.entries(rawConfig.mcpServers)) {
        originalUrls[name] = serverConfig.url;
      }

      // Merge workspace config with any existing config (e.g., from plugins or constructor)
      // Constructor-provided servers take precedence, then workspace config, then existing config
      const merged: McpConfig = { mcpServers: {} };
      if (this.config) {
        Object.assign(merged.mcpServers, this.config.mcpServers);
      }
      Object.assign(merged.mcpServers, workspaceConfig.mcpServers);
      // Constructor-provided servers override both for same names
      if (this.mcpServers) {
        Object.assign(merged.mcpServers, this.mcpServers);
      }
      this.config = merged;

      // Initialize server statuses (preserve existing status for already known servers)
      if (this.config) {
        for (const [name, config] of Object.entries(this.config.mcpServers)) {
          const existingServer = this.servers.get(name);

          if (existingServer) {
            // Update config but preserve status and other runtime info
            this.servers.set(name, {
              ...existingServer,
              config, // Update config in case it changed
              originalUrl: originalUrls[name] ?? existingServer.originalUrl,
            });
          } else {
            // New server, initialize with disconnected status
            this.servers.set(name, {
              name,
              config,
              originalUrl: originalUrls[name],
              status: "disconnected",
            });
          }
        }
      }

      return this.config;
    } catch (error) {
      // Only log error if it's not a "file not found" error
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        logger?.error("Failed to load .mcp.json:", error);
      }
      return null;
    }
  }

  async saveConfig(config: McpConfig): Promise<boolean> {
    try {
      await fs.writeFile(this.configPath, JSON.stringify(config, null, 2));
      this.config = config;
      return true;
    } catch (error) {
      logger?.error("Failed to save .mcp.json:", error);
      return false;
    }
  }

  getConfig(): McpConfig | null {
    return this.config;
  }

  getAllServers(): McpServerStatus[] {
    return Array.from(this.servers.values());
  }

  getServer(name: string): McpServerStatus | undefined {
    return this.servers.get(name);
  }

  updateServerStatus(name: string, updates: Partial<McpServerStatus>): void {
    const server = this.servers.get(name);
    if (server) {
      this.servers.set(name, { ...server, ...updates });
      // Trigger state change callback
      this.callbacks.onMcpServersChange?.(this.getAllServers());
    }
  }

  addServer(name: string, config: McpServerConfig): boolean {
    if (this.servers.has(name)) {
      return false;
    }

    // Capture original URL before any resolution for safe display
    const originalUrl = config.url;

    // Expand env vars from process.env (e.g. ${TAVILY_API_KEY})
    const resolvedConfig: McpServerConfig = { ...config };
    if (resolvedConfig.command) {
      resolvedConfig.command = expandEnvVars(resolvedConfig.command);
    }
    if (resolvedConfig.args) {
      resolvedConfig.args = resolvedConfig.args.map(expandEnvVars);
    }
    if (resolvedConfig.env) {
      const resolvedEnv: Record<string, string> = {};
      for (const [key, val] of Object.entries(resolvedConfig.env)) {
        resolvedEnv[key] = expandEnvVars(val);
      }
      resolvedConfig.env = resolvedEnv;
    }
    if (resolvedConfig.url) {
      resolvedConfig.url = expandEnvVars(resolvedConfig.url);
    }
    if (resolvedConfig.headers) {
      const resolvedHeaders: Record<string, string> = {};
      for (const [key, val] of Object.entries(resolvedConfig.headers)) {
        resolvedHeaders[key] = expandEnvVars(val);
      }
      resolvedConfig.headers = resolvedHeaders;
    }

    const newServer: McpServerStatus = {
      name,
      config: resolvedConfig,
      originalUrl,
      status: "disconnected",
    };

    this.servers.set(name, newServer);

    // Update config
    if (this.config) {
      this.config.mcpServers[name] = resolvedConfig;
    } else {
      this.config = {
        mcpServers: { [name]: resolvedConfig },
      };
    }

    return true;
  }

  removeServer(name: string): boolean {
    // Disconnect if connected
    if (this.connections.has(name)) {
      this.disconnectServer(name);
    }

    const removed = this.servers.delete(name);

    if (removed && this.config) {
      delete this.config.mcpServers[name];
    }

    return removed;
  }

  // Real MCP connection implementation
  async connectServer(name: string): Promise<boolean> {
    const server = this.servers.get(name);
    if (!server) return false;

    // Already connected
    if (this.connections.has(name)) return true;

    this.updateServerStatus(name, { status: "connecting" });

    try {
      // Create transport - it will manage the process
      let transport: Transport;
      let client: Client;
      let tools: McpTool[] = [];

      const createClient = () =>
        new Client(
          {
            name: "wave-code",
            version: "1.0.0",
          },
          {
            capabilities: {},
          },
        );

      const serverType = server.config.type;

      if (serverType === "http" || (!serverType && server.config.url)) {
        if (!server.config.url) {
          throw new Error(
            `MCP server ${name} with type "http" requires a 'url'`,
          );
        }
        const url = new URL(server.config.url);
        const headers = server.config.headers;
        logger?.debug(
          `Connecting to MCP server ${name} using Streamable HTTP at ${url.href}`,
        );
        transport = new StreamableHTTPClientTransport(url, {
          requestInit: { headers },
        });
        client = createClient();
        await client.connect(transport);
        const toolsResponse = await client.listTools();
        tools =
          toolsResponse.tools?.map((tool) => ({
            name: tool.name,
            description: tool.description,
            inputSchema: tool.inputSchema,
          })) || [];
        logger?.info(`Connected to MCP server ${name} using Streamable HTTP`);
      } else if (serverType === "sse") {
        if (!server.config.url) {
          throw new Error(
            `MCP server ${name} with type "sse" requires a 'url'`,
          );
        }
        const url = new URL(server.config.url);
        const headers = server.config.headers;
        logger?.debug(
          `Connecting to MCP server ${name} using SSE at ${url.href}`,
        );
        transport = new SSEClientTransport(url, {
          requestInit: { headers },
        });
        client = createClient();
        await client.connect(transport);
        const toolsResponse = await client.listTools();
        tools =
          toolsResponse.tools?.map((tool) => ({
            name: tool.name,
            description: tool.description,
            inputSchema: tool.inputSchema,
          })) || [];
        logger?.info(`Connected to MCP server ${name} using SSE`);
      } else if (
        serverType === "stdio" ||
        (!serverType && server.config.command)
      ) {
        if (!server.config.command) {
          throw new Error(
            `MCP server ${name} with type "stdio" requires a 'command'`,
          );
        }
        const agentEnv =
          this.container.get<Record<string, string>>("MergedEnv") ||
          (process.env as Record<string, string>);
        const env: Record<string, string> = {
          ...agentEnv,
          ...(server.config.env || {}),
        };

        // For plugin servers, substitute ${WAVE_PLUGIN_ROOT} in command/args/env
        // (same pattern as Claude Code's substitutePluginVariables)
        let command = server.config.command;
        let args = server.config.args || [];
        if (server.config.pluginRoot) {
          env.WAVE_PLUGIN_ROOT = server.config.pluginRoot;
          command = command.replace(
            /\$\{WAVE_PLUGIN_ROOT\}/g,
            server.config.pluginRoot,
          );
          args = args.map((arg) =>
            arg.replace(/\$\{WAVE_PLUGIN_ROOT\}/g, server.config.pluginRoot!),
          );
          // Also expand WAVE_PLUGIN_ROOT in user-provided env values
          for (const [key, value] of Object.entries(server.config.env || {})) {
            env[key] = value.replace(
              /\$\{WAVE_PLUGIN_ROOT\}/g,
              server.config.pluginRoot!,
            );
          }
        }
        transport = new StdioClientTransport({
          command,
          args,
          env,
          cwd: this.workdir, // Use the agent's workdir as the process working directory
          stderr: "pipe", // Pipe stderr to capture it
        });

        // Handle stderr output for StdioClientTransport
        const stderr = (transport as StdioClientTransport).stderr;
        if (stderr) {
          let buffer = "";
          stderr.on("data", (chunk: Buffer) => {
            buffer += chunk.toString();
            const lines = buffer.split("\n");
            buffer = lines.pop() || "";
            for (const line of lines) {
              if (line.trim()) {
                logger?.error(`[MCP Server ${name}] ${line}`);
              }
            }
          });
          stderr.on("end", () => {
            if (buffer.trim()) {
              logger?.error(`[MCP Server ${name}] ${buffer}`);
            }
          });
        }

        client = createClient();
        await client.connect(transport);

        const toolsResponse = await client.listTools();
        tools =
          toolsResponse.tools?.map((tool) => ({
            name: tool.name,
            description: tool.description,
            inputSchema: tool.inputSchema,
          })) || [];
      } else if (serverType) {
        // Unknown type value
        throw new Error(
          `MCP server ${name} has unknown type "${serverType}". Must be "stdio", "sse", or "http"`,
        );
      } else {
        throw new Error(
          `MCP server ${name} configuration must include either 'command' or 'url'`,
        );
      }

      // Handle transport errors (e.g. SSE stream disconnected)
      // The SDK auto-reconnects for transient SSE errors, so we use
      // "reconnecting" status instead of "error". We then poll listTools()
      // to detect when reconnection succeeds.
      transport.onerror = (error: Error) => {
        const isTransient = error.message?.includes("SSE stream disconnected");
        if (isTransient) {
          logger?.warn(
            `MCP Server ${name} transient transport error (SDK will auto-reconnect): ${error.message}`,
          );
          this.updateServerStatus(name, {
            status: "reconnecting",
            error: error.message,
          });
          // Poll to detect when the SDK's auto-reconnect succeeds
          this.pollReconnectRecovery(name, client);
        } else {
          logger?.error(`MCP Server ${name} transport error:`, error);
          this.updateServerStatus(name, {
            status: "error",
            error: error.message,
          });
        }
      };

      transport.onclose = () => {
        logger?.debug(`MCP Server ${name} transport closed`);
        this.connections.delete(name);
        this.updateServerStatus(name, {
          status: "disconnected",
          tools: [],
          toolCount: 0,
        });
        // Auto-reconnect with exponential backoff (not triggered by explicit disconnect)
        if (!this.reconnectTimers.has(name)) {
          this.scheduleReconnect(name);
        }
      };

      // Store connection
      this.connections.set(name, {
        client,
        transport,
        process: null,
      });

      // Update status
      this.updateServerStatus(name, {
        status: "connected",
        tools,
        toolCount: tools.length,
        capabilities: ["tools"],
        lastConnected: Date.now(),
        error: undefined,
      });

      return true;
    } catch (error) {
      logger?.error(`Failed to connect to MCP server ${name}:`, error);
      // updateServerStatus will trigger the callback
      this.updateServerStatus(name, {
        status: "error",
        error: error instanceof Error ? error.message : String(error),
      });
      return false;
    }
  }

  /**
   * Schedule auto-reconnect with exponential backoff.
   * Delays: 1s, 2s, 4s, 8s, 16s, 30s, 30s, ...
   */
  private scheduleReconnect(name: string): void {
    const attempts = this.reconnectAttempts.get(name) ?? 0;
    const delay = Math.min(1000 * Math.pow(2, attempts), 30000);
    this.reconnectAttempts.set(name, attempts + 1);

    logger?.info(
      `Scheduling MCP server ${name} reconnect in ${delay}ms (attempt ${attempts + 1})`,
    );

    const timer = setTimeout(() => {
      this.reconnectTimers.delete(name);
      logger?.debug(`Auto-reconnecting MCP server: ${name}`);
      this.connectServer(name)
        .then((success) => {
          if (success) {
            logger?.info(`Auto-reconnected MCP server: ${name}`);
            this.reconnectAttempts.delete(name);
          } else {
            logger?.warn(`Auto-reconnect failed for MCP server: ${name}`);
            // Will be retried via onclose handler
          }
        })
        .catch((error) => {
          logger?.error(`Auto-reconnect error for MCP server ${name}:`, error);
        });
    }, delay);

    this.reconnectTimers.set(name, timer);
  }

  /**
   * Poll listTools() to detect when the SDK's auto-reconnect succeeds
   * after a transient SSE disconnect. Restores status to "connected".
   */
  private async pollReconnectRecovery(
    name: string,
    client: Client,
  ): Promise<void> {
    const maxAttempts = 10;
    const delay = 3000; // Match SDK's reconnection delay
    for (let i = 0; i < maxAttempts; i++) {
      await new Promise((r) => setTimeout(r, delay));
      const serverStatus = this.servers.get(name);
      if (serverStatus?.status !== "reconnecting") {
        return; // Status changed by onclose or user action — stop polling
      }
      try {
        const toolsResponse = await client.listTools();
        const tools =
          toolsResponse.tools?.map((tool) => ({
            name: tool.name,
            description: tool.description,
            inputSchema: tool.inputSchema,
          })) || [];
        logger?.info(
          `MCP Server ${name} auto-reconnected successfully (attempt ${i + 1})`,
        );
        this.updateServerStatus(name, {
          status: "connected",
          tools,
          toolCount: tools.length,
          lastConnected: Date.now(),
          error: undefined,
        });
        this.reconnectAttempts.delete(name);
        return;
      } catch {
        logger?.debug(
          `MCP Server ${name} reconnect recovery check ${i + 1}/${maxAttempts} failed`,
        );
      }
    }
    // If we exhausted attempts, fall through to McpManager's own reconnect
    logger?.warn(
      `MCP Server ${name} SDK auto-reconnect did not recover after ${maxAttempts} attempts`,
    );
  }

  private cancelReconnect(name: string): void {
    const timer = this.reconnectTimers.get(name);
    if (timer) {
      clearTimeout(timer);
      this.reconnectTimers.delete(name);
    }
    this.reconnectAttempts.delete(name);
  }

  async disconnectServer(name: string): Promise<boolean> {
    // Cancel any pending reconnect attempts
    this.cancelReconnect(name);

    const connection = this.connections.get(name);
    if (!connection) return false;

    try {
      // Close client connection and transport
      await connection.client.close();
      await connection.transport.close();

      // Remove connection
      this.connections.delete(name);

      // updateServerStatus will trigger the callback
      this.updateServerStatus(name, {
        status: "disconnected",
        tools: [],
        toolCount: 0,
      });

      return true;
    } catch (error) {
      logger?.error(`Error disconnecting from MCP server ${name}:`, error);
      return false;
    }
  }

  // Get all tools from connected servers
  getAllConnectedTools(): McpTool[] {
    const allTools: McpTool[] = [];
    for (const server of this.servers.values()) {
      if (server.status === "connected" && server.tools) {
        allTools.push(...server.tools);
      }
    }
    return allTools;
  }

  // Execute MCP tool
  async executeMcpTool(
    toolName: string,
    args: Record<string, unknown>,
    context?: ToolContext,
  ): Promise<{
    success: boolean;
    content: string;
    serverName?: string;
    images?: Array<{ data: string; mediaType?: string }>;
  }> {
    // Check if it's a prefixed name: mcp__[serverName]__[toolName]
    if (!toolName.startsWith("mcp__")) {
      throw new Error(
        `Invalid MCP tool name: ${toolName}. Must start with 'mcp__'`,
      );
    }

    // Permission check
    if (context?.permissionManager) {
      const permissionContext = context.permissionManager.createContext(
        toolName,
        context.permissionMode || "default",
        context.canUseToolCallback,
        args,
        context.toolCallId,
      );

      const decision =
        await context.permissionManager.checkPermission(permissionContext);
      if (decision.behavior === "deny") {
        throw new Error(decision.message || "Permission denied");
      }
    }

    const parts = toolName.split("__");
    if (parts.length < 3) {
      throw new Error(
        `Invalid MCP tool name format: ${toolName}. Expected 'mcp__[server]__[tool]'`,
      );
    }

    const targetServerName = parts[1];
    const actualToolName = parts.slice(2).join("__");

    const server = this.servers.get(targetServerName);
    if (server && server.status === "connected" && server.tools) {
      const tool = server.tools.find((t) => t.name === actualToolName);
      if (tool) {
        const connection = this.connections.get(targetServerName);
        if (connection) {
          return this.executeToolOnConnection(
            connection,
            actualToolName,
            args,
            targetServerName,
          );
        }
      }
    }

    throw new Error(`Tool ${toolName} not found on any connected MCP server`);
  }

  private async executeToolOnConnection(
    connection: McpConnection,
    toolName: string,
    args: Record<string, unknown>,
    serverName: string,
  ): Promise<{
    success: boolean;
    content: string;
    serverName?: string;
    images?: Array<{ data: string; mediaType?: string }>;
  }> {
    try {
      const result = await connection.client.callTool({
        name: toolName,
        arguments: args,
      });

      // Separate text content and image data
      const textContent: string[] = [];
      const images: Array<{ data: string; mediaType?: string }> = [];

      if (Array.isArray(result.content)) {
        result.content.forEach(
          (c: {
            type: string;
            text?: string;
            data?: string;
            resource?: { uri: string };
            [key: string]: unknown;
          }) => {
            if (c.type === "text") {
              textContent.push(c.text || "");
            } else if (c.type === "image" && c.data) {
              images.push({
                data: c.data,
                mediaType: "image/png", // Default to PNG
              });
            } else if (c.type === "resource") {
              textContent.push(`[Resource: ${c.resource?.uri || ""}]`);
            } else {
              textContent.push(JSON.stringify(c, null, 2));
            }
          },
        );
      } else if (result.content) {
        textContent.push(String(result.content));
      }

      return {
        success: true,
        content: textContent.length > 0 ? textContent.join("\n") : "No content",
        images: images.length > 0 ? images : undefined,
        serverName,
      };
    } catch (error) {
      throw new Error(
        `Tool execution failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  // Cleanup all connections
  async cleanup(): Promise<void> {
    // Cancel all pending reconnect timers
    for (const name of this.reconnectTimers.keys()) {
      this.cancelReconnect(name);
    }
    const disconnectPromises = Array.from(this.connections.keys()).map((name) =>
      this.disconnectServer(name),
    );
    await Promise.all(disconnectPromises);
  }

  // ========== Tools Registry Methods ==========

  /**
   * Get all currently available MCP tools as plugins
   */
  getMcpToolPlugins(): ToolPlugin[] {
    const mcpTools = new Map<string, ToolPlugin>();

    // Get all connected MCP tools
    const connectedTools = this.getAllConnectedTools();
    const servers = this.getAllServers();

    // Find server name for each tool and create plugins
    for (const tool of connectedTools) {
      // Find which server this tool belongs to
      const server = findToolServer(tool.name, servers);

      if (server) {
        const plugin = createMcpToolPlugin(
          tool,
          server.name,
          (
            name: string,
            args: Record<string, unknown>,
            context?: ToolContext,
          ) => this.executeMcpTool(name, args, context),
        );
        mcpTools.set(plugin.name, plugin);
      }
    }

    return Array.from(mcpTools.values());
  }

  /**
   * Get all currently available MCP tools as OpenAI function tools
   */
  getMcpToolsConfig(): ChatCompletionFunctionTool[] {
    return this.getMcpToolPlugins().map((tool) => tool.config);
  }

  /**
   * Execute an MCP tool by name (registry version)
   */
  async executeMcpToolByRegistry(
    name: string,
    args: Record<string, unknown>,
    context: ToolContext,
  ): Promise<ToolResult> {
    const plugins = this.getMcpToolPlugins();
    const tool = plugins.find((plugin) => plugin.name === name);

    if (!tool) {
      return {
        success: false,
        content: "",
        error: `MCP tool '${name}' not found or server disconnected`,
      };
    }
    return tool.execute(args, context);
  }

  /**
   * Check if a tool name belongs to an MCP tool
   */
  isMcpTool(name: string): boolean {
    if (!name.startsWith("mcp__")) return false;

    for (const server of this.servers.values()) {
      if (server.status === "connected" && server.tools) {
        for (const tool of server.tools) {
          if (`mcp__${server.name}__${tool.name}` === name) {
            return true;
          }
        }
      }
    }
    return false;
  }
}
