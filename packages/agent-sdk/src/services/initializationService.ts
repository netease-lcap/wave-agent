import path from "path";
import * as fs from "fs/promises";
import os from "os";
import { handleSessionRestoration } from "./session.js";
import { setGlobalLogger } from "../utils/globalLogger.js";
import { LspManager } from "../managers/lspManager.js";
import type {
  Message,
  Logger,
  AgentOptions,
  ILspManager,
} from "../types/index.js";
import type { SkillManager } from "../managers/skillManager.js";
import type { SubagentManager } from "../managers/subagentManager.js";
import type { Container } from "../utils/container.js";
import type { ToolManager } from "../managers/toolManager.js";
import type { PluginManager } from "../managers/pluginManager.js";
import type { SlashCommandManager } from "../managers/slashCommandManager.js";
import type { McpManager } from "../managers/mcpManager.js";
import type { ConfigurationService } from "./configurationService.js";
import type { HookManager } from "../managers/hookManager.js";
import type { MessageManager } from "../managers/messageManager.js";
import type { MemoryRuleManager } from "../managers/MemoryRuleManager.js";
import type { LiveConfigManager } from "../managers/liveConfigManager.js";
import type { TaskManager } from "./taskManager.js";

export interface InitializationContext {
  skillManager: SkillManager;
  subagentManager: SubagentManager;
  container: Container;
  toolManager: ToolManager;
  pluginManager: PluginManager;
  options: AgentOptions;
  slashCommandManager: SlashCommandManager;
  logger?: Logger;
  mcpManager: McpManager;
  workdir: string;
  lspManager: ILspManager;
  configurationService: ConfigurationService;
  hookManager: HookManager;
  messageManager: MessageManager;
  memoryRuleManager: MemoryRuleManager;
  liveConfigManager: LiveConfigManager;
  taskManager: TaskManager;
  setProjectMemory: (content: string) => void;
  setUserMemory: (content: string) => void;
  resolveAndValidateConfig: () => void;
}

