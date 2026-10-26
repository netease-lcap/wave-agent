/**
 * StdioAgent — host-side typed wrapper around a JSON-RPC client that mirrors
 * the Agent API (shared by the VS Code extension and the desktop app).
 *
 * In the single-shared-process architecture, all sessions share one transport
 * client. The NotificationRouter dispatches incoming notifications to the
 * appropriate StdioAgent via `handleNotification()`. The agent no longer
 * subscribes directly to the client.
 *
 * All session-scoped requests carry `this.sessionId` on the JSON-RPC envelope
 * so the server can route them to the right Agent.
 *
 * `destroy()` only unregisters from the router and sends the destroy request;
 * it does NOT dispose the shared client.
 *
 * The client dependency is the structural `RpcClient` surface (request/notify/
 * onNotification) so both hosts keep their own transports: vscode's
 * `StdioClient` (spawn + hostLog) and desktop's `JsonRpcClient` subclasses
 * (StdioClient / SocketClient).
 */

import type {
  Message,
  Task,
  BackgroundTaskSummary,
  SerializableWorkflowRun,
  QueuedMessage,
  McpServerStatus,
  PermissionMode,
  PermissionDecision,
  ToolPermissionContext,
  ToolBlockUpdateCallbackParams,
  SlashCommandInfo,
  HostSurface,
  McpServerConfig,
  SubagentConfiguration,
  SkillMetadata,
  RemoteControlSnapshot,
  ConfiguredModel,
  ServerNotificationMethod,
  CompletionSnippet,
  NextEditExcerpt,
  NextEditHistoryEntry,
  NextEditRegion,
  NextEditSuggestion,
  MessageWindow,
  MessageWindowResult,
  MessageThreadSummary,
} from "../types/index.js";
import type { RpcClient } from "./rpcClient.js";
import type { NotificationRouter } from "./notificationRouter.js";
import type { HostEntrypoint } from "../constants/telemetry.js";

// ── Params / Results ─────────────────────────────────────────────

export interface InitializeParams {
  workdir?: string;
  restoreSessionId?: string;
  apiKey?: string;
  baseURL?: string;
  serverUrl?: string;
  defaultHeaders?: Record<string, string>;
  model?: string;
  fastModel?: string;
  permissionMode?: PermissionMode;
  tools?: string[];
  allowedTools?: string[];
  disallowedTools?: string[];
  pluginDirs?: string[];
  mcpServers?: Record<string, McpServerConfig>;
  worktreeName?: string;
  isNewWorktree?: boolean;
  /**
   * Which host this session belongs to → the `app.entrypoint` attribute
   * (docs/specs/enterprise/opentelemetry.md「宿主入口标识」). Declared by the
   * host that spawns this process; omitted, records simply carry no entrypoint.
   */
  entrypoint?: HostEntrypoint;
}

export interface InitializeResult {
  sessionId: string;
  /**
   * Where the session is *now*. A re-attached session that bash-`cd`'d inside a
   * turn reports the drifted directory here — correct for "the directory the
   * user is looking at", wrong for anything that means "this conversation's
   * project" (use `sessionCwd` for that).
   */
  currentWorkdir: string;
  /**
   * The session's stable root: the cwd it was created in (the worktree path for
   * a worktree session). Set on every reply; hosts must prefer it over
   * `currentWorkdir` whenever the value keys something durable (session
   * grouping, project-scoped config, `@file` scope) — see StdioAgent.sessionCwd.
   */
  sessionCwd?: string;
  /**
   * The main repository root, present only when `sessionCwd` is itself a linked
   * git worktree — the same derivation `listDaemonSessions` reports per row. A
   * worktree conversation belongs to the repo it was forked from, so this wins
   * over `sessionCwd` as a grouping key.
   */
  repoRoot?: string;
  permissionMode: PermissionMode;
  latestTotalTokens: number;
}

/**
 * Session-level overrides only. 用户偏好（语言 / 上下文长度 / 自动记忆开关与频率）
 * **不得**经本层下发——它们写用户级 `~/.wave/settings.json` 并由实时重载生效；
 * 覆盖层优先级高于 settings.json，会把实时值永久遮蔽（docs/specs/core/agent-config.md
 * 「分层职责」）。
 */
