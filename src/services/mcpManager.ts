import { promises as fs } from "fs";
import { join } from "path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { ChatCompletionFunctionTool } from "openai/resources.js";
import { logger } from "@/utils/logger.js";
import { createMcpToolPlugin, findToolServer } from "@/utils/mcpUtils.js";
import type { ToolPlugin, ToolResult, ToolContext } from "../tools/types.js";

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

interface McpConnection {
  client: Client;
  transport: StdioClientTransport;
  process: null; // StdioClientTransport manages process internally
}

export class McpManager {
  private config: McpConfig | null = null;
  private servers: Map<string, McpServerStatus> = new Map();
  private connections: Map<string, McpConnection> = new Map();
  private configPath: string = "";

  /**
   * Initialize MCP manager with working directory
   */
  initialize(workdir: string): void {
    this.configPath = join(workdir, ".mcp.json");
  }

  async ensureConfigLoaded(): Promise<McpConfig | null> {
    if (!this.config) {
      return this.loadConfig();
    }
    return this.config;
  }

  async loadConfig(): Promise<McpConfig | null> {
    if (!this.configPath) {
      logger.warn("MCP config path not set. Call initialize() first.");
      return null;
    }

    try {
      const configContent = await fs.readFile(this.configPath, "utf-8");
      this.config = JSON.parse(configContent);

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
        logger.error("Failed to load .mcp.json:", error);
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
      logger.error("Failed to save .mcp.json:", error);
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
      const transport = new StdioClientTransport({
        command: server.config.command,
        args: server.config.args || [],
        env: server.config.env || {},
      });

      // Create client
      const client = new Client(
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

      // Handle transport errors
      transport.onerror = (error: Error) => {
        logger.error(`MCP Server ${name} transport error:`, error);
        this.updateServerStatus(name, {
          status: "error",
          error: error.message,
        });
      };

      transport.onclose = () => {
        logger.info(`MCP Server ${name} transport closed`);
        this.updateServerStatus(name, {
          status: "disconnected",
          tools: [],
          toolCount: 0,
        });
        this.connections.delete(name);
      };

      // Connect to transport
      await client.connect(transport);

      // List available tools
      const toolsResponse = await client.listTools();

      const tools: McpTool[] =
        toolsResponse.tools?.map((tool) => ({
          name: tool.name,
          description: tool.description,
          inputSchema: tool.inputSchema,
        })) || [];

      // Store connection (we don't have direct process access with StdioClientTransport)
      this.connections.set(name, {
        client,
        transport,
        process: null, // StdioClientTransport manages the process internally
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
      logger.error(`Failed to connect to MCP server ${name}:`, error);
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

      this.updateServerStatus(name, {
        status: "disconnected",
        tools: [],
        toolCount: 0,
      });

      return true;
    } catch (error) {
      logger.error(`Error disconnecting from MCP server ${name}:`, error);
      return false;
    }
  }

  async reconnectServer(name: string): Promise<boolean> {
    await this.disconnectServer(name);
    return this.connectServer(name);
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
  ): Promise<{
    success: boolean;
    content: string;
    serverName?: string;
    images?: Array<{ data: string; mediaType?: string }>;
  }> {
    // Find which server has this tool
    for (const [serverName, server] of this.servers.entries()) {
      if (server.status === "connected" && server.tools) {
        const tool = server.tools.find((t) => t.name === toolName);
        if (tool) {
          const connection = this.connections.get(serverName);
          if (connection) {
            try {
              const result = await connection.client.callTool({
                name: toolName,
                arguments: args,
              });

              // 分离文本内容和图片数据
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
                        mediaType: "image/png", // 默认为 PNG，可以根据实际情况调整
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
                content:
                  textContent.length > 0
                    ? textContent.join("\n")
                    : "No content",
                images: images.length > 0 ? images : undefined,
                serverName,
              };
            } catch (error) {
              throw new Error(
                `Tool execution failed: ${error instanceof Error ? error.message : String(error)}`,
              );
            }
          }
        }
      }
    }

    throw new Error(`Tool ${toolName} not found on any connected MCP server`);
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
        const plugin = createMcpToolPlugin(tool, server.name, (name, args) =>
          this.executeMcpTool(name, args),
        );
        mcpTools.set(tool.name, plugin);
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
    context?: ToolContext,
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
    const connectedTools = this.getAllConnectedTools();
    return connectedTools.some((tool) => tool.name === name);
  }
}

export const mcpManager = new McpManager();
