import fs from 'fs';
import path from 'path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import { ListToolsResultSchema, CallToolResultSchema } from '@modelcontextprotocol/sdk/types.js';
import { logger } from './logger';
import type { MCPTool, MCPToolResult } from '../types/common';

// Re-export types for compatibility
export type { MCPTool, MCPToolResult };

export interface MCPServerConfig {
  command: string;
  args?: string[];
  env?: Record<string, string>;
  type?: 'stdio' | 'sse';
  url?: string; // SSE类型时使用
}

export interface MCPServersConfig {
  mcpServers: Record<string, MCPServerConfig>;
}

export class MCPClient {
  private servers: Map<string, { client: Client; transport: StdioClientTransport | SSEClientTransport }> = new Map();

  /**
   * 清理服务器名称，将非法字符替换为下划线，确保符合工具名称规范
   * @param serverName 原始服务器名称
   * @returns 清理后的服务器名称
   */
  private sanitizeServerName(serverName: string): string {
    return serverName.replace(/[^a-zA-Z0-9_-]/g, '_');
  }

  constructor(private config: MCPServersConfig) {}

  async connect(absoluteWorkdir: string): Promise<void> {
    const connectionPromises = Object.entries(this.config.mcpServers).map(async ([serverName, serverConfig]) => {
      try {
        let transport: StdioClientTransport | SSEClientTransport;

        // 根据配置类型创建不同的传输层
        if (serverConfig.type === 'sse') {
          if (!serverConfig.url) {
            throw new Error(`SSE MCP server '${serverName}' requires url configuration`);
          }
          transport = new SSEClientTransport(new URL(serverConfig.url));
        } else {
          // 默认使用 stdio 传输层
          transport = new StdioClientTransport({
            command: serverConfig.command,
            args: serverConfig.args || [],
            env: serverConfig.env,
            cwd: absoluteWorkdir,
          });
        }

        // 创建 MCP 客户端
        const client = new Client(
          {
            name: 'lcap-code',
            version: '0.1.0',
          },
          {
            capabilities: {},
          },
        );

        // 连接到 MCP server
        await client.connect(transport);

        this.servers.set(serverName, { client, transport });
      } catch (error) {
        logger.error(`Failed to connect to MCP server '${serverName}':`, error);
        throw error;
      }
    });

    await Promise.all(connectionPromises);
  }

  async listTools(): Promise<MCPTool[]> {
    if (this.servers.size === 0) {
      return [];
    }

    const allTools: MCPTool[] = [];

    // 从所有连接的服务器获取工具列表
    for (const [serverName, { client }] of this.servers) {
      try {
        const response = await client.request({ method: 'tools/list' }, ListToolsResultSchema);
        const result = ListToolsResultSchema.parse(response);

        // 为每个工具添加服务器名称前缀，避免重名冲突
        // 使用下划线而不是冒号，以符合 OpenAI API 工具名称规范
        // 将服务器名称中的空格和特殊字符替换为下划线或连字符，确保符合 ^[a-zA-Z0-9_-]{1,64}$ 规范
        const sanitizedServerName = this.sanitizeServerName(serverName);
        const serverTools = (result.tools || []).map((tool) => ({
          ...tool,
          name: `${sanitizedServerName}_${tool.name}`,
          description: `[${serverName}] ${tool.description || ''}`,
        }));

        allTools.push(...serverTools);
      } catch (error) {
        logger.error(`Failed to list tools from server '${serverName}':`, error);
      }
    }

    return allTools;
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<MCPToolResult> {
    if (this.servers.size === 0) {
      throw new Error('No MCP servers connected');
    }

    // 尝试匹配所有可能的服务器名称前缀（从长到短）
    let targetServer: { client: Client; transport: StdioClientTransport | SSEClientTransport } | undefined;
    let matchedServerName: string | undefined;
    let toolName: string | undefined;

    // 获取所有清理后的服务器名称，按长度降序排列（优先匹配更长的名称）
    const serverMappings = Array.from(this.servers.entries())
      .map(([originalName, server]) => ({
        originalName,
        cleanedName: this.sanitizeServerName(originalName),
        server,
      }))
      .sort((a, b) => b.cleanedName.length - a.cleanedName.length);

    // 尝试从最长的清理后服务器名称开始匹配
    for (const { originalName, cleanedName, server } of serverMappings) {
      if (name.startsWith(cleanedName + '_')) {
        targetServer = server;
        matchedServerName = originalName;
        toolName = name.substring(cleanedName.length + 1);
        break;
      }
    }

    if (targetServer && matchedServerName && toolName) {
      return this.callToolOnServer(targetServer.client, toolName, args);
    }

    // 没有找到服务器前缀，尝试从第一个服务器调用原始工具名
    const firstServer = this.servers.values().next().value;
    if (!firstServer) {
      throw new Error('No MCP servers available');
    }
    return this.callToolOnServer(firstServer.client, name, args);
  }

  private async callToolOnServer(
    client: Client,
    toolName: string,
    args: Record<string, unknown>,
  ): Promise<MCPToolResult> {
    const response = await client.request(
      {
        method: 'tools/call',
        params: {
          name: toolName,
          arguments: args,
        },
      },
      CallToolResultSchema,
    );

    const result = CallToolResultSchema.parse(response);

    // 转换响应格式以匹配接口
    return {
      content:
        result.content?.map((item: { type: string; text?: string; data?: string; [key: string]: unknown }) => ({
          type: item.type,
          text: item.text || item.data || JSON.stringify(item),
        })) || [],
      isError: result.isError || false,
    };
  }

  async disconnect(): Promise<void> {
    const disconnectPromises = Array.from(this.servers.entries()).map(async ([serverName, { client }]) => {
      try {
        await client.close();
      } catch (error) {
        logger.error(`Error disconnecting from MCP server '${serverName}':`, error);
      }
    });

    await Promise.all(disconnectPromises);
    this.servers.clear();
  }
}

/**
 * 初始化 MCP 客户端，只从项目的 mcp.json 配置文件读取配置
 * @param absoluteWorkdir 绝对工作目录路径
 * @returns MCP 客户端实例，如果初始化失败或没有配置则返回 null
 */
export async function initializeMCPClient(absoluteWorkdir: string): Promise<MCPClient | null> {
  try {
    // 尝试从项目根目录读取 mcp.json 配置文件
    const mcpConfigPath = path.join(absoluteWorkdir, 'mcp.json');

    if (!fs.existsSync(mcpConfigPath)) {
      // 没有配置文件，返回 null
      return null;
    }

    let mcpConfig: MCPServersConfig;
    try {
      const configContent = await fs.promises.readFile(mcpConfigPath, 'utf8');
      mcpConfig = JSON.parse(configContent) as MCPServersConfig;
    } catch (error) {
      logger.warn('Failed to parse mcp.json:', error instanceof Error ? error.name : 'Unknown error');
      return null;
    }

    // 验证配置格式
    if (!mcpConfig.mcpServers || Object.keys(mcpConfig.mcpServers).length === 0) {
      logger.warn('No MCP servers configured in mcp.json');
      return null;
    }

    const mcpClient = new MCPClient(mcpConfig);
    await mcpClient.connect(absoluteWorkdir);

    return mcpClient;
  } catch (error) {
    logger.error('Failed to initialize MCP client:', error);
    return null;
  }
}