export interface UpdateConfigParams {
  apiKey?: string;
  baseURL?: string;
  serverUrl?: string;
  defaultHeaders?: Record<string, string>;
  model?: string;
  fastModel?: string;
}

// ── Callbacks (mirror AgentCallbacks) ────────────────────────────

export interface StdioAgentCallbacks {
  onUserMessageAdded?: (message: Message) => void;
  onAssistantMessageAdded?: (message: Message) => void;
  /**
   * A message the host already rendered must be dropped from its view: the
   * streamed attempt it came from failed mid-body and was re-issued without
   * streaming (spec: 流式响应正文中途断连时降级为非流式重发).
   */
  onAssistantMessageDiscarded?: (messageId: string) => void;
  onAssistantContentUpdated?: (params: {
    messageId: string;
    chunk: string;
    stage: "streaming" | "end";
  }) => void;
  onAssistantReasoningUpdated?: (params: {
    messageId: string;
    chunk: string;
    stage: "streaming" | "end";
  }) => void;
  onToolBlockUpdated?: (params: ToolBlockUpdateCallbackParams) => void;
  onErrorBlockAdded?: (error: string) => void;
  /**
   * `message` is the compact message the CLI appended to its display stream;
   * hosts append it incrementally instead of pulling the full list. Absent
   * when talking to a CLI that predates the field — the host then falls back
   * to `getMessages`.
   */
  onCompactBlockAdded?: (content: string, message?: Message) => void;
  onCompactionStateChange?: (isCompacting: boolean) => void;
  onCompactionContentUpdate?: (content: string) => void;
  /** Full plan-file content after the model writes it (spec: 计划文件更新后刷新计划面板). */
  onPlanFileUpdated?: (content: string) => void;
  onLoadingChange?: (loading: boolean) => void;
  onContextUsage?: (percent: number) => void;
  onCommandRunningChange?: (running: boolean) => void;
  onQueuedMessagesChange?: (messages: QueuedMessage[]) => void;
  onTasksChange?: (tasks: Task[]) => void;
  onBackgroundTasksChange?: (tasks: BackgroundTaskSummary[]) => void;
  onSessionIdChange?: (sessionId: string) => void;
  onPermissionModeChange?: (mode: PermissionMode) => void;
  onMcpServersChange?: (servers: McpServerStatus[]) => void;
  onWorkdirChange?: (workdir: string) => void;
  onNotificationMessageAdded?: (params: {
    taskId: string;
    taskType: string;
    status: string;
    summary: string;
    message?: Message;
  }) => void;
  onPermissionRequest?: (
    requestId: string,
    context: ToolPermissionContext,
  ) => void;
  onBtwContent?: (params: {
    question: string;
    content: string;
    type: "thinking" | "content";
  }) => void;
}

// ── StdioAgent ───────────────────────────────────────────────────

export class StdioAgent {
  // ── Cached state (synchronous access) ──
  public sessionId: string | undefined;
  public currentWorkdir: string | undefined;
  /**
   * Initialize-time cwd — the session's stable root. Unlike
   * `currentWorkdir` it is never overwritten by the workdirChange
   * notification (bash cd), so @file search and the /status workdir stay
   * anchored to the project root.
   *
   * Re-attaching a session that is still running elsewhere (a daemon session
   * left behind by another client or an earlier window) is the case the
   * distinction exists for: the process there may have `cd`'d away long ago, so
   * the reply carries the root separately instead of reusing its live cwd.
   */
  public sessionCwd: string | undefined;
  /**
   * The main repository root when `sessionCwd` is a linked git worktree, else
   * undefined. Grouping a worktree conversation under the repo it was forked
   * from must not depend on the host having an index entry for it — a session
   * picked off disk (`/resume`) has none.
   */
  public sessionRepoRoot: string | undefined;
  public latestTotalTokens = 0;
  /**
   * Context-usage percentage reported with the most recent getMessages pull.
   * A host whose webview was re-created long after the last token change gets
   * no contextUsage notification, so it replays this on webviewReady instead.
   */
  public contextUsagePercent: number | undefined;
  public permissionMode: PermissionMode | undefined;
  /**
   * Totals for the thread behind this list (message count, first user body,
   * newest timestamp), refreshed on every `getMessages()` pull — the pulled
   * list itself cannot answer any of them, and it is discarded after the call.
   */
  public threadSummary: MessageThreadSummary | undefined;
  public queuedMessages: QueuedMessage[] = [];
  public tasks: Task[] = [];
  public backgroundTasks: BackgroundTaskSummary[] = [];
  public isStreaming = false;
  public isCommandRunning = false;
  public isCompacting = false;

