import type { ToolContext, ToolPlugin, ToolResult } from "../tools/types.js";
import { validateToolInput } from "../tools/inputValidation.js";
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
import {
  getNonDeferrableBuiltins,
  isExecEnabled,
} from "../services/execAvailability.js";
import { isLeanPromptEnabled } from "../services/leanPrompt.js";
import { buildExecPool } from "../exec/catalog.js";
import type { ExecPoolCandidate, ExecPoolEntry } from "../exec/catalog.js";
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
import { HookBlockedToolError } from "../types/hooks.js";

import { ReversionManager } from "./reversionManager.js";
import * as aiService from "../services/aiService.js";

import { Container } from "../utils/container.js";
import { appendMemoryCapNotice } from "../utils/memoryCapNotices.js";

import { logger } from "../utils/globalLogger.js";

import type { SubagentConfiguration } from "../utils/subagentParser.js";
import type { SkillMetadata } from "../types/skills.js";
import {
  recordLinesChanged,
  recordToolActivity,
} from "../telemetry/metrics.js";
import type { RecordContext } from "../telemetry/metrics.js";
import { entrypointOf } from "../telemetry/attributes.js";
import { detectBashActivity } from "../telemetry/toolActivity.js";
import { trackCliOperation } from "../telemetry/activity.js";

export interface ToolManagerOptions {
  container: Container;
  /** Optional list of tool names to enable */
  tools?: string[];
  /** Custom tools to register alongside built-in tools */
  customTools?: ToolPlugin[];
}

/**
 * The session a tool call belongs to, for the standard attributes of the
 * records it produces. The tool context is the one place every call passes
 * through, so both the flat and the nested (Exec sandbox) path have it; the
 * entrypoint comes from the container instead — it is a property of the session,
 * not of the call, and the context is rebuilt per call.
 */
function recordContextOf(
  context: {
    sessionId?: string;
    workdir?: string;
  },
  container: Container,
): RecordContext {
  return {
    sessionId: context.sessionId,
    workdir: context.workdir,
    entrypoint: entrypointOf(container),
  };
}

/**
 * Feed an edit tool's line delta into the `wave.lines.changed` counter.
 *
 * Editing tools report `linesAdded` / `linesRemoved` in `result.metadata`;
 * every other tool carries no metadata and contributes nothing. A failed call
 * changed no file, so nothing is recorded.
 */
function recordLinesChangedFromResult(
  result: ToolResult,
  context: { sessionId?: string; workdir?: string },
  container: Container,
): void {
  const metadata = result.metadata;
  if (!result.success || !metadata) return;
  const added = Number(metadata.linesAdded);
  const removed = Number(metadata.linesRemoved);
  recordLinesChanged(
    {
      added: Number.isFinite(added) ? added : undefined,
      removed: Number.isFinite(removed) ? removed : undefined,
    },
    recordContextOf(context, container),
  );
}

/**
 * Count the commit / PR-MR a Bash call created (see `detectBashActivity`).
 * Recognition is of the command the tool was asked to run, so a failed call
 * created nothing and records nothing — the same gate as the line delta above.
 */
function recordBashActivity(
  name: string,
  args: Record<string, unknown>,
  result: ToolResult,
  context: { sessionId?: string; workdir?: string },
  container: Container,
): void {
  if (name !== "Bash" || !result.success) return;
  const command = typeof args.command === "string" ? args.command : "";
  if (!command) return;
  recordToolActivity(
    detectBashActivity(command),
    recordContextOf(context, container),
  );
}

/**
 * Tool Manager
 *
 * Manages tool registration and execution with optional permission system integration.
 * Supports both built-in tools and MCP (Model Context Protocol) tools.
 */
