import * as vscode from "vscode";
import type {
  Message,
  PermissionDecision,
  ToolPermissionContext,
  PermissionMode,
  Task,
  BackgroundTaskSummary,
  SerializableWorkflowRun,
  QueuedMessage,
  McpServerStatus,
  ToolBlockUpdateCallbackParams,
} from "wave-agent-sdk/host";
import { StdioClient } from "../stdio/stdioClient";
import {
  StdioAgent,
  type InitializeParams,
  type StdioAgentCallbacks,
  type NotificationRouter,
} from "wave-agent-sdk/host";

export interface ChatSessionCallbacks {
  onTasksChange: (tasks: Task[]) => void;
  onBackgroundTasksChange?: (tasks: BackgroundTaskSummary[]) => void;
  onWorkflowRunsChange?: (runs: SerializableWorkflowRun[]) => void;
  onSessionIdChange: (sessionId: string) => void;
  onStreamingChange: (isStreaming: boolean) => void;
  onContextUsage?: (percent: number) => void;
  onCompactionStateChange?: (isCompacting: boolean) => void;
  onCompactionContentUpdate?: (content: string) => void;
  /** Full plan-file content after the model writes it (spec: 计划文件更新后刷新计划面板). */
  onPlanFileUpdated?: (content: string) => void;
  onQueueChange: (queue: QueuedMessage[]) => void;
  onCommandRunningChange: (running: boolean) => void;
  onPermissionModeChange: (mode: PermissionMode) => void;
  onWorkdirChange: (workdir: string) => void;
  onToolPermissionRequest: (
    context: ToolPermissionContext,
  ) => Promise<PermissionDecision>;
  onError: (error: unknown) => void;
  onMcpServersChange?: (servers: McpServerStatus[]) => void;
  // Incremental update callbacks for streaming optimization
  onUserMessageAdded?: (message: Message) => void;
  onAssistantMessageAdded?: (message: Message) => void;
  /** Drop an already-rendered message: the streamed attempt it came from died
   * mid-body and was re-issued without streaming. */
  onAssistantMessageDiscarded?: (messageId: string) => void;
  onStreamingContentUpdate?: (params: {
    messageId: string;
    chunk: string;
    stage: "streaming" | "end";
  }) => void;
  onStreamingReasoningUpdate?: (params: {
    messageId: string;
    chunk: string;
    stage: "streaming" | "end";
  }) => void;
  onToolBlockUpdate?: (params: ToolBlockUpdateCallbackParams) => void;
  onErrorBlockAdded?: (error: string) => void;
  /** The compact summary block the server appended to its display stream; the
   * host forwards it so the webview appends it — the host itself keeps nothing. */
  onCompactBlockAdded?: (message: Message) => void;
  /** Full-list push — only used by the compact fallback below (an old CLI whose
   * notification carries no `message`, so the list had to be re-pulled). */
  onMessagesReplaced?: (messages: Message[]) => void;
  onBtwContent?: (params: {
    question: string;
    content: string;
    type: "thinking" | "content";
  }) => void;
}

export class ChatSession {
  public agent: StdioAgent | undefined;
  /**
   * 上下文用量百分比，随 `getMessages` 回包刷新。
   *
   * 这是**状态**不是消息内容（spec ui/message-rendering-system.md「宿主不保留
   * 消息内容，用的时候现取」判据：宿主只记 state，不记消息本身），webview 重建
   * 之后要靠它把用量环补回来。
   */
  public contextUsagePercent: number | undefined;
  public tasks: Task[] = [];
  public backgroundTasks: BackgroundTaskSummary[] = [];
  public workflowRuns: SerializableWorkflowRun[] = [];
  public sessionId: string | undefined;
  public isStreaming: boolean = false;
  public isCommandRunning: boolean = false;
  /** True while a compaction LLM call is in flight; blocks in-place clearChat/restoreSession. */
  public isCompacting: boolean = false;
  public isInitializing: boolean = false;
  public inputContent: string = "";
  public messageQueue: QueuedMessage[] = [];
  public pendingConfirmations: Map<
    string,
    {
      resolve: (decision: PermissionDecision) => void;
      toolName: string;
      confirmationType: string;
      toolInput: unknown;
      planContent?: string;
      suggestedPrefix?: string;
      hidePersistentOption?: boolean;
      warning?: string;
      permissionMode?: PermissionMode;
      outsideSafeZoneDirectory?: string;
    }
  > = new Map();

