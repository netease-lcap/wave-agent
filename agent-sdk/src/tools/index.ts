import type {
  ToolContext,
  ToolPlugin,
  ToolRegistry,
  ToolResult,
} from "./types.js";
import { bashTool, bashOutputTool, killBashTool } from "./bashTool.js";
import { deleteFileTool } from "./deleteFileTool.js";
import { editTool } from "./editTool.js";
import { multiEditTool } from "./multiEditTool.js";
import { writeTool } from "./writeTool.js";
// 新的工具
import { globTool } from "./globTool.js";
import { grepTool } from "./grepTool.js";
import { lsTool } from "./lsTool.js";
import { readTool } from "./readTool.js";
import { McpManager } from "../managers/mcpManager.js";
import { ChatCompletionFunctionTool } from "openai/resources.js";

/**
 * 工具注册中心
 */
class ToolRegistryImpl implements ToolRegistry {
  private tools = new Map<string, ToolPlugin>([
    [bashTool.name, bashTool],
    [bashOutputTool.name, bashOutputTool],
    [killBashTool.name, killBashTool],
    [deleteFileTool.name, deleteFileTool],
    [editTool.name, editTool],
    [multiEditTool.name, multiEditTool],
    [writeTool.name, writeTool],
    [globTool.name, globTool],
    [grepTool.name, grepTool],
    [lsTool.name, lsTool],
    [readTool.name, readTool],
  ]);

  constructor(private mcpManager: McpManager) {}

  async execute(
    name: string,
    args: Record<string, unknown>,
    context?: ToolContext,
  ): Promise<ToolResult> {
    // Check if it's an MCP tool first
    if (this.mcpManager.isMcpTool(name)) {
      return this.mcpManager.executeMcpToolByRegistry(name, args, context);
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
    const mcpTools = this.mcpManager.getMcpToolPlugins();
    return [...builtInTools, ...mcpTools];
  }

  getToolsConfig(): ChatCompletionFunctionTool[] {
    const builtInToolsConfig = Array.from(this.tools.values()).map(
      (tool) => tool.config,
    );
    const mcpToolsConfig = this.mcpManager.getMcpToolsConfig();
    return [...builtInToolsConfig, ...mcpToolsConfig];
  }
}

// 导出工具注册中心类和类型
export { ToolRegistryImpl };
export type { ToolPlugin, ToolResult, ToolRegistry } from "./types.js";
