import type { MessageManager } from "./messageManager.js";
import type { SlashCommand, CustomSlashCommand, Logger } from "../types.js";
import { loadCustomSlashCommands } from "../utils/customCommands.js";
import { SubAgentManager } from "./subAgentManager.js";
import type { ToolManager } from "./toolManager.js";
import type { BackgroundBashManager } from "./backgroundBashManager.js";
import {
  substituteCommandParameters,
  parseSlashCommandInput,
  hasParameterPlaceholders,
} from "../utils/commandArgumentParser.js";

export interface SlashCommandManagerOptions {
  messageManager: MessageManager;
  toolManager: ToolManager;
  backgroundBashManager?: BackgroundBashManager;
  logger?: Logger;
}

export class SlashCommandManager {
  private commands = new Map<string, SlashCommand>();
  private customCommands = new Map<string, CustomSlashCommand>();
  private messageManager: MessageManager;
  private subAgentManager: SubAgentManager;
  private logger?: Logger;

  constructor(options: SlashCommandManagerOptions) {
    this.messageManager = options.messageManager;
    this.logger = options.logger;

    // Initialize sub-agent manager for custom commands
    this.subAgentManager = new SubAgentManager({
      mainMessageManager: options.messageManager,
      toolManager: options.toolManager,
      backgroundBashManager: options.backgroundBashManager,
      logger: options.logger,
    });

    this.initializeBuiltinCommands();
    this.loadCustomCommands();
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
   * Load custom commands from filesystem
   */
  private loadCustomCommands(): void {
    try {
      const customCommands = loadCustomSlashCommands();

      for (const command of customCommands) {
        this.customCommands.set(command.id, command);

        // Register as a regular command with a handler that executes the custom command
        this.registerCommand({
          id: command.id,
          name: command.name,
          description: `Custom command: ${command.name}${hasParameterPlaceholders(command.content) ? " (supports parameters)" : ""}`,
          handler: async (args?: string) => {
            // Substitute parameters in the command content
            const processedContent =
              hasParameterPlaceholders(command.content) && args
                ? substituteCommandParameters(command.content, args)
                : command.content;

            await this.subAgentManager.executeCustomCommand(
              command.name,
              processedContent,
              command.config,
            );
          },
        });
      }

      this.logger?.info(`Loaded ${customCommands.length} custom commands`);
    } catch (error) {
      this.logger?.warn("Failed to load custom commands:", error);
    }
  }

  /**
   * Reload custom commands (useful for development)
   */
  public reloadCustomCommands(): void {
    // Clear existing custom commands
    for (const commandId of this.customCommands.keys()) {
      this.unregisterCommand(commandId);
    }
    this.customCommands.clear();

    // Reload
    this.loadCustomCommands();
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
  public async executeCommand(
    commandId: string,
    args?: string,
  ): Promise<boolean> {
    const command = this.commands.get(commandId);
    if (!command) {
      return false;
    }

    try {
      await command.handler(args);
      return true;
    } catch (error) {
      console.error(`Failed to execute slash command ${commandId}:`, error);
      return false;
    }
  }

  /**
   * Parse and execute a full slash command input (e.g., "/fix-issue 123 high")
   */
  public async executeSlashCommandInput(input: string): Promise<boolean> {
    try {
      const { command: commandId, args } = parseSlashCommandInput(input);
      return await this.executeCommand(commandId, args);
    } catch (error) {
      console.error(`Failed to parse slash command input "${input}":`, error);
      return false;
    }
  }

  /**
   * 检查命令是否存在
   */
  public hasCommand(commandId: string): boolean {
    return this.commands.has(commandId);
  }

  /**
   * Get custom command details
   */
  public getCustomCommand(commandId: string): CustomSlashCommand | undefined {
    return this.customCommands.get(commandId);
  }

  /**
   * Get all custom commands
   */
  public getCustomCommands(): CustomSlashCommand[] {
    return Array.from(this.customCommands.values());
  }

  /**
   * 中断当前正在执行的斜杠命令
   */
  public abortCurrentCommand(): void {
    this.subAgentManager.abortCurrentTask();
  }
}
