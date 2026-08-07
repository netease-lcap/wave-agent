import { type CallAgentOptions } from "../services/aiService.js";
import * as aiService from "../services/aiService.js";
import { convertMessagesForAPI } from "../utils/convertMessagesForAPI.js";
import { supportsVision } from "../utils/modelCapabilities.js";
import { parseTaskNotificationXml } from "../utils/notificationXml.js";
import { calculateComprehensiveTotalTokens } from "../utils/tokenCalculation.js";
import { estimateTokens } from "../utils/tokenEstimate.js";
import {
  getTaskReminderTurnCounts,
  maybeInjectTaskReminder,
  TASK_REMINDER_CONFIG,
} from "../utils/taskReminder.js";
import { existsSync } from "node:fs";
import type {
  GatewayConfig,
  ModelConfig,
  Usage,
  PermissionMode,
  Message,
} from "../types/index.js";
import type { ToolManager } from "./toolManager.js";
import type { ToolContext, ToolResult } from "../tools/types.js";
import type { MessageManager } from "./messageManager.js";
import type { BackgroundTaskManager } from "./backgroundTaskManager.js";
import {
  ChatCompletionMessageFunctionToolCall,
  type ChatCompletionMessageParam,
} from "openai/resources.js";

import type { HookManager } from "./hookManager.js";
import type { ExtendedHookExecutionContext } from "../types/hooks.js";
import type { BackgroundTaskInfo, SessionCronInfo } from "../types/hooks.js";
import type { PermissionManager } from "./permissionManager.js";
import type { SubagentManager } from "./subagentManager.js";
import type { CronManager } from "./cronManager.js";
import type { SkillManager } from "./skillManager.js";
import {
  buildSystemPrompt,
  formatCompactSummary,
  getCompactPrompt,
} from "../prompts/index.js";
import {
  buildPlanModeReminder,
  buildPlanModeReEntryReminder,
  buildExitedPlanModeReminder,
  wrapInSystemReminder,
} from "../prompts/planModeReminders.js";
import { Container } from "../utils/container.js";
import type { WorktreeSession } from "../utils/worktreeSession.js";
import { recoverTruncatedJson } from "../utils/stringUtils.js";
import { ConfigurationService } from "../services/configurationService.js";
import type { MessageQueue } from "./messageQueue.js";

import { logger } from "../utils/globalLogger.js";
import {
  startInteractionSpan,
  endInteractionSpan,
  startLLMRequestSpan,
  endLLMRequestSpan,
  resetTracingState,
} from "../telemetry/sessionTracing.js";
import { logOTelEvent } from "../telemetry/events.js";
import type { BackgroundTask } from "../types/processes.js";

/** Result of a fork-path agent loop (compaction or auto-memory extraction). */
interface ForkLoopResult {
  content?: string;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

/** Max turns for the compaction fork: the model should summarize, not act. */
const MAX_FORK_TURNS = 3;

/** Max turns for the auto-memory extraction fork. */
const MAX_AUTO_MEMORY_FORK_TURNS = 5;

// Truncate text to `max` chars and append a "… [+N chars]" marker when exceeded.
// Used for background_tasks description/command fields (≤1000 chars per spec FR-063).
function truncateWithMarker(text: string, max: number): string {
  if (text.length <= max) return text;
  return text.slice(0, max) + `… [+${text.length - max} chars]`;
}

// Map a BackgroundTask (from BackgroundTaskManager) to the Stop hook's
// background_tasks array element shape (aligned with Claude Code v2.1.145+).
// Conditional fields are populated based on task type:
//   - shell:    `command`
//   - subagent: `agent_type` (looked up via SubagentManager by subagentId)
//   - workflow: `name` (extracted from "Workflow: <name>" description)
function mapBackgroundTask(
  task: BackgroundTask,
  subagentManager: SubagentManager | undefined,
): BackgroundTaskInfo {
  const base: BackgroundTaskInfo = {
    id: task.id,
    type: task.type,
    status: task.status,
    description: truncateWithMarker(task.description ?? "", 1000),
  };
  if (task.type === "shell") {
    return { ...base, command: truncateWithMarker(task.command ?? "", 1000) };
  }
  if (task.type === "subagent") {
    const instance = subagentManager
      ?.getActiveInstances()
      .find((i) => i.subagentId === task.subagentId);
    return { ...base, agent_type: instance?.subagentType ?? "" };
  }
  // workflow
  const prefix = "Workflow: ";
  const name = task.description?.startsWith(prefix)
    ? task.description.slice(prefix.length)
    : (task.description ?? "");
  return { ...base, name };
}

export interface AIManagerCallbacks {
  onCompactionStateChange?: (isCompacting: boolean) => void;
  onUsageAdded?: (usage: Usage) => void;
  onCwdChange?: (newCwd: string) => void;
}

export interface AIManagerOptions {
  callbacks?: AIManagerCallbacks;
  workdir: string;
  systemPrompt?: string;
  subagentType?: string; // Optional subagent type for hook context
  /**Whether to use streaming mode for AI responses - defaults to true */
  stream?: boolean;
  /**Optional model override (e.g. for subagents) */
  modelOverride?: string;
  /**Optional max turns limit to prevent runaway recursion (e.g. for auto-memory extraction) */
  maxTurns?: number;
}

export class AIManager {
  public isLoading: boolean = false;
  private turnGeneration = 0; // Guards against concurrent sendAIMessage turns
  private abortController: AbortController | null = null;
  onLoadingChange?: (loading: boolean) => void;
  private toolAbortController: AbortController | null = null;
  private systemPrompt?: string;
  private subagentType?: string; // Store subagent type for hook context
  private stream: boolean; // Streaming mode flag
  private modelOverride?: string;
  private _onCwdChange?: (newCwd: string) => void; // Store callback for CWD changes
  private originalWorkdir: string;
  private consecutiveCompactionFailures: number = 0;
  private readonly maxTurns?: number;
  /** Tracks file mtime/hash at read time for staleness detection on Edit/Write */
  private readFileState = new Map<
    string,
    { mtime: number; hash: string; offset?: number; limit?: number }
  >();
  /** Override tool_choice for this AI manager (e.g. for structured output) */
  public toolChoiceOverride?:
    | "auto"
    | "none"
    | "required"
    | { type: "function"; function: { name: string } };

  // Service overrides
  constructor(
    private container: Container,
    options: AIManagerOptions,
  ) {
    this.systemPrompt = options.systemPrompt;
    this.subagentType = options.subagentType; // Store subagent type
    this.stream = options.stream ?? true; // Default to true if not specified
    this.callbacks = options.callbacks ?? {};
    this.modelOverride = options.modelOverride;
    this._onCwdChange = options.callbacks?.onCwdChange; // Initialize onCwdChange
    this.originalWorkdir = options.workdir;
    this.maxTurns = options.maxTurns;
  }

  private get toolManager(): ToolManager {
    return this.container.get<ToolManager>("ToolManager")!;
  }

  private get messageManager(): MessageManager {
    return this.container.get<MessageManager>("MessageManager")!;
  }

  private get memoryService(): import("../services/memory.js").MemoryService {
    return this.container.get<import("../services/memory.js").MemoryService>(
      "MemoryService",
    )!;
  }

  private get taskManager(): import("../services/taskManager.js").TaskManager {
    return this.container.get<import("../services/taskManager.js").TaskManager>(
      "TaskManager",
    )!;
  }

  private get backgroundTaskManager(): BackgroundTaskManager | undefined {
    return this.container.get<BackgroundTaskManager>("BackgroundTaskManager");
  }

  private get hookManager(): HookManager | undefined {
    return this.container.get<HookManager>("HookManager");
  }

  private get reversionManager():
    | import("./reversionManager.js").ReversionManager
    | undefined {
    return this.container.get<import("./reversionManager.js").ReversionManager>(
      "ReversionManager",
    );
  }

  private get permissionManager(): PermissionManager | undefined {
    return this.container.get<PermissionManager>("PermissionManager");
  }

  private get planManager():
    | import("./planManager.js").PlanManager
    | undefined {
    return this.container.get<import("./planManager.js").PlanManager>(
      "PlanManager",
    );
  }

  private get configurationService(): ConfigurationService {
    return this.container.get<ConfigurationService>("ConfigurationService")!;
  }

  /**
   * OS env merged with the per-session env snapshot. Falls back to process.env
   * when ConfigurationService is absent or its getMergedEnv is missing (e.g. in
   * unit tests with partial mocks), so hook-context env construction never
   * throws. Use this (not the non-null `configurationService` getter) when
   * building hook context env.
   */
  private get mergedEnv(): Record<string, string> {
    return (
      this.container
        .get<ConfigurationService>("ConfigurationService")
        ?.getMergedEnv?.() ?? (process.env as Record<string, string>)
    );
  }

  // Getter methods for accessing dynamic configuration
  public getGatewayConfig(): GatewayConfig {
    return {
      ...this.configurationService.resolveGatewayConfig(),
      sessionId: this.messageManager.getSessionId(),
    };
  }

  public getModelConfig(): ModelConfig {
    const permissionMode = this.container.has("PermissionMode")
      ? this.container.get<PermissionMode>("PermissionMode")
      : undefined;

    const parentModelConfig = this.configurationService.resolveModelConfig(
      undefined,
      undefined,
      undefined,
      permissionMode,
    );
    let modelToUse: string | undefined;

    if (this.modelOverride) {
      if (this.modelOverride === "fastModel") {
        modelToUse = parentModelConfig.fastModel;
      } else if (this.modelOverride !== "inherit") {
        modelToUse = this.modelOverride;
      }
    }

    return this.configurationService.resolveModelConfig(
      modelToUse,
      undefined,
      undefined,
      permissionMode,
    );
  }

  public getMaxInputTokens(): number {
    return this.configurationService.resolveMaxInputTokens();
  }

  public getLanguage(): string | undefined {
    return this.configurationService.resolveLanguage();
  }

