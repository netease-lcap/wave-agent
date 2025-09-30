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
  addUserMessageToMessages,
  extractUserInputHistory,
} from "../utils/messageOperations";
import { toolRegistry } from "../tools";
import type { ToolContext } from "../tools/types";
import { convertMessagesForAPI } from "../utils/convertMessagesForAPI";
import { saveErrorLog } from "../utils/errorLogger";
import { readMemoryFile } from "../utils/memoryUtils";
import * as memory from "./memory";
import { addMemoryBlockToMessage } from "../utils/messageOperations";
import { mcpManager } from "./mcpManager";
import { BashManager } from "./bashManager";
import type { Message } from "../types";
import { logger } from "../utils/logger";
import { DEFAULT_TOKEN_LIMIT } from "@/utils/constants";

export interface AIManagerCallbacks {
  onMessagesChange: (messages: Message[]) => void;
  onLoadingChange: (isLoading: boolean) => void;
}

export interface AIManagerState {
  sessionId: string;
  isLoading: boolean;
  messages: Message[];
  totalTokens: number;
  userInputHistory: string[];
}

export class AIManager {
  private state: AIManagerState;
  private callbacks: AIManagerCallbacks;
  private abortController: AbortController | null = null;
  private toolAbortController: AbortController | null = null;
  private sessionStartTime: string;
  private autoSaveTimer: NodeJS.Timeout | null = null;
  private lastSaveTime: number = 0;
  private bashManagerRef: BashManager | null = null;

  constructor(callbacks: AIManagerCallbacks, initialHistory?: string[]) {
    this.callbacks = callbacks;
    this.sessionStartTime = new Date().toISOString();
    this.state = {
      sessionId: randomUUID(),
      isLoading: false,
      messages: [],
      totalTokens: 0,
      userInputHistory: initialHistory || [],
    };

    // Initialize bash manager
    this.bashManagerRef = new BashManager({
      onMessagesUpdate: (updater) => {
        this.setMessages(updater(this.state.messages));
      },
    });

    // Set up auto-save
    this.startAutoSave();

    // Initialize MCP servers
    this.initializeMcpServers();

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
    this.state.userInputHistory = [];
  }

  /**
   * 清空消息和输入历史
   */
  public clearMessages(): void {
    this.state.messages = [];
    this.state.userInputHistory = [];
    this.callbacks.onMessagesChange([]);
    this.resetSession();
  }

  /**
   * 统一的中断方法，同时中断AI消息和命令执行
   */
  public abortMessage(): void {
    this.abortAIMessage();
    this.abortBashCommand();
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

    // Extract user input history from session messages
    this.state.userInputHistory = extractUserInputHistory(messages);
  }

