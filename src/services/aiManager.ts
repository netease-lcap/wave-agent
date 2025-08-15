import { randomUUID } from "crypto";
import { callAgent, compressMessages } from "./aiService";
import { FileTreeNode } from "../types/common";
import { FileManager } from "./fileManager";
import { SessionManager } from "./sessionManager";
import {
  addAssistantMessageToMessages,
  addAnswerBlockToMessage,
  updateAnswerBlockInMessage,
  addToolBlockToMessage,
  updateToolBlockInMessage,
  addErrorBlockToMessage,
  addCompressBlockToMessage,
  updateFileOperationBlockInMessage,
} from "../utils/messageOperations";
import { toolRegistry } from "../plugins/tools";
import type { ToolContext } from "../plugins/tools/types";
import { convertMessagesForAPI } from "../utils/convertMessagesForAPI";
import { saveErrorLog } from "../utils/errorLogger";
import type { Message } from "../types";
import { logger } from "../utils/logger";

export interface AIManagerCallbacks {
  onMessagesChange: (messages: Message[]) => void;
  onLoadingChange: (isLoading: boolean) => void;
  onFlatFilesChange: (
    updater: (files: FileTreeNode[]) => FileTreeNode[],
  ) => void;
  getCurrentInputHistory?: () => string[];
}

export interface AIManagerState {
  sessionId: string;
  isLoading: boolean;
  messages: Message[];
  totalTokens: number;
}

export class AIManager {
  private state: AIManagerState;
  private callbacks: AIManagerCallbacks;
  private abortController: AbortController | null = null;
  private toolAbortController: AbortController | null = null;
  private workdir: string;
  private fileManager: FileManager;
  private sessionStartTime: string;
  private autoSaveTimer: NodeJS.Timeout | null = null;
  private lastSaveTime: number = 0;

  constructor(
    workdir: string,
    callbacks: AIManagerCallbacks,
    fileManager: FileManager,
  ) {
    this.workdir = workdir;
    this.callbacks = callbacks;
    this.fileManager = fileManager;
    this.sessionStartTime = new Date().toISOString();
    this.state = {
      sessionId: randomUUID(),
      isLoading: false,
      messages: [],
      totalTokens: 0,
    };

    // Set up auto-save
    this.startAutoSave();

    // Handle process termination to save session
    process.on("SIGINT", this.handleProcessExit.bind(this));
    process.on("SIGTERM", this.handleProcessExit.bind(this));
  }

  public getState(): AIManagerState {
    return { ...this.state };
  }

  public setMessages(messages: Message[]): void {
    this.state.messages = [...messages];
    this.callbacks.onMessagesChange([...messages]);

    // 节流保存：只有距离上次保存超过30秒才保存
    const now = Date.now();
    if (now - this.lastSaveTime > 30000) {
      this.lastSaveTime = now;
      // 异步保存会话（不阻塞UI）
      this.saveSession().catch((error) => {
        logger.error("Failed to save session after message update:", error);
      });
    }
  }

  public setIsLoading(isLoading: boolean): void {
    this.state.isLoading = isLoading;
    this.callbacks.onLoadingChange(isLoading);
  }

  public abortAIMessage(): void {
    // 中断AI服务
    if (this.abortController) {
      try {
        this.abortController.abort();
      } catch (error) {
        logger.error("Failed to abort AI service:", error);
      }
    }

    // 中断工具执行
    if (this.toolAbortController) {
      try {
        this.toolAbortController.abort();
      } catch (error) {
        logger.error("Failed to abort tool execution:", error);
      }
    }

    this.setIsLoading(false);
  }

  public resetSession(): void {
    this.state.sessionId = randomUUID();
    this.state.totalTokens = 0;
    this.sessionStartTime = new Date().toISOString();
  }

  /**
   * 从会话数据初始化管理器状态
   */
  public initializeFromSession(
    sessionId: string,
    messages: Message[],
    totalTokens: number,
  ): void {
    this.state.sessionId = sessionId;
    this.state.messages = [...messages];
    this.state.totalTokens = totalTokens;
    this.state.isLoading = false;
  }

  /**
   * 获取当前输入历史（从ChatProvider获取）
   */
  private getCurrentInputHistory(): string[] {
    return this.callbacks.getCurrentInputHistory?.() || [];
  }

  /**
   * 保存当前会话
   */
  public async saveSession(inputHistory?: string[]): Promise<void> {
    try {
      const historyToSave = inputHistory || this.getCurrentInputHistory();
      await SessionManager.saveSession(
        this.state.sessionId,
        this.state.messages,
        historyToSave,
        this.workdir,
        undefined, // ignore patterns - 需要从外部获取
        this.state.totalTokens,
        this.sessionStartTime,
      );
    } catch (error) {
      logger.error("Failed to save session:", error);
    }
  }