  public getAutoMemoryEnabled(): boolean {
    return this.configurationService.resolveAutoMemoryEnabled();
  }

  public getWorktreeBaseRef(): "fresh" | "head" {
    return this.configurationService.resolveWorktreeBaseRef();
  }

  public getWorkdir(): string {
    return this.container.get<string>("Workdir") ?? process.cwd();
  }

  public getOriginalWorkdir(): string {
    return this.originalWorkdir;
  }

  /**
   * Update the working directory mid-session (e.g., when entering/exiting a worktree).
   * Only updates this session's DI container; it does NOT change the process-level
   * process.cwd(), so concurrent sessions in the same stdio process are unaffected.
   * Triggers `_onCwdChange` (wired by Agent to `onWorkdirChange`) so the host is
   * notified of worktree switches. Unlike bash `cd`, this does NOT run CwdChanged
   * hooks (worktree has its own WorktreeCreate/WorktreeRemove hooks).
   */
  public setWorkdir(newWorkdir: string): void {
    this.container.register("Workdir", newWorkdir);
    this._onCwdChange?.(newWorkdir);
  }

  /**
   * Get this session's worktree session state (null if not in a worktree).
   */
  public getWorktreeSession(): WorktreeSession | null {
    return (
      this.container.get<WorktreeSession | null>("WorktreeSession") ?? null
    );
  }

  /**
   * Set this session's worktree session state.
   */
  public setWorktreeSession(session: WorktreeSession | null): void {
    this.container.register("WorktreeSession", session);
  }

  public setOnCwdChange(callback: (newCwd: string) => void): void {
    this._onCwdChange = callback;
  }

  private isCompacting: boolean = false;
  private callbacks: AIManagerCallbacks;

  /**
   * Get filtered tool configuration based on tools list
   */
  private getFilteredToolsConfig() {
    // Get available subagents and skills for dynamic prompts
    const availableSubagents = this.subagentManager?.getConfigurations();
    const availableSkills = this.skillManager
      ?.getAvailableSkills()
      .filter((skill) => !skill.disableModelInvocation);

    return this.toolManager.getToolsConfig({
      availableSubagents,
      availableSkills,
      workdir: this.getWorkdir(),
      isSubagent: !!this.subagentType,
    });
  }

  /**
   * Add plan mode reminder as a persistent meta message to the message manager.
   * Called before getMessages() so the stored message is included in the API call.
   */
  private maybeAddPlanModeMessage(
    currentMode: PermissionMode | undefined,
  ): void {
    if (!this.permissionManager) return;

    // Handle exit notification (one-time after leaving plan mode)
    if (this.permissionManager.getNeedsPlanModeExitAttachment()) {
      const planFilePath = this.permissionManager.getPlanFilePath();
      const planExists = planFilePath ? existsSync(planFilePath) : false;
      this.messageManager.addUserMessage({
        content: buildExitedPlanModeReminder(planFilePath, planExists),
        isMeta: true,
      });
      this.permissionManager.setNeedsPlanModeExitAttachment(false);
    }

    if (currentMode !== "plan") return;

    const planFilePath = this.permissionManager.getPlanFilePath();
    if (!planFilePath) return;

    const planExists = existsSync(planFilePath);

    // One-time plan entry reminder
    const planMgr = this.planManager;
    if (planMgr?.isPlanEntryReminderPending()) {
      if (this.permissionManager.hasExitedPlanModeInSession() && planExists) {
        // Re-entry: use small reminder
        this.messageManager.addUserMessage({
          content: buildPlanModeReEntryReminder(planFilePath),
          isMeta: true,
        });
      } else {
        // First entry: use full reminder
        this.messageManager.addUserMessage({
          content: buildPlanModeReminder(
            planFilePath,
            planExists,
            !!this.subagentType,
          ),
          isMeta: true,
        });
      }
      planMgr.consumePlanEntryReminder();
    }
  }

  private async maybeGetTaskReminderText(
    toolNames: Set<string>,
  ): Promise<string | null> {
    // Guard: no task tools available
    if (!toolNames.has("TaskUpdate")) return null;

    const internalMessages = this.messageManager.getMessages();
    const turnCounts = getTaskReminderTurnCounts(internalMessages);

    if (
      turnCounts.turnsSinceLastTaskManagement <
        TASK_REMINDER_CONFIG.TURNS_SINCE_WRITE ||
      turnCounts.turnsSinceLastReminder <
        TASK_REMINDER_CONFIG.TURNS_BETWEEN_REMINDERS
    ) {
      return null;
    }

    const tasks = await this.taskManager.listTasks();
    return maybeInjectTaskReminder(turnCounts, tasks);
  }

  public setIsLoading(isLoading: boolean): void {
    this.isLoading = isLoading;
    this.onLoadingChange?.(isLoading);
    const options =
      this.container.get<import("../types/agent.js").AgentOptions>(
        "AgentOptions",
      );
    options?.callbacks?.onLoadingChange?.(isLoading);
  }

  public abortAIMessage(): void {
    // Bump generation so the in-flight turn's end-of-turn setIsLoading(false)
    // is skipped (generation mismatch), preventing it from racing with this abort.
    this.turnGeneration++;

    // Interrupt AI service
    if (this.abortController) {
      try {
        this.abortController.abort();
      } catch (error) {
        logger?.error("Failed to abort AI service:", error);
      }
    }

    // Interrupt tool execution
    if (this.toolAbortController) {
      try {
        this.toolAbortController.abort();
      } catch (error) {
        logger?.error("Failed to abort tool execution:", error);
      }
    }

    this.setIsLoading(false);
  }

  // Helper method to generate compactParams
  private generateCompactParams(
    toolName: string,
    toolArgs: Record<string, unknown>,
  ): string {
    try {
      const toolPlugin = this.toolManager
        .list()
        .find((plugin) => plugin.name === toolName);
      if (toolPlugin?.formatCompactParams) {
        const context: ToolContext = {
          workdir: this.getWorkdir(),
          originalWorkdir: this.originalWorkdir,
          taskManager: this.taskManager,
        };
        return toolPlugin.formatCompactParams(toolArgs, context);
      }
    } catch (error) {
      logger?.warn("Failed to generate compactParams", error);
    }
    return "";
  }

  // Private method to handle token statistics and message compaction
  private async handleTokenUsageAndCompaction(
    usage: Usage | undefined,
    abortController: AbortController,
  ): Promise<void> {
    if (!usage) return;

    // Update token statistics - display comprehensive token usage including cache tokens
    const comprehensiveTotalTokens = calculateComprehensiveTotalTokens(usage);
    this.messageManager.setlatestTotalTokens(comprehensiveTotalTokens);

    // Check if token limit exceeded - use injected configuration
    if (
      usage.total_tokens +
        (usage.cache_read_input_tokens || 0) +
        (usage.cache_creation_input_tokens || 0) >
      this.getMaxInputTokens()
    ) {
      logger?.debug(
        `Token usage exceeded ${this.getMaxInputTokens()}, compacting messages...`,
      );

      const messagesToCompact = this.messageManager.getMessages();
      if (messagesToCompact.length === 0) return;

      // Circuit breaker: skip compaction after 3 consecutive failures
      if (this.consecutiveCompactionFailures >= 3) {
        logger?.warn(
          `Skipping compaction: ${this.consecutiveCompactionFailures} consecutive failures`,
        );
        return;
      }

      await this.compactConversation({
        abortSignal: abortController.signal,
      });
    }
  }

