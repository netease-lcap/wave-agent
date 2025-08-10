import { MCPClient, initializeMCPClient } from './mcp';
import type { MCPTool, MCPToolResult } from './mcp';
import type { ToolPlugin, ToolResult, ToolContext } from '../plugins/tools/types';
import type { ChatCompletionTool } from '../types/common';
import { logger } from './logger';

export class MCPToolManager {
  private mcpClient: MCPClient | null = null;
  private mcpTools: MCPTool[] = [];

  async initialize(workdir: string): Promise<void> {
    try {
      this.mcpClient = await initializeMCPClient(workdir);
      if (this.mcpClient) {
        this.mcpTools = await this.mcpClient.listTools();
        logger.info(`Loaded ${this.mcpTools.length} MCP tools`);
      }
    } catch (error) {
      logger.warn('Failed to initialize MCP tools:', error instanceof Error ? error.name : 'Unknown error');
      this.mcpClient = null;
      this.mcpTools = [];
    }
  }

  async disconnect(): Promise<void> {
    if (this.mcpClient) {
      await this.mcpClient.disconnect();
      this.mcpClient = null;
      this.mcpTools = [];
    }
  }

  getTools(): ToolPlugin[] {
    return this.mcpTools.map((mcpTool) => ({
      name: mcpTool.name,
      description: mcpTool.description || '',
      config: this.convertMCPToolToConfig(mcpTool),
      execute: async (args: Record<string, unknown>, context?: ToolContext): Promise<ToolResult> => {
        if (!this.mcpClient) {
          return {
            success: false,
            content: '',
            error: 'MCP client not available',
          };
        }

        try {
          // 检查中断信号
          if (context?.abortSignal?.aborted) {
            throw new Error('Operation aborted');
          }

          const result: MCPToolResult = await this.mcpClient.callTool(mcpTool.name, args);

          return {
            success: !result.isError,
            content: result.content.map((item) => item.text).join('\n'),
            error: result.isError ? 'MCP tool execution failed' : undefined,
          };
        } catch (error) {
          return {
            success: false,
            content: '',
            error: error instanceof Error ? error.message : String(error),
          };
        }
      },
    }));
  }

  private convertMCPToolToConfig(mcpTool: MCPTool): ChatCompletionTool {
    return {
      type: 'function',
      function: {
        name: mcpTool.name,
        description: mcpTool.description || '',
        parameters: mcpTool.inputSchema || { type: 'object', properties: {} },
      },
    };
  }

  isToolFromMCP(toolName: string): boolean {
    return this.mcpTools.some((tool) => tool.name === toolName);
  }

  async callMCPTool(toolName: string, args: Record<string, unknown>): Promise<ToolResult> {
    if (!this.mcpClient) {
      return {
        success: false,
        content: '',
        error: 'MCP client not available',
      };
    }

    try {
      const result: MCPToolResult = await this.mcpClient.callTool(toolName, args);

      return {
        success: !result.isError,
        content: result.content.map((item) => item.text).join('\n'),
        error: result.isError ? 'MCP tool execution failed' : undefined,
      };
    } catch (error) {
      return {
        success: false,
        content: '',
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }
}

// 创建全局 MCP 工具管理器实例
export const mcpToolManager = new MCPToolManager();
