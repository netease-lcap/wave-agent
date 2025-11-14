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
import type { 
  ExtendedHookExecutionContext, 
  PermissionDecision, 
  PendingPermission,
  PreToolUseOutput,
  PostToolUseOutput,
  StopOutput
} from "../types/hooks.js";
import { parseHookOutput } from "../utils/hookOutputParser.js";

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

  // Permission management
  private pendingPermissions: Map<string, PendingPermission & {
    toolId: string;
    toolArgs: Record<string, unknown>;
    compactParams?: string;
  }> = new Map();

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

  /**
   * Resolve a permission request with user's decision
   */
  public async resolvePermissionRequest(permissionId: string, decision: PermissionDecision): Promise<boolean> {
    const pendingPermission = this.pendingPermissions.get(permissionId);
    if (!pendingPermission) {
      this.logger?.warn(`Permission request ${permissionId} not found`);
      return false;
    }

    this.logger?.info(
      `Resolving permission ${permissionId} for tool ${pendingPermission.toolName}: ${decision.decision} (continue: ${decision.shouldContinueRecursion})`
    );

    // Call the onResolve callback
    pendingPermission.onResolve(decision);

    // Handle the permission decision
    if (decision.decision === "allow" && decision.shouldContinueRecursion) {
      // Permission granted, continue with tool execution
      this.logger?.info(`Permission granted for tool ${pendingPermission.toolName}, continuing execution`);
      
      // Use the updated input if available, otherwise use original
      const finalToolArgs = pendingPermission.updatedInput || pendingPermission.originalInput;
      
      // Continue tool execution
      await this.continueToolExecution(
        pendingPermission.toolId,
        pendingPermission.toolName,
        pendingPermission.toolArgs,
        finalToolArgs
      );
    } else {
      // Permission denied or user chose not to continue
      this.logger?.info(`Permission denied or execution halted for tool ${pendingPermission.toolName}`);
      
      // Update the tool block to show denial
      this.messageManager.updateToolBlock({
        toolId: pendingPermission.toolId,
        isRunning: false,
        error: `Tool execution denied: ${decision.reason || "User denied permission"}`,
      });
    }
    
    // Remove from pending permissions
    this.pendingPermissions.delete(permissionId);

    return true;
  }

  /**
   * Get all pending permission requests (for UI display)
   */
  public getPendingPermissions(): Array<PendingPermission & {
    toolId: string;
    toolArgs: Record<string, unknown>;
    compactParams?: string;
  }> {
    return Array.from(this.pendingPermissions.values());
  }

  /**
   * Check if any permissions are pending
   */
  public isAwaitingPermission(): boolean {
    return this.pendingPermissions.size > 0;
  }

  /**
   * Clear all pending permissions (useful for cleanup)
   */
  public clearPendingPermissions(): void {
    this.pendingPermissions.clear();
  }

  /**
   * Continue tool execution after permission is granted
   */
  public async continueToolExecution(
    toolId: string,
    toolName: string,
    toolArgs: Record<string, unknown>,
    finalToolArgs: Record<string, unknown>
  ): Promise<void> {
    // Ensure we have a tool abort controller (create a temporary one if needed for tests)
    if (!this.toolAbortController) {
      this.logger?.debug("Creating temporary tool abort controller for permission resolution");
      this.toolAbortController = new AbortController();
    }

    try {
      // Create tool execution context
      const context: ToolContext = {
        abortSignal: this.toolAbortController.signal,
        backgroundBashManager: this.backgroundBashManager,
        workdir: this.workdir,
      };

      // Execute tool with updated arguments
      const toolResult = await this.toolManager.execute(
        toolName,
        finalToolArgs,
        context,
      );

      // Update message state - tool execution completed
      this.messageManager.updateToolBlock({
        toolId,
        args: JSON.stringify(toolArgs, null, 2),
        result:
          toolResult.content ||
          (toolResult.error ? `Error: ${toolResult.error}` : ""),
        success: toolResult.success,
        error: toolResult.error,
        isRunning: false,
        name: toolName,
        shortResult: toolResult.shortResult,
        compactParams: this.generateCompactParams(toolName, toolArgs),
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
        toolName,
        finalToolArgs,
        toolResult,
      );
    } catch (toolError) {
      const errorMessage =
        toolError instanceof Error
          ? toolError.message
          : String(toolError);

      this.messageManager.updateToolBlock({
        toolId,
        args: JSON.stringify(toolArgs, null, 2),
        result: `Tool execution failed: ${errorMessage}`,
        success: false,
        error: errorMessage,
        isRunning: false,
        name: toolName,
        compactParams: this.generateCompactParams(toolName, toolArgs),
      });
    }
  }

  // Helper method to generate compactParams
  private generateCompactParams(
    toolName: string,
    toolArgs: Record<string, unknown>,
  ): string | undefined {
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
    return undefined;
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

      // Call AI service (non-streaming)
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
      });

      // Collect content and tool calls
      const content = result.content || "";
      const toolCalls: ChatCompletionMessageFunctionToolCall[] = [];

      if (result.tool_calls) {
        for (const toolCall of result.tool_calls) {
          if (toolCall.type === "function") {
            toolCalls.push(toolCall);
          }
        }
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

      // Add assistant message at once (including content, tool calls, and usage)
      this.messageManager.addAssistantMessage(content, toolCalls, usage);

      // Notify Agent to add to usage tracking
      if (usage) {
        if (this.callbacks?.onUsageAdded) {
          this.callbacks.onUsageAdded(usage);
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

              // Set tool start execution state
              const toolName = functionToolCall.function?.name || "";
              const compactParams = this.generateCompactParams(
                toolName,
                toolArgs,
              );

              this.messageManager.updateToolBlock({
                toolId,
                args: JSON.stringify(toolArgs, null, 2),
                isRunning: true, // isRunning: true
                name: toolName,
                compactParams,
              });

              try {
                // Execute PreToolUse hooks before tool execution
                const preToolResult = await this.executePreToolUseHooks(
                  toolName, 
                  toolArgs, 
                  toolId, 
                  toolArgs, 
                  compactParams
                );

                // Check if tool execution should proceed
                if (!preToolResult.shouldProceed) {
                  if (preToolResult.permissionId) {
                    // Tool execution is awaiting user permission
                    this.messageManager.updateToolBlock({
                      toolId: toolId,
                      isRunning: false,
                      error: "Tool execution awaiting user permission",
                    });
                    this.logger?.info(`Tool ${toolName} awaiting user permission (ID: ${preToolResult.permissionId})`);
                    return; // Skip tool execution but don't block the overall flow
                  } else {
                    // Tool execution was blocked by hook
                    this.messageManager.updateToolBlock({
                      toolId: toolId,
                      isRunning: false,
                      error: "Tool execution blocked by PreToolUse hook (exit code 2)",
                    });
                    return; // Skip to next tool call
                  }
                }

                // Use updated input if provided by hook
                const finalToolArgs = preToolResult.updatedInput || toolArgs;

                // Create tool execution context
                const context: ToolContext = {
                  abortSignal: toolAbortController.signal,
                  backgroundBashManager: this.backgroundBashManager,
                  workdir: this.workdir,
                };

                // Execute tool with potentially updated arguments
                const toolResult = await this.toolManager.execute(
                  functionToolCall.function?.name || "",
                  finalToolArgs,
                  context,
                );

                // Update message state - tool execution completed
                this.messageManager.updateToolBlock({
                  toolId,
                  args: JSON.stringify(toolArgs, null, 2),
                  result:
                    toolResult.content ||
                    (toolResult.error ? `Error: ${toolResult.error}` : ""),
                  success: toolResult.success,
                  error: toolResult.error,
                  isRunning: false, // isRunning: false
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
                  toolName,
                  finalToolArgs, // Use the potentially updated tool arguments
                  toolResult,
                );
              } catch (toolError) {
                const errorMessage =
                  toolError instanceof Error
                    ? toolError.message
                    : String(toolError);

                this.messageManager.updateToolBlock({
                  toolId,
                  args: JSON.stringify(toolArgs, null, 2),
                  result: `Tool execution failed: ${errorMessage}`,
                  success: false,
                  error: errorMessage,
                  isRunning: false,
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
      // Only clear loading state and cleanup for the initial call
      if (recursionDepth === 0) {
        this.setIsLoading(false);

        // Clear abort controllers
        this.abortController = null;
        this.toolAbortController = null;

        // Save session before executing Stop hooks
        await this.messageManager.saveSession();

        // Execute Stop hooks only if the operation was not aborted
        const isCurrentlyAborted =
          abortController.signal.aborted || toolAbortController.signal.aborted;

        if (!isCurrentlyAborted) {
          await this.executeStopHooks();
        }
      }
    }
  }

  /**
   * Execute Stop hooks when AI response cycle completes
   */
  private async executeStopHooks(): Promise<void> {
    if (!this.hookManager) return;

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

      // Process hook output results
      for (const result of results) {
        // Process hook output through message manager
        const hookOutputResult = {
          exitCode: result.exitCode ?? 0,
          stdout: result.stdout ?? "",
          stderr: result.stderr ?? "",
          executionTime: result.duration,
          hookEvent: "Stop" as const,
        };

        // Process output for message blocks
        this.messageManager.processHookOutput(hookOutputResult);

        // Parse hook output using parseHookOutput (implements JSON precedence over exit codes)
        const parsed = parseHookOutput(hookOutputResult);

        // Check for blocking behavior from JSON or exit code
        if (!parsed.continue) {
          const source = parsed.source === "json" ? "JSON output" : `exit code ${result.exitCode}`;
          const reason = parsed.stopReason || "Hook reported blocking condition";
          this.logger?.info(`Stop hook reported blocking condition (${source}): ${reason}`);
        }

        // Handle hook-specific data for Stop
        if (parsed.hookSpecificData && typeof parsed.hookSpecificData === 'object') {
          const hookData = parsed.hookSpecificData as StopOutput;
          if (hookData.decision === 'block') {
            const blockReason = hookData.reason || "Stop hook blocked execution";
            this.logger?.info(`Stop hook blocked execution: ${blockReason}`);
          }
        }

        // Log validation errors if present
        if (parsed.errorMessages && parsed.errorMessages.length > 0) {
          this.logger?.warn(`Stop hook validation issues:`, parsed.errorMessages);
        }

        // Log system message if present
        if (parsed.systemMessage) {
          this.logger?.info(`Stop hook message: ${parsed.systemMessage}`);
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
    } catch (error) {
      // Hook execution errors should not interrupt the main workflow
      this.logger?.error("Stop hook execution failed:", error);
    }
  }

  /**
   * Execute PreToolUse hooks before tool execution
   * Returns true if tool execution should proceed, false if blocked
   */
  private async executePreToolUseHooks(
    toolName: string,
    toolInput?: Record<string, unknown>,
    toolId?: string,
    toolArgs?: Record<string, unknown>,
    compactParams?: string,
  ): Promise<{ shouldProceed: boolean; updatedInput?: Record<string, unknown>; permissionId?: string }> {
    if (!this.hookManager) return { shouldProceed: true };

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

      // Process hook output results
      let shouldProceed = true;
      let updatedInput = toolInput;
      let permissionId: string | undefined;

      for (const result of results) {
        // Process hook output through message manager
        const hookOutputResult = {
          exitCode: result.exitCode ?? 0,
          stdout: result.stdout ?? "",
          stderr: result.stderr ?? "",
          executionTime: result.duration,
          hookEvent: "PreToolUse" as const,
        };

        // Process output for message blocks
        this.messageManager.processHookOutput(hookOutputResult);

        // Parse hook output using parseHookOutput (implements JSON precedence over exit codes)
        const parsed = parseHookOutput(hookOutputResult);

        // Handle hook-specific data for PreToolUse (e.g., permission decisions) FIRST
        if (parsed.hookSpecificData && typeof parsed.hookSpecificData === 'object') {
          const hookData = parsed.hookSpecificData as PreToolUseOutput;
          
          // Handle permission decisions for PreToolUse hooks
          if (hookData.hookEventName === 'PreToolUse' && hookData.permissionDecision === 'ask') {
            // Create a permission request and return shouldProceed: false with permission ID
            const id = `perm_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
            const reason = hookData.permissionDecisionReason || "Hook requires user permission";
            
            const pendingPermission = {
              id,
              toolName,
              reason,
              originalInput: toolInput || {},
              updatedInput: hookData.updatedInput,
              onResolve: (decision: PermissionDecision) => {
                // This will be called when user makes a decision
                // The actual resolution happens in resolvePermissionRequest
                void decision; // Suppress unused parameter warning
              },
              timestamp: Date.now(),
              pauseAIRecursion: () => {
                // Could be used to pause AI execution flow if needed
              },
              resumeAIRecursion: (shouldContinue: boolean) => {
                // Could be used to resume AI execution flow after permission
                void shouldContinue; // Suppress unused parameter warning
              },
              // Store tool execution context for later resumption
              toolId: toolId || "",
              toolArgs: toolArgs || {},
              compactParams,
            };

            this.pendingPermissions.set(id, pendingPermission);
            this.logger?.info(`Permission request created for tool ${toolName}: ${reason}`);
            
            return { 
              shouldProceed: false, 
              updatedInput: hookData.updatedInput || toolInput,
              permissionId: id
            };
          } else if (hookData.hookEventName === 'PreToolUse' && hookData.permissionDecision === 'deny') {
            shouldProceed = false;
            const reason = hookData.permissionDecisionReason || "Hook denied tool execution";
            this.logger?.info(`Tool ${toolName} denied by PreToolUse hook: ${reason}`);
            break;
          } else if (hookData.hookEventName === 'PreToolUse' && hookData.permissionDecision === 'allow' && hookData.updatedInput) {
            updatedInput = hookData.updatedInput;
            this.logger?.debug(`Tool ${toolName} input updated by PreToolUse hook`);
          }
        }

        // Use parsed.continue for general blocking decisions (but not for permission asks which are handled above)
        if (!parsed.continue) {
          shouldProceed = false;
          const source = parsed.source === "json" ? "JSON output" : `exit code ${result.exitCode}`;
          const reason = parsed.stopReason || "Hook requested to block execution";
          this.logger?.info(`Tool ${toolName} blocked by PreToolUse hook (${source}): ${reason}`);
          break;
        }

        // Log validation errors if present
        if (parsed.errorMessages && parsed.errorMessages.length > 0) {
          this.logger?.warn(`PreToolUse hook validation issues for ${toolName}:`, parsed.errorMessages);
        }

        // Log system message if present
        if (parsed.systemMessage) {
          this.logger?.info(`PreToolUse hook message: ${parsed.systemMessage}`);
        }
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

      return { shouldProceed, updatedInput, permissionId };
    } catch (error) {
      // Hook execution errors should not interrupt the main workflow
      this.logger?.error("PreToolUse hook execution failed:", error);
      return { shouldProceed: true };
    }
  }

  /**
   * Execute PostToolUse hooks after tool completion
   */
  private async executePostToolUseHooks(
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

      // Process hook output results
      for (const result of results) {
        // Process hook output through message manager
        const hookOutputResult = {
          exitCode: result.exitCode ?? 0,
          stdout: result.stdout ?? "",
          stderr: result.stderr ?? "",
          executionTime: result.duration,
          hookEvent: "PostToolUse" as const,
        };

        // Process output for message blocks
        this.messageManager.processHookOutput(hookOutputResult);

        // Parse hook output using parseHookOutput (implements JSON precedence over exit codes)
        const parsed = parseHookOutput(hookOutputResult);

        // Check for blocking behavior from JSON or exit code
        if (!parsed.continue) {
          const source = parsed.source === "json" ? "JSON output" : `exit code ${result.exitCode}`;
          const reason = parsed.stopReason || "Hook reported blocking condition";
          this.logger?.info(`PostToolUse hook reported blocking condition for ${toolName} (${source}): ${reason}`);
        }

        // Handle hook-specific data for PostToolUse
        if (parsed.hookSpecificData && typeof parsed.hookSpecificData === 'object') {
          const hookData = parsed.hookSpecificData as PostToolUseOutput;
          if (hookData.decision === 'block') {
            const blockReason = hookData.reason || "PostToolUse hook blocked execution";
            this.logger?.info(`PostToolUse hook blocked execution for ${toolName}: ${blockReason}`);
          }
          if (hookData.additionalContext) {
            this.logger?.debug(`PostToolUse hook additional context for ${toolName}: ${hookData.additionalContext}`);
          }
        }

        // Log validation errors if present
        if (parsed.errorMessages && parsed.errorMessages.length > 0) {
          this.logger?.warn(`PostToolUse hook validation issues for ${toolName}:`, parsed.errorMessages);
        }

        // Log system message if present
        if (parsed.systemMessage) {
          this.logger?.info(`PostToolUse hook message: ${parsed.systemMessage}`);
        }
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
