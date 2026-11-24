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
} from "../utils/markdownParser.js";
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
import type { ModManager } from "./modManager.js";
import {
  createForkSubagentConfiguration,
  FORK_SUBTASK_MAX_TURNS,
} from "../builtin/forkSubagent.js";
import { FORK_SUBAGENT_TYPE } from "../constants/subagents.js";
import type { ModCommandInfo, ModCommandRunOutcome } from "../types/mods.js";
import { logger } from "../utils/globalLogger.js";

export interface SlashCommandManagerOptions {
  workdir: string;
}

export class SlashCommandManager {
  private commands = new Map<string, SlashCommand>();
  private customCommands = new Map<string, CustomSlashCommand>();
  private skillCommandIds = new Set<string>();
  /**
   * Command ids that exist only as an alias of a skill's own name.
   *
   * `/shorthand` resolves and runs exactly like `/skill-name` — same handler —
   * but stays out of `getCommands()`, because the `/` menu is one row per
   * command: Claude Code resolves an alias to the same command (`findCommand`
   * in `commands.ts` matches `name` / display name / `aliases`) instead of
   * adding a second row.
   */
  private skillAliasCommandIds = new Set<string>();
  /** Ids registered by plugins, so they can be dropped per-plugin and are not
   * mistaken for disk-sourced custom commands. */
  private pluginCommandIds = new Set<string>();
  /**
   * 命令名 → 注册它的插件，只记 `$.command.register` 建的那些（spec「注册命
   * 令」）。
   *
   * 与 `pluginCommandIds`（插件的 markdown 命令，带 `${plugin}:` 命名空间）分
   * 开：mod 命令用**裸名字**（`/standup` 而不是 `/myplugin:standup`），重名一律
   * 注册时就拒，所以这张表还兼作「谁占了这个名字」的答案。
   */
  private modCommandPlugins = new Map<string, string>();
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
    // Registered after the disk-sourced commands: a shipped command of the SDK
    // is not something a file that happens to use the same name should shadow.
    this.registerSubtaskCommand();

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
   * `/subtask <task>` — send this conversation off to a background fork.
   *
   * Registered in the SDK's own command table rather than in a host's local
   * one because it needs no host UI: it starts a subagent and the result comes
   * back as a task notification in this same conversation, so one registration
   * serves every front end (spec `multi-agent/subtask-command.md`「四个入口看到
   * 的是同一条命令」).
   */
  private registerSubtaskCommand(): void {
    this.registerCommand({
      id: "subtask",
      name: "subtask",
      // Claude Code's own wording, verbatim.
      description:
        "Send a subagent off with your full context; its result comes back here",
      argumentHint: "<task>",
      handler: (args?: string) => this.runSubtask(args),
    });
  }