  // Throttled incremental update fields
  private streamingContentUpdateTimer: NodeJS.Timeout | undefined;
  private pendingStreamingContentUpdate:
    | { messageId: string; chunk: string }
    | undefined;
  private streamingReasoningUpdateTimer: NodeJS.Timeout | undefined;
  private pendingStreamingReasoningUpdate:
    | { messageId: string; chunk: string }
    | undefined;

  constructor(
    public readonly viewType: "sidebar" | "tab" | "window",
    public readonly windowId: string | undefined,
    private callbacks: ChatSessionCallbacks,
  ) {}

  public async initialize(
    restoreSessionId: string | undefined,
    sharedClient: StdioClient,
    router: NotificationRouter,
  ) {
    if (this.isInitializing) {
      return;
    }

    this.isInitializing = true;
    try {
      console.log(
        `正在初始化 ${this.viewType} 视图的智能体...`,
        this.windowId ? `窗口ID: ${this.windowId}` : "",
      );

      const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
      const workdir = workspaceFolder?.uri.fsPath;

      if (workdir) {
        console.log(`设置智能体工作目录为: ${workdir}`);
      }

      const agentCallbacks: StdioAgentCallbacks = {
        onCompactBlockAdded: (content: string, message?: Message) => {
          // Compaction only folds the API context; the display stream just gained
          // the summary block, so forward it like any other new message — the
          // host keeps nothing (spec ui/message-rendering-system.md「宿主不保留
          // 消息内容」场景 2).
          if (message) {
            this.callbacks.onCompactBlockAdded?.(message);
            return;
          }
          // Older CLI without the field on the wire: the summary is already in
          // the server's display stream, so re-pull the list and push it. The
          // reply is used and dropped — no cache is refreshed, because there is
          // no cache to refresh.
          void this.getMessages().then((messages) => {
            this.callbacks.onMessagesReplaced?.(messages);
          });
        },
        onCompactionStateChange: (isCompacting: boolean) => {
          this.isCompacting = isCompacting;
          this.callbacks.onCompactionStateChange?.(isCompacting);
        },
        onCompactionContentUpdate: (content: string) => {
          this.callbacks.onCompactionContentUpdate?.(content);
        },
        onPlanFileUpdated: (content: string) => {
          this.callbacks.onPlanFileUpdated?.(content);
        },
        onUserMessageAdded: (message: Message) => {
          this.callbacks.onUserMessageAdded?.(message);
        },
        onAssistantMessageAdded: (message: Message) => {
          this.callbacks.onAssistantMessageAdded?.(message);
        },
        onAssistantMessageDiscarded: (messageId: string) => {
          this.callbacks.onAssistantMessageDiscarded?.(messageId);
        },
        onAssistantContentUpdated: (params) => {
          this.throttledStreamingContentUpdate(
            params.messageId,
            params.chunk,
            params.stage,
          );
        },
        onAssistantReasoningUpdated: (params) => {
          this.throttledStreamingReasoningUpdate(
            params.messageId,
            params.chunk,
            params.stage,
          );
        },
        onToolBlockUpdated: (params) => {
          this.callbacks.onToolBlockUpdate?.(params);
        },
        onErrorBlockAdded: (error: string) => {
          this.callbacks.onErrorBlockAdded?.(error);
        },
        onTasksChange: (tasks: Task[]) => {
          this.tasks = tasks;
          this.callbacks.onTasksChange(tasks);
        },
        onBackgroundTasksChange: (tasks: BackgroundTaskSummary[]) => {
          this.backgroundTasks = tasks;
          this.callbacks.onBackgroundTasksChange?.(tasks);
          void this.refreshWorkflowRuns();
        },
        onSessionIdChange: (sessionId: string) => {
          this.sessionId = sessionId;
          this.callbacks.onSessionIdChange(sessionId);
        },
        onPermissionModeChange: (mode: PermissionMode) => {
          this.callbacks.onPermissionModeChange(mode);
        },
        onWorkdirChange: (workdir: string) => {
          this.callbacks.onWorkdirChange(workdir);
        },
        onLoadingChange: (loading: boolean) => {
          this.isStreaming = loading;
          this.callbacks.onStreamingChange(loading);
        },
        onContextUsage: (percent: number) => {
          this.callbacks.onContextUsage?.(percent);
        },
        onCommandRunningChange: (running: boolean) => {
          this.isCommandRunning = running;
          this.callbacks.onCommandRunningChange(running);
        },
        onQueuedMessagesChange: (messages: QueuedMessage[]) => {
          this.messageQueue = messages;
          this.callbacks.onQueueChange(messages);
        },
        onMcpServersChange: (servers: McpServerStatus[]) => {
          this.callbacks.onMcpServersChange?.(servers);
        },
        onNotificationMessageAdded: (params) => {
          if (params.message) {
            this.callbacks.onAssistantMessageAdded?.(params.message);
          }
        },
        onPermissionRequest: (requestId, context) => {
          this.callbacks.onToolPermissionRequest(context).then((decision) => {
            this.agent?.sendPermissionResponse(requestId, decision);
          });
        },
        onBtwContent: (params) => {
          this.callbacks.onBtwContent?.(params);
        },
      };

      this.agent = new StdioAgent(sharedClient, router, agentCallbacks);

      const initParams: InitializeParams = {
        workdir,
        restoreSessionId,
        // 会话由本窗口的 `wave --stdio` 子进程承载 → 遥测里的 app.entrypoint
        // （docs/specs/enterprise/opentelemetry.md「宿主入口标识」）。
        entrypoint: "vscode",
        // 模型不进覆盖层：由底栏模型选择器经 `getConfiguredModels` / `setModel`
        // RPC 管理。用户偏好（language / autoMemory*）也不经此下发——它们落在
        // 用户级 ~/.wave/settings.json 并由 SDK 实时重载生效（spec agent-config
        // 「设置实时重载」；覆盖层会永久遮蔽 settings.json 的实时值）。
      };

      try {
        await this.agent.initialize(initParams);
      } catch (createError) {
        // If session not found, retry without restoreSessionId (new session)
        if (
          createError instanceof Error &&
          createError.message.startsWith("Session not found:")
        ) {
          console.log(
            `${this.viewType} 会话文件不存在，以新会话模式重新初始化`,
          );
          await this.agent.initialize({
            ...initParams,
            restoreSessionId: undefined,
          });
        } else {
          throw createError;
        }
      }

      // 同步 sessionId 从 agent 到 ChatSession
      // 因为 MessageManager 构造函数中设置 sessionId 不会触发 onSessionIdChange 回调
      if (
        this.agent &&
        this.agent.sessionId &&
        this.sessionId !== this.agent.sessionId
      ) {
        this.sessionId = this.agent.sessionId;
        this.callbacks.onSessionIdChange(this.sessionId);
      }

      console.log(`${this.viewType} 智能体初始化成功`);
    } catch (error) {
      console.error(`初始化 ${this.viewType} 智能体失败:`, error);
      this.callbacks.onError(error);
    } finally {
      this.isInitializing = false;
    }
  }

