import { randomUUID } from "crypto";
import { callAgent, compressMessages } from "./aiService.js";
import {
  saveSession,
  loadSession,
  getLatestSession,
  cleanupExpiredSessions,
  type SessionData,
} from "./session.js";
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
  addMemoryBlockToMessage,
  addCommandOutputMessage,
  updateCommandOutputInMessage,
  completeCommandInMessage,
  type AIManagerToolBlockUpdateParams,
} from "../utils/messageOperations.js";
import { ToolRegistryImpl } from "../tools/index.js";
import type { ToolContext } from "../tools/types.js";
import { convertMessagesForAPI } from "../utils/convertMessagesForAPI.js";
import { saveErrorLog } from "../utils/errorLogger.js";
import { readMemoryFile } from "../utils/memoryUtils.js";
import * as memory from "./memory.js";
import { McpManager, McpServerStatus } from "./mcpManager.js";
import { BashManager } from "./bashManager.js";
import type { Message, Logger } from "../types.js";
import { DEFAULT_TOKEN_LIMIT } from "@/utils/constants.js";

export interface AIManagerOptions {
  callbacks: AIManagerCallbacks;
  restoreSessionId?: string;
  continueLastSession?: boolean;
  logger?: Logger; // 添加可选的 logger 参数
}

export interface AIManagerCallbacks {
  onMessagesChange?: (messages: Message[]) => void;
  onLoadingChange?: (isLoading: boolean) => void;
  // 新的增量回调
  onUserMessageAdded?: (
    content: string,
    images?: Array<{ path: string; mimeType: string }>,
  ) => void;
  onAssistantMessageAdded?: () => void;
  onAnswerBlockAdded?: () => void;
  onAnswerBlockUpdated?: (content: string) => void;
  onToolBlockAdded?: (tool: { id: string; name: string }) => void;
  onToolBlockUpdated?: (params: AIManagerToolBlockUpdateParams) => void;
  onDiffBlockAdded?: (filePath: string, diffResult: string) => void;
  onErrorBlockAdded?: (error: string) => void;
  onCompressBlockAdded?: (content: string) => void;
  onMemoryBlockAdded?: (
    content: string,
    success: boolean,
    type: "project" | "user",
  ) => void;
  // MCP 服务器状态回调
  onMcpServersChange?: (servers: McpServerStatus[]) => void;
  // Bash 命令回调
  onAddCommandOutputMessage?: (command: string) => void;
  onUpdateCommandOutputMessage?: (command: string, output: string) => void;
  onCompleteCommandMessage?: (command: string, exitCode: number) => void;
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
  private bashManager: BashManager | null = null;
  private logger?: Logger; // 添加可选的 logger 属性
  private toolRegistry: ToolRegistryImpl; // 添加工具注册表实例
  private mcpManager: McpManager; // 添加 MCP 管理器实例

  // 私有构造函数，防止直接实例化
  private constructor(options: AIManagerOptions) {
    const { callbacks, logger } = options;

    this.callbacks = callbacks;
    this.logger = logger; // 保存传入的 logger
    this.mcpManager = new McpManager(this.logger); // 初始化 MCP 管理器
    this.toolRegistry = new ToolRegistryImpl(this.mcpManager); // 初始化工具注册表，传入 MCP 管理器
    this.sessionStartTime = new Date().toISOString();
    this.state = {
      sessionId: randomUUID(),
      isLoading: false,
      messages: [],
      totalTokens: 0,
      userInputHistory: [],
    };

    // Initialize bash manager
    this.bashManager = new BashManager({
      onAddCommandOutputMessage: (command: string) => {
        const updatedMessages = addCommandOutputMessage({
          messages: this.state.messages,
          command,
        });
        this.setMessages(updatedMessages);
        // 调用增量回调
        this.callbacks.onAddCommandOutputMessage?.(command);
      },
      onUpdateCommandOutputMessage: (command: string, output: string) => {
        const updatedMessages = updateCommandOutputInMessage({
          messages: this.state.messages,
          command,
          output,
        });
        this.setMessages(updatedMessages);
        // 调用增量回调
        this.callbacks.onUpdateCommandOutputMessage?.(command, output);
      },
      onCompleteCommandMessage: (command: string, exitCode: number) => {
        const updatedMessages = completeCommandInMessage({
          messages: this.state.messages,
          command,
          exitCode,
        });
        this.setMessages(updatedMessages);
        // 调用增量回调
        this.callbacks.onCompleteCommandMessage?.(command, exitCode);
      },
    });

    // Note: Process termination handling is now done at the CLI level
    // Note: MCP servers and session restoration are handled in initialize()
  }