  private client: RpcClient;
  private router: NotificationRouter;
  private callbacks: StdioAgentCallbacks;

  constructor(
    client: RpcClient,
    router: NotificationRouter,
    callbacks: StdioAgentCallbacks,
  ) {
    this.client = client;
    this.router = router;
    this.callbacks = callbacks;
  }

  // ── Lifecycle ─────────────────────────────────────────────────

  async initialize(params: InitializeParams): Promise<InitializeResult> {
    const result = (await this.client.request(
      "initialize",
      params,
    )) as InitializeResult;
    this.sessionId = result.sessionId;
    this.currentWorkdir = result.currentWorkdir;
    // The reply's own root wins: a re-attached live session reports its current
    // (possibly cd-drifted) cwd as `currentWorkdir`, and only `sessionCwd`
    // can say which project the conversation belongs to.
    this.sessionCwd = result.sessionCwd ?? result.currentWorkdir;
    this.sessionRepoRoot = result.repoRoot;
    this.permissionMode = result.permissionMode;
    this.latestTotalTokens = result.latestTotalTokens;
    // A fresh session has no usage yet; don't let a previous session's
    // percentage survive into this agent.
    this.contextUsagePercent = undefined;
    // Register with the router so subsequent notifications are routed here
    this.router.register(this.sessionId, this);
    return result;
  }

  async destroy(): Promise<void> {
    if (this.sessionId) {
      this.router.unregister(this.sessionId);
    }
    try {
      await this.client.request("destroy", undefined, this.sessionId);
    } catch {
      // Process may have already exited; best-effort
    }
    // NOTE: do NOT dispose the shared client — other sessions may still use it
  }

  async restoreSession(sessionId: string): Promise<void> {
    await this.client.request("restoreSession", { sessionId }, this.sessionId);
  }

  /**
   * Set this session's custom title (spec session-management.md「会话自定义标题
   * （重命名）」). The title is appended to the session's own JSONL file as a
   * reserved `custom-title` entry, so every host reading that file sees it.
   */
  async renameSession(title: string): Promise<void> {
    await this.client.request(
      "renameSession",
      {
        sessionId: this.sessionId,
        // The session file lives under the session root; a cwd drifted by `cd`
        // inside a turn must not address it (see sessionCwd).
        workdir: this.sessionCwd ?? this.currentWorkdir,
        title,
      },
      this.sessionId,
    );
  }

  async updateConfig(
    params: UpdateConfigParams,
  ): Promise<{ sessionId: string }> {
    const oldSessionId = this.sessionId;
    const result = (await this.client.request(
      "updateConfig",
      params,
      this.sessionId,
    )) as { sessionId: string };
    // If sessionId changed, re-register with the router
    if (oldSessionId && result.sessionId !== oldSessionId) {
      this.router.unregister(oldSessionId);
      this.sessionId = result.sessionId;
      this.router.register(this.sessionId, this);
      // Sync the host session state: the bridge may have downgraded to a
      // fresh session (session file missing on recreate). Without this the
      // host keeps the destroyed sessionId and every later request fails
      // with "Session not found".
      this.callbacks.onSessionIdChange?.(this.sessionId);
    }
    return result;
  }

  // ── Messages ──────────────────────────────────────────────────

  async sendMessage(
    text: string,
    images?: Array<{ path: string; mimeType: string }>,
    force?: boolean,
  ): Promise<void> {
    await this.client.request(
      "sendMessage",
      { text, images, force },
      this.sessionId,
    );
  }

  async bang(command: string): Promise<void> {
    await this.client.request("bang", { command }, this.sessionId);
  }

  async abortMessage(): Promise<void> {
    await this.client.request("abortMessage", undefined, this.sessionId);
  }

  async clearMessages(): Promise<void> {
    await this.client.request("clearMessages", undefined, this.sessionId);
  }

