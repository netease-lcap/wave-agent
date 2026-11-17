import { randomUUID } from "crypto";
import * as fs from "fs";
import * as path from "path";
import type { SubagentConfiguration } from "../utils/subagentParser.js";
import type { Message, NoticeLevel, Usage } from "../types/index.js";
import type {
  ModAgentInfo,
  ModAgentStatus,
  ModClassicSubagentStartEvent,
  ModClassicSubagentStopEvent,
  ModClassicTrigger,
} from "../types/mods.js";
import { AIManager } from "./aiManager.js";
import { MessageManager } from "./messageManager.js";
import { ToolManager } from "./toolManager.js";
import {
  AGENT_TOOL_NAME,
  ENTER_WORKTREE_TOOL_NAME,
  EXIT_WORKTREE_TOOL_NAME,
  TASK_CREATE_TOOL_NAME,
  TASK_GET_TOOL_NAME,
  TASK_LIST_TOOL_NAME,
  TASK_UPDATE_TOOL_NAME,
} from "../constants/tools.js";
import {
  addConsolidatedAbortListener,
  createAbortPromise,
} from "../utils/abortUtils.js";
import { BackgroundTaskManager } from "./backgroundTaskManager.js";
import { resolveTempDir } from "../utils/tempDir.js";
import { MessageQueue } from "./messageQueue.js";
import { logger } from "../utils/globalLogger.js";
import { taskNotificationToXml } from "../utils/notificationXml.js";
import {
  UserMessageParams,
  cloneMessage,
  type ToolBlockUpdateCallbackParams,
} from "../utils/messageOperations.js";

import { Container } from "../utils/container.js";
import { AsyncWorkRegistry } from "../utils/asyncWorkRegistry.js";
import type { PermissionManager } from "./permissionManager.js";
import type { PermissionMode } from "../types/permissions.js";
import { ConfigurationService } from "../services/configurationService.js";
import { supportsVision } from "../utils/modelCapabilities.js";
import {
  countWorktreeChanges,
  createWorktree,
  generateEphemeralWorktreeName,
  getHeadCommit,
  performPostCreationSetup,
  removeWorktree,
} from "../utils/worktreeUtils.js";
import { describeWorktreeRemovalOutcome } from "../utils/worktreeRemoval.js";
import { getGitMainRepoRoot, resolveGitDir } from "../utils/gitUtils.js";
import type { WorktreeSession } from "../utils/worktreeSession.js";
import {
  executeWorktreeCreateHook,
  executeWorktreeRemoveHook,
  hasWorktreeCreateHook,
  hasWorktreeRemoveHook,
  type WorktreeHookContext,
} from "../services/worktreeHooks.js";
import type { HookManager } from "./hookManager.js";

export interface SubagentManagerCallbacks {
  // Granular subagent message callbacks (009-subagent)
  /** Triggered when subagent adds user message */
  onSubagentUserMessageAdded?: (
    subagentId: string,
    params: UserMessageParams,
  ) => void;
  /** Triggered when subagent creates assistant message */
  onSubagentAssistantMessageAdded?: (
    subagentId: string,
    messageId: string,
  ) => void;
  /** Triggered during subagent content streaming updates */
  onSubagentAssistantContentUpdated?: (params: {
    subagentId: string;
    messageId: string;
    chunk: string;
    stage: "streaming" | "end";
  }) => void;
  /** Triggered during subagent reasoning streaming updates */
  onSubagentAssistantReasoningUpdated?: (params: {
    subagentId: string;
    messageId: string;
    chunk: string;
    stage: "streaming" | "end";
  }) => void;
  /** Triggered when subagent tool block is updated */
  onSubagentToolBlockUpdated?: (
    subagentId: string,
    params: ToolBlockUpdateCallbackParams,
  ) => void;
  /** Triggered when subagent messages change */
  onSubagentMessagesChange?: (subagentId: string, messages: Message[]) => void;
  /** Triggered when subagent latest total tokens change */
  onSubagentLatestTotalTokensChange?: (
    subagentId: string,
    tokens: number,
  ) => void;
}

/**
 * Worktree a subagent runs in when worktree isolation is in effect
 * (`isolation: worktree` in its definition or an explicit call parameter).
 */
export interface SubagentWorktreeState {
  session: WorktreeSession;
  /**
   * HEAD of the worktree right after creation. Commit counting starts here —
   * NOT at the parent session's HEAD, which can differ because
   * `worktree.baseRef: fresh` branches from `origin/<default>`.
   */
  baselineHead?: string;
}

export interface SubagentInstance {
  subagentId: string;
  configuration: SubagentConfiguration;
  aiManager: AIManager;
  messageManager: MessageManager;
  toolManager: ToolManager;
  permissionManager: PermissionManager;
  backgroundTaskManager: BackgroundTaskManager;
  status: "initializing" | "active" | "completed" | "error" | "aborted";
  messages: Message[];
  usedTools: {
    name: string;
    parameters: string;
    compactParams?: string;
    stage?: string;
  }[]; // Track tools with display info
  subagentType: string; // Store the subagent type for hook context
  description: string; // Store the AI-generated description
  allowedTools?: string[]; // Optional permission rules (e.g. git:*)
  backgroundTaskId?: string; // ID of the background task if transitioned
  onUpdate?: () => void; // Optional callback for real-time updates
  model?: string; // Optional model override
  logStream?: fs.WriteStream; // Optional log stream for background tasks
  worktree?: SubagentWorktreeState; // Set when the subagent runs in its own worktree
  worktreeSummary?: string; // Worktree report appended to the final result
  /**
   * Tokens this subagent spent itself, reported as `<usage>`. A fork inherits
   * its parent's conversation as history, not as work it did, so only turns
   * that run after the snapshot are counted here.
   */
  usageTotals: { totalTokens: number };
  /**
   * `classic.SubagentStop` 的收尾事件已经派发过。收尾可能不止一次（被
   * `additionalContext` 续跑后再收尾），这个标记只回答「派发过没有」—— 实例释放
   * 时据此决定要不要为此前没走到收尾的出错 / 中止路径补报一次。
   */
  modStopDispatched?: boolean;
}

export interface SubagentManagerOptions {
  workdir: string;
  callbacks?: SubagentManagerCallbacks; // Use SubagentManagerCallbacks instead of parentCallbacks
  onUsageAdded?: (usage: Usage) => void;
  stream: boolean;
}

/**
 * Tool calls in a message list — the `<usage>` counter's unit. Tolerates a
 * missing list: the counter runs on the notification path, which must not be
 * the thing that throws when a subagent's history is unavailable.
 */
function countToolBlocks(messages: Message[] | undefined): number {
  if (!messages) return 0;
  let count = 0;
  for (const message of messages) {
    for (const block of message.blocks) {
      if (block.type === "tool") count++;
    }
  }
  return count;
}

export class SubagentManager {
  private instances = new Map<string, SubagentInstance>();
  /**
   * Worktree state keyed by subagent id, kept outside the instance so cleanup
   * can still run after the instance is released (abort, stop, error paths).
   */
  private worktreeStates = new Map<string, SubagentWorktreeState>();
  private cachedConfigurations: SubagentConfiguration[] | null = null;

  private workdir: string;
  private callbacks?: SubagentManagerCallbacks; // Use SubagentManagerCallbacks instead of parentCallbacks
  private onUsageAdded?: (usage: Usage) => void;
  private container: Container;
  private stream: boolean;

  constructor(container: Container, options: SubagentManagerOptions) {
    this.container = container;
    this.workdir = options.workdir;
    this.callbacks = options.callbacks; // Store SubagentManagerCallbacks
    this.onUsageAdded = options.onUsageAdded;
    this.stream = options.stream;
  }

  private get configurationService(): ConfigurationService {
    return this.container.get<ConfigurationService>("ConfigurationService")!;
  }

  private get asyncWorkRegistry(): AsyncWorkRegistry | undefined {
    return this.container.get<AsyncWorkRegistry>("AsyncWorkRegistry");
  }