  /**
   * 保存当前会话
   */
  public async saveSession(): Promise<void> {
    try {
      await SessionManager.saveSession(
        this.state.sessionId,
        this.state.messages,
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
   * 添加到输入历史记录
   */
  public addToInputHistory(input: string): void {
    // 避免重复添加相同的输入
    if (
      this.state.userInputHistory.length > 0 &&
      this.state.userInputHistory[this.state.userInputHistory.length - 1] ===
        input
    ) {
      return;
    }
    // 限制历史记录数量，保留最近的100条
    this.state.userInputHistory = [...this.state.userInputHistory, input].slice(
      -100,
    );
  }

  /**
   * 清空输入历史记录
   */
  public clearInputHistory(): void {
    this.state.userInputHistory = [];
  }

  /**
   * 获取bash命令执行状态
   */
  public getIsCommandRunning(): boolean {
    return this.bashManagerRef?.getIsCommandRunning() ?? false;
  }

  /**
   * 中断bash命令执行
   */
  public abortBashCommand(): void {
    this.bashManagerRef?.abortCommand();
  }

  /**
   * 销毁管理器，清理资源
   */
  public async destroy(): Promise<void> {
    this.stopAutoSave();
    this.abortAIMessage();
    this.abortBashCommand();
    // Cleanup MCP connections
    await mcpManager.cleanup();
  }

  public async sendMessage(
    content: string,
    images?: Array<{ path: string; mimeType: string }>,
  ): Promise<void> {
    // 检查是否有内容可以发送（文本内容或图片附件）
    const hasTextContent = content.trim();
    const hasImageAttachments = images && images.length > 0;

    if (!hasTextContent && !hasImageAttachments) return;

    try {
      // Handle memory mode - 检查是否是记忆消息（以#开头且只有一行）
      if (content.startsWith("#") && !content.includes("\n")) {
        const memoryText = content.substring(1).trim();
        if (!memoryText) return;

        // 在记忆模式下，不添加用户消息，只等待用户选择记忆类型后添加助手消息
        // 不自动保存，等待用户选择记忆类型
        return;
      }

      // Handle bash mode - 检查是否是bash命令（以!开头且只有一行）
      if (content.startsWith("!") && !content.includes("\n")) {
        const command = content.substring(1).trim();
        if (!command) return;

        // 添加用户消息到历史记录（但不显示在UI中）
        this.addToInputHistory(content);

        // 在bash模式下，不添加用户消息到UI，直接执行命令
        // 执行bash命令会自动添加助手消息
        await this.bashManagerRef?.executeCommand(command);
        return;
      }

      // Handle normal AI message
      // 添加用户消息到历史记录
      this.addToInputHistory(content);

      // 添加用户消息，会自动同步到 UI
      this.setMessages(
        addUserMessageToMessages(
          this.state.messages,
          content,
          images?.map((img) => ({
            path: img.path,
            mimeType: img.mimeType,
          })),
        ),
      );

      // 发送AI消息
      await this.sendAIMessage();
    } catch (error) {
      console.error("Failed to add user message:", error);
      // Loading state will be automatically updated by the useEffect that watches messages
    }
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
        memoryContent = await readMemoryFile();
      } catch (error) {
        logger.warn("Failed to read memory file:", error);
      }

      // 读取用户级记忆内容
      let userMemoryContent = "";
      try {
        userMemoryContent = await memory.getUserMemoryContent();
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

      // 调用 AI 服务（非流式）
      const result = await callAgent({
        messages: recentMessages,
        sessionId: this.state.sessionId,
        abortSignal: abortController.signal,
        memory: combinedMemory, // 传递合并后的记忆内容
        workdir: process.cwd(), // 传递当前工作目录
      });

      // 更新答案块中的内容
      if (result.content) {
        currentMessages = updateAnswerBlockInMessage(
          currentMessages,
          result.content,
        );
        this.setMessages(currentMessages);
      }

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
          const functionToolCall = toolCall as {
            id: string;
            type: "function";
            function: { name: string; arguments: string };
          };

          // 添加工具块到 UI
          currentMessages = addToolBlockToMessage(currentMessages, {
            id: toolId,
            name: functionToolCall.function?.name || "",
          });
          this.setMessages(currentMessages);

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
                logger.error(errorMessage, parseError);
                throw new Error(errorMessage);
              }
            }

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
                toolResult.images, // 传递图片数据
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

      // 检查是否有工具操作，如果有则自动发起下一次 AI 服务调用
      if (hasToolOperations) {
        // 检查中断状态
        const isCurrentlyAborted =
          abortController.signal.aborted || toolAbortController.signal.aborted;

        // AI 服务调用结束，清除 abort controller
        this.abortController = null;

        // 工具执行完成后清理工具的AbortController
        if (this.toolAbortController) {
          this.toolAbortController = null;
        }

        if (isCurrentlyAborted) {
          return;
        }

        // 递归调用 AI 服务，递增的递归深度
        await this.sendAIMessage(recursionDepth + 1);
      } else {
        // 没有工具操作时也要清除 abort controller
        this.abortController = null;
        if (this.toolAbortController) {
          this.toolAbortController = null;
        }
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
            process.cwd(),
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

  /**
   * 保存记忆到项目或用户记忆文件
   */
  public async saveMemory(
    message: string,
    type: "project" | "user",
  ): Promise<void> {
    try {
      if (type === "project") {
        await memory.addMemory(message);
      } else {
        await memory.addUserMemory(message);
      }

      // 添加成功的 MemoryBlock 到最后一个助手消息
      const memoryText = message.substring(1).trim();
      const typeLabel = type === "project" ? "项目记忆" : "用户记忆";
      const storagePath = type === "project" ? "LCAP.md" : "user-memory.md";

      const newMessages = addMemoryBlockToMessage(
        this.state.messages,
        `${typeLabel}: ${memoryText}`,
        true,
        type,
        storagePath,
      );
      this.setMessages(newMessages);
    } catch (error) {
      // 添加失败的 MemoryBlock 到最后一个助手消息
      const typeLabel = type === "project" ? "项目记忆" : "用户记忆";
      const storagePath = type === "project" ? "LCAP.md" : "user-memory.md";

      const newMessages = addMemoryBlockToMessage(
        this.state.messages,
        `${typeLabel}添加失败: ${
          error instanceof Error ? error.message : String(error)
        }`,
        false,
        type,
        storagePath,
      );
      this.setMessages(newMessages);
    }
  }

  /**
   * Initialize MCP servers
   */
  private async initializeMcpServers(): Promise<void> {
    try {
      logger.info("Initializing MCP servers...");

      // Initialize MCP manager with current working directory
      mcpManager.initialize(process.cwd());

      // Ensure MCP configuration is loaded
      const config = await mcpManager.ensureConfigLoaded();

      if (config && config.mcpServers) {
        // Connect to all configured servers
        const connectionPromises = Object.keys(config.mcpServers).map(
          async (serverName) => {
            try {
              logger.info(`Connecting to MCP server: ${serverName}`);
              const success = await mcpManager.connectServer(serverName);
              if (success) {
                logger.info(
                  `Successfully connected to MCP server: ${serverName}`,
                );
              } else {
                logger.warn(`Failed to connect to MCP server: ${serverName}`);
              }
            } catch (error) {
              logger.error(
                `Error connecting to MCP server ${serverName}:`,
                error,
              );
            }
          },
        );

        // Wait for all connection attempts to complete
        await Promise.all(connectionPromises);
      }

      logger.info("MCP servers initialization completed");
    } catch (error) {
      logger.error("Failed to initialize MCP servers:", error);
      // Don't throw error to prevent app startup failure
    }
  }
}
