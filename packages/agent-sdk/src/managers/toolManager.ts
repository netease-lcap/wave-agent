import type { ToolContext, ToolPlugin, ToolResult } from "../tools/types.js";
import { bashTool } from "../tools/bashTool.js";
import { taskOutputTool } from "../tools/taskOutputTool.js";
import { taskStopTool } from "../tools/taskStopTool.js";
import { deleteFileTool } from "../tools/deleteFileTool.js";
import { editTool } from "../tools/editTool.js";
import { multiEditTool } from "../tools/multiEditTool.js";
import { writeTool } from "../tools/writeTool.js";
import { exitPlanModeTool } from "../tools/exitPlanMode.js";
import { askUserQuestionTool } from "../tools/askUserQuestion.js";
// New tools
import { globTool } from "../tools/globTool.js";
import { searchTool } from "../tools/searchTool.js";
import { lsTool } from "../tools/lsTool.js";
import { readTool } from "../tools/readTool.js";
import { lspTool } from "../tools/lspTool.js";
import { createTaskTool } from "../tools/taskTool.js";
import { createSkillTool } from "../tools/skillTool.js";
import {
  taskCreateTool,
  taskGetTool,
  taskUpdateTool,
  taskListTool,
} from "../tools/taskManagementTools.js";
import { McpManager } from "./mcpManager.js";
import { PermissionManager } from "./permissionManager.js";
import { ChatCompletionFunctionTool } from "openai/resources.js";
import type {
  Logger,
  PermissionMode,
  PermissionCallback,
  ILspManager,
} from "../types/index.js";
import type { SubagentManager } from "./subagentManager.js";
import type { SkillManager } from "./skillManager.js";

import { ReversionManager } from "./reversionManager.js";

export interface ToolManagerOptions {
  mcpManager: McpManager;
  lspManager?: ILspManager;
  logger?: Logger;
  /** Permission manager for handling tool permission checks */
  permissionManager?: PermissionManager;
  /** Foreground task manager for backgrounding tasks */
  foregroundTaskManager?: import("../types/processes.js").IForegroundTaskManager;
  /** Task manager for task management */
  taskManager?: import("../services/taskManager.js").TaskManager;
  /** Reversion manager for file snapshots */
  reversionManager?: ReversionManager;
  /** Background task manager for background execution */
  backgroundTaskManager?: import("./backgroundTaskManager.js").BackgroundTaskManager;
  /** Permission mode for tool execution (defaults to "default") */
  permissionMode?: PermissionMode;
  /** Custom permission callback for tool usage */
  canUseToolCallback?: PermissionCallback;
}

/**
 * Tool Manager
 *
 * Manages tool registration and execution with optional permission system integration.
 * Supports both built-in tools and MCP (Model Context Protocol) tools.
 */
class ToolManager {
  private tools = new Map<string, ToolPlugin>();
  private mcpManager: McpManager;
  private lspManager?: ILspManager;
  private logger?: Logger;
  private permissionManager?: PermissionManager;
  private foregroundTaskManager?: import("../types/processes.js").IForegroundTaskManager;
  private reversionManager?: ReversionManager;
  private taskManager?: import("../services/taskManager.js").TaskManager;
  private backgroundTaskManager?: import("./backgroundTaskManager.js").BackgroundTaskManager;
  private permissionMode?: PermissionMode;
  private canUseToolCallback?: PermissionCallback;

