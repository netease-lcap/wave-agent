import type { MessageManager } from "./messageManager.js";
import type { AIManager } from "./aiManager.js";
import type { BackgroundTaskManager } from "./backgroundTaskManager.js";
import type { TaskManager } from "../services/taskManager.js";
import type { SlashCommand, CustomSlashCommand } from "../types/index.js";
import { loadCustomSlashCommands } from "../utils/customCommands.js";

import {
  substituteCommandParameters,
  parseSlashCommandInput,
  hasParameterPlaceholders,
} from "../utils/commandArgumentParser.js";
import { Container } from "../utils/container.js";
import {
  parseBashCommands,
  replaceBashCommandsWithOutput,
  executeBashCommands,
} from "../utils/markdownParser.js";
import { INIT_PROMPT } from "../prompts/index.js";
import type { SkillManager } from "./skillManager.js";
import type { SkillMetadata } from "../types/skills.js";

import { logger } from "../utils/globalLogger.js";

export interface SlashCommandManagerOptions {
  workdir: string;
}

export class SlashCommandManager {
  private commands = new Map<string, SlashCommand>();
  private customCommands = new Map<string, CustomSlashCommand>();
  private skillCommandIds = new Set<string>();
  private workdir: string;

  constructor(
    private container: Container,
    options: SlashCommandManagerOptions,
  ) {
    this.workdir = options.workdir;
  }

  public initialize(): void {
    this.initializeBuiltinCommands();
    this.loadCustomCommands();
  }

  private get messageManager(): MessageManager {
    return this.container.get<MessageManager>("MessageManager")!;
  }

  private get aiManager(): AIManager {
    return this.container.get<AIManager>("AIManager")!;
  }

  private get backgroundTaskManager(): BackgroundTaskManager {
    return this.container.get<BackgroundTaskManager>("BackgroundTaskManager")!;
  }

  private get taskManager(): TaskManager {
    return this.container.get<TaskManager>("TaskManager")!;
  }

  private get skillManager(): SkillManager {
    return this.container.get<SkillManager>("SkillManager")!;
  }

  private initializeBuiltinCommands(): void {
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

            // Substitute $WAVE_PLUGIN_ROOT placeholder for plugin commands
            if (command.pluginPath) {
              processedContent = processedContent.replace(
                /\$WAVE_PLUGIN_ROOT/g,
                command.pluginPath,
              );
            }

            if (args) {
              if (hasParameterPlaceholders(processedContent)) {
                processedContent = substituteCommandParameters(
                  processedContent,
                  args,
                );
              } else {
                // If no placeholders, append arguments to the content
                processedContent = `${processedContent.trim()} ${args}`;
              }
            }

            await this.executeCustomCommandInMainAgent(
              command.name,
              processedContent,
              command.config,
              args,
            );
          },
        });
      }

      logger?.debug(`Loaded ${customCommands.length} custom commands`);
    } catch (error) {
      logger?.warn("Failed to load custom commands:", error);
    }
  }

  /**
   * Register skills as slash commands
   */
  public registerSkillCommands(skills: SkillMetadata[]): void {
    // Clear existing skill commands
    for (const commandId of this.skillCommandIds) {
      this.unregisterCommand(commandId);
    }
    this.skillCommandIds.clear();

    for (const skill of skills) {
      if (skill.userInvocable === false) {
        continue;
      }
      const commandId = skill.name;
      this.skillCommandIds.add(commandId);

      this.registerCommand({
        id: commandId,
        name: skill.name,
        description: `Skill: ${skill.description}`,
        handler: async (args?: string) => {
          try {
            const result = await this.skillManager.executeSkill({
              skill_name: skill.name,
              args,
            });

            // Add user message with skill content
            const originalInput = args
              ? `/${skill.name} ${args}`
              : `/${skill.name}`;
            this.messageManager.addUserMessage({
              content: originalInput,
              customCommandContent: result.content,
            });

            // Trigger AI response
            await this.aiManager.sendAIMessage({
              model: skill.model,
              allowedRules: result.allowedTools,
            });
          } catch (error) {
            logger?.error(
              `Failed to execute skill command '${skill.name}':`,
              error,
            );
            this.messageManager.addErrorBlock(
              `Failed to execute skill command '${skill.name}': ${
                error instanceof Error ? error.message : String(error)
              }`,
            );
          }
        },
      });
    }

    logger?.debug(`Registered ${skills.length} skill commands`);
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

          // Substitute $WAVE_PLUGIN_ROOT placeholder for plugin commands
          if (command.pluginPath) {
            processedContent = processedContent.replace(
              /\$WAVE_PLUGIN_ROOT/g,
              command.pluginPath,
            );
          }

          if (args) {
            if (hasParameterPlaceholders(processedContent)) {
              processedContent = substituteCommandParameters(
                processedContent,
                args,
              );
            } else {
              // If no placeholders, append arguments to the content
              processedContent = `${processedContent.trim()} ${args}`;
            }
          }

          await this.executeCustomCommandInMainAgent(
            namespacedName,
            processedContent,
            command.config,
            args,
          );
        },
      });
    }

    logger?.debug(
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
  ): Promise<void> {
    try {
      // Parse bash commands from the content
      const { commands, processedContent } = parseBashCommands(content);

      // Execute bash commands if any
      let finalContent = processedContent;
      if (commands.length > 0) {
        const bashResults = await executeBashCommands(commands, this.workdir);
        finalContent = replaceBashCommandsWithOutput(
          processedContent,
          bashResults,
        );
      }

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
      logger?.error(
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