  /**
   * Start the fork and return immediately: the parent conversation never takes
   * a loading state, so the input stays usable while the subtask runs.
   *
   * The fork works on its own copy of the conversation
   * (`SubagentManager.createInstance` → `inheritParentContext`), which is what
   * keeps the two apart — this conversation only ever gains the completion's
   * task notification.
   */
  private async runSubtask(args?: string): Promise<void> {
    const task = args?.trim();
    if (!task) {
      this.messageManager.addNoticeBlock("Usage: /subtask <task>", "error");
      return;
    }

    // A fork starts from a copy of this conversation, so there must be one.
    // Narration does not count: these very refusals add notice blocks, and an
    // empty session must not become forkable through a failed first attempt.
    const hasConversation = this.messageManager
      .getMessages()
      .some(
        (message) =>
          message.isMeta !== true &&
          message.blocks.some((block) => block.type !== "notice"),
      );
    if (!hasConversation) {
      this.messageManager.addNoticeBlock(
        "Cannot start a subtask before the first conversation turn",
        "error",
      );
      return;
    }

    try {
      const subagentManager =
        this.container.get<SubagentManager>("SubagentManager");
      if (!subagentManager) {
        throw new Error("Subagent manager not available");
      }

      const instance = await subagentManager.createInstance(
        createForkSubagentConfiguration(),
        {
          description: subtaskDescription(task),
          prompt: task,
          subagent_type: FORK_SUBAGENT_TYPE,
          inheritParentContext: true,
          maxTurns: FORK_SUBTASK_MAX_TURNS,
        },
        true,
      );

      // run-in-background: `executeAgent` returns as soon as the background
      // task is registered, and the completion (or failure) reaches this
      // conversation through the parent's message queue.
      await subagentManager.executeAgent(instance, task, undefined, true);

      // Leave a receipt behind. A subtask has no parent turn, so nothing else
      // marks it: without this the conversation looks like the user typed
      // nothing, and the only way to find out is opening the background-task
      // panel. Two carriers for two readers — the notice is what the user
      // sees (`convertMessagesForAPI` never reads notices), the `isMeta` user
      // message is what tells the model a task is running, since otherwise its
      // next turn reads as if the user had said nothing at all.
      const title = subtaskDescription(task);
      this.messageManager.addNoticeBlock(
        `\u2442 forked ${title} (${instance.subagentId.slice(-4)})`,
        "info",
      );
      this.messageManager.addUserMessage({
        content:
          `子任务已派到后台（不是用户说的话，也不是错误）：用户起了后台子任务「${title}」，` +
          "它带着这段对话的完整上下文在跑，结果会以后台任务通知的形式回到这里。" +
          "不用等它，也不要重复做这件事。",
        isMeta: true,
      });
    } catch (error) {
      this.messageManager.addNoticeBlock(
        `Failed to start the subtask: ${error instanceof Error ? error.message : String(error)}`,
        "error",
      );
    }
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
          ...(command.config?.argumentHint
            ? { argumentHint: command.config.argumentHint }
            : {}),
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
    this.skillAliasCommandIds.clear();

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
        ...(skill.argumentHint ? { argumentHint: skill.argumentHint } : {}),
        handler: async (args?: string, signal?: AbortSignal) => {
          try {
            // 1. Prepare skill content immediately
            const prepared = await this.skillManager.prepareSkill({
              skill_name: skill.name,
              args,
            });

            if (!prepared.skill) {
              // If skill not found or invalid, add error
              this.messageManager.addNoticeBlock(prepared.content, "error");
              return;
            }

            if (skill.context === "fork") {
              // `skill.prompt`（spec ecosystem/plugin-mods.md「给工具、技能、命令
              // 写描述」）：fork 技能没有 `!`cmd`` 展开这一步，正文在这里定型，
              // 所以问在这里 —— 之后的三处（消息正文、工具块参数、子代理
              // prompt）用的都是这一份。
              const forkContent = await this.skillManager.applySkillPrompt(
                prepared.skill,
                prepared.content,
              );
              // Forked skill execution: add user message with text + tool block
              const messageId = this.messageManager.addUserMessage({
                content: `/${skill.name}${args ? ` ${args}` : ""}`,
                customCommandContent: forkContent,
              });

              const toolBlockId = this.messageManager.addToolBlockToMessage(
                messageId,
                {
                  name: skill.name,
                  parameters: forkContent,
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
                    prompt: forkContent,
                    subagent_type: subagentType,
                    model: skill.model,
                    // A `context: fork` skill's `disallowed-tools` travel into
                    // the subagent that runs it: the ban belongs to the skill,
                    // not to the conversation it was started from, and Claude
                    // Code applies it on the fork path too (`iun` in the
                    // 2.1.325 bundle layers `alwaysDenyRules` in the same way
                    // as the inline path).
                    ...(skill.disallowedTools?.length
                      ? { disallowedTools: skill.disallowedTools }
                      : {}),
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
                    forkContent,
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
            this.messageManager.addNoticeBlock(
              `Failed to execute skill command '${skill.name}': ${
                error instanceof Error ? error.message : String(error)
              }`,
              "error",
            );
          }
        },
      });
    }

    // Aliases (frontmatter `aliases`) answer to `/…` exactly like the skill's
    // own name — same handler, same source tag, same argument hint — so they
    // are registered as ordinary commands and resolve everywhere a name does
    // (`hasCommand`, `executeCommand`, the submitted `/alias args`).
    //
    // Two rules, both taken from Claude Code's command table:
    //
    // 1. A name that is already taken wins. CC drops an alias that collides
    //    with a built-in / shipped command name (`T5r` in the 2.1.325 bundle
    //    builds that reserved set from every builtin and its aliases), and our
    //    `/` namespace is one flat space: builtin, custom, plugin and mod
    //    commands plus every skill. Silently taking a name away from something
    //    the user already has would be worse than not having the alias.
    // 2. The alias of a skill whose name was not registered (not
    //    user-invocable) does not exist either — CC keeps `userInvocable` on the
    //    skill, so aliases never make a hidden skill reachable.
    //
    // This runs as a second pass, after every skill's own name is registered,
    // so an alias can never take the name of a skill that comes later in the
    // list.
    for (const skill of skills) {
      if (skill.userInvocable === false || !skill.aliases?.length) {
        continue;
      }
      const command = this.commands.get(skill.name);
      if (!command) continue;

      for (const alias of skill.aliases) {
        if (alias === skill.name || this.skillAliasCommandIds.has(alias)) {
          continue;
        }
        if (this.commands.has(alias)) {
          logger?.debug(
            `Skill alias '${alias}' of '${skill.name}' ignored: /${alias} is already taken`,
          );
          continue;
        }
        this.skillAliasCommandIds.add(alias);
        // The alias id joins the skill-command set, so the next refresh (or a
        // plugin reload / config change that re-registers skills) drops it with
        // its primary command instead of leaking a stale `/alias`.
        this.skillCommandIds.add(alias);
        this.registerCommand({ ...command, id: alias, name: alias });
      }
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
        ...(command.config?.argumentHint
          ? { argumentHint: command.config.argumentHint }
          : {}),
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
   * 登记 mod 注册的命令（spec「注册命令」）。
   *
   * 与插件 markdown 命令的区别：**裸名字、重名即拒**。名字被占了就返回原因，
   * 由 `$.command.register` 抛给插件作者看 —— 静默覆盖会让两个插件抢同一个
   * `/standup`，而用户看不出命令换了主人。
   */
  public registerModCommand(input: {
    name: string;
    description: string;
    argumentHint?: string;
    immediate?: boolean;
    plugin: string;
    run: (args: string) => Promise<ModCommandRunOutcome | undefined>;
  }): { ok: true } | { ok: false; reason: string } {
    const name = input.name;
    const owner = this.modCommandPlugins.get(name);
    if (owner !== undefined) {
      return {
        ok: false,
        reason:
          owner === input.plugin
            ? `/${name} 已经由本插件的另一个 mod 注册过`
            : `refused: 插件 ${owner} 已经注册了 /${name}`,
      };
    }
    if (this.commands.has(name)) {
      return {
        ok: false,
        reason: `refused: 名字 /${name} 已经被占用（内置命令 / 技能 / 自定义命令 / 插件命令中的一个）`,
      };
    }
    this.modCommandPlugins.set(name, input.plugin);
    this.registerCommand({
      id: name,
      name,
      description: input.description,
      ...(input.argumentHint === undefined
        ? {}
        : { argumentHint: input.argumentHint }),
      immediate: input.immediate ?? false,
      handler: async (args?: string) => {
        // 注册只给菜单元数据，逻辑在 command.run 钩子里（与 CC 同形状）。
        const outcome = await input.run(args ?? "");
        if (outcome === undefined) {
          this.messageManager.addNoticeBlock(
            `/${name} 已注册，但没有任何 command.run 钩子回答它：在插件里补 on("command.run", { command: "/${name}" }, ($, e) => ({ text: ... }))`,
            "error",
          );
          return;
        }
        // `{}`：这次命令只是插件自己的动作（开关面板之类），不进对话、不发消息。
        if (outcome.text === undefined) return;
        await this.executeCustomCommandInMainAgent(
          name,
          outcome.text,
          undefined,
          args,
        );
      },
    });
    return { ok: true };
  }

  /** 撤销一条 mod 命令（插件重载 / 会话销毁）。 */
  public unregisterModCommand(name: string): void {
    if (!this.modCommandPlugins.delete(name)) return;
    this.unregisterCommand(name);
  }

  /** 当前可见的命令，按来源标注（供 `$.command.list()`）。 */
  public listCommandsForMods(): ModCommandInfo[] {
    const rows: ModCommandInfo[] = [];
    for (const command of this.commands.values()) {
      // Aliases are not rows of their own — the same reasoning as `getCommands`.
      if (this.skillAliasCommandIds.has(command.id)) continue;
      const modPlugin = this.modCommandPlugins.get(command.name);
      if (modPlugin !== undefined) {
        rows.push({
          name: command.name,
          description: command.description,
          source: "plugin",
          plugin: modPlugin,
        });
        continue;
      }
      const source: ModCommandInfo["source"] =
        command.skillSource ??
        (this.pluginCommandIds.has(command.id) ? "plugin" : "user");
      rows.push({
        name: command.name,
        description: command.description,
        source,
      });
    }
    return rows;
  }

  /** 命令是否由 mod 注册（`$.command.run` 的前置检查用）。 */
  public isModCommand(name: string): boolean {
    return this.modCommandPlugins.has(name);
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
   * 一个命令要画进列表时的那一行：`command.describe` 覆盖过的字段用插件的，
   * 其余用宿主自己的。
   *
   * **每次画列表都问一次，而且等答案回来再画** —— CC 同一条：插件给的描述当次
   * 就生效，不是下一次。不缓存：命令表是插件随时会换的东西，缓存会让「换了实现
   * 的命令」继续显示旧描述。各命令之间是并行的，每个 mod 各自受钩子超时约束。
   */
  private async describeCommand(
    command: SlashCommand,
  ): Promise<{ command: SlashCommand; isHidden?: boolean }> {
    const modManager = this.container.has("ModManager")
      ? this.container.get<ModManager>("ModManager")
      : undefined;
    if (
      !modManager ||
      typeof modManager.collectCommandDescribe !== "function"
    ) {
      return { command };
    }
    try {
      const described = await modManager.collectCommandDescribe(command.name);
      return {
        command: {
          ...command,
          ...(described.description === undefined
            ? {}
            : { description: described.description }),
          ...(described.argumentHint === undefined
            ? {}
            : { argumentHint: described.argumentHint }),
        },
        isHidden: described.isHidden,
      };
    } catch (error) {
      // 问不出来就用宿主自己的那一行：画列表不能因为插件挂了而空掉。
      logger?.warn("command.describe failed", {
        command: command.name,
        error,
      });
      return { command };
    }
  }

  /**
   * Get all available commands
   *
   * This is the list every front end draws (the popup, the CLI's completion), so
   * it is also where `command.describe` lands: descriptions and argument hints
   * are overridden, and a command a mod marked `isHidden` is left out of **this**
   * list only — `hasCommand` / `executeCommand` still find it, because hiding
   * changes what the list shows, not what can be run.
   */
  public async getCommands(): Promise<SlashCommand[]> {
    const described = await Promise.all(
      Array.from(this.commands.values())
        // One row per command: a skill's aliases resolve to the same skill, so
        // listing them would show the same skill twice under two names (CC's
        // suggestion list is keyed by command for the same reason).
        .filter((command) => !this.skillAliasCommandIds.has(command.id))
        .map((command) => this.describeCommand(command)),
    );
    return described.flatMap(({ command, isHidden }) =>
      isHidden === true ? [] : [command],
    );
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

      // Add user message immediately so text block shows before bash execution
      const messageId = this.messageManager.addUserMessage({
        content: `/${commandName}${args ? ` ${args}` : ""}`,
        customCommandContent: processedContent,
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
        const bashResults = await executeBashCommands(
          commands,
          this.workdir,
          undefined,
          createBashCommandGate(this.container),
        );
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
      this.messageManager.addNoticeBlock(
        `Failed to execute custom command '${commandName}': ${
          error instanceof Error ? error.message : String(error)
        }`,
        "error",
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

/**
 * Background-task title for a `/subtask`: its first line, shortened. The task
 * list and the completion notification quote it as `Agent task "<desc>"`.
 */
function subtaskDescription(task: string): string {
  const firstLine = task.split("\n")[0].trim();
  return firstLine.length > 60 ? `${firstLine.slice(0, 60)}…` : firstLine;
}
