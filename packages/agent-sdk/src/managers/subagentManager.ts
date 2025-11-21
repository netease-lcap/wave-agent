import { randomUUID } from "crypto";
import type { SubagentConfiguration } from "../utils/subagentParser.js";
import type {
  Message,
  Logger,
  GatewayConfig,
  ModelConfig,
  Usage,
} from "../types/index.js";
import { AIManager } from "./aiManager.js";
import {
  MessageManager,
  type MessageManagerCallbacks,
} from "./messageManager.js";
import { ToolManager } from "./toolManager.js";
import { HookManager } from "./hookManager.js";
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
  /** Triggered when subagent tool block is updated */
  onSubagentToolBlockUpdated?: (
    subagentId: string,
    params: AgentToolBlockUpdateParams,
  ) => void;
  /** Triggered when subagent messages change */
  onSubagentMessagesChange?: (subagentId: string, messages: Message[]) => void;
}

export interface SubagentInstance {
  subagentId: string;
  configuration: SubagentConfiguration;
  aiManager: AIManager;
  messageManager: MessageManager;
  toolManager: ToolManager;
  status: "initializing" | "active" | "completed" | "error" | "aborted";
  messages: Message[];
}

export interface SubagentManagerOptions {
  workdir: string;
  parentToolManager: ToolManager;
  parentMessageManager: MessageManager;
  callbacks?: SubagentManagerCallbacks; // Use SubagentManagerCallbacks instead of parentCallbacks
  logger?: Logger;
  gatewayConfig: GatewayConfig;
  modelConfig: ModelConfig;
  tokenLimit: number;
  hookManager?: HookManager;
  onUsageAdded?: (usage: Usage) => void;
}

export class SubagentManager {
  private instances = new Map<string, SubagentInstance>();
  private cachedConfigurations: SubagentConfiguration[] | null = null;

  private workdir: string;
  private parentToolManager: ToolManager;
  private parentMessageManager: MessageManager;
  private callbacks?: SubagentManagerCallbacks; // Use SubagentManagerCallbacks instead of parentCallbacks
  private logger?: Logger;
  private gatewayConfig: GatewayConfig;
  private modelConfig: ModelConfig;
  private tokenLimit: number;
  private hookManager?: HookManager;
  private onUsageAdded?: (usage: Usage) => void;

  constructor(options: SubagentManagerOptions) {
    this.workdir = options.workdir;
    this.parentToolManager = options.parentToolManager;
    this.parentMessageManager = options.parentMessageManager;
    this.callbacks = options.callbacks; // Store SubagentManagerCallbacks
    this.logger = options.logger;
    this.gatewayConfig = options.gatewayConfig;
    this.modelConfig = options.modelConfig;
    this.tokenLimit = options.tokenLimit;
    this.hookManager = options.hookManager;
    this.onUsageAdded = options.onUsageAdded;
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
  ): Promise<SubagentInstance> {
    if (
      !this.parentToolManager ||
      !this.gatewayConfig ||
      !this.modelConfig ||
      !this.tokenLimit
    ) {
      throw new Error(
        "SubagentManager not properly initialized - call initialize() first",
      );
    }

    const subagentId = randomUUID();

    // Create isolated MessageManager for the subagent
    const subagentCallbacks: MessageManagerCallbacks = {
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
          // Forward subagent message changes to parent via callbacks
          if (this.callbacks?.onSubagentMessagesChange) {
            this.callbacks.onSubagentMessagesChange(subagentId, messages);
          }
        }
      },
    };

    const messageManager = new MessageManager({
      callbacks: subagentCallbacks,
      workdir: this.workdir,
      logger: this.logger,
      sessionPrefix: "subagent_session",
    });

    // Use the parent tool manager directly - tool restrictions will be handled by allowedTools parameter
    const toolManager = this.parentToolManager;

    // Determine model to use
    const modelToUse =
      configuration.model && configuration.model !== "inherit"
        ? configuration.model
        : this.modelConfig.agentModel;

    // Create isolated AIManager for the subagent
    const aiManager = new AIManager({
      messageManager,
      toolManager,
      logger: this.logger,
      workdir: this.workdir,
      systemPrompt: configuration.systemPrompt,
      hookManager: this.hookManager,
      gatewayConfig: this.gatewayConfig,
      modelConfig: {
        ...this.modelConfig,
        agentModel: modelToUse,
      },
      tokenLimit: this.tokenLimit,
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
    };

    this.instances.set(subagentId, instance);

    // Create subagent block in parent message manager
    this.parentMessageManager.addSubagentBlock(
      subagentId,
      configuration.name,
      "active",
      parameters,
    );

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
  ): Promise<string> {
    try {
      // Check if already aborted before starting
      if (abortSignal?.aborted) {
        throw new Error("Task was aborted before execution started");
      }

      // Set status to active and update parent
      this.updateInstanceStatus(instance.subagentId, "active");
      this.parentMessageManager.updateSubagentBlock(instance.subagentId, {
        status: "active",
      });

      // Set up abort handler
      if (abortSignal) {
        abortSignal.addEventListener("abort", () => {
          this.updateInstanceStatus(instance.subagentId, "aborted");
          this.parentMessageManager.updateSubagentBlock(instance.subagentId, {
            status: "aborted",
          });
        });
      }

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
      // We need to abort the AI execution if the external abort signal is triggered
      const executeAI = instance.aiManager.sendAIMessage({
        allowedTools,
        model:
          instance.configuration.model !== "inherit"
            ? instance.configuration.model
            : undefined,
      });

      // If we have an abort signal, race against it
      if (abortSignal) {
        await Promise.race([
          executeAI,
          new Promise<never>((_, reject) => {
            if (abortSignal.aborted) {
              reject(new Error("Task was aborted"));
            }
            abortSignal.addEventListener("abort", () => {
              // Abort the AI execution
              instance.aiManager.abortAIMessage();
              reject(new Error("Task was aborted"));
            });
          }),
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
      this.parentMessageManager.updateSubagentBlock(instance.subagentId, {
        status: "completed",
      });

      return response || "Task completed with no text response";
    } catch (error) {
      this.updateInstanceStatus(instance.subagentId, "error");
      this.parentMessageManager.updateSubagentBlock(instance.subagentId, {
        status: "error",
      });
      throw error;
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
}
