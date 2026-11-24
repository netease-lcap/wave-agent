import { ForegroundTaskManager } from "./managers/foregroundTaskManager.js";
import { MessageManager } from "./managers/messageManager.js";
import { AIManager } from "./managers/aiManager.js";
import { ToolManager } from "./managers/toolManager.js";
import { SubagentManager } from "./managers/subagentManager.js";
import { McpManager } from "./managers/mcpManager.js";
import { LspManager } from "./managers/lspManager.js";
import { BashModeManager } from "./managers/bashModeManager.js";
import { CronManager } from "./managers/cronManager.js";
import { BackgroundTaskManager } from "./managers/backgroundTaskManager.js";
import { ShellProcessReaper } from "./managers/shellProcessReaper.js";
import { MessageQueue, type QueuedMessage } from "./managers/messageQueue.js";
import { SlashCommandManager } from "./managers/slashCommandManager.js";
import { PluginManager } from "./managers/pluginManager.js";
import { ModManager } from "./managers/modManager.js";
import { wrapInSystemReminder } from "./prompts/planModeReminders.js";
import type {
  ModBandRenderResult,
  ModPanelEventPayload,
  ModPanelEventResult,
  ModPromptEditEvent,
  ModPromptOrigin,
  ModPromptSuggestEvent,
  ModPanelRenderResult,
  ModPaneLayout,
  ModPaneViewPayload,
  ModPanelUpdatePayload,
  ModPromptFillMode,
  ModRenderSurface,
  ModStatusPayload,
  ModSessionUsage,
  ModUiCopyResult,
  ModSurfaceMetrics,
} from "./types/mods.js";
import { MOD_LIMITS } from "./types/mods.js";
import { HookManager } from "./managers/hookManager.js";
import { ReversionManager } from "./managers/reversionManager.js";
import { PermissionManager } from "./managers/permissionManager.js";
import { PlanManager } from "./managers/planManager.js";
import {
  SlashCommand,
  CustomSlashCommand,
  ILspManager,
  AgentOptions,
  ConfiguredModel,
} from "./types/index.js";
import type {
  Message,
  Logger,
  McpServerStatus,
  GatewayConfig,
  ModelConfig,
  Usage,
  PermissionMode,
  ForegroundTask,
  SkillMetadata,
  PluginReloadResult,
  UserImage,
} from "./types/index.js";
import type { PermissionCallback } from "./types/permissions.js";
import { ASK_USER_QUESTION_TOOL_NAME } from "./constants/tools.js";
import type { HookEvent, HookEventConfig } from "./types/hooks.js";
import type { ContextBreakdown } from "./types/contextBreakdown.js";
import type { BtwHistoryTurn } from "./types/btw.js";
import type {
  MessageWindow,
  MessageWindowResult,
} from "./types/messageWindow.js";
import type { TranscriptOutlineEntry } from "./types/transcriptOutline.js";
import type { TranscriptExport } from "./services/transcriptExport.js";
import type { Task } from "./types/tasks.js";
import type { BackgroundTask } from "./types/processes.js";
import { MemoryRuleManager } from "./managers/MemoryRuleManager.js";
import { LiveConfigManager } from "./managers/liveConfigManager.js";
import { configValidator } from "./utils/configValidator.js";
import { rateLimitWindowsFromQuotaHeaders } from "./utils/quotaHeaders.js";
import { SkillManager } from "./managers/skillManager.js";
import { TaskManager } from "./services/taskManager.js";
import {
  SessionConsumers,
  isSessionConsumerKind,
} from "./services/sessionConsumers.js";
import type { SessionConsumerKind } from "./services/sessionConsumers.js";
import type { WorktreeSession } from "./utils/worktreeSession.js";
import type { RewindCheckpoint } from "./utils/rewindCheckpoints.js";
import path from "node:path";
import { InitializationService } from "./services/initializationService.js";
import { getCompletion, getNextEdit } from "./services/aiService.js";
import type {
  CompletionSnippet,
  NextEditExcerpt,
  NextEditHistoryEntry,
  NextEditRegion,
  NextEditSuggestion,
} from "./types/completion.js";
import {
  InteractionService,
  type InteractionContext,
} from "./services/interactionService.js";
import { ConfigurationService } from "./services/configurationService.js";
import { setSessionCustomTitle } from "./services/session.js";
import { Container } from "./utils/container.js";
import { setupAgentContainer } from "./utils/containerSetup.js";
import {
  initializeTelemetry,
  flushTelemetry,
} from "./telemetry/instrumentation.js";
import { logOTelEvent } from "./telemetry/events.js";
import {
  recordCompletionOutcome,
  recordNextEditOutcome,
  recordSession,
} from "./telemetry/metrics.js";
import type { RecordContext } from "./telemetry/metrics.js";
import { languageFromPath } from "./telemetry/language.js";
import {
  flushSessionActivity,
  recordUserActivity,
} from "./telemetry/activity.js";
import { entrypointOf } from "./telemetry/attributes.js";
import { remoteSettingsService } from "./services/remoteSettingsService.js";
import { AUTO_MEMORY_DRAIN_TIMEOUT_MS } from "./services/autoMemoryService.js";
import { contextUsagePercent } from "./utils/tokenCalculation.js";

/**
 * 一份指令文件属于哪一档记忆（`classic.InstructionsLoaded` 的 `memory_type`）。
 *
 * 判据只有两条，按顺序：文件名认 `local` 两档（`AGENTS.local.md` /
 * `CLAUDE.local.md`，都是「私有于本用户、但属于本仓库」），其余看位置 ——
 * 会话工作目录里的是项目档，之外的（`~/.wave/AGENTS.md` 与它的
 * `~/.claude/AGENTS.md` 回退）是用户档。`Managed` 给不出：我们没有企业托管层。
 *
 * 用 `path.relative` 而不是前缀比较：`/a/bc` 不该被判成 `/a/b` 里面。
 */
function classifyMemoryTier(
  filePath: string,
  workdir: string,
): "Project" | "Local" | "User" {
  const name = path.basename(filePath);
  if (name === "AGENTS.local.md" || name === "CLAUDE.local.md") return "Local";
  const relative = path.relative(workdir, filePath);
  const insideWorkdir =
    relative.length > 0 &&
    !relative.startsWith("..") &&
    !path.isAbsolute(relative);
  return insideWorkdir ? "Project" : "User";
}

/** 把钩子交回来的偏移夹进草稿里（负数、`NaN`、越界都落回给的默认值）。 */
function clampOffset(value: unknown, fallback: number, length: number): number {
  const raw =
    typeof value === "number" && Number.isFinite(value) ? value : fallback;
  return Math.min(Math.max(0, Math.trunc(raw)), length);
}

export class Agent {
  private messageManager: MessageManager;
  private aiManager: AIManager;

  private bashModeManager: BashModeManager | null = null;
  private backgroundTaskManager: BackgroundTaskManager;
  private shellProcessReaper: ShellProcessReaper;
  private logger?: Logger; // Add optional logger property
  private toolManager: ToolManager; // Add tool registry instance
  private mcpManager: McpManager; // Add MCP manager instance
  private lspManager: ILspManager; // Add LSP manager instance
  private permissionManager: PermissionManager; // Add permission manager instance
  private planManager: PlanManager; // Add plan manager instance
  private subagentManager: SubagentManager; // Add subagent manager instance
  private slashCommandManager: SlashCommandManager; // Add slash command manager instance
  private pluginManager: PluginManager; // Add plugin manager instance
  private modManager: ModManager;
  private skillManager: SkillManager; // Add skill manager instance
  private cronManager: CronManager; // Add cron manager instance
  private hookManager: HookManager; // Add hooks manager instance
  private reversionManager: ReversionManager;
  private messageQueue: MessageQueue; // Unified queue for messages, bang commands, and notifications
  private dispatchPromise: Promise<void> | null = null; // Track current dispatch for teardown
  private isAborting = false; // Transient guard: prevents tryDispatch from firing during abortMessage (reset when the abort completes)
  private isDestroyed = false; // Terminal guard: set in destroy(), never reset — no dispatch may ever start after destroy
  private abortedDispatchPending = false; // An interrupt hit an in-flight dispatch: that dispatch's .finally re-check resumes user input only (never a notification, which would start a turn the user just stopped)
  private asyncWorkRegistry: import("./utils/asyncWorkRegistry.js").AsyncWorkRegistry; // Registry of live async work that destroy() drains before returning
  private memoryRuleManager: MemoryRuleManager; // Add memory rule manager instance
  private liveConfigManager: LiveConfigManager; // Add live configuration manager
  private taskManager: TaskManager;
  private foregroundTaskManager: ForegroundTaskManager;
  private container: Container;
  /** Unregister module-level listeners registered during container setup; invoked at the end of destroy(). */
  private teardown: () => void = () => {};
  private configurationService: ConfigurationService; // Add configuration service
  /**
   * The directory tools run in *right now* — it moves: a `cd` in Bash, and
   * EnterWorktree, both rewrite it (the container's `CurrentWorkdir` mirrors
   * it). Never use it as a session identity; that is `SessionWorkdir` (see
   * containerSetup).
   */
  private workdir: string;
  private systemPrompt?: string; // Custom system prompt
  private stream: boolean; // Streaming mode flag
  private sessionStartTime: number = Date.now();
  /** Model and language of the most recent completion, for `reportCompletionOutcome`. */
  private lastCompletion: { model?: string; language?: string } | null = null;
  /** Same, for the most recent next-edit suggestion (`reportNextEditOutcome`). */
  private lastNextEdit: { model?: string; language?: string } | null = null;
  /**
   * `$.prompt.fill` requests waiting for the surface's answer, keyed by the id
   * the host carries back (spec「把草稿填进输入框」).
   */
  private readonly modPromptFills = new Map<
    string,
    (filled: boolean) => void
  >();
  private modPromptFillSeq = 0;
  /**
   * `$.prompt.read` requests waiting for the surface's answer, keyed by the id
   * the host carries back (spec「输入框里现在有什么」).
   */
  private readonly modPromptReads = new Map<
    string,
    (box: { text: string; cursor: number }) => void
  >();
  private modPromptReadSeq = 0;
  /**
   * `$.prompt.suggest` requests waiting for the surface's answer, keyed by the id
   * the host carries back (spec「输入框里的建议与焦点」).
   */
  private readonly modPromptSuggests = new Map<
    string,
    (shown: boolean) => void
  >();
  private modPromptSuggestSeq = 0;
  /**
   * `$.ui.copy` requests waiting for the surface's answer (spec「剪贴板」).
   */
  private readonly modCopies = new Map<
    string,
    (result: { isCopied: boolean; reason?: string }) => void
  >();
  private modCopySeq = 0;
  /** `$.ui.ask` 每次提问的 id 序号（与 `toolCallId` 同一处用处）。 */
  private modAskSeq = 0;

  // Configuration options storage for dynamic resolution
  private options: AgentOptions;

  // Dynamic configuration getter methods
  public getGatewayConfig(): GatewayConfig {
    return {
      ...this.configurationService.resolveGatewayConfig(),
      sessionId: this.messageManager.getSessionId(),
    };
  }

  public getModelConfig(): ModelConfig {
    return this.configurationService.resolveModelConfig(
      undefined,
      undefined,
      this.getPermissionMode(),
    );
  }

  public getContextWindow(): number {
    return this.configurationService.resolveContextWindow();
  }

  public getMaxOutputTokens(): number {
    return this.configurationService.resolveMaxOutputTokens();
  }

  public getLanguage(): string {
    return this.configurationService.resolveLanguage();
  }

  /**
   * Re-read the merged configuration (user/project/local settings.json + remote
   * managed settings) and apply it to this session **without rebuilding it**:
   * hooks / permissions / env follow immediately, the settings.json-derived
   * values the running turn reads are re-pinned at the next turn start.
   *
   * THE save path calls this explicitly after writing the user-level
   * settings.json: that file is commonly *created* by that very write, so the
   * file watcher — armed at session start on a path that did not exist yet —
   * must not be the only trigger (docs/specs/core/agent-config.md
   * 「设置实时重载」). Idempotent with the watcher (a concurrent reload is
   * de-duplicated).
   */
  public async reloadConfiguration(): Promise<void> {
    await this.liveConfigManager.reload();
  }

  /**
   * Re-read every plugin from disk and swap its contribution into this running
   * session in place — the `/reload-plugins` command. Commands, skills,
   * agents, hooks, MCP servers and LSP servers all follow; the session itself
   * (sessionId, transcript, in-flight work) is untouched, so this is not a
   * rebuild. Every live session in the process must call this to see the new
   * state; sessions created afterwards pick it up from disk on their own.
   *
   * Busts the prompt cache for the tool-schema prefix (the skill and agent
   * lists are inlined) — deliberately accepted, see
   * docs/specs/ecosystem/plugin.md「插件变更的就地重载」.
   */
  public async reloadPlugins(): Promise<PluginReloadResult> {
    const result = await this.pluginManager.reloadAllPlugins();
    // Plugin skills arrive after SkillManager.initialize(), so their slash
    // commands have to be re-derived explicitly (same as at startup).
    this.slashCommandManager.registerSkillCommands(
      this.skillManager.getAvailableSkills(),
    );
    // Mods are part of the plugin surface: a reloaded plugin brings its mods
    // into the sandbox, a removed one drops them. `reload` closes the old
    // panels and cancels their timers before rebuilding (the mods themselves
    // are not notified — spec ecosystem/plugin-mods.md「事件」).
    try {
      await this.modManager.reload(this.pluginManager.getPlugins());
    } catch (error) {
      this.logger?.warn("Plugin mods failed to reload:", error);
    }
    return result;
  }