export class InitializationService {
  public static async initialize(
    context: InitializationContext,
    options?: {
      restoreSessionId?: string;
      continueLastSession?: boolean;
      messages?: Message[];
    },
  ): Promise<void> {
    const {
      skillManager,
      subagentManager,
      container,
      toolManager,
      pluginManager,
      options: agentOptions,
      slashCommandManager,
      logger,
      mcpManager,
      workdir,
      lspManager,
      configurationService,
      hookManager,
      messageManager,
      memoryRuleManager,
      liveConfigManager,
      taskManager,
      setProjectMemory,
      setUserMemory,
      resolveAndValidateConfig,
    } = context;

    // Initialize managers first
    try {
      // Initialize SkillManager
      await skillManager.initialize();

      // Initialize SubagentManager (load and cache configurations)
      await subagentManager.initialize();

      // Register managers in container for tool access
      container.register("SubagentManager", subagentManager);
      container.register("SkillManager", skillManager);

      // Initialize built-in tools
      toolManager.initializeBuiltInTools();

      // Initialize plugins
      await pluginManager.loadPlugins(agentOptions.plugins || []);

      // Register skill commands
      slashCommandManager.registerSkillCommands(
        skillManager.getAvailableSkills(),
      );
    } catch (error) {
      logger?.error("Failed to initialize managers and tools:", error);
      // Don't throw error to prevent app startup failure
    }

    // Initialize MCP servers with auto-connect
    try {
      await mcpManager.initialize(workdir, true);
      if (lspManager instanceof LspManager) {
        await lspManager.initialize(workdir);
      }
    } catch (error) {
      logger?.error("Failed to initialize MCP servers:", error);
      // Don't throw error to prevent app startup failure
    }

    // Initialize hooks configuration
    try {
      // Load hooks configuration using ConfigurationService
      logger?.debug("Loading hooks configuration...");
      const configResult =
        await configurationService.loadMergedConfiguration(workdir);

      hookManager.loadConfigurationFromWaveConfig(configResult.configuration);

      // Update plugin manager with enabled plugins configuration
      if (configResult.configuration?.enabledPlugins) {
        pluginManager.updateEnabledPlugins(
          configResult.configuration.enabledPlugins,
        );
      }

      logger?.debug("Hooks system initialized successfully");
    } catch (error) {
      logger?.error("Failed to initialize hooks system:", error);
      // Don't throw error to prevent app startup failure
    }

    // Trigger WorktreeCreate hook if this is a new worktree
    if (agentOptions.isNewWorktree && hookManager) {
      try {
        logger?.info(
          `Triggering WorktreeCreate hook for ${agentOptions.worktreeName}...`,
        );
        const hookResults = await hookManager.executeHooks("WorktreeCreate", {
          event: "WorktreeCreate",
          projectDir: workdir,
          timestamp: new Date(),
          sessionId: messageManager.getSessionId(),
          transcriptPath: messageManager.getTranscriptPath(),
          cwd: workdir,
          worktreeName: agentOptions.worktreeName,
          env: configurationService.getEnvironmentVars(),
        });

        // Process hook results
        hookManager.processHookResults(
          "WorktreeCreate",
          hookResults,
          messageManager,
        );
      } catch (error) {
        logger?.warn("WorktreeCreate hooks execution failed:", error);
      }
    }

    // Resolve and validate configuration after loading settings.json
    resolveAndValidateConfig();

    // Set global logger for SDK-wide access before discovering rules
    setGlobalLogger(logger || null);

    // Discover modular memory rules
    try {
      await memoryRuleManager.discoverRules();
    } catch (error) {
      logger?.error("Failed to discover memory rules:", error);
    }

    // Initialize live configuration reload
    try {
      logger?.debug("Initializing live configuration reload...");
      await liveConfigManager.initialize();
      logger?.debug("Live configuration reload initialized successfully");
    } catch (error) {
      logger?.error("Failed to initialize live configuration reload:", error);
      // Don't throw error to prevent app startup failure - continue without live reload
    }

    // Load memory files during initialization
    try {
      logger?.debug("Loading memory files...");

      // Load project memory from AGENTS.md (bypass memory store for direct file access)
      try {
        const projectMemoryPath = path.join(workdir, "AGENTS.md");
        const projectMemoryContent = await fs.readFile(
          projectMemoryPath,
          "utf-8",
        );
        setProjectMemory(projectMemoryContent);
        logger?.debug("Project memory loaded successfully");
      } catch (error) {
        setProjectMemory("");
        logger?.debug(
          "Project memory file not found or unreadable, using empty content:",
          error instanceof Error ? error.message : String(error),
        );
      }

      // Load user memory (bypass memory store for direct file access)
      try {
        const userMemoryPath = path.join(os.homedir(), ".wave", "AGENTS.md");
        const userMemoryContent = await fs.readFile(userMemoryPath, "utf-8");
        setUserMemory(userMemoryContent);
        logger?.debug("User memory loaded successfully");
      } catch (error) {
        setUserMemory("");
        logger?.debug(
          "User memory file not found or unreadable, using empty content:",
          error instanceof Error ? error.message : String(error),
        );
      }

      logger?.debug("Memory initialization completed");
    } catch (error) {
      // Ensure memory is always initialized even if loading fails
      setProjectMemory("");
      setUserMemory("");
      logger?.error("Failed to load memory files:", error);
      // Don't throw error to prevent app startup failure
    }

    // Handle session restoration or set provided messages
    if (options?.messages) {
      // If messages are provided, use them directly (useful for testing)
      messageManager.setMessages(options.messages);
      // Rebuild usage array from restored messages
      messageManager.rebuildUsageFromMessages(options.messages);
    } else {
      // Otherwise, handle session restoration
      const sessionToRestore = await handleSessionRestoration(
        options?.restoreSessionId,
        options?.continueLastSession,
        messageManager.getWorkdir(),
      );
      // Rebuild usage array from restored messages
      messageManager.rebuildUsageFromMessages(sessionToRestore?.messages || []);

      if (sessionToRestore) {
        messageManager.initializeFromSession(sessionToRestore);

        // Update task manager with the root session ID to ensure continuity across compressions
        taskManager.setTaskListId(
          sessionToRestore.rootSessionId || sessionToRestore.id,
        );

        // After session is initialized, load tasks for the session
        const tasks = await taskManager.listTasks();
        agentOptions.callbacks?.onTasksChange?.(tasks);
      }
    }
  }
}