  public async sendMessage(
    text: string,
    images?: Array<{ data: string; mediaType: string }>,
    force: boolean = false,
  ) {
    if (!this.agent) {
      throw new Error("智能体未初始化");
    }

    let processedImages: Array<{ path: string; mimeType: string }> | undefined;
    if (images && images.length > 0) {
      processedImages = images.map((image) => ({
        path: image.data,
        mimeType: image.mediaType,
      }));
    }

    // Prompt history and force-abort are handled server-side by agentBridge

    if (text.startsWith("!")) {
      await this.agent.bang(text.slice(1));
    } else {
      await this.agent.sendMessage(text, processedImages, force);
    }
  }

  public async deleteQueuedMessage(index: number) {
    if (!this.agent) return;
    await this.agent.removeQueuedMessage(index);
  }

  public async updateQueuedMessage(
    id: string,
    text: string,
    images?: Array<{ path: string; mimeType: string }>,
  ): Promise<boolean> {
    if (!this.agent) return false;
    return this.agent.updateQueuedMessageById(id, { content: text, images });
  }

  public async deleteQueuedMessageById(id: string): Promise<void> {
    if (!this.agent) return;
    await this.agent.removeQueuedMessageById(id);
  }

  public async abortMessage() {
    if (this.agent) {
      await this.agent.abortMessage();
    }
  }

  /** 原地清空；返回清空后的整份列表（回包），宿主不存它。 */
  public async clearChat(): Promise<Message[]> {
    let messages: Message[] = [];
    if (this.agent) {
      this.inputContent = "";
      await this.agent.clearMessages();
      messages = await this.getMessages();
    }
    await this.clearQueue();
    return messages;
  }

