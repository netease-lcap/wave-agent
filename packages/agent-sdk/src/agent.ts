import { ForegroundTaskManager } from "./managers/foregroundTaskManager.js";
import { MessageManager } from "./managers/messageManager.js";
import { AIManager } from "./managers/aiManager.js";
import { ToolManager } from "./managers/toolManager.js";
import { SubagentManager } from "./managers/subagentManager.js";
import { McpManager } from "./managers/mcpManager.js";
import { LspManager } from "./managers/lspManager.js";
import { BangManager } from "./managers/bangManager.js";
import { BackgroundTaskManager } from "./managers/backgroundTaskManager.js";
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
} from "./types/index.js";
import { MemoryRuleManager } from "./managers/MemoryRuleManager.js";
import { LiveConfigManager } from "./managers/liveConfigManager.js";
import { configValidator } from "./utils/configValidator.js";
import { SkillManager } from "./managers/skillManager.js";
import { TaskManager } from "./services/taskManager.js";
import { InitializationService } from "./services/initializationService.js";
import { InteractionService } from "./services/interactionService.js";
import { ConfigurationService } from "./services/configurationService.js";
import { Container } from "./utils/container.js";
import { setupAgentContainer } from "./utils/containerSetup.js";

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
  private stream: boolean; // Streaming mode flag

  // Configuration options storage for dynamic resolution
  private options: AgentOptions;

  // Memory content storage
  private _projectMemoryContent: string = "";
  private _userMemoryContent: string = "";

  // Dynamic configuration getter methods
  public getGatewayConfig(): GatewayConfig {
    return this.configurationService.resolveGatewayConfig();
  }

  public getModelConfig(): ModelConfig {
    return this.configurationService.resolveModelConfig(
      undefined,
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
        this.planManager.handlePlanModeTransition(mode);
      },
      setPermissionMode: (mode) => {
        this.setPermissionMode(mode);
      },
      addPermissionRule: (rule) => this.addPermissionRule(rule),
      addUsage: (usage) => this.messageManager.addUsage(usage),
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
    return this.messageManager.getUsages();
  }

  public get sessionFilePath(): string {
    return this.messageManager.getTranscriptPath();
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
        setProjectMemory: (content) => {
          this._projectMemoryContent = content;
        },
        setUserMemory: (content) => {
          this._userMemoryContent = content;
        },
        resolveAndValidateConfig: () => this.resolveAndValidateConfig(),
      },
      options,
    );
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

  /** Execute bash command */
  public async executeBashCommand(command: string): Promise<void> {
    await this.bangManager?.executeCommand(command);
  }

  public clearMessages(): void {
    this.messageManager.clearMessages();
  }

  /** Unified interrupt method, interrupts both AI messages and command execution */
  public abortMessage(): void {
    this.abortAIMessage(); // This will abort tools including Agent tool (subagents)
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
    this.abortAIMessage(); // This will abort tools including Agent tool (subagents)
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
   * Get the current task list ID
   */
  public get taskListId(): string {
    return this.taskManager.getTaskListId();
  }
}
