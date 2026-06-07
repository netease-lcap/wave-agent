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
import type { MemoryService } from "../services/memory.js";
import type { HookManager } from "./hookManager.js";
import type { GoalManager } from "./goalManager.js";

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

  private get memoryService(): MemoryService {
    return this.container.get<MemoryService>("MemoryService")!;
  }

  private get hookManager(): HookManager | undefined {
    return this.container.get<HookManager>("HookManager");
  }

  private get goalManager(): GoalManager | undefined {
    return this.container.get<GoalManager>("GoalManager");
  }

  private initializeBuiltinCommands(): void {
    // Register built-in clear command
    this.registerCommand({
      id: "clear",
      name: "clear",
      description: "Clear conversation history and reset session",
      handler: async () => {
        this.aiManager.abortAIMessage();

        // Clear any active goal
        this.goalManager?.clearGoal();

        // Capture old session info before clearing
        const oldSessionId = this.messageManager.getSessionId();
        const transcriptPath = this.messageManager.getTranscriptPath();

        // Run SessionEnd hooks (cleanup before clear)
        if (this.hookManager) {
          try {
            await this.hookManager.executeSessionEndHooks(
              "clear",
              oldSessionId,
              transcriptPath,
            );
          } catch (error) {
            logger?.warn(
              `SessionEnd hooks on clear failed: ${(error as Error).message}`,
            );
          }
        }

        // Clear messages and generate new session
        this.messageManager.clearMessages();
        this.memoryService.clearCache();
        await this.taskManager.syncWithSession();

        // Run SessionStart hooks (restore context for new session)
        if (this.hookManager) {
          try {
            const newSessionId = this.messageManager.getSessionId();
            const sessionStartResult =
              await this.hookManager.executeSessionStartHooks(
                "clear",
                newSessionId,
                this.messageManager.getTranscriptPath(),
              );

            // Inject additionalContext as a meta user message
            if (sessionStartResult.additionalContext) {
              this.messageManager.addUserMessage({
                content: `<system-reminder>\nSessionStart hook additional context: ${sessionStartResult.additionalContext}\n</system-reminder>`,
                isMeta: true,
              });
            }

            // Inject initialUserMessage as a meta user message
            if (sessionStartResult.initialUserMessage) {
              this.messageManager.addUserMessage({
                content: sessionStartResult.initialUserMessage,
                isMeta: true,
              });
            }
          } catch (error) {
            logger?.warn(
              `SessionStart hooks on clear failed: ${(error as Error).message}`,
            );
          }
        }
      },
    });

    // Register built-in compact command
    this.registerCommand({
      id: "compact",
      name: "compact",
      description: "Compact conversation history to reduce context usage",
      handler: async (args?: string, signal?: AbortSignal) => {
        this.aiManager.abortAIMessage();

        const customInstructions = args?.trim() || undefined;

        await this.aiManager.compactConversation({
          customInstructions,
          abortSignal: signal,
        });
      },
    });

    // Register built-in goal command
    this.registerCommand({
      id: "goal",
      name: "goal",
      description: "Set, check, or clear an autonomous goal for the session",
      handler: async (args?: string) => {
        const goalManager = this.goalManager;
        if (!goalManager) {
          this.messageManager.addUserMessage({
            content: "Goal manager is not available",
            isMeta: true,
          });
          return;
        }

        const trimmed = args?.trim() ?? "";

        // Clear aliases
        if (
          ["clear", "stop", "off", "reset", "none", "cancel"].includes(trimmed)
        ) {
          if (goalManager.isGoalActive()) {
            goalManager.clearGoal();
            this.messageManager.addUserMessage({
              content: "<system-reminder>Goal cleared.</system-reminder>",
              isMeta: true,
            });
          } else {
            this.messageManager.addUserMessage({
              content:
                "<system-reminder>No active goal to clear.</system-reminder>",
              isMeta: true,
            });
          }
          return;
        }

        // Show status
        if (!trimmed) {
          if (goalManager.isGoalActive()) {
            this.messageManager.addUserMessage({
              content: `<system-reminder>${goalManager.getStatusString()}</system-reminder>`,
              isMeta: true,
            });
          } else {
            this.messageManager.addUserMessage({
              content:
                "<system-reminder>No active goal. Use /goal <condition> to set one.</system-reminder>",
              isMeta: true,
            });
          }
          return;
        }

        // Check plan mode
        const permissionMode = this.container.has("PermissionMode")
          ? this.container.get<
              import("../types/permissions.js").PermissionMode
            >("PermissionMode")
          : undefined;
        if (permissionMode === "plan") {
          this.messageManager.addUserMessage({
            content:
              "<system-reminder>Cannot set a goal in plan mode. Exit plan mode first.</system-reminder>",
            isMeta: true,
          });
          return;
        }

        // Set goal
        try {
          goalManager.setGoal(trimmed);
          this.messageManager.addUserMessage({
            content: `<system-reminder>Goal set: ${trimmed}. The agent will work autonomously until this goal is achieved.</system-reminder>`,
            isMeta: true,
          });
          // Add the goal as a user directive to start working
          this.messageManager.addUserMessage({
            content: trimmed,
          });
          this.aiManager.sendAIMessage();
        } catch (error) {
          this.messageManager.addUserMessage({
            content: `<system-reminder>Failed to set goal: ${(error as Error).message}</system-reminder>`,
            isMeta: true,
          });
        }
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
                      const usedTools = subagent.usedTools;

                      const toolCount = countToolBlocks(messages);
                      const summary = formatToolTokenSummary(toolCount, tokens);

                      const getDisplayParam = (t: {
                        name: string;
                        parameters: string;
                        compactParams?: string;
                        stage?: string;
                      }) => {
                        if (
                          (t.stage === "end" || t.stage === "running") &&
                          t.compactParams
                        ) {
                          return t.compactParams;
                        }
                        const flat = t.parameters.replace(/\n/g, "\\n");
                        return flat.length > 30 ? `…${flat.slice(-30)}` : flat;
                      };

                      let shortResult = "";
                      if (toolCount > 2) {
                        shortResult += "... ";
                      }
                      shortResult += summary;
                      if (usedTools.length > 0) {
                        shortResult +=
                          "\n" +
                          usedTools
                            .map((t) => `${t.name} ${getDisplayParam(t)}`)
                            .join("\n");
                      }

                      this.messageManager.updateToolBlock({
                        id: toolBlockId,
                        messageId,
                        shortResult,
                      });
                    }
                  },
                );

                // Show loading while subagent runs
                this.aiManager.setIsLoading(true);
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
                    success: true,
                  });

                  // Trigger AI to process the tool result
                  await this.aiManager.sendAIMessage();
                } finally {
                  this.subagentManager.cleanupInstance(instance.subagentId);
                }
              } catch (error) {
                // Update the ToolBlock with error
                this.messageManager.updateToolBlock({
                  id: toolBlockId,
                  messageId,
                  stage: "end",
                  success: false,
                  error: error instanceof Error ? error.message : String(error),
                });
                throw error; // Re-throw to be caught by outer catch for logging/error block
              }
              return;
            }

            // Non-forked skill: execute and trigger AI response
            this.aiManager.setIsLoading(true);
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
            this.aiManager.setIsLoading(false);

            logger?.error(error);
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
    args?: string,
  ): Promise<void> {
    try {
      // Set loading early so UI shows feedback during bash execution
      this.aiManager.setIsLoading(true);

      // Parse bash commands from the content
      const { commands, processedContent } = parseBashCommands(content);

      // Add user message immediately so text block shows before bash execution
      const messageId = this.messageManager.addUserMessage({
        content: `/${commandName}${args ? ` ${args}` : ""}`,
        customCommandContent: processedContent,
      });

      // Execute bash commands and update the message if any exist
      if (commands.length > 0) {
        const bashResults = await executeBashCommands(commands, this.workdir);
        const finalContent = replaceBashCommandsWithOutput(
          processedContent,
          bashResults,
        );

        // Update the user message with the bash-processed content
        this.messageManager.updateUserMessage(messageId, {
          customCommandContent: finalContent,
        });
      }

      // Execute the AI conversation with custom configuration
      await this.aiManager.sendAIMessage({
        model: config?.model,
        allowedRules: config?.allowedTools,
      });
    } catch (error) {
      this.aiManager.setIsLoading(false);

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
