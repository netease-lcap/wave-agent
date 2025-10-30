import { randomUUID } from "crypto";
import type { SubagentConfiguration } from "../utils/subagentParser.js";
import type { Message, Logger, GatewayConfig, ModelConfig } from "../types.js";
import { AIManager } from "./aiManager.js";
import {
  MessageManager,
  type MessageManagerCallbacks,
} from "./messageManager.js";
import { ToolManager } from "./toolManager.js";

export interface SubagentInstance {
  subagentId: string;
  configuration: SubagentConfiguration;
  aiManager: AIManager;
  messageManager: MessageManager;
  toolManager: ToolManager;
  status: "initializing" | "active" | "completed" | "error";
  taskDescription: string;
  messages: Message[];
}

export interface SubagentManagerOptions {
  workdir: string;
  parentToolManager: ToolManager;
  parentMessageManager: MessageManager;
  logger?: Logger;
  gatewayConfig: GatewayConfig;
  modelConfig: ModelConfig;
  tokenLimit: number;
}

export class SubagentManager {
  private instances = new Map<string, SubagentInstance>();
  private cachedConfigurations: SubagentConfiguration[] | null = null;

  private workdir: string;
  private parentToolManager: ToolManager;
  private parentMessageManager: MessageManager;
  private logger?: Logger;
  private gatewayConfig: GatewayConfig;
  private modelConfig: ModelConfig;
  private tokenLimit: number;

  constructor(options: SubagentManagerOptions) {
    this.workdir = options.workdir;
    this.parentToolManager = options.parentToolManager;
    this.parentMessageManager = options.parentMessageManager;
    this.logger = options.logger;
    this.gatewayConfig = options.gatewayConfig;
    this.modelConfig = options.modelConfig;
    this.tokenLimit = options.tokenLimit;
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
   * Find best matching subagent based on description
   */
  async findBestMatch(description: string) {
    const { findBestMatch } = await import("../utils/subagentParser.js");
    return findBestMatch(description, this.workdir);
  }

  /**
   * Create a new subagent instance with isolated managers
   */
  async createInstance(
    configuration: SubagentConfiguration,
    taskDescription: string,
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
      // These callbacks will be handled by the parent agent
      onMessagesChange: (messages: Message[]) => {
        const instance = this.instances.get(subagentId);
        if (instance) {
          instance.messages = messages;
          // Update parent's subagent block with latest messages
          this.parentMessageManager.updateSubagentBlock(subagentId, {
            messages: messages,
          });
        }
      },
    };

    const messageManager = new MessageManager({
      callbacks: subagentCallbacks,
      workdir: this.workdir,
      logger: this.logger,
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
      gatewayConfig: this.gatewayConfig,
      modelConfig: {
        ...this.modelConfig,
        agentModel: modelToUse,
      },
      tokenLimit: this.tokenLimit,
    });

    const instance: SubagentInstance = {
      subagentId,
      configuration,
      aiManager,
      messageManager,
      toolManager,
      status: "initializing",
      taskDescription,
      messages: [],
    };

    this.instances.set(subagentId, instance);

    // Create subagent block in parent message manager
    this.parentMessageManager.addSubagentBlock(
      subagentId,
      configuration.name,
      "active",
      [],
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
  ): Promise<string> {
    try {
      // Set status to active and update parent
      this.updateInstanceStatus(instance.subagentId, "active");
      this.parentMessageManager.updateSubagentBlock(instance.subagentId, {
        status: "active",
      });

      // Add the user's prompt as a message
      instance.messageManager.addUserMessage(prompt);

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
      await instance.aiManager.sendAIMessage({
        allowedTools,
        model:
          instance.configuration.model !== "inherit"
            ? instance.configuration.model
            : undefined,
      });

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

      // Update status to completed and update parent with final messages
      this.updateInstanceStatus(instance.subagentId, "completed");
      this.parentMessageManager.updateSubagentBlock(instance.subagentId, {
        status: "completed",
        messages: messages,
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
   * Clean up completed or errored instances
   */
  cleanupInstance(subagentId: string): void {
    const instance = this.instances.get(subagentId);
    if (
      instance &&
      (instance.status === "completed" || instance.status === "error")
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
