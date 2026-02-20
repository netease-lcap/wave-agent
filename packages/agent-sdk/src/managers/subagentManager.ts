import { randomUUID } from "crypto";
import type { MemoryRuleManager } from "./MemoryRuleManager.js";
import type { SubagentConfiguration } from "../utils/subagentParser.js";
import type {
  Message,
  Logger,
  GatewayConfig,
  ModelConfig,
  Usage,
} from "../types/index.js";
import { AIManager } from "./aiManager.js";
import { MessageManager } from "./messageManager.js";
import { ToolManager } from "./toolManager.js";
import { HookManager } from "./hookManager.js";
import {
  addConsolidatedAbortListener,
  createAbortPromise,
} from "../utils/abortUtils.js";
import { BackgroundTaskManager } from "./backgroundTaskManager.js";
import {
  UserMessageParams,
  type AgentToolBlockUpdateParams,
} from "../utils/messageOperations.js";

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
  subagentType: string; // Store the subagent type for hook context
  backgroundTaskId?: string; // ID of the background task if transitioned
  onUpdate?: () => void; // Optional callback for real-time updates
}

export interface SubagentManagerOptions {
  workdir: string;
  parentToolManager: ToolManager;
  taskManager: import("../services/taskManager.js").TaskManager;
  callbacks?: SubagentManagerCallbacks; // Use SubagentManagerCallbacks instead of parentCallbacks
  logger?: Logger;
  getGatewayConfig: () => GatewayConfig;
  getModelConfig: () => ModelConfig;
  getMaxInputTokens: () => number;
  getLanguage: () => string | undefined;
  hookManager?: HookManager;
  onUsageAdded?: (usage: Usage) => void;
  backgroundTaskManager?: BackgroundTaskManager;
  memoryRuleManager?: MemoryRuleManager;
}

export class SubagentManager {
  private instances = new Map<string, SubagentInstance>();
  private cachedConfigurations: SubagentConfiguration[] | null = null;

  private workdir: string;
  private parentToolManager: ToolManager;
  private taskManager: import("../services/taskManager.js").TaskManager;
  private callbacks?: SubagentManagerCallbacks; // Use SubagentManagerCallbacks instead of parentCallbacks
  private logger?: Logger;
  private getGatewayConfig: () => GatewayConfig;
  private getModelConfig: () => ModelConfig;
  private getMaxInputTokens: () => number;
  private getLanguage: () => string | undefined;
  private hookManager?: HookManager;
  private onUsageAdded?: (usage: Usage) => void;
  private backgroundTaskManager?: BackgroundTaskManager;
  private memoryRuleManager?: MemoryRuleManager;

  constructor(options: SubagentManagerOptions) {
    this.workdir = options.workdir;
    this.parentToolManager = options.parentToolManager;
    this.taskManager = options.taskManager;
    this.callbacks = options.callbacks; // Store SubagentManagerCallbacks
    this.logger = options.logger;
    this.getGatewayConfig = options.getGatewayConfig;
    this.getModelConfig = options.getModelConfig;
    this.getMaxInputTokens = options.getMaxInputTokens;
    this.getLanguage = options.getLanguage;
    this.hookManager = options.hookManager;
    this.onUsageAdded = options.onUsageAdded;
    this.backgroundTaskManager = options.backgroundTaskManager;
    this.memoryRuleManager = options.memoryRuleManager;
  }

