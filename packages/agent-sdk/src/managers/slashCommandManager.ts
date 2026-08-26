import type { MessageManager } from "./messageManager.js";
import type { AIManager } from "./aiManager.js";
import type { SlashCommand, CustomSlashCommand } from "../types/index.js";
import { loadCustomSlashCommands } from "../utils/customCommands.js";
import type { PlanManager } from "./planManager.js";
import type { PermissionManager } from "./permissionManager.js";
import type { ToolManager } from "./toolManager.js";
import type { PermissionMode } from "../types/permissions.js";
import {
  getExternalEditor,
  openInExternalEditor,
} from "../utils/externalEditor.js";
import fs from "node:fs/promises";

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
    this.loadCustomCommands();

    // Builtin /subtask: manual fork subagent (aligned with Claude Code's
    // /subtask — inherits the parent's full context, runs in the background,
    // result returns to the main conversation via a task notification).
    this.registerCommand({
      id: "subtask",
      name: "subtask",
      description:
        "Start a fork subagent with the current conversation context in the background",
      handler: async (args?: string, signal?: AbortSignal) => {
        const taskDescription = args?.trim();
        if (!taskDescription) {
          this.messageManager.addErrorBlock(
            "Usage: /subtask <task description>",
          );
          return;
        }

        try {
          // The fork snapshots its context synchronously on entry, so the
          // transcript echo below never duplicates the prompt inside the fork.
          await this.aiManager.runForkSubagent(
            taskDescription,
            { description: taskDescription },
            signal,
          );
          this.messageManager.addUserMessage({
            content: `/subtask ${taskDescription}`,
          });
        } catch (error) {
          this.aiManager.setIsLoading(false);
          logger?.error("Failed to execute /subtask:", error);
          this.messageManager.addErrorBlock(
            `Failed to execute /subtask: ${
              error instanceof Error ? error.message : String(error)
            }`,
          );
        }
      },
    });

    // Builtin /plan: enable plan mode / show the current plan (aligned with
    // Claude Code's /plan local command). The output lands on a user-message
    // tool block so it renders as a ⎿ stdout entry (CLI + GUI) and stays out
    // of the model context (user-message tool blocks are UI-only).
    this.registerCommand({
      id: "plan",
      name: "plan",
      description: "Enable plan mode or show the current plan",
      handler: async (args?: string) => {
        const planManager = this.container.get<PlanManager>("PlanManager");
        const toolManager = this.container.get<ToolManager>("ToolManager");
        const permissionManager =
          this.container.get<PermissionManager>("PermissionManager");
        const transition = this.container.get<(mode: PermissionMode) => void>(
          "PermissionModeTransition",
        );

        const description = args?.trim() ?? "";
        const wantsOpen = description.split(/\s+/)[0] === "open";

        // Surface /plan output as a user-message tool block: the entry renders
        // with the ⎿ stdout prefix + markdown, and its result is never sent to
        // the model API (aligned with CC's local-command-stdout filter).
        const addPlanOutput = (output: string) => {
          const messageId = this.messageManager.addUserMessage({
            content: `/plan${args ? ` ${args}` : ""}`,
          });
          const blockId = this.messageManager.addToolBlockToMessage(messageId, {
            name: "plan",
            parameters: "",
            stage: "running",
          });
          this.messageManager.updateToolBlock({
            id: blockId,
            messageId,
            result: output,
            stage: "end",
            success: true,
          });
        };

        // Not in plan mode yet: switch to plan mode and surface the entry
        // output. The plan file path must be generated before triggering a
        // query so the model always receives the plan file location
        // (plan-mode.md "路径生成必须先于查询触发").
        if (toolManager?.getPermissionMode() !== "plan") {
          transition?.("plan");
          const planPath = await planManager?.awaitPlanFilePath();
          const entry = planPath
            ? `Enabled plan mode\n\nPlan file: \`${planPath}\``
            : "Enabled plan mode";

          if (description && !wantsOpen) {
            addPlanOutput(entry);
            // The description drives the plan query: add it as a user message
            // so the model receives it, while the entry output stays out of
            // the model context (user-message tool blocks are UI-only).
            this.messageManager.addUserMessage({ content: description });
            await this.aiManager.sendAIMessage();
            return;
          }
          addPlanOutput(entry);
          return;
        }

        // Already in plan mode: show the current plan (aligned with Claude Code).
        const planPath = permissionManager?.getPlanFilePath();
        if (!planPath) {
          addPlanOutput("Already in plan mode. No plan written yet.");
          return;
        }

        // /plan open: open the plan file in the external editor.
        if (wantsOpen) {
          const result = await openInExternalEditor(planPath);
          addPlanOutput(
            result.ok
              ? `Opened plan in editor: ${planPath}`
              : `Failed to open plan in editor: ${result.error}`,
          );
          return;
        }

        let content = "";
        try {
          content = await fs.readFile(planPath, "utf8");
        } catch {
          content = "";
        }
        if (!content.trim()) {
          addPlanOutput("Already in plan mode. No plan written yet.");
          return;
        }
        const editor = getExternalEditor();
        addPlanOutput(
          `# Current Plan\n\n**${planPath}**\n\n${content}\n\n> \`/plan open\` to edit this plan in ${editor || "your editor"}`,
        );
      },
    });

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

  private get skillManager(): SkillManager {
    return this.container.get<SkillManager>("SkillManager")!;
  }

  private get subagentManager(): SubagentManager {
    return this.container.get<SubagentManager>("SubagentManager")!;
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

                  // Forked skill result is surfaced via the tool block only —
                  // the main agent is NOT triggered to continue (aligned with
                  // Claude Code's forked slash commands, which run to
                  // completion and return their output without a follow-up
                  // main-agent turn).
                  this.aiManager.setIsLoading(false);
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
   * Check if a slash command should bypass the message queue when AI is busy.
   * Returns true for commands marked as immediate (boolean or function).
   */
  public isImmediateCommand(input: string): boolean {
    const { command: commandId, args } = parseSlashCommandInput(input);
    const command = this.commands.get(commandId);
    if (!command?.immediate) return false;
    if (typeof command.immediate === "boolean") return command.immediate;
    return command.immediate(args);
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
