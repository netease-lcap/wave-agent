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
  onServersChange?: (servers: McpServerStatus[]) => void;
}

import { logger } from "../utils/globalLogger.js";

export interface McpManagerOptions {
  callbacks?: McpManagerCallbacks;
  logger?: Logger;
}

/**
 * Expand environment variables in a string value.
 * Supports ${VAR} and ${VAR:-default} patterns.
 */
export function expandEnvVars(value: string): string {
  return value.replace(/\$\{([^}]+)\}/g, (_match, expr: string) => {
    const [varName, ...rest] = expr.split(":-");
    const defaultValue = rest.join(":-");
    return process.env[varName] ?? defaultValue;
  });
}

/**
 * Walk an MCP config and expand env vars in all string fields.
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

  constructor(
    private container: Container,
    options: McpManagerOptions = {},
  ) {
    this.callbacks = options.callbacks || {};
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

    if (autoConnect) {
      logger?.debug("Initializing MCP servers...");

      // Ensure MCP configuration is loaded
      const config = await this.ensureConfigLoaded();

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
      this.callbacks.onServersChange?.(this.getAllServers());
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
      this.config = resolveMcpConfig(JSON.parse(configContent));

      // Initialize server statuses (preserve existing status for already known servers)
      if (this.config) {
        for (const [name, config] of Object.entries(this.config.mcpServers)) {
          const existingServer = this.servers.get(name);

          if (existingServer) {
            // Update config but preserve status and other runtime info
            this.servers.set(name, {
              ...existingServer,
              config, // Update config in case it changed
            });
          } else {
            // New server, initialize with disconnected status
            this.servers.set(name, {
              name,
              config,
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
      this.callbacks.onServersChange?.(this.getAllServers());
    }
  }

  addServer(name: string, config: McpServerConfig): boolean {
    if (this.servers.has(name)) {
      return false;
    }

    const newServer: McpServerStatus = {
      name,
      config,
      status: "disconnected",
    };

    this.servers.set(name, newServer);

    // Update config
    if (this.config) {
      this.config.mcpServers[name] = config;
    } else {
      this.config = {
        mcpServers: { [name]: config },
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
            capabilities: {
              tools: {},
            },
          },
        );

      if (server.config.url) {
        const url = new URL(server.config.url);
        const headers = server.config.headers;

        try {
          logger?.debug(
            `Attempting Streamable HTTP connection for ${name} at ${url.href}`,
          );
          const streamableTransport = new StreamableHTTPClientTransport(url, {
            requestInit: { headers },
          });

          const streamableClient = createClient();
          await streamableClient.connect(streamableTransport);

          // Try to list tools to verify connection works
          const toolsResponse = await streamableClient.listTools();

          transport = streamableTransport;
          client = streamableClient;
          tools =
            toolsResponse.tools?.map((tool) => ({
              name: tool.name,
              description: tool.description,
              inputSchema: tool.inputSchema,
            })) || [];

          logger?.info(`Connected to MCP server ${name} using Streamable HTTP`);
        } catch (error) {
          logger?.debug(
            `Streamable HTTP failed for ${name}, falling back to SSE: ${error instanceof Error ? error.message : String(error)}`,
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

          logger?.info(`Connected to MCP server ${name} using SSE (fallback)`);
        }
      } else if (server.config.command) {
        transport = new StdioClientTransport({
          command: server.config.command,
          args: server.config.args || [],
          env: {
            ...(process.env as Record<string, string>),
            ...(server.config.env || {}),
          },
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
      } else {
        throw new Error(
          `MCP server ${name} configuration must include either 'command' or 'url'`,
        );
      }

      // Handle transport errors
      transport.onerror = (error: Error) => {
        logger?.error(`MCP Server ${name} transport error:`, error);
        this.updateServerStatus(name, {
          status: "error",
          error: error.message,
        });
      };

      transport.onclose = () => {
        logger?.debug(`MCP Server ${name} transport closed`);
        this.connections.delete(name);
        this.updateServerStatus(name, {
          status: "disconnected",
          tools: [],
          toolCount: 0,
        });
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

  async disconnectServer(name: string): Promise<boolean> {
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
              textContent.push(JSON.stringify(c));
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
