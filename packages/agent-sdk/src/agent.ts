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
import { MemoryStoreService } from "./services/memoryStore.js";
import { initializeMemoryStore } from "./services/memory.js";
import { LiveConfigManager } from "./managers/liveConfigManager.js";
import { configResolver } from "./utils/configResolver.js";
import { configValidator } from "./utils/configValidator.js";
import { SkillManager } from "./managers/skillManager.js";
import { loadSessionFromJsonl } from "./services/session.js";
import type { SubagentConfiguration } from "./utils/subagentParser.js";
import { setGlobalLogger } from "./utils/globalLogger.js";

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
}

export interface AgentCallbacks
  extends MessageManagerCallbacks,
    BackgroundBashManagerCallbacks,
    McpManagerCallbacks,
    SubagentManagerCallbacks {}

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
  private memoryStore: MemoryStoreService; // Add memory store service
  private liveConfigManager: LiveConfigManager; // Add live configuration manager
  private workdir: string; // Working directory
  private systemPrompt?: string; // Custom system prompt
  private _usages: Usage[] = []; // Usage tracking array

  // Configuration properties
  private gatewayConfig: GatewayConfig;
  private modelConfig: ModelConfig;
  private tokenLimit: number;

  // Original constructor values for preserving overrides during live updates
  private readonly constructorApiKey?: string;
  private readonly constructorBaseURL?: string;
  private readonly constructorAgentModel?: string;
  private readonly constructorFastModel?: string;
  private readonly constructorTokenLimit?: number;

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
    const { callbacks = {}, logger, workdir, systemPrompt } = options;

    // Set working directory first so it can be used for configuration resolution
    this.workdir = workdir || process.cwd();

    // Store original constructor values for live config updates
    this.constructorApiKey = options.apiKey;
    this.constructorBaseURL = options.baseURL;
    this.constructorAgentModel = options.agentModel;
    this.constructorFastModel = options.fastModel;
    this.constructorTokenLimit = options.tokenLimit;

    // Resolve configuration from constructor args and environment variables with live config support
    const gatewayConfig = configResolver.resolveGatewayConfig(
      options.apiKey,
      options.baseURL,
      this.workdir,
    );
    const modelConfig = configResolver.resolveModelConfig(
      options.agentModel,
      options.fastModel,
      this.workdir,
    );
    const tokenLimit = configResolver.resolveTokenLimit(
      options.tokenLimit,
      this.workdir,
    );

    // Validate resolved configuration
    configValidator.validateGatewayConfig(gatewayConfig);
    configValidator.validateTokenLimit(tokenLimit);
    configValidator.validateModelConfig(
      modelConfig.agentModel,
      modelConfig.fastModel,
    );

    this.logger = logger; // Save the passed logger
    this.systemPrompt = systemPrompt; // Save custom system prompt

    // Set global logger for SDK-wide access
    setGlobalLogger(logger || null);

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

    this.memoryStore = new MemoryStoreService(this.logger); // Initialize memory store service
    initializeMemoryStore(this.memoryStore); // Initialize global memory store reference
    this.hookManager = new HookManager(this.workdir, undefined, this.logger); // Initialize hooks manager
    this.liveConfigManager = new LiveConfigManager({
      workdir: this.workdir,
      logger: this.logger,
      onConfigurationChanged: () => {
        // Update Agent configuration (AIManager, SubagentManager)
        this.updateConfiguration();

        // Reload hook configuration
        try {
          this.hookManager.loadConfigurationFromSettings();
          this.logger?.info(
            "Live Config: Hook configuration reloaded successfully",
          );
        } catch (error) {
          this.logger?.error(
            `Live Config: Failed to reload hook configuration: ${(error as Error).message}`,
          );
        }
      },
      onMemoryStoreFileChanged: async (
        filePath: string,
        changeType: "add" | "change" | "unlink",
      ) => {
        try {
          if (changeType === "unlink") {
            // Handle file deletion gracefully
            this.memoryStore.removeContent(filePath);
            this.logger?.info(
              "Live Config: Removed AGENTS.md from memory store due to file deletion",
            );
          } else {
            // Update memory store content for add/change
            await this.memoryStore.updateContent(filePath);
            this.logger?.info(
              "Live Config: Updated AGENTS.md content in memory store",
            );
          }
        } catch (error) {
          this.logger?.error(
            `Live Config: Failed to update memory store: ${(error as Error).message}`,
          );
        }
      },
    }); // Initialize live configuration manager

    // Initialize MessageManager
    this.messageManager = new MessageManager({
      callbacks,
      workdir: this.workdir,
      logger: this.logger,
    });

    // Initialize subagent manager with all dependencies in constructor
    // IMPORTANT: Must be initialized AFTER MessageManager
    this.subagentManager = new SubagentManager({
      workdir: this.workdir,
      parentToolManager: this.toolManager,
      parentMessageManager: this.messageManager,
      callbacks: {
        onSubagentUserMessageAdded: callbacks.onSubagentUserMessageAdded,
        onSubagentAssistantMessageAdded:
          callbacks.onSubagentAssistantMessageAdded,
        onSubagentAssistantContentUpdated:
          callbacks.onSubagentAssistantContentUpdated,
        onSubagentToolBlockUpdated: callbacks.onSubagentToolBlockUpdated,
        onSubagentMessagesChange: callbacks.onSubagentMessagesChange,
      }, // Pass subagent callbacks for forwarding
      logger: this.logger,
      gatewayConfig,
      modelConfig,
      tokenLimit,
      hookManager: this.hookManager,
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

  /** Get merged environment variables from Wave configuration */
  public get environmentVars(): Record<string, string> | undefined {
    return this.hookManager.getEnvironmentVars();
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

      // After main session is restored, restore any associated subagent sessions
      await this.restoreSubagentSessions();
    }
  }

  /**
   * Restore subagent sessions associated with the current main session
   * This method is called after the main session is restored to load any subagent sessions
   */
  private async restoreSubagentSessions(): Promise<void> {
    try {
      // Only attempt to restore subagent sessions if we have messages (session was restored)
      if (this.messages.length === 0) {
        return;
      }

      // Extract sessionId -> subagentId mapping from SubagentBlocks
      const subagentBlockMap = new Map<
        string,
        { subagentId: string; configuration: SubagentConfiguration }
      >(); // sessionId -> { subagentId, configuration }

      for (const message of this.messages) {
        if (message.role === "assistant" && message.blocks) {
          for (const block of message.blocks) {
            if (
              block.type === "subagent" &&
              block.sessionId &&
              block.subagentId &&
              block.configuration
            ) {
              subagentBlockMap.set(block.sessionId, {
                subagentId: block.subagentId,
                configuration: block.configuration,
              });
            }
          }
        }
      }

      if (subagentBlockMap.size === 0) {
        return; // No subagent blocks found
      }

      // Load subagent sessions using sessionIds
      const subagentSessions = [];
      for (const [sessionId, blockData] of subagentBlockMap) {
        try {
          const sessionData = await loadSessionFromJsonl(
            sessionId,
            this.messageManager.getWorkdir(),
          );
          if (sessionData) {
            subagentSessions.push({
              sessionData,
              subagentId: blockData.subagentId, // Use the subagentId from SubagentBlock
              configuration: blockData.configuration, // Include configuration
            });
          }
        } catch (error) {
          this.logger?.warn(
            `Failed to load subagent session ${sessionId}:`,
            error,
          );
        }
      }

      if (subagentSessions.length > 0) {
        this.logger?.debug(
          `Found ${subagentSessions.length} subagent sessions to restore`,
        );

        // Restore subagent sessions through the SubagentManager
        await this.subagentManager.restoreSubagentSessions(subagentSessions);

        this.logger?.debug("Subagent sessions restored successfully");
      }
    } catch (error) {
      this.logger?.warn("Failed to restore subagent sessions:", error);
      // Don't throw error to prevent app startup failure
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
    try {
      this.memoryStore.clear();
      this.logger?.debug("Memory store cleared successfully");
    } catch (error) {
      this.logger?.error("Error clearing memory store:", error);
    }
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

  // ========== Live Configuration Management ==========

  /**
   * Update Agent configuration from live settings.json changes
   * This method refreshes all configuration-dependent components with new values
   * Note: Constructor values still take precedence over live configuration
   */
  public updateConfiguration(): void {
    try {
      this.logger?.info(
        "Live Config: Updating Agent configuration from live settings",
      );

      // Re-resolve configuration with current workdir, preserving constructor overrides
      // We need to track what was explicitly provided in constructor vs. what should use live config
      const newGatewayConfig = configResolver.resolveGatewayConfig(
        this.constructorApiKey, // Preserve constructor override if provided
        this.constructorBaseURL, // Preserve constructor override if provided
        this.workdir,
      );
      const newModelConfig = configResolver.resolveModelConfig(
        this.constructorAgentModel, // Preserve constructor override if provided
        this.constructorFastModel, // Preserve constructor override if provided
        this.workdir,
      );
      const newTokenLimit = configResolver.resolveTokenLimit(
        this.constructorTokenLimit,
        this.workdir,
      );

      // Validate new configuration
      configValidator.validateGatewayConfig(newGatewayConfig);
      configValidator.validateTokenLimit(newTokenLimit);
      configValidator.validateModelConfig(
        newModelConfig.agentModel,
        newModelConfig.fastModel,
      );

      // Update stored configuration
      this.gatewayConfig = newGatewayConfig;
      this.modelConfig = newModelConfig;
      this.tokenLimit = newTokenLimit;

      // Update AIManager with new configuration
      this.aiManager.updateConfiguration(
        newGatewayConfig,
        newModelConfig,
        newTokenLimit,
      );

      // Update SubagentManager with new configuration
      this.subagentManager.updateConfiguration(
        newGatewayConfig,
        newModelConfig,
        newTokenLimit,
      );

      this.logger?.info(
        `Live Config: Agent configuration updated successfully - model: ${newModelConfig.agentModel}, tokenLimit: ${newTokenLimit}`,
      );
    } catch (error) {
      this.logger?.error(
        `Live Config: Failed to update Agent configuration: ${(error as Error).message}`,
      );
      // Don't throw - continue with previous configuration
    }
  }

  /**
   * Get current Agent configuration for debugging
   */
  public getCurrentConfiguration(): {
    gatewayConfig: GatewayConfig;
    modelConfig: ModelConfig;
    tokenLimit: number;
  } {
    return {
      gatewayConfig: { ...this.gatewayConfig },
      modelConfig: { ...this.modelConfig },
      tokenLimit: this.tokenLimit,
    };
  }
}
