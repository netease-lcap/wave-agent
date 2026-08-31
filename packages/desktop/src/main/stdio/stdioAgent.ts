/**
 * StdioAgent — typed wrapper around a JSON-RPC client that mirrors the Agent API.
 *
 * In the single-shared-process architecture, all sessions share one
 * StdioClient. The NotificationRouter dispatches incoming notifications to
 * the appropriate StdioAgent via `handleNotification()`. The agent no longer
 * subscribes directly to the client.
 *
 * All session-scoped requests carry `this.sessionId` on the JSON-RPC envelope
 * so the server can route them to the right Agent.
 *
 * `destroy()` only unregisters from the router and sends the destroy request;
 * it does NOT dispose the shared StdioClient.
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
  SlashCommand,
  McpServerConfig,
  SubagentConfiguration,
  SkillMetadata,
} from "wave-agent-sdk/types";
import type { JsonRpcClient } from "./jsonRpcClient";
import { NotificationRouter } from "./notificationRouter";

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
  language?: string;
  permissionMode?: PermissionMode;
  tools?: string[];
  allowedTools?: string[];
  disallowedTools?: string[];
  pluginDirs?: string[];
  mcpServers?: Record<string, McpServerConfig>;
  worktreeName?: string;
  isNewWorktree?: boolean;
}

export interface InitializeResult {
  sessionId: string;
  workingDirectory: string;
  permissionMode: PermissionMode;
  latestTotalTokens: number;
}

export interface UpdateConfigParams {
  apiKey?: string;
  baseURL?: string;
  serverUrl?: string;
  defaultHeaders?: Record<string, string>;
  model?: string;
  fastModel?: string;
  language?: string;
  contextLength?: number;
  autoMemoryEnabled?: boolean;
  autoMemoryFrequency?: number;
}

// ── Callbacks (mirror AgentCallbacks) ────────────────────────────

export interface StdioAgentCallbacks {
  onUserMessageAdded?: (message: Message) => void;
  onAssistantMessageAdded?: (message: Message) => void;
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
  onCompactBlockAdded?: (content: string) => void;
  onCompactionStateChange?: (isCompacting: boolean) => void;
  onCompactionContentUpdate?: (content: string) => void;
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
  public workingDirectory: string | undefined;
  /**
   * Initialize-time cwd — the session's stable root. Unlike
   * `workingDirectory` it is never overwritten by the workdirChange
   * notification (bash cd), so @file search and the /status workdir stay
   * anchored to the project root.
   */
  public sessionCwd: string | undefined;
  public latestTotalTokens = 0;
  public permissionMode: PermissionMode | undefined;
  public messages: Message[] = [];
  public queuedMessages: QueuedMessage[] = [];
  public tasks: Task[] = [];
  public backgroundTasks: BackgroundTaskSummary[] = [];
  public isStreaming = false;
  public isCommandRunning = false;
  public isCompacting = false;

  private client: JsonRpcClient;
  private router: NotificationRouter;
  private callbacks: StdioAgentCallbacks;

  constructor(
    client: JsonRpcClient,
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
    this.workingDirectory = result.workingDirectory;
    this.sessionCwd = result.workingDirectory;
    this.permissionMode = result.permissionMode;
    this.latestTotalTokens = result.latestTotalTokens;
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

  async getMessages(): Promise<Message[]> {
    const result = (await this.client.request(
      "getMessages",
      undefined,
      this.sessionId,
    )) as { messages: Message[] };
    this.messages = result.messages;
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
    models: string[];
    currentModel: string | undefined;
  }> {
    return (await this.client.request(
      "getConfiguredModels",
      undefined,
      this.sessionId,
    )) as { models: string[]; currentModel: string | undefined };
  }

  async setModel(model: string): Promise<void> {
    await this.client.request("setModel", { model }, this.sessionId);
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

  async getHooksByScope(
    scope: "user" | "project" | "plugin",
  ): Promise<Partial<Record<string, unknown[]>>> {
    const result = (await this.client.request(
      "getHooksByScope",
      { scope },
      this.sessionId,
    )) as Partial<Record<string, unknown[]>>;
    return result;
  }

  async setHookEnabled(
    scope: "user" | "project",
    hookName: string,
    enabled: boolean,
  ): Promise<void> {
    await this.client.request(
      "setHookEnabled",
      { scope, hookName, enabled },
      this.sessionId,
    );
  }

  async deleteHook(scope: "user" | "project", hookName: string): Promise<void> {
    await this.client.request(
      "deleteHook",
      { scope, hookName },
      this.sessionId,
    );
  }

  // ── Commands ──────────────────────────────────────────────────

  async getSlashCommands(): Promise<SlashCommand[]> {
    const result = (await this.client.request(
      "getSlashCommands",
      undefined,
      this.sessionId,
    )) as { commands: SlashCommand[] };
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

  // ── Notification dispatch (called by NotificationRouter) ──────

  handleNotification(method: string, params: unknown): void {
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
        const p = params as { content: string };
        this.callbacks.onCompactBlockAdded?.(p.content);
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
        this.workingDirectory = p.workdir;
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
