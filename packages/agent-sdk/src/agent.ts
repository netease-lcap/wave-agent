import { ForegroundTaskManager } from "./managers/foregroundTaskManager.js";
import { MessageManager } from "./managers/messageManager.js";
import { AIManager } from "./managers/aiManager.js";
import { ToolManager } from "./managers/toolManager.js";
import { SubagentManager } from "./managers/subagentManager.js";
import { McpManager } from "./managers/mcpManager.js";
import { LspManager } from "./managers/lspManager.js";
import { BangManager } from "./managers/bangManager.js";
import { CronManager } from "./managers/cronManager.js";
import { BackgroundTaskManager } from "./managers/backgroundTaskManager.js";
import { MessageQueue, type QueuedMessage } from "./managers/messageQueue.js";
import { SlashCommandManager } from "./managers/slashCommandManager.js";
import { PluginManager } from "./managers/pluginManager.js";
import { HookManager } from "./managers/hookManager.js";
import { ReversionManager } from "./managers/reversionManager.js";
import { PermissionManager } from "./managers/permissionManager.js";
import { PlanManager } from "./managers/planManager.js";
import {
  SlashCommand,
  CustomSlashCommand,
  ILspManager,
  AgentOptions,
} from "./types/index.js";
import type {
  Message,
  Logger,
  McpServerStatus,
  GatewayConfig,
  ModelConfig,
  Usage,
  PermissionMode,
  ForegroundTask,
  SkillMetadata,
} from "./types/index.js";
import { MemoryRuleManager } from "./managers/MemoryRuleManager.js";
import { LiveConfigManager } from "./managers/liveConfigManager.js";
import { configValidator } from "./utils/configValidator.js";
import { SkillManager } from "./managers/skillManager.js";
import { TaskManager } from "./services/taskManager.js";
import type { WorktreeSession } from "./utils/worktreeSession.js";
import path from "node:path";
import { parseTaskNotificationXml } from "./utils/notificationXml.js";
import { InitializationService } from "./services/initializationService.js";
import { InteractionService } from "./services/interactionService.js";
import { ConfigurationService } from "./services/configurationService.js";
import { Container } from "./utils/container.js";
import { setupAgentContainer } from "./utils/containerSetup.js";
import {
  initializeTelemetry,
  shutdownTelemetry,
} from "./telemetry/instrumentation.js";
import { logOTelEvent } from "./telemetry/events.js";
import { remoteSettingsService } from "./services/remoteSettingsService.js";

export class Agent {
  private messageManager: MessageManager;
  private aiManager: AIManager;

  private bangManager: BangManager | null = null;
  private backgroundTaskManager: BackgroundTaskManager;
  private logger?: Logger; // Add optional logger property
  private toolManager: ToolManager; // Add tool registry instance
  private mcpManager: McpManager; // Add MCP manager instance
  private lspManager: ILspManager; // Add LSP manager instance
  private permissionManager: PermissionManager; // Add permission manager instance
  private planManager: PlanManager; // Add plan manager instance
  private subagentManager: SubagentManager; // Add subagent manager instance
  private slashCommandManager: SlashCommandManager; // Add slash command manager instance
  private pluginManager: PluginManager; // Add plugin manager instance
  private skillManager: SkillManager; // Add skill manager instance
  private cronManager: CronManager; // Add cron manager instance
  private hookManager: HookManager; // Add hooks manager instance
  private reversionManager: ReversionManager;
  private messageQueue: MessageQueue; // Unified queue for messages, bang commands, and notifications
  private dispatchPromise: Promise<void> | null = null; // Track current dispatch for teardown
  private isAborting = false; // Transient guard: prevents tryDispatch from firing during abortMessage (reset when the abort completes)
  private isDestroyed = false; // Terminal guard: set in destroy(), never reset — no dispatch may ever start after destroy
  private dispatchAborted = false; // Set on abort while a dispatch is running: suppress the .finally re-check so preserved notifications don't get dispatched after abort
  private asyncWorkRegistry: import("./utils/asyncWorkRegistry.js").AsyncWorkRegistry; // Registry of live async work that destroy() drains before returning
  private memoryRuleManager: MemoryRuleManager; // Add memory rule manager instance
  private liveConfigManager: LiveConfigManager; // Add live configuration manager
  private taskManager: TaskManager;
  private foregroundTaskManager: ForegroundTaskManager;
  private container: Container;
  /** Unregister module-level listeners registered during container setup; invoked at the end of destroy(). */
  private teardown: () => void = () => {};
  private configurationService: ConfigurationService; // Add configuration service
  private workdir: string; // Working directory
  private systemPrompt?: string; // Custom system prompt
  private stream: boolean; // Streaming mode flag
  private sessionStartTime: number = Date.now();

  // Configuration options storage for dynamic resolution
  private options: AgentOptions;

  // Dynamic configuration getter methods
  public getGatewayConfig(): GatewayConfig {
    return {
      ...this.configurationService.resolveGatewayConfig(),
      sessionId: this.messageManager.getSessionId(),
    };
  }

  public getModelConfig(): ModelConfig {
    return this.configurationService.resolveModelConfig(
      undefined,
      undefined,
      this.getPermissionMode(),
    );
  }

  public getMaxInputTokens(): number {
    return this.configurationService.resolveMaxInputTokens();
  }

  public getLanguage(): string | undefined {
    return this.configurationService.resolveLanguage();
  }

  /**
   * Set the active model for the agent session
   * @param model - The ID of the model to use
   */
  public setModel(model: string): void {
    this.configurationService.setModel(model);
    this.options.callbacks?.onModelChange?.(model);
  }