  public async compact(customInstructions?: string) {
    if (this.agent) {
      await this.agent.compact(customInstructions);
    }
  }

  private async clearQueue() {
    if (this.agent && this.agent.queuedMessages.length > 0) {
      await this.agent.abortMessage();
    } else if (this.messageQueue.length > 0) {
      this.messageQueue = [];
      this.callbacks.onQueueChange(this.messageQueue);
    }
  }

  /** 恢复历史会话；返回恢复后的整份列表（回包），宿主不存它。 */
  public async restoreSession(sessionId: string): Promise<Message[]> {
    let messages: Message[] = [];
    if (this.agent) {
      this.inputContent = "";
      await this.agent.restoreSession(sessionId);
      // Pull the restored list so the caller can hand it straight to the
      // webview — the reply is used once and dropped (spec ui/
      // message-rendering-system.md「宿主不保留消息内容」场景 1).
      messages = await this.getMessages();
    }
    await this.clearQueue();
    return messages;
  }

  /**
   * 重建 agent（保留会话）——插件启停 / 登录登出后让新配置生效的必需步骤。
   * 模型不从覆盖层下发（由底栏模型选择器经 setModel RPC 管理），用户偏好走
   * settings.json 实时重载，故载荷为空。
   */
  public async updateConfig() {
    if (this.agent) {
      const currentSessionId = this.sessionId;
      console.log(
        `[updateConfig] ${this.viewType} 开始更新配置，sessionId: ${currentSessionId}`,
      );

      // 重置 streaming 状态
      if (this.isStreaming) {
        this.isStreaming = false;
        this.callbacks.onStreamingChange(false);
      }

      // Server-side destroy + recreate with restored session
      await this.agent.updateConfig({});
      console.log(
        `[updateConfig] ${this.viewType} 配置更新完成，sessionId: ${this.sessionId}`,
      );
    } else {
      console.log(
        `[updateConfig] ${this.viewType} agent 为 undefined，跳过更新`,
      );
    }
    await this.clearQueue();
  }

  public async getSlashCommands() {
    if (this.agent) {
      // `vscode`: 让服务端把本入口的宿主本地命令一起下发（spec
      // ui/slash-commands.md「弹窗里的宿主命令只有一份表」）。
      return await this.agent.getSlashCommands("vscode");
    }
    return [];
  }

  public async getSubagentConfigurations() {
    if (this.agent) {
      return await this.agent.getSubagentConfigurations();
    }
    return [];
  }

  public async getSkillMetadata() {
    if (this.agent) {
      return await this.agent.getSkillMetadata();
    }
    return [];
  }

  /**
   * 一次性取整份列表（= 最近一次压缩 + 它之后的消息）。
   *
   * 回包就是这次调用的全部产出：宿主把它交给界面后**不写任何字段、不留引用**
   * （spec ui/message-rendering-system.md「宿主不保留消息内容，用的时候现取」
   * 场景 9 —— VS Code 每个聊天面板都不留当前会话的数组，SDK 客户端那次 pull
   * 的数组用完即弃）。
   *
   * 只顺带记下用量百分比：SDK 在无参取数时刷新 `agent.contextUsagePercent`，
   * 那是**状态**（webview 重建后要把用量环补回来），不是消息内容。
   */
  public async getMessages(): Promise<Message[]> {
    if (!this.agent) {
      return [];
    }
    const messages = await this.agent.getMessages();
    this.contextUsagePercent = this.agent.contextUsagePercent;
    return messages;
  }

