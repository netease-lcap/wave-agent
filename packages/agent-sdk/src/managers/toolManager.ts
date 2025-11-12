import type { ToolContext, ToolPlugin, ToolResult } from "../tools/types.js";
import { bashTool, bashOutputTool, killBashTool } from "../tools/bashTool.js";
import { deleteFileTool } from "../tools/deleteFileTool.js";
import { editTool } from "../tools/editTool.js";
import { multiEditTool } from "../tools/multiEditTool.js";
import { writeTool } from "../tools/writeTool.js";
// New tools
import { globTool } from "../tools/globTool.js";
import { grepTool } from "../tools/grepTool.js";
import { lsTool } from "../tools/lsTool.js";
import { readTool } from "../tools/readTool.js";
import { todoWriteTool } from "../tools/todoWriteTool.js";
import { createTaskTool } from "../tools/taskTool.js";
import { createSkillTool } from "../tools/skillTool.js";
import { McpManager } from "./mcpManager.js";
import { ChatCompletionFunctionTool } from "openai/resources.js";
import type { Logger } from "../types/index.js";
import type { SubagentManager } from "./subagentManager.js";
import type { SkillManager } from "./skillManager.js";

export interface ToolManagerOptions {
  mcpManager: McpManager;
  logger?: Logger;
}

/**
 * Tool Manager
 */
class ToolManager {
  private tools = new Map<string, ToolPlugin>();
  private mcpManager: McpManager;
  private logger?: Logger;

  constructor(options: ToolManagerOptions) {
    this.mcpManager = options.mcpManager;
    this.logger = options.logger;
  }

  /**
   * Register a new tool
   */
  public register(tool: ToolPlugin): void {
    this.tools.set(tool.name, tool);
  }

  /**
   * Initialize built-in tools. Can be called with dependencies for tools that require them.
   *
   * This method can be called multiple times safely. When called without dependencies,
   * it registers basic tools (Bash, Read, Write, TodoWrite, etc.). When called with
   * dependencies, it also registers tools that require managers (Task, Skill).
   *
   * @param deps Optional dependencies for advanced tools
   * @param deps.subagentManager SubagentManager instance for Task tool
   * @param deps.skillManager SkillManager instance for Skill tool
   *
   * @example
   * ```typescript
   * // Initialize basic tools only
   * toolManager.initializeBuiltInTools();
   *
   * // Initialize all tools including those requiring dependencies
   * toolManager.initializeBuiltInTools({
   *   subagentManager: mySubagentManager,
   *   skillManager: mySkillManager
   * });
   * ```
   */
  public initializeBuiltInTools(deps?: {
    subagentManager?: SubagentManager;
    skillManager?: SkillManager;
  }): void {
    const builtInTools = [
      bashTool,
      bashOutputTool,
      killBashTool,
      deleteFileTool,
      editTool,
      multiEditTool,
      writeTool,
      globTool,
      grepTool,
      lsTool,
      readTool,
      todoWriteTool,
    ];

    for (const tool of builtInTools) {
      this.tools.set(tool.name, tool);
    }

    // Register tools that require dependencies
    if (deps?.subagentManager) {
      const taskTool = createTaskTool(deps.subagentManager);
      this.tools.set(taskTool.name, taskTool);
    }

    if (deps?.skillManager) {
      const skillTool = createSkillTool(deps.skillManager);
      this.tools.set(skillTool.name, skillTool);
    }
  }

  async execute(
    name: string,
    args: Record<string, unknown>,
    context: ToolContext,
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

// Export tool registry class and types
export { ToolManager };
