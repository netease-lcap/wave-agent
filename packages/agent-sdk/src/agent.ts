import {
  MessageManager,
  type MessageManagerCallbacks,
} from "./managers/messageManager.js";
import { AIManager } from "./managers/aiManager.js";
import { ToolManager } from "./managers/toolManager.js";
import * as memory from "./services/memory.js";
import { McpManager, McpServerStatus } from "./managers/mcpManager.js";
import { BashManager } from "./managers/bashManager.js";
import type { Message, Logger } from "./types.js";

export interface AgentOptions {
  callbacks?: AgentCallbacks;
  restoreSessionId?: string;
  continueLastSession?: boolean;
  logger?: Logger;
  /**添加可选的初始消息参数，方便测试 */
  messages?: Message[];
}

export interface AgentCallbacks extends MessageManagerCallbacks {
  /** Agent 自身的回调 */
  onLoadingChange?: (isLoading: boolean) => void;
  /** MCP 服务器状态回调 */
  onMcpServersChange?: (servers: McpServerStatus[]) => void;
  /** 命令运行状态回调 */
  onCommandRunningChange?: (isRunning: boolean) => void;
  /** 用户输入历史回调 */
  onUserInputHistoryChange?: (history: string[]) => void;
}

export class Agent {
  private messageManager: MessageManager;
  private aiManager: AIManager;
  private callbacks: AgentCallbacks;

  private bashManager: BashManager | null = null;
  private logger?: Logger; // 添加可选的 logger 属性
  private toolManager: ToolManager; // 添加工具注册表实例
  private mcpManager: McpManager; // 添加 MCP 管理器实例

  // 私有构造函数，防止直接实例化
  private constructor(options: AgentOptions) {
    const { callbacks = {}, logger } = options;

    this.callbacks = callbacks;
    this.logger = logger; // 保存传入的 logger
    this.mcpManager = new McpManager(this.logger); // 初始化 MCP 管理器
    this.toolManager = new ToolManager(this.mcpManager); // 初始化工具注册表，传入 MCP 管理器

    // 初始化 MessageManager
    this.messageManager = new MessageManager(
      {
        onMessagesChange: callbacks.onMessagesChange,
        onSessionIdChange: callbacks.onSessionIdChange,
        onLatestTotalTokensChange: callbacks.onLatestTotalTokensChange,
        onUserInputHistoryChange: callbacks.onUserInputHistoryChange,
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

    // Initialize AI manager
    this.aiManager = new AIManager({
      onLoadingChange: callbacks.onLoadingChange,
      messageManager: this.messageManager,
      toolManager: this.toolManager,
      logger: this.logger,
    });

    // Initialize bash manager
    this.bashManager = new BashManager({
      onCommandRunningChange: callbacks.onCommandRunningChange,
      messageManager: this.messageManager,
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

  public get latestTotalTokens(): number {
    return this.messageManager.getlatestTotalTokens();
  }

  public get userInputHistory(): string[] {
    return this.messageManager.getUserInputHistory();
  }

  /** 获取AI加载状态 */
  public get isLoading(): boolean {
    return this.aiManager.isLoading;
  }

  /** 获取bash命令执行状态 */
  public get isCommandRunning(): boolean {
    return this.bashManager?.isCommandRunning ?? false;
  }

  /** 静态异步工厂方法 */
  static async create(options: AgentOptions): Promise<Agent> {
    const instance = new Agent(options);
    await instance.initialize({
      restoreSessionId: options.restoreSessionId,
      continueLastSession: options.continueLastSession,
      messages: options.messages,
    });
    return instance;
  }

  /** 私有初始化方法，处理异步初始化逻辑 */
  private async initialize(options?: {
    restoreSessionId?: string;
    continueLastSession?: boolean;
    messages?: Message[];
  }): Promise<void> {
    // Initialize MCP servers with auto-connect
    try {
      await this.mcpManager.initialize(process.cwd(), true);
      // 触发初始 MCP 服务器状态回调
      this.callbacks.onMcpServersChange?.(this.mcpManager.getAllServers());
    } catch (error) {
      this.logger?.error("Failed to initialize MCP servers:", error);
      // Don't throw error to prevent app startup failure
    }

    // Handle session restoration or set provided messages
    if (options?.messages) {
      // If messages are provided, use them directly (useful for testing)
      this.messageManager.setMessages(options.messages);
    } else {
      // Otherwise, handle session restoration
      await this.messageManager.handleSessionRestoration(
        options?.restoreSessionId,
        options?.continueLastSession,
      );
    }
  }

  public abortAIMessage(): void {
    this.aiManager.abortAIMessage();
  }

  /** 清空消息和输入历史 */
  public clearMessages(): void {
    this.messageManager.clearMessages();
  }

  /** 统一的中断方法，同时中断AI消息和命令执行 */
  public abortMessage(): void {
    this.abortAIMessage();
    this.abortBashCommand();
  }

  /** 添加到输入历史记录 */
  public addToInputHistory(input: string): void {
    this.messageManager.addToInputHistory(input);
  }

  /** 中断bash命令执行 */
  public abortBashCommand(): void {
    this.bashManager?.abortCommand();
  }

  /** 销毁管理器，清理资源 */
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
      await this.aiManager.sendAIMessage();
    } catch (error) {
      console.error("Failed to add user message:", error);
      // Loading state will be automatically updated by the useEffect that watches messages
    }
  }

  /** 保存记忆到项目或用户记忆文件 */
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

  /** 获取所有 MCP 服务器状态 */
  public getMcpServers(): McpServerStatus[] {
    return this.mcpManager.getAllServers();
  }

  /** 连接 MCP 服务器 */
  public async connectMcpServer(serverName: string): Promise<boolean> {
    const result = await this.mcpManager.connectServer(serverName);
    // 触发状态变化回调
    this.callbacks.onMcpServersChange?.(this.mcpManager.getAllServers());
    return result;
  }

  /** 断开 MCP 服务器连接 */
  public async disconnectMcpServer(serverName: string): Promise<boolean> {
    const result = await this.mcpManager.disconnectServer(serverName);
    // 触发状态变化回调
    this.callbacks.onMcpServersChange?.(this.mcpManager.getAllServers());
    return result;
  }

  /** 重连 MCP 服务器 */
  public async reconnectMcpServer(serverName: string): Promise<boolean> {
    const result = await this.mcpManager.reconnectServer(serverName);
    // 触发状态变化回调
    this.callbacks.onMcpServersChange?.(this.mcpManager.getAllServers());
    return result;
  }
}