  private throttledStreamingContentUpdate(
    messageId: string,
    chunk: string,
    stage: "streaming" | "end",
  ) {
    // If stage is 'end', fire immediately to ensure finalization is not delayed
    if (stage === "end") {
      if (this.streamingContentUpdateTimer) {
        clearTimeout(this.streamingContentUpdateTimer);
        this.streamingContentUpdateTimer = undefined;
      }
      // Flush any chunks still pending inside the cooldown window first
      if (this.pendingStreamingContentUpdate) {
        this.callbacks.onStreamingContentUpdate?.({
          ...this.pendingStreamingContentUpdate,
          stage: "streaming",
        });
        this.pendingStreamingContentUpdate = undefined;
      }
      this.callbacks.onStreamingContentUpdate?.({ messageId, chunk, stage });
      return;
    }

    // window-concat: merge all chunks arriving within the cooldown window so
    // no delta is lost (dropping a delta would permanently lose content).
    if (this.pendingStreamingContentUpdate) {
      this.pendingStreamingContentUpdate.chunk += chunk;
    } else {
      this.pendingStreamingContentUpdate = { messageId, chunk };
    }

    // leading edge: fire the current delta immediately, then reset pending so
    // the trailing edge only carries chunks arriving within this window
    // (otherwise the leading chunk would be appended twice by the reducer).
    if (!this.streamingContentUpdateTimer) {
      this.callbacks.onStreamingContentUpdate?.({
        ...this.pendingStreamingContentUpdate,
        stage,
      });
      this.pendingStreamingContentUpdate = undefined;
      // trailing edge: fire the concatenated delta after 16ms cooldown (~60fps)
      this.streamingContentUpdateTimer = setTimeout(() => {
        if (this.pendingStreamingContentUpdate) {
          this.callbacks.onStreamingContentUpdate?.({
            ...this.pendingStreamingContentUpdate,
            stage: "streaming",
          });
          this.pendingStreamingContentUpdate = undefined;
        }
        this.streamingContentUpdateTimer = undefined;
      }, 16);
    }
  }

  private throttledStreamingReasoningUpdate(
    messageId: string,
    chunk: string,
    stage: "streaming" | "end",
  ) {
    // If stage is 'end', fire immediately to ensure finalization is not delayed
    if (stage === "end") {
      if (this.streamingReasoningUpdateTimer) {
        clearTimeout(this.streamingReasoningUpdateTimer);
        this.streamingReasoningUpdateTimer = undefined;
      }
      // Flush any chunks still pending inside the cooldown window first
      if (this.pendingStreamingReasoningUpdate) {
        this.callbacks.onStreamingReasoningUpdate?.({
          ...this.pendingStreamingReasoningUpdate,
          stage: "streaming",
        });
        this.pendingStreamingReasoningUpdate = undefined;
      }
      this.callbacks.onStreamingReasoningUpdate?.({ messageId, chunk, stage });
      return;
    }

    // window-concat: merge all chunks arriving within the cooldown window so
    // no delta is lost (dropping a delta would permanently lose content).
    if (this.pendingStreamingReasoningUpdate) {
      this.pendingStreamingReasoningUpdate.chunk += chunk;
    } else {
      this.pendingStreamingReasoningUpdate = { messageId, chunk };
    }

    // leading edge: fire the current delta immediately, then reset pending so
    // the trailing edge only carries chunks arriving within this window
    // (otherwise the leading chunk would be appended twice by the reducer).
    if (!this.streamingReasoningUpdateTimer) {
      this.callbacks.onStreamingReasoningUpdate?.({
        ...this.pendingStreamingReasoningUpdate,
        stage,
      });
      this.pendingStreamingReasoningUpdate = undefined;
      // trailing edge: fire the concatenated delta after 16ms cooldown (~60fps)
      this.streamingReasoningUpdateTimer = setTimeout(() => {
        if (this.pendingStreamingReasoningUpdate) {
          this.callbacks.onStreamingReasoningUpdate?.({
            ...this.pendingStreamingReasoningUpdate,
            stage: "streaming",
          });
          this.pendingStreamingReasoningUpdate = undefined;
        }
        this.streamingReasoningUpdateTimer = undefined;
      }, 16);
    }
  }

  public async setPermissionMode(mode: PermissionMode) {
    if (this.agent) {
      await this.agent.setPermissionMode(mode);
    }
  }

  /**
   * `/rewind`：截断由 CLI 完成，边界不在宿主手里（宿主没有数组可截断，也不去
   * 定位锚点），完成后无条件重拉整份列表并把它交回调用方推送 —— spec
   * ui/message-rendering-system.md「宿主不保留消息内容」场景 6。
   */
  public async rewindToMessage(messageId: string): Promise<Message[]> {
    if (!this.agent) {
      throw new Error("智能体未初始化");
    }

    const { inputContent } = await this.agent.rewindToMessage(messageId);
    this.inputContent = inputContent;
    return await this.getMessages();
  }

  public async askBtw(question: string): Promise<string> {
    if (!this.agent) {
      throw new Error("智能体未初始化");
    }
    return await this.agent.askBtw(question);
  }