  async compact(customInstructions?: string): Promise<void> {
    await this.client.request(
      "compact",
      { customInstructions },
      this.sessionId,
    );
  }

  async rewindToMessage(messageId: string): Promise<{ inputContent: string }> {
    return (await this.client.request(
      "rewindToMessage",
      { messageId },
      this.sessionId,
    )) as { inputContent: string };
  }

  async askBtw(question: string): Promise<string> {
    return (await this.client.request(
      "askBtw",
      { question },
      this.sessionId,
    )) as string;
  }

  async removeQueuedMessage(index: number): Promise<void> {
    await this.client.request("deleteQueuedMessage", { index }, this.sessionId);
  }

  async updateQueuedMessageById(
    id: string,
    patch: {
      content?: string;
      images?: Array<{ path: string; mimeType: string }>;
      type?: "message" | "bang";
    },
  ): Promise<boolean> {
    const result = (await this.client.request(
      "updateQueuedMessage",
      { id, text: patch.content, images: patch.images },
      this.sessionId,
    )) as { ok: boolean };
    return result?.ok ?? false;
  }

  async removeQueuedMessageById(id: string): Promise<void> {
    await this.client.request(
      "deleteQueuedMessageById",
      { id },
      this.sessionId,
    );
  }

  async getFullMessageThread(): Promise<{
    messages: Message[];
    sessionIds: string[];
  }> {
    return (await this.client.request(
      "getFullMessageThread",
      undefined,
      this.sessionId,
    )) as { messages: Message[]; sessionIds: string[] };
  }

  /**
   * 取整份列表（= 最近一次压缩 + 它之后的消息）。**不留缓存**：这份数组只在
   * 调用方手里活一次（宿主推给渲染进程、导出读完即走），这之后宿主对消息内容
   * 零状态（spec ui/message-rendering-system.md「宿主不保留消息内容，用的时候
   * 现取」）。
   *
   * 顺带刷新两项**状态**（不是消息内容，宿主可以留着）：`threadSummary`
   * （标题与统计）与 `contextUsagePercent`（用量环）。
   */
  async getMessages(): Promise<Message[]>;
  /**
   * 带参数取数（`since` 重连补差 / `limit` 从尾部切一段）。只读查询：连上面那
   * 两项状态也不回写。
   */
  async getMessages(window: MessageWindow): Promise<MessageWindowResult>;
  async getMessages(
    window?: MessageWindow,
  ): Promise<Message[] | MessageWindowResult> {
    const result = (await this.client.request(
      "getMessages",
      window,
      this.sessionId,
    )) as MessageWindowResult;
    if (window) return result;
    if (result.threadSummary) {
      this.threadSummary = result.threadSummary;
    }
    // Assigned even when absent: a fresh session's first pull carries no usage,
    // and the host replays whatever is here on webviewReady — keeping the last
    // session's number would paint the ring with someone else's usage.
    this.contextUsagePercent = result.contextUsagePercent;
    return result.messages;
  }

  async listRewindCheckpoints(): Promise<{
    checkpoints: Array<{ id: string; content: string }>;
  }> {
    return (await this.client.request(
      "listRewindCheckpoints",
      undefined,
      this.sessionId,
    )) as { checkpoints: Array<{ id: string; content: string }> };
  }

  async getConfiguredModels(): Promise<{
    models: ConfiguredModel[];
    currentModel: string | undefined;
  }> {
    return (await this.client.request(
      "getConfiguredModels",
      undefined,
      this.sessionId,
    )) as { models: ConfiguredModel[]; currentModel: string | undefined };
  }

  async setModel(model: string): Promise<void> {
    await this.client.request("setModel", { model }, this.sessionId);
  }

  /**
   * Requests one inline (ghost-text) completion for a cursor context. Both
   * editor hosts call this directly instead of building their own model client:
   * the session owns the model configuration and the gateway credentials, and a
   * new request supersedes this session's previous one inside the CLI.
   */
  async getCompletion(params: {
    prefix: string;
    suffix: string;
    language?: string;
    filePath?: string;
    snippets?: CompletionSnippet[];
  }): Promise<{ text: string; model: string }> {
    return (await this.client.request(
      "getCompletion",
      params,
      this.sessionId,
    )) as { text: string; model: string };
  }