  /**
   * Get all configured models from settings.json and defaults
   * @returns Array of model IDs
   */
  public getConfiguredModels(): string[] {
    return this.configurationService.getConfiguredModels();
  }

  /**
   * Agent constructor - handles configuration resolution and validation
   *
   * IMPORTANT: This constructor is private. Use Agent.create() instead for proper
   * async initialization. Keep this constructor's signature exactly the same as
   * Agent.create() to maintain API consistency.
   *
   * @param options - Configuration options for the Agent instance
   */
  private constructor(options: AgentOptions) {
    const { logger, workdir, systemPrompt, stream = true } = options;

    // Set working directory early as we need it for loading configuration
    this.workdir = workdir || process.cwd();

    // Initialize configuration service
    this.configurationService = new ConfigurationService();
    this.configurationService.setOptions(options);

    this.logger = logger; // Save the passed logger
    this.systemPrompt = systemPrompt; // Save custom system prompt
    this.stream = stream; // Save streaming mode flag

    // Store options for dynamic configuration resolution
    this.options = options;

    const { container, teardown } = setupAgentContainer({
      options,
      workdir: this.workdir,
      configurationService: this.configurationService,
      systemPrompt: this.systemPrompt,
      stream: this.stream,
      onTasksChange: (tasks) => {
        this.options.callbacks?.onTasksChange?.(tasks);
      },
      onBackgroundTasksChange: (tasks) => {
        this.options.callbacks?.onBackgroundTasksChange?.(tasks);
      },
      onPermissionModeChange: (mode) => {
        this.options.callbacks?.onPermissionModeChange?.(mode);
      },
      handlePlanModeTransition: (mode) => {
        this.planManager.handlePlanModeTransition(mode);
      },
      setPermissionMode: (mode) => {
        this.setPermissionMode(mode);
      },
      addPermissionRule: (rule) => this.addPermissionRule(rule),
      addUsage: (usage) => this.messageManager.addUsage(usage),
    });
    this.container = container;
    this.teardown = teardown;

    // Retrieve managers from container
    this.foregroundTaskManager = this.container.get("ForegroundTaskManager")!;
    this.memoryRuleManager = this.container.get("MemoryRuleManager")!;
    this.messageManager = this.container.get("MessageManager")!;
    this.taskManager = this.container.get("TaskManager")!;
    this.backgroundTaskManager = this.container.get("BackgroundTaskManager")!;
    this.mcpManager = this.container.get("McpManager")!;
    this.lspManager = this.container.get("LspManager")!;
    this.permissionManager = this.container.get("PermissionManager")!;
    this.planManager = this.container.get("PlanManager")!;
    this.hookManager = this.container.get("HookManager")!;
    this.skillManager = this.container.get("SkillManager")!;
    this.reversionManager = this.container.get("ReversionManager")!;
    this.toolManager = this.container.get("ToolManager")!;
    this.liveConfigManager = this.container.get("LiveConfigManager")!;
    this.subagentManager = this.container.get("SubagentManager")!;
    this.aiManager = this.container.get("AIManager")!;
    this.slashCommandManager = this.container.get("SlashCommandManager")!;
    this.pluginManager = this.container.get("PluginManager")!;
    this.bangManager = this.container.get("BangManager")!;
    this.cronManager = this.container.get("CronManager")!;
    this.messageQueue = this.container.get("MessageQueue")!;
    this.asyncWorkRegistry = this.container.get("AsyncWorkRegistry")!;

    // Wire up CWD change callback from AIManager to sync Agent's workdir
    this.aiManager.setOnCwdChange((newCwd) => {
      this.workdir = newCwd;
      this.container.register("Workdir", newCwd);
      this.options.callbacks?.onWorkdirChange?.(newCwd);
    });

    // Wire up message queue to process when agent becomes idle.
    // Both user messages and background task notifications enqueue here,
    // unified through a single dispatch path (tryDispatch).
    this.messageQueue.onMessageEnqueued = () => this.tryDispatch();

    // Wire up AI loading changes to process queue when AI becomes idle
    this.aiManager.onLoadingChange = (loading: boolean) => {
      if (!loading) this.tryDispatch();
    };

    // Wire up bang manager callback for command running changes
    this.bangManager.onCommandRunningChange = (running: boolean) => {
      this.options.callbacks?.onCommandRunningChange?.(running);
      if (!running) this.tryDispatch();
    };

    // Set initial permission mode if provided
    if (options.permissionMode) {
      this.setPermissionMode(options.permissionMode);
    }
  }

  // Public getter methods
  public get sessionId(): string {
    return this.messageManager.getSessionId();
  }

  public get messages(): Message[] {
    return this.messageManager.getMessages();
  }

  /** Full UI display message stream (includes pre-compaction history).
   * Consumed by hosts for the full-list message view (getMessages RPC,
   * CLI structural refresh); the API context stays on `messages`. */
  public get displayMessages(): Message[] {
    return this.messageManager.getDisplayMessages();
  }

  public get usages(): Usage[] {
    return this.messageManager.getUsages();
  }

  public get sessionFilePath(): string {
    return this.messageManager.getTranscriptPath();
  }

  public get latestTotalTokens(): number {
    return this.messageManager.getLatestTotalTokens();
  }

  /** Get working directory */
  public get workingDirectory(): string {
    return this.workdir;
  }

  /**
   * Set the working directory
   * @param newCwd - The new working directory
   */
  public setWorkdir(newCwd: string): void {
    this.workdir = newCwd;
    this.container.register("Workdir", newCwd);
    this.options.callbacks?.onWorkdirChange?.(newCwd);
  }

