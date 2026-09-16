import type { ToolContext, ToolPlugin, ToolResult } from "../tools/types.js";
import { bashTool } from "../tools/bashTool.js";
import { taskStopTool } from "../tools/taskStopTool.js";
import { editTool } from "../tools/editTool.js";
import { writeTool } from "../tools/writeTool.js";
import { exitPlanModeTool } from "../tools/exitPlanMode.js";
import { enterPlanModeTool } from "../tools/enterPlanMode.js";
import { askUserQuestionTool } from "../tools/askUserQuestion.js";
import { cronCreateTool } from "../tools/cronCreateTool.js";
import { cronDeleteTool } from "../tools/cronDeleteTool.js";
import { cronListTool } from "../tools/cronListTool.js";
import { webFetchTool } from "../tools/webFetchTool.js";
import { artifactTool } from "../tools/artifactTool.js";
import { execTool } from "../tools/execTool.js";
import { isArtifactEnabled } from "../services/artifactAvailability.js";
import { isExecEnabled } from "../services/execAvailability.js";
import { buildExecPool, renderCatalog } from "../exec/catalog.js";
import type { ExecPoolEntry, RenderedCatalog } from "../exec/catalog.js";
import { EXEC_DEFAULT_CATALOG_TOKENS } from "../exec/constants.js";
import { EXEC_TOOL_NAME } from "../constants/tools.js";
// New tools
import { globTool } from "../tools/globTool.js";
import { grepTool } from "../tools/grepTool.js";
import { readTool } from "../tools/readTool.js";
import { lspTool } from "../tools/lspTool.js";
import { agentTool } from "../tools/agentTool.js";
import { skillTool } from "../tools/skillTool.js";
import {
  taskCreateTool,
  taskGetTool,
  taskUpdateTool,
  taskListTool,
} from "../tools/taskManagementTools.js";
import { enterWorktreeTool } from "../tools/enterWorktreeTool.js";
import { exitWorktreeTool } from "../tools/exitWorktreeTool.js";
import { workflowTool } from "../tools/workflowTool.js";
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
import * as aiService from "../services/aiService.js";

import { Container } from "../utils/container.js";

import { logger } from "../utils/globalLogger.js";

import type { SubagentConfiguration } from "../utils/subagentParser.js";
import type { SkillMetadata } from "../types/skills.js";
import { startToolSpan, endToolSpan } from "../telemetry/sessionTracing.js";

export interface ToolManagerOptions {
  container: Container;
  /** Optional list of tool names to enable */
  tools?: string[];
  /** Custom tools to register alongside built-in tools */
  customTools?: ToolPlugin[];
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
  private customTools?: ToolPlugin[];
  private container: Container;

  constructor(options: ToolManagerOptions) {
    this.container = options.container;
    this.tools = options.tools;
    this.customTools = options.customTools;
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
   * dependencies, it also registers tools that require managers (Agent, Skill).
   *
   * @param deps Optional dependencies for advanced tools
   * @param deps.subagentManager SubagentManager instance for Agent tool
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
      taskStopTool,
      editTool,
      writeTool,
      exitPlanModeTool,
      enterPlanModeTool,
      askUserQuestionTool,
      globTool,
      grepTool,
      readTool,
      lspTool,
      agentTool,
      skillTool,
      taskCreateTool,
      taskGetTool,
      taskUpdateTool,
      taskListTool,
      cronCreateTool,
      cronDeleteTool,
      cronListTool,
      webFetchTool,
      enterWorktreeTool,
      exitWorktreeTool,
      workflowTool,
    ];

    // Artifact is a feature-gated tool: not registered at all while the frame
    // backend is not live, unless settings.json opts in via enableArtifact: true.
    if (isArtifactEnabled(this.container.get<string>("Workdir"))) {
      builtInTools.push(artifactTool);
    }

    // Exec is on by default; enableExec: false restores flat MCP declarations.
    // Registration is decoupled from declaration: getToolsConfig() only declares
    // it (and only then collapses the MCP pool) once MCP servers have connected
    // and yielded a non-empty pool, which cannot be known until then.
    if (isExecEnabled(this.container.get<string>("Workdir"))) {
      builtInTools.push(execTool);
    }

    for (const tool of builtInTools) {
      if (this.shouldEnableTool(tool.name)) {
        this.toolsRegistry.set(tool.name, tool);
      }
    }