  /**
   * Manually compact the conversation history.
   * Called by /compact slash command or auto-compaction trigger.
   */
  public async compactConversation(
    options: {
      customInstructions?: string;
      abortSignal?: AbortSignal;
    } = {},
  ): Promise<void> {
    const messagesToCompact = this.messageManager.getMessages();
    if (messagesToCompact.length === 0) {
      logger?.debug("No messages to compact");
      return;
    }

    // Circuit breaker: skip if already compacting
    if (this.isCompacting) {
      logger?.warn("Compaction already in progress");
      return;
    }

    // 1. Run PreCompact hooks
    let hookInstructions: string | undefined;
    if (this.hookManager) {
      try {
        const preResult = await this.hookManager.executePreCompactHooks(
          this.messageManager.getSessionId(),
          this.messageManager.getTranscriptPath(),
          options.customInstructions,
        );
        hookInstructions = preResult.additionalInstructions;
      } catch (error) {
        logger?.warn(`PreCompact hooks failed: ${(error as Error).message}`);
      }
    }

    // 2. Merge custom instructions
    const mergedInstructions =
      [options.customInstructions, hookInstructions]
        .filter(Boolean)
        .join("\n") || undefined;

    // 3. Save session before compaction
    await this.messageManager.saveSession();

    this.setIsCompacting(true);
    try {
      const modelConfig = this.getModelConfig();
      const recentChatMessages = convertMessagesForAPI(messagesToCompact, {
        supportsVision: supportsVision(modelConfig.capabilities),
      });
      const compactPrompt = getCompactPrompt(mergedInstructions);

      // 4. Fork path: fork the conversation with the same system prompt,
      // tools, model, and generation params as the main loop so the forked
      // request prefix matches exactly and the prompt cache is reused.
      const forkResult = await this.runCompactFork(
        recentChatMessages,
        compactPrompt,
        options.abortSignal,
      );
      const summaryContent = forkResult.content;
      const compactTokens = forkResult.usage;
      if (!summaryContent) {
        throw new Error(
          "Compaction failed: the model produced no summary output",
        );
      }
      const compactModel = modelConfig.model;

      // 5. Handle usage tracking
      let compactUsage: Usage | undefined;
      if (compactTokens) {
        compactUsage = {
          ...compactTokens,
          model: compactModel,
          operation_type: "compact",
        };
      }

      // 6. Strip the <analysis> scratchpad and extract the <summary> body
      const formattedSummary = formatCompactSummary(summaryContent);

      // 7. Build post-compact context restoration
      const enhancedSummary =
        await this.buildPostCompactContext(formattedSummary);

      // 8. Execute message reconstruction
      await this.messageManager.compactMessagesAndUpdateSession(
        enhancedSummary,
        compactUsage,
      );

      // Re-add plan mode reminder as persistent meta message after compaction
      const postCompactMode = this.permissionManager?.getCurrentEffectiveMode(
        this.getModelConfig().permissionMode,
      );
      if (postCompactMode === "plan") {
        const planFilePath = this.permissionManager?.getPlanFilePath();
        if (planFilePath) {
          const planExists = existsSync(planFilePath);
          this.messageManager.addUserMessage({
            content: buildPlanModeReminder(
              planFilePath,
              planExists,
              !!this.subagentType,
            ),
            isMeta: true,
          });
        }
      }

      // 9. Track usage
      if (compactUsage && this.callbacks?.onUsageAdded) {
        this.callbacks.onUsageAdded(compactUsage);
      }

      this.consecutiveCompactionFailures = 0;

      // Reset incremental tracing state after compaction
      resetTracingState();

      // 10. Log OTEL event
      logOTelEvent("compaction", {
        beforeTokens: String(messagesToCompact.length),
        afterTokens: "1",
        model: compactModel,
      }).catch(() => {});

      // 11. Run SessionStart hooks (existing behavior)
      if (this.hookManager) {
        try {
          const newSessionId = this.messageManager.getSessionId();
          const sessionStartResult =
            await this.hookManager.executeSessionStartHooks(
              "compact",
              newSessionId,
              this.messageManager.getTranscriptPath(),
              this.subagentType,
            );
          if (sessionStartResult.additionalContext) {
            this.messageManager.addUserMessage({
              content: `<system-reminder>\nSessionStart hook additional context: ${sessionStartResult.additionalContext}\n</system-reminder>`,
              isMeta: true,
            });
          }
          if (sessionStartResult.initialUserMessage) {
            this.messageManager.addUserMessage({
              content: sessionStartResult.initialUserMessage,
              isMeta: true,
            });
          }
        } catch (error) {
          logger?.warn(
            `SessionStart hooks on compact failed: ${(error as Error).message}`,
          );
        }
      }

      // 12. Run PostCompact hooks
      if (this.hookManager) {
        try {
          await this.hookManager.executePostCompactHooks(
            this.messageManager.getSessionId(),
            this.messageManager.getTranscriptPath(),
            formattedSummary,
          );
        } catch (error) {
          logger?.warn(`PostCompact hooks failed: ${(error as Error).message}`);
        }
      }

      logger?.debug(
        `Successfully compacted ${messagesToCompact.length} messages`,
      );
    } catch (compactError) {
      this.consecutiveCompactionFailures++;
      logger?.error(
        `Failed to compact messages (${this.consecutiveCompactionFailures} consecutive): ${compactError instanceof Error ? compactError.message : String(compactError)}`,
      );
      this.messageManager.addErrorBlock(
        `Failed to compact conversation history: ${compactError instanceof Error ? compactError.message : String(compactError)}. You may encounter context limit issues.`,
      );
    } finally {
      this.setIsCompacting(false);
    }
  }

  /**
   * Build the system prompt used by the main agent loop. Extracted so the
   * compaction fork can mirror it exactly — the forked request prefix must
   * match the main conversation's for the prompt cache to be reused.
   */
  private async buildMainSystemPrompt(
    filteredToolPlugins: ReturnType<ToolManager["getTools"]>,
  ) {
    let autoMemoryOptions: { directory: string; content: string } | undefined;

    if (this.getAutoMemoryEnabled()) {
      const directory = this.memoryService.getAutoMemoryDirectory(
        this.getWorkdir(),
      );
      const content = await this.memoryService.getAutoMemoryContent(
        this.getWorkdir(),
      );
      autoMemoryOptions = { directory, content };
    }

    return buildSystemPrompt(this.systemPrompt, filteredToolPlugins, {
      workdir: this.getWorkdir(),
      originalWorkdir: this.getOriginalWorkdir(),
      language: this.getLanguage(),
      isSubagent: !!this.subagentType,
      worktreeSession: this.getWorktreeSession(),
      additionalWorkingDirectories:
        this.permissionManager?.getEffectiveAdditionalDirectories?.() ?? [],
      autoMemory: autoMemoryOptions,
    });
  }

  private resolveFilteredTools() {
    const toolsConfig = this.getFilteredToolsConfig();
    const toolNames = new Set(toolsConfig.map((t) => t.function.name));
    const filteredToolPlugins = this.toolManager
      .getTools()
      .filter((t) => toolNames.has(t.name));
    return { toolsConfig, toolNames, filteredToolPlugins };
  }

  /**
   * Fork-path loop: run a bounded agent loop over a copy of the conversation
   * using the same system prompt, tools, model, and generation params as the
   * main loop, so the forked request prefix matches exactly and the prompt
   * cache is reused. A `canUseTool` gate decides whether each tool call
   * executes locally (with a stripped context) or is denied and fed back to
   * the model for another turn. Returns undefined content when the model never
   * produces text; the caller treats that as a failure.
   */
  private async runForkLoop(
    historyMessages: ChatCompletionMessageParam[],
    prompt: string,
    options: {
      maxTurns: number;
      /** Gate deciding which tool calls execute locally. When undefined, every tool call is denied. */
      canUseTool?: (name: string, args: Record<string, unknown>) => boolean;
      /** Message fed back to the model when a tool call is denied. */
      deniedToolMessage?: string;
    },
    abortSignal?: AbortSignal,
  ): Promise<ForkLoopResult> {
    const modelConfig = this.getModelConfig();
    const gatewayConfig = this.getGatewayConfig();
    const sessionId = this.messageManager.getSessionId();
    const workdir = this.getWorkdir();

    const forkMessages: ChatCompletionMessageParam[] = [...historyMessages];

    // Mirror the main loop's memory injection so the request prefix matches.
    const { prependContent } =
      await this.messageManager.getMemoryForInjection();
    if (prependContent.trim()) {
      forkMessages.unshift({
        role: "user",
        content: wrapInSystemReminder(prependContent),
      });
    }

    forkMessages.push({ role: "user", content: prompt });

    const { toolsConfig, filteredToolPlugins } = this.resolveFilteredTools();
    const systemPrompt = await this.buildMainSystemPrompt(filteredToolPlugins);

    // Fresh read-state map so Read/Edit state built up inside the fork never
    // leaks into the main session's dedup and staleness tracking.
    const forkReadFileState = new Map<
      string,
      { mtime: number; hash: string; offset?: number; limit?: number }
    >();

    let totalUsage: ForkLoopResult["usage"];
    let content: string | undefined;

    for (let turn = 0; turn < options.maxTurns; turn++) {
      const result = await aiService.callAgent({
        gatewayConfig,
        modelConfig,
        messages: forkMessages,
        sessionId,
        abortSignal,
        workdir,
        tools: toolsConfig,
        systemPrompt,
        toolChoice: this.toolChoiceOverride,
        // Stream so a slow reasoning model emits first bytes before the
        // gateway's idle timeout fires (non-streaming waits for the full
        // response, which exceeds the timeout on large contexts).
        stream: true,
      });

      if (result.usage) {
        totalUsage = {
          prompt_tokens:
            (totalUsage?.prompt_tokens ?? 0) + result.usage.prompt_tokens,
          completion_tokens:
            (totalUsage?.completion_tokens ?? 0) +
            result.usage.completion_tokens,
          total_tokens:
            (totalUsage?.total_tokens ?? 0) + result.usage.total_tokens,
        };
      }

      if (result.content?.trim()) {
        content = result.content;
        break;
      }

      if (result.tool_calls && result.tool_calls.length > 0) {
        const functionCalls = result.tool_calls.filter(
          (tc) => tc.type === "function",
        );
        if (functionCalls.length === 0) break;

        forkMessages.push({
          role: "assistant",
          content: result.content ?? null,
          tool_calls: functionCalls,
        });

        for (const toolCall of functionCalls) {
          const name = toolCall.function?.name || "";
          const args = this.parseForkToolArgs(toolCall.function?.arguments);
          let toolContent: string;
          if (options.canUseTool && options.canUseTool(name, args)) {
            toolContent = await this.executeForkTool(
              name,
              args,
              workdir,
              sessionId,
              abortSignal,
              forkReadFileState,
            );
          } else {
            toolContent =
              options.deniedToolMessage ??
              "Tool use is not allowed in this context";
          }
          forkMessages.push({
            role: "tool",
            tool_call_id: toolCall.id,
            content: toolContent,
          });
        }
        continue;
      }

      // Neither text nor tool calls: retrying the identical request is
      // pointless, bail out and let the caller fail.
      break;
    }

    return { content, usage: totalUsage };
  }

  /**
   * Fork-path compaction: deny all tool calls locally (the model is told to
   * summarize, not act) and feed the rejections back for another turn.
   */
  private async runCompactFork(
    historyMessages: ChatCompletionMessageParam[],
    compactPrompt: string,
    abortSignal?: AbortSignal,
  ): Promise<ForkLoopResult> {
    return this.runForkLoop(
      historyMessages,
      compactPrompt,
      {
        maxTurns: MAX_FORK_TURNS,
        deniedToolMessage: "Tool use is not allowed during compaction",
      },
      abortSignal,
    );
  }

