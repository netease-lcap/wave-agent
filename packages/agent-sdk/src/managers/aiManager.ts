import {
  callAgent,
  compressMessages,
  type CallAgentOptions,
} from "../services/aiService.js";
import { getMessagesToCompress } from "../utils/messageOperations.js";
import { convertMessagesForAPI } from "../utils/convertMessagesForAPI.js";
import { calculateComprehensiveTotalTokens } from "../utils/tokenCalculation.js";
import * as memory from "../services/memory.js";
import type {
  Logger,
  GatewayConfig,
  ModelConfig,
  Usage,
} from "../types/index.js";
import type { ToolManager } from "./toolManager.js";
import type { ToolContext, ToolResult } from "../tools/types.js";
import type { MessageManager } from "./messageManager.js";
import type { BackgroundBashManager } from "./backgroundBashManager.js";
import { ChatCompletionMessageFunctionToolCall } from "openai/resources.js";
import type { HookManager } from "./hookManager.js";
import type { ExtendedHookExecutionContext } from "../types/hooks.js";

export interface AIManagerCallbacks {
  onCompressionStateChange?: (isCompressing: boolean) => void;
  onUsageAdded?: (usage: Usage) => void;
}

export interface AIManagerOptions {
  messageManager: MessageManager;
  toolManager: ToolManager;
  logger?: Logger;
  backgroundBashManager?: BackgroundBashManager;
  hookManager?: HookManager;
  callbacks?: AIManagerCallbacks;
  workdir: string;
  systemPrompt?: string;
  subagentType?: string; // Optional subagent type for hook context
  /**Whether to use streaming mode for AI responses - defaults to true */
  stream?: boolean;
  // Dynamic configuration getters
  getGatewayConfig: () => GatewayConfig;
  getModelConfig: () => ModelConfig;
  getTokenLimit: () => number;
  getEnvironmentVars?: () => Record<string, string>; // Get configuration environment variables for hooks
}

export class AIManager {
  public isLoading: boolean = false;
  private abortController: AbortController | null = null;
  private toolAbortController: AbortController | null = null;
  private logger?: Logger;
  private toolManager: ToolManager;
  private messageManager: MessageManager;
  private backgroundBashManager?: BackgroundBashManager;
  private hookManager?: HookManager;
  private workdir: string;
  private systemPrompt?: string;
  private subagentType?: string; // Store subagent type for hook context
  private stream: boolean; // Streaming mode flag

  // Configuration properties (replaced with getter function storage)
  private getGatewayConfigFn: () => GatewayConfig;
  private getModelConfigFn: () => ModelConfig;
  private getTokenLimitFn: () => number;
  private getEnvironmentVarsFn?: () => Record<string, string>;

  constructor(options: AIManagerOptions) {
    this.messageManager = options.messageManager;
    this.toolManager = options.toolManager;
    this.backgroundBashManager = options.backgroundBashManager;
    this.hookManager = options.hookManager;
    this.logger = options.logger;
    this.workdir = options.workdir;
    this.systemPrompt = options.systemPrompt;
    this.subagentType = options.subagentType; // Store subagent type
    this.stream = options.stream ?? true; // Default to true if not specified
    this.callbacks = options.callbacks ?? {};

    // Store configuration getter functions for dynamic resolution
    this.getGatewayConfigFn = options.getGatewayConfig;
    this.getModelConfigFn = options.getModelConfig;
    this.getTokenLimitFn = options.getTokenLimit;
    this.getEnvironmentVarsFn = options.getEnvironmentVars;
  }

  // Getter methods for accessing dynamic configuration
  public getGatewayConfig(): GatewayConfig {
    return this.getGatewayConfigFn();
  }

  public getModelConfig(): ModelConfig {
    return this.getModelConfigFn();
  }

  public getTokenLimit(): number {
    return this.getTokenLimitFn();
  }

  private isCompressing: boolean = false;
  private callbacks: AIManagerCallbacks;

  /**
   * Get filtered tool configuration
   */
  private getFilteredToolsConfig(allowedTools?: string[]) {
    const allTools = this.toolManager.getToolsConfig();

    // If no allowedTools specified, return all tools
    if (!allowedTools || allowedTools.length === 0) {
      return allTools;
    }

    // Filter allowed tools
    return allTools.filter((tool) => allowedTools.includes(tool.function.name));
  }

