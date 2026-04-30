import { randomUUID } from "crypto";
import * as os from "os";
import * as fs from "fs";
import * as path from "path";
import type { SubagentConfiguration } from "../utils/subagentParser.js";
import type { Message, Usage } from "../types/index.js";
import { AIManager } from "./aiManager.js";
import { MessageManager } from "./messageManager.js";
import { ToolManager } from "./toolManager.js";
import { AGENT_TOOL_NAME } from "../constants/tools.js";
import {
  addConsolidatedAbortListener,
  createAbortPromise,
} from "../utils/abortUtils.js";
import { BackgroundTaskManager } from "./backgroundTaskManager.js";
import { NotificationQueue } from "./notificationQueue.js";
import { logger } from "../utils/globalLogger.js";
import {
  UserMessageParams,
  type AgentToolBlockUpdateParams,
} from "../utils/messageOperations.js";

import { Container } from "../utils/container.js";
import type { PermissionManager } from "./permissionManager.js";
import type { PermissionMode } from "../types/permissions.js";
import { ConfigurationService } from "../services/configurationService.js";

export interface SubagentManagerCallbacks {
  // Granular subagent message callbacks (015-subagent-message-callbacks)
  /** Triggered when subagent adds user message */
  onSubagentUserMessageAdded?: (
    subagentId: string,
    params: UserMessageParams,
  ) => void;
  /** Triggered when subagent creates assistant message */
  onSubagentAssistantMessageAdded?: (subagentId: string) => void;
  /** Triggered during subagent content streaming updates */
  onSubagentAssistantContentUpdated?: (
    subagentId: string,
    chunk: string,
    accumulated: string,
  ) => void;
  /** Triggered during subagent reasoning streaming updates */
  onSubagentAssistantReasoningUpdated?: (
    subagentId: string,
    chunk: string,
    accumulated: string,
  ) => void;
  /** Triggered when subagent tool block is updated */
  onSubagentToolBlockUpdated?: (
    subagentId: string,
    params: AgentToolBlockUpdateParams,
  ) => void;
  /** Triggered when subagent messages change */
  onSubagentMessagesChange?: (subagentId: string, messages: Message[]) => void;
  /** Triggered when subagent latest total tokens change */
  onSubagentLatestTotalTokensChange?: (
    subagentId: string,
    tokens: number,
  ) => void;
}

export interface SubagentInstance {
  subagentId: string;
  configuration: SubagentConfiguration;
  aiManager: AIManager;
  messageManager: MessageManager;
  toolManager: ToolManager;
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
}

export interface SubagentManagerOptions {
  workdir: string;
  callbacks?: SubagentManagerCallbacks; // Use SubagentManagerCallbacks instead of parentCallbacks
  onUsageAdded?: (usage: Usage) => void;
  stream: boolean;
}

export class SubagentManager {
  private instances = new Map<string, SubagentInstance>();
  private subagentPermissionManagers = new Map<string, PermissionManager>();
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