  /**
   * Auto-memory extraction via the perfect fork: the extraction prompt is run
   * against the same request prefix as the main conversation (same system
   * prompt, tools, model, and message history) so the prompt cache is reused.
   * Gate-approved tools execute locally in a stripped context; everything else
   * is denied. Usage is reported with operation_type "agent" so extraction
   * token costs stay visible in session accounting.
   */
  public async runAutoMemoryFork(
    messages: Message[],
    prompt: string,
    options: {
      canUseTool: (name: string, args: Record<string, unknown>) => boolean;
      deniedToolMessage?: string;
      maxTurns?: number;
    },
    abortSignal?: AbortSignal,
  ): Promise<ForkLoopResult> {
    const modelConfig = this.getModelConfig();
    const historyMessages = convertMessagesForAPI(messages, {
      supportsVision: supportsVision(modelConfig.capabilities),
    });
    // Give the fork a real signal even when the caller has none, so tools
    // (e.g. Bash's foreground path) always receive a well-formed context.
    const signal = abortSignal ?? new AbortController().signal;
    const result = await this.runForkLoop(
      historyMessages,
      prompt,
      {
        maxTurns: options.maxTurns ?? MAX_AUTO_MEMORY_FORK_TURNS,
        canUseTool: options.canUseTool,
        deniedToolMessage: options.deniedToolMessage,
      },
      signal,
    );

    if (result.usage && this.callbacks?.onUsageAdded) {
      this.callbacks.onUsageAdded({
        ...result.usage,
        model: modelConfig.model,
        operation_type: "agent",
      });
    }
    return result;
  }

  /**
   * Parse a fork tool call's JSON arguments, recovering truncated JSON the
   * same way the main loop does. Unparseable arguments fall back to `{}` and
   * are rejected by the gate or the tool's own parameter validation.
   */
  private parseForkToolArgs(
    argsString: string | undefined,
  ): Record<string, unknown> {
    if (!argsString?.trim()) return {};
    try {
      return JSON.parse(argsString) as Record<string, unknown>;
    } catch {
      try {
        return JSON.parse(recoverTruncatedJson(argsString)) as Record<
          string,
          unknown
        >;
      } catch {
        return {};
      }
    }
  }

  /**
   * Execute a single tool call inside a fork with a stripped context: no
   * permission manager (never prompts the user), no message manager (no
   * conditional-rule triggering), no messageId (no file-history snapshots),
   * and no background task manager (commands run in the foreground). Only
   * gate-approved tool names reach this path.
   */
  private async executeForkTool(
    name: string,
    args: Record<string, unknown>,
    workdir: string,
    sessionId: string | undefined,
    abortSignal: AbortSignal | undefined,
    readFileState: ToolContext["readFileState"],
  ): Promise<string> {
    const plugin = this.toolManager.getTools().find((t) => t.name === name);
    if (!plugin) {
      return `Tool '${name}' not found`;
    }
    const context: ToolContext = {
      abortSignal,
      workdir,
      originalWorkdir: this.originalWorkdir,
      sessionId,
      taskManager: this.taskManager,
      readFileState,
      onShortResultUpdate: () => {},
      onResultUpdate: () => {},
      onCwdChange: () => {},
    };
    try {
      const result = await plugin.execute(args, context);
      if (result.content) return result.content;
      if (result.error) return `Error: ${result.error}`;
      return "";
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger?.error(`Fork tool execution failed for ${name}:`, error);
      return `Tool execution failed: ${message}`;
    }
  }

  /**
   * Fork-path side question ("/btw"): run a single-turn fork of the
   * conversation using the same system prompt, tools, model, and generation
   * params as the main loop, so the forked request prefix matches exactly and
   * the prompt cache is reused. The in-progress assistant message (if any) is
   * stripped so the fork starts from the last completed request prefix. Tools
   * are never executed — the wrapped question instructs the model to answer
   * directly; an attempted tool call is surfaced as an error string.
   */
  async runBtwFork(
    question: string,
    abortSignal?: AbortSignal,
    onContent?: (content: string) => void,
    onReasoning?: (content: string) => void,
  ): Promise<{ content?: string; error?: string }> {
    const modelConfig = this.getModelConfig();
    const gatewayConfig = this.getGatewayConfig();
    const sessionId = this.messageManager.getSessionId();
    const workdir = this.getWorkdir();

    const rawMessages = this.messageManager.getMessages();

    // Strip the in-progress assistant message (a block still in "streaming"
    // stage) so the fork's request prefix matches the last completed
    // main-loop request and the prompt cache is reused.
    const lastMessage = rawMessages[rawMessages.length - 1];
    const hasInProgressMessage =
      lastMessage?.role === "assistant" &&
      lastMessage.blocks.some(
        (b) => "stage" in b && (b as { stage?: string }).stage === "streaming",
      );

    const forkMessages: ChatCompletionMessageParam[] = convertMessagesForAPI(
      hasInProgressMessage ? rawMessages.slice(0, -1) : rawMessages,
      { supportsVision: supportsVision(modelConfig.capabilities) },
    );

    // Mirror the main loop's memory injection so the request prefix matches.
    const { prependContent } =
      await this.messageManager.getMemoryForInjection();
    if (prependContent.trim()) {
      forkMessages.unshift({
        role: "user",
        content: wrapInSystemReminder(prependContent),
      });
    }

    // Wrap the question with the side-question instructions (verbatim
    // Claude Code sideQuestion.ts) so the model answers directly.
    const wrappedQuestion = `<system-reminder>This is a side question from the user. You must answer this question directly in a single response.

IMPORTANT CONTEXT:
- You are a separate, lightweight agent spawned to answer this one question
- The main agent is NOT interrupted - it continues working independently in the background
- You share the conversation context but are a completely separate instance
- Do NOT reference being interrupted or what you were "previously doing" - that framing is incorrect

CRITICAL CONSTRAINTS:
- You have NO tools available - you cannot read files, run commands, search, or take any actions
- This is a one-off response - there will be no follow-up turns
- You can ONLY provide information based on what you already know from the conversation context
- NEVER say things like "Let me try...", "I'll now...", "Let me check...", or promise to take any action
- If you don't know the answer, say so - do not offer to look it up or investigate

Simply answer the question with the information you have.</system-reminder>

${question}`;
    forkMessages.push({ role: "user", content: wrappedQuestion });

    const { toolsConfig, filteredToolPlugins } = this.resolveFilteredTools();
    const systemPrompt = await this.buildMainSystemPrompt(filteredToolPlugins);

    try {
      // Surface partial output to the caller (e.g. the /btw overlay's
      // streaming display) as it arrives. Reasoning chunks from thinking
      // models stream through a separate channel when the caller supplies
      // one (webview hosts distinguish thinking from content so the panel
      // can drop thinking text once content starts); otherwise they fall
      // back to the content channel (CLI overlay mixes both).
      const streamToOverlay = (text: string) => {
        if (text.trim()) {
          onContent?.(text);
        }
      };
      const streamReasoning = (text: string) => {
        if (text.trim()) {
          if (onReasoning) {
            onReasoning(text);
          } else {
            onContent?.(text);
          }
        }
      };
      const result = await aiService.callAgent({
        gatewayConfig,
        modelConfig,
        messages: forkMessages,
        sessionId,
        abortSignal,
        workdir,
        tools: toolsConfig,
        systemPrompt,
        toolChoice: this.toolChoiceOverride,
        // Stream so a slow reasoning model emits first bytes before the
        // gateway's idle timeout fires (same rationale as runCompactFork).
        stream: true,
        onContentUpdate: streamToOverlay,
        onReasoningUpdate: streamReasoning,
      });

      if (result.content?.trim()) {
        return { content: result.content };
      }

      // A thinking model may emit only reasoning content (e.g. the stream
      // is truncated before the final answer); surface that instead of
      // falling through to "No response received".
      if (result.reasoning_content?.trim()) {
        return { content: result.reasoning_content };
      }

      if (result.tool_calls && result.tool_calls.length > 0) {
        const firstFunctionCall = result.tool_calls.find(
          (call) => call.type === "function",
        );
        const toolName = firstFunctionCall?.function?.name ?? "a tool";
        return {
          error: `(The model tried to call ${toolName} instead of answering directly. Try rephrasing or ask in the main conversation.)`,
        };
      }

      // Neither text nor tool calls.
      return { error: "No response received" };
    } catch (error) {
      // aiService.callAgent converts AbortError into a plain Error, so the
      // abort is detected via the signal itself; rethrow so the UI can
      // silently dismiss instead of showing an error.
      if (abortSignal?.aborted) {
        throw error;
      }
      return {
        error: `(API error: ${error instanceof Error ? error.message : String(error)})`,
      };
    }
  }