  public setIsLoading(isLoading: boolean): void {
    this.isLoading = isLoading;
  }

  public abortAIMessage(): void {
    // Interrupt AI service
    if (this.abortController) {
      try {
        this.abortController.abort();
      } catch (error) {
        this.logger?.error("Failed to abort AI service:", error);
      }
    }

    // Interrupt tool execution
    if (this.toolAbortController) {
      try {
        this.toolAbortController.abort();
      } catch (error) {
        this.logger?.error("Failed to abort tool execution:", error);
      }
    }

    this.setIsLoading(false);
  }

  // Helper method to generate compactParams
  private generateCompactParams(
    toolName: string,
    toolArgs: Record<string, unknown>,
  ): string {
    try {
      const toolPlugin = this.toolManager
        .list()
        .find((plugin) => plugin.name === toolName);
      if (toolPlugin?.formatCompactParams) {
        const context: ToolContext = {
          workdir: this.workdir,
        };
        return toolPlugin.formatCompactParams(toolArgs, context);
      }
    } catch (error) {
      this.logger?.warn("Failed to generate compactParams", error);
    }
    return "";
  }

  // Private method to handle token statistics and message compression
  private async handleTokenUsageAndCompression(
    usage: Usage | undefined,
    abortController: AbortController,
  ): Promise<void> {
    if (!usage) return;

    // Update token statistics - display comprehensive token usage including cache tokens
    const comprehensiveTotalTokens = calculateComprehensiveTotalTokens(usage);
    this.messageManager.setlatestTotalTokens(comprehensiveTotalTokens);

    // Check if token limit exceeded - use injected configuration
    if (
      usage.total_tokens +
        (usage.cache_read_input_tokens || 0) +
        (usage.cache_creation_input_tokens || 0) >
      this.getTokenLimit()
    ) {
      this.logger?.debug(
        `Token usage exceeded ${this.getTokenLimit()}, compressing messages...`,
      );

      // Check if messages need compression
      const { messagesToCompress, insertIndex } = getMessagesToCompress(
        this.messageManager.getMessages(),
        7,
      );

      // If there are messages to compress, perform compression
      if (messagesToCompress.length > 0) {
        const recentChatMessages = convertMessagesForAPI(messagesToCompress);

        // Save session before compression to preserve original messages
        await this.messageManager.saveSession();

        this.setIsCompressing(true);
        try {
          const compressionResult = await compressMessages({
            gatewayConfig: this.getGatewayConfig(),
            modelConfig: this.getModelConfig(),
            messages: recentChatMessages,
            abortSignal: abortController.signal,
          });

          // Handle usage tracking for compression operations
          let compressionUsage: Usage | undefined;
          if (compressionResult.usage) {
            compressionUsage = {
              prompt_tokens: compressionResult.usage.prompt_tokens,
              completion_tokens: compressionResult.usage.completion_tokens,
              total_tokens: compressionResult.usage.total_tokens,
              model: this.getModelConfig().fastModel,
              operation_type: "compress",
            };
          }

          // Execute message reconstruction and sessionId update after compression
          this.messageManager.compressMessagesAndUpdateSession(
            insertIndex,
            compressionResult.content,
            compressionUsage,
          );

          // Notify Agent to add to usage tracking
          if (compressionUsage && this.callbacks?.onUsageAdded) {
            this.callbacks.onUsageAdded(compressionUsage);
          }

          this.logger?.debug(
            `Successfully compressed ${messagesToCompress.length} messages and updated session`,
          );
        } catch (compressError) {
          this.logger?.error("Failed to compress messages:", compressError);
        } finally {
          this.setIsCompressing(false);
        }
      }
    }
  }

  public getIsCompressing(): boolean {
    return this.isCompressing;
  }

  public setIsCompressing(isCompressing: boolean): void {
    if (this.isCompressing !== isCompressing) {
      this.isCompressing = isCompressing;
      this.callbacks.onCompressionStateChange?.(isCompressing);
    }
  }