  constructor(options: ToolManagerOptions) {
    this.mcpManager = options.mcpManager;
    this.lspManager = options.lspManager;
    this.logger = options.logger;
    this.permissionManager = options.permissionManager;
    this.taskManager = options.taskManager;
    this.foregroundTaskManager = options.foregroundTaskManager;
    this.reversionManager = options.reversionManager;
    this.backgroundTaskManager = options.backgroundTaskManager;
    // Store CLI permission mode, let PermissionManager resolve effective mode
    this.permissionMode = options.permissionMode;
    this.canUseToolCallback = options.canUseToolCallback;
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
      taskOutputTool,
      taskStopTool,
      deleteFileTool,
      editTool,
      multiEditTool,
      writeTool,
      exitPlanModeTool,
      askUserQuestionTool,
      globTool,
      searchTool,
      lsTool,
      readTool,
      lspTool,
      taskCreateTool,
      taskGetTool,
      taskUpdateTool,
      taskListTool,
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

  /**
   * Execute a tool by name with the provided arguments and context
   *
   * Enhances the context with permission-related fields before execution:
   * - permissionMode: The current permission mode (default or bypassPermissions)
   * - canUseToolCallback: Custom permission callback if provided
   * - permissionManager: The PermissionManager instance for permission checks
   *
   * @param name - Name of the tool to execute
   * @param args - Arguments to pass to the tool
   * @param context - Execution context for the tool
   * @returns Promise resolving to the tool execution result
   */
  async execute(
    name: string,
    args: Record<string, unknown>,
    context: ToolContext,
  ): Promise<ToolResult> {
    // Resolve effective permission mode (CLI override > configuration > default)
    const effectivePermissionMode = this.permissionManager
      ? this.permissionManager.getCurrentEffectiveMode(this.permissionMode)
      : this.permissionMode || "default";

    // Enhance context with permission-related fields
    const enhancedContext: ToolContext = {
      ...context,
      permissionMode: effectivePermissionMode,
      canUseToolCallback: this.canUseToolCallback,
      permissionManager: this.permissionManager,
      taskManager: this.taskManager!,
      reversionManager: this.reversionManager,
      backgroundTaskManager: this.backgroundTaskManager,
      foregroundTaskManager: this.foregroundTaskManager,
      mcpManager: this.mcpManager,
      lspManager: this.lspManager,
      sessionId: context.sessionId,
    };

    this.logger?.debug("Executing tool with enhanced context", {
      toolName: name,
      cliPermissionMode: this.permissionMode,
      effectivePermissionMode,
      hasPermissionManager: !!this.permissionManager,
      hasPermissionCallback: !!this.canUseToolCallback,
    });

    // Check if it's an MCP tool first
    if (this.mcpManager.isMcpTool(name)) {
      return this.mcpManager.executeMcpToolByRegistry(
        name,
        args,
        enhancedContext,
      );
    }

    // Check built-in tools
    const plugin = this.tools.get(name);
    if (plugin) {
      try {
        return await plugin.execute(args, enhancedContext);
      } catch (error) {
        this.logger?.error("Tool execution failed", {
          toolName: name,
          error: error instanceof Error ? error.message : String(error),
        });
        return {
          success: false,
          content: "",
          error: error instanceof Error ? error.message : String(error),
        };
      }
    }

    this.logger?.warn("Tool not found", { toolName: name });
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
    const effectivePermissionMode = this.getPermissionMode();
    const builtInToolsConfig = Array.from(this.tools.values())
      .filter((tool) => {
        if (effectivePermissionMode === "bypassPermissions") {
          if (tool.name === "ExitPlanMode" || tool.name === "AskUserQuestion") {
            return false;
          }
        }
        if (tool.name === "ExitPlanMode") {
          return effectivePermissionMode === "plan";
        }
        return true;
      })
      .map((tool) => tool.config);
    const mcpToolsConfig = this.mcpManager.getMcpToolsConfig();
    return [...builtInToolsConfig, ...mcpToolsConfig];
  }

  /**
   * Get the list of registered tool plugins
   */
  public getTools(): ToolPlugin[] {
    return Array.from(this.tools.values());
  }

  /**
   * Get the current permission mode
   */
  public getPermissionMode(): PermissionMode {
    if (this.permissionManager) {
      return this.permissionManager.getCurrentEffectiveMode(
        this.permissionMode,
      );
    }
    return this.permissionMode || "default";
  }

  /**
   * Set the permission mode
   * @param mode - The new permission mode
   */
  public setPermissionMode(mode: PermissionMode): void {
    this.permissionMode = mode;
  }

  /**
   * Get the permission manager
   */
  public getPermissionManager(): PermissionManager | undefined {
    return this.permissionManager;
  }

  /**
   * Get the task manager
   */
  public getTaskManager():
    | import("../services/taskManager.js").TaskManager
    | undefined {
    return this.taskManager;
  }
}

// Export tool registry class and types
export { ToolManager };