  /**
   * Build post-compact context restoration content.
   * Restores file reads, working directory, plan mode, skills, and background tasks.
   */
  private async buildPostCompactContext(summary: string): Promise<string> {
    const POST_COMPACT_TOKEN_BUDGET = 50_000;
    const POST_COMPACT_MAX_TOKENS_PER_FILE = 5_000;
    const POST_COMPACT_MAX_FILES_TO_RESTORE = 5;
    const contextParts: string[] = [];

    // 1. File context restoration
    const recentFiles = this.messageManager.getRecentFileReads(
      POST_COMPACT_MAX_FILES_TO_RESTORE,
      POST_COMPACT_MAX_TOKENS_PER_FILE,
    );
    let usedTokens = 0;
    for (const file of recentFiles) {
      const fileTokens = estimateTokens(file.content);
      if (usedTokens + fileTokens > POST_COMPACT_MAX_TOKENS_PER_FILE) continue;
      if (fileTokens > 0) usedTokens += fileTokens;
      contextParts.push(`\n\n## ${file.path}\n\`\`\`\n${file.content}\n\`\`\``);
      if (contextParts.length >= POST_COMPACT_MAX_FILES_TO_RESTORE) break;
      if (usedTokens >= POST_COMPACT_TOKEN_BUDGET) break;
    }

    // 4. Invoked skills context (with token budget, matching Claude Code)
    const POST_COMPACT_SKILLS_TOKEN_BUDGET = 25_000;
    const POST_COMPACT_MAX_TOKENS_PER_SKILL = 5_000;
    const invokedSkillNames = this.messageManager.getInvokedSkillNames(10);
    if (invokedSkillNames.length > 0 && this.skillManager) {
      const invokedSkillParts: string[] = [];
      let skillsUsedTokens = 0;
      for (const skillName of invokedSkillNames) {
        try {
          const skill = await this.skillManager.loadSkill(skillName);
          if (!skill) continue;

          const contentMatch = skill.content.match(
            /^---\n[\s\S]*?\n---\n([\s\S]*)$/,
          );
          let skillContent = contentMatch
            ? contentMatch[1].trim()
            : skill.content;

          const maxSkillChars = POST_COMPACT_MAX_TOKENS_PER_SKILL * 4;
          if (skillContent.length > maxSkillChars) {
            skillContent =
              skillContent.slice(0, maxSkillChars) + "\n\n...[truncated]...";
          }

          const skillTokens = estimateTokens(skillContent);
          if (skillsUsedTokens + skillTokens > POST_COMPACT_SKILLS_TOKEN_BUDGET)
            break;
          skillsUsedTokens += skillTokens;

          invokedSkillParts.push(
            `\n\n## ${skill.name}\n${skill.description ? `*${skill.description}*\n\n` : ""}\`\`\`\n${skillContent}\n\`\`\``,
          );
        } catch {
          // Skip skills that can't be loaded
        }
      }
      if (invokedSkillParts.length > 0) {
        contextParts.push(
          `\n\n[Invoked Skills]\n${invokedSkillParts.join("")}`,
        );
      }
    }

    // 5. Background subagent status (shell tasks excluded, matching Claude Code's createAsyncAgentAttachmentsIfNeeded)
    const agents =
      this.backgroundTaskManager
        ?.getAllTasks()
        .filter((a) => a.type === "subagent") || [];
    if (agents.length > 0) {
      const agentParts: string[] = [];
      for (const a of agents) {
        if (a.status === "killed") {
          agentParts.push(
            `Task "${a.description}" (${a.id}) was stopped by the user.`,
          );
        } else if (a.status === "running") {
          const parts = [
            `Background agent "${a.description}" (${a.id}) is still running.`,
            `Do NOT spawn a duplicate. You will be notified when it completes.`,
          ];
          if (a.outputPath) {
            parts.push(`You can read partial output at ${a.outputPath}.`);
          }
          agentParts.push(parts.join(" "));
        } else {
          // completed or failed
          const parts = [
            `Task ${a.id} (status: ${a.status}) (description: ${a.description}).`,
          ];
          const deltaText = a.status === "failed" ? a.stderr : a.stdout;
          if (deltaText && deltaText.length > 0) {
            const summary =
              deltaText.length > 500
                ? deltaText.slice(0, 500) + "..."
                : deltaText;
            parts.push(`Delta: ${summary}`);
          }
          if (a.outputPath) {
            parts.push(
              `Read the output file to retrieve the result: ${a.outputPath}.`,
            );
          }
          agentParts.push(parts.join(" "));
        }
      }
      if (agentParts.length > 0) {
        contextParts.push(`\n\n[Background Tasks]\n${agentParts.join("\n")}`);
      }
    }

    return (
      summary +
      (contextParts.length > 0
        ? `\n\n[Context Restoration]` + contextParts.join("")
        : "")
    );
  }

  public getIsCompacting(): boolean {
    return this.isCompacting;
  }

  public setIsCompacting(isCompacting: boolean): void {
    if (this.isCompacting !== isCompacting) {
      this.isCompacting = isCompacting;
      this.callbacks.onCompactionStateChange?.(isCompacting);
    }
  }

  private get subagentManager(): SubagentManager | undefined {
    return this.container.get<SubagentManager>("SubagentManager");
  }

  private get cronManager(): CronManager | undefined {
    return this.container.get<CronManager>("CronManager");
  }

  private get skillManager(): SkillManager | undefined {
    return this.container.get<SkillManager>("SkillManager");
  }