  /**
   * Requests one next-edit suggestion for the editor's current window
   * (spec ui/next-edit-suggestion.md). `suggestion: null` means "no change
   * suggested"; a suggestion with an empty `text` means "delete those lines".
   */
  async getNextEdit(params: {
    edits: NextEditHistoryEntry[];
    region: NextEditRegion;
    excerpt: NextEditExcerpt;
    language?: string;
    filePath?: string;
  }): Promise<{ suggestion: NextEditSuggestion | null; model: string }> {
    return (await this.client.request(
      "getNextEdit",
      params,
      this.sessionId,
    )) as { suggestion: NextEditSuggestion | null; model: string };
  }

  // ── Permissions ───────────────────────────────────────────────

  async setPermissionMode(mode: PermissionMode): Promise<void> {
    await this.client.request("setPermissionMode", { mode }, this.sessionId);
  }

  /** Returns cached permission mode (updated via notification). */
  getPermissionMode(): PermissionMode | undefined {
    return this.permissionMode;
  }

  /**
   * Reads the session's current plan file (path + contents). Used by the
   * /plan command to display the plan when already in plan mode; the CLI side
   * awaits the path if it is still being generated after setPermissionMode.
   */
  async getPlanFile(): Promise<{
    path: string | null;
    content: string | null;
  }> {
    return (await this.client.request(
      "getPlanFile",
      undefined,
      this.sessionId,
    )) as { path: string | null; content: string | null };
  }

  sendPermissionResponse(
    requestId: string,
    decision: PermissionDecision,
  ): void {
    this.client.notify(
      "permissionResponse",
      { requestId, decision },
      this.sessionId,
    );
  }

  async getBackgroundTaskOutput(taskId: string): Promise<{
    stdout: string;
    stderr: string;
    status: string;
    outputPath?: string;
    type: string;
    exitCode?: number;
  } | null> {
    const result = (await this.client.request(
      "getBackgroundTaskOutput",
      { taskId },
      this.sessionId,
    )) as {
      output: {
        stdout: string;
        stderr: string;
        status: string;
        outputPath?: string;
        type: string;
        exitCode?: number;
      } | null;
    };
    return result.output;
  }

  async stopBackgroundTask(taskId: string): Promise<boolean> {
    const result = (await this.client.request(
      "stopBackgroundTask",
      { taskId },
      this.sessionId,
    )) as { success: boolean };
    return result.success;
  }

  async backgroundCurrentTask(): Promise<void> {
    await this.client.request(
      "backgroundCurrentTask",
      undefined,
      this.sessionId,
    );
  }

  async getWorkflowRuns(): Promise<SerializableWorkflowRun[]> {
    const result = (await this.client.request(
      "getWorkflowRuns",
      undefined,
      this.sessionId,
    )) as { runs: SerializableWorkflowRun[] };
    return result?.runs ?? [];
  }

  async stopWorkflowRun(runId: string): Promise<boolean> {
    const result = (await this.client.request(
      "stopWorkflowRun",
      { runId },
      this.sessionId,
    )) as { success: boolean };
    return result?.success ?? false;
  }

  // ── MCP ───────────────────────────────────────────────────────

  async getMcpServers(): Promise<McpServerStatus[]> {
    const result = (await this.client.request(
      "getMcpServers",
      undefined,
      this.sessionId,
    )) as { servers: McpServerStatus[] };
    return result.servers;
  }

  async connectMcpServer(serverName: string): Promise<boolean> {
    const result = (await this.client.request(
      "connectMcpServer",
      { serverName },
      this.sessionId,
    )) as { success: boolean };
    return result.success;
  }

  async disconnectMcpServer(serverName: string): Promise<boolean> {
    const result = (await this.client.request(
      "disconnectMcpServer",
      { serverName },
      this.sessionId,
    )) as { success: boolean };
    return result.success;
  }

  async getMcpConfigPaths(): Promise<{
    userPath: string | null;
    projectPath: string | null;
  }> {
    const result = (await this.client.request(
      "getMcpConfigPaths",
      undefined,
      this.sessionId,
    )) as { userPath: string | null; projectPath: string | null };
    return result;
  }

  async removeMcpServer(
    scope: "user" | "project",
    serverName: string,
  ): Promise<boolean> {
    const result = (await this.client.request(
      "removeMcpServer",
      { scope, serverName },
      this.sessionId,
    )) as { success: boolean };
    return result.success;
  }

