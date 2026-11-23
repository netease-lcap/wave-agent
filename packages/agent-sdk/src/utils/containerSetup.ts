import { Container } from "./container.js";
import { normalizeEntrypoint } from "../constants/telemetry.js";
import type { HostEntrypoint } from "../constants/telemetry.js";
import { ForegroundTaskManager } from "../managers/foregroundTaskManager.js";
import { ShellProcessReaper } from "../managers/shellProcessReaper.js";
import { BackgroundTaskManager } from "../managers/backgroundTaskManager.js";
import { MessageQueue } from "../managers/messageQueue.js";
import { TaskManager } from "../services/taskManager.js";
import { MessageManager } from "../managers/messageManager.js";
import { AIManager } from "../managers/aiManager.js";
import { TurnBudgetLedger } from "../managers/turnBudgetLedger.js";
import { ToolManager } from "../managers/toolManager.js";
import { McpManager } from "../managers/mcpManager.js";
import { LspManager } from "../managers/lspManager.js";
import { PermissionManager } from "../managers/permissionManager.js";
import { PlanManager } from "../managers/planManager.js";
import { HookManager } from "../managers/hookManager.js";
import { SkillManager } from "../managers/skillManager.js";
import { SlashCommandManager } from "../managers/slashCommandManager.js";
import { PluginManager } from "../managers/pluginManager.js";
import {
  ModManager,
  toModSessionMessages,
  withCommunityUsage,
} from "../managers/modManager.js";
import { callAgent } from "../services/aiService.js";
import { renderSurfacesOf } from "../mods/runtime.js";
import type {
  ModPermissionRequestEvent,
  ModRenderSurface,
} from "../types/mods.js";
import { MOD_LIMITS, MOD_SETTINGS_SOURCES } from "../types/mods.js";
import { buildConfigRows, detectSessionRepo } from "../mods/facts.js";
import { engineVersion } from "./engineVersion.js";
import { BashModeManager } from "../managers/bashModeManager.js";
import { CronManager } from "../managers/cronManager.js";
import { PageWatchManager } from "../managers/pageWatchManager.js";
import { WorkflowManager } from "../managers/workflowManager.js";
import { WorkflowRegistry } from "../workflow/workflowRegistry.js";
import { MemoryRuleManager } from "../managers/MemoryRuleManager.js";
import { ReversionManager } from "../managers/reversionManager.js";
import { SubagentManager } from "../managers/subagentManager.js";
import { LiveConfigManager } from "../managers/liveConfigManager.js";
import { ConfigurationService } from "../services/configurationService.js";
import { SandboxManager } from "../sandbox/SandboxManager.js";
import { getRgPath } from "./ripgrep.js";
import { ensureRuntimeDeps } from "./runtimeDeps.js";
import { ReversionService } from "../services/reversionService.js";
import { cleanupMetaOnlySessions } from "../services/session.js";
import { runSessionCleanupInBackground } from "./sessionCleanup.js";
import { MemoryService } from "../services/memory.js";
import { AutoMemoryService } from "../services/autoMemoryService.js";
import { USER_MEMORY_FILE } from "./constants.js";
import { getGitMainRepoRoot } from "./gitUtils.js";
import { toPosixPath } from "./path.js";
import { EDIT_TOOL_NAME, WRITE_TOOL_NAME } from "../constants/tools.js";
import { AsyncWorkRegistry } from "./asyncWorkRegistry.js";
import type { AgentOptions, McpServerConfig } from "../types/index.js";
import type {
  PermissionMode,
  Usage,
  Task,
  BackgroundTask,
  ToolPermissionContext,
} from "../types/index.js";

import { logger } from "./globalLogger.js";
import { authService } from "../services/authService.js";
import {
  ensureAuthChangeRefresh,
  remoteSettingsService,
} from "../services/remoteSettingsService.js";

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

export interface AgentContainerSetupResult {
  container: Container;
  /**
   * Unregister module-level listeners registered during setup (remote settings
   * hot-update, auth change). Must be called when the agent is destroyed;
   * without it the module-level callback arrays pin the agent's object graph
   * (the callback closures capture per-agent managers).
   */
  teardown: () => void;
}

/**
 * 一次工具审批即将弹给用户时通知 mods（spec ecosystem/plugin-mods.md「完成与审
 * 批的观察」）。载荷就是 `PermissionRequest` 这个 settings hook 收到的 stdin
 * JSON —— mod 那边的事件名叫 `classic.PermissionRequest`，形状照 Claude Code 的
 * `classic.<Event>` 约定走。
 *
 * 只读且 fire-and-forget：mod 的上报既不能替用户回答这道审批，也不该把那卡片
 * 拖住。走到这一步说明权限规则没有自行判定，所以自动放行/拒绝、以及被
 * `PermissionRequest` 钩子直接拒掉的调用都不会有事件。
 *
 * 单独拎成一个函数只为一件事：这条接线能单独测 —— `setupAgentContainer` 太重，
 * 而这里全部的逻辑就是「容器里有没有 mods 宿主」。
 */