  public async sendAIMessage(
    options: {
      recursionDepth?: number;
      model?: string;
      /** Rules for automatic tool approval (e.g., "Bash(git status*)") */
      allowedRules?: string[];
      maxTokens?: number;
    } = {},
  ): Promise<void> {
    const { recursionDepth = 0, model, allowedRules, maxTokens } = options;
    let turnOffset = recursionDepth;

    // Reserve this turn synchronously before any async work. Bumping the
    // generation invalidates any in-flight turn's end-of-turn cleanup, and
    // recording myGeneration lets us skip cleanup if a newer turn (or abort)
    // has superseded us. setIsLoading(true) here also closes the "idle but
    // previous turn not finished" race window by marking us busy immediately.
    this.turnGeneration++;
    let myGeneration = this.turnGeneration;
    this.setIsLoading(true);

    outer: while (true) {
      let shouldRestart = false;

      // OpenTelemetry: start interaction span for this turn (initial call only)
      let turnSequence = 0;
      if (turnOffset === 0) {
        const messages = this.messageManager.getMessages();
        turnSequence = messages.filter((m) => m.role === "user").length;
        const lastUserMessage = [...messages]
          .reverse()
          .find((m) => m.role === "user");
        const userPromptText =
          lastUserMessage?.blocks.find((b) => b.type === "text")?.content || "";
        startInteractionSpan(userPromptText, turnSequence);

        // Log user_prompt event
        logOTelEvent("user_prompt", {
          prompt_length: String(userPromptText.length),
        }).catch(() => {}); // Non-blocking
      }

      // Apply allowed rules for the initial call
      if (turnOffset === 0) {
        if (allowedRules && allowedRules.length > 0) {
          this.permissionManager?.addTemporaryRules(allowedRules);
        }
      }

      // Scan for file mentions in the last user message to trigger conditional rules
      if (turnOffset === 0) {
        const messages = this.messageManager.getMessages();
        const lastMessage = messages[messages.length - 1];
        if (lastMessage && lastMessage.role === "user") {
          for (const block of lastMessage.blocks) {
            if (block.type === "text") {
              const content = block.content;
              const fileMentionRegex = /(?:^|\s)@([\w.\-/]+)/g;
              let match;
              while ((match = fileMentionRegex.exec(content)) !== null) {
                const filePath = match[1];
                this.messageManager.triggerFileRead(filePath);
              }
            }
          }
        }
      }

      // Only create new AbortControllers for the initial call (turnOffset === 0)
      // For restarts, reuse existing controllers to maintain abort signal
      let abortController: AbortController;
      let toolAbortController: AbortController;

      if (turnOffset === 0) {
        // Create new AbortControllers for initial call
        abortController = new AbortController();
        this.abortController = abortController;

        toolAbortController = new AbortController();
        this.toolAbortController = toolAbortController;
      } else {
        // Reuse existing controllers
        abortController = this.abortController!;
        toolAbortController = this.toolAbortController!;
      }

      let turnDepth = turnOffset;

      inner: while (true) {
        let llmSpan: import("@opentelemetry/api").Span | undefined;
        try {
          // Save session in each iteration to ensure message persistence
          await this.messageManager.saveSession();

          // Get current permission mode
          const currentMode = this.permissionManager?.getCurrentEffectiveMode(
            this.getModelConfig().permissionMode,
          );

          // Add plan mode reminder as persistent meta message before getting messages
          this.maybeAddPlanModeMessage(currentMode);

          // Process conditional rules triggered by file reads (persist as meta messages)
          const triggeredRules = this.messageManager.processTriggeredRules();
          for (const rule of triggeredRules) {
            this.messageManager.addUserMessage({
              content: `<!-- rule: ${rule.id} -->\n<system-reminder>\nThe following rules from .wave/rules apply to your work. Be sure to adhere to these instructions.\n\n${rule.content}\n</system-reminder>`,
              isMeta: true,
            });
          }

          // Get recent message history
          const rawMessages = this.messageManager.getMessages();
          const currentModelConfig = this.getModelConfig();
          const recentMessages = convertMessagesForAPI(rawMessages, {
            supportsVision: supportsVision(currentModelConfig.capabilities),
          });

          // Track if assistant message has been created
          let assistantMessageCreated = false;

          logger?.debug("modelConfig in sendAIMessage", this.getModelConfig());

          const { toolsConfig, toolNames, filteredToolPlugins } =
            this.resolveFilteredTools();

          // Get memory for message-array injection (not system prompt)
          const { prependContent } =
            await this.messageManager.getMemoryForInjection();

          const mainSystemPrompt =
            await this.buildMainSystemPrompt(filteredToolPlugins);

          // Call AI service with streaming callbacks if enabled
          const callAgentOptions: CallAgentOptions = {
            gatewayConfig: this.getGatewayConfig(),
            modelConfig: this.getModelConfig(),
            messages: recentMessages,
            sessionId: this.messageManager.getSessionId(),
            abortSignal: abortController.signal,
            workdir: this.getWorkdir(), // Pass working directory
            tools: toolsConfig, // Pass filtered tool configuration
            model: model, // Use passed model
            systemPrompt: mainSystemPrompt, // Pass custom system prompt
            maxTokens: maxTokens, // Pass max tokens override
            toolChoice: this.toolChoiceOverride, // Pass tool_choice override
            // Fast-model subagents send disable-thinking params only when
            // explicitly configured (never in the agent loop).
            disableThinkingOptions:
              this.modelOverride === "fastModel"
                ? this.getModelConfig().disableThinkingOptions
                : undefined,
          };

          // Prepend: AGENTS.md + user memory + unconditional rules as system-reminder
          if (prependContent.trim()) {
            callAgentOptions.messages.unshift({
              role: "user",
              content: wrapInSystemReminder(prependContent),
            });
          }

          // Task reminder: persist as meta message (conditional rules already persisted above)
          const taskReminderText =
            await this.maybeGetTaskReminderText(toolNames);
          if (taskReminderText) {
            this.messageManager.addUserMessage({
              content: taskReminderText,
              isMeta: true,
            });
          }

          // Add streaming callbacks only if streaming is enabled
          if (this.stream) {
            callAgentOptions.onContentUpdate = (content: string) => {
              // Create assistant message on first chunk if not already created
              if (!assistantMessageCreated) {
                this.messageManager.addAssistantMessage();
                assistantMessageCreated = true;
              }
              this.messageManager.updateCurrentMessageContent(content);
            };
            callAgentOptions.onToolUpdate = (toolCall) => {
              // Create assistant message on first tool update if not already created
              if (!assistantMessageCreated) {
                this.messageManager.addAssistantMessage();
                assistantMessageCreated = true;
              }

              // Use parametersChunk as compact param for better performance
              // No need to extract params or generate compact params during streaming

              // Update tool block with streaming parameters using parametersChunk as compact param
              this.messageManager.updateToolBlock({
                id: toolCall.id,
                name: toolCall.name,
                parameters: toolCall.parameters,
                parametersChunk: toolCall.parametersChunk,
                stage: toolCall.stage || "streaming", // Default to streaming if stage not provided
              });
            };
            callAgentOptions.onReasoningUpdate = (reasoning: string) => {
              // Create assistant message on first reasoning update if not already created
              if (!assistantMessageCreated) {
                this.messageManager.addAssistantMessage();
                assistantMessageCreated = true;
              }
              this.messageManager.updateCurrentMessageReasoning(reasoning);
            };
          }

          llmSpan = startLLMRequestSpan(
            model || this.getModelConfig().model || "",
            {
              context: "interaction",
              systemPrompt:
                typeof callAgentOptions.systemPrompt === "string"
                  ? callAgentOptions.systemPrompt
                  : undefined,
              inputMessages: callAgentOptions.messages,
              toolsSchema: callAgentOptions.tools
                ? JSON.stringify(callAgentOptions.tools)
                : undefined,
            },
          );

          const result = await aiService.callAgent(callAgentOptions);

          // End LLM span with usage data
          endLLMRequestSpan(llmSpan, {
            model: model || this.getModelConfig().model || "",
            success: true,
            hasToolCall: !!(result.tool_calls && result.tool_calls.length > 0),
            inputTokens: result.usage?.prompt_tokens,
            outputTokens: result.usage?.completion_tokens,
            cacheReadTokens: result.usage?.cache_read_input_tokens,
            cacheCreationTokens: result.usage?.cache_creation_input_tokens,
            modelOutput: result.content,
          });

          const createdByStreaming = assistantMessageCreated;

          // For non-streaming mode, create assistant message after callAgent returns
          // Also create if streaming mode but no streaming callbacks were called (e.g., when content comes directly in result)
          if (
            !this.stream ||
            (!assistantMessageCreated &&
              (result.content || result.tool_calls || result.reasoning_content))
          ) {
            this.messageManager.addAssistantMessage();
            assistantMessageCreated = true;
          }

          // Log finish reason and response headers if available
          if (result.finish_reason) {
            // Log warning headers when finish reason is length
            if (result.finish_reason === "length") {
              logger?.warn(
                "AI response truncated due to length limit. Response headers:",
                result.response_headers,
              );
            }
          }

          if (
            result.additionalFields &&
            Object.keys(result.additionalFields).length > 0
          ) {
            this.messageManager.mergeAssistantAdditionalFields(
              result.additionalFields,
            );
          }

          // Handle result reasoning content from non-streaming mode
          if (result.reasoning_content && !createdByStreaming) {
            this.messageManager.updateCurrentMessageReasoning(
              result.reasoning_content,
            );
          }

          // Handle result content from non-streaming mode
          if (result.content && !createdByStreaming) {
            this.messageManager.updateCurrentMessageContent(result.content);
          }

          // Handle usage tracking for agent operations
          let usage: Usage | undefined;
          if (result.usage) {
            usage = {
              prompt_tokens: result.usage.prompt_tokens,
              completion_tokens: result.usage.completion_tokens,
              total_tokens: result.usage.total_tokens,
              model: model || this.getModelConfig().model,
              operation_type: "agent",
              // Preserve cache fields if present
              ...(result.usage.cache_read_input_tokens !== undefined && {
                cache_read_input_tokens: result.usage.cache_read_input_tokens,
              }),
              ...(result.usage.cache_creation_input_tokens !== undefined && {
                cache_creation_input_tokens:
                  result.usage.cache_creation_input_tokens,
              }),
              ...(result.usage.cache_creation && {
                cache_creation: result.usage.cache_creation,
              }),
            };
          }

          // Set usage on the assistant message if available
          if (usage) {
            const messages = this.messageManager.getMessages();
            const lastMessage = messages[messages.length - 1];
            if (lastMessage && lastMessage.role === "assistant") {
              lastMessage.usage = usage;
              this.messageManager.setMessages(messages);
            }

            // Notify Agent to add to usage tracking
            if (this.callbacks?.onUsageAdded) {
              this.callbacks.onUsageAdded(usage);
            }
          }

          // Collect tool calls for processing
          const toolCalls: ChatCompletionMessageFunctionToolCall[] = [];
          if (result.tool_calls) {
            for (const toolCall of result.tool_calls) {
              if (toolCall.type === "function") {
                toolCalls.push(toolCall);
              }
            }
          }

          if (toolCalls.length > 0) {
            // Partition tool calls into batches: consecutive concurrency-safe
            // tools run in parallel, non-safe tools (Edit, Write, MCP) run one
            // at a time to prevent read-modify-write races on the same file.
            const batches: {
              calls: ChatCompletionMessageFunctionToolCall[];
              safe: boolean;
            }[] = [];
            for (const call of toolCalls) {
              const toolName = call.function?.name || "";
              const safe = this.toolManager.isConcurrencySafe(toolName);
              const lastBatch = batches[batches.length - 1];
              if (lastBatch && lastBatch.safe && safe) {
                lastBatch.calls.push(call);
              } else {
                batches.push({ calls: [call], safe });
              }
            }

            // Execute batches sequentially; within a safe batch, tools run in parallel
            for (const batch of batches) {
              if (
                abortController.signal.aborted ||
                toolAbortController.signal.aborted
              ) {
                break;
              }
              if (batch.calls.length === 1) {
                await this.executeToolCall(
                  batch.calls[0],
                  abortController,
                  toolAbortController,
                  result.finish_reason,
                );
              } else {
                await Promise.all(
                  batch.calls.map((call) =>
                    this.executeToolCall(
                      call,
                      abortController,
                      toolAbortController,
                      result.finish_reason,
                    ),
                  ),
                );
              }
            }
          }

          // Handle token statistics and message compaction
          await this.handleTokenUsageAndCompaction(
            result.usage,
            abortController,
          );

          // Finalize text/reasoning blocks for the final response (no tools)
          this.messageManager.finalizeStreamingBlocks();

          // Check if there are tool operations or response was truncated, if so automatically initiate next AI service call
          if (toolCalls.length > 0 || result.finish_reason === "length") {
            // Check maxTurns limit before continuing
            if (this.maxTurns && turnDepth + 1 >= this.maxTurns) {
              logger?.debug(`Max turns (${this.maxTurns}) reached, stopping.`);
            } else {
              // Record committed snapshots to message history
              if (this.reversionManager) {
                const snapshots =
                  this.reversionManager.getAndClearCommittedSnapshots();
                if (snapshots.length > 0) {
                  this.messageManager.addFileHistoryBlock(snapshots);
                }
              }

              // Check interruption status
              const isCurrentlyAborted =
                abortController.signal.aborted ||
                toolAbortController.signal.aborted;

              // Check if all tools were manually backgrounded
              const lastMessage =
                this.messageManager.getMessages()[
                  this.messageManager.getMessages().length - 1
                ];
              const toolBlocks =
                lastMessage?.blocks.filter(
                  (block): block is import("../types/messaging.js").ToolBlock =>
                    block.type === "tool",
                ) || [];
              const hasBackgrounded =
                toolBlocks.length > 0 &&
                toolBlocks.some((block) => block.isManuallyBackgrounded);

              if (hasBackgrounded) {
                logger?.info(
                  "Some tools were manually backgrounded, stopping.",
                );
              } else if (!isCurrentlyAborted) {
                // If response was truncated, add a hidden continuation message
                if (result.finish_reason === "length") {
                  this.messageManager.addUserMessage({
                    content:
                      "Output token limit hit. Resume directly — no apology, no recap of what you were doing. Pick up mid-thought if that is where the cut happened. Break remaining work into smaller pieces.",
                    isMeta: true,
                  });
                }

                // Duplicate Tool Call Detection
                if (toolCalls.length > 0) {
                  const messages = this.messageManager.getMessages();
                  // Find the most recent assistant message BEFORE the current one that has tool blocks
                  // The current assistant message is messages[messages.length - 1]
                  let previousAssistantWithTools: Message | undefined;
                  for (let i = messages.length - 2; i >= 0; i--) {
                    const msg = messages[i];
                    if (
                      msg.role === "assistant" &&
                      msg.blocks.some((b) => b.type === "tool")
                    ) {
                      previousAssistantWithTools = msg;
                      break;
                    }
                  }

                  if (previousAssistantWithTools) {
                    const previousToolBlocks =
                      previousAssistantWithTools.blocks.filter(
                        (b): b is import("../types/messaging.js").ToolBlock =>
                          b.type === "tool",
                      );

                    for (const currentToolCall of toolCalls) {
                      const currentName = currentToolCall.function?.name;
                      const currentArgs = currentToolCall.function?.arguments;

                      const isDuplicate = previousToolBlocks.some(
                        (prevBlock) =>
                          prevBlock.name === currentName &&
                          prevBlock.parameters === currentArgs,
                      );

                      if (isDuplicate && currentName) {
                        const toolId = currentToolCall.id;
                        const lastMessage = messages[messages.length - 1];
                        const toolBlock = lastMessage.blocks.find(
                          (b): b is import("../types/messaging.js").ToolBlock =>
                            b.type === "tool" && b.id === toolId,
                        );
                        if (toolBlock) {
                          const warning = `\n\nNote: You just called this tool with the same arguments in the previous turn. Please ensure you are not in a loop and consider if you need to change your approach.`;
                          this.messageManager.updateToolBlock({
                            id: toolId,
                            result: (toolBlock.result || "") + warning,
                            stage: "end",
                          });
                        }
                      }
                    }
                  }
                }

                // Yield to the event loop so macrotasks (abort timers,
                // signals) can be processed between turns. Without this,
                // mocked async operations (microtasks) would starve the
                // event loop and abort timers would never fire.
                await new Promise((resolve) => setImmediate(resolve));

                // Re-check abort status after yielding — the signal may
                // have fired during the setImmediate gap.
                if (
                  abortController.signal.aborted ||
                  toolAbortController.signal.aborted
                ) {
                  break inner;
                }

                turnDepth++;
                continue inner;
              }
            }
          }

          // No tool calls (or stop conditions) → inner loop done
          break inner;
        } catch (error) {
          // End LLM span with error
          endLLMRequestSpan(llmSpan, {
            model: model || this.getModelConfig().model || "",
            success: false,
            error: error instanceof Error ? error.message : String(error),
          });

          // Log error event
          logOTelEvent("error", {
            error_type:
              error instanceof Error ? error.constructor.name : "Unknown",
            message: error instanceof Error ? error.message : String(error),
          }).catch(() => {}); // Non-blocking

          // Finalize any streaming text/reasoning blocks so the UI stops ticking
          // its in-progress timer (e.g. when the request is aborted mid-thought).
          this.messageManager.finalizeStreamingBlocks();

          // Finalize any tool blocks stuck in start/streaming/running so the UI
          // stops showing the yellow "running" spinner (e.g. abort mid-tool-stream).
          this.messageManager.finalizeAbortedToolBlocks(
            error instanceof Error ? error.message : undefined,
          );

          this.messageManager.addErrorBlock(
            error instanceof Error ? error.message : "Unknown error occurred",
          );

          // Exit inner loop on error
          break inner;
        }
      }

      // Finally-equivalent (runs once per outer iteration):
      // Only execute cleanup and hooks for the initial call
      if (turnOffset === 0) {
        // OpenTelemetry: end interaction span
        endInteractionSpan();

        // Save session in each iteration to ensure message persistence
        await this.messageManager.saveSession();

        // Clear temporary rules
        this.permissionManager?.clearTemporaryRules();

        // Clear abort controllers (only if we still own them — a concurrent
        // turn may have already registered its own controller, and clearing
        // it would orphan that turn and make it uninterruptible)
        if (this.abortController === abortController) {
          this.abortController = null;
        }
        if (this.toolAbortController === toolAbortController) {
          this.toolAbortController = null;
        }

        // Execute Stop/SubagentStop hooks only if the operation was not aborted
        const isCurrentlyAborted =
          abortController.signal.aborted || toolAbortController.signal.aborted;

        if (!isCurrentlyAborted) {
          // Record committed snapshots to message history for the final turn
          if (this.reversionManager) {
            const snapshots =
              this.reversionManager.getAndClearCommittedSnapshots();
            if (snapshots.length > 0) {
              this.messageManager.addFileHistoryBlock(snapshots);
            }
          }

          // Execute Stop hooks
          const shouldContinue = await this.executeStopHooks();

          // If Stop/SubagentStop hooks indicate we should continue (due to blocking errors),
          // restart the AI conversation cycle
          if (shouldContinue) {
            logger?.info(
              `${this.subagentType ? "SubagentStop" : "Stop"} hooks indicate issues need fixing, continuing conversation...`,
            );

            // Restart the conversation to let AI fix the issues
            shouldRestart = true;
            turnOffset = 0;
          }
        }

        // Inject pending notifications from background tasks (after Stop hooks,
        // aligned with Claude Code which fires Stop hooks unconditionally).
        // Skip injection when this turn was aborted: folding a pending
        // notification in would restart the loop and resurrect the aborted
        // turn — if a concurrent sendMessage is already running (e.g. the
        // queue's "send now" button), it would spawn a second, orphaned,
        // uninterruptible agent loop. The notification stays queued for the
        // next turn.
        const messageQueue = this.container.has("MessageQueue")
          ? this.container.get<MessageQueue>("MessageQueue")
          : undefined;
        if (
          messageQueue &&
          messageQueue.hasNotifications() &&
          !isCurrentlyAborted
        ) {
          const notifications = messageQueue.drainNotifications();
          for (const notification of notifications) {
            const block = parseTaskNotificationXml(notification);
            if (block) {
              this.messageManager.addNotificationMessage({
                taskId: block.taskId,
                taskType: block.taskType,
                status: block.status,
                summary: block.summary,
                outputFile: block.outputFile,
              });
            }
          }
          // Re-assert loading state before restarting: if this turn was
          // aborted, abortAIMessage already reset loading to false, and the
          // restart below continues the conversation — the UI must show
          // streaming again (cursor, stop button, ESC handling).
          this.setIsLoading(true);
          // Adopt the current (possibly abort-bumped) generation so this
          // continued turn's end-of-turn cleanup is not skipped as superseded.
          myGeneration = this.turnGeneration;
          // Restart outer loop to process the notifications
          shouldRestart = true;
          turnOffset = 0;
        }
      }

      if (!shouldRestart) {
        // Release loading state only after ALL cleanup is done (session save,
        // Stop hooks, notification injection). Generation check ensures a
        // superseded (aborted or newer) turn doesn't clobber the current
        // loading state.
        if (myGeneration === this.turnGeneration) {
          this.setIsLoading(false);
        }
        break outer;
      }
    }
  }

