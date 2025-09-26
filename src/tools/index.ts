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
import { mcpManager } from "../services/mcpManager";
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
    // Check if it's an MCP tool first
    if (mcpManager.isMcpTool(name)) {
      return mcpManager.executeMcpToolByRegistry(name, args, context);
    }

    // Check built-in tools
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
    const builtInTools = Array.from(this.tools.values());
    const mcpTools = mcpManager.getMcpToolPlugins();
    return [...builtInTools, ...mcpTools];
  }

  getToolsConfig(): ChatCompletionFunctionTool[] {
    const builtInToolsConfig = Array.from(this.tools.values()).map(
      (tool) => tool.config,
    );
    const mcpToolsConfig = mcpManager.getMcpToolsConfig();
    return [...builtInToolsConfig, ...mcpToolsConfig];
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