  public async sendAIMessage(
    options: {
      recursionDepth?: number;
      model?: string;
      allowedTools?: string[];
    } = {},
  ): Promise<void> {
    const { recursionDepth = 0, model, allowedTools } = options;

    // Only check isLoading for the initial call (recursionDepth === 0)
    if (recursionDepth === 0 && this.isLoading) {
      return;
    }

    // Save session in each recursion to ensure message persistence
    await this.messageManager.saveSession();

    // Only create new AbortControllers for the initial call (recursionDepth === 0)
    // For recursive calls, reuse existing controllers to maintain abort signal
    let abortController: AbortController;
    let toolAbortController: AbortController;

    if (recursionDepth === 0) {
      // Create new AbortControllers for initial call
      abortController = new AbortController();
      this.abortController = abortController;

      toolAbortController = new AbortController();
      this.toolAbortController = toolAbortController;
    } else {
      // Reuse existing controllers for recursive calls
      abortController = this.abortController!;
      toolAbortController = this.toolAbortController!;
    }

    // Only set loading state for the initial call
    if (recursionDepth === 0) {
      this.setIsLoading(true);
    }

    // Get recent message history
    const recentMessages = convertMessagesForAPI(
      this.messageManager.getMessages(),
    );

    try {
      // Get combined memory content
      const combinedMemory = await memory.getCombinedMemoryContent(
        this.workdir,
      );

      // Track if assistant message has been created
      let assistantMessageCreated = false;

      this.logger?.debug("modelConfig in sendAIMessage", this.getModelConfig());

      // Call AI service with streaming callbacks if enabled
      const callAgentOptions: CallAgentOptions = {
        gatewayConfig: this.getGatewayConfig(),
        modelConfig: this.getModelConfig(),
        messages: recentMessages,
        sessionId: this.messageManager.getSessionId(),
        abortSignal: abortController.signal,
        memory: combinedMemory, // Pass combined memory content
        workdir: this.workdir, // Pass working directory
        tools: this.getFilteredToolsConfig(allowedTools), // Pass filtered tool configuration
        model: model, // Use passed model
        systemPrompt: this.systemPrompt, // Pass custom system prompt
      };

      // Add streaming callbacks only if streaming is enabled
      if (this.stream) {
        callAgentOptions.onContentUpdate = (content: string) => {
          // Create assistant message on first chunk if not already created
          if (!assistantMessageCreated) {
            this.messageManager.addAssistantMessage();
            assistantMessageCreated = true;
          }
          this.messageManager.updateCurrentMessageContent(content);
        };
        callAgentOptions.onToolUpdate = (toolCall) => {
          // Create assistant message on first tool update if not already created
          if (!assistantMessageCreated) {
            this.messageManager.addAssistantMessage();
            assistantMessageCreated = true;
          }

          // Use parametersChunk as compact param for better performance
          // No need to extract params or generate compact params during streaming

          // Update tool block with streaming parameters using parametersChunk as compact param
          this.messageManager.updateToolBlock({
            id: toolCall.id,
            name: toolCall.name,
            parameters: toolCall.parameters,
            parametersChunk: toolCall.parametersChunk,
            compactParams: toolCall.parameters?.split("\n").pop()?.slice(-30),
            stage: toolCall.stage || "streaming", // Default to streaming if stage not provided
          });
        };
        callAgentOptions.onReasoningUpdate = (reasoning: string) => {
          // Create assistant message on first reasoning update if not already created
          if (!assistantMessageCreated) {
            this.messageManager.addAssistantMessage();
            assistantMessageCreated = true;
          }
          this.messageManager.updateCurrentMessageReasoning(reasoning);
        };
      }

      const result = await callAgent(callAgentOptions);

      // For non-streaming mode, create assistant message after callAgent returns
      // Also create if streaming mode but no streaming callbacks were called (e.g., when content comes directly in result)
      if (
        !this.stream ||
        (!assistantMessageCreated &&
          (result.content || result.tool_calls || result.reasoning_content))
      ) {
        this.messageManager.addAssistantMessage();
        assistantMessageCreated = true;
      }

      // Log finish reason and response headers if available
      if (result.finish_reason) {
        this.logger?.debug(
          `AI response finished with reason: ${result.finish_reason}`,
        );
      }
      if (
        result.response_headers &&
        Object.keys(result.response_headers).length > 0
      ) {
        this.logger?.debug("AI response headers:", result.response_headers);
      }

      if (result.metadata && Object.keys(result.metadata).length > 0) {
        this.messageManager.mergeAssistantMetadata(result.metadata);
      }

      // Handle result reasoning content from non-streaming mode
      if (result.reasoning_content) {
        this.messageManager.updateCurrentMessageReasoning(
          result.reasoning_content,
        );
      }

      // Handle result content from non-streaming mode
      if (result.content) {
        this.messageManager.updateCurrentMessageContent(result.content);
      }

      // Handle usage tracking for agent operations
      let usage: Usage | undefined;
      if (result.usage) {
        usage = {
          prompt_tokens: result.usage.prompt_tokens,
          completion_tokens: result.usage.completion_tokens,
          total_tokens: result.usage.total_tokens,
          model: model || this.getModelConfig().agentModel,
          operation_type: "agent",
          // Preserve cache fields if present
          ...(result.usage.cache_read_input_tokens !== undefined && {
            cache_read_input_tokens: result.usage.cache_read_input_tokens,
          }),
          ...(result.usage.cache_creation_input_tokens !== undefined && {
            cache_creation_input_tokens:
              result.usage.cache_creation_input_tokens,
          }),
          ...(result.usage.cache_creation && {
            cache_creation: result.usage.cache_creation,
          }),
        };
      }

      // Set usage on the assistant message if available
      if (usage) {
        const messages = this.messageManager.getMessages();
        const lastMessage = messages[messages.length - 1];
        if (lastMessage && lastMessage.role === "assistant") {
          lastMessage.usage = usage;
          this.messageManager.setMessages(messages);
        }

        // Notify Agent to add to usage tracking
        if (this.callbacks?.onUsageAdded) {
          this.callbacks.onUsageAdded(usage);
        }
      }

      // Collect tool calls for processing
      const toolCalls: ChatCompletionMessageFunctionToolCall[] = [];
      if (result.tool_calls) {
        for (const toolCall of result.tool_calls) {
          if (toolCall.type === "function") {
            toolCalls.push(toolCall);
          }
        }
      }

      if (toolCalls.length > 0) {
        // Execute all tools in parallel using Promise.all
        const toolExecutionPromises = toolCalls.map(
          async (functionToolCall) => {
            const toolId = functionToolCall.id || "";

            // Check if already interrupted, skip tool execution if so
            if (
              abortController.signal.aborted ||
              toolAbortController.signal.aborted
            ) {
              return;
            }

            const toolName = functionToolCall.function?.name || "";
            // Safely parse tool parameters, handle tools without parameters
            let toolArgs: Record<string, unknown> = {};
            const argsString = functionToolCall.function?.arguments?.trim();

            if (!argsString || argsString === "") {
              // Tool without parameters, use empty object
              toolArgs = {};
            } else {
              try {
                toolArgs = JSON.parse(argsString);
              } catch (parseError) {
                // For non-empty but malformed JSON, still throw exception
                const errorMessage = `Failed to parse tool arguments, finish_reason: ${result.finish_reason}`;
                const fullErrorMessage = `${errorMessage}\nAI response headers:, ${JSON.stringify(result.response_headers)}`;
                this.logger?.error(fullErrorMessage, parseError);
                this.messageManager.updateToolBlock({
                  id: toolId,
                  parameters: argsString,
                  result: errorMessage,
                  success: false,
                  error: fullErrorMessage,
                  stage: "end",
                  name: toolName,
                  compactParams: "",
                });
                return;
              }
            }

            const compactParams = this.generateCompactParams(
              toolName,
              toolArgs,
            );

            // Emit running stage for non-streaming tool calls (tool execution about to start)
            this.messageManager.updateToolBlock({
              id: toolId,
              stage: "running",
              name: toolName,
              compactParams,
              parameters: argsString,
              parametersChunk: "",
            });

            try {
              // Execute PreToolUse hooks before tool execution
              const shouldExecuteTool = await this.executePreToolUseHooks(
                toolName,
                toolArgs,
                toolId,
              );

              // If PreToolUse hooks blocked execution, skip tool execution
              if (!shouldExecuteTool) {
                this.logger?.info(
                  `Tool ${toolName} execution blocked by PreToolUse hooks`,
                );
                return; // Skip this tool and return from this map function
              }

              // Create tool execution context
              const context: ToolContext = {
                abortSignal: toolAbortController.signal,
                backgroundBashManager: this.backgroundBashManager,
                workdir: this.workdir,
              };

              // Execute tool
              const toolResult = await this.toolManager.execute(
                functionToolCall.function?.name || "",
                toolArgs,
                context,
              );

              // Update message state - tool execution completed
              this.messageManager.updateToolBlock({
                id: toolId,
                parameters: argsString,
                result:
                  toolResult.content ||
                  (toolResult.error ? `Error: ${toolResult.error}` : ""),
                success: toolResult.success,
                error: toolResult.error,
                stage: "end",
                name: toolName,
                shortResult: toolResult.shortResult,
              });

              // Execute PostToolUse hooks after successful tool completion
              await this.executePostToolUseHooks(
                toolId,
                toolName,
                toolArgs,
                toolResult,
              );
            } catch (toolError) {
              const errorMessage =
                toolError instanceof Error
                  ? toolError.message
                  : String(toolError);

              this.messageManager.updateToolBlock({
                id: toolId,
                parameters: JSON.stringify(toolArgs, null, 2),
                result: `Tool execution failed: ${errorMessage}`,
                success: false,
                error: errorMessage,
                stage: "end",
                name: toolName,
                compactParams,
              });
            }
          },
        );

        // Wait for all tools to complete execution in parallel
        await Promise.all(toolExecutionPromises);
      }

      // Handle token statistics and message compression
      await this.handleTokenUsageAndCompression(result.usage, abortController);

      // Check if there are tool operations, if so automatically initiate next AI service call
      if (toolCalls.length > 0) {
        // Check interruption status
        const isCurrentlyAborted =
          abortController.signal.aborted || toolAbortController.signal.aborted;

        if (!isCurrentlyAborted) {
          // Recursively call AI service, increment recursion depth, and pass same configuration
          await this.sendAIMessage({
            recursionDepth: recursionDepth + 1,
            model,
            allowedTools,
          });
        }
      }
    } catch (error) {
      this.messageManager.addErrorBlock(
        error instanceof Error ? error.message : "Unknown error occurred",
      );
    } finally {
      // Only execute cleanup and hooks for the initial call
      if (recursionDepth === 0) {
        // Save session in each recursion to ensure message persistence
        await this.messageManager.saveSession();
        // Set loading to false first
        this.setIsLoading(false);

        // Clear abort controllers
        this.abortController = null;
        this.toolAbortController = null;

        // Execute Stop/SubagentStop hooks only if the operation was not aborted
        const isCurrentlyAborted =
          abortController.signal.aborted || toolAbortController.signal.aborted;

        if (!isCurrentlyAborted) {
          const shouldContinue = await this.executeStopHooks();

          // If Stop/SubagentStop hooks indicate we should continue (due to blocking errors),
          // restart the AI conversation cycle
          if (shouldContinue) {
            this.logger?.info(
              `${this.subagentType ? "SubagentStop" : "Stop"} hooks indicate issues need fixing, continuing conversation...`,
            );

            // Restart the conversation to let AI fix the issues
            // Use recursionDepth = 0 to set loading false again for continuation
            await this.sendAIMessage({
              recursionDepth: 0,
              model,
              allowedTools,
            });
          }
        }
      }
    }
  }

