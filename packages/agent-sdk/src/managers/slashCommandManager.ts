import type { MessageManager } from "./messageManager.js";
import type { AIManager } from "./aiManager.js";
import type { SlashCommand, CustomSlashCommand, Logger } from "../types.js";
import { loadCustomSlashCommands } from "../utils/customCommands.js";

import {
  substituteCommandParameters,
  parseSlashCommandInput,
  hasParameterPlaceholders,
} from "../utils/commandArgumentParser.js";
import {
  BashCommandResult,
  parseBashCommands,
  replaceBashCommandsWithOutput,
} from "../utils/markdownParser.js";
import { exec } from "child_process";
import { promisify } from "util";

const execAsync = promisify(exec);

export interface SlashCommandManagerOptions {
  messageManager: MessageManager;
  aiManager: AIManager;
  workdir: string;
  logger?: Logger;
}

export class SlashCommandManager {
  private commands = new Map<string, SlashCommand>();
  private customCommands = new Map<string, CustomSlashCommand>();
  private messageManager: MessageManager;
  private aiManager: AIManager;
  private workdir: string;
  private logger?: Logger;

  constructor(options: SlashCommandManagerOptions) {
    this.messageManager = options.messageManager;
    this.aiManager = options.aiManager;
    this.workdir = options.workdir;
    this.logger = options.logger;

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
      const customCommands = loadCustomSlashCommands(this.workdir);

      for (const command of customCommands) {
        this.customCommands.set(command.id, command);

        // 生成描述：优先使用自定义描述，否则使用默认描述
        const description =
          command.description ||
          `Custom command: ${command.name}${hasParameterPlaceholders(command.content) ? " (supports parameters)" : ""}`;

        // Register as a regular command with a handler that executes the custom command
        this.registerCommand({
          id: command.id,
          name: command.name,
          description,
          handler: async (args?: string) => {
            // Substitute parameters in the command content
            const processedContent =
              hasParameterPlaceholders(command.content) && args
                ? substituteCommandParameters(command.content, args)
                : command.content;

            await this.executeCustomCommandInMainAgent(
              command.name,
              processedContent,
              command.config,
              args,
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
   * Parse and validate a slash command input
   * Returns whether the command is valid along with parsed commandId and args
   */
  public parseAndValidateSlashCommand(input: string): {
    isValid: boolean;
    commandId?: string;
    args?: string;
  } {
    try {
      const { command: commandId, args } = parseSlashCommandInput(input);
      const isValid = this.hasCommand(commandId);
      return {
        isValid,
        commandId: isValid ? commandId : undefined,
        args: isValid ? args || undefined : undefined, // Convert empty string to undefined
      };
    } catch (error) {
      console.error(`Failed to parse slash command input "${input}":`, error);
      return { isValid: false };
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
   * Execute custom command in main agent instead of sub-agent
   */
  private async executeCustomCommandInMainAgent(
    commandName: string,
    content: string,
    config?: { model?: string; allowedTools?: string[] },
    args?: string,
  ): Promise<void> {
    try {
      // Parse bash commands from the content
      const { commands, processedContent } = parseBashCommands(content);

      // Execute bash commands if any
      const bashResults: BashCommandResult[] = [];
      for (const command of commands) {
        try {
          const { stdout, stderr } = await execAsync(command, {
            cwd: this.workdir,
            timeout: 30000, // 30 second timeout
          });
          bashResults.push({
            command,
            output: stdout || stderr || "",
            exitCode: 0,
          });
        } catch (error) {
          const execError = error as {
            stdout?: string;
            stderr?: string;
            message?: string;
            code?: number;
          };
          bashResults.push({
            command,
            output:
              execError.stdout || execError.stderr || execError.message || "",
            exitCode: execError.code || 1,
          });
        }
      }

      // Replace bash command placeholders with their outputs
      const finalContent =
        bashResults.length > 0
          ? replaceBashCommandsWithOutput(processedContent, bashResults)
          : processedContent;

      // Add custom command block to show the command being executed
      const originalInput = args
        ? `/${commandName} ${args}`
        : `/${commandName}`;
      this.messageManager.addCustomCommandMessage(
        commandName,
        finalContent,
        originalInput,
      );

      // Execute the AI conversation with custom configuration
      await this.aiManager.sendAIMessage({
        model: config?.model,
        allowedTools: config?.allowedTools,
      });
    } catch (error) {
      this.logger?.error(
        `Failed to execute custom command '${commandName}':`,
        error,
      );

      // Add error to message manager
      this.messageManager.addErrorBlock(
        `Failed to execute custom command '${commandName}': ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  /**
   * 中断当前正在执行的斜杠命令
   */
  public abortCurrentCommand(): void {
    // Abort the AI manager if it's running
    this.aiManager.abortAIMessage();
  }
}