    // Register custom tools
    for (const tool of this.customTools || []) {
      if (this.shouldEnableTool(tool.name)) {
        this.toolsRegistry.set(tool.name, tool);
      }
    }
  }

  /**
   * Re-evaluate feature-gated built-in tools after a live configuration
   * reload. Currently gates the Artifact tool on settings.json
   * `enableArtifact` and the Exec tool on `enableExec`. Safe to call multiple
   * times: gated tools are removed from the registry first, then
   * initializeBuiltInTools() re-registers them only if still enabled (so
   * toggling a flag off actually unregisters).
   */
  public reloadFeatureGatedTools(): void {
    this.toolsRegistry.delete(artifactTool.name);
    this.toolsRegistry.delete(execTool.name);
    this.initializeBuiltInTools();
  }

  /**
   * Check if a tool should be enabled based on tools configuration and permission rules
   */
  private shouldEnableTool(name: string): boolean {
    const permissionManager =
      this.container.get<PermissionManager>("PermissionManager");

    // If tool is explicitly denied by name in permission rules, filter it out
    if (permissionManager?.isToolDenied(name)) {
      return false;
    }

    if (!this.tools) {
      return true;
    }
    return this.tools.some(
      (toolName) => toolName.toLowerCase() === name.toLowerCase(),
    );
  }

  /**
   * The auto-memory directory for this session, or undefined when the feature
   * is off. Consumers (Read) treat "unset" as "not a memory file".
   */
  private resolveAutoMemoryDir(workdir: string): string | undefined {
    if (!this.container.has("MemoryService")) return undefined;
    const configuration = this.container.has("ConfigurationService")
      ? this.container.get<
          import("../services/configurationService.js").ConfigurationService
        >("ConfigurationService")
      : undefined;
    if (!configuration?.resolveAutoMemoryEnabled?.()) return undefined;
    return this.container
      .get<import("../services/memory.js").MemoryService>("MemoryService")
      ?.getAutoMemoryDirectory?.(workdir);
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
      toolManager: this,
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
      cronManager: this.container.has("CronManager")
        ? this.container.get<import("./cronManager.js").CronManager>(
            "CronManager",
          )
        : undefined,
      aiManager: this.container.has("AIManager")
        ? this.container.get<import("./aiManager.js").AIManager>("AIManager")
        : undefined,
      aiService: aiService,
      messageManager:
        this.container.get<import("./messageManager.js").MessageManager>(
          "MessageManager",
        )!,
      hookManager: this.container.has("HookManager")
        ? this.container.get<import("./hookManager.js").HookManager>(
            "HookManager",
          )
        : undefined,
      workflowManager: this.container.has("WorkflowManager")
        ? this.container.get<import("./workflowManager.js").WorkflowManager>(
            "WorkflowManager",
          )
        : undefined,
      sessionEnv: this.container.has("ConfigurationService")
        ? this.container
            .get<
              import("../services/configurationService.js").ConfigurationService
            >("ConfigurationService")
            ?.getMergedEnv?.()
        : undefined,
      autoMemoryDir: this.resolveAutoMemoryDir(context.workdir),
      sessionId: context.sessionId,
      toolCallId: context.toolCallId,
    };

    // OpenTelemetry: start tool span
    startToolSpan(name, args);
    const toolStartTime = Date.now();

    logger?.debug("Executing tool with enhanced context", {
      toolName: name,
      permissionMode,
      effectivePermissionMode,
      hasPermissionManager: !!permissionManager,
    });

    // Check if it's an MCP tool first
    if (this.mcpManager.isMcpTool(name)) {
      try {
        const result = await this.mcpManager.executeMcpToolByRegistry(
          name,
          args,
          enhancedContext,
        );
        endToolSpan({
          success: result.success,
          durationMs: Date.now() - toolStartTime,
          output: result.content,
        });
        return result;
      } catch (error) {
        endToolSpan({
          success: false,
          error: error instanceof Error ? error.message : String(error),
          durationMs: Date.now() - toolStartTime,
        });
        return {
          success: false,
          content: "",
          error: error instanceof Error ? error.message : String(error),
        };
      }
    }

    // Check built-in tools
    const plugin = this.toolsRegistry.get(name);
    if (plugin) {
      try {
        const result = await plugin.execute(args, enhancedContext);
        endToolSpan({
          success: result.success,
          durationMs: Date.now() - toolStartTime,
          output: result.content,
        });
        return result;
      } catch (error) {
        logger?.error("Tool execution failed", {
          toolName: name,
          error: error instanceof Error ? error.message : String(error),
        });
        endToolSpan({
          success: false,
          error: error instanceof Error ? error.message : String(error),
          durationMs: Date.now() - toolStartTime,
        });
        return {
          success: false,
          content: "",
          error: error instanceof Error ? error.message : String(error),
        };
      }
    }

    logger?.warn("Tool not found", { toolName: name });
    endToolSpan({
      success: false,
      error: `Tool '${name}' not found`,
      durationMs: Date.now() - toolStartTime,
    });
    return {
      success: false,
      content: "",
      error: `Tool '${name}' not found`,
    };
  }

  list(): ToolPlugin[] {
    const permissionManager =
      this.container.get<PermissionManager>("PermissionManager");
    const builtInTools = Array.from(this.toolsRegistry.values()).filter(
      (tool) => !permissionManager?.isToolDenied(tool.name),
    );
    const mcpTools = this.mcpManager
      .getMcpToolPlugins()
      .filter((tool) => !permissionManager?.isToolDenied(tool.name));
    return [...builtInTools, ...mcpTools];
  }

  /**
   * Whether `Exec` is declared at all: registered and not denied. Exactly when the
   * catalog channel is open — an undeclared `Exec` cannot be called, so a catalog
   * for it would advertise a way in that does not exist.
   */
  private isExecDeclared(): boolean {
    return (
      this.toolsRegistry.has(EXEC_TOOL_NAME) &&
      !this.getPermissionManager()?.isToolDenied(EXEC_TOOL_NAME)
    );
  }

  /** The tools the sandbox may reach — the pool the flat declarations give up. */
  private execPool(): ExecPoolEntry[] {
    return buildExecPool(this.mcpManager, this.getPermissionManager());
  }

  /**
   * The MCP catalog as the model is meant to see it, or `undefined` when the
   * catalog channel is closed.
   *
   * A function of the pool alone, and computed per call: with the catalog out of
   * `tools[]` the declaration no longer moves when a server comes or goes, and the
   * announcement channel diffs this against the history. Caching the rendering would
   * mean caching pool state, which is exactly the process-side bookkeeping the
   * channel is built to avoid.
   */
  public getExecCatalog(): RenderedCatalog | undefined {
    if (!this.isExecDeclared()) return undefined;
    return renderCatalog(this.execPool(), EXEC_DEFAULT_CATALOG_TOKENS);
  }

  getToolsConfig(options?: {
    availableSubagents?: SubagentConfiguration[];
    availableSkills?: SkillMetadata[];
    workdir?: string;
    isSubagent?: boolean;
  }): ChatCompletionFunctionTool[] {
    const permissionManager = this.getPermissionManager();

    // Exec either replaces the flat MCP declarations or is absent: the two must
    // never coexist, or the model would see the same tool twice while the
    // catalog claimed to be the only way in. Both halves are derived from the
    // same pool, and the pool is exactly what the agent could already call
    // directly, so collapsing it cannot widen access.
    const execPool = this.execPool();
    // No minimum pool size: any catalogable tool collapses the pool, matching
    // opencode. The switch (`enableExec`), not a count, decides whether Exec is
    // used at all.
    const collapseMcp = this.isExecDeclared() && execPool.length > 0;

    const builtInToolsConfig = Array.from(this.toolsRegistry.values())
      .filter((tool) => {
        // With an empty pool there is nothing to collapse, so Exec stays
        // registered but undeclared rather than declaring an empty catalog.
        if (tool.name === EXEC_TOOL_NAME && !collapseMcp) {
          return false;
        }
        // If tool is explicitly denied by name in permission rules, filter it out
        if (permissionManager?.isToolDenied(tool.name)) {
          return false;
        }
        return true;
      })
      .map((tool) => {
        // Create a copy of the tool config to avoid modifying the original
        const config = {
          ...tool.config,
          function: {
            ...tool.config.function,
          },
        };
        // Override description with prompt if available
        if (tool.prompt) {
          config.function.description = tool.prompt({ ...options });
        }
        return config;
      });
    const mcpToolsConfig = collapseMcp
      ? []
      : this.mcpManager.getMcpToolsConfig().filter((tool) => {
          if (permissionManager?.isToolDenied(tool.function.name)) {
            return false;
          }
          return true;
        });
    return [...builtInToolsConfig, ...mcpToolsConfig];
  }

  /**
   * Get the list of registered tool plugins
   */
  public getTools(): ToolPlugin[] {
    return Array.from(this.toolsRegistry.values());
  }

  /**
   * Check whether a tool is safe to execute in parallel with other tools.
   * Built-in tools default to safe (parallel); Edit and Write opt out.
   * MCP tools are conservatively non-safe (can't inspect side effects).
   */
  public isConcurrencySafe(name: string): boolean {
    // MCP tools are conservatively non-safe
    if (this.mcpManager.isMcpTool(name)) {
      return false;
    }
    const plugin = this.toolsRegistry.get(name);
    if (plugin) {
      return plugin.isConcurrencySafe ?? true;
    }
    // Unknown tools are conservatively non-safe
    return false;
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
   * Request a full permission mode transition (planManager + UI callback).
   * Used by tools like EnterPlanMode in bypass mode where the canUseTool
   * callback (which normally handles the transition) is not invoked.
   * In normal mode, the callback already handles the transition.
   */
  public requestPermissionModeChange(mode: PermissionMode): void {
    if (this.container.has("PermissionModeTransition")) {
      const transition = this.container.get<(mode: PermissionMode) => void>(
        "PermissionModeTransition",
      );
      if (transition) {
        transition(mode);
        return;
      }
    }
    this.setPermissionMode(mode);
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
