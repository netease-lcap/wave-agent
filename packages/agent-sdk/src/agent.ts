import {
  MessageManager,
  type MessageManagerCallbacks,
} from "./managers/messageManager.js";
import { AIManager } from "./managers/aiManager.js";
import { ToolManager } from "./managers/toolManager.js";
import { SubagentManager } from "./managers/subagentManager.js";
import * as memory from "./services/memory.js";
import { McpManager, type McpManagerCallbacks } from "./managers/mcpManager.js";
import { BashManager } from "./managers/bashManager.js";
import {
  BackgroundBashManager,
  type BackgroundBashManagerCallbacks,
} from "./managers/backgroundBashManager.js";
import { SlashCommandManager } from "./managers/slashCommandManager.js";
import type { SlashCommand, CustomSlashCommand } from "./types/index.js";
import type {
  Message,
  Logger,
  McpServerStatus,
  GatewayConfig,
  ModelConfig,
  Usage,
} from "./types/index.js";
import { HookManager } from "./managers/hookManager.js";
import { configResolver } from "./utils/configResolver.js";
import { configValidator } from "./utils/configValidator.js";
import { SkillManager } from "./managers/skillManager.js";

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
  agentModel?: string;
  fastModel?: string;
  tokenLimit?: number;

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

  // New: Session directory configuration
  /**
   * Optional custom directory for session file storage
   * @default join(homedir(), ".wave", "sessions")
   * @example "/path/to/custom/sessions"
   */
  sessionDir?: string;
}

export interface AgentCallbacks
  extends MessageManagerCallbacks,
    BackgroundBashManagerCallbacks,
    McpManagerCallbacks {}

export class Agent {
  private messageManager: MessageManager;
  private aiManager: AIManager;

  private bashManager: BashManager | null = null;
  private backgroundBashManager: BackgroundBashManager;
  private logger?: Logger; // Add optional logger property
  private toolManager: ToolManager; // Add tool registry instance
  private mcpManager: McpManager; // Add MCP manager instance
  private subagentManager: SubagentManager; // Add subagent manager instance
  private slashCommandManager: SlashCommandManager; // Add slash command manager instance
  private hookManager: HookManager; // Add hooks manager instance
  private workdir: string; // Working directory
  private systemPrompt?: string; // Custom system prompt
  private _usages: Usage[] = []; // Usage tracking array

  // Configuration properties
  private gatewayConfig: GatewayConfig;
  private modelConfig: ModelConfig;
  private tokenLimit: number;