  /**
   * 启动自动保存
   */
  private startAutoSave(): void {
    // 每5分钟自动保存一次
    this.autoSaveTimer = setInterval(
      () => {
        this.saveSession().catch((error) => {
          logger.error("Auto-save failed:", error);
        });
      },
      5 * 60 * 1000,
    );
  }

  /**
   * 停止自动保存
   */
  private stopAutoSave(): void {
    if (this.autoSaveTimer) {
      clearInterval(this.autoSaveTimer);
      this.autoSaveTimer = null;
    }
  }

  /**
   * 处理进程退出，保存会话
   */
  private async handleProcessExit(): Promise<void> {
    this.stopAutoSave();
    await this.saveSession();
    process.exit(0);
  }

  /**
   * 销毁管理器，清理资源
   */
  public destroy(): void {
    this.stopAutoSave();
    this.abortAIMessage();
  }

  public async sendAIMessage(recursionDepth: number = 0): Promise<void> {
    // Only check isLoading for the initial call (recursionDepth === 0)
    if (recursionDepth === 0 && this.state.isLoading) {
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

    // 添加助手消息
    let currentMessages = addAssistantMessageToMessages(this.state.messages);
    this.setMessages(currentMessages);

    let hasToolOperations = false;

    // 获取近期消息历史
    const recentMessages = convertMessagesForAPI(currentMessages);

    try {
      // 添加答案块
      currentMessages = addAnswerBlockToMessage(currentMessages);
      this.setMessages(currentMessages);

      const result = await callAgent({
        messages: recentMessages,
        sessionId: this.state.sessionId,
        abortSignal: abortController.signal,
      });

      // 更新 token 统计 - 显示最新一次的token使用量
      if (result.usage) {
        this.state.totalTokens = result.usage.total_tokens;

        // 检查是否超过64k token限制
        if (result.usage.total_tokens > 64000) {
          logger.info("Token usage exceeded 64k, compressing messages...");

          // 移除后六条消息进行压缩
          if (currentMessages.length > 6) {
            const messagesToCompress = currentMessages.slice(-7, -1); // 移除后六条（不包含当前正在处理的消息）
            const recentChatMessages =
              convertMessagesForAPI(messagesToCompress);

            try {
              const compressedContent = await compressMessages({
                messages: recentChatMessages,
                abortSignal: abortController.signal,
              });

              // 计算插入位置（后六条之前）
              const insertIndex = currentMessages.length - 7;

              // 删除后六条消息并在该位置插入压缩块
              const newMessages = [...currentMessages];
              // 移除后六条消息
              newMessages.splice(-7, 6);
              // 在指定位置插入压缩块
              currentMessages = addCompressBlockToMessage(
                newMessages,
                insertIndex,
                compressedContent,
                6,
              );
              this.setMessages(currentMessages);

              logger.info("Successfully compressed 6 messages");
            } catch (compressError) {
              logger.error("Failed to compress messages:", compressError);
            }
          }
        }
      }

      // 处理返回的内容
      if (result.content) {
        // 直接更新答案内容（非流式，一次性接收完整内容）
        currentMessages = updateAnswerBlockInMessage(
          currentMessages,
          result.content || "",
        );
        this.setMessages(currentMessages);
      }

      // 处理返回的工具调用
      if (result.tool_calls) {
        for (const toolCall of result.tool_calls) {
          if (toolCall.type !== "function") continue; // 跳过没有 function 的工具调用

          hasToolOperations = true;

          // 添加工具块
          currentMessages = addToolBlockToMessage(currentMessages, {
            id: toolCall.id || "",
            name: toolCall.function?.name || "",
          });
          this.setMessages(currentMessages);

          // 执行工具
          try {
            const toolArgs = JSON.parse(toolCall.function?.arguments || "{}");

            // 设置工具开始执行状态
            // 获取工具插件以生成 compactParams
            const toolPlugin = toolRegistry
              .list()
              .find((plugin) => plugin.name === toolCall.function?.name);
            const compactParams = toolPlugin?.formatCompactParams?.(toolArgs);

            currentMessages = updateToolBlockInMessage(
              currentMessages,
              toolCall.id || "",
              JSON.stringify(toolArgs, null, 2),
              undefined,
              undefined,
              undefined,
              false, // isStreaming: false
              true, // isRunning: true
              toolCall.function?.name || "",
              undefined,
              compactParams,
            );
            this.setMessages(currentMessages);

            try {
              // 获取最新的 flatFiles 状态
              const currentFlatFiles = this.fileManager.getFlatFiles();

              // 创建工具执行上下文
              const context: ToolContext = {
                flatFiles: currentFlatFiles,
                abortSignal: toolAbortController.signal,
                workdir: this.workdir,
              };

              // 执行工具
              const toolResult = await toolRegistry.execute(
                toolCall.function?.name || "",
                toolArgs,
                context,
              );

              // 更新消息状态 - 工具执行完成
              currentMessages = updateToolBlockInMessage(
                currentMessages,
                toolCall.id || "",
                JSON.stringify(toolArgs, null, 2),
                toolResult.content ||
                  (toolResult.error ? `Error: ${toolResult.error}` : ""),
                toolResult.success,
                toolResult.error,
                false, // isStreaming: false
                false, // isRunning: false
                toolCall.function?.name || "",
                toolResult.shortResult,
                compactParams,
              );
              this.setMessages(currentMessages);

              // 如果工具返回了diff信息，添加diff块
              if (
                toolResult.success &&
                toolResult.diffResult &&
                toolResult.filePath &&
                toolResult.originalContent !== undefined &&
                toolResult.newContent !== undefined
              ) {
                currentMessages = updateFileOperationBlockInMessage(
                  currentMessages,
                  toolResult.filePath!,
                  toolResult.diffResult!,
                  toolResult.originalContent!,
                  toolResult.newContent!,
                );
                this.setMessages(currentMessages);
              }
            } catch (toolError) {
              const errorMessage =
                toolError instanceof Error
                  ? toolError.message
                  : String(toolError);

              currentMessages = updateToolBlockInMessage(
                currentMessages,
                toolCall.id || "",
                JSON.stringify(toolArgs, null, 2),
                `Tool execution failed: ${errorMessage}`,
                false,
                errorMessage,
                false,
                false,
                toolCall.function?.name || "",
                undefined,
                compactParams,
              );
              this.setMessages(currentMessages);
            }
          } catch (parseError) {
            const errorMessage =
              parseError instanceof Error
                ? parseError.message
                : String(parseError);
            currentMessages = addErrorBlockToMessage(
              currentMessages,
              `Failed to parse tool arguments for ${toolCall.function?.name}: ${errorMessage}`,
            );
            this.setMessages(currentMessages);
          }
        }
      }

      // AI 服务调用结束，清除 abort controller
      this.abortController = null;

      // 工具执行完成后清理工具的AbortController
      if (this.toolAbortController) {
        this.toolAbortController = null;
      }

      // 检查是否有工具操作，如果有则自动发起下一次 AI 服务调用
      if (hasToolOperations) {
        // 检查全局中断标志和AbortController状态
        const isCurrentlyAborted =
          abortController.signal.aborted || toolAbortController.signal.aborted;

        if (isCurrentlyAborted) {
          return;
        }

        // 等一秒后再发起下一次 AI 服务调用，因为要等文件同步
        // 在测试环境中减少延迟
        const delay = process.env.NODE_ENV === "test" ? 100 : 500;
        await new Promise((resolve) => setTimeout(resolve, delay));

        // 再次检查是否已被中断
        const isStillAborted =
          abortController.signal.aborted || toolAbortController.signal.aborted;

        if (isStillAborted) {
          return;
        }

        // 递归调用 AI 服务，递增的递归深度
        await this.sendAIMessage(recursionDepth + 1);
      }
    } catch (error) {
      // 检查是否是由于用户中断操作导致的错误
      const isAborted =
        abortController.signal.aborted ||
        toolAbortController.signal.aborted ||
        (error instanceof Error &&
          (error.name === "AbortError" || error.message.includes("aborted")));

      if (!isAborted) {
        currentMessages = addErrorBlockToMessage(
          currentMessages,
          error instanceof Error ? error.message : "Unknown error occurred",
        );
        this.setMessages(currentMessages);

        // 保存错误时发送给AI的参数到文件
        try {
          await saveErrorLog(
            error,
            this.state.sessionId,
            this.workdir,
            recentMessages,
            recursionDepth,
          );
        } catch (saveError) {
          logger.error("Failed to save error log:", saveError);
        }
      }

      // 出错时也要重置 abort controller
      this.abortController = null;
      this.toolAbortController = null;

      // 如果是用户主动中断，直接返回，不继续递归
      if (isAborted) {
        return;
      }
    } finally {
      // Only clear loading state for the initial call
      if (recursionDepth === 0) {
        this.setIsLoading(false);
      }
    }
  }
}