  /**
   * Set this session's worktree session state (used by CLI -w startup to inject the
   * session created before the agent existed). Delegates to AIManager so the state is
   * stored in this agent's own DI container.
   */
  public setWorktreeSession(session: WorktreeSession | null): void {
    this.aiManager.setWorktreeSession(session);
  }

  /** Get project memory content */
  public get projectMemory(): string {
    const memoryService =
      this.container.get<import("./services/memory.js").MemoryService>(
        "MemoryService",
      );
    return memoryService?.cachedProjectMemory ?? "";
  }

  /** Get user memory content */
  public get userMemory(): string {
    const memoryService =
      this.container.get<import("./services/memory.js").MemoryService>(
        "MemoryService",
      );
    return memoryService?.cachedUserMemory ?? "";
  }

  /** Get combined memory content (project + user + modular rules) */
  public async getCombinedMemory(): Promise<string> {
    return this.messageManager.getCombinedMemory();
  }

  /** Get AI loading status */
  public get isLoading(): boolean {
    return this.aiManager.isLoading;
  }

  /** Get message compaction status */
  public get isCompacting(): boolean {
    return this.aiManager.getIsCompacting();
  }

  /** Get bash command execution status */
  public get isCommandRunning(): boolean {
    return this.bangManager?.isCommandRunning ?? false;
  }

  /** Get queued user-facing messages (excludes background notifications) */
  public get queuedMessages(): QueuedMessage[] {
    return this.messageQueue
      .getQueue()
      .filter((m) => m.type !== "notification");
  }

  /**
   * Remove a queued message by index
   * @param index - The index of the message to remove
   * @returns true if the message was removed, false if the index was out of bounds
   */
  public removeQueuedMessage(index: number): boolean {
    const removed = this.messageQueue.removeAt(index);
    if (removed) {
      this.options.callbacks?.onQueuedMessagesChange?.(this.queuedMessages);
    }
    return removed;
  }

  /**
   * Recall the last editable queued message (for inline editing)
   * @returns The recalled message, or null if no editable message exists
   */
  public recallQueuedMessage(): QueuedMessage | null {
    const msg = this.messageQueue.popLastEditable();
    if (msg) {
      this.options.callbacks?.onQueuedMessagesChange?.(this.queuedMessages);
    }
    return msg;
  }

  /**
   * Remove a queued message by its ID
   * @param id - The ID of the message to remove
   * @returns true if the message was removed, false if not found
   */
  public removeQueuedMessageById(id: string): boolean {
    const removed = this.messageQueue.removeById(id);
    if (removed) {
      this.options.callbacks?.onQueuedMessagesChange?.(this.queuedMessages);
    }
    return removed;
  }

  /**
   * Update a queued message's content by its ID (does not change queue order)
   * @param id - The ID of the message to update
   * @param patch - The fields to update
   * @returns true if the message was updated, false if not found
   */
  public updateQueuedMessageById(
    id: string,
    patch: {
      content?: string;
      images?: Array<{ path: string; mimeType: string }>;
      type?: "message" | "bang";
    },
  ): boolean {
    const updated = this.messageQueue.updateById(id, patch);
    if (updated) {
      this.options.callbacks?.onQueuedMessagesChange?.(this.queuedMessages);
    }
    return updated;
  }

  /**
   * Terminal-lifecycle guard for public APIs. destroy() is terminal: after it
   * returns, no new work may start on this agent. Silent drops hid misuse until
   * a ghost async side effect surfaced later (issue #1808); throwing surfaces
   * the contract violation immediately at the call site.
   */
  private assertNotDestroyed(): void {
    if (this.isDestroyed) {
      throw new Error("Agent destroyed");
    }
  }

  /**
   * Unified dispatch trigger — checks state machine before processing.
   * Handles user messages, bang commands, and background task notifications
   * through a single serialized path. Called from onMessageEnqueued,
   * onLoadingChange(false), and onCommandRunningChange(false).
   */
  private tryDispatch(): void {
    if (this.isDestroyed) return; // Terminal: agent destroyed, never dispatch again
    if (this.isAborting) return; // Suppress dispatch during abort to prevent queued notifications from being dispatched as a side-effect
    if (this.dispatchAborted) return; // Aborted mid-dispatch: don't start a new dispatch (the user interrupted this turn)
    if (this.messageQueue.state !== "idle") return;
    if (!this.messageQueue.hasPending()) return;
    if (this.aiManager.isLoading || this.isCommandRunning) return;

    this.messageQueue.transitionTo("dispatching");
    this.dispatchPromise = this.asyncWorkRegistry.track(
      this.processQueuedMessage()
        .catch((error) => {
          this.logger?.error("Failed to process queued message:", error);
        })
        .finally(() => {
          this.messageQueue.transitionTo("idle");
          this.dispatchPromise = null;
          if (!this.dispatchAborted) {
            this.tryDispatch(); // Re-check after processing
          }
          this.dispatchAborted = false;
        }),
    );
  }