  /**
   * Execute Stop or SubagentStop hooks when AI response cycle completes
   * Uses "SubagentStop" hook name when triggered by a subagent, otherwise uses "Stop"
   * @returns Promise<boolean> - true if should continue conversation, false if should stop
   */
  private async executeStopHooks(): Promise<boolean> {
    if (!this.hookManager) return false;

    try {
      // Use "SubagentStop" hook name when triggered by a subagent, otherwise use "Stop"
      const hookName = this.subagentType ? "SubagentStop" : "Stop";

      const context: ExtendedHookExecutionContext = {
        event: hookName,
        projectDir: this.workdir,
        timestamp: new Date(),
        sessionId: this.messageManager.getSessionId(),
        transcriptPath: this.messageManager.getTranscriptPath(),
        cwd: this.workdir,
        subagentType: this.subagentType, // Include subagent type in hook context
        // Stop hooks don't need toolName, toolInput, toolResponse, or userPrompt
        env: this.getEnvironmentVarsFn?.() || {}, // Include configuration environment variables
      };

      const results = await this.hookManager.executeHooks(hookName, context);

      // Process hook results to handle exit codes and appropriate responses
      let shouldContinue = false;
      if (results.length > 0) {
        const processResult = this.hookManager.processHookResults(
          hookName,
          results,
          this.messageManager,
        );

        // If hook processing indicates we should block (exit code 2), continue conversation
        if (processResult.shouldBlock) {
          this.logger?.info(
            `${hookName} hook blocked stopping with error:`,
            processResult.errorMessage,
          );
          shouldContinue = true;
        }
      }

      // Log hook execution results for debugging
      if (results.length > 0) {
        this.logger?.debug(
          `Executed ${results.length} ${hookName} hook(s):`,
          results.map((r) => ({
            success: r.success,
            duration: r.duration,
            exitCode: r.exitCode,
            timedOut: r.timedOut,
            stderr: r.stderr,
          })),
        );
      }

      return shouldContinue;
    } catch (error) {
      // Hook execution errors should not interrupt the main workflow
      this.logger?.error(
        `${this.subagentType ? "SubagentStop" : "Stop"} hook execution failed:`,
        error,
      );
      return false;
    }
  }