  /**
   * 静态异步工厂方法
   */
  static async create(options: AIManagerOptions): Promise<AIManager> {
    const instance = new AIManager(options);
    await instance.initialize(
      options.restoreSessionId,
      options.continueLastSession,
    );
    return instance;
  }

  /**
   * 私有初始化方法，处理异步初始化逻辑
   */
  private async initialize(
    restoreSessionId?: string,
    continueLastSession?: boolean,
  ): Promise<void> {
    // Initialize MCP servers with auto-connect
    try {
      await this.mcpManager.initialize(process.cwd(), true);
      // 触发初始 MCP 服务器状态回调
      this.callbacks.onMcpServersChange?.(this.mcpManager.getAllServers());
    } catch (error) {
      this.logger?.error("Failed to initialize MCP servers:", error);
      // Don't throw error to prevent app startup failure
    }

    // Then handle session restoration
    await this.handleSessionRestoration(restoreSessionId, continueLastSession);
  }

  /**
   * Handle session restoration logic
   */
  private async handleSessionRestoration(
    restoreSessionId?: string,
    continueLastSession?: boolean,
  ): Promise<void> {
    // Clean up expired sessions first
    try {
      await cleanupExpiredSessions();
    } catch (error) {
      console.warn("Failed to cleanup expired sessions:", error);
    }

    if (!restoreSessionId && !continueLastSession) {
      return;
    }

    try {
      let sessionToRestore: SessionData | null = null;

      if (restoreSessionId) {
        sessionToRestore = await loadSession(restoreSessionId);
        if (!sessionToRestore) {
          console.error(`Session not found: ${restoreSessionId}`);
          process.exit(1);
        }
      } else if (continueLastSession) {
        sessionToRestore = await getLatestSession();
        if (!sessionToRestore) {
          console.error(
            `No previous session found for workdir: ${process.cwd()}`,
          );
          process.exit(1);
        }
      }

      if (sessionToRestore) {
        console.log(`Restoring session: ${sessionToRestore.id}`);

        // Initialize from session data
        this.initializeFromSession(
          sessionToRestore.id,
          sessionToRestore.state.messages,
          sessionToRestore.metadata.totalTokens,
        );
      }
    } catch (error) {
      console.error("Failed to restore session:", error);
      process.exit(1);
    }
  }

  public getState(): AIManagerState {
    return { ...this.state };
  }

  public setMessages(messages: Message[]): void {
    this.state.messages = [...messages];
    this.callbacks.onMessagesChange?.([...messages]);

    // 节流保存：只有距离上次保存超过30秒才保存
    const now = Date.now();
    if (now - this.lastSaveTime > 30000) {
      this.lastSaveTime = now;
      // 异步保存会话（不阻塞UI）
      this.saveSession().catch((error) => {
        this.logger?.error(
          "Failed to save session after message update:",
          error,
        );
      });
    }
  }

  // 封装的消息操作函数
  private addUserMessage(
    content: string,
    images?: Array<{ path: string; mimeType: string }>,
  ): void {
    const newMessages = addUserMessageToMessages({
      messages: this.state.messages,
      content,
      images,
    });
    this.setMessages(newMessages);
    this.callbacks.onUserMessageAdded?.(content, images);
  }

  private addAssistantMessage(): void {
    const newMessages = addAssistantMessageToMessages(this.state.messages);
    this.setMessages(newMessages);
    this.callbacks.onAssistantMessageAdded?.();
  }