  /**
   * Agent constructor - handles configuration resolution and validation
   *
   * IMPORTANT: This constructor is private. Use Agent.create() instead for proper
   * async initialization. Keep this constructor's signature exactly the same as
   * Agent.create() to maintain API consistency.
   *
   * @param options - Configuration options for the Agent instance
   * @param options.sessionDir - Optional custom directory for session storage
   */
  private constructor(options: AgentOptions) {
    const {
      callbacks = {},
      logger,
      workdir,
      systemPrompt,
      sessionDir,
    } = options;

    // Resolve configuration from constructor args and environment variables
    const gatewayConfig = configResolver.resolveGatewayConfig(
      options.apiKey,
      options.baseURL,
    );
    const modelConfig = configResolver.resolveModelConfig(
      options.agentModel,
      options.fastModel,
    );
    const tokenLimit = configResolver.resolveTokenLimit(options.tokenLimit);

    // Validate resolved configuration
    configValidator.validateGatewayConfig(gatewayConfig);
    configValidator.validateTokenLimit(tokenLimit);
    configValidator.validateModelConfig(
      modelConfig.agentModel,
      modelConfig.fastModel,
    );

    this.logger = logger; // Save the passed logger
    this.workdir = workdir || process.cwd(); // Set working directory, default to current working directory
    this.systemPrompt = systemPrompt; // Save custom system prompt

    // Store resolved configuration
    this.gatewayConfig = gatewayConfig;
    this.modelConfig = modelConfig;
    this.tokenLimit = tokenLimit;

    this.backgroundBashManager = new BackgroundBashManager({
      callbacks,
      workdir: this.workdir,
    });
    this.mcpManager = new McpManager({ callbacks, logger: this.logger }); // Initialize MCP manager
    this.toolManager = new ToolManager({
      mcpManager: this.mcpManager,
      logger: this.logger,
    }); // Initialize tool registry, pass MCP manager

    this.hookManager = new HookManager(this.workdir, undefined, this.logger); // Initialize hooks manager

    // Initialize MessageManager
    this.messageManager = new MessageManager({
      callbacks,
      workdir: this.workdir,
      logger: this.logger,
      sessionDir,
    });

    // Initialize subagent manager with all dependencies in constructor
    // IMPORTANT: Must be initialized AFTER MessageManager
    this.subagentManager = new SubagentManager({
      workdir: this.workdir,
      parentToolManager: this.toolManager,
      parentMessageManager: this.messageManager,
      logger: this.logger,
      gatewayConfig,
      modelConfig,
      tokenLimit,
      onUsageAdded: (usage) => this.addUsage(usage),
    });

    // Initialize AI manager with resolved configuration
    this.aiManager = new AIManager({
      messageManager: this.messageManager,
      toolManager: this.toolManager,
      logger: this.logger,
      backgroundBashManager: this.backgroundBashManager,
      hookManager: this.hookManager,
      callbacks: {
        ...callbacks,
        onUsageAdded: (usage: Usage) => {
          this.addUsage(usage);
        },
      },
      workdir: this.workdir,
      systemPrompt: this.systemPrompt,
      gatewayConfig: this.gatewayConfig,
      modelConfig: this.modelConfig,
      tokenLimit: this.tokenLimit,
    });

    // Initialize command manager
    this.slashCommandManager = new SlashCommandManager({
      messageManager: this.messageManager,
      aiManager: this.aiManager,
      workdir: this.workdir,
      logger: this.logger,
    });

    // Initialize bash manager
    this.bashManager = new BashManager({
      messageManager: this.messageManager,
      workdir: this.workdir,
    });
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
  private rebuildUsageFromMessages(): void {
    this._usages = [];
    this.messages.forEach((message) => {
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

  public get userInputHistory(): string[] {
    return this.messageManager.getUserInputHistory();
  }

  /** Get working directory */
  public get workingDirectory(): string {
    return this.workdir;
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
    return this.bashManager?.isCommandRunning ?? false;
  }

  /** Get background bash shell output */
  public getBackgroundShellOutput(
    id: string,
    filter?: string,
  ): { stdout: string; stderr: string; status: string } | null {
    return this.backgroundBashManager.getOutput(id, filter);
  }

  /** Kill background bash shell */
  public killBackgroundShell(id: string): boolean {
    return this.backgroundBashManager.killShell(id);
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
   * @param options.sessionDir - Optional custom directory for session file storage.
   *   If not provided, defaults to ~/.wave/sessions/. Can be relative or absolute path.
   *   Examples: "./app-sessions", "/var/myapp/sessions", "~/Documents/sessions"
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
   * // Basic usage with default session directory
   * const agent = await Agent.create({
   *   apiKey: 'your-api-key',
   *   baseURL: 'https://api.example.com'
   * });
   *
   * // Custom session directory
   * const agent = await Agent.create({
   *   apiKey: 'your-api-key',
   *   baseURL: 'https://api.example.com',
   *   sessionDir: './app-sessions'
   * });
   * ```
   */
  static async create(options: AgentOptions): Promise<Agent> {
    // Create Agent instance - configuration resolution and validation now happens in constructor
    const instance = new Agent(options);
    await instance.initialize({
      restoreSessionId: options.restoreSessionId,
      continueLastSession: options.continueLastSession,
      messages: options.messages,
    });
    return instance;
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
      const skillManager = new SkillManager({ logger: this.logger });
      await skillManager.initialize();

      // Initialize SubagentManager (load and cache configurations)
      await this.subagentManager.initialize();

      // Initialize built-in tools with dependencies
      this.toolManager.initializeBuiltInTools({
        subagentManager: this.subagentManager,
        skillManager: skillManager,
      });
    } catch (error) {
      this.logger?.error("Failed to initialize managers and tools:", error);
      // Don't throw error to prevent app startup failure
    }

    // Initialize MCP servers with auto-connect
    try {
      await this.mcpManager.initialize(this.workdir, true);
    } catch (error) {
      this.logger?.error("Failed to initialize MCP servers:", error);
      // Don't throw error to prevent app startup failure
    }

    // Initialize hooks configuration
    try {
      // Load hooks configuration from user and project settings
      this.logger?.debug("Loading hooks configuration...");
      this.hookManager.loadConfigurationFromSettings();
      this.logger?.debug("Hooks system initialized successfully");
    } catch (error) {
      this.logger?.error("Failed to initialize hooks system:", error);
      // Don't throw error to prevent app startup failure
    }

    // Handle session restoration or set provided messages
    if (options?.messages) {
      // If messages are provided, use them directly (useful for testing)
      this.messageManager.setMessages(options.messages);
      // Rebuild usage array from restored messages
      this.rebuildUsageFromMessages();
    } else {
      // Otherwise, handle session restoration
      await this.messageManager.handleSessionRestoration(
        options?.restoreSessionId,
        options?.continueLastSession,
      );
      // Rebuild usage array from restored messages
      this.rebuildUsageFromMessages();
    }
  }

  public abortAIMessage(): void {
    this.aiManager.abortAIMessage();
  }

  /** Execute bash command */
  public async executeBashCommand(command: string): Promise<void> {
    // Add user message to history (but not displayed in UI)
    this.addToInputHistory(`!${command}`);
    await this.bashManager?.executeCommand(command);
  }

  /** Clear messages and input history */
  public clearMessages(): void {
    this.messageManager.clearMessages();
  }

  /** Unified interrupt method, interrupts both AI messages and command execution */
  public abortMessage(): void {
    this.abortAIMessage(); // This will abort tools including Task tool (subagents)
    this.abortBashCommand();
    this.abortSlashCommand();
  }

  /** Add to input history */
  private addToInputHistory(input: string): void {
    this.messageManager.addToInputHistory(input);
  }

  /** Interrupt bash command execution */
  public abortBashCommand(): void {
    this.bashManager?.abortCommand();
  }

  /** Interrupt slash command execution */
  public abortSlashCommand(): void {
    this.slashCommandManager.abortCurrentCommand();
  }

  /** Destroy managers, clean up resources */
  public async destroy(): Promise<void> {
    await this.messageManager.saveSession();
    this.abortAIMessage(); // This will abort tools including Task tool (subagents)
    this.abortBashCommand();
    this.abortSlashCommand();
    // Cleanup background bash manager
    this.backgroundBashManager.cleanup();
    // Cleanup MCP connections
    await this.mcpManager.cleanup();
    // Cleanup subagent manager
    this.subagentManager.cleanup();
  }

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

          // Add slash command to history
          this.addToInputHistory(command);
          return;
        }

        // If command doesn't exist, continue as normal message processing
        // Don't add to history, let normal message processing logic below handle it
      }

      // Handle normal AI message
      // Add user message to history
      this.addToInputHistory(content);

      // Add user message first, will automatically sync to UI
      this.messageManager.addUserMessage(
        content,
        images?.map((img) => ({
          path: img.path,
          mimeType: img.mimeType,
        })),
      );

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
            },
          );

          // Process hook results and determine if we should continue
          const processResult = this.hookManager.processHookResults(
            "UserPromptSubmit",
            hookResults,
            {
              addUserMessage: (content: string) =>
                this.messageManager.addUserMessage(content),
              addErrorBlock: (error: string) =>
                this.messageManager.addErrorBlock(error),
              removeLastUserMessage: () =>
                this.messageManager.removeLastUserMessage(),
              updateToolBlock: (params) =>
                this.messageManager.updateToolBlock(params),
            },
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

  /** Save memory to project or user memory file */
  public async saveMemory(
    message: string,
    type: "project" | "user",
  ): Promise<void> {
    try {
      if (type === "project") {
        await memory.addMemory(message, this.workdir);
      } else {
        await memory.addUserMemory(message);
      }

      // Add successful MemoryBlock to the last assistant message
      const memoryText = message.substring(1).trim();
      const typeLabel = type === "project" ? "Project Memory" : "User Memory";
      const storagePath = type === "project" ? "AGENTS.md" : "user-memory.md";

      this.messageManager.addMemoryBlock(
        `${typeLabel}: ${memoryText}`,
        true,
        type,
        storagePath,
      );
    } catch (error) {
      // Add failed MemoryBlock to the last assistant message
      const typeLabel = type === "project" ? "Project Memory" : "User Memory";
      const storagePath = type === "project" ? "AGENTS.md" : "user-memory.md";

      this.messageManager.addMemoryBlock(
        `${typeLabel} add failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
        false,
        type,
        storagePath,
      );
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
}
