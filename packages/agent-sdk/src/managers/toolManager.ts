import type { ToolContext, ToolPlugin, ToolResult } from "../tools/types.js";
import { bashTool } from "../tools/bashTool.js";
import { taskOutputTool } from "../tools/taskOutputTool.js";
import { taskStopTool } from "../tools/taskStopTool.js";
import { editTool } from "../tools/editTool.js";
import { writeTool } from "../tools/writeTool.js";
import { exitPlanModeTool } from "../tools/exitPlanMode.js";
import { askUserQuestionTool } from "../tools/askUserQuestion.js";
// New tools
import { globTool } from "../tools/globTool.js";
import { grepTool } from "../tools/grepTool.js";
import { lsTool } from "../tools/lsTool.js";
import { readTool } from "../tools/readTool.js";
import { lspTool } from "../tools/lspTool.js";
import { taskTool } from "../tools/taskTool.js";
import { skillTool } from "../tools/skillTool.js";
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
  PermissionMode,
  PermissionCallback,
  ILspManager,
} from "../types/index.js";
import type { SubagentManager } from "./subagentManager.js";
import type { SkillManager } from "./skillManager.js";

import { ReversionManager } from "./reversionManager.js";

import { Container } from "../utils/container.js";

import { logger } from "../utils/globalLogger.js";

export interface ToolManagerOptions {
  container: Container;
  /** Optional list of tool names to enable */
  tools?: string[];
}

/**
 * Tool Manager
 *
 * Manages tool registration and execution with optional permission system integration.
 * Supports both built-in tools and MCP (Model Context Protocol) tools.
 */
class ToolManager {
  private toolsRegistry = new Map<string, ToolPlugin>();
  private tools?: string[];
  private container: Container;

  constructor(options: ToolManagerOptions) {
    this.container = options.container;
    this.tools = options.tools;
  }

  private get mcpManager(): McpManager {
    return this.container.get<McpManager>("McpManager")!;
  }

  /**
   * Register a new tool
   */
  public register(tool: ToolPlugin): void {
    this.toolsRegistry.set(tool.name, tool);
  }

  /**
   * Initialize built-in tools. Can be called with dependencies for tools that require them.
   *
   * This method can be called multiple times safely. When called without dependencies,
   * it registers basic tools (Bash, Read, Write, TaskCreate, etc.). When called with
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
  public initializeBuiltInTools(): void {
    const builtInTools = [
      bashTool,
      taskOutputTool,
      taskStopTool,
      editTool,
      writeTool,
      exitPlanModeTool,
      askUserQuestionTool,
      globTool,
      grepTool,
      lsTool,
      readTool,
      lspTool,
      taskTool,
      skillTool,
      taskCreateTool,
      taskGetTool,
      taskUpdateTool,
      taskListTool,
    ];

    for (const tool of builtInTools) {
      if (this.shouldEnableTool(tool.name)) {
        this.toolsRegistry.set(tool.name, tool);
      }
    }
  }

  /**
   * Check if a tool should be enabled based on tools configuration
   */
  private shouldEnableTool(name: string): boolean {
    if (!this.tools) {
      return true;
    }
    return this.tools.some(
      (toolName) => toolName.toLowerCase() === name.toLowerCase(),
    );
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
    const permissionManager =
      this.container.get<PermissionManager>("PermissionManager");
    const permissionMode = this.container.has("PermissionMode")
      ? this.container.get<PermissionMode>("PermissionMode")
      : undefined;

    // Resolve effective permission mode (CLI override > configuration > default)
    const effectivePermissionMode = permissionManager
      ? permissionManager.getCurrentEffectiveMode(permissionMode)
      : permissionMode || "default";

    // Enhance context with permission-related fields
    const canUseToolCallback = this.container.has("CanUseToolCallback")
      ? this.container.get<PermissionCallback>("CanUseToolCallback")
      : undefined;

    const enhancedContext: ToolContext = {
      ...context,
      permissionMode: effectivePermissionMode,
      canUseToolCallback,
      permissionManager,
      taskManager:
        this.container.get<import("../services/taskManager.js").TaskManager>(
          "TaskManager",
        )!,
      reversionManager:
        this.container.get<ReversionManager>("ReversionManager")!,
      backgroundTaskManager: this.container.get<
        import("./backgroundTaskManager.js").BackgroundTaskManager
      >("BackgroundTaskManager")!,
      foregroundTaskManager: this.container.get<
        import("../types/processes.js").IForegroundTaskManager
      >("ForegroundTaskManager")!,
      mcpManager: this.mcpManager,
      lspManager: this.container.get<ILspManager>("LspManager")!,
      subagentManager: this.container.has("SubagentManager")
        ? this.container.get<SubagentManager>("SubagentManager")
        : undefined,
      skillManager: this.container.has("SkillManager")
        ? this.container.get<SkillManager>("SkillManager")
        : undefined,
      sessionId: context.sessionId,
    };

    logger?.debug("Executing tool with enhanced context", {
      toolName: name,
      permissionMode,
      effectivePermissionMode,
      hasPermissionManager: !!permissionManager,
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
    const plugin = this.toolsRegistry.get(name);
    if (plugin) {
      try {
        return await plugin.execute(args, enhancedContext);
      } catch (error) {
        logger?.error("Tool execution failed", {
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

    logger?.warn("Tool not found", { toolName: name });
    return {
      success: false,
      content: "",
      error: `Tool '${name}' not found`,
    };
  }

  list(): ToolPlugin[] {
    const builtInTools = Array.from(this.toolsRegistry.values());
    const mcpTools = this.mcpManager.getMcpToolPlugins();
    return [...builtInTools, ...mcpTools];
  }

  getToolsConfig(): ChatCompletionFunctionTool[] {
    const effectivePermissionMode = this.getPermissionMode();
    const builtInToolsConfig = Array.from(this.toolsRegistry.values())
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
    return Array.from(this.toolsRegistry.values());
  }

  /**
   * Get the current permission mode
   */
  public getPermissionMode(): PermissionMode {
    const permissionManager =
      this.container.get<PermissionManager>("PermissionManager");
    const permissionMode = this.container.has("PermissionMode")
      ? this.container.get<PermissionMode>("PermissionMode")
      : undefined;

    if (permissionManager) {
      return permissionManager.getCurrentEffectiveMode(permissionMode);
    }
    return permissionMode || "default";
  }

  /**
   * Set the permission mode
   * @param mode - The new permission mode
   */
  public setPermissionMode(mode: PermissionMode): void {
    this.container.register("PermissionMode", mode);
  }

  /**
   * Get the permission manager
   */
  public getPermissionManager(): PermissionManager | undefined {
    return this.container.get<PermissionManager>("PermissionManager");
  }

  /**
   * Get the task manager
   */
  public getTaskManager():
    | import("../services/taskManager.js").TaskManager
    | undefined {
    return this.container.get<import("../services/taskManager.js").TaskManager>(
      "TaskManager",
    );
  }
}

// Export tool registry class and types
export { ToolManager };