  /**
   * Execute PreToolUse hooks before tool execution
   * Returns true if hooks allow tool execution, false if blocked
   */
  private async executePreToolUseHooks(
    toolName: string,
    toolInput?: Record<string, unknown>,
    toolId?: string,
  ): Promise<boolean> {
    if (!this.hookManager) return true;

    try {
      const context: ExtendedHookExecutionContext = {
        event: "PreToolUse",
        projectDir: this.workdir,
        timestamp: new Date(),
        toolName,
        sessionId: this.messageManager.getSessionId(),
        transcriptPath: this.messageManager.getTranscriptPath(),
        cwd: this.workdir,
        toolInput,
        subagentType: this.subagentType, // Include subagent type in hook context
        env: this.getEnvironmentVarsFn?.() || {}, // Include configuration environment variables
      };

      const results = await this.hookManager.executeHooks(
        "PreToolUse",
        context,
      );

      // Process hook results to handle exit codes and determine if tool should be blocked
      let shouldContinue = true;
      if (results.length > 0) {
        const processResult = this.hookManager.processHookResults(
          "PreToolUse",
          results,
          this.messageManager,
          toolId, // Pass toolId for proper PreToolUse blocking error handling
          JSON.stringify(toolInput || {}, null, 2), // Pass serialized tool parameters
        );
        shouldContinue = !processResult.shouldBlock;
      }

      // Log hook execution results for debugging
      if (results.length > 0) {
        this.logger?.debug(
          `Executed ${results.length} PreToolUse hook(s) for ${toolName}:`,
          results.map((r) => ({
            success: r.success,
            duration: r.duration,
            exitCode: r.exitCode,
            timedOut: r.timedOut,
            stderr: r.stderr,
          })),
        );
      }

      return shouldContinue;
    } catch (error) {
      // Hook execution errors should not interrupt the main workflow
      this.logger?.error("PreToolUse hook execution failed:", error);
      return true; // Allow tool execution on hook errors
    }
  }