  /**
   * Route a webview interaction to the mod that owns the panel.
   *
   * Public because the stdio bridge is a different layer: it receives the
   * `modPanelEvent` RPC and hands the payload straight here.
   *
   * 返回值只有 `ui.focus` 用得上：插件接没接这一下方向键、接到哪个控件
   * （spec「方向键先问 mod」）。
   */
  public async handleModPanelEvent(
    payload: ModPanelEventPayload,
  ): Promise<Partial<ModPanelEventResult>> {
    return this.modManager.handlePanelEvent(payload);
  }

  /** Panel snapshots for panels opened before the host attached (resync). */
  public getModPanels(): ModPanelUpdatePayload[] {
    return this.modManager.paneSnapshots();
  }

  /**
   * What the surface currently shows and where its keyboard is (spec
   * `ecosystem/plugin-mods.md`「面板的显示与焦点」).
   *
   * Feeds `$.ui.panes()` 的 `isShown` / `isFocused`. A full snapshot, not an
   * increment: `null` means "this surface shows no pane / the keyboard is back
   * in the composer". Public because the stdio bridge receives the
   * `modPaneView` RPC and hands the payload straight here.
   */
  public setModPaneView(view: ModPaneViewPayload): void {
    this.modManager.setPaneView(view);
  }

  /**
   * The status lines mods currently show (spec `ecosystem/plugin-mods.md`
   * 「状态带、状态行与提示」).
   *
   * For replay only: a `session.start` push lands before the client has
   * registered the session and is dropped by the router, so the surface asks for
   * this snapshot at the same moment it resyncs the panels.
   */
  public getModStatuses(): ModStatusPayload[] {
    return this.modManager.statusSnapshots();
  }

  /**
   * Produce the tree a surface is asking for (spec `ecosystem/plugin-mods.md`
   * 「架构约束」: trees are pulled, never pushed).
   *
   * Public because the stdio bridge receives the `modPanelRender` RPC and hands
   * the pane identity straight here. `layout` 是「这一端把它摆在哪」（spec
   * 「在 IDE 插件里画」）：宽面板 dock 在对话右侧、窄面板落到输入框上方，
   * 引擎把它放进 `ui.render` 的 `e.props.placement` 与 `e.viewport`。
   */
  public async renderModPanel(
    modId: string,
    paneId: string,
    layout: ModPaneLayout = {},
  ): Promise<ModPanelRenderResult> {
    return this.modManager.renderPane(modId, paneId, layout);
  }

  /**
   * Produce the trees for the band above the composer (spec
   * `ecosystem/plugin-mods.md` 「状态带、状态行与提示」: same pull discipline as
   * panes — one `ui.render` call per mod that registers it).
   *
   * `metrics` is what the surface measured (the band's own width in character
   * cells, plus the surface's viewport in cells): it becomes `e.props.bodyColumns`
   * and `e.viewport` for the mod.
   */
  public async renderModBand(
    metrics: ModSurfaceMetrics = {},
  ): Promise<ModBandRenderResult[]> {
    return this.modManager.renderBand(metrics);
  }

  /**
   * Settle a `$.prompt.fill` (spec `ecosystem/plugin-mods.md`「把草稿填进输入框」).
   *
   * The surface is the only thing that can say whether the text landed, so the
   * request travels down as a notification and comes back as this RPC. A
   * `requestId` that is unknown by now (timed out, session gone) is ignored:
   * the mod has already been answered `{ isFilled: false }`.
   */
  public resolveModPromptFill(requestId: string, filled: boolean): void {
    this.settleModPromptFill(requestId, filled);
  }

  /**
   * Settle a `$.prompt.read` (spec `ecosystem/plugin-mods.md`「输入框里现在有什么」).
   *
   * Anything the surface cannot say reads as an empty draft: "nobody is drawing
   * a composer" and "the person has not typed yet" are one answer to a mod.
   */
  public resolveModPromptRead(
    requestId: string,
    text: string,
    cursor: number,
  ): void {
    const settle = this.modPromptReads.get(requestId);
    this.modPromptReads.delete(requestId);
    settle?.({
      text: typeof text === "string" ? text : "",
      cursor: Number.isFinite(cursor) ? cursor : 0,
    });
  }

  /**
   * Settle a `$.prompt.suggest` (spec「输入框里的建议与焦点」).
   *
   * The surface is the only one that knows whether the ghost text went up (the
   * composer may be busy or absent), so — exactly like `fill` — the request goes
   * out as a notification and the answer comes back here.
   */
  public resolveModPromptSuggest(requestId: string, isShown: boolean): void {
    const settle = this.modPromptSuggests.get(requestId);
    this.modPromptSuggests.delete(requestId);
    settle?.(isShown === true);
  }

  /**
   * 用户在输入框里做完一次编辑（spec「输入框里的建议与焦点」）。
   *
   * 链尾就是「把这次编辑应用上去」：`text` 是编辑**之前**的草稿，`start`/`end`
   * 圈出被替换的那一段，`inputText` 是放进去的字。所以 `next({ ...e, text })`
   * 是「换一份草稿再做同一次编辑」，`next({ ...e, inputText })` 是「换成别的
   * 字」；不调 `next` 直接答 `{ text: e.text, cursor: e.cursor }` 等于吃掉这次
   * 按键（拼写检查、语法闸门就这么写）。
   */
  public async dispatchModPromptEdit(event: {
    key?: unknown;
    text: string;
    cursor: number;
    start: number;
    end: number;
    inputText: string;
  }): Promise<{ text: string; cursor: number }> {
    const normalized: ModPromptEditEvent = {
      ...event,
      origin: { kind: "composer" },
    };
    return this.modManager.dispatchPromptEdit(normalized, (current) => {
      const box: Record<string, unknown> =
        typeof current === "object" && current !== null
          ? (current as Record<string, unknown>)
          : {};
      const base = typeof box.text === "string" ? box.text : event.text;
      const start = clampOffset(box.start, event.start, base.length);
      const end = clampOffset(box.end, event.end, base.length);
      const inputText =
        typeof box.inputText === "string" ? box.inputText : event.inputText;
      const from = Math.min(start, end);
      const to = Math.max(start, end);
      const text = `${base.slice(0, from)}${inputText}${base.slice(to)}`;
      // 光标落在填进去的字后面（spec 同段）：钩子没给就是「接着打字」。
      return { text, cursor: from + inputText.length };
    });
  }

  /**
   * 一个建议要摆进输入框（spec「输入框里的建议与焦点」）。
   *
   * `plugin` 缺省表示这是引擎自己的推荐（`origin: { kind: "suggestion" }`）；
   * `$.prompt.suggest` 走 `plugin` 那一支，于是别的 mod 能看见、能换、能否。
   * 链尾是宿主那一趟往返（`next({ ...e, text })` 改的就是要摆的那条）。
   */
  public async dispatchModPromptSuggest(request: {
    text: string;
    plugin?: string;
  }): Promise<{ isShown: boolean; text: string }> {
    const origin: ModPromptOrigin = request.plugin
      ? { kind: "plugin", name: request.plugin }
      : { kind: "suggestion" };
    const event: ModPromptSuggestEvent = { text: request.text, origin };
    return this.modManager.dispatchPromptSuggest(event, async (current) => {
      const text =
        typeof current === "object" &&
        current !== null &&
        typeof (current as { text?: unknown }).text === "string"
          ? (current as { text: string }).text
          : request.text;
      const isShown = await this.showModPromptSuggestion(text, request.plugin);
      return { isShown };
    });
  }

  /**
   * Settle a `$.ui.copy` (spec `ecosystem/plugin-mods.md`「剪贴板」).
   *
   * A refusal is an answer, not an error: `isCopied: false` with a `reason` is
   * exactly what the mod compares against.
   */
  public resolveModCopy(
    requestId: string,
    isCopied: boolean,
    reason?: string,
  ): void {
    const settle = this.modCopies.get(requestId);
    this.modCopies.delete(requestId);
    settle?.({ isCopied: isCopied === true, reason });
  }

  /**
   * `$.ui.ask` — 一个 mod 问用户一个问题（spec「问用户一个问题」）。
   *
   * 走的就是模型那个 `AskUserQuestion` 工具的审批链路：同一个
   * `PermissionManager.checkPermission`、同一张卡片、同一套「关掉 = 拒绝」。所以
   * 插件不需要新的界面能力，界面也不需要认出「这张卡片是插件问的」。
   *
   * resolve 成用户选中的那个标签（或在「其他」里打的自由文本）；用户关掉对话
   * 框、这条会话没有界面接手时 reject —— 守卫据此按「没人能答」处理。
   */
  private async askModQuestion(
    question: string,
    options: { labels: string[]; header?: string; multiSelect?: true },
  ): Promise<string> {
    const permissionManager = this.container.has("PermissionManager")
      ? this.container.get<PermissionManager>("PermissionManager")
      : undefined;
    if (!permissionManager) {
      throw new Error("这条会话没有权限管理器，插件问不了问题");
    }
    const permissionMode = this.container.has("PermissionMode")
      ? this.container.get<PermissionMode>("PermissionMode")
      : undefined;
    const canUseToolCallback = this.container.has("CanUseToolCallback")
      ? this.container.get<PermissionCallback>("CanUseToolCallback")
      : undefined;
    const permissionContext = permissionManager.createContext(
      ASK_USER_QUESTION_TOOL_NAME,
      permissionMode || "default",
      canUseToolCallback,
      {
        questions: [
          {
            question,
            header: options.header ?? "plugin",
            options: options.labels.map((label) => ({ label })),
            ...(options.multiSelect ? { multiSelect: true } : {}),
          },
        ],
      },
      `mod-ask-${++this.modAskSeq}`,
    );
    // 与模型那次提问同一条：不给「一直允许」那一档。
    permissionContext.hidePersistentOption = true;
    // 这里**不**发 `classic.Notification`：CC 对提问卡片不发通知，它的取值表里也
    // 没有这一类。编个表外的名字（曾经是 `notification_type: "question"`）只会让
    // 按真名字过滤的插件永远不触发（spec「影子事件」）。
    const decision = await permissionManager.checkPermission(permissionContext);
    if (decision.behavior === "deny") {
      throw new Error(
        "用户没有回答插件的问题（对话框关掉，或这条会话没有界面）",
      );
    }
    const answers = JSON.parse(decision.message || "{}") as Record<
      string,
      string | string[]
    >;
    const answer = answers[question];
    // 多选时界面给的是数组：Claude Code 的口径是用逗号连起来。
    if (Array.isArray(answer)) return answer.join(", ");
    if (typeof answer !== "string" || answer.trim().length === 0) {
      throw new Error("用户没有回答插件的问题（回执里没有答案）");
    }
    return answer;
  }

