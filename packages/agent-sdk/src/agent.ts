import { ForegroundTaskManager } from "./managers/foregroundTaskManager.js";
import {
  MessageManager,
  type MessageManagerCallbacks,
} from "./managers/messageManager.js";
import { AIManager } from "./managers/aiManager.js";
import { ToolManager } from "./managers/toolManager.js";
import {
  SubagentManager,
  type SubagentManagerCallbacks,
} from "./managers/subagentManager.js";
import { McpManager, type McpManagerCallbacks } from "./managers/mcpManager.js";
import { LspManager } from "./managers/lspManager.js";
import { BangManager } from "./managers/bangManager.js";
import {
  BackgroundTaskManager,
  type BackgroundTaskManagerCallbacks,
} from "./managers/backgroundTaskManager.js";
import { SlashCommandManager } from "./managers/slashCommandManager.js";
import { PluginManager } from "./managers/pluginManager.js";
import { HookManager } from "./managers/hookManager.js";
import { ReversionManager } from "./managers/reversionManager.js";
import { PermissionManager } from "./managers/permissionManager.js";
import { PlanManager } from "./managers/planManager.js";
import type {
  SlashCommand,
  CustomSlashCommand,
  ILspManager,
  PluginConfig,
} from "./types/index.js";
import type {
  Message,
  Logger,
  McpServerStatus,
  GatewayConfig,
  ModelConfig,
  Usage,
  PermissionMode,
  PermissionCallback,
  BackgroundTask,
  ForegroundTask,
} from "./types/index.js";
import { MemoryRuleManager } from "./managers/MemoryRuleManager.js";
import { LiveConfigManager } from "./managers/liveConfigManager.js";
import { configValidator } from "./utils/configValidator.js";
import { SkillManager } from "./managers/skillManager.js";
import { TaskManager } from "./services/taskManager.js";
import {
  loadSessionFromJsonl,
  handleSessionRestoration,
} from "./services/session.js";
import { setGlobalLogger } from "./utils/globalLogger.js";
import { ConfigurationService } from "./services/configurationService.js";
import * as fs from "fs/promises";
import path from "path";
import os from "os";
import { ClientOptions } from "openai";

import { Container } from "./utils/container.js";
import { setupAgentContainer } from "./utils/containerSetup.js";

/**
 * Configuration options for Agent instances
 *
 * IMPORTANT: This interface is used by both Agent constructor and Agent.create()
 * Any changes to this interface must be compatible with both methods.
 */
export interface AgentOptions {
  // Optional configuration with environment fallbacks
  apiKey?: string;
  baseURL?: string;
  defaultHeaders?: Record<string, string>;
  fetchOptions?: ClientOptions["fetchOptions"];
  fetch?: ClientOptions["fetch"];
  model?: string;
  fastModel?: string;
  maxInputTokens?: number;
  maxTokens?: number;
  /** Preferred language for agent communication */
  language?: string;

  // Existing options (preserved)
  callbacks?: AgentCallbacks;
  restoreSessionId?: string;
  continueLastSession?: boolean;
  logger?: Logger;
  /**Add optional initial messages parameter for testing convenience */
  messages?: Message[];
  /**Working directory - if not specified, use process.cwd() */
  workdir?: string;
  /**Optional custom system prompt - if provided, replaces default system prompt */
  systemPrompt?: string;
  /**Permission mode - defaults to "default" */
  permissionMode?: PermissionMode;
  /**Custom permission callback */
  canUseTool?: PermissionCallback;
  /**Whether to use streaming mode for AI responses - defaults to true */
  stream?: boolean;
  /**Optional custom LSP manager - if not provided, a standalone one will be created */
  lspManager?: ILspManager;
  /**Optional local plugins to load */
  plugins?: PluginConfig[];
  /**
   * Optional list of tool names to enable.
   * - undefined: Enable all built-in tools and plugins (default).
   * - []: Disable all tools.
   * - string[]: Enable only the tools with the specified names.
   */
  tools?: string[];
  /**Optional worktree name */
  worktreeName?: string;
  /**Whether this is a newly created worktree */
  isNewWorktree?: boolean;
}