  /**
   * Initialize the SubagentManager by loading and caching configurations
   */
  async initialize(): Promise<void> {
    await this.loadConfigurations();

    // Hook into parent PermissionManager's update methods to propagate rules to subagents
    const parentPm = this.container.get<PermissionManager>("PermissionManager");
    if (
      parentPm &&
      typeof parentPm.updateAllowedRules === "function" &&
      typeof parentPm.updateDeniedRules === "function" &&
      typeof parentPm.updateAdditionalDirectories === "function"
    ) {
      const origUpdateAllowed = parentPm.updateAllowedRules.bind(parentPm);
      const origUpdateDenied = parentPm.updateDeniedRules.bind(parentPm);
      const origUpdateDirs =
        parentPm.updateAdditionalDirectories.bind(parentPm);

      parentPm.updateAllowedRules = (rules: string[]) => {
        origUpdateAllowed(rules);
        this.syncPermissionRulesToSubagents();
      };
      parentPm.updateDeniedRules = (rules: string[]) => {
        origUpdateDenied(rules);
        this.syncPermissionRulesToSubagents();
      };
      parentPm.updateAdditionalDirectories = (directories: string[]) => {
        origUpdateDirs(directories);
        this.syncPermissionRulesToSubagents();
      };
    }
  }

  /**
   * Sync parent permission rules to all running subagents
   */
  private syncPermissionRulesToSubagents(): void {
    const parentPm = this.container.get<PermissionManager>("PermissionManager");
    if (!parentPm) return;

    for (const instance of this.instances.values()) {
      instance.permissionManager.updateAllowedRules(parentPm.getAllowedRules());
      instance.permissionManager.updateDeniedRules(parentPm.getDeniedRules());
      instance.permissionManager.updateAdditionalDirectories(
        parentPm.getAdditionalDirectories(),
      );
    }
  }

  /**
   * Load all available subagent configurations and cache them
   */
  async loadConfigurations(): Promise<SubagentConfiguration[]> {
    if (this.cachedConfigurations === null) {
      const { loadSubagentConfigurations } = await import(
        "../utils/subagentParser.js"
      );
      this.cachedConfigurations = await loadSubagentConfigurations(
        this.workdir,
        this.getMergedEnv(),
      );
    }
    return this.cachedConfigurations;
  }

  /**
   * Rebuild the cached subagent configurations. Called after settings.json
   * env becomes available (post loadMergedConfiguration) so conditional
   * builtin subagents (e.g. `model: visionModel` requiring WAVE_VISION_MODEL)
   * register correctly. Plugin agents are preserved across the rebuild.
   */
  async refreshConfigurations(): Promise<SubagentConfiguration[]> {
    // Preserve plugin agents (namespaced `pluginName:agentName`) across the rebuild
    const pluginAgents = (this.cachedConfigurations ?? []).filter((config) =>
      config.name.includes(":"),
    );
    this.cachedConfigurations = null;
    await this.loadConfigurations();
    for (const agent of pluginAgents) {
      this.cachedConfigurations!.push(agent);
    }
    // Re-sort by priority then name (matches registerPluginAgents)
    this.cachedConfigurations!.sort((a, b) => {
      if (a.priority !== b.priority) return a.priority - b.priority;
      return a.name.localeCompare(b.name);
    });
    return this.cachedConfigurations!;
  }

  /**
   * Get the merged environment (OS env overlaid with settings.json env) used
   * for conditional subagent registration (e.g. WAVE_VISION_MODEL).
   */
  private getMergedEnv(): Record<string, string> {
    return (
      this.configurationService?.getMergedEnv?.() ??
      (process.env as Record<string, string>)
    );
  }

  /**
   * Delete a user-level or project-level subagent by removing its markdown
   * file. Builtin and plugin agents are read-only and cannot be deleted.
   * @param name - The subagent name as shown in configurations
   * @returns true if the subagent was deleted
   */
  async deleteSubagent(name: string): Promise<boolean> {
    const configs = this.cachedConfigurations ?? [];
    const config = configs.find((c) => c.name === name);
    if (!config) {
      return false;
    }

    // Builtin and plugin agents are read-only
    if (config.scope !== "user" && config.scope !== "project") {
      return false;
    }

    const { unlink } = await import("fs/promises");
    await unlink(config.filePath);

    // Drop the deleted agent from the cached configurations immediately.
    // A later refreshConfigurations() re-scans the filesystem and reflects
    // the deletion persistently.
    this.cachedConfigurations = configs.filter((c) => c.name !== name);

    logger?.debug(`Deleted subagent '${name}' at ${config.filePath}`);
    return true;
  }

  /**
   * Get cached configurations synchronously (must call loadConfigurations first)
   */
  getConfigurations(): SubagentConfiguration[] {
    if (this.cachedConfigurations === null) {
      throw new Error(
        "SubagentManager not initialized. Call loadConfigurations() first.",
      );
    }
    const mainModelReadsImages = this.mainModelSupportsVision();
    return this.cachedConfigurations.filter(
      (config) => !this.isRedundantVisionFallback(config, mainModelReadsImages),
    );
  }

  /**
   * Whether the session's main model reads images itself. Declarative and
   * opt-out — the same `capabilities.vision` the image conversion path reads, so
   * undeclared means "sees images directly".
   *
   * Resolved live rather than cached on purpose: the model can be switched
   * mid-session (`Agent.setModel`) or hot-reloaded from settings, and the
   * builtin vision subagent's availability has to follow the model actually in
   * use, not the one current when the configurations were scanned.
   */
  private mainModelSupportsVision(): boolean {
    const configurationService = this.container.get<ConfigurationService>(
      "ConfigurationService",
    );
    return supportsVision(
      configurationService?.resolveModelConfig?.(undefined, undefined)
        ?.capabilities,
    );
  }

  /**
   * The builtin `vision` subagent (`model: visionModel`, see
   * `builtin/subagents.ts`) exists only as a fallback for a main model that
   * cannot read images. When the main model can, that entry goes away: it would
   * add a pointless delegation target to every turn's tool description and
   * invite a needless round-trip.
   *
   * Scoped to `builtin` on purpose — a user-written subagent that names a vision
   * model is an explicit choice and is never dropped.
   */
  private isRedundantVisionFallback(
    config: SubagentConfiguration,
    mainModelReadsImages: boolean,
  ): boolean {
    return (
      config.scope === "builtin" &&
      config.model === "visionModel" &&
      mainModelReadsImages
    );
  }

  /**
   * Find subagent by exact name match
   */
  async findSubagent(name: string) {
    const configuration = await this.resolveSubagent(name);
    if (!configuration) return configuration;
    // Same gate as the list: a subagent that is not offered must not be
    // spawnable by name either, or "not enabled" would be a lie — the builtin
    // definition file is always on disk.
    return this.isRedundantVisionFallback(
      configuration,
      this.mainModelSupportsVision(),
    )
      ? null
      : configuration;
  }

  private async resolveSubagent(name: string) {
    // Check cached configurations first (includes plugin agents)
    if (this.cachedConfigurations !== null) {
      const cached = this.cachedConfigurations.find(
        (config) => config.name === name,
      );
      if (cached) return cached;
    }
    // Fall back to filesystem scan for non-plugin agents
    const { findSubagentByName } = await import("../utils/subagentParser.js");
    return findSubagentByName(name, this.workdir, this.getMergedEnv());
  }

  /**
   * Register plugin agents into the cached configurations.
   * Names each agent as `pluginName:agentName` to avoid collisions.
   */
  registerPluginAgents(
    pluginName: string,
    agents: SubagentConfiguration[],
  ): void {
    if (this.cachedConfigurations === null) {
      // Should not happen if initialization order is correct
      this.cachedConfigurations = [];
    }

    // Remove any previously registered agents for this plugin (by name prefix)
    this.cachedConfigurations = this.cachedConfigurations.filter(
      (config) => !config.name.startsWith(`${pluginName}:`),
    );

    for (const agent of agents) {
      const namespacedName = `${pluginName}:${agent.name}`;
      const namespacedAgent: SubagentConfiguration = {
        ...agent,
        name: namespacedName,
        // Safety net: substitute any remaining ${WAVE_PLUGIN_ROOT} placeholders
        systemPrompt: agent.systemPrompt.replace(
          /\$\{WAVE_PLUGIN_ROOT\}/g,
          agent.pluginRoot ?? "",
        ),
      };
      this.cachedConfigurations!.push(namespacedAgent);
    }

    // Re-sort by priority then name
    this.cachedConfigurations!.sort((a, b) => {
      if (a.priority !== b.priority) return a.priority - b.priority;
      return a.name.localeCompare(b.name);
    });
  }

