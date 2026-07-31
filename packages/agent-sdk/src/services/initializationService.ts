import { handleSessionRestoration } from "./session.js";
import { setGlobalLogger } from "../utils/globalLogger.js";
import { LspManager } from "../managers/lspManager.js";
import { USER_MEMORY_FILE } from "../utils/constants.js";
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
import type { PermissionManager } from "../managers/permissionManager.js";
import { remoteSettingsService } from "./remoteSettingsService.js";

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
      resolveAndValidateConfig,
    } = context;

    const startTime = performance.now();

    // Set global logger early so managers can use it during initialization
    setGlobalLogger(logger || null);

    // Initialize managers first
    try {
      const phaseStart = performance.now();
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
      logger?.debug(
        `Initialization Phase [Managers and Tools] took ${(performance.now() - phaseStart).toFixed(2)}ms`,
      );
    } catch (error) {
      logger?.error("Failed to initialize managers and tools:", error);
      // Don't throw error to prevent app startup failure
    }

    // Initialize MCP servers with auto-connect
    try {
      const phaseStart = performance.now();
      await mcpManager.initialize(workdir, true);
      if (lspManager instanceof LspManager) {
        await lspManager.initialize(workdir);
      }
      logger?.debug(
        `Initialization Phase [MCP and LSP] took ${(performance.now() - phaseStart).toFixed(2)}ms`,
      );
    } catch (error) {
      logger?.error("Failed to initialize MCP servers:", error);
      // Don't throw error to prevent app startup failure
    }

    // Load remote settings disk cache synchronously.
    // Must happen BEFORE loadMergedConfiguration so cached managed settings
    // (env, model, disallowedTools) are merged into the config. Settings `env`
    // is stored in the per-session env snapshot (NOT process.env), except
    // WAVE_SERVER_URL which is mirrored to process.env so the network fetch
    // (below) can read it via authService.getServerUrl(); no race.
    try {
      const phaseStart = performance.now();
      await remoteSettingsService.initialize();
      logger?.debug(
        `Initialization Phase [Remote Settings Cache] took ${(performance.now() - phaseStart).toFixed(2)}ms`,
      );
    } catch (error) {
      logger?.error("Failed to initialize remote settings:", error);
      // Don't throw error to prevent app startup failure - continue without remote settings
    }

    // Initialize hooks configuration
    try {
      const phaseStart = performance.now();
      // Load hooks configuration using ConfigurationService
      const configResult =
        await configurationService.loadMergedConfiguration(workdir);

      hookManager.loadConfigurationFromWaveConfig(configResult.configuration);

      // Update plugin manager with enabled plugins configuration
      if (configResult.configuration?.enabledPlugins) {
        pluginManager.updateEnabledPlugins(
          configResult.configuration.enabledPlugins,
        );
      }

      // Initialize permission manager with loaded rules
      if (configResult.configuration?.permissions) {
        const permissionManager =
          context.container.get<PermissionManager>("PermissionManager");
        if (permissionManager) {
          if (configResult.configuration.permissions.allow) {
            permissionManager.updateAllowedRules(
              configResult.configuration.permissions.allow,
            );
          }
          if (configResult.configuration.permissions.deny) {
            permissionManager.updateDeniedRules(
              configResult.configuration.permissions.deny,
            );
          }
          if (configResult.configuration.permissions.permissionMode) {
            permissionManager.updateConfiguredPermissionMode(
              configResult.configuration.permissions.permissionMode,
            );
          }
          if (configResult.configuration.permissions.additionalDirectories) {
            permissionManager.updateAdditionalDirectories(
              configResult.configuration.permissions.additionalDirectories,
            );
          }
        }
      }
      logger?.debug(
        `Initialization Phase [Hooks Configuration] took ${(performance.now() - phaseStart).toFixed(2)}ms`,
      );
    } catch (error) {
      logger?.error("Failed to initialize hooks system:", error);
      // Don't throw error to prevent app startup failure
    }

    // Start remote settings network fetch + polling now that the config is
    // merged. Settings `env` WAVE_SERVER_URL was mirrored to process.env by
    // loadMergedConfiguration → setEnvironmentVars, so the fetch reads it via
    // authService.getServerUrl(); fire-and-forget, failures fall back to the
    // cached/merged settings.
    remoteSettingsService.startBackgroundFetch();

    // Execute SessionStart hooks
    try {
      const phaseStart = performance.now();
      const sessionStartResult = await hookManager.executeSessionStartHooks(
        "startup",
        messageManager.getSessionId(),
        messageManager.getTranscriptPath(),
      );

      // Inject additionalContext as a meta user message (matches Claude Code)
      if (sessionStartResult.additionalContext) {
        messageManager.addUserMessage({
          content: `<system-reminder>\nSessionStart hook additional context: ${sessionStartResult.additionalContext}\n</system-reminder>`,
          isMeta: true,
        });
      }

      // Inject initialUserMessage as a meta user message
      if (sessionStartResult.initialUserMessage) {
        messageManager.addUserMessage({
          content: sessionStartResult.initialUserMessage,
          isMeta: true,
        });
      }

      logger?.debug(
        `Initialization Phase [SessionStart Hooks] took ${(performance.now() - phaseStart).toFixed(2)}ms`,
      );
    } catch (error) {
      logger?.warn("SessionStart hooks execution failed:", error);
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
          env: Object.fromEntries(
            Object.entries(configurationService.getMergedEnv()).filter(
              (e) => e[1] !== undefined,
            ),
          ) as Record<string, string>,
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

    // Initialize auto-memory directory
    try {
      const phaseStart = performance.now();
      if (configurationService.resolveAutoMemoryEnabled()) {
        const memoryService =
          container.get<import("./memory.js").MemoryService>("MemoryService");
        if (memoryService) {
          await memoryService.ensureAutoMemoryDirectory(workdir);
          const permissionManager =
            container.get<PermissionManager>("PermissionManager");
          if (permissionManager) {
            const autoMemoryDir = memoryService.getAutoMemoryDirectory(workdir);
            permissionManager.addSystemAdditionalDirectory(autoMemoryDir);
            permissionManager.addSystemAdditionalDirectory(USER_MEMORY_FILE);
          }
        }
      }
      logger?.debug(
        `Initialization Phase [Auto-memory Initialization] took ${(performance.now() - phaseStart).toFixed(2)}ms`,
      );
    } catch (error) {
      logger?.error("Failed to initialize auto-memory directory:", error);
    }

    // Discover modular memory rules
    try {
      const phaseStart = performance.now();
      await memoryRuleManager.discoverRules();
      logger?.debug(
        `Initialization Phase [Memory Rules Discovery] took ${(performance.now() - phaseStart).toFixed(2)}ms`,
      );
    } catch (error) {
      logger?.error("Failed to discover memory rules:", error);
    }

    // Initialize live configuration reload
    try {
      const phaseStart = performance.now();
      await liveConfigManager.initialize();
      logger?.debug(
        `Initialization Phase [Live Config Initialization] took ${(performance.now() - phaseStart).toFixed(2)}ms`,
      );
    } catch (error) {
      logger?.error("Failed to initialize live configuration reload:", error);
      // Don't throw error to prevent app startup failure - continue without live reload
    }

    // Memory is lazy-cached on first getCombinedMemoryContent call
    // No explicit loading needed during initialization

    // Handle session restoration or set provided messages
    const sessionPhaseStart = performance.now();
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

        // Update task manager with the root session ID to ensure continuity across compactions
        taskManager.setTaskListId(sessionToRestore.id);

        // After session is initialized, load tasks for the session
        const tasks = await taskManager.listTasks();
        agentOptions.callbacks?.onTasksChange?.(tasks);
      }
    }
    logger?.debug(
      `Initialization Phase [Session Restoration] took ${(performance.now() - sessionPhaseStart).toFixed(2)}ms`,
    );

    logger?.debug(
      `Total Initialization took ${(performance.now() - startTime).toFixed(2)}ms`,
    );
  }
}