  /**
   * Initialize the SubagentManager by loading and caching configurations
   */
  async initialize(): Promise<void> {
    await this.loadConfigurations();
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
    const { findSubagentByName } = await import("../utils/subagentParser.js");
    return findSubagentByName(name, this.workdir);
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
    },
    runInBackground?: boolean,
    onUpdate?: () => void,
  ): Promise<SubagentInstance> {
    if (!this.parentToolManager) {
      throw new Error(
        "SubagentManager not properly initialized - call initialize() first",
      );
    }

    const subagentId = randomUUID();

    // Create isolated MessageManager for the subagent
    const subagentCallbacks = this.createSubagentCallbacks(subagentId);

    const messageManager = new MessageManager({
      callbacks: subagentCallbacks,
      workdir: this.workdir,
      logger: this.logger,
      sessionType: "subagent",
      subagentType: parameters.subagent_type,
      memoryRuleManager: this.memoryRuleManager,
    });

    // Use the parent tool manager directly - tool restrictions will be handled by allowedTools parameter
    const toolManager = this.parentToolManager;

    // Create isolated AIManager for the subagent
    const aiManager = new AIManager({
      messageManager,
      toolManager,
      taskManager: this.taskManager,
      logger: this.logger,
      workdir: this.workdir,
      systemPrompt: configuration.systemPrompt,
      subagentType: parameters.subagent_type, // Pass subagent type for hook context
      hookManager: this.hookManager,
      permissionManager: this.parentToolManager.getPermissionManager(),
      getGatewayConfig: this.getGatewayConfig,
      getModelConfig: () => {
        // Determine model dynamically each time
        const parentModelConfig = this.getModelConfig();
        let modelToUse: string;

        if (!configuration.model || configuration.model === "inherit") {
          // Use parent's agentModel for "inherit" or undefined
          modelToUse = parentModelConfig.agentModel;
        } else if (configuration.model === "fastModel") {
          // Use parent's fastModel for special "fastModel" value
          modelToUse = parentModelConfig.fastModel;
        } else {
          // Use specific model name
          modelToUse = configuration.model;
        }

        return {
          ...parentModelConfig,
          agentModel: modelToUse,
        };
      },
      getMaxInputTokens: this.getMaxInputTokens,
      getLanguage: this.getLanguage,
      callbacks: {
        onUsageAdded: this.onUsageAdded,
      },
    });

    const instance: SubagentInstance = {
      subagentId,
      configuration,
      aiManager,
      messageManager,
      toolManager,
      status: "initializing",
      messages: [],
      subagentType: parameters.subagent_type, // Store the subagent type
      onUpdate,
    };

    this.instances.set(subagentId, instance);

    return instance;
  }

  /**
   * Execute task using subagent instance
   *
   * IMPORTANT: This method automatically filters out the Task tool from allowedTools
   * to prevent subagents from spawning other subagents (infinite recursion protection)
   */
  async executeTask(
    instance: SubagentInstance,
    prompt: string,
    abortSignal?: AbortSignal,
    runInBackground?: boolean,
  ): Promise<string> {
    try {
      // Check if already aborted before starting
      if (abortSignal?.aborted) {
        throw new Error("Task was aborted before execution started");
      }

      // Set status to active and update parent
      this.updateInstanceStatus(instance.subagentId, "active");

      if (runInBackground && this.backgroundTaskManager) {
        const taskId = this.backgroundTaskManager.generateId();
        const startTime = Date.now();

        this.backgroundTaskManager.addTask({
          id: taskId,
          type: "subagent",
          status: "running",
          startTime,
          description: instance.configuration.description,
          stdout: "",
          stderr: "",
          onStop: () => instance.aiManager.abortAIMessage(),
        });

        instance.backgroundTaskId = taskId;

        // Execute in background
        (async () => {
          try {
            const result = await this.internalExecute(
              instance,
              prompt,
              abortSignal,
            );
            const task = this.backgroundTaskManager?.getTask(taskId);
            if (task) {
              task.status = "completed";
              task.stdout = result;
              task.endTime = Date.now();
              task.runtime = task.endTime - startTime;
            }
          } catch (error) {
            const task = this.backgroundTaskManager?.getTask(taskId);
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

    if (!this.backgroundTaskManager) {
      throw new Error("BackgroundTaskManager not available");
    }

    const taskId = this.backgroundTaskManager.generateId();
    const startTime = Date.now();

    this.backgroundTaskManager.addTask({
      id: taskId,
      type: "subagent",
      status: "running",
      startTime,
      description: instance.configuration.description,
      stdout: "",
      stderr: "",
      onStop: () => instance.aiManager.abortAIMessage(),
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

      // Create allowed tools list - always exclude Task tool to prevent subagent recursion
      let allowedTools = instance.configuration.tools;

      // Always filter out the Task tool to prevent subagents from creating sub-subagents
      if (allowedTools) {
        allowedTools = allowedTools.filter((tool) => tool !== "Task");
      } else {
        // If no tools specified, get all tools except Task
        const allTools = instance.toolManager.list().map((tool) => tool.name);
        allowedTools = allTools.filter((tool) => tool !== "Task");
      }

      // Execute the AI request with tool restrictions
      // The AIManager will handle abort signals through its own abort controllers
      // Resolve model name for sendAIMessage
      let resolvedModel: string | undefined;
      if (
        instance.configuration.model &&
        instance.configuration.model !== "inherit"
      ) {
        if (instance.configuration.model === "fastModel") {
          // Use parent's fastModel for special "fastModel" value
          const parentModelConfig = this.getModelConfig();
          resolvedModel = parentModelConfig.fastModel;
        } else {
          // Use specific model name
          resolvedModel = instance.configuration.model;
        }
      }
      // For "inherit" or undefined, resolvedModel remains undefined (uses AIManager default)

      const executeAI = instance.aiManager.sendAIMessage({
        tools: allowedTools,
        model: resolvedModel,
      });

      // If we have an abort signal, race against it using utilities to prevent listener accumulation
      if (abortSignal && !instance.backgroundTaskId) {
        await Promise.race([
          executeAI,
          createAbortPromise(abortSignal, "Task was aborted"),
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

      // If this was transitioned to background, update the background task
      if (instance.backgroundTaskId && this.backgroundTaskManager) {
        const task = this.backgroundTaskManager.getTask(
          instance.backgroundTaskId,
        );
        if (task) {
          task.status = "completed";
          task.stdout = response || "Task completed with no text response";
          task.endTime = Date.now();
          if (task.startTime) {
            task.runtime = task.endTime - task.startTime;
          }
        }
      }

      return response || "Task completed with no text response";
    } catch (error) {
      // If this was transitioned to background, update the background task with error
      if (instance.backgroundTaskId && this.backgroundTaskManager) {
        const task = this.backgroundTaskManager.getTask(
          instance.backgroundTaskId,
        );
        if (task) {
          task.status = "failed";
          task.stderr = error instanceof Error ? error.message : String(error);
          task.endTime = Date.now();
          if (task.startTime) {
            task.runtime = task.endTime - task.startTime;
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
