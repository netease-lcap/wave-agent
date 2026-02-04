import type { MessageManager } from "./messageManager.js";
import type { AIManager } from "./aiManager.js";
import type {
  SlashCommand,
  CustomSlashCommand,
  Logger,
} from "../types/index.js";
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
import { INIT_PROMPT } from "../constants/prompts.js";

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
    // Register built-in clear command
    this.registerCommand({
      id: "clear",
      name: "clear",
      description: "Clear the chat session and terminal",
      handler: () => {
        // Clear chat messages
        this.messageManager.clearMessages();
        // Clear terminal screen
        process.stdout.write("\x1Bc");
      },
    });

    // Register built-in init command
    this.registerCommand({
      id: "init",
      name: "init",
      description:
        "Initialize repository for AI agents by generating AGENTS.md",
      handler: async () => {
        // Add custom command message to show the command being executed
        this.messageManager.addUserMessage({
          content: "/init",
          customCommandContent: INIT_PROMPT,
        });

        // Execute the AI conversation with the init prompt
        await this.aiManager.sendAIMessage();
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

        // Generate description: prioritize custom description, otherwise use default description
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
            let processedContent = command.content;
            if (args) {
              if (hasParameterPlaceholders(command.content)) {
                processedContent = substituteCommandParameters(
                  command.content,
                  args,
                );
              } else {
                // If no placeholders, append arguments to the content
                processedContent = `${command.content.trim()} ${args}`;
              }
            }

            await this.executeCustomCommandInMainAgent(
              command.name,
              processedContent,
              command.config,
              args,
              command.pluginPath,
            );
          },
        });
      }

      this.logger?.debug(`Loaded ${customCommands.length} custom commands`);
    } catch (error) {
      this.logger?.warn("Failed to load custom commands:", error);
    }
  }

  /**
   * Register commands from a plugin with namespacing
   */
  public registerPluginCommands(
    pluginName: string,
    commands: CustomSlashCommand[],
  ): void {
    for (const command of commands) {
      const namespacedId = `${pluginName}:${command.id}`;
      const namespacedName = `${pluginName}:${command.name}`;

      this.customCommands.set(namespacedId, command);

      // Generate description: prioritize custom description, otherwise use default description
      const description =
        command.description ||
        `Plugin command: ${namespacedName}${hasParameterPlaceholders(command.content) ? " (supports parameters)" : ""}`;

      // Register as a regular command with a handler that executes the custom command
      this.registerCommand({
        id: namespacedId,
        name: namespacedName,
        description,
        handler: async (args?: string) => {
          // Substitute parameters in the command content
          let processedContent = command.content;
          if (args) {
            if (hasParameterPlaceholders(command.content)) {
              processedContent = substituteCommandParameters(
                command.content,
                args,
              );
            } else {
              // If no placeholders, append arguments to the content
              processedContent = `${command.content.trim()} ${args}`;
            }
          }

          await this.executeCustomCommandInMainAgent(
            namespacedName,
            processedContent,
            command.config,
            args,
            command.pluginPath,
          );
        },
      });
    }

    this.logger?.debug(
      `Registered ${commands.length} commands from plugin '${pluginName}'`,
    );
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
   * Register new command
   */
  public registerCommand(command: SlashCommand): void {
    this.commands.set(command.id, command);
    this.messageManager.triggerSlashCommandsChange(this.getCommands());
  }

  /**
   * Unregister command
   */
  private unregisterCommand(commandId: string): boolean {
    return this.commands.delete(commandId);
  }

  /**
   * Get all available commands
   */
  public getCommands(): SlashCommand[] {
    return Array.from(this.commands.values());
  }

  /**
   * Get command by ID
   */
  public getCommand(commandId: string): SlashCommand | undefined {
    return this.commands.get(commandId);
  }

  /**
   * Execute command
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
   * Check if command exists
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
    pluginPath?: string,
  ): Promise<void> {
    try {
      // Parse bash commands from the content
      const { commands, processedContent } = parseBashCommands(content);

      // Execute bash commands if any
      const bashResults: BashCommandResult[] = [];
      for (const command of commands) {
        try {
          // Set WAVE_PLUGIN_ROOT environment variable for plugin commands
          const env = pluginPath
            ? { ...process.env, WAVE_PLUGIN_ROOT: pluginPath }
            : process.env;

          const { stdout, stderr } = await execAsync(command, {
            cwd: this.workdir,
            timeout: 30000, // 30 second timeout
            env,
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

      // Add custom command message to show the command being executed
      const originalInput = args
        ? `/${commandName} ${args}`
        : `/${commandName}`;
      this.messageManager.addUserMessage({
        content: originalInput,
        customCommandContent: finalContent,
      });

      // Execute the AI conversation with custom configuration
      await this.aiManager.sendAIMessage({
        model: config?.model,
        allowedRules: config?.allowedTools,
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
   * Interrupt the currently executing slash command
   */
  public abortCurrentCommand(): void {
    // Abort the AI manager if it's running
    this.aiManager.abortAIMessage();
  }
}
