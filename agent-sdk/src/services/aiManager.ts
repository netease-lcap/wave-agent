import { callAgent, compressMessages } from "./aiService.js";
import { getMessagesToCompress } from "../utils/messageOperations.js";
import {
  MessageManager,
  type MessageManagerCallbacks,
} from "./messageManager.js";
import { ToolRegistryImpl } from "../tools/index.js";
import type { ToolContext } from "../tools/types.js";
import { convertMessagesForAPI } from "../utils/convertMessagesForAPI.js";
import { saveErrorLog } from "../utils/errorLogger.js";
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

export interface AIManagerCallbacks extends MessageManagerCallbacks {
  // AIManager 自身的回调
  onLoadingChange?: (isLoading: boolean) => void;
  // MCP 服务器状态回调
  onMcpServersChange?: (servers: McpServerStatus[]) => void;
}

export class AIManager {
  private messageManager: MessageManager;
  public isLoading: boolean;
  private callbacks: AIManagerCallbacks;
  private abortController: AbortController | null = null;
  private toolAbortController: AbortController | null = null;

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
    this.isLoading = false;

    // 初始化 MessageManager
    this.messageManager = new MessageManager(
      {
        onMessagesChange: callbacks.onMessagesChange,
        onSessionIdChange: callbacks.onSessionIdChange,
        onTotalTokensChange: callbacks.onTotalTokensChange,
        onUserMessageAdded: callbacks.onUserMessageAdded,
        onAssistantMessageAdded: callbacks.onAssistantMessageAdded,
        onAnswerBlockAdded: callbacks.onAnswerBlockAdded,
        onAnswerBlockUpdated: callbacks.onAnswerBlockUpdated,
        onToolBlockAdded: callbacks.onToolBlockAdded,
        onToolBlockUpdated: callbacks.onToolBlockUpdated,
        onDiffBlockAdded: callbacks.onDiffBlockAdded,
        onErrorBlockAdded: callbacks.onErrorBlockAdded,
        onCompressBlockAdded: callbacks.onCompressBlockAdded,
        onMemoryBlockAdded: callbacks.onMemoryBlockAdded,
        onAddCommandOutputMessage: callbacks.onAddCommandOutputMessage,
        onUpdateCommandOutputMessage: callbacks.onUpdateCommandOutputMessage,
        onCompleteCommandMessage: callbacks.onCompleteCommandMessage,
      },
      this.logger,
    );

    // Initialize bash manager
    this.bashManager = new BashManager({
      onAddCommandOutputMessage: (command: string) => {
        this.messageManager.addCommandOutputMessage(command);
      },
      onUpdateCommandOutputMessage: (command: string, output: string) => {
        this.messageManager.updateCommandOutputMessage(command, output);
      },
      onCompleteCommandMessage: (command: string, exitCode: number) => {
        this.messageManager.completeCommandMessage(command, exitCode);
      },
    });

    // Note: Process termination handling is now done at the CLI level
    // Note: MCP servers and session restoration are handled in initialize()
  }

  // 公开的 getter 方法
  public get sessionId(): string {
    return this.messageManager.getSessionId();
  }

  public get messages(): Message[] {
    return this.messageManager.getMessages();
  }

  public get totalTokens(): number {
    return this.messageManager.getTotalTokens();
  }

  public get userInputHistory(): string[] {
    return this.messageManager.getUserInputHistory();
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
    await this.messageManager.handleSessionRestoration(
      restoreSessionId,
      continueLastSession,
    );
  }

  // 设置消息并触发回调
  public setMessages(messages: Message[]): void {
    this.messageManager.setMessages(messages);
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

  /**
   * 清空消息和输入历史
   */
  public clearMessages(): void {
    this.messageManager.clearMessages();
  }

  /**
   * 统一的中断方法，同时中断AI消息和命令执行
   */
  public abortMessage(): void {
    this.abortAIMessage();
    this.abortBashCommand();
  }

  /**
   * 添加到输入历史记录
   */
  public addToInputHistory(input: string): void {
    this.messageManager.addToInputHistory(input);
  }

  // 私有的 setIsLoading 方法
  private setIsLoading(isLoading: boolean): void {
    this.isLoading = isLoading;
    this.callbacks.onLoadingChange?.(isLoading);
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
    this.messageManager.saveSession();
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
      this.messageManager.addUserMessage(
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

    // 添加助手消息
    this.messageManager.addAssistantMessage();

    let hasToolOperations = false;

    // 获取近期消息历史
    const recentMessages = convertMessagesForAPI(this.messages);

    try {
      // 添加答案块
      this.messageManager.addAnswerBlock();

      // 获取合并的记忆内容
      const combinedMemory = await memory.getCombinedMemoryContent();

      // 调用 AI 服务（非流式）
      const result = await callAgent({
        messages: recentMessages,
        sessionId: this.sessionId,
        abortSignal: abortController.signal,
        memory: combinedMemory, // 传递合并后的记忆内容
        workdir: process.cwd(), // 传递当前工作目录
        tools: this.toolRegistry.getToolsConfig(), // 传递工具配置
      });

      // 更新答案块中的内容
      if (result.content) {
        this.messageManager.updateAnswerBlock(result.content);
      }

      // 更新 token 统计 - 显示最新一次的token使用量
      if (result.usage) {
        this.messageManager.setTotalTokens(result.usage.total_tokens);

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
            this.messages,
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
              this.messageManager.addCompressBlock(
                insertIndex,
                compressedContent,
              );

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
          this.messageManager.addToolBlock({
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
              };

              // 执行工具
              const toolResult = await this.toolRegistry.execute(
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
        this.messageManager.addErrorBlock(
          error instanceof Error ? error.message : "Unknown error occurred",
        );

        // 保存错误时发送给AI的参数到文件
        try {
          await saveErrorLog(
            error,
            this.sessionId,
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

      this.messageManager.addMemoryBlock(
        `${typeLabel}: ${memoryText}`,
        true,
        type,
        storagePath,
      );
    } catch (error) {
      // 添加失败的 MemoryBlock 到最后一个助手消息
      const typeLabel = type === "project" ? "项目记忆" : "用户记忆";
      const storagePath = type === "project" ? "WAVE.md" : "user-memory.md";

      this.messageManager.addMemoryBlock(
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