  /**
   * Execute PostToolUse hooks after tool completion
   */
  private async executePostToolUseHooks(
    toolId: string,
    toolName: string,
    toolInput?: Record<string, unknown>,
    toolResponse?: ToolResult,
  ): Promise<void> {
    if (!this.hookManager) return;

    try {
      const context: ExtendedHookExecutionContext = {
        event: "PostToolUse",
        projectDir: this.workdir,
        timestamp: new Date(),
        toolName,
        sessionId: this.messageManager.getSessionId(),
        transcriptPath: this.messageManager.getTranscriptPath(),
        cwd: this.workdir,
        toolInput,
        toolResponse,
        subagentType: this.subagentType, // Include subagent type in hook context
        env: this.getEnvironmentVarsFn?.() || {}, // Include configuration environment variables
      };

      const results = await this.hookManager.executeHooks(
        "PostToolUse",
        context,
      );

      // Process hook results to handle exit codes and update tool results
      if (results.length > 0) {
        this.hookManager.processHookResults(
          "PostToolUse",
          results,
          this.messageManager,
          toolId,
        );
      }

      // Log hook execution results for debugging
      if (results.length > 0) {
        this.logger?.debug(
          `Executed ${results.length} PostToolUse hook(s) for ${toolName}:`,
          results.map((r) => ({
            success: r.success,
            duration: r.duration,
            exitCode: r.exitCode,
            timedOut: r.timedOut,
            stderr: r.stderr,
          })),
        );
      }
    } catch (error) {
      // Hook execution errors should not interrupt the main workflow
      this.logger?.error("PostToolUse hook execution failed:", error);
    }
  }
}
