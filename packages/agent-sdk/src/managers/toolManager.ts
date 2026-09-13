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
import { isArtifactEnabled } from "../services/artifactAvailability.js";
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
import {
  TOOL_INVOKE_TOOL_NAME,
  TOOL_SEARCH_TOOL_NAME,
  buildToolInvokeConfig,
  buildToolSearchConfig,
} from "../tools/deferredTools.js";
import { parseMcpToolName } from "../utils/mcpUtils.js";
import {
  RESERVED_BUILTIN_NAMESPACE,
  renderCatalog,
  renderUnknownTargetMessage,
  searchCatalog,
  type CatalogTool,
} from "../utils/toolCatalog.js";
import {
  DEFERRED_TOOLS_MIN_DEFERRABLE_TOOLS,
  isDeferredToolsEnabled,
  readDeferredToolsSettings,
} from "../services/deferredToolsAvailability.js";
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
 * The per-agent result of opening the deferred-loading gate: which tools leave
 * the declared list, what replaces them, and the catalog the model can address.
 *
 * Built from the *current* agent's pool on every request — never cached across
 * agents or reused from the root container, because the catalog doubles as the
 * addressable set that `ToolInvoke` will accept (a shared catalog would turn
 * forwarding into a privilege-escalation path).
 */
export interface DeferredToolsPlan {
  /** Everything addressable through `ToolInvoke`: resident + search-only. */
  catalog: CatalogTool[];
  /** Leaf names that must leave the declared tool list. */
  deferredLeafNames: Set<string>;
  /** The declarations that replace them (`ToolInvoke` + `ToolSearch`). */
  mechanismTools: ChatCompletionFunctionTool[];
  /** Resident entries / complete entries, for host-side logging. */
  shownTools: number;
  totalTools: number;
  /** Rendered catalog size and the budget it was held to. */
  tokens: number;
  budgetTokens: number;
}

function asSchemaRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
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
  /** MCP servers already warned about the reserved-namespace collision. */
  private collisionWarnedServers = new Set<string>();

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
   * `enableArtifact`. Safe to call multiple times: gated tools are removed
   * from the registry first, then initializeBuiltInTools() re-registers them
   * only if still enabled (so toggling the flag off actually unregisters).
   */
  public reloadFeatureGatedTools(): void {
    this.toolsRegistry.delete(artifactTool.name);
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

    // Deferred-loading mechanism tools are not registered plugins: they exist
    // only while the gate is open, and are dispatched straight to the leaf they
    // name.
    if (name === TOOL_INVOKE_TOOL_NAME || name === TOOL_SEARCH_TOOL_NAME) {
      const result =
        name === TOOL_INVOKE_TOOL_NAME
          ? await this.invokeDeferredTool(args, enhancedContext)
          : this.searchDeferredTools(args, enhancedContext.workdir);
      endToolSpan({
        success: result.success,
        durationMs: Date.now() - toolStartTime,
        output: result.content,
        error: result.error,
      });
      return result;
    }

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

  /**
   * Forward a `ToolInvoke` call to the leaf it names.
   *
   * The target must be in *this* agent's catalog (resident or search-only):
   * anything else is refused, which is what keeps forwarding from becoming a
   * privilege-escalation path (`ToolInvoke({builtin, Write})` from a subagent
   * that has no `Write` fails here, and it is not asserted by a permission rule
   * but by the pool itself).
   *
   * The leaf is then executed through the normal path with its own name and its
   * own args, so its permission check, rule matching (`Bash(npm test)` sees the
   * leaf's `command`), error shape and side effects are exactly the ones it has
   * when declared individually — the outer `namespace` / `tool` / `args` fields
   * never reach the permission layer.
   */
  private async invokeDeferredTool(
    args: Record<string, unknown>,
    context: ToolContext,
  ): Promise<ToolResult> {
    const permissionManager =
      this.container.get<PermissionManager>("PermissionManager");
    if (permissionManager?.isToolDenied(TOOL_INVOKE_TOOL_NAME)) {
      return {
        success: false,
        content: "",
        error: `Tool '${TOOL_INVOKE_TOOL_NAME}' is denied by permission rules.`,
      };
    }

    const namespace =
      typeof args.namespace === "string" ? args.namespace.trim() : "";
    const tool = typeof args.tool === "string" ? args.tool.trim() : "";
    const leafArgs = asSchemaRecord(args.args) ?? {};

    const plan = this.getDeferredToolsPlan(context.workdir);
    if (!plan) {
      return {
        success: false,
        content: "",
        error:
          "No deferred tools are declared in this session, so there is nothing to forward. " +
          "Call the tool directly if it appears in the tool list.",
      };
    }
    if (!namespace || !tool) {
      return {
        success: false,
        content: "",
        error: `${TOOL_INVOKE_TOOL_NAME} requires "namespace" and "tool". ${renderUnknownTargetMessage(plan.catalog, namespace, tool)}`,
      };
    }

    const target = plan.catalog.find(
      (entry) => entry.namespace === namespace && entry.tool === tool,
    );
    if (!target) {
      return {
        success: false,
        content: "",
        error: renderUnknownTargetMessage(plan.catalog, namespace, tool),
      };
    }

    return this.execute(target.leafName, leafArgs, context);
  }

  /**
   * Search the complete catalog (resident + truncated entries). Read-only and
   * approval-free: it only reads the pool this agent already has.
   */
  private searchDeferredTools(
    args: Record<string, unknown>,
    workdir?: string,
  ): ToolResult {
    const plan = this.getDeferredToolsPlan(workdir);
    if (!plan) {
      return {
        success: false,
        content: "",
        error:
          "Tool search is unavailable: no deferred tools are declared in this session.",
      };
    }
    const query = typeof args.query === "string" ? args.query : "";
    if (!query.trim()) {
      return {
        success: false,
        content: "",
        error: `${TOOL_SEARCH_TOOL_NAME} requires a non-empty "query".`,
      };
    }
    const result = searchCatalog(plan.catalog, {
      query,
      limit: typeof args.limit === "number" ? args.limit : undefined,
      offset: typeof args.offset === "number" ? args.offset : undefined,
    });
    return { success: true, content: result.text };
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

  getToolsConfig(options?: {
    availableSubagents?: SubagentConfiguration[];
    availableSkills?: SkillMetadata[];
    workdir?: string;
    isSubagent?: boolean;
  }): ChatCompletionFunctionTool[] {
    const permissionManager =
      this.container.get<PermissionManager>("PermissionManager");
    const builtInToolsConfig = Array.from(this.toolsRegistry.values())
      .filter((tool) => {
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
          config.function.description = tool.prompt(options);
        }
        return config;
      });
    const mcpToolsConfig = this.mcpManager
      .getMcpToolsConfig()
      .filter((tool) => {
        if (permissionManager?.isToolDenied(tool.function.name)) {
          return false;
        }
        return true;
      });
    return this.applyDeferredTools(
      [...builtInToolsConfig, ...mcpToolsConfig],
      options?.workdir,
    );
  }

  /**
   * Build the deferred-loading plan for the current agent's pool, or `null`
   * when the gate is closed.
   *
   * Deferrable tools = MCP tools (deferred by default, with a per-server
   * `alwaysLoadTools` escape hatch) + built-in tools explicitly annotated
   * `defer: true`. Built-ins are whitelist-only on purpose: schema size and
   * apparent call frequency are not evidence that a tool is safe to hide, and
   * tools the model only reaches for spontaneously (task management, mode
   * switching, skills, …) lose far more than the declaration bytes they save.
   */
  public getDeferredToolsPlan(workdir?: string): DeferredToolsPlan | null {
    const permissionManager =
      this.container.get<PermissionManager>("PermissionManager");
    // Denying a mechanism tool means forwarding is not available at all: fall
    // back to declaring everything individually instead of declaring a tool
    // that can never run.
    if (permissionManager?.isToolDenied(TOOL_INVOKE_TOOL_NAME)) return null;
    if (permissionManager?.isToolDenied(TOOL_SEARCH_TOOL_NAME)) return null;

    const catalog: CatalogTool[] = [];

    // Built-in tools: only explicit `defer: true` participates. A `--tools`
    // session lists its tools explicitly, and explicitly listed tools must
    // always be declared individually, so no built-in is deferrable there.
    if (!this.tools) {
      for (const plugin of this.toolsRegistry.values()) {
        if (plugin.defer !== true) continue;
        if (permissionManager?.isToolDenied(plugin.name)) continue;
        catalog.push({
          namespace: RESERVED_BUILTIN_NAMESPACE,
          tool: plugin.name,
          leafName: plugin.name,
          description: plugin.config.function.description ?? "",
          parameters: asSchemaRecord(plugin.config.function.parameters),
        });
      }
    }

    for (const plugin of this.mcpManager.getMcpToolPlugins()) {
      if (permissionManager?.isToolDenied(plugin.name)) continue;
      // Explicitly listed (`--tools`) MCP tools are always flat. Note that
      // `--tools` still does not *filter* MCP tools — that orthogonal gap is
      // documented in the spec and out of scope here.
      if (
        this.tools?.some(
          (name) => name.toLowerCase() === plugin.name.toLowerCase(),
        )
      ) {
        continue;
      }
      const parsed = parseMcpToolName(plugin.name);
      if (!parsed) continue;
      if (parsed.server === RESERVED_BUILTIN_NAMESPACE) {
        this.warnReservedNamespaceCollision(parsed.server);
        continue;
      }
      if (
        this.mcpManager
          .getServer(parsed.server)
          ?.config.alwaysLoadTools?.includes(parsed.tool)
      ) {
        continue;
      }
      catalog.push({
        namespace: parsed.server,
        tool: parsed.tool,
        leafName: plugin.name,
        description: plugin.config.function.description ?? "",
        parameters: asSchemaRecord(plugin.config.function.parameters),
      });
    }

    if (catalog.length === 0) return null;

    const settings = readDeferredToolsSettings(workdir);
    if (!isDeferredToolsEnabled(catalog.length, settings)) {
      logger?.debug("Deferred tool loading gate is closed", {
        deferrableTools: catalog.length,
        minDeferrableTools: DEFERRED_TOOLS_MIN_DEFERRABLE_TOOLS,
        explicit: settings.enabled,
      });
      return null;
    }

    const rendered = renderCatalog(catalog, {
      budgetTokens: settings.tokenBudget,
    });
    // The budget number is operational only: it stays in host logs and never
    // reaches model-visible text.
    const stats = {
      shownTools: rendered.shownTools,
      totalTools: rendered.totalTools,
      tokens: rendered.tokens,
      budgetTokens: settings.tokenBudget,
    };
    if (rendered.complete) {
      logger?.debug("Deferred tools catalog rendered", stats);
    } else {
      logger?.info("Deferred tools catalog truncated to fit its budget", stats);
    }

    return {
      catalog,
      deferredLeafNames: new Set(catalog.map((entry) => entry.leafName)),
      mechanismTools: [
        buildToolInvokeConfig(rendered.text),
        buildToolSearchConfig(),
      ],
      shownTools: rendered.shownTools,
      totalTools: rendered.totalTools,
      tokens: rendered.tokens,
      budgetTokens: settings.tokenBudget,
    };
  }

  /**
   * Split a declared tool list into the tools that stay declared plus the
   * mechanism tools that carry the rest.
   *
   * Returns `toolsConfig` **unchanged** when the gate is closed, so the
   * disabled path emits byte-identical tool declarations to the pre-deferral
   * behaviour (the regression red line in `tool-deferred-loading.md`).
   */
  public applyDeferredTools(
    toolsConfig: ChatCompletionFunctionTool[],
    workdir?: string,
  ): ChatCompletionFunctionTool[] {
    const plan = this.getDeferredToolsPlan(workdir);
    if (!plan) return toolsConfig;
    const declared = toolsConfig.filter(
      (tool) => !plan.deferredLeafNames.has(tool.function.name),
    );
    return [...declared, ...plan.mechanismTools];
  }

  private warnReservedNamespaceCollision(serverName: string): void {
    if (this.collisionWarnedServers.has(serverName)) return;
    this.collisionWarnedServers.add(serverName);
    logger?.warn(
      `MCP server "${serverName}" uses the reserved deferred-loading namespace; ` +
        `its tools stay individually declared (not in the ToolInvoke catalog) and remain callable by full name. ` +
        `Rename the server in your MCP configuration to have its tools participate in deferred loading.`,
      { server: serverName, reservedNamespace: RESERVED_BUILTIN_NAMESPACE },
    );
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
