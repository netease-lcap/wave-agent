import { Container } from "./container.js";
import { ForegroundTaskManager } from "../managers/foregroundTaskManager.js";
import { BackgroundTaskManager } from "../managers/backgroundTaskManager.js";
import { TaskManager } from "../services/taskManager.js";
import { MessageManager } from "../managers/messageManager.js";
import { AIManager } from "../managers/aiManager.js";
import { ToolManager } from "../managers/toolManager.js";
import { McpManager } from "../managers/mcpManager.js";
import { LspManager } from "../managers/lspManager.js";
import { PermissionManager } from "../managers/permissionManager.js";
import { PlanManager } from "../managers/planManager.js";
import { HookManager } from "../managers/hookManager.js";
import { SkillManager } from "../managers/skillManager.js";
import { SlashCommandManager } from "../managers/slashCommandManager.js";
import { PluginManager } from "../managers/pluginManager.js";
import { BangManager } from "../managers/bangManager.js";
import { CronManager } from "../managers/cronManager.js";
import { MemoryRuleManager } from "../managers/MemoryRuleManager.js";
import { ReversionManager } from "../managers/reversionManager.js";
import { SubagentManager } from "../managers/subagentManager.js";
import { LiveConfigManager } from "../managers/liveConfigManager.js";
import { ConfigurationService } from "../services/configurationService.js";
import { ReversionService } from "../services/reversionService.js";
import { MemoryService } from "../services/memory.js";
import { getGitMainRepoRoot } from "./gitUtils.js";
import type { AgentOptions } from "../types/index.js";
import type {
  PermissionMode,
  Usage,
  Task,
  BackgroundTask,
  ToolPermissionContext,
} from "../types/index.js";

import { logger } from "./globalLogger.js";

export interface AgentContainerSetupOptions {
  options: AgentOptions;
  workdir: string;
  configurationService: ConfigurationService;
  systemPrompt?: string;
  stream: boolean;

  // Callbacks to Agent methods
  onBackgroundTasksChange: (tasks: BackgroundTask[]) => void;
  onTasksChange: (tasks: Task[]) => void;
  onPermissionModeChange: (mode: PermissionMode) => void;
  handlePlanModeTransition: (mode: PermissionMode) => void;
  setPermissionMode: (mode: PermissionMode) => void;
  addPermissionRule: (rule: string) => Promise<void>;
  addUsage: (usage: Usage) => void;
}

