import { callAgent, compressMessages } from "../services/aiService.js";
import { getMessagesToCompress } from "../utils/messageOperations.js";
import { convertMessagesForAPI } from "../utils/convertMessagesForAPI.js";
import * as memory from "../services/memory.js";
import type { Logger } from "../types.js";
import type { ToolManager } from "./toolManager.js";
import type { ToolContext } from "../tools/types.js";
import type { MessageManager } from "./messageManager.js";
import type { BackgroundBashManager } from "./backgroundBashManager.js";
import { DEFAULT_TOKEN_LIMIT } from "../utils/constants.js";
import { ChatCompletionMessageFunctionToolCall } from "openai/resources.js";

export interface AIManagerCallbacks {
  onCompressionStateChange?: (isCompressing: boolean) => void;
}

export interface AIManagerOptions {
  messageManager: MessageManager;
  toolManager: ToolManager;
  logger?: Logger;
  backgroundBashManager?: BackgroundBashManager;
  callbacks?: AIManagerCallbacks;
  model?: string;
  allowedTools?: string[];
}

export class AIManager {
  public isLoading: boolean = false;
  private abortController: AbortController | null = null;
  private toolAbortController: AbortController | null = null;
  private logger?: Logger;
  private toolManager: ToolManager;
  private messageManager: MessageManager;
  private backgroundBashManager?: BackgroundBashManager;
  private model?: string;
  private allowedTools?: string[];

  constructor(options: AIManagerOptions) {
    this.messageManager = options.messageManager;
    this.toolManager = options.toolManager;
    this.backgroundBashManager = options.backgroundBashManager;
    this.logger = options.logger;
    this.model = options.model;
    this.allowedTools = options.allowedTools;
    this.callbacks = options.callbacks ?? {};
  }

  private isCompressing: boolean = false;
  private callbacks: AIManagerCallbacks;

  /**
   * 获取过滤后的工具配置
   */
  private getFilteredToolsConfig() {
    const allTools = this.toolManager.getToolsConfig();

    // 如果没有指定 allowedTools，返回所有工具
    if (!this.allowedTools || this.allowedTools.length === 0) {
      return allTools;
    }

    // 过滤出允许的工具
    return allTools.filter((tool) =>
      this.allowedTools!.includes(tool.function.name),
    );
  }

  public setIsLoading(isLoading: boolean): void {
    this.isLoading = isLoading;
  }

  public abortAIMessage(): void {
    // 中断AI服务
    if (this.abortController) {
      try {
        this.abortController.abort();
      } catch (error) {
        this.logger?.error("Failed to abort AI service:", error);
      }
    }

    // 中断工具执行
    if (this.toolAbortController) {
      try {
        this.toolAbortController.abort();
      } catch (error) {
        this.logger?.error("Failed to abort tool execution:", error);
      }
    }

    this.setIsLoading(false);
  }

  // 生成 compactParams 的辅助方法
  private generateCompactParams(
    toolName: string,
    toolArgs: Record<string, unknown>,
  ): string | undefined {
    try {
      const toolPlugin = this.toolManager
        .list()
        .find((plugin) => plugin.name === toolName);
      if (toolPlugin?.formatCompactParams) {
        return toolPlugin.formatCompactParams(toolArgs);
      }
    } catch (error) {
      this.logger?.warn("Failed to generate compactParams", error);
    }
    return undefined;
  }

