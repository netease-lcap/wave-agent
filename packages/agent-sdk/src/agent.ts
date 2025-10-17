import {
  MessageManager,
  type MessageManagerCallbacks,
} from "./managers/messageManager.js";
import { AIManager } from "./managers/aiManager.js";
import { ToolManager } from "./managers/toolManager.js";
import * as memory from "./services/memory.js";
import { McpManager, type McpManagerCallbacks } from "./managers/mcpManager.js";
import { BashManager } from "./managers/bashManager.js";
import {
  BackgroundBashManager,
  type BackgroundBashManagerCallbacks,
} from "./managers/backgroundBashManager.js";
import { SlashCommandManager } from "./managers/slashCommandManager.js";
import type { SlashCommand, CustomSlashCommand } from "./types.js";
import type { Message, Logger, McpServerStatus } from "./types.js";

export interface AgentOptions {
  callbacks?: AgentCallbacks;
  restoreSessionId?: string;
  continueLastSession?: boolean;
  logger?: Logger;
  /**添加可选的初始消息参数，方便测试 */
  messages?: Message[];
}

export interface AgentCallbacks
  extends MessageManagerCallbacks,
    BackgroundBashManagerCallbacks,
    McpManagerCallbacks {}

export class Agent {
  private messageManager: MessageManager;
  private aiManager: AIManager;
  private callbacks: AgentCallbacks;

  private bashManager: BashManager | null = null;
  private backgroundBashManager: BackgroundBashManager;
  private logger?: Logger; // 添加可选的 logger 属性
  private toolManager: ToolManager; // 添加工具注册表实例
  private mcpManager: McpManager; // 添加 MCP 管理器实例
  private slashCommandManager: SlashCommandManager; // 添加斜杠命令管理器实例

  // 私有构造函数，防止直接实例化
  private constructor(options: AgentOptions) {
    const { callbacks = {}, logger } = options;

    this.callbacks = callbacks;
    this.logger = logger; // 保存传入的 logger
    this.backgroundBashManager = new BackgroundBashManager({ callbacks });
    this.mcpManager = new McpManager({ callbacks, logger: this.logger }); // 初始化 MCP 管理器
    this.toolManager = new ToolManager({ mcpManager: this.mcpManager }); // 初始化工具注册表，传入 MCP 管理器

    // 初始化 MessageManager
    this.messageManager = new MessageManager({
      callbacks,
      logger: this.logger,
    });

    // Initialize command manager
    this.slashCommandManager = new SlashCommandManager({
      messageManager: this.messageManager,
      toolManager: this.toolManager,
      backgroundBashManager: this.backgroundBashManager,
      logger: this.logger,
    });

    // Initialize AI manager
    this.aiManager = new AIManager({
      messageManager: this.messageManager,
      toolManager: this.toolManager,
      logger: this.logger,
      backgroundBashManager: this.backgroundBashManager,
      callbacks,
    });

    // Initialize bash manager
    this.bashManager = new BashManager({
      messageManager: this.messageManager,
    });
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

  /** 获取消息压缩状态 */
  public get isCompressing(): boolean {
    return this.aiManager.getIsCompressing();
  }

  /** 获取bash命令执行状态 */
  public get isCommandRunning(): boolean {
    return this.bashManager?.isCommandRunning ?? false;
  }

  /** 获取后台 bash shell 输出 */
  public getBackgroundShellOutput(
    id: string,
    filter?: string,
  ): { stdout: string; stderr: string; status: string } | null {
    return this.backgroundBashManager.getOutput(id, filter);
  }

  /** 杀死后台 bash shell */
  public killBackgroundShell(id: string): boolean {
    return this.backgroundBashManager.killShell(id);
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

  /** 执行 bash 命令 */
  public async executeBashCommand(command: string): Promise<void> {
    // 添加用户消息到历史记录（但不显示在UI中）
    this.addToInputHistory(`!${command}`);
    await this.bashManager?.executeCommand(command);
  }

  /** 清空消息和输入历史 */
  public clearMessages(): void {
    this.messageManager.clearMessages();
  }

  /** 统一的中断方法，同时中断AI消息和命令执行 */
  public abortMessage(): void {
    this.abortAIMessage();
    this.abortBashCommand();
    this.abortSlashCommand();
  }

  /** 添加到输入历史记录 */
  private addToInputHistory(input: string): void {
    this.messageManager.addToInputHistory(input);
  }

  /** 中断bash命令执行 */
  public abortBashCommand(): void {
    this.bashManager?.abortCommand();
  }

  /** 中断斜杠命令执行 */
  public abortSlashCommand(): void {
    this.slashCommandManager.abortCurrentCommand();
  }

  /** 销毁管理器，清理资源 */
  public async destroy(): Promise<void> {
    this.messageManager.saveSession();
    this.abortAIMessage();
    this.abortBashCommand();
    this.abortSlashCommand();
    // Cleanup background bash manager
    this.backgroundBashManager.cleanup();
    // Cleanup MCP connections
    await this.mcpManager.cleanup();
  }

  public async sendMessage(
    content: string,
    images?: Array<{ path: string; mimeType: string }>,
  ): Promise<void> {
    try {
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
    return await this.mcpManager.connectServer(serverName);
  }

  /** 断开 MCP 服务器连接 */
  public async disconnectMcpServer(serverName: string): Promise<boolean> {
    return await this.mcpManager.disconnectServer(serverName);
  }

  // ========== 斜杠命令管理方法 ==========

  /** 获取所有可用斜杠命令 */
  public getSlashCommands(): SlashCommand[] {
    return this.slashCommandManager.getCommands();
  }

  /** 执行斜杠命令 */
  public async executeSlashCommand(commandId: string): Promise<boolean> {
    return await this.slashCommandManager.executeCommand(commandId);
  }

  /** 解析并执行完整的斜杠命令输入 */
  public async executeSlashCommandInput(input: string): Promise<boolean> {
    return await this.slashCommandManager.executeSlashCommandInput(input);
  }

  /** 检查斜杠命令是否存在 */
  public hasSlashCommand(commandId: string): boolean {
    return this.slashCommandManager.hasCommand(commandId);
  }

  /** 重新加载自定义命令 */
  public reloadCustomCommands(): void {
    this.slashCommandManager.reloadCustomCommands();
  }

  /** 获取自定义命令详情 */
  public getCustomCommand(commandId: string): CustomSlashCommand | undefined {
    return this.slashCommandManager.getCustomCommand(commandId);
  }

  /** 获取所有自定义命令 */
  public getCustomCommands(): CustomSlashCommand[] {
    return this.slashCommandManager.getCustomCommands();
  }
}