  /**
   * Process the next queued item when the agent becomes idle.
   * Handles three item types: user messages, bang commands, and notifications.
   */
  private async processQueuedMessage(): Promise<void> {
    const next = this.messageQueue.dequeue();
    if (!next) return;

    this.messageQueue.transitionTo("running");
    this.options.callbacks?.onQueuedMessagesChange?.(this.queuedMessages);

    if (next.type === "bang") {
      await this.bangManager?.executeCommand(next.content);
      await this.messageManager.saveSession();
    } else if (next.type === "notification") {
      // Drain all pending notifications and batch them into a single AI turn
      const allNotifications = [
        next.content,
        ...this.messageQueue.drainNotifications(),
      ];
      for (const xml of allNotifications) {
        const block = parseTaskNotificationXml(xml);
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
      await this.aiManager.sendAIMessage({ recursionDepth: 0 });
    } else {
      await this.sendMessage(next.content, next.images);
    }
  }

  /** Get background bash shell output */
  public getBackgroundShellOutput(
    id: string,
    filter?: string,
  ): {
    stdout: string;
    stderr: string;
    status: string;
    outputPath?: string;
    type: string;
    exitCode?: number;
  } | null {
    return this.backgroundTaskManager.getOutput(id, filter);
  }

  /** Kill background bash shell */
  public killBackgroundShell(id: string): boolean {
    return this.backgroundTaskManager.stopTask(id);
  }

  /** Get background task output */
  public getBackgroundTaskOutput(
    id: string,
    filter?: string,
  ): {
    stdout: string;
    stderr: string;
    status: string;
    outputPath?: string;
    type: string;
    exitCode?: number;
  } | null {
    return this.backgroundTaskManager.getOutput(id, filter);
  }

  /** Stop background task */
  public stopBackgroundTask(id: string): boolean {
    return this.backgroundTaskManager.stopTask(id);
  }

  /** Get all workflow runs */
  public async getWorkflowRuns(): Promise<
    import("./workflow/types.js").WorkflowRun[]
  > {
    if (!this.container.has("WorkflowManager")) return [];
    return this.container
      .get<
        import("./managers/workflowManager.js").WorkflowManager
      >("WorkflowManager")!
      .listRuns();
  }

  /** Get a specific workflow run by ID */
  public getWorkflowRun(
    runId: string,
  ): import("./workflow/types.js").WorkflowRun | undefined {
    if (!this.container.has("WorkflowManager")) return undefined;
    return this.container
      .get<
        import("./managers/workflowManager.js").WorkflowManager
      >("WorkflowManager")!
      .getRun(runId);
  }

  /** Stop a workflow run */
  public stopWorkflowRun(runId: string): void {
    if (!this.container.has("WorkflowManager")) return;
    this.container
      .get<
        import("./managers/workflowManager.js").WorkflowManager
      >("WorkflowManager")!
      .stopRun(runId);
  }

  /**
   * Static async factory method for creating Agent instances
   *
   * IMPORTANT: Keep this method's signature exactly the same as the constructor
   * to maintain consistency and avoid confusion for users of the API.
   *
   * @param options - Same AgentOptions interface used by constructor
   * @returns Promise<Agent> - Fully initialized Agent instance
   */
  /**
   * Create a new Agent instance with async initialization
   *
   * This is the recommended way to create Agent instances. The constructor is private
   * to ensure proper async initialization of all components.
   *
   * @param options - Configuration options for the Agent instance
   * @param options.apiKey - API key for the AI service (or set WAVE_API_KEY env var)
   * @param options.baseURL - Base URL for the AI service (or set WAVE_BASE_URL env var)
   * @param options.defaultHeaders - Optional HTTP headers to pass to the AI service
   * @param options.fetchOptions - Optional fetch options to pass to the AI service
   * @param options.fetch - Optional custom fetch implementation
   * @param options.callbacks - Optional callbacks for various Agent events
   * @param options.restoreSessionId - Optional session ID to restore from
   * @param options.continueLastSession - Whether to continue the last session automatically
   * @param options.logger - Optional custom logger implementation
   * @param options.messages - Optional initial messages for testing convenience
   * @param options.workdir - Working directory (defaults to process.cwd())
   * @param options.systemPrompt - Optional custom system prompt
   * @param options.mcpServers - Optional MCP server configs to connect at startup
   * @returns Promise that resolves to initialized Agent instance
   *
   * @example
   * ```typescript
   * // Basic usage
   * const agent = await Agent.create({
   *   apiKey: 'your-api-key',
   *   baseURL: 'https://api.example.com'
   * });
   * ```
   */
  static async create(options: AgentOptions): Promise<Agent> {
    // Create Agent instance
    const instance = new Agent(options);
    await instance.initialize({
      restoreSessionId: options.restoreSessionId,
      continueLastSession: options.continueLastSession,
      messages: options.messages,
    });
    return instance;
  }

  /**
   * Resolve and validate configuration from constructor args, environment variables,
   * and loaded settings.json.
   *
   * This is called during initialization after settings.json has been loaded.
   */
  private resolveAndValidateConfig(): void {
    // Resolve configuration from constructor args and environment variables (including settings.json)
    const gatewayConfig = this.getGatewayConfig();
    const maxInputTokens = this.getMaxInputTokens();

    // Validate resolved configuration
    configValidator.validateGatewayConfig(gatewayConfig);
    configValidator.validateMaxInputTokens(maxInputTokens);
  }

  /** Private initialization method, handles async initialization logic */
  private async initialize(options?: {
    restoreSessionId?: string;
    continueLastSession?: boolean;
    messages?: Message[];
  }): Promise<void> {
    await InitializationService.initialize(
      {
        skillManager: this.skillManager,
        subagentManager: this.subagentManager,
        container: this.container,
        toolManager: this.toolManager,
        pluginManager: this.pluginManager,
        options: this.options,
        slashCommandManager: this.slashCommandManager,
        logger: this.logger,
        mcpManager: this.mcpManager,
        workdir: this.workdir,
        lspManager: this.lspManager,
        configurationService: this.configurationService,
        hookManager: this.hookManager,
        messageManager: this.messageManager,
        memoryRuleManager: this.memoryRuleManager,
        liveConfigManager: this.liveConfigManager,
        taskManager: this.taskManager,
        resolveAndValidateConfig: () => this.resolveAndValidateConfig(),
      },
      options,
    );

    // Initialize OpenTelemetry (awaited to ensure ALS context is ready before
    // startInteractionSpan is called, preventing trace context fragmentation)
    const telemetryConfig = this.configurationService.resolveTelemetryConfig();
    try {
      await initializeTelemetry(telemetryConfig);
    } catch (error) {
      this.logger?.warn("Telemetry initialization failed:", error);
    }

    // Log session_start event
    try {
      const modelConfig = this.getModelConfig();
      if (modelConfig.model) {
        await logOTelEvent("session_start", {
          sessionId: this.messageManager.getSessionId(),
          model: modelConfig.model,
          workdir: this.workdir,
        }).catch(() => {}); // Non-blocking
      }
    } catch {
      // Model not configured yet - will be available after SSO login
    }
  }

  /**
   * Restore a session by ID, switching to the target session without destroying the Agent instance
   * @param sessionId - The ID of the session to restore
   */
  public async restoreSession(sessionId: string): Promise<void> {
    await InteractionService.restoreSession(
      {
        messageManager: this.messageManager,
        slashCommandManager: this.slashCommandManager,
        hookManager: this.hookManager,
        workdir: this.workdir,
        configurationService: this.configurationService,
        logger: this.logger,
        aiManager: this.aiManager,
        subagentManager: this.subagentManager,
        taskManager: this.taskManager,
        options: this.options,
        abortMessage: () => this.abortMessage(),
      },
      sessionId,
    );
  }

  public abortAIMessage(): void {
    this.aiManager.abortAIMessage();
  }

  /** Execute bash command (bang command) */
  public async bang(command: string): Promise<void> {
    this.assertNotDestroyed();

    // If the agent is busy, enqueue the bang command
    if (this.aiManager.isLoading || this.isCommandRunning) {
      this.messageQueue.enqueue({ type: "bang", content: command });
      this.options.callbacks?.onQueuedMessagesChange?.(this.queuedMessages);
      return;
    }

    await this.bangManager?.executeCommand(command);
    await this.messageManager.saveSession();
  }

  public async clearMessages(): Promise<void> {
    // Aligned with webview (ChatApp handleClearChat): /clear is ignored
    // while the agent is running, instead of aborting the AI mid-turn
    // (which used to inject a late "Request was aborted" error into the
    // newly cleared session).
    if (this.aiManager.isLoading) {
      return;
    }

    this.aiManager.abortAIMessage();

    // Capture old session info before clearing
    const oldSessionId = this.messageManager.getSessionId();
    const transcriptPath = this.messageManager.getTranscriptPath();

    // Run SessionEnd hooks (cleanup before clear)
    try {
      await this.hookManager.executeSessionEndHooks(
        "clear",
        oldSessionId,
        transcriptPath,
      );
    } catch (error) {
      this.logger?.warn(
        `SessionEnd hooks on clear failed: ${(error as Error).message}`,
      );
    }

    // Clear messages and generate new session
    this.messageManager.clearMessages();
    await this.taskManager.syncWithSession();

    // Run SessionStart hooks (restore context for new session)
    try {
      const newSessionId = this.messageManager.getSessionId();
      const sessionStartResult =
        await this.hookManager.executeSessionStartHooks(
          "clear",
          newSessionId,
          this.messageManager.getTranscriptPath(),
        );

      // Inject additionalContext as a meta user message
      if (sessionStartResult.additionalContext) {
        this.messageManager.addUserMessage({
          content: `<system-reminder>\nSessionStart hook additional context: ${sessionStartResult.additionalContext}\n</system-reminder>`,
          isMeta: true,
        });
      }

      // Inject initialUserMessage as a meta user message
      if (sessionStartResult.initialUserMessage) {
        this.messageManager.addUserMessage({
          content: sessionStartResult.initialUserMessage,
          isMeta: true,
        });
      }
    } catch (error) {
      this.logger?.warn(
        `SessionStart hooks on clear failed: ${(error as Error).message}`,
      );
    }

    await this.messageManager.saveSession();
  }

  /**
   * Compact conversation history to reduce context usage
   * @param customInstructions - Optional custom instructions for compaction
   */
  public async compact(customInstructions?: string): Promise<void> {
    // Aligned with webview: /compact is ignored while the agent is running,
    // instead of aborting the AI mid-turn before compacting.
    if (this.aiManager.isLoading) {
      return;
    }

    this.aiManager.abortAIMessage();

    await this.aiManager.compactConversation({
      customInstructions,
    });

    await this.messageManager.saveSession();
  }

  /** Unified interrupt method, interrupts both AI messages and command execution */
  public abortMessage(): void {
    // Guard: prevent tryDispatch (triggered by abortAIMessage → setIsLoading(false))
    // from dispatching preserved notifications as a new AI turn during the abort.
    this.isAborting = true;
    try {
      // If a queued dispatch is in flight (e.g. a notification turn was being
      // processed), remember the abort so the .finally re-check won't start a
      // new dispatch with the preserved notifications right after aborting.
      if (this.dispatchPromise) {
        this.dispatchAborted = true;
      }
      if (this.aiManager.isLoading || this.isCommandRunning) {
        // Clear user-facing queue items first to prevent processQueuedMessage
        // from dequeuing when abortAIMessage triggers onLoadingChange(false).
        // Notifications are preserved so background task results aren't lost.
        this.messageQueue.clear();
        this.options.callbacks?.onQueuedMessagesChange?.(this.queuedMessages);
      }
      this.messageQueue.transitionTo("idle"); // Reset state on abort
      this.abortAIMessage(); // This will abort tools including Agent tool (subagents)
      this.abortBashCommand();
      this.abortSlashCommand();
    } finally {
      this.isAborting = false;
    }
  }

  /** Interrupt bash command execution */
  public abortBashCommand(): void {
    this.bangManager?.abortCommand();
  }

  /** Interrupt slash command execution */
  public abortSlashCommand(): void {
    this.slashCommandManager.abortCurrentCommand();
  }

  /**
   * Register a foreground task that can be backgrounded
   */
  public registerForegroundTask(task: ForegroundTask): void {
    this.foregroundTaskManager.registerForegroundTask(task);
  }

  /**
   * Unregister a foreground task
   */
  public unregisterForegroundTask(id: string): void {
    this.foregroundTaskManager.unregisterForegroundTask(id);
  }

  /**
   * Background the current foreground task
   */
  public async backgroundCurrentTask(): Promise<void> {
    await this.foregroundTaskManager.backgroundCurrentTask();
    this.options.callbacks?.onBackgroundCurrentTask?.();
  }

  /** Destroy managers, clean up resources */
  public async destroy(): Promise<void> {
    // Terminal guard: suppress any dispatch triggered during teardown (e.g. the
    // onLoadingChange(false) fired by abortAIMessage() below, or the dispatch
    // .finally re-check). Without this, leftover queued messages would be
    // dispatched fire-and-forget and outlive the agent. Never reset: destroy()
    // is terminal, no dispatch should ever start afterwards.
    this.isDestroyed = true;

    // Log session_end event and shutdown telemetry
    await logOTelEvent("session_end", {
      duration: String(Math.round((Date.now() - this.sessionStartTime) / 1000)),
      totalTokens: String(this.messageManager.getLatestTotalTokens()),
      exitReason: "destroy",
    }).catch(() => {});
    await shutdownTelemetry();

    // Clear message queue callback first to prevent any late triggers from
    // starting async work during teardown
    this.messageQueue.onMessageEnqueued = undefined;

    // Await any pending dispatch to prevent race conditions
    // with test teardown (e.g., V8 coverage stream cleanup)
    if (this.dispatchPromise) {
      await this.dispatchPromise.catch(() => {});
    }

    // Fire SessionEnd hooks (fire-and-forget, don't block shutdown)
    try {
      const sessionId = this.messageManager.getSessionId();
      const transcriptPath = this.messageManager.getTranscriptPath();
      await this.hookManager.executeSessionEndHooks(
        "stop",
        sessionId,
        transcriptPath,
      );
    } catch (error) {
      this.logger?.warn(`SessionEnd hooks failed: ${(error as Error).message}`);
    }

    await this.messageManager.saveSession();
    this.abortAIMessage(); // This will abort tools including Agent tool (subagents)
    this.abortBashCommand();
    this.abortSlashCommand();
    this.cronManager.stop();
    // Cleanup background task manager
    this.backgroundTaskManager.cleanup();
    // Cleanup MCP connections
    await this.mcpManager.cleanup();
    // Cleanup LSP connections
    if (this.lspManager instanceof LspManager) {
      await this.lspManager.cleanup();
    }
    // Cleanup subagent manager
    this.subagentManager.cleanup();
    // Drain an in-flight auto-memory extraction fork so the process doesn't
    // exit mid-extraction
    try {
      const autoMemoryService =
        this.container.get<
          import("./services/autoMemoryService.js").AutoMemoryService
        >("AutoMemoryService");
      if (autoMemoryService) {
        await autoMemoryService.drain();
      }
    } catch (error) {
      this.logger?.warn(
        `Auto-memory extraction drain failed: ${(error as Error).message}`,
      );
    }
    // Cleanup skill manager
    await this.skillManager.destroy();
    // Cleanup live configuration reload
    try {
      await this.liveConfigManager.shutdown();
    } catch (error) {
      this.logger?.error(
        "Error shutting down live configuration reload:",
        error,
      );
    }
    // Cleanup remote settings polling
    remoteSettingsService.shutdown();
    // Drain live async work (dispatch, background subagents, fork subagents):
    // abort steps above make them settle; wait for them so no async side
    // effect outlives the agent. Timeout fallback keeps destroy bounded.
    const drained = await this.asyncWorkRegistry.drain();
    if (!drained) {
      this.logger?.error(
        `Async work did not drain: ${this.asyncWorkRegistry.size} live work item(s) remain after destroy`,
      );
    }

    // Unregister module-level listeners (remote settings hot-update, auth
    // change) so the agent's object graph becomes collectable. Without this,
    // the module-level callback arrays pin every created agent via the
    // per-agent closure contexts, even after the host drops its references.
    this.teardown();
    // Break the DI container's internal references (services/factories) so no
    // per-agent manager is retained through it after destroy.
    this.container.clear();
  }

  /**
   * Trigger the rewind UI callback
   */
  public triggerShowRewind(): void {
    this.messageManager.triggerShowRewind();
  }

  /**
   * Ask a side question without interrupting the main agent.
   *
   * Runs a single-turn fork of the conversation that reuses the main loop's
   * system prompt, tools, and memory injection (prompt-cache friendly) and
   * never executes tools. The abort signal lets the UI cancel a pending
   * question (loading dismiss); aborts propagate as thrown errors.
   *
   * @param question - The side question to ask
   * @param abortSignal - Optional signal to abort the pending request
   * @returns Promise that resolves to the AI's answer
   */
  public async askBtw(
    question: string,
    abortSignal?: AbortSignal,
    onContent?: (content: string) => void,
    onReasoning?: (content: string) => void,
  ): Promise<string> {
    this.assertNotDestroyed();
    const result = await this.aiManager.runBtwFork(
      question,
      abortSignal,
      onContent,
      onReasoning,
    );
    return result.content ?? result.error ?? "No response received";
  }

  /**
   * Start a fork subagent in the background (the "/subtask" command path).
   *
   * The fork inherits the parent's full conversation context — same system
   * prompt, tools, model, and message prefix — so the prompt cache is reused,
   * then works independently in the background. On completion its final
   * response is delivered back to the main conversation as a task notification
   * carrying the `<result>` tag. Recursion is prevented inside the fork (the
   * Agent tool and Task tools are denied).
   *
   * @param prompt - The task description for the fork subagent
   * @param options - Background task label and optional loose turn bound
   * @param options.description - Display label for the background task
   * @param options.maxTurns - Loose turn bound (defaults to 200, aligned with
   * Claude Code's fork subagent)
   * @param abortSignal - Optional signal to abort the fork
   * @returns Promise that resolves to the background task ID
   */
  public async forkSubagent(
    prompt: string,
    options: {
      description: string;
      maxTurns?: number;
    },
    abortSignal?: AbortSignal,
  ): Promise<string> {
    this.assertNotDestroyed();
    return this.aiManager.runForkSubagent(prompt, options, abortSignal);
  }

  /**
   * Send a message to the AI agent with optional images
   *
   * @param content - The text content of the message to send
   * @param images - Optional array of images to include with the message
   * @param images[].path - File path to the image or base64 encoded image data
   * @param images[].mimeType - MIME type of the image (e.g., 'image/png', 'image/jpeg')
   * @returns Promise that resolves when the message has been processed
   *
   * @example
   * ```typescript
   * // Send a text message
   * await agent.sendMessage("Hello, how are you?");
   *
   * // Send a message with images using file paths
   * await agent.sendMessage("What do you see in these images?", [
   *   { path: "/path/to/image.png", mimeType: "image/png" },
   *   { path: "/path/to/photo.jpg", mimeType: "image/jpeg" }
   * ]);
   *
   * // Send a message with base64 encoded image
   * await agent.sendMessage("Analyze this image", [
   *   { path: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAA...", mimeType: "image/png" }
   * ]);
   * ```
   */
  public async sendMessage(
    content: string,
    images?: Array<{ path: string; mimeType: string }>,
  ): Promise<void> {
    this.assertNotDestroyed();

    // If the agent is busy, enqueue the message — unless it's an immediate
    // slash command (e.g., /clear, /compact) that should execute
    // right away even while AI is processing
    if (this.aiManager.isLoading || this.isCommandRunning) {
      const trimmed = content.trim();
      const isImmediate =
        trimmed.startsWith("/") &&
        trimmed !== "/" &&
        this.slashCommandManager.isImmediateCommand(trimmed);

      if (!isImmediate) {
        this.messageQueue.enqueue({
          content,
          images,
        });
        this.options.callbacks?.onQueuedMessagesChange?.(this.queuedMessages);
        return;
      }
      // Immediate slash command: fall through to InteractionService
    }

    await InteractionService.sendMessage(
      {
        messageManager: this.messageManager,
        slashCommandManager: this.slashCommandManager,
        hookManager: this.hookManager,
        workdir: this.workdir,
        configurationService: this.configurationService,
        logger: this.logger,
        aiManager: this.aiManager,
        subagentManager: this.subagentManager,
        taskManager: this.taskManager,
        options: this.options,
        abortMessage: () => this.abortMessage(),
      },
      content,
      images,
    );
  }

  // ========== Additional Directories ==========

  /**
   * Add an additional directory to the Safe Zone for this session.
   *
   * The directory immediately becomes part of the Safe Zone (permission
   * checks and the system prompt), and with `remember: true` it is also
   * persisted to `.wave/settings.local.json` `permissions.additionalDirectories`
   * so future sessions pick it up automatically.
   *
   * @param directory Path of the directory to add (relative paths resolve against the workdir).
   * @param options.remember Whether to persist the directory across sessions.
   */
  public async addAdditionalDirectory(
    directory: string,
    options?: { remember?: boolean },
  ): Promise<void> {
    const resolvedPath = path.isAbsolute(directory)
      ? directory
      : path.resolve(this.workdir, directory);
    this.permissionManager.addInstanceAdditionalDirectory(resolvedPath);
    if (options?.remember) {
      await this.configurationService.addAdditionalDirectory(
        this.workdir,
        resolvedPath,
      );
    }
  }

  /**
   * Get the effective additional directories for this session (config +
   * session-level union), matching what is listed in the system prompt.
   */
  public getAdditionalDirectories(): string[] {
    return this.permissionManager.getEffectiveAdditionalDirectories();
  }

  // ========== MCP Management Methods ==========

  /** Get all MCP server status */
  public getMcpServers(): McpServerStatus[] {
    return this.mcpManager.getAllServers();
  }

  /** Connect MCP server */
  public async connectMcpServer(serverName: string): Promise<boolean> {
    return await this.mcpManager.connectServer(serverName);
  }

  /** Disconnect MCP server */
  public async disconnectMcpServer(serverName: string): Promise<boolean> {
    return await this.mcpManager.disconnectServer(serverName);
  }

  // ========== Slash Command Management Methods ==========

  /** Get all available slash commands */
  public getSlashCommands(): SlashCommand[] {
    return this.slashCommandManager.getCommands();
  }

  /** Check if slash command exists */
  public hasSlashCommand(commandId: string): boolean {
    return this.slashCommandManager.hasCommand(commandId);
  }

  /** Reload custom commands */
  public async reloadCustomCommands(): Promise<void> {
    await this.skillManager.initialize();
    this.slashCommandManager.reloadCustomCommands();
    this.slashCommandManager.registerSkillCommands(
      this.skillManager.getAvailableSkills(),
    );
  }

  /** Get custom command details */
  public getCustomCommand(commandId: string): CustomSlashCommand | undefined {
    return this.slashCommandManager.getCustomCommand(commandId);
  }

  /** Get all custom commands */
  public getCustomCommands(): CustomSlashCommand[] {
    return this.slashCommandManager.getCustomCommands();
  }

  /**
   * Register a custom slash command
   */
  public registerSlashCommand(command: SlashCommand): void {
    this.slashCommandManager.registerCommand(command);
  }

  /**
   * Get the current permission mode
   */
  public getPermissionMode(): PermissionMode {
    return this.toolManager.getPermissionMode();
  }

  /**
   * Get the names of tools currently visible to the AI model (filtered by
   * permission mode, denied rules, etc.)
   */
  public getAvailableToolNames(): string[] {
    return this.toolManager.getToolsConfig().map((t) => t.function.name);
  }

  /**
   * Set the permission mode
   * @param mode - The new permission mode
   */
  public setPermissionMode(mode: PermissionMode): void {
    this.logger?.debug("Setting permission mode", { mode });
    this.toolManager.setPermissionMode(mode);

    this.planManager.handlePlanModeTransition(mode);

    this.options.callbacks?.onPermissionModeChange?.(mode);
  }

  /**
   * Truncate history to a specific index and revert file changes.
   * @param index - The index of the user message to truncate to.
   */
  public async truncateHistory(index: number): Promise<void> {
    await this.messageManager.truncateHistory(index, this.reversionManager);
    // After truncating history, the task list might have changed, so refresh it.
    // We explicitly load tasks and trigger the callback to ensure UI updates immediately and in order.
    const tasks = await this.taskManager.listTasks();
    this.options.callbacks?.onTasksChange?.(tasks);
  }

  /**
   * Get the full message thread including parent sessions
   */
  public async getFullMessageThread(): Promise<{
    messages: Message[];
    sessionIds: string[];
  }> {
    return this.messageManager.getFullMessageThread();
  }

  /**
   * Get the current plan file path (for testing and UI)
   */
  public getPlanFilePath(): string | undefined {
    return this.permissionManager.getPlanFilePath();
  }

  /**
   * Resolve once the plan file path has been generated and set after entering
   * plan mode. Resolves `undefined` when no generation is in flight.
   * Used by the CLI /plan command and the stdio getPlanFile RPC to avoid
   * querying the model before the path is known (the plan mode reminder needs
   * the path to be set).
   */
  public awaitPlanFilePath(): Promise<string | undefined> {
    return this.planManager.awaitPlanFilePath();
  }

  /**
   * Get all currently allowed rules (user-defined and default)
   */
  public getAllowedRules(): string[] {
    return [
      ...this.permissionManager.getAllowedRules(),
      ...this.permissionManager.getDefaultAllowedRules(),
    ];
  }

  /**
   * Get only user-defined allowed rules
   */
  public getUserAllowedRules(): string[] {
    return this.permissionManager.getAllowedRules();
  }

  /**
   * Check permission for a tool call (for testing)
   */
  public async checkPermission(
    context: import("./types/permissions.js").ToolPermissionContext,
  ): Promise<import("./types/permissions.js").PermissionDecision> {
    return this.permissionManager.checkPermission(context);
  }

  /**
   * Add a persistent permission rule
   * @param rule - The rule to add (e.g., "Bash(ls)")
   */
  public async addPermissionRule(rule: string): Promise<void> {
    await this.permissionManager.addPermissionRule(rule);
  }

  /**
   * Get subagent instance by ID
   * @param subagentId - The ID of the subagent instance
   * @returns The subagent instance or null if not found
   */
  public getSubagentInstance(
    subagentId: string,
  ): import("./managers/subagentManager.js").SubagentInstance | null {
    return this.subagentManager.getInstance(subagentId);
  }

  /**
   * Get all subagent configurations visible in this session (built-in,
   * user, project, and plugin agents).
   * @returns The list of subagent configurations
   */
  public getSubagentConfigurations(): import("./utils/subagentParser.js").SubagentConfiguration[] {
    return this.subagentManager.getConfigurations();
  }

  /**
   * Get all skill metadata visible in this session (builtin, personal,
   * project, and plugin skills).
   * @returns The list of skill metadata
   */
  public getSkillMetadata(): SkillMetadata[] {
    return this.skillManager.getAvailableSkills();
  }

  /**
   * Get currently active subagent instances (status active/initializing).
   * @returns The list of active subagent instances
   */
  public getActiveSubagentInstances(): import("./managers/subagentManager.js").SubagentInstance[] {
    return this.subagentManager.getActiveInstances();
  }

  /**
   * Get the current task list ID
   */
  public get taskListId(): string {
    return this.taskManager.getTaskListId();
  }

  /**
   * Check if there are any running background tasks or active subagents
   */
  public get hasRunningBackgroundWork(): boolean {
    const runningTasks = this.backgroundTaskManager
      .getAllTasks()
      .some((t) => t.status === "running");
    const activeSubagents =
      this.subagentManager.getActiveInstances().length > 0;
    return runningTasks || activeSubagents;
  }

  /**
   * Check if there are pending items (messages, bang commands, or background
   * task notifications) in the message queue. Background task completion
   * notifications are enqueued before the main agent's dispatch consumes them,
   * so callers waiting for the agent to fully settle must also wait on this.
   */
  public get hasPendingMessages(): boolean {
    return this.messageQueue.hasPending();
  }
}
