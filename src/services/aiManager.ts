import { randomUUID } from "crypto";
import { callAgent, compressMessages } from "./aiService";
import { SessionManager } from "./sessionManager";
import {
  addAssistantMessageToMessages,
  addAnswerBlockToMessage,
  updateAnswerBlockInMessage,
  addToolBlockToMessage,
  updateToolBlockInMessage,
  addErrorBlockToMessage,
  addCompressBlockToMessage,
  addDiffBlockToMessage,
  getMessagesToCompress,
} from "../utils/messageOperations";
import { toolRegistry } from "../tools";
import type { ToolContext } from "../tools/types";
import { convertMessagesForAPI } from "../utils/convertMessagesForAPI";
import { saveErrorLog } from "../utils/errorLogger";
import { readMemoryFile } from "../utils/memoryUtils";
import { createMemoryManager, type MemoryManager } from "./memoryManager";
import type { Message } from "../types";
import { logger } from "../utils/logger";
import { DEFAULT_TOKEN_LIMIT } from "@/utils/constants";
import { extractCompleteParams } from "../utils/jsonExtractor";

export interface AIManagerCallbacks {
  onMessagesChange: (messages: Message[]) => void;
  onLoadingChange: (isLoading: boolean) => void;
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
  private sessionStartTime: string;
  private autoSaveTimer: NodeJS.Timeout | null = null;
  private lastSaveTime: number = 0;
  private userMemoryManager: MemoryManager;