  /**
   * Execute Stop or SubagentStop hooks when AI response cycle completes
   * Uses "SubagentStop" hook name when triggered by a subagent, otherwise uses "Stop"
   * @returns Promise<boolean> - true if should continue conversation, false if should stop
   */
  private async executeStopHooks(): Promise<boolean> {
    if (!this.hookManager) return false;

    try {
      // Use "SubagentStop" hook name when triggered by a subagent, otherwise use "Stop"
      const hookName = this.subagentType ? "SubagentStop" : "Stop";

      // For main-agent Stop events, snapshot running background tasks and
      // session cron jobs so the hook can decide whether to block stopping.
      // SubagentStop does not include these fields (per spec FR-065).
      const backgroundTasks: BackgroundTaskInfo[] | undefined =
        hookName === "Stop"
          ? (this.backgroundTaskManager?.getAllTasks() ?? [])
              .filter((t) => t.status === "running")
              .map((t) => mapBackgroundTask(t, this.subagentManager))
          : undefined;

      const sessionCrons: SessionCronInfo[] | undefined =
        hookName === "Stop"
          ? (this.cronManager?.listJobs() ?? []).map((j) => ({
              id: j.id,
              schedule: j.cron,
              recurring: j.recurring,
              prompt: j.prompt,
            }))
          : undefined;

      // Extract text content from the last assistant message so hooks can
      // inspect the final response without reading the transcript file.
      const allMessages = this.messageManager.getMessages();
      const lastAssistant = [...allMessages]
        .reverse()
        .find((m) => m.role === "assistant");
      const lastAssistantText = lastAssistant
        ? lastAssistant.blocks
            .filter((b) => b.type === "text")
            .map((b) => b.content)
            .join("\n")
            .trim() || undefined
        : undefined;

      const context: ExtendedHookExecutionContext = {
        event: hookName,
        projectDir: this.getWorkdir(),
        timestamp: new Date(),
        sessionId: this.messageManager.getSessionId(),
        transcriptPath: this.messageManager.getTranscriptPath(),
        cwd: this.getWorkdir(),
        subagentType: this.subagentType, // Include subagent type in hook context
        backgroundTasks, // Stop-only: running background tasks snapshot
        sessionCrons, // Stop-only: session cron jobs snapshot
        lastAssistantMessage: lastAssistantText, // Stop/SubagentStop: last assistant message text
        // Stop hooks don't need toolName, toolInput, toolResponse, or userPrompt
        env: Object.fromEntries(
          Object.entries(this.mergedEnv).filter((e) => e[1] !== undefined),
        ) as Record<string, string>, // Include environment variables
      };

      const results = await this.hookManager.executeHooks(hookName, context);

      // Process hook results to handle exit codes and appropriate responses
      let shouldContinue = false;
      if (results.length > 0) {
        const processResult = this.hookManager.processHookResults(
          hookName,
          results,
          this.messageManager,
        );

        // If hook processing indicates we should block (exit code 2), continue conversation
        if (processResult.shouldBlock) {
          logger?.info(
            `${hookName} hook blocked stopping with error:`,
            processResult.errorMessage,
          );
          shouldContinue = true;
        }
      }

      // Log hook execution results for debugging
      if (results.length > 0) {
        logger?.debug(
          `Executed ${results.length} ${hookName} hook(s):`,
          results.map((r) => ({
            success: r.success,
            duration: r.duration,
            exitCode: r.exitCode,
            timedOut: r.timedOut,
            stderr: r.stderr,
          })),
        );
      }

      // Trigger auto-memory extraction if enabled and this is the main agent
      if (!this.subagentType) {
        const autoMemoryService =
          this.container.get<
            import("../services/autoMemoryService.js").AutoMemoryService
          >("AutoMemoryService");
        if (autoMemoryService) {
          // Trigger extraction, but don't block the return.
          // onTurnEnd itself returns quickly after forking.
          autoMemoryService.onTurnEnd(this.getWorkdir()).catch((err) => {
            logger?.error("Auto-memory extraction trigger failed:", err);
          });
        }
      }

      return shouldContinue;
    } catch (error) {
      // Hook execution errors should not interrupt the main workflow
      logger?.error(
        `${this.subagentType ? "SubagentStop" : "Stop"} hook execution failed:`,
        error,
      );
      return false;
    }
  }

