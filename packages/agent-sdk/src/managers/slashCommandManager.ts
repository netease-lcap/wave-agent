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
import {
  countToolBlocks,
  formatToolTokenSummary,
} from "../utils/messageOperations.js";
import type { SkillManager } from "./skillManager.js";
import type { SkillMetadata } from "../types/skills.js";
import type { SubagentManager } from "./subagentManager.js";

import { logger } from "../utils/globalLogger.js";

export interface SlashCommandManagerOptions {
  workdir: string;
}

export class SlashCommandManager {
  private commands = new Map<string, SlashCommand>();
  private customCommands = new Map<string, CustomSlashCommand>();
  private skillCommandIds = new Set<string>();
  private workdir: string;
  private currentCommandAbortController: AbortController | null = null;

  constructor(
    private container: Container,
    options: SlashCommandManagerOptions,
  ) {
    this.workdir = options.workdir;
  }

  public initialize(): void {
    this.initializeBuiltinCommands();
    this.loadCustomCommands();

    // Listen for skill refreshes and update skill commands
    const skillManager = this.container.get<SkillManager>("SkillManager");
    if (skillManager) {
      skillManager.on("refreshed", (skills: SkillMetadata[]) => {
        this.registerSkillCommands(skills);
      });
    }
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

  private get subagentManager(): SubagentManager {
    return this.container.get<SubagentManager>("SubagentManager")!;
  }

  private initializeBuiltinCommands(): void {
    // Register built-in clear command
    this.registerCommand({
      id: "clear",
      name: "clear",
      description: "Clear conversation history and reset session",
      handler: async () => {
        this.aiManager.abortAIMessage();
        this.messageManager.clearMessages();
        await this.taskManager.syncWithSession();
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
              processedContent = substituteCommandParameters(
                processedContent,
                args,
              );
            }

            await this.executeCustomCommandInMainAgent(
              command.name,
              processedContent,
              command.config,
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
        handler: async (args?: string, signal?: AbortSignal) => {
          try {
            // 1. Prepare skill content immediately
            const prepared = await this.skillManager.prepareSkill({
              skill_name: skill.name,
              args,
            });

            if (!prepared.skill) {
              // If skill not found or invalid, add error
              this.messageManager.addErrorBlock(prepared.content);
              return;
            }

            if (skill.context === "fork") {
              // Forked skill execution: add user message with text + tool block
              const messageId = this.messageManager.addUserMessage({
                content: `/${skill.name}${args ? ` ${args}` : ""}`,
                customCommandContent: prepared.content,
              });

              const toolBlockId = this.messageManager.addToolBlockToMessage(
                messageId,
                {
                  name: skill.name,
                  parameters: prepared.content,
                  stage: "running",
                },
              );

              // Forked skill execution
              const subagentConfigs =
                await this.subagentManager.loadConfigurations();
              const subagentType = skill.agent || "general-purpose";
              const config = subagentConfigs.find(
                (c) => c.name === subagentType,
              );
              if (!config) {
                throw new Error(
                  `Subagent configuration for ${subagentType} not found`,
                );
              }

              try {
                const instance = await this.subagentManager.createInstance(
                  config,
                  {
                    description: skill.description,
                    prompt: prepared.content,
                    subagent_type: subagentType,
                    model: skill.model,
                  },
                  false,
                  () => {
                    // Update the tool block with progress
                    const subagent = this.subagentManager.getInstance(
                      instance.subagentId,
                    );
                    if (subagent) {
                      const messages = subagent.messages;
                      const tokens =
                        subagent.messageManager.getLatestTotalTokens();
                      const lastTools = subagent.lastTools;

                      const toolCount = countToolBlocks(messages);
                      const summary = formatToolTokenSummary(toolCount, tokens);

                      let shortResult = "";
                      if (toolCount > 2) {
                        shortResult += "... ";
                      }
                      if (lastTools.length > 0) {
                        shortResult += `${lastTools.join(", ")} `;
                      }

                      shortResult += summary;

                      this.messageManager.updateToolBlock({
                        id: toolBlockId,
                        messageId,
                        shortResult,
                      });
                    }
                  },
                );

                try {
                  const result = await this.subagentManager.executeAgent(
                    instance,
                    prepared.content,
                    signal,
                  );

                  // Update the ToolBlock with final result
                  this.messageManager.updateToolBlock({
                    id: toolBlockId,
                    messageId,
                    result,
                    stage: "end",
                  });
                } finally {
                  this.subagentManager.cleanupInstance(instance.subagentId);
                }
              } catch (error) {
                // Update the ToolBlock with error
                this.messageManager.updateToolBlock({
                  id: toolBlockId,
                  messageId,
                  stage: "end",
                  error: error instanceof Error ? error.message : String(error),
                });
                throw error; // Re-throw to be caught by outer catch for logging/error block
              }
              return;
            }

            // Non-forked skill: execute and trigger AI response
            const result = await this.skillManager.executeSkill({
              skill_name: skill.name,
              args,
            });

            // Add user message with the processed content
            this.messageManager.addUserMessage({
              content: `/${skill.name}${args ? ` ${args}` : ""}`,
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

      this.registerCommand({
        id: namespacedId,
        name: namespacedName,
        description,
        handler: async (args?: string) => {
          // Substitute parameters in the command content
          let processedContent = command.content;

          if (args) {
            processedContent = substituteCommandParameters(
              processedContent,
              args,
            );
          }

          await this.executeCustomCommandInMainAgent(
            namespacedName,
            processedContent,
            command.config,
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

    // Abort any previous command if it's still running
    this.currentCommandAbortController?.abort();
    this.currentCommandAbortController = new AbortController();

    try {
      await command.handler(args, this.currentCommandAbortController.signal);
      return true;
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        logger?.debug(`Slash command ${commandId} was aborted`);
      } else {
        console.error(`Failed to execute slash command ${commandId}:`, error);
      }
      return false;
    } finally {
      this.currentCommandAbortController = null;
      // FR-013: Ensure slash commands are persisted to the session file
      await this.messageManager.saveSession();
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

      // Add user message with command name as display content, processed content for AI
      this.messageManager.addUserMessage({
        content: `/${commandName}`,
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

    // Abort the current slash command handler
    this.currentCommandAbortController?.abort();
    this.currentCommandAbortController = null;
  }
}