  private addAnswerBlock(): void {
    const newMessages = addAnswerBlockToMessage(this.state.messages);
    this.setMessages(newMessages);
    this.callbacks.onAnswerBlockAdded?.();
  }

  private updateAnswerBlock(content: string): void {
    const newMessages = updateAnswerBlockInMessage({
      messages: this.state.messages,
      content,
    });
    this.setMessages(newMessages);
    this.callbacks.onAnswerBlockUpdated?.(content);
  }

  private addToolBlock(tool: { id: string; name: string }): void {
    const newMessages = addToolBlockToMessage({
      messages: this.state.messages,
      attributes: tool,
    });
    this.setMessages(newMessages);
    this.callbacks.onToolBlockAdded?.(tool);
  }

  private updateToolBlock(params: AIManagerToolBlockUpdateParams): void {
    const newMessages = updateToolBlockInMessage({
      messages: this.state.messages,
      id: params.toolId,
      parameters: params.args || "",
      result: params.result,
      success: params.success,
      error: params.error,
      isRunning: params.isRunning,
      name: params.name,
      shortResult: params.shortResult,
      compactParams: params.compactParams,
    });
    this.setMessages(newMessages);
    this.callbacks.onToolBlockUpdated?.(params);
  }

  // 生成 compactParams 的辅助方法
  private generateCompactParams(
    toolName: string,
    toolArgs: Record<string, unknown>,
  ): string | undefined {
    try {
      const toolPlugin = this.toolRegistry
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

  private addDiffBlock(
    filePath: string,
    diffResult: Array<{ value: string; added?: boolean; removed?: boolean }>,
    originalContent: string,
    newContent: string,
  ): void {
    const newMessages = addDiffBlockToMessage({
      messages: this.state.messages,
      path: filePath,
      diffResult,
      original: originalContent,
      modified: newContent,
    });
    this.setMessages(newMessages);
    this.callbacks.onDiffBlockAdded?.(filePath, JSON.stringify(diffResult));
  }

  private addErrorBlock(error: string): void {
    const newMessages = addErrorBlockToMessage({
      messages: this.state.messages,
      error,
    });
    this.setMessages(newMessages);
    this.callbacks.onErrorBlockAdded?.(error);
  }

  private addCompressBlock(insertIndex: number, content: string): void {
    const newMessages = addCompressBlockToMessage({
      messages: this.state.messages,
      insertIndex,
      compressContent: content,
    });
    this.setMessages(newMessages);
    this.callbacks.onCompressBlockAdded?.(content);
  }

  private addMemoryBlock(
    content: string,
    success: boolean,
    type: "project" | "user",
    storagePath: string,
  ): void {
    const newMessages = addMemoryBlockToMessage({
      messages: this.state.messages,
      content,
      isSuccess: success,
      memoryType: type,
      storagePath,
    });
    this.setMessages(newMessages);
    this.callbacks.onMemoryBlockAdded?.(content, success, type);
  }

  public setIsLoading(isLoading: boolean): void {
    this.state.isLoading = isLoading;
    this.callbacks.onLoadingChange?.(isLoading);
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
    this.callbacks.onMessagesChange?.([]);
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
      await saveSession(
        this.state.sessionId,
        this.state.messages,
        this.state.totalTokens,
        this.sessionStartTime,
      );
    } catch (error) {
      this.logger?.error("Failed to save session:", error);
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
    return this.bashManager?.getIsCommandRunning() ?? false;
  }

  /**
   * 中断bash命令执行
   */
  public abortBashCommand(): void {
    this.bashManager?.abortCommand();
  }

  /**
   * 销毁管理器，清理资源
   */
  public async destroy(): Promise<void> {
    this.abortAIMessage();
    this.abortBashCommand();
    // Cleanup MCP connections
    await this.mcpManager.cleanup();
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
        await this.bashManager?.executeCommand(command);
        return;
      }

      // Handle normal AI message
      // 添加用户消息到历史记录
      this.addToInputHistory(content);

      // 添加用户消息，会自动同步到 UI
      this.addUserMessage(
        content,
        images?.map((img) => ({
          path: img.path,
          mimeType: img.mimeType,
        })),
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
    this.addAssistantMessage();

    let hasToolOperations = false;

    // 获取近期消息历史
    const recentMessages = convertMessagesForAPI(this.state.messages);

    try {
      // 添加答案块
      this.addAnswerBlock();

      // 读取记忆文件内容
      let memoryContent = "";
      try {
        memoryContent = await readMemoryFile();
      } catch (error) {
        this.logger?.warn("Failed to read memory file:", error);
      }

      // 读取用户级记忆内容
      let userMemoryContent = "";
      try {
        userMemoryContent = await memory.getUserMemoryContent();
      } catch (error) {
        this.logger?.warn("Failed to read user memory file:", error);
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
        tools: this.toolRegistry.getToolsConfig(), // 传递工具配置
      });

      // 更新答案块中的内容
      if (result.content) {
        this.updateAnswerBlock(result.content);
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
          this.logger?.info(
            `Token usage exceeded ${tokenLimit}, compressing messages...`,
          );

          // 检查是否需要压缩消息
          const { messagesToCompress, insertIndex } = getMessagesToCompress(
            this.state.messages,
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
              this.addCompressBlock(insertIndex, compressedContent);

              this.logger?.info(
                `Successfully compressed ${messagesToCompress.length} messages`,
              );
            } catch (compressError) {
              this.logger?.error("Failed to compress messages:", compressError);
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
          this.addToolBlock({
            id: toolId,
            name: functionToolCall.function?.name || "",
          });

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

            this.updateToolBlock({
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
              };

              // 执行工具
              const toolResult = await this.toolRegistry.execute(
                functionToolCall.function?.name || "",
                toolArgs,
                context,
              );

              // 更新消息状态 - 工具执行完成
              this.updateToolBlock({
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
                this.addDiffBlock(
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

              this.updateToolBlock({
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
            this.addErrorBlock(
              `Failed to parse tool arguments for ${functionToolCall.function?.name}: ${errorMessage}`,
            );
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
        this.addErrorBlock(
          error instanceof Error ? error.message : "Unknown error occurred",
        );

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
          this.logger?.error("Failed to save error log:", saveError);
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
      const storagePath = type === "project" ? "WAVE.md" : "user-memory.md";

      this.addMemoryBlock(
        `${typeLabel}: ${memoryText}`,
        true,
        type,
        storagePath,
      );
    } catch (error) {
      // 添加失败的 MemoryBlock 到最后一个助手消息
      const typeLabel = type === "project" ? "项目记忆" : "用户记忆";
      const storagePath = type === "project" ? "WAVE.md" : "user-memory.md";

      this.addMemoryBlock(
        `${typeLabel}添加失败: ${
          error instanceof Error ? error.message : String(error)
        }`,
        false,
        type,
        storagePath,
      );
    }
  }

  // ========== MCP 管理方法 ==========

  /**
   * 获取所有 MCP 服务器状态
   */
  public getMcpServers(): McpServerStatus[] {
    return this.mcpManager.getAllServers();
  }

  /**
   * 连接 MCP 服务器
   */
  public async connectMcpServer(serverName: string): Promise<boolean> {
    const result = await this.mcpManager.connectServer(serverName);
    // 触发状态变化回调
    this.callbacks.onMcpServersChange?.(this.mcpManager.getAllServers());
    return result;
  }

  /**
   * 断开 MCP 服务器连接
   */
  public async disconnectMcpServer(serverName: string): Promise<boolean> {
    const result = await this.mcpManager.disconnectServer(serverName);
    // 触发状态变化回调
    this.callbacks.onMcpServersChange?.(this.mcpManager.getAllServers());
    return result;
  }

  /**
   * 重连 MCP 服务器
   */
  public async reconnectMcpServer(serverName: string): Promise<boolean> {
    const result = await this.mcpManager.reconnectServer(serverName);
    // 触发状态变化回调
    this.callbacks.onMcpServersChange?.(this.mcpManager.getAllServers());
    return result;
  }
}
