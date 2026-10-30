import type { MessageManager } from "./messageManager.js";
import type { AIManager } from "./aiManager.js";
import type {
  SlashCommand,
  CustomSlashCommand,
  CustomSlashCommandConfig,
  SkillSource,
} from "../types/index.js";
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
  prepareInjectedCommands,
} from "../utils/markdownParser.js";
import type { BashCommandResult } from "../utils/markdownParser.js";
import {
  findUnresolvedDirectoryPlaceholders,
  substituteDirectoryPlaceholders,
} from "../utils/directoryPlaceholders.js";
import { createBashCommandGate } from "../utils/bashCommandGate.js";
import type { PermissionManager } from "./permissionManager.js";
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
  /** Ids registered by plugins, so they can be dropped per-plugin and are not
   * mistaken for disk-sourced custom commands. */
  private pluginCommandIds = new Set<string>();
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
            const prepared = this.prepareCommand(command, args);
            await this.executeCustomCommandInMainAgent(
              command.name,
              prepared.content,
              prepared.config,
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

    const skillSourceFor = (skill: SkillMetadata): SkillSource => {
      if (skill.pluginName) return "plugin";
      if (skill.type === "personal") return "user";
      return skill.type; // "project" | "builtin"
    };

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
        // UI source tag: plugin skills carry pluginName; personal → 用户
        skillSource: skillSourceFor(skill),
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
      this.pluginCommandIds.add(namespacedId);

      // Generate description: prioritize custom description, otherwise use default description
      const description =
        command.description ||
        `Plugin command: ${namespacedName}${hasParameterPlaceholders(command.content) ? " (supports parameters)" : ""}`;

      this.registerCommand({
        id: namespacedId,
        name: namespacedName,
        description,
        handler: async (args?: string) => {
          const prepared = this.prepareCommand(command, args);
          await this.executeCustomCommandInMainAgent(
            namespacedName,
            prepared.content,
            prepared.config,
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
   * Drop every slash command contributed by a plugin, addressed by its plugin
   * name. Removes the registry entry and the customCommands source entry.
   * Called by the in-place plugin reload path before re-registering.
   * @returns the number of commands removed
   */
  public unregisterPluginCommands(pluginName: string): number {
    const prefix = `${pluginName}:`;
    let removed = 0;
    for (const commandId of Array.from(this.pluginCommandIds)) {
      if (!commandId.startsWith(prefix)) {
        continue;
      }
      this.pluginCommandIds.delete(commandId);
      this.customCommands.delete(commandId);
      this.unregisterCommand(commandId);
      removed += 1;
    }
    if (removed > 0) {
      logger?.debug(
        `Unregistered ${removed} commands from plugin '${pluginName}'`,
      );
    }
    return removed;
  }

  /**
   * Reload custom commands (useful for development)
   */
  public reloadCustomCommands(): void {
    // Reload only disk-sourced custom commands. Plugin commands live in the
    // same map but are owned by the plugin lifecycle, so re-reading the disk
    // must not drop them.
    for (const [commandId] of this.customCommands) {
      if (this.pluginCommandIds.has(commandId)) {
        continue;
      }
      this.unregisterCommand(commandId);
      this.customCommands.delete(commandId);
    }

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
   * Resolve one command invocation: parameter substitution first, then the
   * directory placeholders (spec `commands/slash-commands`「插件命令正文可用插件根
   * 占位符」).
   *
   * The body and the frontmatter's `allowed-tools` run through the same
   * resolver the skill side uses — a rule left holding a literal
   * `${WAVE_PLUGIN_ROOT}` never matches, and its author only ever sees a
   * confirmation prompt it cannot explain. Whatever cannot be resolved is
   * reported in the body rather than dropped silently.
   */
  private prepareCommand(
    command: CustomSlashCommand,
    args?: string,
  ): { content: string; config?: CustomSlashCommandConfig } {
    const withArgs = args
      ? substituteCommandParameters(command.content, args)
      : command.content;
    const context = { pluginRoot: command.pluginRoot };
    const content = substituteDirectoryPlaceholders(withArgs, context);

    const leftoverInBody = findUnresolvedDirectoryPlaceholders(content);
    const leftoverInRules: string[] = [];
    const droppedRules: string[] = [];
    const allowedTools: string[] = [];
    for (const rule of command.config?.allowedTools ?? []) {
      const resolved = substituteDirectoryPlaceholders(rule, context);
      const leftover = findUnresolvedDirectoryPlaceholders(resolved);
      if (leftover.length > 0) {
        droppedRules.push(rule);
        leftoverInRules.push(...leftover);
        continue;
      }
      allowedTools.push(resolved);
    }

    const config = command.config
      ? {
          ...command.config,
          allowedTools: allowedTools.length > 0 ? allowedTools : undefined,
        }
      : undefined;

    const leftover = [...new Set([...leftoverInBody, ...leftoverInRules])];
    if (leftover.length === 0) {
      return { content, config };
    }

    const where = [
      leftoverInBody.length > 0
        ? `the body keeps ${[...new Set(leftoverInBody)].join(", ")}`
        : "",
      droppedRules.length > 0
        ? `allowed-tools ${droppedRules.map((rule) => `"${rule}"`).join(", ")} not registered`
        : "",
    ].filter(Boolean);
    // Why a token has nowhere to point is a property of the token, not of the
    // command: a plugin command is still skill-dirless, and a loose command has
    // no plugin root either way.
    const why = [
      ...new Set(
        leftover.map((token) =>
          token.includes("PLUGIN")
            ? "the command does not come from a plugin, so there is no plugin root"
            : "a command has no skill directory of its own",
        ),
      ),
    ];

    return {
      content: `> **Command warning**: ${where.join("; ")} — left as written because ${why.join("; ")}, so nothing they point at will work\n\n${content}`,
      config,
    };
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
      const injected = prepareInjectedCommands(
        processedContent,
        commands,
        args ?? "",
      );
      const displayContent = injected.warning
        ? `> **Command warning**: ${injected.warning}\n\n${processedContent}`
        : processedContent;

      // Add user message immediately so text block shows before bash execution
      const messageId = this.messageManager.addUserMessage({
        content: `/${commandName}${args ? ` ${args}` : ""}`,
        customCommandContent: displayContent,
      });

      // Register the command's own `allowed-tools` BEFORE its injected commands
      // run, so a command that declares e.g. `Bash(gh pr view*)` authorizes its
      // own `!`gh pr view``.
      const permissionManager = this.container.has("PermissionManager")
        ? this.container.get<PermissionManager>("PermissionManager")
        : undefined;
      if (permissionManager && config?.allowedTools?.length) {
        permissionManager.addTemporaryRules(config.allowedTools);
      }

      // Execute bash commands and update the message if any exist
      if (commands.length > 0) {
        let bashResults: BashCommandResult[];
        try {
          bashResults = await executeBashCommands(
            injected.commands,
            this.workdir,
            undefined,
            createBashCommandGate(this.container),
          );
        } finally {
          // Deleted even when a command is denied or the invocation is aborted:
          // what this file holds is the user's own text.
          injected.cleanup();
        }
        const finalContent = replaceBashCommandsWithOutput(
          displayContent,
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