  /**
   * Ask the surface to put a draft in its composer.
   *
   * Resolves `false` — never rejects — when there is no surface to ask, or when
   * nobody answers in time (spec「把草稿填进输入框」: `isFilled: false` is a
   * normal result, not an error). The timer is not a nicety: without it a mod
   * awaiting a wedged webview would hang until the session dies.
   */
  private fillModPrompt(request: {
    text: string;
    mode: ModPromptFillMode;
  }): Promise<boolean> {
    const notify = this.options.callbacks?.onModPromptFill;
    if (!notify) return Promise.resolve(false);
    const requestId = `prompt-fill-${++this.modPromptFillSeq}`;
    return new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => {
        this.settleModPromptFill(requestId, false);
      }, MOD_LIMITS.promptFillTimeoutMs);
      // A pending fill must not keep the process alive on its own.
      timer.unref?.();
      this.modPromptFills.set(requestId, (filled) => {
        clearTimeout(timer);
        resolve(filled);
      });
      try {
        notify({
          sessionId: this.sessionId,
          requestId,
          text: request.text,
          mode: request.mode,
        });
      } catch {
        // A host that throws on its own callback is a host that cannot fill.
        this.settleModPromptFill(requestId, false);
      }
    });
  }

  private settleModPromptFill(requestId: string, filled: boolean): void {
    const settle = this.modPromptFills.get(requestId);
    // Delete before settling: the settle path clears the timer and resolves, and
    // a late reply arriving in the same tick must find nothing to settle again.
    this.modPromptFills.delete(requestId);
    settle?.(filled);
  }

  /**
   * Read the draft the person is typing right now (spec「输入框里现在有什么」).
   *
   * `$.prompt.fill`'s mirror image, on the same channel discipline: no surface
   * wired, no answer in time, or a host that throws all read as an empty draft —
   * the mod gets `{ text: "", cursor: 0 }` rather than a rejection.
   */
  private readModPrompt(): Promise<{ text: string; cursor: number }> {
    const notify = this.options.callbacks?.onModPromptRead;
    if (!notify) return Promise.resolve({ text: "", cursor: 0 });
    const requestId = `prompt-read-${++this.modPromptReadSeq}`;
    return new Promise<{ text: string; cursor: number }>((resolve) => {
      const timer = setTimeout(() => {
        this.resolveModPromptRead(requestId, "", 0);
      }, MOD_LIMITS.promptReadTimeoutMs);
      timer.unref?.();
      this.modPromptReads.set(requestId, (box) => {
        clearTimeout(timer);
        resolve(box);
      });
      try {
        notify({ sessionId: this.sessionId, requestId });
      } catch {
        this.resolveModPromptRead(requestId, "", 0);
      }
    });
  }

  /**
   * Ask the surface to show a suggestion above the composer
   * (spec「输入框里的建议与焦点」).
   *
   * Same discipline as `fill` / `read`: no surface wired, or nobody answering in
   * time, both read as `isShown: false` — a suggestion that did not land is a
   * normal result, not an error, and the mod is expected to degrade on its own.
   */
  private showModPromptSuggestion(
    text: string,
    plugin?: string,
  ): Promise<boolean> {
    const notify = this.options.callbacks?.onModPromptSuggest;
    if (!notify) return Promise.resolve(false);
    const requestId = `prompt-suggest-${++this.modPromptSuggestSeq}`;
    return new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => {
        this.resolveModPromptSuggest(requestId, false);
      }, MOD_LIMITS.promptFillTimeoutMs);
      // A pending suggestion must not keep the process alive on its own.
      timer.unref?.();
      this.modPromptSuggests.set(requestId, (shown) => {
        clearTimeout(timer);
        resolve(shown);
      });
      try {
        notify({
          sessionId: this.sessionId,
          requestId,
          text,
          plugin: plugin ?? "wave",
        });
      } catch {
        // A host that throws on its own callback is a host that cannot show it.
        this.resolveModPromptSuggest(requestId, false);
      }
    });
  }

  /**
   * Ask the surface to put text on the clipboard (spec「剪贴板」).
   *
   * Refuses politely where there is no clipboard: no surface wired, or an answer
   * that never arrives, both read as `no-surface` rather than an error.
   */
  private copyModText(request: {
    text: string;
    surface?: ModRenderSurface;
  }): Promise<ModUiCopyResult> {
    const notify = this.options.callbacks?.onModCopy;
    if (!notify)
      return Promise.resolve({ isCopied: false, reason: "no-surface" });
    const requestId = `copy-${++this.modCopySeq}`;
    return new Promise<ModUiCopyResult>((resolve) => {
      const timer = setTimeout(() => {
        this.resolveModCopy(requestId, false, "no-surface");
      }, MOD_LIMITS.promptReadTimeoutMs);
      timer.unref?.();
      this.modCopies.set(requestId, (result) => {
        clearTimeout(timer);
        resolve(
          result.isCopied
            ? { isCopied: true }
            : {
                isCopied: false,
                // 协议里只有三个词：认得出的原样透传，剩下的（宿主自造的
                // 理由）归一成「被拒」，别把没约定的字符串漏给 mod。
                reason:
                  result.reason === "no-clipboard"
                    ? "no-clipboard"
                    : result.reason === "no-surface"
                      ? "no-surface"
                      : "refused",
              },
        );
      });
      try {
        notify({
          sessionId: this.sessionId,
          requestId,
          text: request.text,
          ...(request.surface ? { surface: request.surface } : {}),
        });
      } catch {
        this.resolveModCopy(requestId, false, "no-surface");
      }
    });
  }

  /**
   * Set the active model for the agent session
   * @param model - The ID of the model to use
   */
  public async setModel(model: string): Promise<void> {
    // 换之前那两个值要在 `setModel` **之前**取：配置一改，解析出来就是新模型
    // 了，`from_model` 会变成自己。
    const fromModel =
      this.configurationService.resolveModelConfig().model ?? "";
    const contextTokens = this.getSessionUsage().context.tokens;
    await this.configurationService.setModel(model);
    this.options.callbacks?.onModelChange?.(model);
    // 影子事件 `classic.PostModelSwitch`（spec「影子事件」）：只在显式换模型时
    // 发，配置文件热更新换模型不走这条路。字段名照 CC（`from_model` /
    // `to_model` / `context_tokens`）；`cache_ttl` 恒 `null` —— 我们不做提示词
    // 缓存的 TTL 记账，给个假数字比给 `null` 更坏。
    this.modManager.notifyMods("classic.PostModelSwitch", {
      from_model: fromModel,
      to_model: model,
      context_tokens: contextTokens,
      cache_ttl: null,
    });
  }

  /**
   * Get all configured models from settings.json and defaults
   * @returns Model ids with the capability flags the model picker renders
   */
  public getConfiguredModels(): ConfiguredModel[] {
    return this.configurationService.getConfiguredModels();
  }

  /**
   * Run one inline (ghost-text) code completion for a cursor context.
   *
   * This is deliberately outside the conversation turn loop: no tools, no
   * system prompt assembly, no hooks, and **no** share of the conversation's
   * 1 QPS slot (completion fires on every typing pause, the conversation does
   * not). Throttling and cancellation belong to the caller — a host supersedes
   * its own in-flight request on the next keystroke.
   */
  public async getCompletion(params: {
    prefix: string;
    suffix: string;
    language?: string;
    filePath?: string;
    snippets?: CompletionSnippet[];
    abortSignal?: AbortSignal;
  }): Promise<{ text: string; model: string }> {
    const result = await getCompletion({
      gatewayConfig: this.getGatewayConfig(),
      modelConfig: this.getModelConfig(),
      ...params,
    });

    // Kept for `reportCompletionOutcome`: the host reports only what it knows
    // (shown / accepted), never the model or the language — those are the
    // CLI's to derive, and a suggestion has at most one of each.
    this.lastCompletion = {
      model: result.model,
      language: languageFromPath(params.filePath),
    };

    return result;
  }

  /**
   * Predict the user's next edit in the current file (spec
   * ui/next-edit-suggestion.md).
   *
   * Sibling of `getCompletion` and deliberately built the same way: outside the
   * conversation turn loop, no tools, no hooks, no share of the 1 QPS slot. The
   * difference is the input — an edit trajectory plus a rewritable window — and
   * the answer, which replaces lines rather than inserting at a caret.
   */
  public async getNextEdit(params: {
    edits: NextEditHistoryEntry[];
    region: NextEditRegion;
    excerpt: NextEditExcerpt;
    language?: string;
    filePath?: string;
    abortSignal?: AbortSignal;
  }): Promise<{ suggestion: NextEditSuggestion | null; model: string }> {
    const result = await getNextEdit({
      gatewayConfig: this.getGatewayConfig(),
      modelConfig: this.getModelConfig(),
      ...params,
    });

    // Recorded even when the answer was "nothing to change": the host is the
    // side that knows what it rendered, and the report carries no identity
    // beyond "the most recent suggestion".
    this.lastNextEdit = {
      model: result.model,
      language: languageFromPath(params.filePath),
    };

    return result;
  }

  /**
   * Record one event in the life of the most recent completion suggestion:
   * `displayed` when the host rendered it, `accepted` when the user took it.
   *
   * The host is the only side that knows either fact (the CLI merely returned
   * some text), so this arrives over RPC rather than being inferred here. With
   * no suggestion yet — or on a host that has no acceptance signal at all —
   * the call is a no-op, which is exactly the spec's "no half data" rule.
   */
  public reportCompletionOutcome(outcome: "displayed" | "accepted"): void {
    const last = this.lastCompletion;
    if (!last) return;

    recordCompletionOutcome(
      { outcome, model: last.model, language: last.language },
      this.telemetryContext,
    );
  }

  /**
   * The next-edit sibling of `reportCompletionOutcome`, into its own series
   * (`wave.next_edit.outcome`): the two capabilities have different
   * denominators, so their rates must never be mixed (spec
   * ui/next-edit-suggestion.md 故事 7).
   */
  public reportNextEditOutcome(outcome: "displayed" | "accepted"): void {
    const last = this.lastNextEdit;
    if (!last) return;

    recordNextEditOutcome(
      { outcome, model: last.model, language: last.language },
      this.telemetryContext,
    );
  }

  /**
   * Agent constructor - handles configuration resolution and validation
   *
   * IMPORTANT: This constructor is private. Use Agent.create() instead for proper
   * async initialization. Keep this constructor's signature exactly the same as
   * Agent.create() to maintain API consistency.
   *
   * @param options - Configuration options for the Agent instance
   */
  private constructor(options: AgentOptions) {
    const { logger, workdir, systemPrompt, stream = true } = options;

    // Set working directory early as we need it for loading configuration
    this.workdir = workdir || process.cwd();

    // Initialize configuration service
    this.configurationService = new ConfigurationService();
    this.configurationService.setOptions(options);

    this.logger = logger; // Save the passed logger
    this.systemPrompt = systemPrompt; // Save custom system prompt
    this.stream = stream; // Save streaming mode flag

    // Store options for dynamic configuration resolution
    this.options = options;

    const { container, teardown } = setupAgentContainer({
      options,
      workdir: this.workdir,
      configurationService: this.configurationService,
      systemPrompt: this.systemPrompt,
      stream: this.stream,
      onTasksChange: (tasks) => {
        this.options.callbacks?.onTasksChange?.(tasks);
      },
      onBackgroundTasksChange: (tasks) => {
        this.options.callbacks?.onBackgroundTasksChange?.(tasks);
      },
      onPermissionModeChange: (mode) => {
        this.options.callbacks?.onPermissionModeChange?.(mode);
      },
      handlePlanModeTransition: (mode) => {
        this.planManager.handlePlanModeTransition(mode);
      },
      setPermissionMode: (mode) => {
        this.setPermissionMode(mode);
      },
      addPermissionRule: (rule) => this.addPermissionRule(rule),
      addUsage: (usage) => this.messageManager.addUsage(usage),
    });
    this.container = container;
    this.teardown = teardown;

    // Retrieve managers from container
    this.foregroundTaskManager = this.container.get("ForegroundTaskManager")!;
    this.memoryRuleManager = this.container.get("MemoryRuleManager")!;
    this.messageManager = this.container.get("MessageManager")!;
    this.taskManager = this.container.get("TaskManager")!;
    this.backgroundTaskManager = this.container.get("BackgroundTaskManager")!;
    this.shellProcessReaper = this.container.get("ShellProcessReaper")!;
    this.mcpManager = this.container.get("McpManager")!;
    this.lspManager = this.container.get("LspManager")!;
    this.permissionManager = this.container.get("PermissionManager")!;
    this.planManager = this.container.get("PlanManager")!;
    this.hookManager = this.container.get("HookManager")!;
    this.skillManager = this.container.get("SkillManager")!;
    this.reversionManager = this.container.get("ReversionManager")!;
    this.toolManager = this.container.get("ToolManager")!;
    this.liveConfigManager = this.container.get("LiveConfigManager")!;
    this.subagentManager = this.container.get("SubagentManager")!;
    this.aiManager = this.container.get("AIManager")!;
    this.slashCommandManager = this.container.get("SlashCommandManager")!;
    this.pluginManager = this.container.get("PluginManager")!;
    this.modManager = this.container.get("ModManager")!;
    this.bashModeManager = this.container.get("BashModeManager")!;
    this.cronManager = this.container.get("CronManager")!;
    this.messageQueue = this.container.get("MessageQueue")!;
    this.asyncWorkRegistry = this.container.get("AsyncWorkRegistry")!;

    // Plugin mods can post a prompt into this session (`$.prompt.submit`, spec
    // ecosystem/plugin-mods.md). It has to go through `sendMessage` so a mod's
    // prompt obeys the same rules as a typed one: queued while busy, immediate
    // for `/clear`-style commands. The ModManager cannot resolve this itself —
    // it sits below `Agent` in the dependency graph.
    this.modManager.setPromptSubmitter((text) => this.sendMessage(text));

    // Plugin mods can end the turn that is running (`$.turn.abort`, spec「收掉
    // 一轮」). Same reason as the prompt channel: only AIManager knows which turn
    // is in flight, so ModManager forwards and lets a bad `turnId` reject — a mod
    // must not be told it stopped something it did not.
    this.modManager.setTurnAborter((turnId) =>
      this.aiManager.abortTurn(turnId),
    );

    // Plugin mods can read the session's token usage (`$.session.usage`, spec
    // ecosystem/plugin-mods.md「会话用量」). Same shape as the prompt channel:
    // the numbers live on `Agent` and the managers below it, so they are pushed
    // down here rather than resolved inside ModManager.
    this.modManager.setSessionUsageProvider(() => this.getSessionUsage());

    // Plugin mods can put a draft in the composer (`$.prompt.fill`, spec
    // ecosystem/plugin-mods.md「把草稿填进输入框」). Unlike `submit`, this one
    // travels out to the surface and back: only the UI knows whether the text
    // landed, so the answer arrives later through `resolveModPromptFill`.
    this.modManager.setPromptFiller((request) => this.fillModPrompt(request));

    // `$.prompt.read` — the draft the person is typing right now
    // (spec「输入框里现在有什么」). Same channel as `fill`, answered the same way.
    this.modManager.setPromptDraftReader(() => this.readModPrompt());

    // `$.prompt.suggest` — ghost text above the composer, Tab to accept
    // (spec「输入框里的建议与焦点」). The chain in ModManager calls this only
    // when no mod vetoed it, so this sink is the "show it" tail.
    this.modManager.setPromptSuggestionSink(async (request) => ({
      isShown: await this.showModPromptSuggestion(request.text, request.plugin),
    }));

    // `$.ui.notice` — one line under a tool call (spec「工具行下面的一行」).
    // Push-only: a host without tool blocks leaves it unwired and the mod's call
    // still succeeds.
    this.modManager.setNoticeSink((plugin, toolUseId, text) => {
      this.options.callbacks?.onModNotice?.({
        sessionId: this.sessionId,
        plugin,
        toolUseId,
        text,
      });
    });

    // `$.ui.copy` — put text on the surface's clipboard (spec「剪贴板」).
    // A refusal travels back as `isCopied: false`, never as a rejection.
    this.modManager.setCopySink((request) => this.copyModText(request));

    // Plugin mods can ask the user a question (`$.ui.ask`, spec
    // ecosystem/plugin-mods.md「问用户一个问题」). It rides the very same
    // `AskUserQuestion` permission path the model's tool uses, so every surface
    // already knows how to draw it and nobody has to learn a second dialog. What
    // it cannot do is invent an answer when nobody is watching: that rejects,
    // and a guard reads the rejection as "no".
    this.modManager.setAskUser((question, options) =>
      this.askModQuestion(question, options),
    );

    // Wire up CWD change callback from AIManager to sync Agent's workdir
    this.aiManager.setOnCwdChange((newCwd) => {
      const previousCwd = this.workdir;
      this.workdir = newCwd;
      this.container.register("CurrentWorkdir", newCwd);
      this.options.callbacks?.onWorkdirChange?.(newCwd);
      if (newCwd !== previousCwd) {
        this.notifyCwdChanged(previousCwd);
      }
    });

    // Workspace relocations (EnterWorktree / ExitWorktree) are a different
    // event from a `cd`: the conversation moved to another working tree, so the
    // surfaces that show "the project the user is looking at" must follow.
    this.aiManager.setOnWorkspaceRootChange((newRoot) => {
      this.options.callbacks?.onWorkspaceRootChange?.(newRoot);
    });

    // Wire up message queue to process when agent becomes idle.
    // Both user messages and background task notifications enqueue here,
    // unified through a single dispatch path (tryDispatch).
    this.messageQueue.onMessageEnqueued = () => this.tryDispatch();

    // Wire up AI loading changes to process queue when AI becomes idle
    this.aiManager.onLoadingChange = (loading: boolean) => {
      if (!loading) this.tryDispatch();
    };

    // Wire up bang manager callback for command running changes
    this.bashModeManager.onCommandRunningChange = (running: boolean) => {
      this.options.callbacks?.onCommandRunningChange?.(running);
      if (!running) this.tryDispatch();
    };

    // Set initial permission mode if provided
    if (options.permissionMode) {
      this.setPermissionMode(options.permissionMode);
    }
  }

  // Public getter methods
  public get sessionId(): string {
    return this.messageManager.getSessionId();
  }

  /**
   * Standard attribution of this session's telemetry records: which session,
   * where, and (when the host declared one) which entrypoint created it.
   *
   * `workdir` is the session's starting directory, not `this.workdir`: the
   * latter follows the shell (`cd` in Bash, EnterWorktree), and the repository
   * a session is filed under must not change because a command moved the
   * shell.
   */
  private get telemetryContext(): RecordContext {
    return {
      sessionId: this.messageManager.getSessionId(),
      workdir: this.container.get<string>("SessionWorkdir") ?? this.workdir,
      entrypoint: entrypointOf(this.container),
    };
  }

  public get messages(): Message[] {
    return this.messageManager.getMessages();
  }

  public get usages(): Usage[] {
    return this.messageManager.getUsages();
  }

  public get sessionFilePath(): string {
    return this.messageManager.getTranscriptPath();
  }

  /**
   * 会话消息大纲的索引（spec ui/transcript-outline.md 场景 16）：整份转录里每条
   * 带文本用户消息的 id 与文本首段。只读快照——不触发模型请求、不动上下文，页面
   * 拿它画左边缘那列刻度、点击时再用 `from` 取那一页。
   */
  public getTranscriptOutline(): Promise<TranscriptOutlineEntry[]> {
    return this.messageManager.getTranscriptOutline();
  }

  public get latestTotalTokens(): number {
    return this.messageManager.getLatestTotalTokens();
  }

  /**
   * `$.session.usage()` 的快照（spec `ecosystem/plugin-mods.md`「会话用量」）。
   *
   * 只读、O(usages)：`context.tokens` 取最近一次带 usage 的响应报出的总数
   * （与输入框旁那个用量环同一个数），`context.percent` 的分母是自动压缩阈值；
   * `tokens.*` 是整场会话的累计值，其中 `prompt` **含**缓存命中的 token ——
   * 我们上游的 `prompt_tokens` 就是含的，别按 Claude Code 的 `input_tokens`
   * （不含）去对。
   *
   * `rateLimits` 来自模型响应上的 `x-codechat-quota-*`（AIManager 留存的最后一批，
   * 窗口名是上游的 `weekly` / `monthly`，**不是** CC 的 `five_hour` / `seven_day`）。
   * 私有化 / 自定义网关不发这批头 → 空数组：那是「这个账号没有配额窗口可报」的
   * 真实读法，不是缺陷，所以不报错也不打日志。
   */
  public getSessionUsage(): ModSessionUsage {
    const tokens = this.latestTotalTokens;
    const window = this.getContextWindow();
    const totals = { prompt: 0, completion: 0, cacheRead: 0, cacheCreation: 0 };
    for (const usage of this.usages) {
      totals.prompt += usage.prompt_tokens;
      totals.completion += usage.completion_tokens;
      totals.cacheRead += usage.cache_read_input_tokens ?? 0;
      totals.cacheCreation += usage.cache_creation_input_tokens ?? 0;
    }
    const usage: ModSessionUsage = {
      // 会话起点，社区 mod 用它算「$/小时」这类速率（`(now - startedAt)`）。
      startedAt: this.sessionStartTime,
      context: {
        tokens,
        window,
        percent: contextUsagePercent(tokens, window, this.getMaxOutputTokens()),
      },
      tokens: totals,
      // 额度窗口：AIManager 在每次模型调用后留下最后一批 `x-codechat-quota-*`
      // （成功与错误两条路径），这里把它们解析成 mod 认的窗口形状。
      // 没有任何头（私有化 / 自定义网关）→ 空数组，形状与社区一致
      // （它们直接 `.reduce` 这个字段）。
      rateLimits: rateLimitWindowsFromQuotaHeaders(
        this.aiManager.getLastQuotaHeaders(),
      ),
    };
    const model = this.getModelConfig().model;
    if (model !== undefined) usage.model = model;
    return usage;
  }

  /**
   * `/context` 的报告数据（spec `commands/context-command.md`）：按来源拆开的
   * 上下文构成、窗口、压缩阈值与实测总量。只读、不发模型请求。
   */
  public async getContextBreakdown(): Promise<ContextBreakdown> {
    return await this.aiManager.getContextBreakdown();
  }

  /**
   * User-set conversation title, or undefined when the session has none
   * (`custom-title` in the transcript, spec session-management.md「会话自定义
   * 标题（重命名）」). Exposed so a host can label a *live* session without
   * reading the transcript off disk — the remote-control page builds its session
   * list from in-memory sessions only.
   */
  public get customTitle(): string | undefined {
    return this.messageManager.getCustomTitle();
  }

  /**
   * Where the session's tools run *right now* — it moves: a `cd` in Bash (via
   * `onWorkdirChange`) and EnterWorktree both rewrite it. Never use it as a
   * session identity; that is the container's `SessionWorkdir` (see
   * containerSetup).
   */
  public get currentWorkdir(): string {
    return this.workdir;
  }

  /**
   * Where the session was opened — the directory that answers "which project
   * does this conversation belong to". Unlike `currentWorkdir` it does not
   * follow a Bash `cd`; it only changes when a *different* session is restored
   * into this agent (`switchSessionWorkdir`).
   */
  public get sessionWorkdir(): string {
    return this.container.get<string>("SessionWorkdir") ?? this.workdir;
  }

  /**
   * The working tree this conversation works in right now: it starts at the
   * session's opening directory and follows the session's own relocations
   * (EnterWorktree / ExitWorktree) — but not a Bash `cd`. Surfaces showing "the
   * project the user is looking at" (diff panel, file tree, `@` search) read
   * this; durable identity keeps reading `sessionWorkdir`.
   */
  public get workspaceRoot(): string {
    return this.container.get<string>("WorkspaceRoot") ?? this.workdir;
  }

  /**
   * Move the shell's working directory (EnterWorktree / ExitWorktree, or a
   * host re-pointing the session). Deliberately does not touch
   * `SessionWorkdir`: the repository a session belongs to does not change
   * because a command moved the shell. It does not touch `WorkspaceRoot`
   * either — relocating the *workspace* is a separate intent that the worktree
   * tools express through `AIManager.setWorkspaceRoot`.
   *
   * @param newCwd - The new working directory
   */
  public setCurrentWorkdir(newCwd: string): void {
    const previousCwd = this.workdir;
    this.workdir = newCwd;
    this.container.register("CurrentWorkdir", newCwd);
    this.options.callbacks?.onWorkdirChange?.(newCwd);
    if (newCwd !== previousCwd) {
      this.notifyCwdChanged(previousCwd);
    }
  }

  /**
   * 影子事件 `classic.CwdChanged`（spec「影子事件」）：只报**会动的**那个目录变
   * 了（Bash `cd`、进/出 worktree）。工作区根（`WorkspaceRoot`）与会话起点
   * （`SessionWorkdir`）不动，所以它们变了也不算 —— 见那两个 token 的分工。
   */
  private notifyCwdChanged(previousCwd: string): void {
    this.modManager.notifyMods("classic.CwdChanged", {
      // 字段名照 CC：`old_cwd` / `new_cwd`（社区插件读的就是这两个）。
      old_cwd: previousCwd,
      new_cwd: this.workdir,
    });
  }

  /**
   * Set this session's worktree session state (used by CLI -w startup to inject the
   * session created before the agent existed). Delegates to AIManager so the state is
   * stored in this agent's own DI container.
   */
  public setWorktreeSession(session: WorktreeSession | null): void {
    this.aiManager.setWorktreeSession(session);
  }

  /** Get project memory content */
  public get projectMemory(): string {
    const memoryService =
      this.container.get<import("./services/memory.js").MemoryService>(
        "MemoryService",
      );
    return memoryService?.cachedProjectMemory ?? "";
  }

  /** Get user memory content */
  public get userMemory(): string {
    const memoryService =
      this.container.get<import("./services/memory.js").MemoryService>(
        "MemoryService",
      );
    return memoryService?.cachedUserMemory ?? "";
  }

  /** Get combined memory content (project + user + modular rules) */
  public async getCombinedMemory(): Promise<string> {
    return this.messageManager.getCombinedMemory();
  }

  /** Persist the user-level memory file (~/.wave/AGENTS.md). */
  public async writeUserMemoryContent(content: string): Promise<void> {
    const memoryService =
      this.container.get<import("./services/memory.js").MemoryService>(
        "MemoryService",
      );
    await memoryService?.writeUserMemoryContent(content);
  }

  /** Persist the project-level memory file (<workdir>/AGENTS.md). */
  public async writeProjectMemoryContent(
    workdir: string,
    content: string,
  ): Promise<void> {
    const memoryService =
      this.container.get<import("./services/memory.js").MemoryService>(
        "MemoryService",
      );
    await memoryService?.writeProjectMemoryContent(workdir, content);
  }

  /**
   * Persist the project-level personal memory file
   * (<workdir>/AGENTS.local.md — never CLAUDE.local.md).
   */
  public async writeLocalMemoryContent(
    workdir: string,
    content: string,
  ): Promise<void> {
    const memoryService =
      this.container.get<import("./services/memory.js").MemoryService>(
        "MemoryService",
      );
    await memoryService?.writeLocalMemoryContent(workdir, content);
  }

  /** Get AI loading status */
  public get isLoading(): boolean {
    return this.aiManager.isLoading;
  }

  /** Get message compaction status */
  public get isCompacting(): boolean {
    return this.aiManager.getIsCompacting();
  }

  /** Get bash command execution status */
  public get isCommandRunning(): boolean {
    return this.bashModeManager?.isCommandRunning ?? false;
  }

  /** Get queued user-facing messages (excludes background notifications) */
  public get queuedMessages(): QueuedMessage[] {
    return this.messageQueue
      .getQueue()
      .filter((m) => m.type !== "notification");
  }

  /**
   * The foreground task list (the todo list). File-backed — the manager owns
   * the session directory and keeps no in-memory copy — so this is async,
   * unlike the state getters above. Readers that want the current value of a
   * live session (the remote hosts' `getSessionInfo`) await it.
   */
  public async getTasks(): Promise<Task[]> {
    return this.taskManager.listTasks();
  }

  /**
   * Remove a queued message by index
   * @param index - The index of the message to remove
   * @returns true if the message was removed, false if the index was out of bounds
   */
  public removeQueuedMessage(index: number): boolean {
    const removed = this.messageQueue.removeAt(index);
    if (removed) {
      this.options.callbacks?.onQueuedMessagesChange?.(this.queuedMessages);
    }
    return removed;
  }

  /**
   * Recall the last editable queued message (for inline editing)
   * @returns The recalled message, or null if no editable message exists
   */
  public recallQueuedMessage(): QueuedMessage | null {
    const msg = this.messageQueue.popLastEditable();
    if (msg) {
      this.options.callbacks?.onQueuedMessagesChange?.(this.queuedMessages);
    }
    return msg;
  }

  /**
   * Remove a queued message by its ID
   * @param id - The ID of the message to remove
   * @returns true if the message was removed, false if not found
   */
  public removeQueuedMessageById(id: string): boolean {
    const removed = this.messageQueue.removeById(id);
    if (removed) {
      this.options.callbacks?.onQueuedMessagesChange?.(this.queuedMessages);
    }
    return removed;
  }

  /**
   * Update a queued message's content by its ID (does not change queue order)
   * @param id - The ID of the message to update
   * @param patch - The fields to update
   * @returns true if the message was updated, false if not found
   */
  public updateQueuedMessageById(
    id: string,
    patch: {
      content?: string;
      images?: UserImage[];
      type?: "message" | "bang";
    },
  ): boolean {
    const updated = this.messageQueue.updateById(id, patch);
    if (updated) {
      this.options.callbacks?.onQueuedMessagesChange?.(this.queuedMessages);
    }
    return updated;
  }

  /**
   * Terminal-lifecycle guard for public APIs. destroy() is terminal: after it
   * returns, no new work may start on this agent. Silent drops hid misuse until
   * a ghost async side effect surfaced later (issue #1808); throwing surfaces
   * the contract violation immediately at the call site.
   */
  private assertNotDestroyed(): void {
    if (this.isDestroyed) {
      throw new Error("Agent destroyed");
    }
  }

  /**
   * Unified dispatch trigger — checks state machine before processing.
   * Handles user messages, bang commands, and background task notifications
   * through a single serialized path. Called from onMessageEnqueued,
   * onLoadingChange(false), and onCommandRunningChange(false).
   */
  private tryDispatch(): void {
    if (this.isDestroyed) return; // Terminal: agent destroyed, never dispatch again
    if (this.isAborting) return; // Suppress dispatch during abort; the abort's own tail resumes the queue (see abortMessage)
    if (this.messageQueue.state !== "idle") return;
    if (!this.messageQueue.hasPending()) return;
    if (this.aiManager.isLoading || this.isCommandRunning) return;

    this.messageQueue.transitionTo("dispatching");
    this.dispatchPromise = this.asyncWorkRegistry.track(
      this.processQueuedMessage()
        .catch((error) => {
          this.logger?.error("Failed to process queued message:", error);
        })
        .finally(() => {
          this.messageQueue.transitionTo("idle");
          this.dispatchPromise = null;
          if (this.abortedDispatchPending) {
            // This dispatch was interrupted: resume the user's own input only.
            // A pending background-task notification waits for the next real
            // input instead of starting a turn the user just stopped.
            this.abortedDispatchPending = false;
            if (this.hasPendingUserInput()) {
              this.tryDispatch();
            }
            return;
          }
          this.tryDispatch(); // Re-check after processing
        }),
    );
  }

  /**
   * Process the next queued item when the agent becomes idle.
   * Handles three item types: user messages, bang commands, and notifications.
   */
  private async processQueuedMessage(): Promise<void> {
    const next = this.messageQueue.dequeue();
    if (!next) return;

    this.messageQueue.transitionTo("running");
    this.options.callbacks?.onQueuedMessagesChange?.(this.queuedMessages);

    if (next.type === "bang") {
      await this.bashModeManager?.executeCommand(next.content);
      await this.messageManager.saveSession();
    } else if (next.type === "notification") {
      // Drain all pending notifications and batch them into a single AI turn.
      // The parse/inject step is shared with the in-turn and turn-end drains
      // (AIManager.injectTaskNotifications) so all three paths agree on how a
      // notification becomes a message — including a workflow's `result`,
      // which is the whole point of its notification: the summary only carries
      // counts, so dropping it left the model with a headline and no findings.
      const allNotifications = [
        next.content,
        ...this.messageQueue.drainNotifications(),
      ];
      await this.aiManager.injectTaskNotifications(allNotifications);
      await this.aiManager.sendAIMessage({ recursionDepth: 0 });
    } else {
      await this.sendMessage(next.content, next.images);
    }
  }

  /** Get background bash shell output */
  public getBackgroundShellOutput(
    id: string,
    filter?: string,
  ): {
    stdout: string;
    stderr: string;
    status: string;
    outputPath?: string;
    type: string;
    exitCode?: number;
  } | null {
    return this.backgroundTaskManager.getOutput(id, filter);
  }

  /** Kill background bash shell */
  public killBackgroundShell(id: string): boolean {
    return this.backgroundTaskManager.stopTask(id);
  }

  /** Get background task output */
  public getBackgroundTaskOutput(
    id: string,
    filter?: string,
  ): {
    stdout: string;
    stderr: string;
    status: string;
    outputPath?: string;
    type: string;
    exitCode?: number;
  } | null {
    return this.backgroundTaskManager.getOutput(id, filter);
  }

  /**
   * Every background task this session holds right now — the same set
   * `onBackgroundTasksChange` reports, read instead of pushed.
   *
   * The callback only fires on a *change*, so a reader that attached after the
   * tasks started (the remote page, whose host may have been running for hours)
   * would otherwise see an empty list on `/tasks` until the next task appeared or
   * finished. Reading is the only way to learn what already exists; the hosts do
   * it on their snapshot paths, exactly as they do for the todo list.
   */
  public getBackgroundTasks(): BackgroundTask[] {
    return this.backgroundTaskManager.getAllTasks();
  }

  /** Stop background task */
  public stopBackgroundTask(id: string): boolean {
    return this.backgroundTaskManager.stopTask(id);
  }

  /**
   * Get all workflow runs, shaped for a UI.
   *
   * `result` is cut down to a snippet once it outgrows the completion
   * notification's budget: no interface renders it, while it is 99.7% of the
   * payload and the hosts re-push this list on every progress event (spec
   * `multi-agent/workflow.md`「工作流管理对话框」场景 7). A value that fits is
   * handed over untouched; the full value always stays in `run-state.json` and
   * in the completion notification.
   */
  public async getWorkflowRuns(): Promise<
    import("./workflow/types.js").WorkflowRun[]
  > {
    if (!this.container.has("WorkflowManager")) return [];
    return this.container
      .get<
        import("./managers/workflowManager.js").WorkflowManager
      >("WorkflowManager")!
      .listUiRuns();
  }

  /** Get a specific workflow run by ID, shaped for a UI (see `getWorkflowRuns`) */
  public getWorkflowRun(
    runId: string,
  ): import("./workflow/types.js").WorkflowRun | undefined {
    if (!this.container.has("WorkflowManager")) return undefined;
    return this.container
      .get<
        import("./managers/workflowManager.js").WorkflowManager
      >("WorkflowManager")!
      .getUiRun(runId);
  }

  /**
   * Tail of one agent's activity log — what the workflow detail view tails
   * while that agent runs (spec `multi-agent/workflow.md`「查看单个 agent 的执行详情」).
   *
   * An unknown run, an index that never started or a replayed (cached) agent all
   * answer with an empty tail rather than an error: the panel degrades to "no
   * activity" instead of blanking.
   */
  public getWorkflowAgentActivity(
    runId: string,
    agentIndex: number,
  ): { activity: string } {
    if (!this.container.has("WorkflowManager")) return { activity: "" };
    return this.container
      .get<
        import("./managers/workflowManager.js").WorkflowManager
      >("WorkflowManager")!
      .getAgentActivity(runId, agentIndex);
  }

  /** Stop a workflow run */
  public stopWorkflowRun(runId: string): void {
    if (!this.container.has("WorkflowManager")) return;
    this.container
      .get<
        import("./managers/workflowManager.js").WorkflowManager
      >("WorkflowManager")!
      .stopRun(runId);
  }

  /**
   * Save one of this session's run scripts into the script library, so later
   * sessions (same project, or any project for the `user` scope) can call it
   * with `Workflow({name})`. Saving is a human action only — the model has no
   * save entry point (spec workflow「把脚本存进库并按名字复用」场景 2).
   */
  public async saveWorkflowScript(
    runId: string,
    options: {
      name: string;
      scope: import("./workflow/workflowRegistry.js").WorkflowLibraryScope;
      overwrite?: boolean;
    },
  ): Promise<{ name: string; path: string }> {
    if (!this.container.has("WorkflowManager")) {
      throw new Error("Workflow manager not available");
    }
    return this.container
      .get<
        import("./managers/workflowManager.js").WorkflowManager
      >("WorkflowManager")!
      .saveWorkflowScript(runId, options);
  }

  /**
   * Static async factory method for creating Agent instances
   *
   * IMPORTANT: Keep this method's signature exactly the same as the constructor
   * to maintain consistency and avoid confusion for users of the API.
   *
   * @param options - Same AgentOptions interface used by constructor
   * @returns Promise<Agent> - Fully initialized Agent instance
   */
  /**
   * Create a new Agent instance with async initialization
   *
   * This is the recommended way to create Agent instances. The constructor is private
   * to ensure proper async initialization of all components.
   *
   * @param options - Configuration options for the Agent instance
   * @param options.apiKey - API key for the AI service (or set WAVE_API_KEY env var)
   * @param options.baseURL - Base URL for the AI service (or set WAVE_BASE_URL env var)
   * @param options.defaultHeaders - Optional HTTP headers to pass to the AI service
   * @param options.fetchOptions - Optional fetch options to pass to the AI service
   * @param options.fetch - Optional custom fetch implementation
   * @param options.callbacks - Optional callbacks for various Agent events
   * @param options.restoreSessionId - Optional session ID to restore from
   * @param options.continueLastSession - Whether to continue the last session automatically
   * @param options.logger - Optional custom logger implementation
   * @param options.messages - Optional initial messages for testing convenience
   * @param options.workdir - Working directory (defaults to process.cwd())
   * @param options.systemPrompt - Optional custom system prompt
   * @param options.mcpServers - Optional MCP server configs to connect at startup
   * @returns Promise that resolves to initialized Agent instance
   *
   * @example
   * ```typescript
   * // Basic usage
   * const agent = await Agent.create({
   *   apiKey: 'your-api-key',
   *   baseURL: 'https://api.example.com'
   * });
   * ```
   */
  static async create(options: AgentOptions): Promise<Agent> {
    // Create Agent instance
    const instance = new Agent(options);
    await instance.initialize({
      restoreSessionId: options.restoreSessionId,
      continueLastSession: options.continueLastSession,
      messages: options.messages,
    });
    return instance;
  }

  /**
   * Resolve and validate configuration from constructor args, environment variables,
   * and loaded settings.json.
   *
   * This is called during initialization after settings.json has been loaded.
   */
  private resolveAndValidateConfig(): void {
    // Resolve configuration from constructor args and environment variables (including settings.json)
    const gatewayConfig = this.getGatewayConfig();
    const contextWindow = this.getContextWindow();

    // Validate resolved configuration
    configValidator.validateGatewayConfig(gatewayConfig);
    configValidator.validateContextWindow(contextWindow);
  }

  /** Private initialization method, handles async initialization logic */
  private async initialize(options?: {
    restoreSessionId?: string;
    continueLastSession?: boolean;
    messages?: Message[];
  }): Promise<void> {
    await InitializationService.initialize(
      {
        skillManager: this.skillManager,
        subagentManager: this.subagentManager,
        container: this.container,
        toolManager: this.toolManager,
        pluginManager: this.pluginManager,
        options: this.options,
        slashCommandManager: this.slashCommandManager,
        logger: this.logger,
        mcpManager: this.mcpManager,
        workdir: this.workdir,
        lspManager: this.lspManager,
        configurationService: this.configurationService,
        hookManager: this.hookManager,
        messageManager: this.messageManager,
        memoryRuleManager: this.memoryRuleManager,
        liveConfigManager: this.liveConfigManager,
        taskManager: this.taskManager,
        resolveAndValidateConfig: () => this.resolveAndValidateConfig(),
      },
      options,
    );

    // Freeze the session-level bypass authorization now that settings.json (and
    // thus `permissions.defaultMode`) has been loaded. Later mode switches and
    // config reloads must not change it — it records what the user authorized
    // when the session started.
    this.permissionManager.captureBypassAuthorization();

    // Initialize OpenTelemetry (before the first event is logged, so the
    // providers are in place when the session announces itself)
    const telemetrySettings = this.configurationService.getTelemetrySettings();
    try {
      await initializeTelemetry(telemetrySettings);
    } catch (error) {
      this.logger?.warn("Telemetry initialization failed:", error);
    }

    // Log session_start event
    try {
      const modelConfig = this.getModelConfig();
      const sessionContext = this.telemetryContext;
      if (modelConfig.model) {
        await logOTelEvent(
          "session_start",
          {
            model: modelConfig.model,
            workdir: this.workdir,
          },
          sessionContext,
        ).catch(() => {}); // Non-blocking
      }
      recordSession(sessionContext);
    } catch {
      // Model not configured yet - will be available after SSO login
    }

    // Plugin MODS: compile and instantiate now that InitializationService has
    // discovered the plugins, then give each mod its `session.start` — which is
    // defined as "after init, before the first prompt". Compilation failures are
    // per-mod (a broken mod must not take the session down), so this only logs.
    try {
      await this.modManager.loadFromPlugins(this.pluginManager.getPlugins());
      await this.modManager.startSession();
      // `tool.register`（spec「把我们自己的工具交给模型」）：每个 mod 一次，赶在
      // 第一个请求之前。放在 `session.start` 之后，让在 `session.start` 里直接
      // 调 `$.tool.register` 的 mod 与走这条钩子的两条路都落到同一刻。
      await this.modManager.dispatchToolRegister();
      // 影子事件 `classic.SessionStart`（spec「影子事件」）：自有事件
      // `session.start` 先发、镜像后发。只读，宿主不等。
      this.modManager.notifyMods("classic.SessionStart", { source: "startup" });
      // 开局常驻的指令文件：一份一条 `classic.InstructionsLoaded`（同一节）。
      // 读不到指令文件不该让 mod 层跟着失败，所以单独吞错。
      const memoryService =
        this.container.get<import("./services/memory.js").MemoryService>(
          "MemoryService",
        );
      const instructions =
        (await memoryService?.loadSessionStartInstructions(this.workdir)) ?? [];
      for (const filePath of instructions) {
        this.modManager.notifyMods("classic.InstructionsLoaded", {
          file_path: filePath,
          memory_type: classifyMemoryTier(filePath, this.workdir),
          load_reason: "session_start",
        });
      }
    } catch (error) {
      this.logger?.warn("Plugin mods failed to load:", error);
    }
  }

  /**
   * Restore a session by ID, switching to the target session without destroying the Agent instance
   * @param sessionId - The ID of the session to restore
   * @param options.workdir - The directory the target session lives in. Pass it
   *   when the target was recorded under a different project directory (e.g.
   *   another worktree of the same repo); the session transcript, project rules
   *   and memory are then re-pointed at it.
   */
  public async restoreSession(
    sessionId: string,
    options?: { workdir?: string },
  ): Promise<void> {
    const previousSessionId = this.messageManager.getSessionId();
    await InteractionService.restoreSession(
      this.interactionContext(),
      sessionId,
      options,
    );

    // The agent now points at another session: close whatever the previous one
    // still had open and drop its bucket, so a long-lived agent that hops
    // between sessions does not leave one per session behind.
    if (previousSessionId && previousSessionId !== sessionId) {
      flushSessionActivity(previousSessionId);
    }
  }

  /**
   * Set this session's user-visible title.
   *
   * The title is appended to the session's own JSONL file as a `custom-title`
   * entry (see `setSessionCustomTitle`), so every host that reads session files
   * — this process, a later run, the IDE plugins, the desktop app — shows the
   * same label. A blank title is a no-op.
   */
  public async renameSession(title: string): Promise<void> {
    const applied = await setSessionCustomTitle(
      this.sessionId,
      this.workdir,
      title,
    );
    // Keep the in-memory value in step: it is what gets written back at the
    // next flush point if the entry has since slid out of the tail window.
    if (applied) {
      this.messageManager.setCustomTitle(applied);
    }
  }

  /** Shared wiring for the InteractionService entry points. */
  private interactionContext(): InteractionContext {
    return {
      messageManager: this.messageManager,
      slashCommandManager: this.slashCommandManager,
      hookManager: this.hookManager,
      workdir: this.workdir,
      configurationService: this.configurationService,
      logger: this.logger,
      aiManager: this.aiManager,
      subagentManager: this.subagentManager,
      taskManager: this.taskManager,
      modManager: this.modManager,
      options: this.options,
      abortMessage: () => this.abortMessage(),
      switchWorkdir: (workdir) => this.switchSessionWorkdir(workdir),
    };
  }

  /**
   * Re-point every directory-derived piece of session state at `workdir`
   * (used when restoring a session recorded in another directory).
   *
   * The memory cache needs no explicit clearing: moving to a session always
   * changes the session id, and the resulting `onSessionIdChange` already
   * clears it. Project rules do — they are discovered once at startup and
   * resolved relative to the workdir.
   */
  private async switchSessionWorkdir(workdir: string): Promise<void> {
    this.setCurrentWorkdir(workdir);
    // Restoring a session is a session switch, not the shell moving: the id
    // changes with it, so the telemetry identity follows too (a `cd` in Bash
    // and EnterWorktree leave this alone).
    this.container.register("SessionWorkdir", workdir);
    // The incoming session's workspace starts where that session lives; the
    // outgoing session's worktree (if any) must not leak into it.
    this.container.register("WorkspaceRoot", workdir);
    this.messageManager.setCurrentWorkdir(workdir);
    await this.memoryRuleManager.setWorkdir(workdir);
  }

  public abortAIMessage(): void {
    this.aiManager.abortAIMessage();
  }

  /** Execute a bash-mode command (`!command`) */
  public async bang(command: string): Promise<void> {
    this.assertNotDestroyed();

    // If the agent is busy, enqueue the bang command
    if (this.aiManager.isLoading || this.isCommandRunning) {
      this.messageQueue.enqueue({ type: "bang", content: command });
      this.options.callbacks?.onQueuedMessagesChange?.(this.queuedMessages);
      return;
    }

    await this.bashModeManager?.executeCommand(command);
    await this.messageManager.saveSession();
  }

  public async clearMessages(): Promise<void> {
    // Aligned with webview (ChatApp handleClearChat): /clear is ignored
    // while the agent is running, instead of aborting the AI mid-turn
    // (which used to inject a late "Request was aborted" error into the
    // newly cleared session).
    if (this.aiManager.isLoading) {
      return;
    }

    this.aiManager.abortAIMessage();
    // 侧聊段的冻结前缀指向的是这场对话：对话被清空，段也就作废了（在途的那一轮
    // 一并中止）。
    this.aiManager.releaseAllBtwSegments();
    // The REPL context belongs to this conversation: clearing it means the variables,
    // the timers and any background script go with it. Released *before* the session
    // id is replaced, because that id is the key the context is filed under.
    this.aiManager.releaseReplContext();

    // Capture old session info before clearing
    const oldSessionId = this.messageManager.getSessionId();
    const transcriptPath = this.messageManager.getTranscriptPath();

    // Run SessionEnd hooks (cleanup before clear)
    try {
      await this.hookManager.executeSessionEndHooks(
        "clear",
        oldSessionId,
        transcriptPath,
      );
    } catch (error) {
      this.logger?.warn(
        `SessionEnd hooks on clear failed: ${(error as Error).message}`,
      );
    }
    // 影子事件 `classic.SessionEnd`（spec「影子事件」）：`/clear` 结束掉当前这
    // 场对话。必须在这里发 —— 下面的 `clearMessages()` 会换掉 session id，镜像
    // 报的应该是被结束的那一场。
    this.modManager.notifyMods("classic.SessionEnd", { reason: "clear" });

    // Clear messages and generate new session
    this.messageManager.clearMessages();
    await this.taskManager.syncWithSession();

    // Run SessionStart hooks (restore context for new session)
    try {
      const newSessionId = this.messageManager.getSessionId();
      const sessionStartResult =
        await this.hookManager.executeSessionStartHooks(
          "clear",
          newSessionId,
          this.messageManager.getTranscriptPath(),
          this.messageManager,
        );

      // Inject additionalContext as a meta user message
      if (sessionStartResult.additionalContext) {
        // `prompt.attachment` 的 `session-start` 档（spec ecosystem/plugin-mods.md
        // 「系统提示词与附件」）：`/clear` 之后插件还活着，所以这条要过一遍钩子。
        const sessionStartText = await this.modManager.rewritePromptAttachment({
          type: "session-start",
          text: `SessionStart hook additional context: ${sessionStartResult.additionalContext}`,
        });
        // `/clear` emptied the list, so this always lands — the call is the
        // same shape as the other three sources on purpose (no per-source
        // special case).
        if (sessionStartText !== null) {
          this.messageManager.addMetaMessageIfAbsent(
            wrapInSystemReminder(sessionStartText),
          );
        }
      }

      // Inject initialUserMessage as a meta user message
      if (sessionStartResult.initialUserMessage) {
        this.messageManager.addUserMessage({
          content: sessionStartResult.initialUserMessage,
          isMeta: true,
        });
      }
    } catch (error) {
      this.logger?.warn(
        `SessionStart hooks on clear failed: ${(error as Error).message}`,
      );
    }

    // 影子事件 `classic.SessionStart`（spec「影子事件」）：清空之后这场对话算
    // 重新开局，`source` 就是 `clear`。放在这里而不是 `startSession` 里 —— 那
    // 条路只在会话创建时走一次。
    this.modManager.notifyMods("classic.SessionStart", { source: "clear" });

    await this.messageManager.saveSession();
  }

  /**
   * Compact conversation history to reduce context usage
   * @param customInstructions - Optional custom instructions for compaction
   */
  public async compact(customInstructions?: string): Promise<void> {
    // Aligned with webview: /compact is ignored while the agent is running,
    // instead of aborting the AI mid-turn before compacting.
    if (this.aiManager.isLoading) {
      return;
    }

    this.aiManager.abortAIMessage();

    await this.aiManager.compactConversation({
      customInstructions,
    });

    await this.messageManager.saveSession();
  }

  /**
   * Unified interrupt method: aborts the running turn (AI, bash, slash command)
   * and nothing else.
   *
   * Queued user input survives an interrupt (spec
   * `core/agent-lifecycle.md`「中断只中止当前轮」, matching Claude Code: Esc while
   * streaming keeps the queue and drains it right after). The tail of this
   * method resumes that queue — `isAborting` swallowed the dispatch that
   * `abortAIMessage` → `setIsLoading(false)` would otherwise have triggered.
   *
   * @param options.clearQueue - Also drop the queued user input. Only for a
   * caller that is replacing the conversation itself (VS Code `clearChat` /
   * `restoreSession` / `updateConfig`, desktop config rebuild) — a plain Stop
   * never sets it, because those items were typed into a conversation that
   * still exists.
   * @param options.resumeQueue - Whether to keep going with the queue right
   * after the interrupt (default `true`). "Send now" passes `false`: it sends
   * the picked message itself, and a resume here would let the *next* queued
   * item start a turn first, pushing the picked one to the tail.
   */
  public abortMessage(options?: {
    clearQueue?: boolean;
    resumeQueue?: boolean;
  }): void {
    const clearQueue = options?.clearQueue ?? false;
    const resumeQueue = options?.resumeQueue ?? true;
    // Guard: prevent tryDispatch (triggered by abortAIMessage → setIsLoading(false))
    // from dispatching the queue in the middle of the interrupt.
    this.isAborting = true;
    try {
      if (this.dispatchPromise) {
        // This dispatch unwinds after the interrupt: remember it so its
        // .finally re-check resumes user input without turning a pending
        // notification into a fresh turn.
        this.abortedDispatchPending = true;
      }
      if (clearQueue && (this.aiManager.isLoading || this.isCommandRunning)) {
        // Clearing first prevents processQueuedMessage from dequeuing when
        // abortAIMessage triggers onLoadingChange(false). Notifications are
        // preserved so background task results aren't lost.
        this.messageQueue.clear();
        this.options.callbacks?.onQueuedMessagesChange?.(this.queuedMessages);
      }
      this.messageQueue.transitionTo("idle"); // Reset state on abort
      this.abortAIMessage(); // This will abort tools including Agent tool (subagents)
      this.abortBashCommand();
      this.abortSlashCommand();
    } finally {
      this.isAborting = false;
    }

    // Keep going with the queue, but only for user input: an interrupt must not
    // turn a pending background-task notification into a fresh AI turn of its
    // own — a notification waits for the next real input.
    if (resumeQueue && this.hasPendingUserInput()) {
      this.tryDispatch();
    }
  }

  /** Whether the queue holds user input (message / bang) as opposed to only background-task notifications. */
  private hasPendingUserInput(): boolean {
    return this.messageQueue.getQueue().some((m) => m.type !== "notification");
  }

  /** Interrupt bash command execution */
  public abortBashCommand(): void {
    this.bashModeManager?.abortCommand();
  }

  /** Interrupt slash command execution */
  public abortSlashCommand(): void {
    this.slashCommandManager.abortCurrentCommand();
  }

  /**
   * Register a foreground task that can be backgrounded
   */
  public registerForegroundTask(task: ForegroundTask): void {
    this.foregroundTaskManager.registerForegroundTask(task);
  }

  /**
   * Unregister a foreground task
   */
  public unregisterForegroundTask(id: string): void {
    this.foregroundTaskManager.unregisterForegroundTask(id);
  }

  /**
   * Background the current foreground task
   */
  public async backgroundCurrentTask(): Promise<void> {
    await this.foregroundTaskManager.backgroundCurrentTask();
    this.options.callbacks?.onBackgroundCurrentTask?.();
  }

  /**
   * Wait for an in-flight auto-memory extraction, with a soft budget.
   *
   * Opt-in, and only for a caller that is about to exit the process: `--print`
   * drains once before `destroy()` so the last turn's memories survive. Asks
   * the fork to settle up to `timeoutMs` (default 60s); past that it gives up
   * and the caller carries on, because a model request must never hold an exit
   * hostage. Every exit path whose process keeps living — the interactive CLI,
   * the daemon, the desktop host, `--stdio` — skips this: the fork finishes on
   * its own and `destroy()` does not wait.
   */
  public async drainAutoMemory(
    timeoutMs: number = AUTO_MEMORY_DRAIN_TIMEOUT_MS,
  ): Promise<void> {
    const autoMemoryService =
      this.container.get<
        import("./services/autoMemoryService.js").AutoMemoryService
      >("AutoMemoryService");
    if (!autoMemoryService) return;
    await autoMemoryService.drain(timeoutMs);
  }

  /** Destroy managers, clean up resources */
  public async destroy(): Promise<void> {
    // Terminal guard: suppress any dispatch triggered during teardown (e.g. the
    // onLoadingChange(false) fired by abortAIMessage() below, or the dispatch
    // .finally re-check). Without this, leftover queued messages would be
    // dispatched fire-and-forget and outlive the agent. Never reset: destroy()
    // is terminal, no dispatch should ever start afterwards.
    this.isDestroyed = true;

    // The agent's REPL context dies with it: its variables, its timers and any
    // script still running in the background. This is also the path a subagent's
    // context takes, which is what the "a subagent gets its own context, released
    // when it ends" rule rests on.
    this.aiManager.releaseReplContext();

    // Log session_end event and flush telemetry. Only a flush: the providers are
    // process-scoped, and tearing them down here would silence the other agents
    // sharing this process (the daemon hosts every session at once).
    await logOTelEvent(
      "session_end",
      {
        duration: String(
          Math.round((Date.now() - this.sessionStartTime) / 1000),
        ),
        totalTokens: String(this.messageManager.getLatestTotalTokens()),
        exitReason: "destroy",
      },
      this.telemetryContext,
    ).catch(() => {});

    // Record whatever active time is still open for this session before its
    // metrics are flushed, and drop its activity state so a resident daemon
    // does not accumulate one bucket per session ever opened.
    flushSessionActivity(this.messageManager.getSessionId());
    await flushTelemetry();

    // Clear message queue callback first to prevent any late triggers from
    // starting async work during teardown
    this.messageQueue.onMessageEnqueued = undefined;

    // Await any pending dispatch to prevent race conditions
    // with test teardown (e.g., V8 coverage stream cleanup)
    if (this.dispatchPromise) {
      await this.dispatchPromise.catch(() => {});
    }

    // Fire SessionEnd hooks (fire-and-forget, don't block shutdown)
    try {
      const sessionId = this.messageManager.getSessionId();
      const transcriptPath = this.messageManager.getTranscriptPath();
      await this.hookManager.executeSessionEndHooks(
        "stop",
        sessionId,
        transcriptPath,
      );
    } catch (error) {
      this.logger?.warn(`SessionEnd hooks failed: ${(error as Error).message}`);
    }

    // Flush the transcript, but never let a failed flush abort the teardown:
    // the callers (desktop host, AgentBridge, IM bridge) drop their own
    // reference to this Agent before/as they call destroy(), so anything beyond
    // this point that throws leaves a live Agent — and its MCP process tree —
    // unreachable, to be reaped only by process exit (issue #2758). Spec
    // ecosystem/mcp.md 边界情况「销毁必须先于引用丢弃、且回收不得被前置失败阻断」.
    try {
      await this.messageManager.saveSession();
      // Flush point: the transcript is about to be left behind for other
      // processes to list, so re-append the metadata entries at EOF. Must come
      // after saveSession (which returns early when nothing is unsaved).
      await this.messageManager.reAppendSessionMetadata();
    } catch (error) {
      this.logger?.warn(
        `Session transcript flush failed during destroy (teardown continues): ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
    this.abortAIMessage(); // This will abort tools including Agent tool (subagents)
    // 插件 mod 的面板与定时器：会话已经结束，先把定时器停掉并关面板 —— 留到
    // 后面会有回调打到半销毁的 agent 上（spec ecosystem/plugin-mods.md「定时器」）。
    // `session.end` 是唯一一个 mod **会被等**的事件（「轮次内外的事件」），要在
    // 实例被丢掉之前派发；它自带 5 秒钩子上限，卡住也不会挡住销毁。
    await this.modManager.endSession();
    // 影子事件 `classic.SessionEnd`（spec「影子事件」）：`session.end` 之后、实
    // 例被丢掉之前。`dispose` 之后一律静默，所以必须在这里。
    this.modManager.notifyMods("classic.SessionEnd", {
      reason: "prompt_input_exit",
    });
    await this.modManager.dispose();
    // 侧聊段依附于这场对话：销毁时一并丢弃，在途的那一轮随之中止（否则它会带着
    // 网络句柄活过 destroy）。
    this.aiManager.releaseAllBtwSegments();
    this.abortBashCommand();
    this.abortSlashCommand();
    this.cronManager.stop();
    // Cleanup background task manager
    this.backgroundTaskManager.cleanup();
    // 会话销毁即回收：shell 退出时只入账、不动手（`nohup npm run dev &` 是正当
    // 用法），真正终止发生在这里 —— SIGTERM 一组一组发，宽限期后补 SIGKILL，
    // 见 spec core/bash-tools.md「shell 退出后留下的进程组」。
    // 将来若要对某类命令「退出时即放手」（CC 的 `atExit: "leave"`），出口在这个
    // 调用点：入账时带标记、这里跳过，而不是在 exit 钩子里分流。
    this.shellProcessReaper.reap();
    // Cleanup MCP connections
    await this.mcpManager.cleanup();
    // Cleanup LSP connections
    if (this.lspManager instanceof LspManager) {
      await this.lspManager.cleanup();
    }
    // Cleanup subagent manager
    this.subagentManager.cleanup();
    // No drain of the auto-memory extraction fork here: destroy() is called by
    // hosts that keep running (interactive CLI, daemon, desktop, --stdio) as
    // well as by ones about to exit, and a model request has no bound worth
    // putting on a teardown. A caller that is exiting and would lose the last
    // turn's memories calls `drainAutoMemory()` *before* destroy — that is what
    // `--print` does.

    // Cleanup skill manager
    await this.skillManager.destroy();
    // Cleanup live configuration reload
    try {
      await this.liveConfigManager.shutdown();
    } catch (error) {
      this.logger?.error(
        "Error shutting down live configuration reload:",
        error,
      );
    }
    // Cleanup remote settings polling
    remoteSettingsService.shutdown();
    // Drain live async work (dispatch, background subagents, fork subagents):
    // abort steps above make them settle; wait for them so no async side
    // effect outlives the agent. Timeout fallback keeps destroy bounded.
    const drained = await this.asyncWorkRegistry.drain();
    if (!drained) {
      this.logger?.error(
        `Async work did not drain: ${this.asyncWorkRegistry.size} live work item(s) remain after destroy`,
      );
    }

    // Unregister module-level listeners (remote settings hot-update, auth
    // change) so the agent's object graph becomes collectable. Without this,
    // the module-level callback arrays pin every created agent via the
    // per-agent closure contexts, even after the host drops its references.
    this.teardown();
    // Drop the reaper too: it holds an entry in the module-level exit-sweep set,
    // and a daemon must not accumulate one stranded ledger per session ever
    // opened. Entries are already gone (reap() above), so this only unlinks.
    this.shellProcessReaper.dispose();
    // Break the DI container's internal references (services/factories) so no
    // per-agent manager is retained through it after destroy.
    this.container.clear();
  }

  /**
   * Trigger the rewind UI callback
   */
  public triggerShowRewind(): void {
    this.messageManager.triggerShowRewind();
  }

  /**
   * Ask a side question without interrupting the main agent.
   *
   * Runs a single-turn fork of the conversation that reuses the main loop's
   * system prompt, tools, and memory injection (prompt-cache friendly) and
   * never executes tools. The abort signal lets the UI cancel a pending
   * question (loading dismiss); aborts propagate as thrown errors.
   *
   * @param question - The side question to ask
   * @param abortSignal - Optional signal to abort the pending request
   * @param history - Earlier side-chat turns (follow-up questions); see
   *   `BtwHistoryTurn`. Appended after the main-conversation prefix so the
   *   prompt cache still matches.
   * @param segmentId - Names one side-chat segment: the parent-conversation
   *   prefix is captured on that segment's first question and reused for the
   *   rest of it (spec commands/btw-command.md「侧聊分段与上下文冻结」). Omit it
   *   for the CLI's single-turn overlay.
   * @returns Promise that resolves to the AI's answer
   */
  public async askBtw(
    question: string,
    abortSignal?: AbortSignal,
    onContent?: (content: string) => void,
    onReasoning?: (content: string) => void,
    history?: BtwHistoryTurn[],
    segmentId?: string,
  ): Promise<string> {
    this.assertNotDestroyed();
    const result = await this.aiManager.runBtwFork(
      question,
      abortSignal,
      onContent,
      onReasoning,
      history,
      segmentId,
    );
    return result.content ?? result.error ?? "No response received";
  }

  /**
   * Discard one side-chat segment: release its frozen parent-conversation prefix and abort
   * the question that is still in flight (spec commands/btw-command.md「侧聊
   * 分段与上下文冻结」场景 6: 关闭即丢弃). A later ask with the same id would
   * fork a fresh prefix — the UI starts a new segment instead.
   */
  public closeBtw(segmentId: string): void {
    this.aiManager.releaseBtwSegment(segmentId);
  }

  /**
   * Send a message to the AI agent with optional images
   *
   * @param content - The text content of the message to send
   * @param images - Optional array of images to include with the message
   * @param images[].path - File path to the image or base64 encoded image data
   * @param images[].mimeType - MIME type of the image (e.g., 'image/png', 'image/jpeg')
   * @returns Promise that resolves when the message has been processed
   *
   * @example
   * ```typescript
   * // Send a text message
   * await agent.sendMessage("Hello, how are you?");
   *
   * // Send a message with images using file paths
   * await agent.sendMessage("What do you see in these images?", [
   *   { path: "/path/to/image.png", mimeType: "image/png" },
   *   { path: "/path/to/photo.jpg", mimeType: "image/jpeg" }
   * ]);
   *
   * // Send a message with base64 encoded image
   * await agent.sendMessage("Analyze this image", [
   *   { path: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAA...", mimeType: "image/png" }
   * ]);
   * ```
   */
  public async sendMessage(
    content: string,
    images?: UserImage[],
  ): Promise<void> {
    this.assertNotDestroyed();

    // A message is the user's interaction with this session — the SDK-level
    // equivalent of typing at the prompt. Recorded before the busy check so a
    // queued message counts too; consecutive messages under five seconds apart
    // are what `wave.active_time{type=user}` measures.
    recordUserActivity(this.telemetryContext);

    // If the agent is busy, enqueue the message — unless it's an immediate
    // slash command (e.g., /clear, /compact) that should execute
    // right away even while AI is processing
    if (this.aiManager.isLoading || this.isCommandRunning) {
      const trimmed = content.trim();
      const isImmediate =
        trimmed.startsWith("/") &&
        trimmed !== "/" &&
        this.slashCommandManager.isImmediateCommand(trimmed);

      if (!isImmediate) {
        this.messageQueue.enqueue({
          content,
          images,
        });
        this.options.callbacks?.onQueuedMessagesChange?.(this.queuedMessages);
        return;
      }
      // Immediate slash command: fall through to InteractionService
    }

    await InteractionService.sendMessage(
      this.interactionContext(),
      content,
      images,
    );
  }

  // ========== Additional Directories ==========

  /**
   * Add an additional directory to the Safe Zone for this session.
   *
   * The directory immediately becomes part of the Safe Zone (permission
   * checks and the system prompt), and with `remember: true` it is also
   * persisted to `.wave/settings.local.json` `permissions.additionalDirectories`
   * so future sessions pick it up automatically.
   *
   * @param directory Path of the directory to add (relative paths resolve against the workdir).
   * @param options.remember Whether to persist the directory across sessions.
   */
  public async addAdditionalDirectory(
    directory: string,
    options?: { remember?: boolean },
  ): Promise<void> {
    const resolvedPath = path.isAbsolute(directory)
      ? directory
      : path.resolve(this.workdir, directory);
    this.permissionManager.addInstanceAdditionalDirectory(resolvedPath);
    if (options?.remember) {
      await this.configurationService.addAdditionalDirectory(
        this.workdir,
        resolvedPath,
      );
    }
  }

  /**
   * Get the effective additional directories for this session (config +
   * session-level union), matching what is listed in the system prompt.
   */
  public getAdditionalDirectories(): string[] {
    return this.permissionManager.getEffectiveAdditionalDirectories();
  }

  // ========== MCP Management Methods ==========

  /** Get all MCP server status */
  public getMcpServers(): McpServerStatus[] {
    return this.mcpManager.getAllServers();
  }

  /**
   * Connect MCP server (a user action — the only path allowed to override a
   * previous explicit disconnect; see `McpManager.connectServer`).
   */
  public async connectMcpServer(serverName: string): Promise<boolean> {
    return await this.mcpManager.connectServer(serverName, true);
  }

  /** Disconnect MCP server */
  public async disconnectMcpServer(serverName: string): Promise<boolean> {
    return await this.mcpManager.disconnectServer(serverName);
  }

  /**
   * Remove an MCP server from a persisted config file (user ~/.wave/mcp.json
   * or project <workdir>/.mcp.json), then disconnect and drop it from memory.
   */
  public async removeMcpServer(
    scope: "user" | "project",
    serverName: string,
  ): Promise<boolean> {
    return await this.mcpManager.removeServerFromConfig(scope, serverName);
  }

  /** The user-level MCP config path (~/.wave/mcp.json) */
  public getUserMcpConfigPath(): string {
    return this.mcpManager.getUserConfigPath();
  }

  /** The project-level MCP config path (<workdir>/.mcp.json) */
  public getProjectMcpConfigPath(): string {
    return this.mcpManager.getProjectConfigPath();
  }

  // ========== Slash Command Management Methods ==========

  /**
   * Get all available slash commands.
   *
   * Async because `command.describe` runs on every draw and its answer has to be
   * in hand before the list is handed out (spec「给工具、技能、命令写描述」).
   */
  public async getSlashCommands(): Promise<SlashCommand[]> {
    return this.slashCommandManager.getCommands();
  }

  /** Check if slash command exists */
  public hasSlashCommand(commandId: string): boolean {
    return this.slashCommandManager.hasCommand(commandId);
  }

  /** Reload custom commands */
  public async reloadCustomCommands(): Promise<void> {
    await this.skillManager.initialize();
    this.slashCommandManager.reloadCustomCommands();
    this.slashCommandManager.registerSkillCommands(
      this.skillManager.getAvailableSkills(),
    );
  }

  /** Get custom command details */
  public getCustomCommand(commandId: string): CustomSlashCommand | undefined {
    return this.slashCommandManager.getCustomCommand(commandId);
  }

  /** Get all custom commands */
  public getCustomCommands(): CustomSlashCommand[] {
    return this.slashCommandManager.getCustomCommands();
  }

  /**
   * Register a custom slash command
   */
  public registerSlashCommand(command: SlashCommand): void {
    this.slashCommandManager.registerCommand(command);
  }

  /**
   * Get the current permission mode
   */
  public getPermissionMode(): PermissionMode {
    return this.toolManager.getPermissionMode();
  }

  /**
   * Get the names of tools currently visible to the AI model (filtered by
   * permission mode, denied rules, etc.)
   */
  public getAvailableToolNames(): string[] {
    return this.toolManager.getToolsConfig().map((t) => t.function.name);
  }

  /**
   * 这一刻有谁在看这条会话（spec `core/session-consumers.md`）。
   *
   * 基础集在创建时由入口推导，附加集由持有 relay 的那一层上报；两者是并集。
   */
  public sessionConsumers(): readonly SessionConsumerKind[] {
    return this.sessionConsumersState.current();
  }

  /**
   * 覆盖"附加消费者"——运行期挂上来、也会走掉的那些（本期只有 `remote-page`）。
   *
   * 上报方报"这一刻谁挂在上面"，不报差分；没变化时不触发回调。
   */
  public setAttachedConsumers(kinds: readonly string[]): void {
    const valid = kinds.filter(isSessionConsumerKind);
    if (this.sessionConsumersState.setAttached(valid)) {
      this.options.callbacks?.onSessionConsumersChange?.(
        this.sessionConsumers(),
      );
    }
  }

  private get sessionConsumersState(): SessionConsumers {
    return this.container.get<SessionConsumers>("SessionConsumers")!;
  }

  /**
   * Set the permission mode
   * @param mode - The new permission mode
   */
  public setPermissionMode(mode: PermissionMode): void {
    this.logger?.debug("Setting permission mode", { mode });
    this.toolManager.setPermissionMode(mode);

    this.planManager.handlePlanModeTransition(mode);

    this.options.callbacks?.onPermissionModeChange?.(mode);
  }

  /**
   * Truncate history to a specific index and revert file changes.
   * @param index - The index of the user message to truncate to.
   */
  public async truncateHistory(index: number): Promise<void> {
    await this.messageManager.truncateHistory(index, this.reversionManager);
    // After truncating history, the task list might have changed, so refresh it.
    // We explicitly load tasks and trigger the callback to ensure UI updates immediately and in order.
    const tasks = await this.taskManager.listTasks();
    this.options.callbacks?.onTasksChange?.(tasks);
  }

  /**
   * Get the full message thread including parent sessions
   */
  public async getFullMessageThread(): Promise<{
    messages: Message[];
    sessionIds: string[];
  }> {
    return this.messageManager.getFullMessageThread();
  }

  /**
   * 导出当前会话的完整转录（`/export` 的 SDK 半边，spec
   * commands/export-command.md）：整条线程 + 供命令反馈用的统计。
   *
   * 与 `getFullMessageThread()` 的差别是读不到时的态度——那个把「文件没了」
   * 返回成空数组，导出要能对用户说清是「转录已被清理」还是「读失败」。
   * 渲染成文字由宿主做（CLI 用 Ink 组件渲染再剥 ANSI，与 Claude Code 同路）。
   */
  public async exportTranscript(): Promise<TranscriptExport> {
    const { loadTranscriptForExport } = await import(
      "./services/transcriptExport.js"
    );
    return loadTranscriptForExport(this.sessionFilePath);
  }

  /**
   * `/rewind` 的检查点表（`{id, content, index}`）：扫转录当场投影，不留整份
   * 线程。`index` 与 `truncateHistory(index)` 的下标同义。
   */
  public getRewindCheckpoints(): Promise<RewindCheckpoint[]> {
    return this.messageManager.getRewindCheckpoints();
  }

  /** 按 id 找回滚目标（位置 + 文本），供「回滚到这条消息」用。 */
  public findRewindTarget(
    messageId: string,
  ): Promise<{ index: number; content: string } | undefined> {
    return this.messageManager.findRewindTarget(messageId);
  }

  /**
   * Answer a `getMessages` request: the whole list, or (`since` / `before` /
   * `limit`) one page of it. Older pages come from the transcript and are never
   * retained here — the in-memory list stays at the last compaction.
   */
  public getMessagePage(window: MessageWindow): Promise<MessageWindowResult> {
    return this.messageManager.getMessagePage(window);
  }

  /** Totals for the session list (the list starts at the last compaction). */
  public getThreadSummary(): {
    messageCount: number;
    firstUserText?: string;
    lastActiveAt?: string;
  } {
    return this.messageManager.getThreadSummary();
  }

  /**
   * Get the current plan file path (for testing and UI)
   */
  public getPlanFilePath(): string | undefined {
    return this.permissionManager.getPlanFilePath();
  }

  /**
   * Resolve once the plan file path has been generated and set after entering
   * plan mode. Resolves `undefined` when no generation is in flight.
   * Used by the CLI /plan command and the stdio getPlanFile RPC to avoid
   * querying the model before the path is known (the plan mode reminder needs
   * the path to be set).
   */
  public awaitPlanFilePath(): Promise<string | undefined> {
    return this.planManager.awaitPlanFilePath();
  }

  /**
   * Get all currently allowed rules (user-defined and default)
   */
  public getAllowedRules(): string[] {
    return [
      ...this.permissionManager.getAllowedRules(),
      ...this.permissionManager.getDefaultAllowedRules(),
    ];
  }

  /**
   * Get only user-defined allowed rules
   */
  public getUserAllowedRules(): string[] {
    return this.permissionManager.getAllowedRules();
  }

  /**
   * Check permission for a tool call (for testing)
   */
  public async checkPermission(
    context: import("./types/permissions.js").ToolPermissionContext,
  ): Promise<import("./types/permissions.js").PermissionDecision> {
    return this.permissionManager.checkPermission(context);
  }

  /**
   * Add a persistent permission rule
   * @param rule - The rule to add (e.g., "Bash(ls)")
   */
  public async addPermissionRule(rule: string): Promise<void> {
    await this.permissionManager.addPermissionRule(rule);
  }

  /**
   * Get subagent instance by ID
   * @param subagentId - The ID of the subagent instance
   * @returns The subagent instance or null if not found
   */
  public getSubagentInstance(
    subagentId: string,
  ): import("./managers/subagentManager.js").SubagentInstance | null {
    return this.subagentManager.getInstance(subagentId);
  }

  /**
   * Get all subagent configurations visible in this session (built-in,
   * user, project, and plugin agents).
   * @returns The list of subagent configurations
   */
  public getSubagentConfigurations(): import("./utils/subagentParser.js").SubagentConfiguration[] {
    return this.subagentManager.getConfigurations();
  }

  /**
   * Get all skill metadata visible in this session (builtin, personal,
   * project, and plugin skills).
   * @returns The list of skill metadata
   */
  public getSkillMetadata(): SkillMetadata[] {
    return this.skillManager.getAvailableSkills();
  }

  /**
   * Delete a user/personal or project skill by removing its directory.
   * Builtin and plugin skills are read-only and cannot be deleted.
   * @param name - The skill name as shown in skill metadata
   * @returns true if the skill was deleted
   */
  public async deleteSkill(name: string): Promise<boolean> {
    return await this.skillManager.deleteSkill(name);
  }

  /**
   * Delete a user-level or project-level subagent by removing its markdown
   * file. Builtin and plugin agents are read-only and cannot be deleted.
   * @param name - The subagent name as shown in configurations
   * @returns true if the subagent was deleted
   */
  public async deleteSubagent(name: string): Promise<boolean> {
    return await this.subagentManager.deleteSubagent(name);
  }

  /**
   * Get hook configurations at a specific scope (user or project settings.json;
   * plugin hooks come from the hook manager's plugin-registered set).
   */
  public async getHooksByScope(
    scope: "user" | "project" | "plugin",
  ): Promise<Partial<Record<HookEvent, HookEventConfig[]>>> {
    if (scope === "plugin") {
      return this.hookManager.getPluginHooks();
    }
    return await this.configurationService.getHooksByScope(this.workdir, scope);
  }

  /**
   * Absolute path of the settings.json holding hooks at `scope` — user
   * `~/.wave/settings.json` or project `<workdir>/.wave/settings.json`. Hosts
   * pass it to the GUI so editors / file panels can open the file (they cannot
   * expand `~`).
   */
  public getHookConfigPath(scope: "user" | "project"): string {
    return this.configurationService.getHookConfigPath(this.workdir, scope);
  }

  /**
   * Delete a hook at a specific scope, identified by hookName of the form
   * `Event:Matcher`.
   */
  public async deleteHook(
    scope: "user" | "project",
    hookName: string,
  ): Promise<void> {
    await this.configurationService.deleteHook(this.workdir, scope, hookName);
  }

  /**
   * Get currently active subagent instances (status active/initializing).
   * @returns The list of active subagent instances
   */
  public getActiveSubagentInstances(): import("./managers/subagentManager.js").SubagentInstance[] {
    return this.subagentManager.getActiveInstances();
  }

  /**
   * Get the current task list ID
   */
  public get taskListId(): string {
    return this.taskManager.getTaskListId();
  }

  /**
   * Check if there are any running background tasks or active subagents
   */
  public get hasRunningBackgroundWork(): boolean {
    const runningTasks = this.backgroundTaskManager
      .getAllTasks()
      .some((t) => t.status === "running");
    const activeSubagents =
      this.subagentManager.getActiveInstances().length > 0;
    return runningTasks || activeSubagents;
  }

  /**
   * Check if there are pending items (messages, bang commands, or background
   * task notifications) in the message queue. Background task completion
   * notifications are enqueued before the main agent's dispatch consumes them,
   * so callers waiting for the agent to fully settle must also wait on this.
   */
  public get hasPendingMessages(): boolean {
    return this.messageQueue.hasPending();
  }
}
