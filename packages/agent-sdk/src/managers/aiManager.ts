import { callAgent, compressMessages } from "../services/aiService.js";
import { getMessagesToCompress } from "../utils/messageOperations.js";
import { convertMessagesForAPI } from "../utils/convertMessagesForAPI.js";
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
  // Resolved configuration
  gatewayConfig: GatewayConfig;
  modelConfig: ModelConfig;
  tokenLimit: number;
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

  // Configuration properties
  private gatewayConfig: GatewayConfig;
  private modelConfig: ModelConfig;
  private tokenLimit: number;

  constructor(options: AIManagerOptions) {
    this.messageManager = options.messageManager;
    this.toolManager = options.toolManager;
    this.backgroundBashManager = options.backgroundBashManager;
    this.hookManager = options.hookManager;
    this.logger = options.logger;
    this.workdir = options.workdir;
    this.systemPrompt = options.systemPrompt;
    this.callbacks = options.callbacks ?? {};

    // Store resolved configuration
    this.gatewayConfig = options.gatewayConfig;
    this.modelConfig = options.modelConfig;
    this.tokenLimit = options.tokenLimit;
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
    usage: { total_tokens: number } | undefined,
    abortController: AbortController,
  ): Promise<void> {
    if (!usage) return;

    // Update token statistics - display latest token usage
    this.messageManager.setlatestTotalTokens(usage.total_tokens);

    // Check if token limit exceeded - use injected configuration
    if (usage.total_tokens > this.tokenLimit) {
      this.logger?.debug(
        `Token usage exceeded ${this.tokenLimit}, compressing messages...`,
      );

      // Check if messages need compression
      const { messagesToCompress, insertIndex } = getMessagesToCompress(
        this.messageManager.getMessages(),
        7,
      );

      // If there are messages to compress, perform compression
      if (messagesToCompress.length > 0) {
        const recentChatMessages = convertMessagesForAPI(messagesToCompress);

        this.setIsCompressing(true);
        try {
          const compressionResult = await compressMessages({
            gatewayConfig: this.gatewayConfig,
            modelConfig: this.modelConfig,
            messages: recentChatMessages,
            abortSignal: abortController.signal,
          });

          // Execute message reconstruction and sessionId update after compression
          this.messageManager.compressMessagesAndUpdateSession(
            insertIndex,
            compressionResult.content,
          );

          // Handle usage tracking for compression operations
          if (compressionResult.usage) {
            const usage: Usage = {
              prompt_tokens: compressionResult.usage.prompt_tokens,
              completion_tokens: compressionResult.usage.completion_tokens,
              total_tokens: compressionResult.usage.total_tokens,
              model: this.modelConfig.fastModel,
              operation_type: "compress",
            };

            // Notify Agent to add to usage tracking
            if (this.callbacks?.onUsageAdded) {
              this.callbacks.onUsageAdded(usage);
            }
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

      // Add assistant message first (for streaming updates)
      this.messageManager.addAssistantMessage();

      // Call AI service with streaming callbacks
      const result = await callAgent({
        gatewayConfig: this.gatewayConfig,
        modelConfig: this.modelConfig,
        messages: recentMessages,
        sessionId: this.messageManager.getSessionId(),
        abortSignal: abortController.signal,
        memory: combinedMemory, // Pass combined memory content
        workdir: this.workdir, // Pass working directory
        tools: this.getFilteredToolsConfig(allowedTools), // Pass filtered tool configuration
        model: model, // Use passed model
        systemPrompt: this.systemPrompt, // Pass custom system prompt
        // Streaming callbacks
        onContentUpdate: (content: string) => {
          this.messageManager.updateCurrentMessageContent(content);
        },
        onToolUpdate: (toolCall) => {
          // Use parametersChunk as compact param for better performance
          // No need to extract params or generate compact params during streaming
          this.logger?.debug("Tool streaming update:", toolCall);

          // Update tool block with streaming parameters using parametersChunk as compact param
          this.messageManager.updateToolBlock({
            id: toolCall.id,
            name: toolCall.name,
            parameters: toolCall.parameters,
            parametersChunk: toolCall.parametersChunk,
            compactParams: toolCall.parameters?.split("\n").pop()?.slice(-30),
            stage: toolCall.stage || "streaming", // Default to streaming if stage not provided
          });
        },
      });

      if (result.metadata && Object.keys(result.metadata).length > 0) {
        this.messageManager.mergeAssistantMetadata(result.metadata);
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
          model: model || this.modelConfig.agentModel,
          operation_type: "agent",
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

            try {
              // Check if already interrupted, skip tool execution if so
              if (
                abortController.signal.aborted ||
                toolAbortController.signal.aborted
              ) {
                return;
              }

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
                  const errorMessage = `Failed to parse tool arguments: ${argsString}`;
                  this.logger?.error(errorMessage, parseError);
                  throw new Error(errorMessage);
                }
              }

              const toolName = functionToolCall.function?.name || "";
              const compactParams = this.generateCompactParams(
                toolName,
                toolArgs,
              );

              // Emit running stage for non-streaming tool calls (tool execution about to start)
              this.messageManager.updateToolBlock({
                id: toolId,
                stage: "running",
                name: toolName,
                parameters: "", // Empty parameters for running stage
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
                  parameters: JSON.stringify(toolArgs, null, 2),
                  result:
                    toolResult.content ||
                    (toolResult.error ? `Error: ${toolResult.error}` : ""),
                  success: toolResult.success,
                  error: toolResult.error,
                  stage: "end",
                  name: toolName,
                  shortResult: toolResult.shortResult,
                  compactParams,
                });

                // If tool returns diff information, add diff block
                if (
                  toolResult.success &&
                  toolResult.diffResult &&
                  toolResult.filePath
                ) {
                  this.messageManager.addDiffBlock(
                    toolResult.filePath,
                    toolResult.diffResult,
                  );
                }

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
            } catch (parseError) {
              const errorMessage =
                parseError instanceof Error
                  ? parseError.message
                  : String(parseError);
              this.messageManager.addErrorBlock(
                `Failed to parse tool arguments for ${functionToolCall.function?.name}: ${errorMessage}`,
              );
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
      // Only execute Stop hooks for the initial call
      if (recursionDepth === 0) {
        // Execute Stop hooks only if the operation was not aborted
        const isCurrentlyAborted =
          abortController.signal.aborted || toolAbortController.signal.aborted;

        if (!isCurrentlyAborted) {
          const shouldContinue = await this.executeStopHooks();

          // If Stop hooks indicate we should continue (due to blocking errors),
          // restart the AI conversation cycle
          if (shouldContinue) {
            this.logger?.info(
              "Stop hooks indicate issues need fixing, continuing conversation...",
            );

            // Restart the conversation to let AI fix the issues
            // Use recursionDepth = 1 to prevent Stop hooks from running again in continuation
            await this.sendAIMessage({
              recursionDepth: 1,
              model,
              allowedTools,
            });
          }
        }

        // Save session after all operations (including continuation) are complete
        await this.messageManager.saveSession();

        // Clear abort controllers and loading state after all operations are complete
        this.abortController = null;
        this.toolAbortController = null;

        // Set loading to false at the very end, after all operations including continuation
        this.setIsLoading(false);
      }
    }
  }

  /**
   * Execute Stop hooks when AI response cycle completes
   * @returns Promise<boolean> - true if should continue conversation, false if should stop
   */
  private async executeStopHooks(): Promise<boolean> {
    if (!this.hookManager) return false;

    try {
      const context: ExtendedHookExecutionContext = {
        event: "Stop",
        projectDir: this.workdir,
        timestamp: new Date(),
        sessionId: this.messageManager.getSessionId(),
        transcriptPath: this.messageManager.getTranscriptPath(),
        cwd: this.workdir,
        // Stop hooks don't need toolName, toolInput, toolResponse, or userPrompt
      };

      const results = await this.hookManager.executeHooks("Stop", context);

      // Process hook results to handle exit codes and appropriate responses
      let shouldContinue = false;
      if (results.length > 0) {
        const processResult = this.hookManager.processHookResults(
          "Stop",
          results,
          this.messageManager,
        );

        // If hook processing indicates we should block (exit code 2), continue conversation
        if (processResult.shouldBlock) {
          this.logger?.info(
            "Stop hook blocked stopping with error:",
            processResult.errorMessage,
          );
          shouldContinue = true;
        }
      }

      // Log hook execution results for debugging
      if (results.length > 0) {
        this.logger?.debug(
          `Executed ${results.length} Stop hook(s):`,
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
      this.logger?.error("Stop hook execution failed:", error);
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
