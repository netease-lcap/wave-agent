import { handleSessionRestoration, type SessionData } from "./session.js";
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
import { wrapInSystemReminder } from "../prompts/planModeReminders.js";

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

    // Load the remote settings disk cache synchronously, before anything reads
    // the configuration chain. Two consumers depend on it being this early:
    // loadMergedConfiguration (below) merges the cached managed settings (env,
    // model, disallowedTools), and plugin loading (also below) reads the managed
    // enabledPlugins / marketplaces so an admin-pushed plugin is installed and
    // enabled on this very startup (spec enterprise server-managed-config
    // 「托管配置下发插件市场与启用列表」场景 1). Settings `env` is stored in the
    // per-session env snapshot (NOT process.env), except WAVE_SERVER_URL which is
    // mirrored to process.env so the network fetch (below) can read it via
    // authService.getServerUrl(); no race.
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

    // Register the MCP servers and start dialing them here — but do not wait for
    // any of them to come up. The server list has to be complete right after
    // create (the `/mcp` panel and the settings page read it), and a first
    // message must not be spent waiting on a server's bootstrap: 2026-11-23
    // measured 12.75 s from Enter to request, all of it `uvx` starting one
    // server, while the second turn of the same session took 12 ms. Where the
    // waiting does live — a 5 s deadline on the turn path, connection continuing
    // in the background past it, `alwaysLoad: true` as the only server that is
    // actually waited for — is `AIManager.sendAIMessage` → `waitForTurnDials`
    // (spec ecosystem/mcp.md「连接 MCP 服务器的时机与超时」). This trades part
    // of #2758's memory saving (one live tree per active Agent, instead of none
    // until first use) for that first-turn latency; the destruction-path fixes
    // from that issue stay.
    try {
      const phaseStart = performance.now();
      await mcpManager.initialize(workdir, true);
      // No second `loadConfig()` here: `initialize(workdir, true)` awaits it
      // before it starts dialing, so the list above is already complete. A
      // second read would just repeat the same disk work on every create.
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

    // Initialize hooks configuration
    try {
      const phaseStart = performance.now();
      // Load hooks configuration using ConfigurationService
      const configResult =
        await configurationService.loadMergedConfiguration(workdir);

      // Rebuild subagent configurations now that settings.json env is loaded
      // into the snapshot: conditional builtin subagents (model: visionModel
      // → WAVE_VISION_MODEL) can only register once the env is available.
      // Plugin agents are preserved by refreshConfigurations.
      await subagentManager.refreshConfigurations();

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
          if (configResult.configuration.permissions.ask) {
            permissionManager.updateAskRules(
              configResult.configuration.permissions.ask,
            );
          }
          if (configResult.configuration.permissions.defaultMode) {
            permissionManager.updateConfiguredPermissionMode(
              configResult.configuration.permissions.defaultMode,
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
    let restoredSession: SessionData | undefined;
    if (options?.messages) {
      // If messages are provided, use them directly (useful for testing)
      messageManager.setMessages(options.messages);
      // Rebuild usage array from restored messages
      messageManager.rebuildUsageFromMessages(options.messages);
    } else {
      // Otherwise, handle session restoration
      restoredSession = await handleSessionRestoration(
        options?.restoreSessionId,
        options?.continueLastSession,
        messageManager.getCurrentWorkdir(),
      );
      // Rebuild usage array from what the loader collected while scanning the
      // transcript (falls back to the messages when there was nothing to restore).
      messageManager.rebuildUsageFromMessages(
        restoredSession?.messages || [],
        restoredSession?.usages,
      );

      if (restoredSession) {
        messageManager.initializeFromSession(restoredSession);

        // Update task manager with the root session ID to ensure continuity across compactions
        taskManager.setTaskListId(restoredSession.id);

        // After session is initialized, load tasks for the session
        const tasks = await taskManager.listTasks();
        agentOptions.callbacks?.onTasksChange?.(tasks);
      }
    }
    logger?.debug(
      `Initialization Phase [Session Restoration] took ${(performance.now() - sessionPhaseStart).toFixed(2)}ms`,
    );

    // Execute SessionStart hooks — **after** restoration, like Claude Code
    // ("a conversation you resumed appears without waiting for the hooks …
    // their context reaches Claude", hooks.md; `SessionStart` runs again on
    // resume with `source: "resume"` so hooks can refresh their context).
    // Restoring replaces the whole message list, so injecting before it dropped
    // the context of every `restoreSessionId` / `continueLastSession` startup.
    try {
      const phaseStart = performance.now();
      const sessionStartResult = await hookManager.executeSessionStartHooks(
        restoredSession ? "resume" : "startup",
        // A resumed hook must describe the session we just adopted, not the
        // empty one this Agent was created with (same as
        // `InteractionService.restoreSession`, which passes `sessionData.id`).
        restoredSession?.id ?? messageManager.getSessionId(),
        messageManager.getTranscriptPath(),
        messageManager,
      );

      // Inject additionalContext as a meta user message (matches Claude Code).
      // `wrapInSystemReminder` rather than a literal: the four injection
      // sources must write byte-identical text, or the dedupe in
      // `addMetaMessageIfAbsent` stops matching across them. No per-source
      // branch: on resume the restored list already ends with the copy from
      // the previous run and this dedupe skips it.
      if (sessionStartResult.additionalContext) {
        messageManager.addMetaMessageIfAbsent(
          wrapInSystemReminder(
            `SessionStart hook additional context: ${sessionStartResult.additionalContext}`,
          ),
        );
      }

      // Inject initialUserMessage as a meta user message. Startup only: on a
      // resume the restored conversation already has its own first turn.
      if (!restoredSession && sessionStartResult.initialUserMessage) {
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

    logger?.debug(
      `Total Initialization took ${(performance.now() - startTime).toFixed(2)}ms`,
    );
  }
}