    for (const [, pm] of this.subagentPermissionManagers) {
      pm.updateAllowedRules(parentPm.getAllowedRules());
      pm.updateDeniedRules(parentPm.getDeniedRules());
      pm.updateAdditionalDirectories(parentPm.getAdditionalDirectories());
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
      );
    }
    return this.cachedConfigurations;
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
    return this.cachedConfigurations;
  }

  /**
   * Find subagent by exact name match
   */
  async findSubagent(name: string) {
    // Check cached configurations first (includes plugin agents)
    if (this.cachedConfigurations !== null) {
      const cached = this.cachedConfigurations.find(
        (config) => config.name === name,
      );
      if (cached) return cached;
    }
    // Fall back to filesystem scan for non-plugin agents
    const { findSubagentByName } = await import("../utils/subagentParser.js");
    return findSubagentByName(name, this.workdir);
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

    // Register a modified AgentOptions without onLoadingChange to prevent subagent loading
    // from affecting the parent agent's loading state
    const parentOptions =
      this.container.get<import("../types/agent.js").AgentOptions>(
        "AgentOptions",
      );
    if (parentOptions) {
      const subagentOptions: import("../types/agent.js").AgentOptions = {
        ...parentOptions,
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
    const subagentPermissionManager = new PermissionManager(subagentContainer, {
      configuredPermissionMode:
        parameters.permissionModeOverride ??
        parentPermissionManager?.getConfiguredPermissionMode(),
      allowedRules: parentPermissionManager?.getAllowedRules(),
      deniedRules: parentPermissionManager?.getDeniedRules(),
      instanceAllowedRules:
        parentPermissionManager?.getInstanceAllowedRules?.(),
      instanceDeniedRules: [
        ...(parentPermissionManager?.getInstanceDeniedRules?.() || []),
        AGENT_TOOL_NAME, // Always deny Agent tool in subagents to prevent recursion
      ],
      additionalDirectories:
        parentPermissionManager?.getAdditionalDirectories(),
      systemAdditionalDirectories:
        parentPermissionManager?.getSystemAdditionalDirectories(),
      planFilePath: parentPermissionManager?.getPlanFilePath(),
    });
    subagentContainer.register("PermissionManager", subagentPermissionManager);

    // Register the permission mode override in the subagent container so it
    // shadows the inherited parent value during tool execution
    if (parameters.permissionModeOverride) {
      subagentContainer.register(
        "PermissionMode",
        parameters.permissionModeOverride,
      );
    }

    // Track this subagent's PermissionManager for rule sync
    this.subagentPermissionManagers.set(subagentId, subagentPermissionManager);

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
      workdir: this.workdir,
      sessionType: "subagent",
      subagentType: parameters.subagent_type,
    });
    subagentContainer.register("MessageManager", messageManager);

    // Create isolated ToolManager for the subagent to ensure it uses the subagent's PermissionManager
    const toolManager = new ToolManager({
      container: subagentContainer,
      tools: configuration.tools,
    });
    toolManager.initializeBuiltInTools();
    subagentContainer.register("ToolManager", toolManager);

    // Create isolated AIManager for the subagent
    const aiManager = new AIManager(subagentContainer, {
      workdir: this.workdir,
      systemPrompt: configuration.systemPrompt,
      subagentType: parameters.subagent_type, // Pass subagent type for hook context
      modelOverride: parameters.model || configuration.model, // Pass model override
      stream: parameters.stream ?? this.stream, // Pass streaming mode flag
      maxTurns: parameters.maxTurns, // Pass maxTurns limit
      callbacks: {
        onUsageAdded: this.onUsageAdded,
      },
    });
    subagentContainer.register("AIManager", aiManager);

    // Create isolated NotificationQueue for the subagent/forked agent
    const subagentNotificationQueue = new NotificationQueue();
    subagentContainer.register("NotificationQueue", subagentNotificationQueue);

    // Create isolated BackgroundTaskManager for the subagent/forked agent
    const subagentBackgroundTaskManager = new BackgroundTaskManager(
      subagentContainer,
      {
        workdir: this.workdir,
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
      status: "initializing",
      messages: [],
      usedTools: [], // Initialize usedTools
      subagentType: parameters.subagent_type, // Store the subagent type
      description: parameters.description, // Store the AI-generated description
      allowedTools: parameters.allowedTools, // Store optional permission rules
      model: parameters.model, // Store optional model override
      onUpdate,
    };

    this.instances.set(subagentId, instance);

    return instance;
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
        const logPath = path.join(os.tmpdir(), `wave-subagent-${taskId}.log`);
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
        (async () => {
          try {
            const result = await this.internalExecute(
              instance,
              prompt,
              abortSignal,
            );
            const task = backgroundTaskManager?.getTask(taskId);
            if (task) {
              task.status = "completed";
              task.stdout = result;
              task.endTime = Date.now();
              task.runtime = task.endTime - startTime;
            }
          } catch (error) {
            const task = backgroundTaskManager?.getTask(taskId);
            if (task) {
              task.status = "failed";
              task.stderr =
                error instanceof Error ? error.message : String(error);
              task.endTime = Date.now();
              task.runtime = task.endTime - startTime;
            }
          }
        })();

        return taskId;
      }

      return await this.internalExecute(instance, prompt, abortSignal);
    } catch (error) {
      this.updateInstanceStatus(instance.subagentId, "error");
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
    const logPath = path.join(os.tmpdir(), `wave-subagent-${taskId}.log`);
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

      // Update status to completed and update parent
      this.updateInstanceStatus(instance.subagentId, "completed");

      const backgroundTaskManager = this.container.has("BackgroundTaskManager")
        ? this.container.get<BackgroundTaskManager>("BackgroundTaskManager")
        : undefined;

      // If this was transitioned to background, update the background task
      if (instance.backgroundTaskId && backgroundTaskManager) {
        // Write final response and completion status to log before closing
        if (instance.logStream && response) {
          instance.logStream.write(
            `[${new Date().toISOString()}] Final response:\n${response}\n`,
          );
        }
        instance.logStream?.write(
          `[${new Date().toISOString()}] Agent completed successfully\n`,
        );
        instance.logStream?.end();
        const task = backgroundTaskManager.getTask(instance.backgroundTaskId);
        if (task) {
          const wasAlreadyKilled = task.status === "killed";
          task.status = "completed";
          task.stdout = response || "Agent completed with no text response";
          task.endTime = Date.now();
          if (task.startTime) {
            task.runtime = task.endTime - task.startTime;
          }
          // Skip notification if task was already stopped (e.g. by main agent shutdown)
          if (!wasAlreadyKilled) {
            const notificationQueue = this.container.has("NotificationQueue")
              ? this.container.get<NotificationQueue>("NotificationQueue")
              : undefined;
            if (notificationQueue) {
              const summary = `Agent task "${instance.description}" completed`;
              notificationQueue.enqueue(
                `<task-notification>\n<task-id>${instance.backgroundTaskId}</task-id>\n<task-type>agent</task-type>\n<status>completed</status>\n<summary>${summary}</summary>\n</task-notification>`,
              );
            }
          }
        }
      }

      return response || "Agent completed with no text response";
    } catch (error) {
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
          task.status = "failed";
          task.stderr = error instanceof Error ? error.message : String(error);
          task.endTime = Date.now();
          if (task.startTime) {
            task.runtime = task.endTime - task.startTime;
          }
          // Skip notification if task was already stopped (e.g. by main agent shutdown)
          if (!wasAlreadyKilled) {
            const notificationQueue = this.container.has("NotificationQueue")
              ? this.container.get<NotificationQueue>("NotificationQueue")
              : undefined;
            if (notificationQueue) {
              const errorMsg =
                error instanceof Error ? error.message : String(error);
              const summary = `Agent task "${instance.description}" failed: ${errorMsg}`;
              notificationQueue.enqueue(
                `<task-notification>\n<task-id>${instance.backgroundTaskId}</task-id>\n<task-type>agent</task-type>\n<status>failed</status>\n<summary>${summary}</summary>\n</task-notification>`,
              );
            }
          }
        }
      }
      throw error;
    } finally {
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
      this.instances.delete(subagentId);
      this.subagentPermissionManagers.delete(subagentId);
    }
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
    this.instances.clear();
  }

  /**
   * Create subagent callbacks for a specific subagent ID
   * Extracted to reuse in both create and restore flows
   */
  private createSubagentCallbacks(subagentId: string) {
    return {
      onUserMessageAdded: (params: UserMessageParams) => {
        // Forward user message events to parent via SubagentManager callbacks
        if (this.callbacks?.onSubagentUserMessageAdded) {
          this.callbacks.onSubagentUserMessageAdded(subagentId, params);
        }
      },

      onAssistantMessageAdded: () => {
        // Forward assistant message events to parent via SubagentManager callbacks
        if (this.callbacks?.onSubagentAssistantMessageAdded) {
          this.callbacks.onSubagentAssistantMessageAdded(subagentId);
        }
      },

      onAssistantContentUpdated: (chunk: string, accumulated: string) => {
        // Forward assistant content updates to parent via SubagentManager callbacks
        if (this.callbacks?.onSubagentAssistantContentUpdated) {
          this.callbacks.onSubagentAssistantContentUpdated(
            subagentId,
            chunk,
            accumulated,
          );
        }
      },
      onAssistantReasoningUpdated: (chunk: string, accumulated: string) => {
        // Forward assistant reasoning updates to parent via SubagentManager callbacks
        if (this.callbacks?.onSubagentAssistantReasoningUpdated) {
          this.callbacks.onSubagentAssistantReasoningUpdated(
            subagentId,
            chunk,
            accumulated,
          );
        }
      },

      onToolBlockUpdated: (params: AgentToolBlockUpdateParams) => {
        const instance = this.instances.get(subagentId);
        if (instance) {
          // Log tool execution to file
          if (instance.logStream) {
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

      // These callbacks will be handled by the parent agent
      onMessagesChange: (messages: Message[]) => {
        const instance = this.instances.get(subagentId);
        if (instance) {
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
    };
  }
}