class ToolManager {
  private toolsRegistry = new Map<string, ToolPlugin>();
  /**
   * The plugin objects wave itself registered, by identity rather than by name:
   * a custom tool that shadows a built-in name must not inherit its validation
   * (`register()` replaces the registry entry, the object stays behind here).
   */
  private builtInTools = new WeakSet<ToolPlugin>();
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
   *
   * `options.builtIn` marks a tool whose `config.function.parameters` is wave's
   * own contract, and whose calls are therefore checked against it (see
   * `validateToolInput`). Custom tools registered by SDK users are not checked:
   * their schema is theirs to enforce (spec `core/tool-input-validation.md`).
   */
  public register(tool: ToolPlugin, options?: { builtIn?: boolean }): void {
    this.toolsRegistry.set(tool.name, tool);
    if (options?.builtIn === true) {
      this.builtInTools.add(tool);
    }
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

    // Artifact is a feature-gated tool: on by default for a logged-in account,
    // opt-in via enableArtifact: true for anyone else, opt-out via false.
    if (isArtifactEnabled(this.container.get<string>("Workdir"))) {
      builtInTools.push(artifactTool);
    }

    // Exec is on by default; enableExec: false turns it off. Registration is
    // decoupled from declaration: getToolsConfig() declares it only while the
    // deferral table yields a non-empty pool, which depends on the runtime tool set.
    if (isExecEnabled(this.container.get<string>("Workdir"))) {
      builtInTools.push(execTool);
    }

    for (const tool of builtInTools) {
      if (this.shouldEnableTool(tool.name)) {
        this.register(tool, { builtIn: true });
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
    // One tool execution is one CLI-active operation for its session. Nested
    // and parallel calls collapse into a single interval — the set the activity
    // tracker keeps is what makes concurrent work count once, not per call.
    return trackCliOperation(
      "tool",
      recordContextOf(context, this.container),
      () => this.executeTool(name, args, context),
    );
  }

  /**
   * The body of {@link execute}: resolve the effective permission mode and the
   * per-session wiring, then run the tool.
   */
  private async executeTool(
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
      pageWatchManager: this.container.has("PageWatchManager")
        ? this.container.get<import("./pageWatchManager.js").PageWatchManager>(
            "PageWatchManager",
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

    logger?.debug("Executing tool with enhanced context", {
      toolName: name,
      permissionMode,
      effectivePermissionMode,
      hasPermissionManager: !!permissionManager,
    });

    // Check if it's an MCP tool first. Tool-event hooks for MCP live in
    // `McpManager.executeMcpTool` — the one funnel every MCP call goes through,
    // flat or nested — so they are not run a second time here.
    if (this.mcpManager.isMcpTool(name)) {
      try {
        const result = await this.mcpManager.executeMcpToolByRegistry(
          name,
          args,
          enhancedContext,
        );
        return result;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        // A hook block is a refusal, not a tool failure: keep its wording in
        // the result so a flat call shows the model what a nested one sees.
        return error instanceof HookBlockedToolError
          ? { success: false, content: message, error: message }
          : { success: false, content: "", error: message };
      }
    }

    // Check built-in tools. PreToolUse / PostToolUse belong here rather than in
    // the tool-call loop: this is the one funnel built-ins are reached through,
    // so a call made from inside the Exec sandbox runs the same hooks a flat
    // call does.
    const plugin = this.toolsRegistry.get(name);
    if (plugin) {
      // Arguments are checked against the schema the tool declares *before* the
      // hooks and before the tool runs: a call whose parameters are wrong is
      // neither a permission question nor something a hook should see. The
      // failure is returned as an ordinary error result, so the model can read
      // the reason and retry (spec `core/tool-input-validation.md`).
      if (this.builtInTools.has(plugin)) {
        const invalid = validateToolInput(
          name,
          plugin.config?.function?.parameters,
          args,
        );
        if (invalid !== null) {
          logger?.debug(
            "Tool call rejected: arguments do not match the schema",
            {
              toolName: name,
            },
          );
          return { success: false, content: invalid, error: invalid };
        }
      }

      const hookManager = enhancedContext.hookManager;
      const blocked = await hookManager?.executePreToolUseHooks(
        name,
        args,
        enhancedContext,
      );
      if (blocked) {
        return { success: false, content: blocked, error: blocked };
      }

      let result: ToolResult;
      try {
        result = await plugin.execute(args, enhancedContext);
        recordLinesChangedFromResult(result, context, this.container);
        recordBashActivity(name, args, result, context, this.container);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        logger?.error("Tool execution failed", {
          toolName: name,
          error: message,
        });
        result = { success: false, content: "", error: message };
      }

      // PostToolUse hooks run for a failed call too — the tool was attempted,
      // and PostToolUse cannot block anything at this point.
      await hookManager?.executePostToolUseHooks(
        name,
        args,
        result,
        enhancedContext,
      );

      // A memory write that left the file over its cap is worth saying out loud
      // in the result: unlike the load-time warning, this reaches the model
      // while it still has the file in hand.
      await appendMemoryCapNotice(
        name,
        args,
        result,
        enhancedContext.workdir,
        enhancedContext.autoMemoryDir,
      );
      return result;
    }

    logger?.warn("Tool not found", { toolName: name });
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
   * Whether `Exec` exists for this session: registered and not denied by a
   * permission rule. Exactly when the sandbox channel does — an undeclared `Exec`
   * cannot be called, so declaring the deferred tools only inside it would hide
   * them for good.
   */
  private isExecDeclared(): boolean {
    return (
      this.toolsRegistry.has(EXEC_TOOL_NAME) &&
      !this.getPermissionManager()?.isToolDenied(EXEC_TOOL_NAME)
    );
  }

  /**
   * Every tool a deferral decision has to be made about — built-ins and MCP alike,
   * in declaration order.
   *
   * Permission filtering happens here rather than inside `buildExecPool`, because
   * "which tools may this session call" is a manager question, and the pool's hard
   * constraint is that it never exceeds that set: a tool reachable from the sandbox
   * but hidden from the agent would make `Exec` a permission-escalation channel.
   *
   * `Exec` is a candidate like any other. The structural non-deferrable list keeps
   * it out of the pool by name, so there is no special case here — and a tool that
   * is in the pool is never declared flat (see `getToolsConfig`), so the two places
   * agree by construction rather than by parallel bookkeeping.
   */
  private deferralCandidates(): ExecPoolCandidate[] {
    const permissionManager = this.getPermissionManager();
    const candidates: ExecPoolCandidate[] = [];

    for (const tool of this.toolsRegistry.values()) {
      if (permissionManager?.isToolDenied(tool.name)) continue;
      candidates.push({
        name: tool.name,
        description: tool.config.function.description,
        searchHint: tool.searchHint,
        defer: tool.defer,
        alwaysLoad: tool.alwaysLoad,
        inputSchema: tool.config.function.parameters as
          | Record<string, unknown>
          | undefined,
      });
    }

    const outputSchemas = this.mcpManager.getMcpToolOutputSchemas();
    for (const tool of this.mcpManager.getMcpToolPlugins()) {
      if (permissionManager?.isToolDenied(tool.name)) continue;
      candidates.push({
        name: tool.name,
        description: tool.config.function.description,
        // MCP tools need not set `defer`: the judgment table defers them
        // unconditionally. `alwaysLoad` is the server's own opt-out from that.
        alwaysLoad: tool.alwaysLoad,
        isMcp: true,
        inputSchema: tool.config.function.parameters as
          | Record<string, unknown>
          | undefined,
        outputSchema: outputSchemas.get(tool.name),
      });
    }

    return candidates;
  }

  /**
   * The tools the sandbox may reach: the deferred subset of `deferralCandidates`,
   * minus the names the non-deferrable list exempts.
   *
   * Computed per call, never cached. The pool is a function of the registry, the MCP
   * connections and the settings, all of which move at runtime, and a cached copy
   * would be a second source of truth for what the sandbox can reach.
   */
  public getExecPool(): ExecPoolEntry[] {
    return buildExecPool(
      this.deferralCandidates(),
      getNonDeferrableBuiltins(this.container.get<string>("Workdir")),
    );
  }

  /**
   * The deferred tool names, or `undefined` when the channel is closed — the input
   * the announcement is diffed against the conversation history. Names only, because
   * names are all the announcement carries; see `exec/catalogAnnouncement.ts`.
   */
  public getOnDemandToolNames(): string[] | undefined {
    if (!this.isExecDeclared()) return undefined;
    return this.getExecPool().map((entry) => entry.name);
  }

  getToolsConfig(options?: {
    availableSubagents?: SubagentConfiguration[];
    availableSkills?: SkillMetadata[];
    workdir?: string;
    isSubagent?: boolean;
  }): ChatCompletionFunctionTool[] {
    const permissionManager = this.getPermissionManager();
    const leanPromptEnabled = isLeanPromptEnabled(options?.workdir);

    // A tool in the pool is declared only inside the sandbox, never flat as well:
    // the two must not coexist, or the model would see the same tool twice while
    // the announcement claimed to be the only way in. Both halves are derived from
    // this one pool, and the pool is exactly what the agent could already call
    // directly, so deferring it cannot widen access.
    //
    // The pool is non-empty whenever `Exec` exists (the deferred built-ins are
    // always there), so `Exec` is declared for as long as the feature is on. That
    // is the point: `tools[]` no longer moves when an MCP server comes or goes,
    // which is what keeps the cached prefix stable.
    const pool = this.isExecDeclared() ? this.getExecPool() : [];
    const pooled = new Set(pool.map((entry) => entry.name));
    const execDeclared = pool.length > 0;

    const builtInToolsConfig = Array.from(this.toolsRegistry.values())
      .filter((tool) => {
        if (tool.name === EXEC_TOOL_NAME) return execDeclared;
        if (pooled.has(tool.name)) return false;
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
        // Lean mode sends the tool's condensed variant when it declares one; a
        // tool without one keeps its full description, so lean never yields an
        // empty description. Only text changes — schemas, the tool set and
        // permission decisions are untouched.
        const lean = leanPromptEnabled ? tool.leanPrompt : undefined;
        if (lean !== undefined) {
          config.function.description =
            typeof lean === "function" ? lean({ ...options }) : lean;
        } else if (tool.prompt) {
          config.function.description = tool.prompt({ ...options });
        }
        return config;
      });
    // Every MCP tool is deferred, so this is empty while `Exec` exists; it is the
    // only path that declares an MCP tool at all when `Exec` is off or denied.
    const mcpToolsConfig = this.mcpManager
      .getMcpToolsConfig()
      .filter((tool) => {
        if (pooled.has(tool.function.name)) return false;
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