export function notifyModPermissionRequest(
  container: Container,
  event: ModPermissionRequestEvent,
): void {
  const modManager = container.get<ModManager>("ModManager");
  if (!modManager) return;
  modManager.notifyMods("classic.PermissionRequest", event);
  // 同一时刻还有一条 `classic.Notification`（spec「影子事件」）：社区插件用它
  // 把「有东西在等你动手」推到自己的页面上。`permission_prompt` 是 Claude Code
  // 自己给审批卡片用的那个名字 —— 表外的名字（曾经写成 `permission_request`）
  // 会让 done-waiting-ping 这类按名字过滤的插件永远不触发。
  modManager.notifyMods("classic.Notification", {
    notification_type: "permission_prompt",
    message: `Wave needs your permission to use ${event.tool_name}`,
  });
}

/**
 * 从 provider 抛出来的错误里取出 HTTP 状态（spec「让模型替插件答一次」：
 * `api-error` 带 `status`，拿不到响应时是 `null`）。
 *
 * AI SDK 的错误对象把状态挂在 `status` 上；网关偶尔回字符串，`Number()` 之后
 * 不是有限数就按「拿不到」处理 —— 给 mod 一个假的 0 比给 null 更误导。
 */
function errorStatusCodeOf(error: unknown): number | null {
  if (typeof error !== "object" || error === null) return null;
  const record = error as { status?: unknown; statusCode?: unknown };
  // 两个字段都看：AI SDK 抛的挂 `status`，`errorCategory.ts` 那边同时读
  // `statusCode`，网关实现两种都有。
  const raw = record.status ?? record.statusCode;
  // `Number(null) === 0`、`Number(undefined)` 是 NaN —— 没有状态码时要的是
  // `null`（spec「拿不到响应时为 null」），不是一个假的 0。
  if (raw === null || raw === undefined) return null;
  const status = Number(raw);
  return Number.isFinite(status) ? status : null;
}

