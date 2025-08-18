import type {
  ToolContext,
  ToolPlugin,
  ToolRegistry,
  ToolResult,
} from "./types";
import type { ChatCompletionTool } from "../../types/common";
import { terminalTool } from "./terminalTool";
import { readFileTool } from "./readFileTool";
import { listDirTool } from "./listDirTool";
import { grepSearchTool } from "./grepSearchTool";
import { fileSearchTool } from "./fileSearchTool";
import { editFileTool } from "./editFileTool";
import { searchReplaceTool } from "./searchReplaceTool";
import { deleteFileTool } from "./deleteFileTool";
import { mcpToolManager } from "../../services/mcpToolManager";

/**
 * 工具注册中心
 */
class ToolRegistryImpl implements ToolRegistry {
  private tools = new Map<string, ToolPlugin>();

  register(plugin: ToolPlugin): void {
    this.tools.set(plugin.name, plugin);
  }

  async execute(
    name: string,
    args: Record<string, unknown>,
    context?: ToolContext,
  ): Promise<ToolResult> {
    // 首先检查是否是内置工具
    const plugin = this.tools.get(name);
    if (plugin) {
      try {
        return await plugin.execute(args, context);
      } catch (error) {
        return {
          success: false,
          content: "",
          error: error instanceof Error ? error.message : String(error),
        };
      }
    }

    // 如果不是内置工具，检查是否是 MCP 工具
    if (mcpToolManager.isToolFromMCP(name)) {
      return await mcpToolManager.callMCPTool(name, args);
    }

    return {
      success: false,
      content: "",
      error: `Tool '${name}' not found`,
    };
  }

  list(): ToolPlugin[] {
    const builtinTools = Array.from(this.tools.values());
    const mcpTools = mcpToolManager.getTools();
    return [...builtinTools, ...mcpTools];
  }

  getToolsConfig(): ChatCompletionTool[] {
    const builtinTools = Array.from(this.tools.values()).map(
      (tool) => tool.config,
    );
    const mcpTools = mcpToolManager.getTools().map((tool) => tool.config);
    return [...builtinTools, ...mcpTools];
  }
}

// 创建全局工具注册中心实例
export const toolRegistry = new ToolRegistryImpl();
toolRegistry.register(terminalTool);
toolRegistry.register(readFileTool);
toolRegistry.register(listDirTool);
toolRegistry.register(grepSearchTool);
toolRegistry.register(fileSearchTool);
toolRegistry.register(editFileTool);
toolRegistry.register(searchReplaceTool);
toolRegistry.register(deleteFileTool);

// 导出类型
export type { ToolPlugin, ToolResult, ToolRegistry } from "./types";