  public async destroy() {
    if (this.streamingContentUpdateTimer) {
      clearTimeout(this.streamingContentUpdateTimer);
      this.streamingContentUpdateTimer = undefined;
    }
    if (this.streamingReasoningUpdateTimer) {
      clearTimeout(this.streamingReasoningUpdateTimer);
      this.streamingReasoningUpdateTimer = undefined;
    }

    if (this.agent) {
      try {
        await this.agent.destroy();
      } catch (error) {
        console.error(`销毁 ${this.viewType} agent 时出错:`, error);
      }
      this.agent = undefined;
    }

    this.contextUsagePercent = undefined;
    this.tasks = [];
    this.inputContent = "";
    this.sessionId = undefined;
    this.pendingConfirmations.clear();
    this.isStreaming = false;
    this.isCommandRunning = false;
    this.isCompacting = false;
    this.pendingStreamingContentUpdate = undefined;
    this.pendingStreamingReasoningUpdate = undefined;
    this.messageQueue = [];
  }

  // MCP server management
  public async getMcpServers(): Promise<McpServerStatus[]> {
    if (!this.agent) {
      return [];
    }
    return await this.agent.getMcpServers();
  }

  public async getBackgroundTaskOutput(taskId: string): Promise<{
    stdout: string;
    stderr: string;
    status: string;
    outputPath?: string;
    type: string;
    exitCode?: number;
  } | null> {
    if (!this.agent) {
      return null;
    }
    return await this.agent.getBackgroundTaskOutput(taskId);
  }

  public async stopBackgroundTask(taskId: string): Promise<boolean> {
    if (!this.agent) {
      return false;
    }
    return await this.agent.stopBackgroundTask(taskId);
  }

  public async backgroundCurrentTask(): Promise<void> {
    if (!this.agent) {
      return;
    }
    await this.agent.backgroundCurrentTask();
  }

  private async refreshWorkflowRuns(): Promise<void> {
    const runs = await this.getWorkflowRuns();
    this.workflowRuns = runs;
    this.callbacks.onWorkflowRunsChange?.(runs);
  }

  public async getWorkflowRuns(): Promise<SerializableWorkflowRun[]> {
    if (!this.agent) {
      return [];
    }
    return await this.agent.getWorkflowRuns();
  }

  public async stopWorkflowRun(runId: string): Promise<boolean> {
    if (!this.agent) {
      return false;
    }
    return await this.agent.stopWorkflowRun(runId);
  }

  public async connectMcpServer(serverName: string): Promise<boolean> {
    if (!this.agent) {
      return false;
    }
    return this.agent.connectMcpServer(serverName);
  }

  public async disconnectMcpServer(serverName: string): Promise<boolean> {
    if (!this.agent) {
      return false;
    }
    return this.agent.disconnectMcpServer(serverName);
  }

  public async removeMcpServer(
    scope: "user" | "project",
    serverName: string,
  ): Promise<boolean> {
    if (!this.agent) {
      return false;
    }
    return this.agent.removeMcpServer(scope, serverName);
  }

  public async getUserMcpConfigPath(): Promise<string | null> {
    if (!this.agent) {
      return null;
    }
    const paths = await this.agent.getMcpConfigPaths();
    return paths.userPath;
  }

  public async getProjectMcpConfigPath(): Promise<string | null> {
    if (!this.agent) {
      return null;
    }
    const paths = await this.agent.getMcpConfigPaths();
    return paths.projectPath;
  }

  public async deleteSkill(name: string): Promise<boolean> {
    if (!this.agent) {
      return false;
    }
    return this.agent.deleteSkill(name);
  }

  public async deleteSubagent(name: string): Promise<boolean> {
    if (!this.agent) {
      return false;
    }
    return this.agent.deleteSubagent(name);
  }

  public async getHooksByScope(scope: "user" | "project" | "plugin"): Promise<{
    hooks: Partial<Record<string, unknown[]>>;
    configPath: string | null;
  }> {
    if (!this.agent) {
      return { hooks: {}, configPath: null };
    }
    return this.agent.getHooksByScope(scope);
  }

  public async deleteHook(
    scope: "user" | "project",
    hookName: string,
  ): Promise<void> {
    if (!this.agent) {
      return;
    }
    await this.agent.deleteHook(scope, hookName);
  }
}