export function setupAgentContainer(
  setupOptions: AgentContainerSetupOptions,
): AgentContainerSetupResult {
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
  // Three directory tokens, and the difference is deliberate:
  //
  // - `CurrentWorkdir` MOVES. A `cd` in Bash re-registers it, EnterWorktree
  //   swaps in a worktree path, and the cwd-recovery path rewrites it. It is
  //   what tools should run in and what project rules load from.
  // - `WorkspaceRoot` is the session's *workspace*: it starts at the session's
  //   opening directory and only moves when the session itself relocates
  //   (EnterWorktree / ExitWorktree) — never on a Bash `cd`. It answers "which
  //   working tree is this conversation working in right now", which is what
  //   the user-looking-at surfaces need (diff panel, file-panel tree root,
  //   `@` file search). Same three-way split Claude Code makes
  //   (`originalCwd` vs `cwd` vs `projectRoot`).
  // - `SessionWorkdir` NEVER moves (except when a whole different session is
  //   restored into this agent). It answers "which directory was this session
  //   opened in", so anything that must stay stable for the session's lifetime
  //   — telemetry repository identity, audit anchors, transcript/session
  //   location — reads this one.
  //
  // Reaching for `CurrentWorkdir` when you meant "the session's directory" is
  // how the telemetry `vcs.repository.*` attributes ended up following the
  // shell (fixed 2026-10-22). If the value is an identity, it is
  // `SessionWorkdir`; if it is "what the user is looking at", it is
  // `WorkspaceRoot`.
  container.register("CurrentWorkdir", workdir);
  container.register("WorkspaceRoot", workdir);
  container.register("SessionWorkdir", workdir);
  // Normalised here rather than at each record site: the entrypoint is declared
  // once by the session's creator (the CLI, a host over stdio, the remote-control
  // channel), and every manager reads the same container key. A value outside
  // the known table resolves to undefined — "not declared", never exported.
  container.register("Entrypoint", normalizeEntrypoint(options.entrypoint));
  // Declared surfaces win over the entrypoint's default: `wave` and `wave -p`
  // share `entrypoint: "cli"` but only the interactive TUI draws mod trees.
  container.register("RenderSurfaces", options.renderSurfaces);

  // Module-level listener teardowns collected during setup and returned to the
  // agent, which invokes them in destroy(). The remote-settings callback
  // strongly captures the per-agent LiveConfigManager: without unsubscribing
  // it in destroy(), the module-level callback array keeps every created
  // agent's object graph alive even after the host drops its references.
  const teardowns: Array<() => void> = [];

  if (options.worktreeName) {
    container.register("WorktreeName", options.worktreeName);
    container.register("MainRepoRoot", getGitMainRepoRoot(workdir));
  }

  // Per-agent worktree session state (EnterWorktree/ExitWorktree). Stored in the
  // container so it is isolated per session, not shared process-wide.
  container.register("WorktreeSession", null);

  const messageQueue = new MessageQueue();
  container.register("MessageQueue", messageQueue);

  // Registry of live async work that must drain before the agent is destroyed
  // (dispatch, background subagents, fork subagents — the fire-and-forget work
  // sites). destroy() awaits its drain() so no async work can outlive the agent.
  container.register("AsyncWorkRegistry", new AsyncWorkRegistry());

  const foregroundTaskManager = new ForegroundTaskManager(container);
  container.register("ForegroundTaskManager", foregroundTaskManager);

  // Per-agent ledger of the process groups a shell left behind (`nohup … &`,
  // `node server.js &`). Recorded when the shell exits, terminated in destroy()
  // — see `managers/shellProcessReaper.ts` and spec core/bash-tools.md
  //「shell 退出后留下的进程组」. Per agent, not process-wide: a daemon hosting
  // several sessions must never reap another session's processes.
  const shellProcessReaper = new ShellProcessReaper();
  container.register("ShellProcessReaper", shellProcessReaper);
  container.register("ConfigurationService", configurationService);

  // OS-level sandbox for Bash. Reads the live merged configuration on every
  // judgment (so hot reload lands without extra plumbing) and loads
  // sandbox-runtime lazily — see `src/sandbox/SandboxManager.ts`.
  const sandboxManager = new SandboxManager({
    getConfiguration: () => configurationService.getCurrentConfiguration(),
    workdir,
    getRgPath: () => getRgPath(),
  });
  container.register("SandboxManager", sandboxManager);

  // 沙箱运行时包（12MB vendor）不进宿主 bundle，宿主副本的 CLI 也没有
  // node_modules，只能按需下载。启用沙箱时在会话建立阶段就预取，别让第一条
  // 沙箱命令干等下载；没启用的人连这一步都不会触发，也不产生任何警告。
  if (
    configurationService.getCurrentConfiguration()?.sandbox?.enabled === true
  ) {
    void ensureRuntimeDeps({ includeSandbox: true });
  }

  const memoryService = new MemoryService(container);
  container.register("MemoryService", memoryService);

  const autoMemoryService = new AutoMemoryService(container);
  container.register("AutoMemoryService", autoMemoryService);

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
        memoryService.clearCache();
        callbacks.onSessionIdChange?.(sessionId);
      },
    },
    workdir,
  });
  container.register("MessageManager", messageManager);

  const resolvedTaskListId =
    process.env.WAVE_TASK_LIST_ID || messageManager.getRootSessionId();

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

  if (options.serverUrl) {
    authService.setServerUrl(options.serverUrl);
  }
  const mcpManager = new McpManager(container, {
    callbacks,
    mcpServers: options.mcpServers as
      | Record<string, McpServerConfig>
      | undefined,
  });
  container.register("McpManager", mcpManager);

  // 托管配置的刷新是**进程级**的：`_cachedSettings` 只有一份，一次登录刷一次就够。
  // 它曾经写在下面这个 per-agent 回调里，于是 N 个会话 = N 次串行全量拉取、且每次
  // 拉取都广播给全部 N 个 agent —— 一次登录 O(N²)，会话多的用户要等几十秒
  // （2026-11-12 实测 16 个会话 57.8s，拆出来之后 8.1s）。
  ensureAuthChangeRefresh();
  teardowns.push(
    authService.onAuthChange(async () => {
      // 账号级特性门控是 per-agent 的：每个 Agent 有自己的 ToolManager /
      // SkillManager，登录/登出会改变 gated 工具与 /artifact 技能，谁的可用集都
      // 得各自重算一次。SDK 没有跨 agent 的广播机制，只能每个实例自己挂监听。
      // The Artifact code default depends on the account (see
      // artifactAvailability.ts) and its registration was decided at setup time,
      // so a mid-session login/logout must re-evaluate the gated tools and the
      // /artifact skill — otherwise a first-run user who logs in from inside the
      // session would only get the feature after a restart. 托管配置的刷新不覆盖
      // 这一点：配置没变时它连通知都不会发。
      // Resolved through the container rather than the locals below, which are
      // declared after this callback is registered.
      container.get<ToolManager>("ToolManager")?.reloadFeatureGatedTools();
      await container
        .get<SkillManager>("SkillManager")
        ?.reloadFeatureGatedSkills();
    }),
  );

  const lspManager = options.lspManager || new LspManager(container);
  container.register("LspManager", lspManager);

  const permissionManager = new PermissionManager(container, {
    instanceAllowedRules: options.allowedTools,
    instanceDeniedRules: options.disallowedTools,
    instanceAdditionalDirectories: options.additionalDirectories,
  });
  if (configurationService.resolveAutoMemoryEnabled()) {
    const autoMemoryDir = memoryService.getAutoMemoryDirectory(workdir);
    permissionManager.addSystemAdditionalDirectory(autoMemoryDir);
    permissionManager.addSystemAdditionalDirectory(USER_MEMORY_FILE);
  }
  container.register("PermissionManager", permissionManager);
  permissionManager.setOnConfiguredPermissionModeChange((mode) => {
    handlePlanModeTransition(mode);
    onPermissionModeChange(mode);
  });

  const planManager = new PlanManager(container);
  container.register("PlanManager", planManager);

  const hookManager = new HookManager(container, workdir);
  if (options.hooks) {
    hookManager.loadConfiguration(options.hooks);
  }
  container.register("HookManager", hookManager);

  const skillManager = new SkillManager(container, {
    workdir,
    watch: options.watchSkills ?? true,
  });
  container.register("SkillManager", skillManager);

  const rootSessionId = messageManager.getRootSessionId();

  const reversionService = new ReversionService(rootSessionId);
  container.register("ReversionService", reversionService);
  reversionService.cleanupOldSessions(30).catch((error) => {
    logger.error("Failed to cleanup old file history:", error);
  });
  // Remove pre-existing meta-only session files (SessionStart hook context
  // with no real messages) that were persisted before lazy materialization.
  cleanupMetaOnlySessions()
    .then((count) => {
      if (count > 0) {
        logger.debug(`Removed ${count} meta-only session file(s)`);
      }
    })
    .catch((error) => {
      logger.error("Failed to cleanup meta-only session files:", error);
    });
  // Global session retention cleanup (cleanupPeriodDays, default 30 days).
  // Once per process; reads settings itself since config isn't loaded yet.
  // It also sweeps stale ephemeral worktrees, which is why it needs the
  // worktree this session was opened in (if any) to leave it alone.
  runSessionCleanupInBackground(workdir, options.worktreeName);
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
            planFilePath: permissionManager.getPlanFilePath(),
            env: Object.fromEntries(
              Object.entries(configurationService.getMergedEnv()).filter(
                (e) => e[1] !== undefined,
              ),
            ) as Record<string, string>,
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
                // A hook decided, not the user: the prompt never appeared, so
                // `checkPermission` must not read this as a rejection.
                source: "hook" as const,
              };
            }
          }
        } catch (error) {
          logger.warn("Failed to execute permission request hooks", {
            toolName: context.toolName,
            error: error instanceof Error ? error.message : String(error),
          });
        }

        // A permission prompt is about to show: tell the mods (read-only, spec
        // ecosystem/plugin-mods.md「完成与审批的观察」). Fire-and-forget — a mod's
        // reporting can neither answer this request nor delay the card, and the
        // return value is dropped. Reaching this wrapper at all means the rules
        // did not settle it on their own, so auto-allowed/denied calls, and the
        // ones a `PermissionRequest` hook already rejected above, stay silent.
        // The payload repeats what that hook's stdin JSON carries (mods get it as
        // `classic.PermissionRequest`, the mirror event Claude Code also has).
        notifyModPermissionRequest(container, {
          session_id: messageManager.getSessionId(),
          transcript_path: messageManager.getTranscriptPath(),
          cwd: workdir,
          permission_mode:
            permissionManager.getConfiguredPermissionMode() ?? "default",
          hook_event_name: "PermissionRequest",
          tool_name: context.toolName,
          ...(context.toolInput !== undefined && {
            tool_input: context.toolInput,
          }),
          ...(permissionManager.getPlanFilePath() !== undefined && {
            plan_file_path: permissionManager.getPlanFilePath(),
          }),
        });

        const decision = await options.canUseTool!(context);

        if (decision.newPermissionMode) {
          setPermissionMode(decision.newPermissionMode);
        }

        if (decision.newPermissionRule) {
          await addPermissionRule(decision.newPermissionRule);
        }

        if (decision.newAdditionalDirectory) {
          // Session-level only: the user approved this directory from the
          // confirmation dialog (never persisted to settings).
          permissionManager.addInstanceAdditionalDirectory(
            decision.newAdditionalDirectory,
          );
          // The dialog option is "允许本会话编辑 <目录名>/" — it has to cover
          // later edits too, otherwise `default` mode would keep prompting for
          // every Write/Edit in that directory. Forward slashes: minimatch
          // treats the pattern `\` as an escape, while it normalises the input
          // path's separators on Windows.
          const pattern = `${toPosixPath(decision.newAdditionalDirectory)}/**`;
          permissionManager.addInstanceAllowedRule(
            `${EDIT_TOOL_NAME}(${pattern})`,
          );
          permissionManager.addInstanceAllowedRule(
            `${WRITE_TOOL_NAME}(${pattern})`,
          );
        }

        return decision;
      }
    : undefined;

  const toolManager = new ToolManager({
    container,
    tools: options.tools,
    customTools: options.customTools ?? [],
  });
  container.register("ToolManager", toolManager);

  container.register("PermissionMode", options.permissionMode);
  // Register the full permission mode transition (Agent.setPermissionMode) so
  // tools like EnterPlanMode can trigger planManager.handlePlanModeTransition
  // and onPermissionModeChange even in bypass mode (where canUseTool is skipped).
  container.register("PermissionModeTransition", setPermissionMode);
  container.register("CanUseToolCallback", canUseToolWithPermissionRequest);

  const liveConfigManager = new LiveConfigManager(container, {
    workdir,
    onReload: async () => {
      const models = configurationService.getConfiguredModels();
      callbacks.onConfiguredModelsChange?.(models);
      // Re-evaluate feature-gated tools (e.g. Artifact behind
      // enableArtifact) so toggling the flag applies without a restart.
      toolManager.reloadFeatureGatedTools();
      // Same gate for the builtin /artifact skill: refresh emits "refreshed"
      // so slash-command registration follows enableArtifact. Awaited (via the
      // awaited onReload) so skills are re-populated before Agent.create()
      // returns — otherwise callers right after create() could observe a
      // mid-refresh skill list.
      await skillManager.reloadFeatureGatedSkills().catch((error) => {
        logger.error("Failed to reload feature-gated skills:", error);
      });
    },
  });
  container.register("LiveConfigManager", liveConfigManager);

  // The turn-scoped configuration snapshot is held by LiveConfigManager (it owns
  // the turn boundaries and the live reload) and read by ConfigurationService's
  // resolve chain, so a mid-turn settings.json change applies from the next turn
  // instead of shifting values under the running one.
  configurationService.setTurnSnapshotSource(() =>
    liveConfigManager.getTurnSnapshot(),
  );

  // Wire up remote settings hot-update: when polling detects changed settings,
  // reload configuration so admin changes propagate to the running agent.
  // The callback strongly captures the per-agent LiveConfigManager, so it MUST
  // be unsubscribed in destroy() via teardown — otherwise the module-level
  // callback array pins the whole agent object graph.
  // Managed plugin config (enabledPlugins / marketplaces) last applied to the
  // plugin subsystem, keyed by a JSON signature: a synced change that touches
  // neither field must not bounce every plugin's MCP servers.
  const remoteAtSetup = remoteSettingsService.getRemoteSettingsSync();
  let managedPluginSignature = JSON.stringify([
    remoteAtSetup?.enabledPlugins ?? null,
    remoteAtSetup?.marketplaces ?? null,
  ]);

  teardowns.push(
    remoteSettingsService.onSettingsUpdate(async () => {
      await liveConfigManager.reload();

      // Managed settings also drive plugin installation and loading: a synced
      // change to `enabledPlugins` / `marketplaces` must re-read the plugins in
      // place, otherwise an admin push would only take effect after a restart
      // (spec enterprise server-managed-config「托管配置下发插件市场与启用列表」
      // 场景 1 与 3).
      const remote = remoteSettingsService.getRemoteSettingsSync();
      const signature = JSON.stringify([
        remote?.enabledPlugins ?? null,
        remote?.marketplaces ?? null,
      ]);
      if (signature === managedPluginSignature) {
        return;
      }
      managedPluginSignature = signature;
      await container.get<PluginManager>("PluginManager")?.reloadAllPlugins();
    }),
  );

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

  // Turn-scoped output-token ledger, shared by the main agent loop and every
  // workflow of the same turn (spec multi-agent/workflow.md 场景 5). Registered
  // before both AIManager (which counts into it) and WorkflowManager (which reads
  // it) so they resolve the same instance; subagent containers inherit it through
  // the container parent chain, so a workflow agent's tokens count too.
  container.register("TurnBudgetLedger", new TurnBudgetLedger());

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

  // Name → script resolution for `Workflow({name})`: plugin workflows and the
  // on-disk library share this one registry (spec workflow「把脚本存进库并按名字
  // 复用」/「调用插件携带的工作流」). Registered before PluginManager so plugin
  // loads can register into it.
  container.register("WorkflowRegistry", new WorkflowRegistry(workdir));

  const pluginManager = new PluginManager(container, { workdir });
  container.register("PluginManager", pluginManager);

  // Plugin MODS (spec ecosystem/plugin-mods.md): compilation and execution both
  // live in this process, so the host only ever receives an element tree. It
  // starts empty — `Agent.initialize` feeds it the loaded plugins once
  // InitializationService has finished, because mod files are discovered there.
  const modManager = new ModManager({
    sessionId: messageManager.getSessionId(),
    onPanelUpdate: (payload) => callbacks.onModPanelUpdate?.(payload),
    onStatus: (payload) => callbacks.onModStatus?.(payload),
    onToast: (payload) => callbacks.onModToast?.(payload),
    // `$.process.spawn` 的默认 cwd：与 Bash 工具的 spawn cwd 同口径，取「会动」
    // 的那个工作目录（容器 token `CurrentWorkdir`，`cd` 之后跟着变），不是会话
    // 起点也不是工作区根。
    workdir: () => container.get<string>("CurrentWorkdir") ?? workdir,
    // `$.session.id()` / `root()` / `model()`、`$.env.get`、`$.settings.read` 的
    // 数据源（spec「会话事实」「环境变量与设置」）。每个值住在不同的 manager 里，
    // 而 ModManager 在它们下面 —— 全都用惰性闭包取，与注册顺序无关。
    sessionFacts: {
      sessionId: () => messageManager.getSessionId(),
      // 会话工作根：`EnterWorktree` 会动、`cd` 不动（容器 token 语义见 workdir 规则）。
      workspaceRoot: () => container.get<string>("WorkspaceRoot") ?? workdir,
      model: () => aiManager.getModelConfig().model ?? "",
      // 这一刻有谁在画（spec「会话事实」「元素表按端分」）：宿主显式声明的
      // `renderSurfaces` 优先；没声明时按入口推导（桌面端画、其余不画）。数据源
      // 不是进程环境 —— 终端 CLI 的交互模式声明 `["terminal"]`，`wave -p` 不声明。
      surfaces: () =>
        container.get<readonly ModRenderSurface[] | undefined>(
          "RenderSurfaces",
        ) ??
        renderSurfacesOf(
          container.get<HostEntrypoint | undefined>("Entrypoint"),
        ),
      env: (name) => configurationService.getMergedEnv()[name],
      settings: async (query) => {
        const layer = configurationService.readSettingsLayer(
          query.source,
          // 项目级配置按「会话工作根」读：`cd` 过不该换成另一个项目的设置。
          container.get<string>("WorkspaceRoot") ?? workdir,
        );
        return query.key === undefined ? layer : layer[query.key];
      },
      // 用户轮数：只数真实输入，工具结果挂在 assistant 消息上、系统注入带
      // `isMeta`，两者都不算（spec「会话事实」）。
      turns: () => messageManager.countUserTurns(),
      // 仓库探测按「会话工作根」：`cd` 进子目录不该让插件以为换了仓库，进
      // 工作树是真的换了地方、该跟。
      repo: () =>
        detectSessionRepo(container.get<string>("WorkspaceRoot") ?? workdir),
      version: () => engineVersion(),
      // 三个只读清单（spec「配了哪些、能调什么、有谁在跑」）。每次都现取：
      // 插件在一次钩子里连读两次不该看到两个版本。
      configRows: () => {
        const workspaceRoot = container.get<string>("WorkspaceRoot") ?? workdir;
        const localKeys = new Set<string>();
        for (const source of MOD_SETTINGS_SOURCES) {
          const layer = configurationService.readSettingsLayer(
            source,
            workspaceRoot,
          );
          for (const key of Object.keys(layer)) localKeys.add(key);
        }
        return buildConfigRows({
          merged: configurationService.getCurrentConfiguration() as Record<
            string,
            unknown
          > | null,
          localKeys,
        });
      },
      toolInfos: () =>
        toolManager.list().map((tool) => ({
          name: tool.name,
          description: tool.config?.function?.description ?? "",
          // MCP 工具的名字由宿主编成 `mcp__<server>__<tool>`，这里按同一个
          // 约定反判，不去翻 MCP 的注册表。
          mcp: tool.name.startsWith("mcp__"),
        })),
      agentInfos: () => subagentManager.listModAgents(),
      // `$.session.messages()`：只递最近 N 条，形状换成 mods 面那一套
      // （spec「会话消息」）。上限在这里夹，runtime 不重复数一遍。
      sessionMessages: () =>
        toModSessionMessages(
          messageManager.getMessages().slice(-MOD_LIMITS.sessionMessages),
        ),
      // 影子的公共字段（spec「影子事件」）：转录路径与 settings 钩子收到的是
      // 同一个值；权限模式取当前生效的那一档。
      transcriptPath: () => messageManager.getTranscriptPath(),
      permissionMode: () =>
        permissionManager.getConfiguredPermissionMode() ?? "default",
    },
  });
  container.register("ModManager", modManager);

  // `$.ui.log` 的落点：会话的提示块（用户可见、随会话落盘、不进模型上下文）。
  modManager.setLogSink((text) => messageManager.addNoticeBlock(text, "info"));

  // `$.command.*` 的桥：命令表在 slashCommandManager，而「执行这条命令该问哪个
  // mod 的钩子」只有 modManager 知道。两边互相持有会成环，所以在这里组装。
  modManager.setCommandBridge({
    register: (input) => slashCommandManager.registerModCommand(input),
    unregister: (name) => slashCommandManager.unregisterModCommand(name),
    list: () => slashCommandManager.listCommandsForMods(),
    run: async (command, args) => {
      const commands = await slashCommandManager.getCommands();
      const target = commands.find((entry) => entry.name === command);
      if (!target) {
        // 建议按「不带斜杠的前缀」找：`$/command.run({ command: "pro" })` 该提示
        // `/probe`，而不是拿带斜杠的三个字符去比。
        const prefix = command.replace(/^\//, "").slice(0, 3);
        const suggestion = prefix
          ? commands
              .map((entry) => entry.name)
              .find((name) => name.startsWith(prefix))
          : undefined;
        throw new Error(
          `没有叫 /${command} 的命令${suggestion ? `（最接近的是 /${suggestion}）` : ""}`,
        );
      }
      await slashCommandManager.executeCommand(target.id, args);
    },
  });

  // `$.tool.register` 的桥：工具表在 toolManager，而「哪条 `tool.call` 认领这个
  // 工具」只有 modManager 知道，两边互相持有会成环（spec「把我们自己的工具交给
  // 模型」）。
  modManager.setToolBridge({
    register: (spec) => {
      if (toolManager.hasTool(spec.name)) {
        return { ok: false, reason: `工具名 ${spec.name} 已经被占用了` };
      }
      toolManager.register({
        name: spec.name,
        config: {
          type: "function",
          function: {
            name: spec.name,
            description: spec.description,
            parameters: spec.inputSchema,
          },
        },
        // 第三方工具与 MCP 同一条默认：进 `REPL` 池、模型按需取签名。要平铺就
        // 在 `$.tool.register` 里给 `isDeferred: false`（spec「把我们自己的工具
        // 交给模型」）。
        defer: spec.isDeferred !== false,
        // 执行体不在这里：调用进来时 `ToolManager` 先问 `tool.call`，插件给的
        // `{ result }` 直接就是结果。走到这里说明分流变了 —— 报错比给一个凭空
        // 的成功安全。
        execute: async () => ({
          success: false,
          content: "",
          error: `${spec.name} 是插件注册的工具，但没有一条 tool.call 认领这次调用`,
        }),
      });
      return { ok: true };
    },
    unregister: (name) => toolManager.unregister(name),
  });

  // `$.agent.spawn` 的桥：resolve 在子代理 **started** 之后，不等它跑完 —— 结果
  // 在它自己的 `turn.complete` 里（spec「派子代理」）。
  modManager.setAgentBridge({
    spawn: async (args) => {
      const requested = args.subagentType ?? "general-purpose";
      const configuration = await subagentManager.findSubagent(requested);
      if (!configuration) {
        const available = subagentManager
          .getConfigurations()
          .map((entry) => entry.name)
          .join(", ");
        throw new Error(
          `没有叫 ${requested} 的子代理${available ? `（可用的是 ${available}）` : ""}`,
        );
      }
      const instance = await subagentManager.createInstance(
        configuration,
        {
          description: args.description ?? args.prompt.slice(0, 80),
          prompt: args.prompt,
          subagent_type: configuration.name,
          ...(args.model === undefined ? {} : { model: args.model }),
          // 深度 1：这个子代理自己的 Agent 工具不再往下派（spec「派子代理」）。
          modSpawned: true,
        },
        // 后台起：`$.agent.spawn` 的语义是「起一个」，不是「跑一个等它」。
        true,
      );
      const settled = subagentManager.executeAgent(
        instance,
        args.prompt,
        undefined,
        true,
      );
      return {
        model: instance.model ?? aiManager.getModelConfig().model ?? "",
        agentId: instance.subagentId,
        settled,
      };
    },
  });

  // `$.model.complete` 的桥（spec「让模型替插件答一次」）：一次一问、不流式。
  // 门槛（allowlist / 额度 / 参数）在 modManager 那一侧就已经拦掉，到这里只负责
  // 「发一次请求、把 provider 的结局翻译成 CC 那四档」。
  modManager.setModelBridge({
    complete: async (request) => {
      // allowlist 与 `--model` 是同一份清单，外加**当前会话正在用的那个模型**：
      // 用户可以用 `--model` 指一个不在 `models` 目录里的名字，那时清单里没有
      // 它，「问一次当前模型」反而被拒就说不通了。
      const allowed = configurationService
        .getConfiguredModels()
        .map((entry) => entry.name);
      const currentModel = aiManager.getModelConfig().model;
      if (currentModel && !allowed.includes(currentModel)) {
        allowed.unshift(currentModel);
      }
      if (!allowed.includes(request.model)) {
        // allowlist 之外的名字不是「请求失败」，是根本没发这次请求：reject，不
        // 混进 `{ isAnswered: false }` 那个联合（spec 同段的分工）。
        throw new Error(
          `$.model.complete 的模型 ${request.model} 不在可用清单里（可用：${
            allowed.join(", ") || "无"
          }）`,
        );
      }
      const emptyUsage = {
        prompt: 0,
        completion: 0,
        cacheRead: 0,
        cacheCreation: 0,
      };
      try {
        // 配置必须按**请求的那个模型**解析：`callAgent` 用
        // `modelConfig.capabilities` 选协议分支与缓存标记，`modelConfig.options`
        // 还会把 `max_tokens` 铺在调用参数后面 —— 拿会话模型的配置发另一个模型
        // 的请求，缓存与 `maxTokens` 都会跟着错的那一套走。
        const result = await callAgent({
          gatewayConfig: aiManager.getGatewayConfig(),
          modelConfig: configurationService.resolveModelConfig(request.model),
          messages: [{ role: "user", content: request.prompt }],
          model: request.model,
          ...(request.system === undefined
            ? {}
            : { systemPrompt: request.system }),
          maxTokens: request.maxTokens,
          // 工具的 spawn cwd 同口径：「会动」的那个工作目录。
          workdir: container.get<string>("CurrentWorkdir") ?? workdir,
          sessionId: messageManager.getSessionId(),
          ...(request.signal === undefined
            ? {}
            : { abortSignal: request.signal }),
        });
        const usage =
          result.usage === undefined
            ? emptyUsage
            : {
                prompt: result.usage.prompt_tokens,
                completion: result.usage.completion_tokens,
                cacheRead: result.usage.cache_read_input_tokens ?? 0,
                cacheCreation: result.usage.cache_creation_input_tokens ?? 0,
              };
        // 这几次调用算进会话总量（spec「让模型替插件答一次」的「记账可见」）：
        // 不记的话用户的账单与 `$.session.usage()` 都对不上这些请求 —— 插件花
        // 的是用户的钱。
        addUsage({
          prompt_tokens: usage.prompt,
          completion_tokens: usage.completion,
          total_tokens: usage.prompt + usage.completion,
          model: request.model,
          operation_type: "agent",
          cache_read_input_tokens: usage.cacheRead,
          cache_creation_input_tokens: usage.cacheCreation,
        });
        const community = withCommunityUsage(usage, request.model);
        const text = result.content ?? "";
        return text.trim().length === 0
          ? { isAnswered: false, reason: "empty-reply", usage: community }
          : { isAnswered: true, text, usage: community };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const usage = withCommunityUsage(emptyUsage, request.model);
        // 我们自己取消的（`timeoutMs` 到期、插件被卸载）落在 `aborted`，其余算
        // `api-error` 并带上 HTTP 状态（拿不到响应时是 null）。
        if (request.signal?.aborted) {
          return { isAnswered: false, reason: "aborted", usage };
        }
        const status = errorStatusCodeOf(error);
        logger.debug(`[Wave] $.model.complete 失败：${message}`);
        return {
          isAnswered: false,
          reason: "api-error",
          status,
          error: message,
          usage,
        };
      }
    },
  });

  const bashModeManager = new BashModeManager(container, { workdir });
  container.register("BashModeManager", bashModeManager);

  const cronManager = new CronManager(container, messageManager.getSessionId());
  container.register("CronManager", cronManager);
  cronManager.start();

  // Artifact comment watching: one manager per agent, so its streams (and the
  // cursors they keep) die with the session instead of accumulating in a
  // process-wide registry.
  const pageWatchManager = new PageWatchManager(container);
  container.register("PageWatchManager", pageWatchManager);

  const workflowManager = new WorkflowManager(container);
  container.register("WorkflowManager", workflowManager);

  return {
    container,
    teardown: () => {
      for (const unsubscribe of teardowns) {
        unsubscribe();
      }
    },
  };
}
