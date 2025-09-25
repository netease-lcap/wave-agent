import type {
  ToolContext,
  ToolPlugin,
  ToolRegistry,
  ToolResult,
} from "./types";
import { terminalTool } from "./terminalTool";
import { readFileTool } from "./readFileTool";
import { listDirTool } from "./listDirTool";
import { grepSearchTool } from "./grepSearchTool";
import { fileSearchTool } from "./fileSearchTool";
import { deleteFileTool } from "./deleteFileTool";
import { editTool } from "./editTool";
import { multiEditTool } from "./multiEditTool";
import { writeTool } from "./writeTool";
import { ChatCompletionTool } from "openai/resources.js";
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

    return {
      success: false,
      content: "",
      error: `Tool '${name}' not found`,
    };
  }

  list(): ToolPlugin[] {
    return Array.from(this.tools.values());
  }

  getToolsConfig(): ChatCompletionTool[] {
    return Array.from(this.tools.values()).map((tool) => tool.config);
  }
}

// 创建全局工具注册中心实例
export const toolRegistry = new ToolRegistryImpl();
toolRegistry.register(terminalTool);
toolRegistry.register(readFileTool);
toolRegistry.register(listDirTool);
toolRegistry.register(grepSearchTool);
toolRegistry.register(fileSearchTool);
toolRegistry.register(deleteFileTool);
toolRegistry.register(editTool);
toolRegistry.register(multiEditTool);
toolRegistry.register(writeTool);

// 导出类型
export type { ToolPlugin, ToolResult, ToolRegistry } from "./types";