  /**
   * Drop every subagent contributed by a plugin, addressed by its plugin name.
   * Running instances are deliberately left alone — an in-place reload must not
   * interrupt work already in flight. Called by the plugin reload path before
   * re-registering.
   * @returns the number of configurations removed
   */
  unregisterPluginAgents(pluginName: string): number {
    if (this.cachedConfigurations === null) {
      return 0;
    }
    const prefix = `${pluginName}:`;
    const before = this.cachedConfigurations.length;
    this.cachedConfigurations = this.cachedConfigurations.filter(
      (config) => !config.name.startsWith(prefix),
    );
    return before - this.cachedConfigurations.length;
  }

  /**
   * Create a new subagent instance with isolated managers
   */
  async createInstance(
    configuration: SubagentConfiguration,
    parameters: {
      description: string;
      prompt: string;
      subagent_type: string;
      allowedTools?: string[];
      model?: string;
      stream?: boolean;
      permissionModeOverride?: PermissionMode;
      maxTurns?: number;
      /** Run this instance in its own temporary git worktree. */
      worktreeIsolation?: boolean;
      /**
       * Started by a plugin-mod's `$.agent.spawn`. The child gets a
       * `ModAgentDepth` of its own so its Agent tool refuses to spawn again —
       * spec「派子代理」的「mod 派的子代理不再派（深度 1），防递归」。
       */
      modSpawned?: boolean;
      /**
       * Start from a snapshot of the parent session's messages instead of from
       * nothing — the fork shape `/subtask` uses. See
       * {@link seedFromParentContext} for the isolation boundary.
       */
      inheritParentContext?: boolean;
    },
    runInBackground?: boolean,
    onUpdate?: () => void,
  ): Promise<SubagentInstance> {
    const parentToolManager = this.container.get<ToolManager>("ToolManager");

    if (!parentToolManager) {
      throw new Error(
        "SubagentManager not properly initialized - ToolManager not found in container",
      );
    }

    const subagentId = randomUUID();

    // Create a child container for the subagent to isolate its managers
    const subagentContainer = this.container.createChild();

    // Register an independent MessageQueue so the subagent's AIManager drains its
    // own (empty) queue instead of falling back to the parent container's queue.
    // Without this, concurrent background subagents steal sibling completion
    // notifications from the parent queue, causing the main agent to exit early.
    subagentContainer.register("MessageQueue", new MessageQueue());

    // Deliberately shadow the parent ReversionManager with `undefined` so the
    // subagent resolves no reversion manager instead of falling back to the
    // parent's. Subagent Write/Edit must not be recorded into the main agent's
    // file_history buffer — this mirrors Claude Code's explicit isolation for
    // forked agents (`updateFileHistoryState: () => {}` in forkedAgent.ts).
    // Without this, the subagent drains the SHARED parent buffer into its own
    // transient messages (discarded on cleanup), leaving orphaned snapshot
    // files on disk and racing the main agent's own drain. All ReversionManager
    // consumers are truthiness-guarded, so resolving to `undefined` is safe.
    subagentContainer.register("ReversionManager", undefined);

    // A mod-spawned subagent is one level deep: its own Agent tool reads this and
    // refuses to delegate again (spec「派子代理」的深度 1)。
    if (parameters.modSpawned) {
      const depth = this.container.get<number>("ModAgentDepth") ?? 0;
      subagentContainer.register("ModAgentDepth", depth + 1);
    }

    // Worktree isolation must be wired before any manager is constructed: the
    // child container's "CurrentWorkdir" slot is what AIManager resolves at run time,
    // and PermissionManager snapshots it in its constructor.
    let subagentWorkdir = this.workdir;
    let worktreeState: SubagentWorktreeState | undefined;
    if (parameters.worktreeIsolation) {
      try {
        worktreeState = await this.createSubagentWorktree();
      } catch (error) {
        throw new Error(
          `Cannot run subagent in an isolated worktree: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
      subagentWorkdir = worktreeState.session.worktreePath;
      this.worktreeStates.set(subagentId, worktreeState);
      subagentContainer.register("CurrentWorkdir", subagentWorkdir);
      // The child's own worktree state (not the parent session's) drives the
      // worktree write guard and EnterWorktree's "already in a worktree" check.
      subagentContainer.register("WorktreeSession", worktreeState.session);
    }

    try {
      // Register a modified AgentOptions without onLoadingChange to prevent subagent loading
      // from affecting the parent agent's loading state
      const parentOptions =
        this.container.get<import("../types/agent.js").AgentOptions>(
          "AgentOptions",
        );
      if (parentOptions) {
        const subagentOptions: import("../types/agent.js").AgentOptions = {
          ...parentOptions,
          defaultHeaders: {
            ...parentOptions.defaultHeaders,
            ...parentOptions.subagentHeaders?.[parameters.subagent_type],
          },
          callbacks: {
            ...parentOptions.callbacks,
            onLoadingChange: undefined,
          },
        };
        subagentContainer.register("AgentOptions", subagentOptions);
      }

      // Create isolated PermissionManager for the subagent
      const { PermissionManager } = await import("./permissionManager.js");
      const parentPermissionManager =
        this.container.get<PermissionManager>("PermissionManager");
      const subagentPermissionManager = new PermissionManager(
        subagentContainer,
        {
          // `tool.check` 的 `e.agentId`：子代理发起的调用要能被插件认出来
          // （spec「第二判定源」）；主会话那个 PermissionManager 不带这一项。
          agentId: subagentId,
          configuredPermissionMode:
            parameters.permissionModeOverride ??
            parentPermissionManager?.getConfiguredPermissionMode(),
          // Inherit the parent session's bypass authorization: the subagent is
          // created mid-session, so re-deriving it from its own mode would
          // (wrongly) deny an authorized session's plan-mode subagent.
          bypassAuthorization:
            parentPermissionManager?.getBypassAuthorization?.(),
          allowedRules: parentPermissionManager?.getAllowedRules(),
          deniedRules: parentPermissionManager?.getDeniedRules(),
          instanceAllowedRules:
            parentPermissionManager?.getInstanceAllowedRules?.(),
          instanceDeniedRules: [
            ...(parentPermissionManager?.getInstanceDeniedRules?.() || []),
            AGENT_TOOL_NAME, // Always deny Agent tool in subagents to prevent recursion
            // Deny Task tools in subagents — they share the parent's TaskManager
            // and could mutate the main agent's task list
            TASK_CREATE_TOOL_NAME,
            TASK_GET_TOOL_NAME,
            TASK_UPDATE_TOOL_NAME,
            TASK_LIST_TOOL_NAME,
            // An isolated subagent lives in a worktree owned by this manager: it
            // must not leave or delete it mid-run (the parent handles cleanup).
            ...(parameters.worktreeIsolation
              ? [ENTER_WORKTREE_TOOL_NAME, EXIT_WORKTREE_TOOL_NAME]
              : []),
          ],
          additionalDirectories:
            parentPermissionManager?.getAdditionalDirectories(),
          instanceAdditionalDirectories:
            parentPermissionManager?.getInstanceAdditionalDirectories?.(),
          systemAdditionalDirectories:
            parentPermissionManager?.getSystemAdditionalDirectories(),
          planFilePath: parentPermissionManager?.getPlanFilePath(),
        },
      );
      subagentContainer.register(
        "PermissionManager",
        subagentPermissionManager,
      );

      // Register the permission mode override in the subagent container so it
      // shadows the inherited parent value during tool execution
      if (parameters.permissionModeOverride) {
        subagentContainer.register(
          "PermissionMode",
          parameters.permissionModeOverride,
        );
      }

      // Add temporary permission rules if provided
      if (parameters.allowedTools) {
        logger.debug(
          `Adding ${parameters.allowedTools.length} temporary permission rules to subagent ${subagentId}`,
          { rules: parameters.allowedTools },
        );
        subagentPermissionManager.addTemporaryRules(parameters.allowedTools);
      }

      // Create isolated MessageManager for the subagent
      const subagentCallbacks = this.createSubagentCallbacks(subagentId);

      const messageManager = new MessageManager(subagentContainer, {
        callbacks: subagentCallbacks,
        workdir: subagentWorkdir,
        sessionType: "subagent",
        subagentType: parameters.subagent_type,
      });
      subagentContainer.register("MessageManager", messageManager);

      // Fork context has to land before `internalExecute` appends the task
      // prompt, so the inherited conversation reads as history that leads up to
      // the task rather than as something the subagent did itself.
      if (parameters.inheritParentContext) {
        this.seedFromParentContext(messageManager);
      }

      // Create isolated ToolManager for the subagent to ensure it uses the subagent's PermissionManager
      const toolManager = new ToolManager({
        container: subagentContainer,
        tools: configuration.tools,
        disallowedTools: configuration.disallowedTools,
      });
      toolManager.initializeBuiltInTools();
      subagentContainer.register("ToolManager", toolManager);

      // Create isolated AIManager for the subagent
      //
      // Its usage is tallied per instance on the way to the parent's own
      // counter: `<usage>` in the completion notification reports what *this*
      // subagent spent, which is not the same as what the parent session owes.
      const usageTotals = { totalTokens: 0 };
      const aiManager = new AIManager(subagentContainer, {
        workdir: subagentWorkdir,
        systemPrompt: configuration.systemPrompt,
        subagentType: parameters.subagent_type, // Pass subagent type for hook context
        modelOverride: parameters.model || configuration.model, // Pass model override
        stream: parameters.stream ?? this.stream, // Pass streaming mode flag
        maxTurns: parameters.maxTurns, // Pass maxTurns limit
        omitAgentsMd: configuration.omitAgentsMd, // Start without project/user memory
        subagentId,
        // 收尾事件 `classic.SubagentStop` 的 `agent_transcript_path`：只有跑在后台、
        // 宿主为它开了日志流的子代理才有，所以每次现取（logStream 在后台化时才建）。
        subagentTranscriptPath: () => {
          const path = this.instances.get(subagentId)?.logStream?.path;
          return typeof path === "string" ? path : undefined;
        },
        // 收尾事件已经派发过 ⇒ 实例释放时不再补报（补报只给出错 / 中止路径）。
        onSubagentStopDispatched: () => {
          const dispatched = this.instances.get(subagentId);
          if (dispatched) dispatched.modStopDispatched = true;
        },
        callbacks: {
          onUsageAdded: (usage) => {
            usageTotals.totalTokens += usage.total_tokens;
            this.onUsageAdded?.(usage);
          },
        },
      });
      subagentContainer.register("AIManager", aiManager);

      // Create isolated BackgroundTaskManager for the subagent/forked agent
      const subagentBackgroundTaskManager = new BackgroundTaskManager(
        subagentContainer,
        {
          workdir: subagentWorkdir,
        },
      );
      subagentContainer.register(
        "BackgroundTaskManager",
        subagentBackgroundTaskManager,
      );

      const instance: SubagentInstance = {
        subagentId,
        configuration,
        aiManager,
        messageManager,
        toolManager,
        permissionManager: subagentPermissionManager,
        backgroundTaskManager: subagentBackgroundTaskManager,
        status: "initializing",
        messages: [],
        usedTools: [], // Initialize usedTools
        subagentType: parameters.subagent_type, // Store the subagent type
        description: parameters.description, // Store the AI-generated description
        allowedTools: parameters.allowedTools, // Store optional permission rules
        model: parameters.model, // Store optional model override
        onUpdate,
        worktree: worktreeState,
        usageTotals,
      };

      this.instances.set(subagentId, instance);

      // 影子事件 `classic.SubagentStart`（spec「影子事件」）：实例建好就报。只
      // 读，返回值（CC 的 `additionalContext`）不收 —— 那会改子代理的上下文。
      // 载荷照 CC：只有两个字段，`description` 是我们自造的（CC 的 Start 没有
      // 它），去掉免得插件按 CC 的形状写时拿到一个多余的键。
      this.notifyMods("classic.SubagentStart", {
        agent_id: subagentId,
        agent_type: parameters.subagent_type,
      });

      return instance;
    } catch (error) {
      // Roll back a worktree we created if the instance could not be built.
      await this.finalizeWorktree(subagentId);
      throw error;
    }
  }

  /**
   * Give a freshly created subagent a copy of the parent session's messages as
   * its starting history ("fork" subagents — `/subtask`).
   *
   * This method *is* the isolation boundary between the two sessions, so the
   * three properties below are the contract, not implementation detail:
   *
   * - **Snapshot, not a view.** Each message is cloned (`cloneMessage`), so the
   *   parent can keep streaming, finalize a block or update a tool result
   *   without any of it showing up in the subagent's list — and everything the
   *   subagent appends stays in its own manager. Neither side ever sees the
   *   other's messages; the only thing that crosses back is the task
   *   notification `internalExecute` enqueues when the subagent finishes.
   * - **History, not execution.** Tool blocks come over as finished history
   *   (`stage: "end"` with their results), which is exactly what the API
   *   conversion turns into tool calls plus matching tool results. No tool is
   *   re-run here.
   * - **Taken once.** The copy is made at creation time; messages the parent
   *   appends while the subagent runs are deliberately not picked up.
   *
   * `countLifetime: false` because this is one of the wholesale handovers the
   * list documents (session restore, compaction, rewind): the inherited rounds
   * belong to the parent session's lifetime totals, not to this subagent's.
   */
  private seedFromParentContext(target: MessageManager): void {
    const parentMessages = this.container.has("MessageManager")
      ? this.container.get<MessageManager>("MessageManager")
      : undefined;
    if (!parentMessages) {
      return;
    }
    target.setMessages(parentMessages.getMessages().map(cloneMessage), {
      countLifetime: false,
    });
  }

  /**
   * Create the temporary worktree an isolated subagent runs in. Mirrors
   * EnterWorktree: `WorktreeCreate` hook first (replace semantics, path from
   * the hook's stdout), git otherwise.
   *
   * The `sa-` name prefix is what marks the worktree as wave's own throwaway:
   * cleanup of a subagent that never reaches `finalizeWorktree` (Ctrl+C, crash,
   * host kill) finds it by that prefix alone — see utils/worktreeCleanup.ts.
   */
  private async createSubagentWorktree(): Promise<SubagentWorktreeState> {
    const name = generateEphemeralWorktreeName();
    const hookConfiguration = this.hookManager?.getConfiguration();

    if (hasWorktreeCreateHook(hookConfiguration)) {
      const { worktreePath } = await executeWorktreeCreateHook(
        name,
        hookConfiguration,
        this.worktreeHookContext(),
      );
      const session: WorktreeSession = {
        originalCwd: this.workdir,
        worktreePath,
        worktreeBranch: "",
        worktreeName: name,
        isNew: true,
        // Hook-based worktrees may live outside git; repoRoot is only used to
        // scope the worktree write guard, so `getGitMainRepoRoot`'s non-repo
        // fallback (the workdir itself) is exactly what we want here.
        repoRoot: getGitMainRepoRoot(this.workdir),
        hookBased: true,
      };
      return { session, baselineHead: this.readHead(worktreePath) };
    }

    // Checked through `resolveGitDir` (walking up from the workdir) rather than
    // `getGitMainRepoRoot`, which never reports "not a repo" — it falls back to
    // the cwd, so the delegation would fail later inside `git rev-parse` with an
    // opaque "Command failed" instead of this actionable message.
    if (!resolveGitDir(this.workdir)) {
      throw new Error(
        "not in a git repository and no WorktreeCreate hook is configured. Configure WorktreeCreate/WorktreeRemove hooks in settings.json to isolate subagents with another VCS.",
      );
    }

    const baseRef = this.container.has("ConfigurationService")
      ? this.configurationService.resolveWorktreeBaseRef()
      : undefined;
    const worktreeInfo = createWorktree(
      name,
      getGitMainRepoRoot(this.workdir),
      { baseRef },
    );

    if (worktreeInfo.isNew) {
      try {
        await performPostCreationSetup(
          worktreeInfo.path,
          worktreeInfo.repoRoot,
        );
      } catch (error) {
        logger?.warn("Subagent worktree post-creation setup failed:", error);
      }
    }

    const session: WorktreeSession = {
      originalCwd: this.workdir,
      worktreePath: worktreeInfo.path,
      worktreeBranch: worktreeInfo.branch,
      worktreeName: worktreeInfo.name,
      isNew: worktreeInfo.isNew,
      repoRoot: worktreeInfo.repoRoot,
      originalHeadCommit: worktreeInfo.originalHeadCommit,
    };
    return { session, baselineHead: this.readHead(worktreeInfo.path) };
  }

  private get hookManager(): HookManager | undefined {
    return this.container.get<HookManager>("HookManager");
  }

  /**
   * Context handed to WorktreeCreate/WorktreeRemove hooks. `projectDir` stays
   * the parent session's working directory, mirroring EnterWorktree.
   */
  private worktreeHookContext(): WorktreeHookContext {
    const messageManager = this.container.has("MessageManager")
      ? this.container.get<MessageManager>("MessageManager")
      : undefined;
    const env =
      (this.container.has("ConfigurationService")
        ? this.configurationService.getMergedEnv()
        : undefined) ?? {};
    return {
      projectDir: this.workdir,
      sessionId: messageManager?.getSessionId() ?? "",
      transcriptPath: messageManager?.getTranscriptPath() ?? "",
      env: Object.fromEntries(
        Object.entries(env).filter(([, value]) => value !== undefined),
      ) as Record<string, string>,
    };
  }

  private readHead(dir: string): string | undefined {
    try {
      return getHeadCommit(dir);
    } catch {
      return undefined;
    }
  }

  /**
   * Settle the subagent's worktree: remove it when it has no changes, keep it
   * otherwise. Idempotent — the state entry is claimed before any await, so
   * overlapping completion/abort paths cannot double-clean. Returns the report
   * appended to the subagent's result (undefined when there is no worktree).
   */
  private async finalizeWorktree(
    subagentId: string,
  ): Promise<string | undefined> {
    const state = this.worktreeStates.get(subagentId);
    if (!state) {
      return undefined;
    }
    this.worktreeStates.delete(subagentId);

    let summary: string;
    try {
      summary = await this.releaseSubagentWorktree(state);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger?.warn(
        `Failed to finalize subagent worktree ${state.session.worktreePath}: ${message}`,
      );
      summary = `[worktree] ran in ${state.session.worktreePath}; cleanup failed (${message}) — inspect and remove it manually.`;
    }

    const instance = this.instances.get(subagentId);
    if (instance) {
      instance.worktreeSummary = summary;
    }
    return summary;
  }

  private async releaseSubagentWorktree(
    state: SubagentWorktreeState,
  ): Promise<string> {
    const { session, baselineHead } = state;
    const branchSuffix = session.worktreeBranch
      ? ` on branch ${session.worktreeBranch}`
      : "";
    const changes = baselineHead
      ? countWorktreeChanges(session.worktreePath, baselineHead)
      : null;
    const changesText = changes
      ? `${changes.changedFiles} changed file(s), ${changes.commits} commit(s)`
      : "change count unavailable";

    // Reusing a pre-existing worktree means it may hold the user's own work:
    // never delete it, just report what the subagent left behind.
    if (!session.isNew) {
      return `[worktree] ran in ${session.worktreePath}${branchSuffix} (${changesText}). This worktree already existed, so it was left in place.`;
    }

    if (!changes) {
      // Typical hook-based case: the hook created a plain directory that is not
      // a git worktree, so there is no HEAD to diff against. Deleting it on a
      // guess could throw away the subagent's work, so keep it.
      const reason = session.hookBased
        ? "it is not a git worktree, so its changes could not be counted"
        : "its changes could not be determined";
      return `[worktree] ran in ${session.worktreePath}${branchSuffix}; ${reason}. It was left in place — inspect and remove it manually when done.`;
    }

    if (changes.changedFiles > 0 || changes.commits > 0) {
      return `[worktree] ran in ${session.worktreePath}${branchSuffix}: ${changes.changedFiles} changed file(s), ${changes.commits} commit(s). It was left in place; those changes are NOT applied to the parent working directory — merge or cherry-pick from the branch when ready.`;
    }

    if (session.hookBased) {
      const hookConfiguration = this.hookManager?.getConfiguration();
      if (!hasWorktreeRemoveHook(hookConfiguration)) {
        logger?.warn(
          `No WorktreeRemove hook configured, hook-based subagent worktree left at: ${session.worktreePath}`,
        );
        return `[worktree] ran in ${session.worktreePath}; no changes, but no WorktreeRemove hook is configured, so the hook-based worktree was left in place.`;
      }
      await executeWorktreeRemoveHook(
        session.worktreePath,
        hookConfiguration,
        this.worktreeHookContext(),
      );
      return `[worktree] ran in ${session.worktreePath}; no changes, so the worktree was cleaned up.`;
    }

    try {
      await removeWorktree({
        name: session.worktreeName,
        path: session.worktreePath,
        branch: session.worktreeBranch,
        repoRoot: session.repoRoot,
        isNew: session.isNew,
        originalHeadCommit: baselineHead,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger?.warn(
        `Failed to remove subagent worktree ${session.worktreePath}: ${message}`,
      );
      return `[worktree] ran in ${session.worktreePath}${branchSuffix}; no changes, but removing the worktree failed (${message}) — remove it manually.`;
    }
    // `removeWorktree` returns nothing and refuses silently (locked, an
    // independent repository, the main working tree, a pointer it cannot read)
    // as well as giving up on a failed delete. "No changes, so the worktree was
    // removed" was printed over all of those, the last time with the directory
    // and its branch still on disk — so ask the filesystem instead.
    if (fs.existsSync(session.worktreePath)) {
      const outcome = describeWorktreeRemovalOutcome({
        worktreePath: session.worktreePath,
        repoRoot: session.repoRoot,
        branch: session.worktreeBranch ?? "",
      });
      logger?.warn(
        `Subagent worktree was not removed — ${session.worktreePath}: ${outcome.replace(/\n/g, " ")}`,
      );
      return `[worktree] ran in ${session.worktreePath}${branchSuffix}; no changes, but the worktree was NOT removed. ${outcome}`;
    }
    return `[worktree] ran in ${session.worktreePath}${branchSuffix}; no changes, so the worktree was removed.`;
  }

  /**
   * Execute agent using subagent instance
   *
   * IMPORTANT: This method automatically filters out the Agent tool from allowedTools
   * to prevent subagents from spawning other subagents (infinite recursion protection)
   */
  async executeAgent(
    instance: SubagentInstance,
    prompt: string,
    abortSignal?: AbortSignal,
    runInBackground?: boolean,
  ): Promise<string> {
    try {
      // Check if already aborted before starting
      if (abortSignal?.aborted) {
        throw new Error("Agent was aborted before execution started");
      }

      // Set status to active and update parent
      this.updateInstanceStatus(instance.subagentId, "active");

      const backgroundTaskManager = this.container.has("BackgroundTaskManager")
        ? this.container.get<BackgroundTaskManager>("BackgroundTaskManager")
        : undefined;

      if (runInBackground && backgroundTaskManager) {
        const taskId = backgroundTaskManager.generateId();
        const startTime = Date.now();

        // Create log file
        const logPath = path.join(
          resolveTempDir(),
          `wave-subagent-${taskId}.log`,
        );
        const logStream = fs.createWriteStream(logPath, { flags: "a" });
        instance.logStream = logStream;

        backgroundTaskManager.addTask({
          id: taskId,
          type: "subagent",
          status: "running",
          startTime,
          description: instance.description,
          stdout: "",
          stderr: "",
          outputPath: logPath,
          subagentId: instance.subagentId,
          onStop: () => {
            instance.logStream?.destroy();
            instance.logStream = undefined;
            instance.aiManager.abortAIMessage();
            this.cleanupInstance(instance.subagentId);
          },
        });

        instance.backgroundTaskId = taskId;

        // Execute in background
        // Note: notification enqueueing is handled by internalExecute when instance.backgroundTaskId is set
        const backgroundPromise = (async () => {
          try {
            const result = await this.internalExecute(
              instance,
              prompt,
              abortSignal,
            );
            const task = backgroundTaskManager?.getTask(taskId);
            if (task) {
              // internalExecute already recorded the terminal state; only fill
              // in a "completed" status when the task was not concurrently
              // killed (mirrors the catch branch below).
              if (task.status !== "killed") {
                task.status = "completed";
                task.stdout = result;
              }
              task.endTime = Date.now();
              task.runtime = task.endTime - startTime;
            }
          } catch (error) {
            const task = backgroundTaskManager?.getTask(taskId);
            if (task) {
              // Preserve a "killed" terminal state (internalExecute already
              // notified it) instead of flipping the in-map task to failed.
              if (task.status !== "killed") {
                task.status = "failed";
                task.stderr =
                  error instanceof Error ? error.message : String(error);
              }
              task.endTime = Date.now();
              task.runtime = task.endTime - startTime;
            }
          } finally {
            // Free the instance once the background task finishes: without
            // this the instance (message history, caches) would linger in the
            // map for the whole session, and the task's onStop closure would
            // keep it alive even after that.
            this.releaseInstance(instance.subagentId);
          }
        })();
        this.asyncWorkRegistry?.track(backgroundPromise);

        return taskId;
      }

      const result = await this.internalExecute(instance, prompt, abortSignal);
      // Free the instance once the subagent finishes. Callers that still hold
      // the reference can read its messageManager, but the map entry and the
      // background task's onStop closure are released so the message history
      // and caches can be garbage-collected.
      this.releaseInstance(instance.subagentId);
      return result;
    } catch (error) {
      this.updateInstanceStatus(instance.subagentId, "error");
      // An abort before internalExecute started still leaves a worktree behind.
      await this.finalizeWorktree(instance.subagentId);
      // Release on failure too so errored instances don't linger for the
      // session (the abort listener already releases on abort).
      this.releaseInstance(instance.subagentId);
      throw error;
    }
  }

  async backgroundInstance(subagentId: string): Promise<string> {
    const instance = this.instances.get(subagentId);
    if (!instance) {
      throw new Error(`Subagent instance ${subagentId} not found`);
    }

    const backgroundTaskManager = this.container.has("BackgroundTaskManager")
      ? this.container.get<BackgroundTaskManager>("BackgroundTaskManager")
      : undefined;

    if (!backgroundTaskManager) {
      throw new Error("BackgroundTaskManager not available");
    }

    const taskId = backgroundTaskManager.generateId();
    const startTime = Date.now();

    // Create log file
    const logPath = path.join(resolveTempDir(), `wave-subagent-${taskId}.log`);
    const logStream = fs.createWriteStream(logPath, { flags: "a" });
    instance.logStream = logStream;

    backgroundTaskManager.addTask({
      id: taskId,
      type: "subagent",
      status: "running",
      startTime,
      description: instance.description,
      stdout: "",
      stderr: "",
      outputPath: logPath,
      subagentId: instance.subagentId,
      onStop: () => {
        instance.logStream?.destroy();
        instance.logStream = undefined;
        instance.aiManager.abortAIMessage();
        this.cleanupInstance(instance.subagentId);
      },
    });

    instance.backgroundTaskId = taskId;

    return taskId;
  }

  private async internalExecute(
    instance: SubagentInstance,
    prompt: string,
    abortSignal?: AbortSignal,
  ): Promise<string> {
    // Set up consolidated abort handler to prevent listener accumulation
    let abortCleanup: (() => void) | undefined;
    // Only link to parent abort signal if NOT running in background
    if (abortSignal && !instance.backgroundTaskId) {
      abortCleanup = addConsolidatedAbortListener(abortSignal, [
        () => {
          // Update status to aborted
          this.updateInstanceStatus(instance.subagentId, "aborted");
          // Cleanup instance immediately on abort
          this.cleanupInstance(instance.subagentId);
        },
        () => {
          // Abort the AI execution
          instance.aiManager.abortAIMessage();
        },
      ]);
    }

    // `<usage>` reports this run: wall clock from here, tokens as the loop
    // spends them (tallied on the instance), and tool calls counted from the
    // messages the subagent itself appends — the fork snapshot is already in
    // there as inherited history and must not be read as work. Declared out
    // here so the failure path can report the same accounting.
    const startedAt = Date.now();
    const toolUsesBefore = countToolBlocks(
      instance.messageManager.getMessages(),
    );
    const runUsage = () => ({
      totalTokens: instance.usageTotals.totalTokens,
      toolUses:
        countToolBlocks(instance.messageManager.getMessages()) - toolUsesBefore,
      durationMs: Date.now() - startedAt,
    });

    try {
      // Add the user's prompt as a message
      instance.messageManager.addUserMessage({ content: prompt });

      // Execute the AI request
      // The AIManager will handle abort signals through its own abort controllers
      const executeAI = instance.aiManager.sendAIMessage();

      // If we have an abort signal, race against it using utilities to prevent listener accumulation
      if (abortSignal && !instance.backgroundTaskId) {
        await Promise.race([
          executeAI,
          createAbortPromise(abortSignal, "Agent was aborted"),
        ]);
      } else {
        await executeAI;
      }

      const usage = runUsage();

      // Get the latest messages to extract the response
      const messages = instance.messageManager.getMessages();
      const lastAssistantMessage = messages
        .filter((msg) => msg.role === "assistant")
        .pop();

      if (!lastAssistantMessage) {
        throw new Error("No response from subagent");
      }

      // Extract text content from the last assistant message
      const textBlocks = lastAssistantMessage.blocks.filter(
        (block) => block.type === "text",
      );
      const response = textBlocks.map((block) => block.content).join("\n");

      // Settle the worktree before the result leaves this method: its report is
      // appended to the response and to the background completion notice.
      const worktreeSummary = await this.finalizeWorktree(instance.subagentId);
      const finalResponse = worktreeSummary
        ? `${response}${response ? "\n\n" : ""}${worktreeSummary}`
        : response;

      // Update status to completed and update parent
      this.updateInstanceStatus(instance.subagentId, "completed");

      const backgroundTaskManager = this.container.has("BackgroundTaskManager")
        ? this.container.get<BackgroundTaskManager>("BackgroundTaskManager")
        : undefined;

      // If this was transitioned to background, update the background task
      if (instance.backgroundTaskId && backgroundTaskManager) {
        // Write final response and completion status to log before closing
        if (instance.logStream && finalResponse) {
          instance.logStream.write(
            `[${new Date().toISOString()}] Final response:\n${finalResponse}\n`,
          );
        }
        instance.logStream?.write(
          `[${new Date().toISOString()}] Agent completed\n`,
        );
        instance.logStream?.end();
        const task = backgroundTaskManager.getTask(instance.backgroundTaskId);
        if (task) {
          const wasAlreadyKilled = task.status === "killed";
          // Preserve a "killed" terminal state (stopTask already notified it)
          // instead of overwriting it with "completed" — mirrors shell exit
          // semantics in BackgroundTaskManager.onExit.
          if (!wasAlreadyKilled) {
            task.status = "completed";
            task.stdout =
              finalResponse || "Agent completed with no text response";
          }
          task.endTime = Date.now();
          if (task.startTime) {
            task.runtime = task.endTime - task.startTime;
          }
          // Skip notification if task was already stopped (e.g. by main agent shutdown)
          if (!wasAlreadyKilled) {
            const messageQueue = this.container.has("MessageQueue")
              ? this.container.get<MessageQueue>("MessageQueue")
              : undefined;
            if (messageQueue) {
              const summary = `Agent task "${instance.description}" completed${worktreeSummary ? `\n${worktreeSummary}` : ""}`;
              messageQueue.enqueueNotification(
                taskNotificationToXml({
                  type: "task_notification",
                  taskId: instance.backgroundTaskId,
                  taskType: "agent",
                  status: "completed",
                  summary,
                  // The subagent's own answer travels with the notification:
                  // without it the parent knows only *that* it finished and has
                  // no way to read what it found (its transcript is its own).
                  ...(finalResponse && { result: finalResponse }),
                  usage,
                }),
              );
            }
          }
          // Push a terminal snapshot: SubagentManager mutates the task object in
          // place, so without an explicit notify the UI/hosts keep the last
          // snapshot — the task created with status "running" — and the IDE
          // background-task gate (new chat / history restore) stays locked.
          backgroundTaskManager.notifyTasksChange();
        }
      }

      return finalResponse || "Agent completed with no text response";
    } catch (error) {
      // Settle the worktree even on failure so a clean one does not linger and
      // a dirty one is reported to the caller.
      const worktreeSummary = await this.finalizeWorktree(instance.subagentId);
      const backgroundTaskManager = this.container.has("BackgroundTaskManager")
        ? this.container.get<BackgroundTaskManager>("BackgroundTaskManager")
        : undefined;

      // If this was transitioned to background, update the background task with error
      if (instance.backgroundTaskId && backgroundTaskManager) {
        // Write error to log before closing
        instance.logStream?.write(
          `[${new Date().toISOString()}] Agent failed: ${error instanceof Error ? error.message : String(error)}\n`,
        );
        instance.logStream?.end();
        const task = backgroundTaskManager.getTask(instance.backgroundTaskId);
        if (task) {
          const wasAlreadyKilled = task.status === "killed";
          // Preserve a user/agent-initiated "killed" terminal state instead of
          // overwriting it with "failed" (mirrors shell exit semantics) — the
          // abort that stopped the task surfaces here as a thrown error.
          if (!wasAlreadyKilled) {
            task.status = "failed";
            task.stderr =
              error instanceof Error ? error.message : String(error);
          }
          task.endTime = Date.now();
          if (task.startTime) {
            task.runtime = task.endTime - task.startTime;
          }
          // Push a terminal snapshot (see the completion branch above).
          backgroundTaskManager.notifyTasksChange();
          // Skip notification if task was already stopped (e.g. by main agent shutdown)
          if (!wasAlreadyKilled) {
            const messageQueue = this.container.has("MessageQueue")
              ? this.container.get<MessageQueue>("MessageQueue")
              : undefined;
            if (messageQueue) {
              const errorMsg =
                error instanceof Error ? error.message : String(error);
              const summary = `Agent task "${instance.description}" failed: ${errorMsg}${worktreeSummary ? `\n${worktreeSummary}` : ""}`;
              messageQueue.enqueueNotification(
                taskNotificationToXml({
                  type: "task_notification",
                  taskId: instance.backgroundTaskId,
                  taskType: "agent",
                  status: "failed",
                  summary,
                  usage: runUsage(),
                }),
              );
            }
          }
        }
      }
      throw error;
    } finally {
      // Safety net for throws that skip the explicit finalize calls above
      // (e.g. "No response from subagent"). Idempotent: a settled worktree is
      // already claimed, so this is a no-op on the normal paths.
      await this.finalizeWorktree(instance.subagentId);
      // Clean up abort listeners to prevent memory leaks
      if (abortCleanup) {
        abortCleanup();
      }
    }
  }

  /**
   * Get instance by subagent ID
   */
  getInstance(subagentId: string): SubagentInstance | null {
    return this.instances.get(subagentId) || null;
  }

  /**
   * 这条会话派过的子代理，按派生的先后排（`$.agent.list()`，spec「配了哪些、
   * 能调什么、有谁在跑」）。
   *
   * 只列还在的：任务被丢掉之后就不在表里了。状态按 Claude Code 的
   * `AgentStatus` 命名，映射见 {@link modAgentStatusOf}。
   */
  listModAgents(): ModAgentInfo[] {
    const agents: ModAgentInfo[] = [];
    for (const instance of this.instances.values()) {
      agents.push({
        id: instance.subagentId,
        description: instance.description,
        type: instance.subagentType,
        status: modAgentStatusOf(instance.status),
      });
    }
    return agents;
  }

  /**
   * Update instance status
   */
  updateInstanceStatus(
    subagentId: string,
    status: SubagentInstance["status"],
  ): void {
    const instance = this.instances.get(subagentId);
    if (instance) {
      instance.status = status;
    }
  }

  /**
   * Add message to instance
   */
  addMessageToInstance(subagentId: string, message: Message): void {
    const instance = this.instances.get(subagentId);
    if (instance) {
      instance.messages.push(message);
    }
  }

  /**
   * Clean up completed, errored, or aborted instances
   */
  cleanupInstance(subagentId: string): void {
    const instance = this.instances.get(subagentId);
    if (
      instance &&
      (instance.status === "completed" ||
        instance.status === "error" ||
        instance.status === "aborted")
    ) {
      this.releaseInstance(subagentId);
    }
  }

  /**
   * Release a subagent instance so its graph (message history, file-read
   * caches, log stream) can be garbage-collected. Besides removing the
   * instance from the map, this drops the background task's onStop closure,
   * which captures the instance and would otherwise keep the whole graph
   * alive for the rest of the session.
   */
  private releaseInstance(subagentId: string): void {
    const instance = this.instances.get(subagentId);
    if (!instance) {
      return;
    }
    // 这两样要在下面清空之前取：`agent_transcript_path` 是后台子代理的日志文件
    // （`logStream` 一销毁就没了，实例上没留路径），`last_assistant_message` 来自
    // 子代理自己的对话（`instance.messages` 自己不记录，见
    // `addMessageToInstance` 无人调用）。
    const transcriptPath =
      typeof instance.logStream?.path === "string"
        ? instance.logStream.path
        : undefined;
    const lastAssistantMessage = this.lastAssistantTextOf(instance);
    if (instance.backgroundTaskId) {
      const backgroundTaskManager = this.container.has("BackgroundTaskManager")
        ? this.container.get<BackgroundTaskManager>("BackgroundTaskManager")
        : undefined;
      const task = backgroundTaskManager?.getTask(instance.backgroundTaskId);
      if (task) {
        task.onStop = undefined;
      }
    }
    // Stop the background shells this subagent spawned. Its manager is
    // isolated per instance, so nothing else ever reaches them: the subagent
    // itself is tracked in the parent manager (detached above), and
    // `SubagentManager.cleanup()` only runs at session end — without this a
    // `run_in_background` loop started by the subagent would keep running from
    // the moment the subagent finishes (or fails) until the whole session
    // closes, as an orphan nobody can attribute (issue #2742). Same rationale
    // as Claude Code's `killShellTasksForAgent` in `runAgent`'s finally block.
    instance.backgroundTaskManager.cleanup();
    if (instance.logStream && !instance.logStream.writableEnded) {
      // Only force-close a stream that hasn't been ended yet (the completion
      // and error paths already call end(); destroy would drop buffered data).
      instance.logStream.destroy();
    }
    instance.logStream = undefined;
    // 影子事件 `classic.SubagentStop`（spec「影子事件」）：**收尾**那一份由子代理
    // 自己的 AIManager 在收尾点派发（可多次、带 `additionalContext` 续跑），这里只
    // 给「没走到收尾」的出错 / 中止 / 用户停掉补报一次 —— 否则插件在失败路径上就聋
    // 了。补报是终局通知，没有「再跑一轮」的落点，`stop_hook_active` 恒 `false`（那
    // 一刻没有收尾可言）。载荷照 CC：没有 `description` / `status`（那是我们自造的，
    // 插件按 CC 的名字读不到）。
    if (!instance.modStopDispatched) {
      this.notifyMods("classic.SubagentStop", {
        agent_id: instance.subagentId,
        agent_type: instance.subagentType,
        stop_hook_active: false,
        ...(lastAssistantMessage === undefined
          ? {}
          : { last_assistant_message: lastAssistantMessage }),
        ...(transcriptPath === undefined
          ? {}
          : { agent_transcript_path: transcriptPath }),
      });
    }
    this.instances.delete(subagentId);
  }

  /**
   * 子代理最后一条 assistant 消息的正文（`classic.SubagentStop` 的
   * `last_assistant_message`）。
   *
   * 读实例自己的 `messageManager`：`instance.messages` 那条记录没有任何调用点，
   * 一直是空的。
   */
  private lastAssistantTextOf(instance: SubagentInstance): string | undefined {
    // 收尾路径上取的，抛出去就是一个没人接的 rejection：拿不到对话（替身只实现
    // 了一部分、实例没走到建消息那一步）就当没有最后一条，别把整条清理链带塌。
    const messages = instance.messageManager.getMessages();
    if (!Array.isArray(messages)) return undefined;
    const lastAssistant = [...messages]
      .reverse()
      .find((message) => message.role === "assistant");
    if (!lastAssistant) return undefined;
    const text = lastAssistant.blocks
      .filter((block) => block.type === "text")
      .map((block) => block.content)
      .join("\n")
      .trim();
    return text.length > 0 ? text : undefined;
  }

  /**
   * 派发一条只读的影子事件给 mods（spec「影子事件」）。子代理自己的容器里没有
   * ModManager —— mod 只关心主会话看到的这层，所以走父容器的那个。
   */
  private notifyMods(
    event: "classic.SubagentStart" | "classic.SubagentStop",
    payload:
      | ModClassicTrigger<ModClassicSubagentStartEvent>
      | ModClassicTrigger<ModClassicSubagentStopEvent>,
  ): void {
    if (!this.container.has("ModManager")) return;
    this.container
      .get<import("./modManager.js").ModManager>("ModManager")
      ?.notifyMods(event, payload);
  }

  /**
   * Get all active instances
   */
  getActiveInstances(): SubagentInstance[] {
    return Array.from(this.instances.values()).filter(
      (instance) =>
        instance.status === "active" || instance.status === "initializing",
    );
  }

  /**
   * Clean up all instances (for session end)
   */
  cleanup(): void {
    for (const instance of this.instances.values()) {
      instance.aiManager.abortAIMessage();
      instance.backgroundTaskManager.cleanup();
    }
    this.instances.clear();
  }

  /**
   * Create subagent callbacks for a specific subagent ID
   * Extracted to reuse in both create and restore flows
   */
  private createSubagentCallbacks(subagentId: string) {
    return {
      onUserMessageAdded: (params: UserMessageParams) => {
        this.refreshSubagentState(subagentId);
        // Forward user message events to parent via SubagentManager callbacks
        if (this.callbacks?.onSubagentUserMessageAdded) {
          this.callbacks.onSubagentUserMessageAdded(subagentId, params);
        }
      },

      onAssistantMessageAdded: (messageId: string) => {
        this.refreshSubagentState(subagentId);
        // Forward assistant message events to parent via SubagentManager callbacks
        if (this.callbacks?.onSubagentAssistantMessageAdded) {
          this.callbacks.onSubagentAssistantMessageAdded(subagentId, messageId);
        }
      },

      onAssistantContentUpdated: (params: {
        messageId: string;
        chunk: string;
        stage: "streaming" | "end";
      }) => {
        this.refreshSubagentState(subagentId);
        // Forward assistant content updates to parent via SubagentManager callbacks
        if (this.callbacks?.onSubagentAssistantContentUpdated) {
          this.callbacks.onSubagentAssistantContentUpdated({
            ...params,
            subagentId,
          });
        }
      },
      onAssistantReasoningUpdated: (params: {
        messageId: string;
        chunk: string;
        stage: "streaming" | "end";
      }) => {
        this.refreshSubagentState(subagentId);
        // Forward assistant reasoning updates to parent via SubagentManager callbacks
        if (this.callbacks?.onSubagentAssistantReasoningUpdated) {
          this.callbacks.onSubagentAssistantReasoningUpdated({
            ...params,
            subagentId,
          });
        }
      },

      onToolBlockUpdated: (params: ToolBlockUpdateCallbackParams) => {
        this.refreshSubagentState(subagentId);
        const instance = this.instances.get(subagentId);
        if (instance) {
          // Log tool execution to file only when finalized
          if (instance.logStream && params.stage === "end") {
            const displayParams =
              params.compactParams ||
              (params.parameters || "").substring(0, 100);
            instance.logStream.write(
              `[${new Date().toISOString()}] ${params.name}${displayParams ? ` ${displayParams}` : ""}\n`,
            );
          }
        }

        // Forward tool block updates to parent via SubagentManager callbacks
        if (this.callbacks?.onSubagentToolBlockUpdated) {
          this.callbacks.onSubagentToolBlockUpdated(subagentId, params);
        }
      },

      onLatestTotalTokensChange: (tokens: number) => {
        const instance = this.instances.get(subagentId);
        if (instance) {
          // Trigger the onUpdate callback if provided
          instance.onUpdate?.();
        }
        // Forward latest total tokens to parent via SubagentManager callbacks
        if (this.callbacks?.onSubagentLatestTotalTokensChange) {
          this.callbacks.onSubagentLatestTotalTokensChange(subagentId, tokens);
        }
      },

      onNoticeAdded: ({
        level,
        content,
      }: {
        level: NoticeLevel;
        content: string;
      }) => {
        this.refreshSubagentState(subagentId);
        const instance = this.instances.get(subagentId);
        if (instance?.logStream) {
          instance.logStream.write(
            `[${new Date().toISOString()}] ${level}: ${content}\n`,
          );
        }
      },
    };
  }

  /**
   * Pull the latest messages from the subagent instance's MessageManager and
   * refresh the instance's cached messages, usedTools, onUpdate and the
   * onSubagentMessagesChange forwarding. Triggered by incremental callbacks.
   */
  private refreshSubagentState(subagentId: string): void {
    const instance = this.instances.get(subagentId);
    if (!instance) return;

    const messages = instance.messageManager.getMessages();
    instance.messages = messages;
    // Compute usedTools from messages (last 2 tool blocks)
    const toolBlocks = messages.flatMap(
      (m) => m.blocks?.filter((b) => b.type === "tool") ?? [],
    );
    const last2 = toolBlocks.slice(-2);
    instance.usedTools = last2.map((tb) => ({
      name: tb.name ?? "",
      parameters: tb.parameters ?? "",
      compactParams: tb.compactParams,
      stage: tb.stage,
    }));
    // Trigger the onUpdate callback if provided
    instance.onUpdate?.();
    // Forward subagent message changes to parent via callbacks
    if (this.callbacks?.onSubagentMessagesChange) {
      this.callbacks.onSubagentMessagesChange(subagentId, messages);
    }
  }
}

/**
 * 子代理状态 → mod 面那六档（Claude Code 的 `AgentStatus`）。
 *
 * 我们的 `initializing` / `active` / `completed` / `error` / `aborted` 逐一对上
 * `pending` / `running` / `completed` / `failed` / `killed`。`idle` 没有对应：
 * 我们的子代理不吃消息，跑完就结束。
 */
function modAgentStatusOf(status: SubagentInstance["status"]): ModAgentStatus {
  switch (status) {
    case "initializing":
      return "pending";
    case "active":
      return "running";
    case "completed":
      return "completed";
    case "error":
      return "failed";
    case "aborted":
      return "killed";
  }
}