  constructor(workdir: string, callbacks: AIManagerCallbacks) {
    this.workdir = workdir;
    this.callbacks = callbacks;
    this.userMemoryManager = createMemoryManager(workdir);
    this.sessionStartTime = new Date().toISOString();
    this.state = {
      sessionId: randomUUID(),
      isLoading: false,
      messages: [],
      totalTokens: 0,
    };

    // Set up auto-save
    this.startAutoSave();

    // Note: Process termination handling is now done at the CLI level
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

      // 读取记忆文件内容
      let memoryContent = "";
      try {
        memoryContent = await readMemoryFile(this.workdir);
      } catch (error) {
        logger.warn("Failed to read memory file:", error);
      }

      // 读取用户级记忆内容
      let userMemoryContent = "";
      try {
        userMemoryContent = await this.userMemoryManager.getUserMemoryContent();
      } catch (error) {
        logger.warn("Failed to read user memory file:", error);
      }

      // 合并项目记忆和用户记忆
      let combinedMemory = "";
      if (memoryContent.trim()) {
        combinedMemory += memoryContent;
      }
      if (userMemoryContent.trim()) {
        if (combinedMemory) {
          combinedMemory += "\n\n";
        }
        combinedMemory += userMemoryContent;
      }

      // 流式处理工具调用的状态
      const toolCallStates = new Map<
        string,
        {
          id: string;
          name: string;
          args: string;
          isComplete: boolean;
          added: boolean;
        }
      >();

      const result = await callAgent({
        messages: recentMessages,
        sessionId: this.state.sessionId,
        abortSignal: abortController.signal,
        memory: combinedMemory, // 传递合并后的记忆内容
        // 流式内容更新回调
        onContentUpdate: (content: string) => {
          currentMessages = updateAnswerBlockInMessage(
            currentMessages,
            content,
          );
          this.setMessages(currentMessages);
        },
        // 流式工具调用更新回调
        onToolCallUpdate: (toolCall, isComplete) => {
          if (!toolCall.id || !toolCall.function?.name) return;

          const toolId = toolCall.id;
          const existing = toolCallStates.get(toolId);

          if (!existing) {
            // 新工具调用
            toolCallStates.set(toolId, {
              id: toolId,
              name: toolCall.function.name,
              args: toolCall.function.arguments || "",
              isComplete,
              added: false,
            });

            // 添加工具块到UI
            currentMessages = addToolBlockToMessage(currentMessages, {
              id: toolId,
              name: toolCall.function.name,
            });
            toolCallStates.get(toolId)!.added = true;
            this.setMessages(currentMessages);
          } else {
            // 更新现有工具调用
            existing.args = toolCall.function?.arguments || "";
            existing.isComplete = isComplete;

            // 如果工具块已经添加到UI，更新参数显示
            if (existing.added) {
              // 当参数还在流式传输时，显示紧凑格式的参数
              let paramsToShow = existing.args;
              if (!isComplete && existing.args) {
                // 从不完整的JSON中提取完整的参数，并格式化显示
                const completeParams = extractCompleteParams(existing.args);
                if (Object.keys(completeParams).length > 0) {
                  paramsToShow = JSON.stringify(completeParams, null, 2);
                } else {
                  // 如果没有提取到完整参数，显示原始内容的前50个字符
                  paramsToShow =
                    existing.args.length > 50
                      ? existing.args.substring(0, 50) + "..."
                      : existing.args;
                }
              } else if (isComplete && existing.args) {
                // 参数完整时，显示格式化的完整参数
                try {
                  const parsedArgs = JSON.parse(existing.args);
                  paramsToShow = JSON.stringify(parsedArgs, null, 2);
                } catch {
                  paramsToShow = existing.args;
                }
              }

              currentMessages = updateToolBlockInMessage(
                currentMessages,
                toolId,
                paramsToShow,
                undefined, // result
                undefined, // success
                undefined, // error
                !isComplete, // isStreaming: true if not complete
                false, // isRunning: false (还未开始执行)
                existing.name,
                undefined, // shortResult
              );
              this.setMessages(currentMessages);
            }
          }
        },
      });

      // 更新 token 统计 - 显示最新一次的token使用量
      if (result.usage) {
        this.state.totalTokens = result.usage.total_tokens;

        // 检查是否超过token限制
        const tokenLimit = parseInt(
          process.env.TOKEN_LIMIT || `${DEFAULT_TOKEN_LIMIT}`,
          10,
        );
        if (result.usage.total_tokens > tokenLimit) {
          logger.info(
            `Token usage exceeded ${tokenLimit}, compressing messages...`,
          );

          // 检查是否需要压缩消息
          const { messagesToCompress, insertIndex } = getMessagesToCompress(
            currentMessages,
            7,
          );

          // 如果有需要压缩的消息，则进行压缩
          if (messagesToCompress.length > 0) {
            const recentChatMessages =
              convertMessagesForAPI(messagesToCompress);

            try {
              const compressedContent = await compressMessages({
                messages: recentChatMessages,
                abortSignal: abortController.signal,
              });

              // 在指定位置插入压缩块
              currentMessages = addCompressBlockToMessage(
                currentMessages,
                insertIndex,
                compressedContent,
              );
              this.setMessages(currentMessages);

              logger.info(
                `Successfully compressed ${messagesToCompress.length} messages`,
              );
            } catch (compressError) {
              logger.error("Failed to compress messages:", compressError);
            }
          }
        }
      }

      // 处理返回的工具调用（执行阶段）
      if (result.tool_calls) {
        for (const toolCall of result.tool_calls) {
          if (toolCall.type !== "function") continue; // 跳过没有 function 的工具调用

          hasToolOperations = true;

          const toolId = toolCall.id || "";
          const toolState = toolCallStates.get(toolId);
          const functionToolCall = toolCall as {
            id: string;
            type: "function";
            function: { name: string; arguments: string };
          };

          // 如果工具块还没有添加（理论上不应该发生，但防止意外情况）
          if (!toolState?.added) {
            currentMessages = addToolBlockToMessage(currentMessages, {
              id: toolId,
              name: functionToolCall.function?.name || "",
            });
            this.setMessages(currentMessages);
          }

          // 执行工具
          try {
            // 检查是否已被中断，如果是则跳过工具执行
            if (
              abortController.signal.aborted ||
              toolAbortController.signal.aborted
            ) {
              return;
            }

            const toolArgs = JSON.parse(
              functionToolCall.function?.arguments || "{}",
            );

            // 设置工具开始执行状态
            currentMessages = updateToolBlockInMessage(
              currentMessages,
              toolId,
              JSON.stringify(toolArgs, null, 2),
              undefined,
              undefined,
              undefined,
              false, // isStreaming: false (参数已完整)
              true, // isRunning: true
              functionToolCall.function?.name || "",
              undefined,
            );
            this.setMessages(currentMessages);

            try {
              // 创建工具执行上下文
              const context: ToolContext = {
                abortSignal: toolAbortController.signal,
                workdir: this.workdir,
              };

              // 执行工具
              const toolResult = await toolRegistry.execute(
                functionToolCall.function?.name || "",
                toolArgs,
                context,
              );

              // 更新消息状态 - 工具执行完成
              currentMessages = updateToolBlockInMessage(
                currentMessages,
                toolId,
                JSON.stringify(toolArgs, null, 2),
                toolResult.content ||
                  (toolResult.error ? `Error: ${toolResult.error}` : ""),
                toolResult.success,
                toolResult.error,
                false, // isStreaming: false
                false, // isRunning: false
                functionToolCall.function?.name || "",
                toolResult.shortResult,
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
                currentMessages = addDiffBlockToMessage(
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
                toolId,
                JSON.stringify(toolArgs, null, 2),
                `Tool execution failed: ${errorMessage}`,
                false,
                errorMessage,
                false,
                false,
                functionToolCall.function?.name || "",
                undefined,
              );
              this.setMessages(currentMessages);
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
            currentMessages = addErrorBlockToMessage(
              currentMessages,
              `Failed to parse tool arguments for ${functionToolCall.function?.name}: ${errorMessage}`,
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

        // 等待后再发起下一次 AI 服务调用，因为要等文件同步
        // 通过环境变量控制延迟时间：
        // - 生产环境默认500ms，确保文件操作完成
        // - 测试环境设为0以加速测试
        const delay = parseInt(process.env.AI_TOOL_RECURSION_DELAY_MS || "500");
        if (delay > 0) {
          await new Promise((resolve) => setTimeout(resolve, delay));
        }

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