export function setupAgentContainer(
  setupOptions: AgentContainerSetupOptions,
): Container {
  const {
    options,
    workdir,
    configurationService,
    systemPrompt,
    stream,
    onBackgroundTasksChange,
    onTasksChange,
    onPermissionModeChange,
    handlePlanModeTransition,
    setPermissionMode,
    addPermissionRule,
    addUsage,
  } = setupOptions;

  const callbacks = options.callbacks || {};
  const container = new Container();
  container.register("AgentOptions", options);

  const foregroundTaskManager = new ForegroundTaskManager(container);
  container.register("ForegroundTaskManager", foregroundTaskManager);
  container.register("ConfigurationService", configurationService);

  if (options.worktreeName) {
    container.register("WorktreeName", options.worktreeName);
    container.register("MainRepoRoot", getGitMainRepoRoot(workdir));
  }

  const memoryService = new MemoryService(container);
  container.register("MemoryService", memoryService);

  const memoryRuleManager = new MemoryRuleManager(container, { workdir });
  container.register("MemoryRuleManager", memoryRuleManager);

  const messageManager = new MessageManager(container, {
    callbacks: {
      ...callbacks,
      onSessionIdChange: (sessionId) => {
        const taskManager = container.get<TaskManager>("TaskManager");
        if (taskManager) {
          taskManager.syncWithSession().catch((error) => {
            logger.error("Failed to sync task list with session:", error);
          });
        }
        callbacks.onSessionIdChange?.(sessionId);
      },
    },
    workdir,
  });
  container.register("MessageManager", messageManager);

  const resolvedTaskListId =
    configurationService.getEnvironmentVars().WAVE_TASK_LIST_ID ||
    process.env.WAVE_TASK_LIST_ID ||
    messageManager.getRootSessionId();

  const taskManager = new TaskManager(container, resolvedTaskListId);
  container.register("TaskManager", taskManager);
  taskManager.on("tasksChange", async () => {
    const tasks = await taskManager.listTasks();
    onTasksChange(tasks);
  });
  taskManager.cleanupOldTaskLists(30).catch((error) => {
    logger.error("Failed to cleanup old task lists:", error);
  });

  const backgroundTaskManager = new BackgroundTaskManager(container, {
    callbacks: {
      ...callbacks,
      onBackgroundTasksChange: (tasks) => {
        onBackgroundTasksChange(tasks);
        callbacks.onBackgroundTasksChange?.(tasks);
      },
    },
    workdir,
  });
  container.register("BackgroundTaskManager", backgroundTaskManager);

  const mcpManager = new McpManager(container, { callbacks });
  container.register("McpManager", mcpManager);

  const lspManager = options.lspManager || new LspManager(container);
  container.register("LspManager", lspManager);

  const permissionManager = new PermissionManager(container, {
    workdir,
    instanceAllowedRules: options.allowedTools,
    instanceDeniedRules: options.disallowedTools,
  });
  if (configurationService.resolveAutoMemoryEnabled()) {
    const autoMemoryDir = memoryService.getAutoMemoryDirectory(workdir);
    permissionManager.addSystemAdditionalDirectory(autoMemoryDir);
  }
  container.register("PermissionManager", permissionManager);
  permissionManager.setOnConfiguredPermissionModeChange((mode) => {
    handlePlanModeTransition(mode);
    onPermissionModeChange(mode);
  });

  const planManager = new PlanManager(container);
  container.register("PlanManager", planManager);

  const hookManager = new HookManager(container, workdir);
  container.register("HookManager", hookManager);

  const skillManager = new SkillManager(container, {
    workdir,
    watch: options.watchSkills ?? true,
  });
  container.register("SkillManager", skillManager);

  const rootSessionId = messageManager.getRootSessionId();

  container.register("ReversionService", new ReversionService(rootSessionId));
  const reversionManager = new ReversionManager(container);
  container.register("ReversionManager", reversionManager);

  const canUseToolWithPermissionRequest = options.canUseTool
    ? async (context: ToolPermissionContext) => {
        try {
          const results = await hookManager.executeHooks("PermissionRequest", {
            event: "PermissionRequest",
            projectDir: workdir,
            timestamp: new Date(),
            sessionId: messageManager.getSessionId(),
            transcriptPath: messageManager.getTranscriptPath(),
            cwd: workdir,
            toolName: context.toolName,
            toolInput: context.toolInput,
            env: configurationService.getEnvironmentVars(),
          });

          if (results.length > 0) {
            const processResult = hookManager.processHookResults(
              "PermissionRequest",
              results,
              messageManager,
            );

            if (processResult.shouldBlock) {
              return {
                behavior: "deny",
                message:
                  processResult.errorMessage ||
                  "Permission denied by hook execution",
              };
            }
          }
        } catch (error) {
          logger.warn("Failed to execute permission request hooks", {
            toolName: context.toolName,
            error: error instanceof Error ? error.message : String(error),
          });
        }

        const decision = await options.canUseTool!(context);

        const planFilePath = permissionManager.getPlanFilePath();

        if (decision.newPermissionMode) {
          setPermissionMode(decision.newPermissionMode);
        }

        if (decision.newPermissionRule) {
          await addPermissionRule(decision.newPermissionRule);
        }

        if (decision.clearContext) {
          messageManager.clearMessages();
          if (planFilePath) {
            messageManager.addUserMessage({
              content: `Implement the plan at ${planFilePath}`,
            });
          }
        }

        return decision;
      }
    : undefined;

  const toolManager = new ToolManager({
    container,
    tools: options.tools,
  });
  container.register("ToolManager", toolManager);

  container.register("PermissionMode", options.permissionMode);
  logger.info("Registering CanUseToolCallback", {
    hasCallback: !!canUseToolWithPermissionRequest,
  });
  container.register("CanUseToolCallback", canUseToolWithPermissionRequest);

  const liveConfigManager = new LiveConfigManager(container, { workdir });
  container.register("LiveConfigManager", liveConfigManager);

  const subagentManager = new SubagentManager(container, {
    workdir,
    callbacks: {
      onSubagentUserMessageAdded: callbacks.onSubagentUserMessageAdded,
      onSubagentAssistantMessageAdded:
        callbacks.onSubagentAssistantMessageAdded,
      onSubagentAssistantContentUpdated:
        callbacks.onSubagentAssistantContentUpdated,
      onSubagentAssistantReasoningUpdated:
        callbacks.onSubagentAssistantReasoningUpdated,
      onSubagentToolBlockUpdated: callbacks.onSubagentToolBlockUpdated,
      onSubagentMessagesChange: (subagentId, messages) => {
        callbacks.onSubagentMessagesChange?.(subagentId, messages);
      },
      onSubagentLatestTotalTokensChange:
        callbacks.onSubagentLatestTotalTokensChange,
    },
    onUsageAdded: (usage: Usage) => addUsage(usage),
    stream,
  });
  container.register("SubagentManager", subagentManager);

  const aiManager = new AIManager(container, {
    callbacks: {
      ...callbacks,
      onUsageAdded: (usage: Usage) => addUsage(usage),
    },
    workdir,
    systemPrompt,
    stream,
  });
  container.register("AIManager", aiManager);

  const slashCommandManager = new SlashCommandManager(container, { workdir });
  container.register("SlashCommandManager", slashCommandManager);
  slashCommandManager.initialize();

  const pluginManager = new PluginManager(container, { workdir });
  container.register("PluginManager", pluginManager);

  const bangManager = new BangManager(container, { workdir });
  container.register("BangManager", bangManager);

  const cronManager = new CronManager(container);
  container.register("CronManager", cronManager);
  cronManager.start();

  return container;
}