  async deleteSkill(name: string): Promise<boolean> {
    const result = (await this.client.request(
      "deleteSkill",
      { name },
      this.sessionId,
    )) as { success: boolean };
    return result.success;
  }

  async deleteSubagent(name: string): Promise<boolean> {
    const result = (await this.client.request(
      "deleteSubagent",
      { name },
      this.sessionId,
    )) as { success: boolean };
    return result.success;
  }

  async getHooksByScope(scope: "user" | "project" | "plugin"): Promise<{
    hooks: Partial<Record<string, unknown[]>>;
    configPath: string | null;
  }> {
    const result = (await this.client.request(
      "getHooksByScope",
      { scope },
      this.sessionId,
    )) as {
      hooks: Partial<Record<string, unknown[]>>;
      configPath: string | null;
    };
    return result;
  }

  async deleteHook(scope: "user" | "project", hookName: string): Promise<void> {
    await this.client.request(
      "deleteHook",
      { scope, hookName },
      this.sessionId,
    );
  }

  // ── Commands ──────────────────────────────────────────────────

  /**
   * The slash-command popup's rows. Pass `surface` (which front end is asking)
   * to also get that host's local commands — the machine keeps the one table
   * and filters it per request (spec ui/slash-commands.md 「弹窗里的宿主命令只有
   * 一份表」). Omitting it returns the agent's own commands only.
   */
  async getSlashCommands(surface?: HostSurface): Promise<SlashCommandInfo[]> {
    const result = (await this.client.request(
      "getSlashCommands",
      surface ? { surface } : undefined,
      this.sessionId,
    )) as { commands: SlashCommandInfo[] };
    return result.commands;
  }

  async getSubagentConfigurations(): Promise<SubagentConfiguration[]> {
    const result = (await this.client.request(
      "getSubagentConfigurations",
      undefined,
      this.sessionId,
    )) as { configurations: SubagentConfiguration[] };
    return result.configurations;
  }

  async getSkillMetadata(): Promise<SkillMetadata[]> {
    const result = (await this.client.request(
      "getSkillMetadata",
      undefined,
      this.sessionId,
    )) as { skills: SkillMetadata[] };
    return result.skills;
  }

  // ── Remote control ────────────────────────────────────────────
  //
  // The outbound relay link that serves a paired phone. It belongs to the
  // process this agent's client speaks to — the `wave --stdio` child — not to
  // the session, so the three calls carry no session semantics: the envelope
  // still needs `this.sessionId` (the server routes every request by it), but
  // the bridge answers from the process-wide controller.
  //
  // All three return the same snapshot, taken *after* the action, so a caller
  // never needs a second round trip. `connect` is asynchronous by nature (the
  // relay has not answered yet when it returns), which is why the snapshot can
  // legitimately come back as `connecting`.

  async remoteControlStatus(): Promise<RemoteControlSnapshot> {
    return (await this.client.request(
      "remoteControlStatus",
      undefined,
      this.sessionId,
    )) as RemoteControlSnapshot;
  }

  /** `name` is an optional label for this machine, shown on the phone. */
  async remoteControlConnect(name?: string): Promise<RemoteControlSnapshot> {
    return (await this.client.request(
      "remoteControlConnect",
      { name },
      this.sessionId,
    )) as RemoteControlSnapshot;
  }

  async remoteControlDisconnect(): Promise<RemoteControlSnapshot> {
    return (await this.client.request(
      "remoteControlDisconnect",
      undefined,
      this.sessionId,
    )) as RemoteControlSnapshot;
  }

  // ── Notification dispatch (called by NotificationRouter) ──────

