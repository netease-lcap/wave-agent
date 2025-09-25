import type {
  ToolContext,
  ToolPlugin,
  ToolRegistry,
  ToolResult,
} from "./types";
import { bashTool, bashOutputTool, killBashTool } from "./bashTool";
import { deleteFileTool } from "./deleteFileTool";
import { editTool } from "./editTool";
import { multiEditTool } from "./multiEditTool";
import { writeTool } from "./writeTool";
// 新的工具
import { globTool } from "./globTool";
import { grepTool } from "./grepTool";
import { lsTool } from "./lsTool";
import { readTool } from "./readTool";
import { ChatCompletionFunctionTool } from "openai/resources.js";
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

  getToolsConfig(): ChatCompletionFunctionTool[] {
    return Array.from(this.tools.values()).map((tool) => tool.config);
  }
}

// 创建全局工具注册中心实例
export const toolRegistry = new ToolRegistryImpl();
toolRegistry.register(bashTool);
toolRegistry.register(bashOutputTool);
toolRegistry.register(killBashTool);
toolRegistry.register(deleteFileTool);
toolRegistry.register(editTool);
toolRegistry.register(multiEditTool);
toolRegistry.register(writeTool);
// 注册新工具
toolRegistry.register(globTool);
toolRegistry.register(grepTool);
toolRegistry.register(lsTool);
toolRegistry.register(readTool);

// 导出类型
export type { ToolPlugin, ToolResult, ToolRegistry } from "./types";
