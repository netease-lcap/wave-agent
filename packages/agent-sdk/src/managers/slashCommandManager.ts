import type { MessageManager } from "./messageManager.js";
import type { SlashCommand } from "../types.js";

export interface SlashCommandManagerOptions {
  messageManager: MessageManager;
}

export class SlashCommandManager {
  private commands = new Map<string, SlashCommand>();
  private messageManager: MessageManager;

  constructor(options: SlashCommandManagerOptions) {
    this.messageManager = options.messageManager;
    this.initializeBuiltinCommands();
  }

  private initializeBuiltinCommands(): void {
    // 注册内置的 clear 命令
    this.registerCommand({
      id: "clear",
      name: "clear",
      description: "Clear the chat session",
      handler: () => {
        this.messageManager.clearMessages();
      },
    });
  }

  /**
   * 注册新命令
   */
  private registerCommand(command: SlashCommand): void {
    this.commands.set(command.id, command);
  }

  /**
   * 取消注册命令
   */
  private unregisterCommand(commandId: string): boolean {
    return this.commands.delete(commandId);
  }

  /**
   * 获取所有可用命令
   */
  public getCommands(): SlashCommand[] {
    return Array.from(this.commands.values());
  }

  /**
   * 根据ID获取命令
   */
  public getCommand(commandId: string): SlashCommand | undefined {
    return this.commands.get(commandId);
  }

  /**
   * 执行命令
   */
  public async executeCommand(commandId: string): Promise<boolean> {
    const command = this.commands.get(commandId);
    if (!command) {
      return false;
    }

    try {
      await command.handler();
      return true;
    } catch (error) {
      console.error(`Failed to execute slash command ${commandId}:`, error);
      return false;
    }
  }

  /**
   * 检查命令是否存在
   */
  public hasCommand(commandId: string): boolean {
    return this.commands.has(commandId);
  }
}