  handleNotification(method: ServerNotificationMethod, params: unknown): void {
    switch (method) {
      case "userMessageAdded": {
        const p = params as { message: Message };
        if (p.message) this.callbacks.onUserMessageAdded?.(p.message);
        break;
      }
      case "assistantMessageAdded": {
        const p = params as { message: Message };
        if (p.message) this.callbacks.onAssistantMessageAdded?.(p.message);
        break;
      }
      case "assistantMessageDiscarded": {
        const p = params as { messageId: string };
        if (p.messageId) {
          this.callbacks.onAssistantMessageDiscarded?.(p.messageId);
        }
        break;
      }
      case "assistantContentUpdated":
        this.callbacks.onAssistantContentUpdated?.(
          params as {
            messageId: string;
            chunk: string;
            stage: "streaming" | "end";
          },
        );
        break;
      case "assistantReasoningUpdated":
        this.callbacks.onAssistantReasoningUpdated?.(
          params as {
            messageId: string;
            chunk: string;
            stage: "streaming" | "end";
          },
        );
        break;
      case "toolBlockUpdated":
        this.callbacks.onToolBlockUpdated?.(
          params as ToolBlockUpdateCallbackParams,
        );
        break;
      case "errorBlockAdded": {
        const p = params as { error: string };
        this.callbacks.onErrorBlockAdded?.(p.error);
        break;
      }
      case "compactBlockAdded": {
        const p = params as { content: string; message?: Message };
        this.callbacks.onCompactBlockAdded?.(p.content, p.message);
        break;
      }
      case "compactionStateChange": {
        const p = params as { isCompacting: boolean };
        this.isCompacting = p.isCompacting;
        this.callbacks.onCompactionStateChange?.(p.isCompacting);
        break;
      }
      case "compactionContentUpdate": {
        const p = params as { content: string };
        this.callbacks.onCompactionContentUpdate?.(p.content);
        break;
      }
      case "planFileUpdated": {
        const p = params as { content: string };
        this.callbacks.onPlanFileUpdated?.(p.content);
        break;
      }
      case "loadingChange": {
        const p = params as {
          loading: boolean;
          latestTotalTokens: number;
        };
        if (p.latestTotalTokens !== undefined) {
          this.latestTotalTokens = p.latestTotalTokens;
        }
        this.isStreaming = p.loading;
        this.callbacks.onLoadingChange?.(p.loading);
        break;
      }
      case "contextUsage": {
        const p = params as { percent: number };
        this.callbacks.onContextUsage?.(p.percent);
        break;
      }
      case "commandRunningChange": {
        const p = params as { running: boolean };
        this.isCommandRunning = p.running;
        this.callbacks.onCommandRunningChange?.(p.running);
        break;
      }
      case "queuedMessagesChange": {
        const p = params as { messages: QueuedMessage[] };
        this.queuedMessages = p.messages;
        this.callbacks.onQueuedMessagesChange?.(p.messages);
        break;
      }
      case "tasksChange": {
        const p = params as { tasks: Task[] };
        this.tasks = p.tasks;
        this.callbacks.onTasksChange?.(p.tasks);
        break;
      }
      case "backgroundTasksChange": {
        const p = params as { tasks: BackgroundTaskSummary[] };
        this.backgroundTasks = p.tasks;
        this.callbacks.onBackgroundTasksChange?.(p.tasks);
        break;
      }
      case "sessionIdChange": {
        const p = params as { sessionId: string };
        this.sessionId = p.sessionId;
        this.callbacks.onSessionIdChange?.(p.sessionId);
        break;
      }
      case "permissionModeChange": {
        const p = params as { mode: PermissionMode };
        this.permissionMode = p.mode;
        this.callbacks.onPermissionModeChange?.(p.mode);
        break;
      }
      case "mcpServersChange": {
        const p = params as { servers: McpServerStatus[] };
        this.callbacks.onMcpServersChange?.(p.servers);
        break;
      }
      case "workdirChange": {
        const p = params as { workdir: string };
        this.currentWorkdir = p.workdir;
        this.callbacks.onWorkdirChange?.(p.workdir);
        break;
      }
      case "notificationMessageAdded":
        this.callbacks.onNotificationMessageAdded?.(
          params as {
            taskId: string;
            taskType: string;
            status: string;
            summary: string;
            message?: Message;
          },
        );
        break;
      case "permissionRequest": {
        const p = params as {
          requestId: string;
          context: ToolPermissionContext;
        };
        this.callbacks.onPermissionRequest?.(p.requestId, p.context);
        break;
      }
      case "btwContent": {
        const p = params as {
          question: string;
          content: string;
          type: "thinking" | "content";
        };
        if (p) this.callbacks.onBtwContent?.(p);
        break;
      }
    }
  }
}