export interface AgentCallbacks
  extends MessageManagerCallbacks,
    BackgroundTaskManagerCallbacks,
    McpManagerCallbacks,
    SubagentManagerCallbacks {
  onBackgroundTasksChange?: (tasks: BackgroundTask[]) => void;
  onTasksChange?: (tasks: import("./types/tasks.js").Task[]) => void;
  onPermissionModeChange?: (mode: PermissionMode) => void;
  onSubagentLatestTotalTokensChange?: (
    subagentId: string,
    tokens: number,
  ) => void;
  onBackgroundCurrentTask?: () => void;
}

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
  private hookManager: HookManager; // Add hooks manager instance
  private reversionManager: ReversionManager;
  private memoryRuleManager: MemoryRuleManager; // Add memory rule manager instance
  private liveConfigManager: LiveConfigManager; // Add live configuration manager
  private taskManager: TaskManager;
  private foregroundTaskManager: ForegroundTaskManager;
  private container: Container;
  private configurationService: ConfigurationService; // Add configuration service
  private workdir: string; // Working directory
  private systemPrompt?: string; // Custom system prompt
  private _usages: Usage[] = []; // Usage tracking array
  private stream: boolean; // Streaming mode flag

  // Configuration options storage for dynamic resolution
  private options: AgentOptions;

  // Memory content storage
  private _projectMemoryContent: string = "";
  private _userMemoryContent: string = "";

  // Dynamic configuration getter methods
  public getGatewayConfig(): GatewayConfig {
    return this.configurationService.resolveGatewayConfig(
      this.options.apiKey,
      this.options.baseURL,
      this.options.defaultHeaders,
      this.options.fetchOptions,
      this.options.fetch,
    );
  }

  public getModelConfig(): ModelConfig {
    return this.configurationService.resolveModelConfig(
      this.options.model,
      this.options.fastModel,
      this.options.maxTokens,
      this.getPermissionMode(),
    );
  }

  public getMaxInputTokens(): number {
    return this.configurationService.resolveMaxInputTokens(
      this.options.maxInputTokens,
    );
  }

  public getLanguage(): string | undefined {
    return this.configurationService.resolveLanguage(this.options.language);
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

    this.logger = logger; // Save the passed logger
    this.systemPrompt = systemPrompt; // Save custom system prompt
    this.stream = stream; // Save streaming mode flag

    // Store options for dynamic configuration resolution
    this.options = options;

    this.container = setupAgentContainer({
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
        this.handlePlanModeTransition(mode);
      },
      setPermissionMode: (mode) => {
        this.setPermissionMode(mode);
      },
      addPermissionRule: (rule) => this.addPermissionRule(rule),
      addUsage: (usage) => this.addUsage(usage),
      getGatewayConfig: () => this.getGatewayConfig(),
      getModelConfig: () => this.getModelConfig(),
      getMaxInputTokens: () => this.getMaxInputTokens(),
      getLanguage: () => this.getLanguage(),
    });

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

  public get usages(): Usage[] {
    return [...this._usages]; // Return copy to prevent external modification
  }

  public get sessionFilePath(): string {
    return this.messageManager.getTranscriptPath();
  }

  /**
   * Rebuild usage array from messages containing usage metadata
   * Called during session restoration to reconstruct usage tracking
   */
  private rebuildUsageFromMessages(messages: Message[]): void {
    this._usages = [];
    messages.forEach((message) => {
      if (message.role === "assistant" && message.usage) {
        this._usages.push(message.usage);
      }
    });
    // Trigger callback after rebuilding usage array
    this.messageManager.triggerUsageChange();
  }

  /**
   * Add usage data to the tracking array and trigger callbacks
   * @param usage Usage data from AI operations
   */
  private addUsage(usage: Usage): void {
    this._usages.push(usage);
    this.messageManager.triggerUsageChange();
  }

  public get latestTotalTokens(): number {
    return this.messageManager.getlatestTotalTokens();
  }

  /** Get working directory */
  public get workingDirectory(): string {
    return this.workdir;
  }

  /** Get project memory content */
  public get projectMemory(): string {
    return this._projectMemoryContent;
  }

  /** Get user memory content */
  public get userMemory(): string {
    return this._userMemoryContent;
  }

  /** Get combined memory content (project + user + modular rules) */
  public async getCombinedMemory(): Promise<string> {
    return this.messageManager.getCombinedMemory();
  }

  /** Get AI loading status */
  public get isLoading(): boolean {
    return this.aiManager.isLoading;
  }

  /** Get message compression status */
  public get isCompressing(): boolean {
    return this.aiManager.getIsCompressing();
  }

  /** Get bash command execution status */
  public get isCommandRunning(): boolean {
    return this.bangManager?.isCommandRunning ?? false;
  }

  /** Get background bash shell output */
  public getBackgroundShellOutput(
    id: string,
    filter?: string,
  ): { stdout: string; stderr: string; status: string } | null {
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
  ): { stdout: string; stderr: string; status: string } | null {
    return this.backgroundTaskManager.getOutput(id, filter);
  }

  /** Stop background task */
  public stopBackgroundTask(id: string): boolean {
    return this.backgroundTaskManager.stopTask(id);
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
    const modelConfig = this.getModelConfig();
    const maxInputTokens = this.getMaxInputTokens();

    // Validate resolved configuration
    configValidator.validateGatewayConfig(gatewayConfig);
    configValidator.validateMaxInputTokens(maxInputTokens);
    configValidator.validateModelConfig(
      modelConfig.model,
      modelConfig.fastModel,
    );
  }

  /** Private initialization method, handles async initialization logic */
  private async initialize(options?: {
    restoreSessionId?: string;
    continueLastSession?: boolean;
    messages?: Message[];
  }): Promise<void> {
    // Initialize managers first
    try {
      // Initialize SkillManager
      await this.skillManager.initialize();

      // Initialize SubagentManager (load and cache configurations)
      await this.subagentManager.initialize();

      // Register managers in container for tool access
      this.container.register("SubagentManager", this.subagentManager);
      this.container.register("SkillManager", this.skillManager);

      // Initialize built-in tools
      this.toolManager.initializeBuiltInTools();

      // Initialize plugins
      await this.pluginManager.loadPlugins(this.options.plugins || []);
    } catch (error) {
      this.logger?.error("Failed to initialize managers and tools:", error);
      // Don't throw error to prevent app startup failure
    }

    // Initialize MCP servers with auto-connect
    try {
      await this.mcpManager.initialize(this.workdir, true);
      if (this.lspManager instanceof LspManager) {
        await this.lspManager.initialize(this.workdir);
      }
    } catch (error) {
      this.logger?.error("Failed to initialize MCP servers:", error);
      // Don't throw error to prevent app startup failure
    }

    // Initialize hooks configuration
    try {
      // Load hooks configuration using ConfigurationService
      this.logger?.debug("Loading hooks configuration...");
      const configResult =
        await this.configurationService.loadMergedConfiguration(this.workdir);

      this.hookManager.loadConfigurationFromWaveConfig(
        configResult.configuration,
      );

      // Update plugin manager with enabled plugins configuration
      if (configResult.configuration?.enabledPlugins) {
        this.pluginManager.updateEnabledPlugins(
          configResult.configuration.enabledPlugins,
        );
      }

      this.logger?.debug("Hooks system initialized successfully");
    } catch (error) {
      this.logger?.error("Failed to initialize hooks system:", error);
      // Don't throw error to prevent app startup failure
    }

    // Trigger WorktreeCreate hook if this is a new worktree
    if (this.options.isNewWorktree && this.hookManager) {
      try {
        this.logger?.info(
          `Triggering WorktreeCreate hook for ${this.options.worktreeName}...`,
        );
        const hookResults = await this.hookManager.executeHooks(
          "WorktreeCreate",
          {
            event: "WorktreeCreate",
            projectDir: this.workdir,
            timestamp: new Date(),
            sessionId: this.sessionId,
            transcriptPath: this.messageManager.getTranscriptPath(),
            cwd: this.workdir,
            worktreeName: this.options.worktreeName,
            env: this.configurationService.getEnvironmentVars(),
          },
        );

        // Process hook results
        this.hookManager.processHookResults(
          "WorktreeCreate",
          hookResults,
          this.messageManager,
        );
      } catch (error) {
        this.logger?.warn("WorktreeCreate hooks execution failed:", error);
      }
    }

    // Resolve and validate configuration after loading settings.json
    this.resolveAndValidateConfig();

    // Set global logger for SDK-wide access before discovering rules
    setGlobalLogger(this.logger || null);

    // Discover modular memory rules
    try {
      await this.memoryRuleManager.discoverRules();
    } catch (error) {
      this.logger?.error("Failed to discover memory rules:", error);
    }

    // Initialize live configuration reload
    try {
      this.logger?.debug("Initializing live configuration reload...");
      await this.liveConfigManager.initialize();
      this.logger?.debug("Live configuration reload initialized successfully");
    } catch (error) {
      this.logger?.error(
        "Failed to initialize live configuration reload:",
        error,
      );
      // Don't throw error to prevent app startup failure - continue without live reload
    }

    // Load memory files during initialization
    try {
      this.logger?.debug("Loading memory files...");

      // Load project memory from AGENTS.md (bypass memory store for direct file access)
      try {
        const projectMemoryPath = path.join(this.workdir, "AGENTS.md");
        this._projectMemoryContent = await fs.readFile(
          projectMemoryPath,
          "utf-8",
        );
        this.logger?.debug("Project memory loaded successfully");
      } catch (error) {
        this._projectMemoryContent = "";
        this.logger?.debug(
          "Project memory file not found or unreadable, using empty content:",
          error instanceof Error ? error.message : String(error),
        );
      }

      // Load user memory (bypass memory store for direct file access)
      try {
        const userMemoryPath = path.join(os.homedir(), ".wave", "AGENTS.md");
        this._userMemoryContent = await fs.readFile(userMemoryPath, "utf-8");
        this.logger?.debug("User memory loaded successfully");
      } catch (error) {
        this._userMemoryContent = "";
        this.logger?.debug(
          "User memory file not found or unreadable, using empty content:",
          error instanceof Error ? error.message : String(error),
        );
      }

      this.logger?.debug("Memory initialization completed");
    } catch (error) {
      // Ensure memory is always initialized even if loading fails
      this._projectMemoryContent = "";
      this._userMemoryContent = "";
      this.logger?.error("Failed to load memory files:", error);
      // Don't throw error to prevent app startup failure
    }

    // Handle session restoration or set provided messages
    if (options?.messages) {
      // If messages are provided, use them directly (useful for testing)
      this.messageManager.setMessages(options.messages);
      // Rebuild usage array from restored messages
      this.rebuildUsageFromMessages(options.messages);
    } else {
      // Otherwise, handle session restoration
      const sessionToRestore = await handleSessionRestoration(
        options?.restoreSessionId,
        options?.continueLastSession,
        this.messageManager.getWorkdir(),
      );
      // Rebuild usage array from restored messages
      this.rebuildUsageFromMessages(sessionToRestore?.messages || []);

      if (sessionToRestore) {
        this.messageManager.initializeFromSession(sessionToRestore);

        // Update task manager with the root session ID to ensure continuity across compressions
        this.taskManager.setTaskListId(
          sessionToRestore.rootSessionId || sessionToRestore.id,
        );

        // After session is initialized, load tasks for the session
        const tasks = await this.taskManager.listTasks();
        this.options.callbacks?.onTasksChange?.(tasks);
      }
    }
  }

  /**
   * Restore a session by ID, switching to the target session without destroying the Agent instance
   * @param sessionId - The ID of the session to restore
   */
  public async restoreSession(sessionId: string): Promise<void> {
    // 1. Validation
    if (!sessionId || sessionId === this.sessionId) {
      return; // No-op if session ID is invalid or already current
    }

    // 2. Auto-save current session
    try {
      await this.messageManager.saveSession();
    } catch (error) {
      this.logger?.warn(
        "Failed to save current session before restore:",
        error,
      );
      // Continue with restoration even if save fails
    }

    // 3. Load target session
    const sessionData = await loadSessionFromJsonl(
      sessionId,
      this.messageManager.getWorkdir(),
    );
    if (!sessionData) {
      throw new Error(`Session not found: ${sessionId}`);
    }

    // 4. Clean current state
    this.abortMessage(); // Abort any running operations
    this.subagentManager.cleanup(); // Clean up active subagents

    // 5. Rebuild usage (in correct order)
    this.rebuildUsageFromMessages(sessionData.messages);

    // 6. Initialize session state last
    this.messageManager.initializeFromSession(sessionData);

    // Update task manager with the root session ID to ensure continuity across compressions
    this.taskManager.setTaskListId(sessionData.rootSessionId || sessionData.id);

    // 7. Load tasks for the restored session
    const tasks = await this.taskManager.listTasks();
    this.options.callbacks?.onTasksChange?.(tasks);
  }

  public abortAIMessage(): void {
    this.aiManager.abortAIMessage();
  }

  /** Execute bash command */
  public async executeBashCommand(command: string): Promise<void> {
    await this.bangManager?.executeCommand(command);
  }

  public clearMessages(): void {
    this.messageManager.clearMessages();
  }

  /** Unified interrupt method, interrupts both AI messages and command execution */
  public abortMessage(): void {
    this.abortAIMessage(); // This will abort tools including Task tool (subagents)
    this.abortBashCommand();
    this.abortSlashCommand();
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
    await this.messageManager.saveSession();
    this.abortAIMessage(); // This will abort tools including Task tool (subagents)
    this.abortBashCommand();
    this.abortSlashCommand();
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
    // Cleanup live configuration reload
    try {
      await this.liveConfigManager.shutdown();
    } catch (error) {
      this.logger?.error(
        "Error shutting down live configuration reload:",
        error,
      );
    }
    // Cleanup memory store
  }

  /**
   * Get a subagent instance by its ID
   * @param subagentId - The ID of the subagent instance
   */
  public getSubagentInstance(
    subagentId: string,
  ): import("./managers/subagentManager.js").SubagentInstance | null {
    return this.subagentManager.getInstance(subagentId);
  }

  /**
   * Trigger the rewind UI callback
   */
  public triggerShowRewind(): void {
    this.messageManager.triggerShowRewind();
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
    try {
      // Handle slash command - check if it's a slash command (starts with /)
      if (content.startsWith("/")) {
        const command = content.trim();
        if (!command || command === "/") return;

        // Parse and validate slash command
        const { isValid, commandId, args } =
          this.slashCommandManager.parseAndValidateSlashCommand(command);

        if (isValid && commandId !== undefined) {
          // Execute valid slash command
          await this.slashCommandManager.executeCommand(commandId, args);

          return;
        }

        // If command doesn't exist, continue as normal message processing
        // Don't add to history, let normal message processing logic below handle it
      }

      // Handle normal AI message
      // Add user message first, will automatically sync to UI
      this.messageManager.addUserMessage({
        content,
        images: images?.map((img) => ({
          path: img.path,
          mimeType: img.mimeType,
        })),
      });

      // Execute UserPromptSubmit hooks after adding the user message
      if (this.hookManager) {
        try {
          const hookResults = await this.hookManager.executeHooks(
            "UserPromptSubmit",
            {
              event: "UserPromptSubmit",
              projectDir: this.workdir,
              timestamp: new Date(),
              // UserPromptSubmit doesn't need toolName
              sessionId: this.sessionId,
              transcriptPath: this.messageManager.getTranscriptPath(),
              cwd: this.workdir,
              userPrompt: content,
              env: this.configurationService.getEnvironmentVars(), // Include configuration environment variables
            },
          );

          // Process hook results and determine if we should continue
          const processResult = this.hookManager.processHookResults(
            "UserPromptSubmit",
            hookResults,
            this.messageManager,
          );

          // If hook processing indicates we should block (exit code 2), stop here
          if (processResult.shouldBlock) {
            this.logger?.info(
              "UserPromptSubmit hook blocked prompt processing with error:",
              processResult.errorMessage,
            );
            return; // Don't send to AI
          }
        } catch (error) {
          this.logger?.warn("UserPromptSubmit hooks execution failed:", error);
          // Continue processing even if hooks fail
        }
      }

      // Send AI message
      await this.aiManager.sendAIMessage();
    } catch (error) {
      console.error("Failed to add user message:", error);
      // Loading state will be automatically updated by the useEffect that watches messages
    }
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
  public reloadCustomCommands(): void {
    this.slashCommandManager.reloadCustomCommands();
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
   * Set the permission mode
   * @param mode - The new permission mode
   */
  public setPermissionMode(mode: PermissionMode): void {
    this.logger?.debug("Setting permission mode", { mode });
    this.toolManager.setPermissionMode(mode);

    this.handlePlanModeTransition(mode);

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
   * Get all currently allowed rules (for testing and UI)
   */
  public getAllowedRules(): string[] {
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
    // 1. Expand rule if it's a Bash command
    let rulesToAdd = [rule];
    const bashMatch = rule.match(/^Bash\((.*)\)$/);
    if (bashMatch) {
      const command = bashMatch[1];
      rulesToAdd = this.permissionManager.expandBashRule(command, this.workdir);
    }

    for (const ruleToAdd of rulesToAdd) {
      // 2. Update PermissionManager state
      const currentRules = this.permissionManager.getAllowedRules();
      if (!currentRules.includes(ruleToAdd)) {
        this.permissionManager.updateAllowedRules([...currentRules, ruleToAdd]);

        // 3. Persist to settings.local.json
        try {
          await this.configurationService.addAllowedRule(
            this.workdir,
            ruleToAdd,
          );
          this.logger?.debug("Persistent permission rule added", {
            rule: ruleToAdd,
          });
        } catch (error) {
          this.logger?.error("Failed to persist permission rule", {
            rule: ruleToAdd,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
    }
  }

  /**
   * Handle plan mode transition, generating or clearing plan file path
   * @param mode - The current effective permission mode
   */
  private handlePlanModeTransition(mode: PermissionMode): void {
    if (mode === "plan") {
      this.planManager
        .getOrGeneratePlanFilePath(this.messageManager.getRootSessionId())
        .then(({ path }) => {
          this.logger?.debug("Plan file path generated", { path });
          this.permissionManager.setPlanFilePath(path);
        })
        .catch((error) => {
          this.logger?.error("Failed to generate plan file path", error);
        });
    } else {
      this.permissionManager.setPlanFilePath(undefined);
    }
  }

  /**
   * Get the current task list ID
   */
  public get taskListId(): string {
    return this.taskManager.getTaskListId();
  }
}