  /**
   * Execute a single tool call: arg parsing, block emission, PreToolUse hooks,
   * tool execution, PostToolUse hooks, and error handling.
   */
  private async executeToolCall(
    functionToolCall: ChatCompletionMessageFunctionToolCall,
    abortController: AbortController,
    toolAbortController: AbortController,
    finishReason?: string | null,
  ): Promise<void> {
    const toolId = functionToolCall.id || "";

    // Check if already interrupted, skip tool execution if so
    if (abortController.signal.aborted || toolAbortController.signal.aborted) {
      return;
    }

    const toolName = functionToolCall.function?.name || "";
    // Safely parse tool parameters, handle tools without parameters
    let toolArgs: Record<string, unknown> = {};
    let jsonRecovered = false;
    const argsString = functionToolCall.function?.arguments?.trim();

    if (!argsString || argsString === "") {
      // Tool without parameters, use empty object
      toolArgs = {};
    } else {
      let recoveredArgs = argsString;
      try {
        toolArgs = JSON.parse(argsString);
      } catch {
        // Attempt to recover truncated JSON (e.g., missing closing braces)
        recoveredArgs = recoverTruncatedJson(argsString);
        try {
          toolArgs = JSON.parse(recoveredArgs);
          jsonRecovered = true;
          logger.warn(`Recovered truncated JSON for tool "${toolName}"`);
        } catch (parseError) {
          let errorMessage = `Failed to parse tool arguments`;
          if (finishReason === "length") {
            errorMessage += " (output truncated, please reduce your output)";
          }
          logger?.error(errorMessage, parseError);
          this.messageManager.updateToolBlock({
            id: toolId,
            parameters: argsString,
            result: errorMessage,
            success: false,
            error: errorMessage,
            stage: "end",
            name: toolName,
            compactParams: "",
            timestamp: Date.now(),
          });
          return;
        }
      }
    }

    const compactParams = this.generateCompactParams(toolName, toolArgs);

    // Emit start stage for non-streaming tool calls
    if (!this.stream) {
      this.messageManager.updateToolBlock({
        id: toolId,
        stage: "start",
        name: toolName,
        compactParams,
        parameters: argsString,
      });
    }

    // Emit running stage (tool execution about to start)
    this.messageManager.updateToolBlock({
      id: toolId,
      stage: "running",
      name: toolName,
      compactParams,
      parameters: argsString,
      parametersChunk: "",
    });

    try {
      // Execute PreToolUse hooks before tool execution
      const shouldExecuteTool = await this.executePreToolUseHooks(
        toolName,
        toolArgs,
        toolId,
      );

      // If PreToolUse hooks blocked execution, skip tool execution
      if (!shouldExecuteTool) {
        logger?.info(`Tool ${toolName} execution blocked by PreToolUse hooks`);
        return;
      }

      // Create tool execution context
      const context: ToolContext = {
        abortSignal: toolAbortController.signal,
        backgroundTaskManager: this.backgroundTaskManager,
        workdir: this.getWorkdir(),
        originalWorkdir: this.originalWorkdir,
        messageId: this.messageManager.getMessages().slice(-1)[0]?.id,
        sessionId: this.messageManager.getSessionId(),
        toolCallId: toolId,
        taskManager: this.taskManager,
        readFileState: this.readFileState,
        onShortResultUpdate: (shortResult: string) => {
          this.messageManager.updateToolBlock({
            id: toolId,
            shortResult,
            stage: "running",
            compactParams,
            name: toolName,
          });
        },
        onResultUpdate: (result: string) => {
          this.messageManager.updateToolBlock({
            id: toolId,
            result,
            stage: "running",
            compactParams,
            name: toolName,
          });
        },
        onCwdChange: async (newCwd: string) => {
          const oldCwd = this.getWorkdir();
          this.container.register("Workdir", newCwd);
          this._onCwdChange?.(newCwd);
          if (this.hookManager) {
            const sessionId = this.messageManager.getSessionId();
            const transcriptPath = this.messageManager.getTranscriptPath();
            const env = Object.fromEntries(
              Object.entries(this.mergedEnv).filter((e) => e[1] !== undefined),
            ) as Record<string, string>;
            await this.hookManager.executeCwdChangedHooks(
              oldCwd,
              newCwd,
              sessionId,
              transcriptPath,
              env,
            );
          }
        },
      };

      // Execute tool
      const toolResult = await this.toolManager.execute(
        functionToolCall.function?.name || "",
        toolArgs,
        context,
      );

      // Build result content, adding truncation warning if JSON was recovered
      let toolResultContent =
        toolResult.content ||
        (toolResult.error ? `Error: ${toolResult.error}` : "");
      if (jsonRecovered) {
        toolResultContent +=
          "\n\nTool arguments were truncated (likely exceeded max output tokens). Please reduce your output or split into multiple tool calls.";
      }

      // Update message state - tool execution completed
      this.messageManager.updateToolBlock({
        id: toolId,
        parameters: argsString,
        result: toolResultContent,
        success: toolResult.success,
        error: toolResult.error,
        stage: "end",
        name: toolName,
        compactParams,
        shortResult: toolResult.shortResult,
        isManuallyBackgrounded: toolResult.isManuallyBackgrounded,
        startLineNumber: toolResult.startLineNumber,
        images: toolResult.images,
        timestamp: Date.now(),
      });

      // Execute PostToolUse hooks after successful tool completion
      await this.executePostToolUseHooks(
        toolId,
        toolName,
        toolArgs,
        toolResult,
      );
    } catch (toolError) {
      const errorMessage =
        toolError instanceof Error ? toolError.message : String(toolError);

      this.messageManager.updateToolBlock({
        id: toolId,
        parameters: JSON.stringify(toolArgs, null, 2),
        result: `Tool execution failed: ${errorMessage}`,
        success: false,
        error: errorMessage,
        stage: "end",
        name: toolName,
        compactParams,
        isManuallyBackgrounded: false,
        timestamp: Date.now(),
      });
    }
  }

  /**
   * Execute PreToolUse hooks before tool execution
   * Returns true if hooks allow tool execution, false if blocked
   */
  private async executePreToolUseHooks(
    toolName: string,
    toolInput?: Record<string, unknown>,
    toolId?: string,
  ): Promise<boolean> {
    if (!this.hookManager) return true;

    try {
      const context: ExtendedHookExecutionContext = {
        event: "PreToolUse",
        projectDir: this.getWorkdir(),
        timestamp: new Date(),
        toolName,
        sessionId: this.messageManager.getSessionId(),
        transcriptPath: this.messageManager.getTranscriptPath(),
        cwd: this.getWorkdir(),
        toolInput,
        subagentType: this.subagentType, // Include subagent type in hook context
        env: Object.fromEntries(
          Object.entries(this.mergedEnv).filter((e) => e[1] !== undefined),
        ) as Record<string, string>, // Include environment variables
      };

      const results = await this.hookManager.executeHooks(
        "PreToolUse",
        context,
      );

      // Process hook results to handle exit codes and determine if tool should be blocked
      let shouldContinue = true;
      if (results.length > 0) {
        const processResult = this.hookManager.processHookResults(
          "PreToolUse",
          results,
          this.messageManager,
          toolId, // Pass toolId for proper PreToolUse blocking error handling
          JSON.stringify(toolInput || {}, null, 2), // Pass serialized tool parameters
        );
        shouldContinue = !processResult.shouldBlock;
      }

      // Log tool_decision event
      logOTelEvent("tool_decision", {
        tool_name: toolName,
        decision: shouldContinue ? "approved" : "blocked",
        source: "hook",
      }).catch(() => {}); // Non-blocking

      // Log hook execution results for debugging
      if (results.length > 0) {
        logger?.debug(
          `Executed ${results.length} PreToolUse hook(s) for ${toolName}:`,
          results.map((r) => ({
            success: r.success,
            duration: r.duration,
            exitCode: r.exitCode,
            timedOut: r.timedOut,
            stderr: r.stderr,
          })),
        );
      }

      return shouldContinue;
    } catch (error) {
      // Hook execution errors should not interrupt the main workflow
      logger?.error("PreToolUse hook execution failed:", error);
      return true; // Allow tool execution on hook errors
    }
  }

  /**
   * Execute PostToolUse hooks after tool completion
   */
  private async executePostToolUseHooks(
    toolId: string,
    toolName: string,
    toolInput?: Record<string, unknown>,
    toolResponse?: ToolResult,
  ): Promise<void> {
    if (!this.hookManager) return;

    try {
      const context: ExtendedHookExecutionContext = {
        event: "PostToolUse",
        projectDir: this.getWorkdir(),
        timestamp: new Date(),
        toolName,
        sessionId: this.messageManager.getSessionId(),
        transcriptPath: this.messageManager.getTranscriptPath(),
        cwd: this.getWorkdir(),
        toolInput,
        toolResponse,
        subagentType: this.subagentType, // Include subagent type in hook context
        planFilePath: this.permissionManager?.getPlanFilePath(),
        env: Object.fromEntries(
          Object.entries(this.mergedEnv).filter((e) => e[1] !== undefined),
        ) as Record<string, string>, // Include environment variables
      };

      const results = await this.hookManager.executeHooks(
        "PostToolUse",
        context,
      );

      // Process hook results to handle exit codes and update tool results
      if (results.length > 0) {
        this.hookManager.processHookResults(
          "PostToolUse",
          results,
          this.messageManager,
          toolId,
        );
      }

      // Log hook execution results for debugging
      if (results.length > 0) {
        logger?.debug(
          `Executed ${results.length} PostToolUse hook(s) for ${toolName}:`,
          results.map((r) => ({
            success: r.success,
            duration: r.duration,
            exitCode: r.exitCode,
            timedOut: r.timedOut,
            stderr: r.stderr,
          })),
        );
      }
    } catch (error) {
      // Hook execution errors should not interrupt the main workflow
      logger?.error("PostToolUse hook execution failed:", error);
    }
  }
}