  // 处理 token 统计和消息压缩的私有方法
  private async handleTokenUsageAndCompression(
    usage: { total_tokens: number } | undefined,
    abortController: AbortController,
  ): Promise<void> {
    if (!usage) return;

    // 更新 token 统计 - 显示最新一次的token使用量
    this.messageManager.setlatestTotalTokens(usage.total_tokens);

    // 检查是否超过token限制
    const tokenLimit = parseInt(
      process.env.TOKEN_LIMIT || `${DEFAULT_TOKEN_LIMIT}`,
      10,
    );

    if (usage.total_tokens > tokenLimit) {
      this.logger?.info(
        `Token usage exceeded ${tokenLimit}, compressing messages...`,
      );

      // 检查是否需要压缩消息
      const { messagesToCompress, insertIndex } = getMessagesToCompress(
        this.messageManager.getMessages(),
        7,
      );

      // 如果有需要压缩的消息，则进行压缩
      if (messagesToCompress.length > 0) {
        const recentChatMessages = convertMessagesForAPI(messagesToCompress);

        this.setIsCompressing(true);
        try {
          const compressedContent = await compressMessages({
            messages: recentChatMessages,
            abortSignal: abortController.signal,
          });

          // 在指定位置插入压缩块
          this.messageManager.addCompressBlock(insertIndex, compressedContent);

          this.logger?.info(
            `Successfully compressed ${messagesToCompress.length} messages`,
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

  public async sendAIMessage(recursionDepth: number = 0): Promise<void> {
    // Only check isLoading for the initial call (recursionDepth === 0)
    if (recursionDepth === 0 && this.isLoading) {
      return;
    }

    // 创建新的AbortController
    const abortController = new AbortController();
    this.abortController = abortController;

    // 为工具执行创建单独的AbortController
    const toolAbortController = new AbortController();
    this.toolAbortController = toolAbortController;

    // Only set loading state for the initial call
    if (recursionDepth === 0) {
      this.setIsLoading(true);
    }

    // 获取近期消息历史
    const recentMessages = convertMessagesForAPI(
      this.messageManager.getMessages(),
    );

    try {
      // 获取合并的记忆内容
      const combinedMemory = await memory.getCombinedMemoryContent();

      // 调用 AI 服务（非流式）
      const result = await callAgent({
        messages: recentMessages,
        sessionId: this.messageManager.getSessionId(),
        abortSignal: abortController.signal,
        memory: combinedMemory, // 传递合并后的记忆内容
        workdir: process.cwd(), // 传递当前工作目录
        tools: this.getFilteredToolsConfig(), // 传递过滤后的工具配置
        model: this.model, // 传递自定义模型
      });

      // 收集内容和工具调用
      const content = result.content || "";
      const toolCalls: ChatCompletionMessageFunctionToolCall[] = [];

      if (result.tool_calls) {
        for (const toolCall of result.tool_calls) {
          if (toolCall.type === "function") {
            toolCalls.push(toolCall);
          }
        }
      }

      // 一次性添加助手消息（包含内容和工具调用）
      this.messageManager.addAssistantMessage(content, toolCalls);

      if (toolCalls.length > 0) {
        for (const functionToolCall of toolCalls) {
          const toolId = functionToolCall.id || "";
          // 执行工具
          try {
            // 检查是否已被中断，如果是则跳过工具执行
            if (
              abortController.signal.aborted ||
              toolAbortController.signal.aborted
            ) {
              return;
            }

            // 安全解析工具参数，处理无参数工具的情况
            let toolArgs: Record<string, unknown> = {};
            const argsString = functionToolCall.function?.arguments?.trim();

            if (!argsString || argsString === "") {
              // 无参数工具，使用空对象
              toolArgs = {};
            } else {
              try {
                toolArgs = JSON.parse(argsString);
              } catch (parseError) {
                // 对于非空但格式错误的JSON，仍然抛出异常
                const errorMessage = `Failed to parse tool arguments: ${argsString}`;
                this.logger?.error(errorMessage, parseError);
                throw new Error(errorMessage);
              }
            }

            // 设置工具开始执行状态
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
              // 创建工具执行上下文
              const context: ToolContext = {
                abortSignal: toolAbortController.signal,
                backgroundBashManager: this.backgroundBashManager,
              };

              // 执行工具
              const toolResult = await this.toolManager.execute(
                functionToolCall.function?.name || "",
                toolArgs,
                context,
              );

              // 更新消息状态 - 工具执行完成
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

              // 如果工具返回了diff信息，添加diff块
              if (
                toolResult.success &&
                toolResult.diffResult &&
                toolResult.filePath &&
                toolResult.originalContent !== undefined &&
                toolResult.newContent !== undefined
              ) {
                this.messageManager.addDiffBlock(
                  toolResult.filePath,
                  toolResult.diffResult,
                  toolResult.originalContent,
                  toolResult.newContent,
                );
              }
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
            // 检查是否是因为中断导致的解析错误
            const isAborted =
              abortController.signal.aborted ||
              toolAbortController.signal.aborted;

            if (isAborted) {
              // 如果是中断导致的，直接返回，不显示错误
              return;
            }

            const errorMessage =
              parseError instanceof Error
                ? parseError.message
                : String(parseError);
            this.messageManager.addErrorBlock(
              `Failed to parse tool arguments for ${functionToolCall.function?.name}: ${errorMessage}`,
            );
          }
        }
      }

      // 处理 token 统计和消息压缩
      await this.handleTokenUsageAndCompression(result.usage, abortController);

      // 检查是否有工具操作，如果有则自动发起下一次 AI 服务调用
      if (toolCalls.length > 0) {
        // 检查中断状态
        const isCurrentlyAborted =
          abortController.signal.aborted || toolAbortController.signal.aborted;

        // AI 服务调用结束，清除 abort controller
        this.abortController = null;

        // 工具执行完成后清理工具的AbortController
        this.toolAbortController = null;

        if (!isCurrentlyAborted) {
          // 递归调用 AI 服务，递增的递归深度
          await this.sendAIMessage(recursionDepth + 1);
        }
      } else {
        // 没有工具操作时也要清除 abort controller
        this.abortController = null;
        this.toolAbortController = null;
      }
    } catch (error) {
      // 检查是否是由于用户中断操作导致的错误
      const isAborted =
        abortController.signal.aborted ||
        toolAbortController.signal.aborted ||
        (error instanceof Error &&
          (error.name === "AbortError" || error.message.includes("aborted")));

      if (!isAborted) {
        this.messageManager.addErrorBlock(
          error instanceof Error ? error.message : "Unknown error occurred",
        );
      }

      // 出错时也要重置 abort controller
      this.abortController = null;
      this.toolAbortController = null;
    } finally {
      // Only clear loading state for the initial call
      if (recursionDepth === 0) {
        this.setIsLoading(false);
      }
    }
  }
}
