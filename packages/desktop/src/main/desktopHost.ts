/**
 * DesktopHost — the Electron counterpart of ChatSession + MessageHandler.
 *
 * Owns the shared StdioClient, the per-workdir StdioAgent and the full
 * webview↔agent message protocol. All webview commands arrive via
 * handleWebviewMessage(); agent notifications are translated back into the
 * exact message shapes the webview already understands (ported from
 * packages/vsce/src/session/{chatSession,messageHandler}.ts).
 */

import { app, dialog, shell, nativeTheme, type BrowserWindow } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
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
  SessionMetadata,
  Scope,
} from 'wave-agent-sdk';
import {
  EDIT_TOOL_NAME,
  WRITE_TOOL_NAME,
  BASH_TOOL_NAME,
  EXIT_PLAN_MODE_TOOL_NAME,
  ENTER_PLAN_MODE_TOOL_NAME,
  ASK_USER_QUESTION_TOOL_NAME,
} from 'wave-agent-sdk';
import { StdioClient } from './stdio/stdioClient';
import { StdioAgent, type StdioAgentCallbacks } from './stdio/stdioAgent';
import { NotificationRouter } from './stdio/notificationRouter';
import {
  resolveWaveBinary,
  ensureCliUpToDate,
  getCliVersion,
} from './stdio/binaryResolver';
import { ConfigStore, type DesktopConfigData } from './configStore';
import { checkForUpdate } from './updateChecker';
import { HOST_CHANNEL } from './channels';

interface PendingConfirmation {
  resolve: (decision: PermissionDecision) => void;
  toolName: string;
  confirmationType: string;
  toolInput: unknown;
  planContent?: string;
  suggestedPrefix?: string;
  hidePersistentOption?: boolean;
}

export class DesktopHost {
  private mainWindow: BrowserWindow | null = null;

  // stdio infrastructure
  private client: StdioClient | null = null;
  private worktreeInfo: { path: string; branch: string; baseBranch: string; repoRoot: string } | null = null;
  private router: NotificationRouter | null = null;
  private initPromise: Promise<void> | null = null;
  private cliVersion: string | null = null;

  // agent + workdir
  private agent: StdioAgent | null = null;
  private workdir: string | undefined;

  // session state (mirrors ChatSession fields)
  private messages: Message[] = [];
  private tasks: Task[] = [];
  private backgroundTasks: BackgroundTaskSummary[] = [];
  private workflowRuns: SerializableWorkflowRun[] = [];
  private sessionId: string | undefined;
  private isStreaming = false;
  private isCommandRunning = false;
  private inputContent = '';
  private messageQueue: QueuedMessage[] = [];
  private sessionTree: Array<{ workdir: string; sessions: Array<{ sessionId: string; title: string; lastActiveAt: number; hasWorktree: boolean }> }> = [];
  private pendingConfirmations = new Map<string, PendingConfirmation>();

  // throttling state (same cadence as vsce ChatSession)
  private updateTimer: NodeJS.Timeout | undefined;
  private pendingUpdate = false;
  private forceNextUpdateImmediate = false;
  private streamingContentTimer: NodeJS.Timeout | undefined;
  private pendingStreamingContent: { messageId: string; accumulated: string; stage: 'streaming' | 'end' } | undefined;
  private streamingReasoningTimer: NodeJS.Timeout | undefined;
  private pendingStreamingReasoning: { messageId: string; accumulated: string; stage: 'streaming' | 'end' } | undefined;

  private updateCheckTriggered = false;

  /**
   * Posted to the renderer whenever the OS appearance flips so it can swap the
   * `data-theme` attribute and the inlined `--vscode-*` variable set without a
   * reload (FR-018). Desktop follows the OS appearance only — no in-app toggle
   * (FR-016), matching the IDE plugins.
   */
  private readonly onNativeThemeUpdated = () => {
    this.postMessage({ command: 'desktopThemeChange', effective: this.getCurrentEffectiveTheme() });
  };

  constructor(private readonly configStore: ConfigStore) {
    nativeTheme.on('updated', this.onNativeThemeUpdated);
  }

  setMainWindow(win: BrowserWindow): void {
    this.mainWindow = win;
  }

  /**
   * Effective theme for the preload's sync IPC — applied to <html data-theme>
   * before first paint so the initial frame already matches the OS appearance
   * (FR-019, no light↔dark flash on launch).
   */
  getInitialEffectiveTheme(): 'light' | 'dark' {
    return this.getCurrentEffectiveTheme();
  }

  /** Graceful shutdown for app quit (FR-015). */
  async dispose(): Promise<void> {
    nativeTheme.off('updated', this.onNativeThemeUpdated);
    for (const timer of [this.updateTimer, this.streamingContentTimer, this.streamingReasoningTimer]) {
      if (timer) clearTimeout(timer);
    }
    if (this.agent) {
      try { await this.agent.destroy(); } catch { /* process may be gone */ }
      this.agent = null;
    }
    this.client?.dispose();
    this.client = null;
    this.router = null;
    this.initPromise = null;
  }

  private getCurrentEffectiveTheme(): 'light' | 'dark' {
    try {
      return nativeTheme.shouldUseDarkColors ? 'dark' : 'light';
    } catch {
      return 'dark';
    }
  }

  // ------------------------------------------------------------------
  // Outbound helpers
  // ------------------------------------------------------------------

  private postMessage(message: unknown): void {
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      this.mainWindow.webContents.send(HOST_CHANNEL, message);
    }
  }

  /** Insert a host-generated system message into the chat stream. */
  private pushSystemMessage(content: string): void {
    const message = {
      id: `host-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      role: 'assistant',
      blocks: [{ type: 'text', content }],
      timestamp: new Date().toISOString(),
    } as unknown as Message;
    this.messages = [...this.messages, message];
    this.postMessage({ command: 'appendMessage', message });
  }

  private sendWorkdirState(): void {
    this.postMessage({
      command: 'desktopWorkdirState',
      workdir: this.workdir,
      recentWorkdirs: this.configStore.getRecentWorkdirs(),
    });
  }

  // ------------------------------------------------------------------
  // Client lifecycle (binary install → upgrade check → spawn → router)
  // ------------------------------------------------------------------

  private ensureClient(): Promise<void> {
    if (this.initPromise) return this.initPromise;

    this.initPromise = (async () => {
      const targetVersion = app.getVersion();
      let binaryPath: string;
      try {
        binaryPath = await ensureCliUpToDate(targetVersion, (msg) => this.pushSystemMessage(msg));
      } catch (error) {
        // Upgrade/install failure — fall back to whatever binary is resolvable.
        console.warn('[DesktopHost] ensureCliUpToDate failed, falling back:', error);
        this.pushSystemMessage(
          `wave-code CLI 升级失败：${error instanceof Error ? error.message : String(error)}。可通过 npm install -g wave-code@latest 手动升级`,
        );
        binaryPath = resolveWaveBinary();
      }
      this.cliVersion = getCliVersion(binaryPath);

      this.client = new StdioClient(binaryPath, ['--stdio']);
      this.router = new NotificationRouter(this.client);
      this.router.registerGlobal('authUrl', (params) => {
        const p = params as { url?: string };
        if (p?.url) void shell.openExternal(p.url);
      });
      this.router.attach();
    })();

    this.initPromise.catch(() => {
      // Allow retry after a failed init.
      this.initPromise = null;
      this.client = null;
      this.router = null;
    });
    return this.initPromise;
  }

  private get utilityClient(): StdioClient {
    if (!this.client) throw new Error('StdioClient not initialized');
    return this.client;
  }

  // ------------------------------------------------------------------
  // Agent lifecycle (one per workdir; workdir switch = destroy + recreate)
  // ------------------------------------------------------------------

  private async initializeAgent(): Promise<void> {
    await this.ensureClient();
    if (!this.client || !this.router) throw new Error('StdioClient not initialized');
    if (this.agent) return;

    const config = this.configStore.getConfiguration();
    const agentCallbacks: StdioAgentCallbacks = {
      onMessagesChange: (messages: Message[]) => {
        this.messages = messages;
      },
      onCompactBlockAdded: () => {
        // messagesChange (truncated list) arrives first and updates this.messages
        this.forceNextUpdateImmediate = true;
        this.throttledUpdateChatMessages(this.messages);
      },
      onCompactionStateChange: (isCompacting: boolean) => {
        this.pushSystemMessage(isCompacting ? '正在压缩对话…' : '对话压缩完成');
      },
      onUserMessageAdded: (message: Message) => {
        this.postMessage({ command: 'appendMessage', message });
      },
      onAssistantMessageAdded: (message: Message) => {
        this.postMessage({ command: 'appendMessage', message });
      },
      onAssistantContentUpdated: (params) => {
        this.throttledStreamingContentUpdate(params.messageId, params.accumulated, params.stage);
      },
      onAssistantReasoningUpdated: (params) => {
        this.throttledStreamingReasoningUpdate(params.messageId, params.accumulated, params.stage);
      },
      onToolBlockUpdated: (params) => {
        this.postMessage({ command: 'updateToolBlock', params });
      },
      onErrorBlockAdded: (error: string) => {
        this.postMessage({ command: 'updateErrorBlock', error });
      },
      onTasksChange: (tasks: Task[]) => {
        this.tasks = tasks;
        this.postMessage({ command: 'updateTasks', tasks });
      },
      onBackgroundTasksChange: (tasks: BackgroundTaskSummary[]) => {
        this.backgroundTasks = tasks;
        this.postMessage({ command: 'updateBackgroundTasks', tasks });
        void this.refreshWorkflowRuns();
      },
      onSessionIdChange: (sessionId: string) => {
        this.sessionId = sessionId;
        this.postMessage({
          command: 'updateCurrentSession',
          session: {
            id: sessionId,
            sessionType: 'main',
            workdir: this.agent?.workingDirectory,
            lastActiveAt: new Date(),
            latestTotalTokens: this.agent?.latestTotalTokens ?? 0,
          } as SessionMetadata,
        });
        this.registerSessionInIndex(sessionId);
        this.refreshSessionTree();
      },
      onPermissionModeChange: (mode: PermissionMode) => {
        this.postMessage({ command: 'updatePermissionMode', mode });
      },
      onWorkdirChange: (workdir: string) => {
        this.postMessage({ command: 'updateWorkdir', workdir });
      },
      onLoadingChange: (loading: boolean) => {
        this.isStreaming = loading;
        this.postMessage({ command: loading ? 'startStreaming' : 'endStreaming' });
        // Turn ended — title/lastActiveAt of the current session may have
        // changed, so touch the index and refresh the sidebar (FR-020/024).
        if (!loading) {
          this.touchSessionInIndex();
          this.refreshSessionTree();
        }
      },
      onCommandRunningChange: (running: boolean) => {
        this.isCommandRunning = running;
        this.postMessage({ command: 'updateCommandRunning', running });
      },
      onQueuedMessagesChange: (messages: QueuedMessage[]) => {
        this.messageQueue = messages;
        this.postMessage({ command: 'updateQueue', queue: messages });
      },
      onMcpServersChange: (servers: McpServerStatus[]) => {
        this.postMessage({ command: 'mcpServersUpdate', servers });
      },
      onBangMessageAdded: () => {
        this.postMessage({ command: 'updateMessages', messages: this.messages });
      },
      onBangMessageUpdated: () => {
        this.postMessage({ command: 'updateMessages', messages: this.messages });
      },
      onBangMessageCompleted: () => {
        this.postMessage({ command: 'updateMessages', messages: this.messages });
      },
      onNotificationMessageAdded: (params) => {
        if (params.message) {
          this.postMessage({ command: 'appendMessage', message: params.message });
        }
      },
      onPermissionRequest: (requestId, context) => {
        this.handleToolPermissionRequest(context).then((decision) => {
          this.agent?.sendPermissionResponse(requestId, decision);
        });
      },
    };

    const agent = new StdioAgent(this.client, this.router, agentCallbacks);
    await agent.initialize({
      workdir: this.workdir,
      apiKey: config.apiKey || undefined,
      defaultHeaders: parseHeaders(config.headers),
      baseURL: config.baseURL || undefined,
      model: config.model,
      fastModel: config.fastModel,
      language: config.language,
    });

    this.agent = agent;
    if (agent.sessionId && this.sessionId !== agent.sessionId) {
      this.sessionId = agent.sessionId;
    }
  }

  private resetSessionState(): void {
    this.messages = [];
    this.tasks = [];
    this.backgroundTasks = [];
    this.workflowRuns = [];
    this.sessionId = undefined;
    this.isStreaming = false;
    this.isCommandRunning = false;
    this.inputContent = '';
    this.messageQueue = [];
    this.pendingConfirmations.clear();
  }

  private async switchWorkdir(dir: string): Promise<void> {
    if (this.agent) {
      try { await this.agent.abortMessage(); } catch { /* best-effort */ }
      try { await this.agent.destroy(); } catch { /* best-effort */ }
      this.agent = null;
    }
    this.resetSessionState();
    this.workdir = dir;
    this.configStore.addRecentWorkdir(dir);
    this.sendWorkdirState();
    this.refreshSessionTree();
    try {
      await this.initializeAgent();
      await this.pushInitialState();
    } catch (error) {
      this.pushSystemMessage(`初始化失败：${error instanceof Error ? error.message : String(error)}`);
    }
  }

  // ------------------------------------------------------------------
  // Tool permission flow
  // ------------------------------------------------------------------

  private handleToolPermissionRequest(context: ToolPermissionContext): Promise<PermissionDecision> {
    return new Promise((resolve) => {
      const confirmationId = `confirmation_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;

      let confirmationType: string;
      if ([EDIT_TOOL_NAME, WRITE_TOOL_NAME].includes(context.toolName)) {
        confirmationType = '代码修改待确认';
      } else if (context.toolName === BASH_TOOL_NAME) {
        confirmationType = '命令执行待确认';
      } else if (context.toolName === EXIT_PLAN_MODE_TOOL_NAME || context.toolName === ENTER_PLAN_MODE_TOOL_NAME) {
        confirmationType = '计划待确认';
      } else if (context.toolName === ASK_USER_QUESTION_TOOL_NAME) {
        confirmationType = '问题待回答';
      } else {
        confirmationType = '操作待确认';
      }

      this.pendingConfirmations.set(confirmationId, {
        resolve,
        toolName: context.toolName,
        confirmationType,
        toolInput: context.toolInput,
        planContent: context.planContent,
        suggestedPrefix: context.suggestedPrefix,
        hidePersistentOption: context.hidePersistentOption,
      });

      this.postMessage({
        command: 'showConfirmation',
        confirmationId,
        toolName: context.toolName,
        confirmationType,
        toolInput: context.toolInput,
        planContent: context.planContent,
        suggestedPrefix: context.suggestedPrefix,
        hidePersistentOption: context.hidePersistentOption,
      });
    });
  }

  private handleConfirmationResponse(confirmationId: string, approved: boolean, decision?: PermissionDecision): void {
    const pending = this.pendingConfirmations.get(confirmationId);
    if (!pending) {
      console.warn('[DesktopHost] 收到未知确认响应:', confirmationId);
      return;
    }
    this.pendingConfirmations.delete(confirmationId);
    if (approved) {
      pending.resolve(decision ?? ({ behavior: 'allow' } as PermissionDecision));
    } else {
      pending.resolve({ behavior: 'deny', message: '用户拒绝了操作' } as PermissionDecision);
      void this.agent?.abortMessage();
    }
    this.postMessage({ command: 'focusInput' });
    this.postMessage({ command: 'scrollToBottom' });
  }

  // ------------------------------------------------------------------
  // Initial state / sessions
  // ------------------------------------------------------------------

  private async pushInitialState(): Promise<void> {
    const configurationData = this.configStore.getConfiguration();
    let isAuthenticated = false;
    try {
      const authResult = (await this.utilityClient.request('getAuthStatus')) as { isAuthenticated: boolean; serverUrl: string };
      isAuthenticated = authResult.isAuthenticated;
      if (authResult.serverUrl) {
        this.configStore.setConfiguration({ serverUrl: authResult.serverUrl });
        configurationData.serverUrl = authResult.serverUrl;
      }
    } catch (error) {
      console.error('[DesktopHost] Failed to get auth status on webview ready:', error);
    }

    const pendingConfirmations = Array.from(this.pendingConfirmations.entries()).map(([confirmationId, pending]) => ({
      confirmationId,
      toolName: pending.toolName,
      confirmationType: pending.confirmationType,
      toolInput: pending.toolInput,
      suggestedPrefix: pending.suggestedPrefix,
    }));

    this.postMessage({
      command: 'setInitialState',
      messages: this.messages,
      tasks: this.tasks,
      backgroundTasks: this.backgroundTasks,
      workflowRuns: this.workflowRuns,
      inputContent: this.inputContent,
      isStreaming: this.isStreaming,
      isCommandRunning: this.isCommandRunning,
      session: this.sessionId && this.agent ? {
        id: this.sessionId,
        sessionType: 'main',
        workdir: this.agent.workingDirectory,
        lastActiveAt: new Date(),
        latestTotalTokens: this.agent.latestTotalTokens,
      } : undefined,
      configurationData,
      pendingConfirmations,
      permissionMode: this.agent?.getPermissionMode(),
      queuedMessages: this.messageQueue,
      isAuthenticated,
      workdir: this.agent?.workingDirectory,
      theme: { effective: this.getCurrentEffectiveTheme() },
    });
  }

  /** Last N sessions shown per directory in the sidebar session tree (FR-020). */
  private static readonly SESSION_TREE_LIMIT = 5;

  /**
   * Refresh the sidebar session tree (FR-020). Data comes entirely from the
   * desktop session index (FR-024) — no stdio listSessions calls. Groups are
   * ordered by the recent-workdirs list; sessions within each group are sorted
   * by lastActiveAt descending and capped at SESSION_TREE_LIMIT.
   */
  private refreshSessionTree(): void {
    const recents = this.configStore.getRecentWorkdirs();
    if (recents.length === 0) {
      if (this.sessionTree.length > 0) {
        this.sessionTree = [];
        this.postMessage({ command: 'desktopSessionTree', groups: [] });
      }
      return;
    }
    const index = this.configStore.getSessionIndex();
    this.sessionTree = recents.map((dir) => ({
      workdir: dir,
      sessions: index
        .filter((s) => s.workdir === dir)
        .sort((a, b) => b.lastActiveAt - a.lastActiveAt)
        .slice(0, DesktopHost.SESSION_TREE_LIMIT)
        .map((s) => ({
          sessionId: s.sessionId,
          title: s.title,
          lastActiveAt: s.lastActiveAt,
          hasWorktree: !!s.worktree,
        })),
    }));
    this.postMessage({ command: 'desktopSessionTree', groups: this.sessionTree });
  }

  /** Upsert the current session into the desktop-owned session index (FR-024). */
  private registerSessionInIndex(sessionId: string): void {
    if (!this.workdir || !this.configStore) return;
    this.configStore.upsertSession({
      sessionId,
      title: '',
      workdir: this.workdir,
      cwd: this.workdir,
      lastActiveAt: Date.now(),
      worktree: this.worktreeInfo ?? undefined,
    });
    this.worktreeInfo = null;
  }

  /** Bump lastActiveAt (and title if known) after streaming settles. */
  private touchSessionInIndex(): void {
    if (!this.sessionId || !this.configStore) return;
    this.configStore.touchSession(this.sessionId, Date.now());
  }

  /** FR-025: remove from index; best-effort worktree+branch cleanup. */
  private async handleDeleteSession(sessionId: string): Promise<void> {
    if (!this.configStore) return;
    const entry = this.configStore.getSessionIndex().find((e) => e.sessionId === sessionId);
    this.configStore.removeSession(sessionId);
    if (entry?.worktree) {
      await this.removeWorktree({
        path: entry.worktree.path,
        branch: entry.worktree.branch,
        repoRoot: entry.worktree.repoRoot,
      });
    }
    this.refreshSessionTree();
  }

  /** FR-022/FR-023: create worktree via stdio, then switch into it. */
  private async handleCreateWorktree(
    workdir: string,
    baseBranch?: string,
    name?: string,
  ): Promise<void> {
    const result = (await this.utilityClient.request('createWorktree', { workdir, baseBranch, name })) as {
      name: string;
      path: string;
      branch: string;
      baseBranch: string;
      repoRoot: string;
    };
    this.worktreeInfo = {
      path: result.path,
      branch: result.branch,
      baseBranch: result.baseBranch,
      repoRoot: result.repoRoot,
    };
    await this.switchWorkdir(result.path);
  }

  /** FR-052 proxy: branch list for the new-session worktree selector. */
  private async handleListGitBranches(workdir: string): Promise<void> {
    try {
      const result = await this.utilityClient.request('listGitBranches', { workdir });
      this.postMessage({ command: 'desktopGitBranches', workdir, result });
    } catch {
      this.postMessage({ command: 'desktopGitBranches', workdir, result: null });
    }
  }

  /** Best-effort worktree removal via stdio (FR-053). */
  private async removeWorktree(params: { path: string; branch: string; repoRoot: string }): Promise<void> {
    try {
      await this.utilityClient.request('removeWorktree', params);
    } catch {
      // best-effort — stdio removeWorktree never throws
    }
  }

  private async refreshWorkflowRuns(): Promise<void> {
    if (!this.agent) return;
    this.workflowRuns = await this.agent.getWorkflowRuns();
    this.postMessage({ command: 'updateWorkflowRuns', runs: this.workflowRuns });
  }

  // ------------------------------------------------------------------
  // Webview message handling
  // ------------------------------------------------------------------

  async handleWebviewMessage(message: Record<string, unknown>): Promise<void> {
    const msg = message;
    switch (msg.command as string) {
      // -- desktop lifecycle & workdir management (FR-001/002/003) -----
      case 'desktopReady':
        // workdir is per-launch only (never persisted) — a fresh launch
        // always starts at the placeholder until the user picks a directory.
        this.sendWorkdirState();
        break;

      case 'desktopSelectWorkdir':
        await this.handleSelectWorkdir();
        break;

      case 'desktopSelectRecentWorkdir':
        await this.handleSelectRecentWorkdir(msg.path as string);
        break;

      case 'desktopRemoveRecentWorkdir':
        this.configStore.removeRecentWorkdir(msg.path as string);
        this.sendWorkdirState();
        this.refreshSessionTree();
        break;

      case 'desktopSelectSession':
        await this.handleSelectSession(msg.workdir as string, msg.sessionId as string);
        break;

      // -- chat lifecycle ----------------------------------------------
      case 'webviewReady':
        await this.handleWebviewReady();
        break;

      case 'sendMessage':
        await this.handleSendMessage(
          msg.text as string,
          msg.images as Array<{ data: string; mediaType: string }> | undefined,
          msg.force as boolean | undefined,
        );
        break;

      case 'abortMessage':
        await this.agent?.abortMessage();
        break;

      case 'clearChat':
        await this.handleClearChat();
        break;

      case 'compact':
        try {
          await this.agent?.compact((msg.customInstructions as string) || undefined);
        } catch (error) {
          this.pushSystemMessage(`压缩对话失败: ${error}`);
        }
        break;

      case 'rewindToMessage':
        await this.handleRewindToMessage(msg.messageId as string);
        break;

      case 'confirmationResponse':
        this.handleConfirmationResponse(
          msg.confirmationId as string,
          msg.approved as boolean,
          msg.decision as PermissionDecision | undefined,
        );
        break;

      case 'setPermissionMode':
        try {
          await this.agent?.setPermissionMode(msg.mode as PermissionMode);
        } catch (error) {
          this.pushSystemMessage(`设置权限模式失败: ${error}`);
        }
        break;

      // -- message queue -------------------------------------------------
      case 'deleteQueuedMessage':
        await this.agent?.removeQueuedMessage(msg.index as number);
        break;

      case 'updateQueuedMessage': {
        const ok = await this.agent?.updateQueuedMessageById(msg.id as string, {
          content: msg.text as string,
          images: msg.images as Array<{ path: string; mimeType: string }> | undefined,
        });
        if (!ok) {
          this.postMessage({ command: 'updateQueuedMessageMissing', id: msg.id });
        }
        break;
      }

      case 'deleteQueuedMessageById':
        await this.agent?.removeQueuedMessageById(msg.id as string);
        break;

      // -- sessions -------------------------------------------------------
      case 'desktopDeleteSession':
        await this.handleDeleteSession(msg.sessionId as string);
        break;

      case 'desktopCreateWorktree':
        await this.handleCreateWorktree(
          msg.workdir as string,
          msg.baseBranch as string | undefined,
          msg.name as string | undefined,
        );
        break;

      case 'desktopListGitBranches':
        await this.handleListGitBranches(msg.workdir as string);
        break;

      case 'restoreSession':
        await this.handleRestoreSession(msg.sessionId as string);
        break;

      // -- configuration (FR-006) ------------------------------------------
      case 'getConfiguration':
        this.postMessage({
          command: 'configurationResponse',
          configurationData: this.configStore.getConfiguration(),
        });
        break;

      case 'updateConfiguration':
        await this.handleUpdateConfiguration(msg.configurationData as DesktopConfigData);
        break;

      // -- status / updates (FR-009/010) -------------------------------------
      case 'getStatus':
        this.postMessage({
          command: 'statusResponse',
          version: app.getVersion(),
          sessionId: this.sessionId ?? '',
          workdir: this.agent?.workingDirectory ?? this.workdir ?? '',
          configurationData: this.configStore.getConfiguration(),
        });
        break;

      case 'checkForUpdates':
        await this.handleCheckForUpdates(true);
        break;

      // -- auth ----------------------------------------------------------------
      case 'getAuthStatus':
        await this.handleGetAuthStatus();
        break;

      case 'login':
        await this.handleLogin();
        break;

      case 'logout':
        await this.handleLogout();
        break;

      // -- MCP --------------------------------------------------------------------
      case 'getMcpServers': {
        const servers = this.agent ? await this.agent.getMcpServers() : [];
        this.postMessage({ command: 'mcpServersResponse', servers });
        break;
      }

      case 'connectMcpServer':
        try {
          await this.agent?.connectMcpServer(msg.serverName as string);
        } catch (error) {
          this.pushSystemMessage(`连接 MCP 服务器失败: ${error}`);
        }
        break;

      case 'disconnectMcpServer':
        try {
          await this.agent?.disconnectMcpServer(msg.serverName as string);
        } catch (error) {
          this.pushSystemMessage(`断开 MCP 服务器失败: ${error}`);
        }
        break;

      // -- plugins / marketplace ---------------------------------------------------
      case 'listPlugins':
        await this.handleListPlugins();
        break;

      case 'installPlugin':
        await this.handlePluginMutation('installPlugin', { pluginId: msg.pluginId, scope: msg.scope as Scope | undefined });
        break;

      case 'enablePlugin':
        await this.handlePluginMutation('enablePlugin', { pluginId: msg.pluginId, scope: msg.scope as Scope | undefined });
        break;

      case 'disablePlugin':
        await this.handlePluginMutation('disablePlugin', { pluginId: msg.pluginId, scope: msg.scope as Scope | undefined });
        break;

      case 'uninstallPlugin':
        await this.handlePluginMutation('uninstallPlugin', { pluginId: msg.pluginId });
        break;

      case 'updatePlugin':
        await this.handlePluginMutation('updatePlugin', { pluginId: msg.pluginId });
        break;

      case 'listMarketplaces':
        await this.handleListMarketplaces();
        break;

      case 'addMarketplace':
        await this.handleMarketplaceMutation('addMarketplace', { input: msg.input });
        break;

      case 'removeMarketplace':
        await this.handleMarketplaceMutation('removeMarketplace', { name: msg.name });
        break;

      case 'updateMarketplace':
        await this.handleMarketplaceMutation('updateMarketplace', { name: msg.name });
        break;

      // -- background tasks / workflows ----------------------------------------------
      case 'getBackgroundTaskOutput': {
        const output = this.agent ? await this.agent.getBackgroundTaskOutput(msg.taskId as string) : null;
        this.postMessage({ command: 'backgroundTaskOutput', taskId: msg.taskId, output });
        break;
      }

      case 'stopBackgroundTask': {
        const success = this.agent ? await this.agent.stopBackgroundTask(msg.taskId as string) : false;
        this.postMessage({ command: 'backgroundTaskStopped', taskId: msg.taskId, success });
        break;
      }

      case 'getWorkflowRuns': {
        const runs = this.agent ? await this.agent.getWorkflowRuns() : [];
        this.postMessage({ command: 'workflowRunsResponse', runs });
        break;
      }

      case 'stopWorkflowRun': {
        const success = this.agent ? await this.agent.stopWorkflowRun(msg.runId as string) : false;
        this.postMessage({ command: 'workflowRunStopped', runId: msg.runId, success });
        break;
      }

      // -- prompt history --------------------------------------------------------------
      case 'requestHistory':
        await this.handleRequestHistory();
        break;

      case 'searchHistory':
        await this.handleSearchHistory(msg.query as string);
        break;

      // -- file suggestions / uploads ---------------------------------------------------
      case 'requestFileSuggestions':
        await this.handleFileSuggestions(msg.filterText as string, msg.requestId as string);
        break;

      case 'uploadFilesToArtifacts':
        await this.handleUploadFilesToArtifacts(msg.files as Array<{ name: string; data: ArrayBuffer }>);
        break;

      // -- file / external link handling (FR-008) -----------------------------------------
      case 'openFile':
        await this.handleOpenPath(msg.path as string);
        break;

      case 'previewImage':
        await this.handleOpenPath(msg.path as string);
        break;

      case 'openExternal': {
        const url = msg.url as string;
        if (url && /^(https?|mailto):/.test(url)) {
          try {
            await shell.openExternal(url);
          } catch (error) {
            this.pushSystemMessage(`打开外部链接失败: ${error}`);
          }
        } else {
          console.warn('[DesktopHost] Refused to open external URL with unexpected scheme:', url);
        }
        break;
      }

      case 'downloadMermaid':
        await this.handleDownloadMermaid(msg.content as string, msg.format as 'svg' | 'png');
        break;

      case 'showError':
        console.error('[DesktopHost] Webview error:', msg.message);
        this.pushSystemMessage(`${msg.message as string}`);
        break;

      case 'updateInputContent':
        this.inputContent = (msg.content as string) ?? '';
        break;

      case 'requestSlashCommands':
        await this.handleSlashCommandsRequest(msg.filterText as string);
        break;

      default:
        console.warn('[DesktopHost] Unhandled webview command:', msg.command);
    }
  }

  // ------------------------------------------------------------------
  // Command handlers
  // ------------------------------------------------------------------

  private async handleWebviewReady(): Promise<void> {
    try {
      if (!this.workdir) {
        // No workdir selected yet — ensure the stdio client (so login/auth
        // still work) but skip agent creation until the user picks a workdir
        // from the sidebar dropdown.
        await this.ensureClient();
      } else if (!this.agent) {
        await this.initializeAgent();
      }
      await this.pushInitialState();
      this.refreshSessionTree();

      // Auto update check: once per app launch after the first agent is ready.
      if (!this.updateCheckTriggered) {
        this.updateCheckTriggered = true;
        this.handleCheckForUpdates(false).catch((err) => {
          console.warn('[DesktopHost] Update check failed:', err);
        });
      }
    } catch (error) {
      console.error('[DesktopHost] 初始化智能体失败:', error);
      this.pushSystemMessage(
        `初始化失败：${error instanceof Error ? error.message : String(error)}。可通过侧边栏切换工作目录重试，或重启应用`,
      );
    }
  }

  private async handleSelectWorkdir(): Promise<void> {
    if (!this.mainWindow) return;
    const result = await dialog.showOpenDialog(this.mainWindow, {
      title: '选择工作目录',
      properties: ['openDirectory', 'createDirectory'],
    });
    if (result.canceled || result.filePaths.length === 0) return;
    await this.switchWorkdir(result.filePaths[0]);
  }

  private async handleSelectRecentWorkdir(dir: string): Promise<void> {
    if (!fs.existsSync(dir)) {
      this.configStore.removeRecentWorkdir(dir);
      this.sendWorkdirState();
      this.refreshSessionTree();
      this.pushSystemMessage(`目录不存在：${dir}，已从最近列表移除`);
      return;
    }
    await this.switchWorkdir(dir);
  }

  /**
   * Open a session from the sidebar tree (FR-020). Switches workdir first when
   * the session lives in another directory, then restores it.
   */
  private async handleSelectSession(workdir: string, sessionId: string): Promise<void> {
    if (!workdir || !sessionId) return;
    if (!fs.existsSync(workdir)) {
      this.configStore.removeRecentWorkdir(workdir);
      this.sendWorkdirState();
      this.refreshSessionTree();
      this.pushSystemMessage(`目录不存在：${workdir}，已从最近列表移除`);
      return;
    }
    if (workdir !== this.workdir) {
      await this.switchWorkdir(workdir);
    }
    await this.handleRestoreSession(sessionId);
  }

  private async handleSendMessage(
    text: string,
    images?: Array<{ data: string; mediaType: string }>,
    force?: boolean,
  ): Promise<void> {
    if (!this.agent) {
      this.pushSystemMessage('请先选择工作目录');
      return;
    }

    try {
      const processedImages = images?.length
        ? images.map((image) => ({ path: image.data, mimeType: image.mediaType }))
        : undefined;

      if (text.startsWith('!')) {
        await this.agent.bang(text.slice(1));
      } else {
        await this.agent.sendMessage(text, processedImages, force ?? false);
      }
    } catch (error) {
      console.error('[DesktopHost] 发送消息失败:', error);
      this.pushSystemMessage(`发送消息失败: ${error}`);
    }
  }

  private async handleClearChat(): Promise<void> {
    if (this.agent) {
      this.forceNextUpdateImmediate = true;
      this.inputContent = '';
      await this.agent.clearMessages();
      this.throttledUpdateChatMessages([]);
    }
    await this.clearQueue();
  }

  private async clearQueue(): Promise<void> {
    if (this.agent && this.agent.queuedMessages.length > 0) {
      await this.agent.abortMessage();
    } else if (this.messageQueue.length > 0) {
      this.messageQueue = [];
      this.postMessage({ command: 'updateQueue', queue: this.messageQueue });
    }
  }

  private async handleRestoreSession(sessionId: string): Promise<void> {
    if (!sessionId || !this.agent) return;
    try {
      this.forceNextUpdateImmediate = true;
      this.inputContent = '';
      await this.agent.restoreSession(sessionId);
      this.throttledUpdateChatMessages(this.messages);
      await this.clearQueue();
      this.touchSessionInIndex();
      this.refreshSessionTree();
    } catch (error) {
      console.error('[DesktopHost] 恢复会话失败:', error);
      this.pushSystemMessage(`恢复会话失败: ${error}`);
    }
  }

  private async handleRewindToMessage(messageId: string): Promise<void> {
    if (!this.agent || !this.mainWindow) return;
    const { response } = await dialog.showMessageBox(this.mainWindow, {
      type: 'warning',
      message: '确定要回滚到此消息吗？这将删除之后的所有消息并撤销相关的文件更改。',
      buttons: ['取消', '确定'],
      defaultId: 0,
      cancelId: 0,
    });
    if (response !== 1) return;

    try {
      const { inputContent } = await this.agent.rewindToMessage(messageId);
      this.inputContent = inputContent;
      this.forceNextUpdateImmediate = true;
      this.throttledUpdateChatMessages(this.messages);
      await this.pushInitialState();
      this.postMessage({ command: 'focusInput' });
      this.postMessage({ command: 'scrollToBottom' });
    } catch (error) {
      console.error('[DesktopHost] 回滚会话失败:', error);
      this.pushSystemMessage(`回滚失败: ${error}`);
    }
  }

  private async handleUpdateConfiguration(configData: DesktopConfigData): Promise<void> {
    try {
      this.configStore.setConfiguration(configData);
      const config = this.configStore.getConfiguration();
      await this.updateAgentConfig(config);
      this.postMessage({ command: 'configurationUpdated' });
      this.postMessage({
        command: 'configurationResponse',
        configurationData: config,
      });
      this.postMessage({ command: 'focusInput' });
      this.postMessage({ command: 'scrollToBottom' });
    } catch (error) {
      console.error('[DesktopHost] Failed to save configuration:', error);
      this.postMessage({ command: 'configurationError', error: `Failed to save configuration: ${error}` });
    }
  }

  /** Server-side destroy + recreate with restored session (same as vsce updateAllSessionsConfig). */
  private async updateAgentConfig(config: DesktopConfigData): Promise<void> {
    if (!this.agent) return;
    if (this.isStreaming) {
      this.isStreaming = false;
      this.postMessage({ command: 'endStreaming' });
    }
    await this.agent.updateConfig({
      apiKey: config.apiKey || undefined,
      baseURL: config.baseURL || undefined,
      defaultHeaders: parseHeaders(config.headers),
      model: config.model,
      fastModel: config.fastModel,
      language: config.language,
    });
    await this.clearQueue();
  }

  private async handleCheckForUpdates(manual: boolean): Promise<void> {
    const info = await checkForUpdate(app.getVersion(), this.configStore.getConfiguration().serverUrl);
    if (info) {
      this.pushSystemMessage(`发现新版本 v${info.latestVersion}（当前 v${info.currentVersion}）：${info.downloadUrl}`);
    } else if (manual) {
      this.pushSystemMessage('当前已是最新版本');
    }
  }

  private async handleGetAuthStatus(): Promise<void> {
    try {
      const result = (await this.utilityClient.request('getAuthStatus')) as {
        isAuthenticated: boolean;
        user: { id: string; email?: string } | undefined;
        serverUrl: string;
      };
      if (result.serverUrl) {
        this.configStore.setConfiguration({ serverUrl: result.serverUrl });
      }
      this.postMessage({
        command: 'authStatusResponse',
        isAuthenticated: result.isAuthenticated,
        user: result.user,
        serverUrl: result.serverUrl,
      });
      this.postMessage({
        command: 'configurationResponse',
        configurationData: this.configStore.getConfiguration(),
      });
    } catch (error) {
      console.error('[DesktopHost] 获取认证状态失败:', error);
      this.postMessage({ command: 'authStatusResponse', isAuthenticated: false, user: null });
    }
  }

  private async handleLogin(): Promise<void> {
    try {
      const result = (await this.utilityClient.request('login')) as {
        user: { id: string; email?: string } | undefined;
      };
      this.postMessage({ command: 'loginResponse', success: true, user: result.user });
      // Reinitialize agent to pick up SSO config
      await this.updateAgentConfig(this.configStore.getConfiguration());
    } catch (error) {
      console.error('[DesktopHost] 登录失败:', error);
      this.postMessage({
        command: 'loginResponse',
        success: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private async handleLogout(): Promise<void> {
    try {
      await this.utilityClient.request('logout');
      this.postMessage({ command: 'logoutResponse', success: true });
      await this.updateAgentConfig(this.configStore.getConfiguration());
    } catch (error) {
      console.error('[DesktopHost] 登出失败:', error);
      this.postMessage({ command: 'logoutResponse', success: false, error: String(error) });
    }
  }

  private async handleListPlugins(): Promise<void> {
    try {
      const result = (await this.utilityClient.request('listPlugins', { workdir: this.workdir })) as { plugins: unknown[] };
      this.postMessage({ command: 'listPluginsResponse', plugins: result.plugins });
    } catch (error) {
      this.pushSystemMessage(`获取插件列表失败: ${error}`);
    }
  }

  private async handlePluginMutation(method: string, params: Record<string, unknown>): Promise<void> {
    try {
      await this.utilityClient.request(method, { ...params, workdir: this.workdir });
      await this.handleListPlugins();
      // Recreate agent to apply plugin changes
      await this.updateAgentConfig(this.configStore.getConfiguration());
    } catch (error) {
      this.pushSystemMessage(`插件操作失败: ${error}`);
    }
  }

  private async handleListMarketplaces(): Promise<void> {
    try {
      const marketplaces = await this.utilityClient.request('listMarketplaces', { workdir: this.workdir });
      this.postMessage({ command: 'listMarketplacesResponse', marketplaces });
    } catch (error) {
      this.pushSystemMessage(`获取市场列表失败: ${error}`);
    }
  }

  private async handleMarketplaceMutation(method: string, params: Record<string, unknown>): Promise<void> {
    try {
      await this.utilityClient.request(method, { ...params, workdir: this.workdir });
      await this.handleListMarketplaces();
    } catch (error) {
      this.pushSystemMessage(`市场操作失败: ${error}`);
    }
  }

  private async handleRequestHistory(): Promise<void> {
    try {
      const result = (await this.utilityClient.request('getPromptHistory')) as { history: unknown[] };
      this.postMessage({ command: 'historyResponse', history: result.history });
    } catch (error) {
      console.error('[DesktopHost] 获取历史记录失败:', error);
      this.postMessage({ command: 'historyError', error: `获取历史记录失败: ${error}` });
    }
  }

  private async handleSearchHistory(query: string): Promise<void> {
    try {
      const result = (await this.utilityClient.request('searchPromptHistory', { query })) as { history: unknown[] };
      this.postMessage({ command: 'historyResponse', history: result.history });
    } catch (error) {
      console.error('[DesktopHost] 搜索历史记录失败:', error);
      this.postMessage({ command: 'historyError', error: `搜索历史记录失败: ${error}` });
    }
  }

  private async handleFileSuggestions(filterText: string, requestId: string): Promise<void> {
    try {
      const suggestions = await this.findWorkspaceFiles(filterText);
      this.postMessage({
        command: 'fileSuggestionsResponse',
        suggestions,
        filterText,
        requestId,
      });
    } catch (error) {
      console.error('[DesktopHost] 获取文件建议失败:', error);
      this.postMessage({ command: 'fileSuggestionsError', error: `获取文件建议失败: ${error}`, requestId });
    }
  }

  private async findWorkspaceFiles(filterText: string): Promise<Record<string, string | boolean>[]> {
    if (!this.workdir) return [];
    try {
      const result = (await this.utilityClient.request('searchFiles', {
        query: filterText || '',
        maxResults: 20,
        workdir: this.workdir,
      })) as { files: Array<{ path: string; type: string }> };

      const allItems = result.files.map((item) => {
        const relativePath = item.path;
        const fullPath = path.join(this.workdir!, relativePath);
        const normalizedPath = relativePath.endsWith('/') ? relativePath.slice(0, -1) : relativePath;
        const name = path.basename(normalizedPath);
        const extensionMatch = name.match(/\.([^.]+)$/);
        const extension = extensionMatch ? extensionMatch[1] : '';
        const isDirectory = item.type === 'directory';
        return {
          path: fullPath,
          relativePath,
          name,
          extension,
          icon: isDirectory ? 'codicon-folder' : 'codicon-file',
          isDirectory,
        };
      });

      allItems.sort((a, b) => {
        const aNameMatch = (a.name as string).toLowerCase().startsWith((filterText || '').toLowerCase());
        const bNameMatch = (b.name as string).toLowerCase().startsWith((filterText || '').toLowerCase());
        if (aNameMatch && !bNameMatch) return -1;
        if (!aNameMatch && bNameMatch) return 1;
        if (a.isDirectory && !b.isDirectory) return -1;
        if (!a.isDirectory && b.isDirectory) return 1;
        return (a.name as string).localeCompare(b.name as string);
      });

      return allItems;
    } catch (error) {
      console.error('[DesktopHost] 搜索工作区文件失败:', error);
      return [];
    }
  }

  private async handleUploadFilesToArtifacts(files: Array<{ name: string; data: ArrayBuffer }>): Promise<void> {
    try {
      const artifactsDir = path.join(os.tmpdir(), 'wave-artifacts');
      if (!fs.existsSync(artifactsDir)) {
        fs.mkdirSync(artifactsDir, { recursive: true });
      }

      const uploadedFiles: string[] = [];
      const errors: string[] = [];

      for (const file of files) {
        try {
          const filePath = path.join(artifactsDir, file.name);
          let finalPath = filePath;
          let counter = 1;
          while (fs.existsSync(finalPath)) {
            const ext = path.extname(file.name);
            const baseName = path.basename(file.name, ext);
            finalPath = path.join(artifactsDir, `${baseName}_${counter}${ext}`);
            counter++;
          }
          fs.writeFileSync(finalPath, Buffer.from(file.data));
          uploadedFiles.push(finalPath);
        } catch (error) {
          errors.push(`${file.name}: ${error}`);
        }
      }

      if (uploadedFiles.length > 0) {
        this.postMessage({
          command: 'uploadSuccess',
          uploadedFiles,
          message: `成功上传 ${uploadedFiles.length} 个文件到临时目录`,
        });
      }
      if (errors.length > 0) {
        this.postMessage({
          command: 'uploadError',
          errors,
          message: `部分文件上传失败: ${errors.length} 个错误`,
        });
      }
    } catch (error) {
      console.error('[DesktopHost] 文件上传处理失败:', error);
      this.postMessage({ command: 'uploadError', error: `文件上传处理失败: ${error}` });
    }
  }

  private async handleOpenPath(filePath: string): Promise<void> {
    if (!filePath) return;
    try {
      const err = await shell.openPath(filePath);
      if (err) {
        this.pushSystemMessage(`打开文件失败: ${err}`);
      }
    } catch (error) {
      this.pushSystemMessage(`打开文件失败: ${error}`);
    }
  }

  private async handleDownloadMermaid(content: string, format: 'svg' | 'png'): Promise<void> {
    if (!this.mainWindow) return;
    const defaultFileName = `mermaid-diagram-${Date.now()}.${format}`;
    const defaultPath = this.workdir ? path.join(this.workdir, defaultFileName) : defaultFileName;

    const result = await dialog.showSaveDialog(this.mainWindow, {
      defaultPath,
      filters: format === 'svg' ? [{ name: 'SVG', extensions: ['svg'] }] : [{ name: 'PNG', extensions: ['png'] }],
    });
    if (result.canceled || !result.filePath) return;

    try {
      const data = format === 'svg'
        ? Buffer.from(content, 'utf8')
        : Buffer.from(content.split(',')[1], 'base64');
      await fs.promises.writeFile(result.filePath, data);
      this.pushSystemMessage(`图表已保存至: ${result.filePath}`);
    } catch (error) {
      console.error('[DesktopHost] 保存图表失败:', error);
      this.pushSystemMessage(`保存图表失败: ${error}`);
    }
  }

  private async handleSlashCommandsRequest(filterText: string): Promise<void> {
    try {
      const sdkCommands = this.agent ? await this.agent.getSlashCommands() : [];

      const localCommands = [
        { id: 'config', name: 'config', description: '打开配置设置' },
        { id: 'plugin', name: 'plugin', description: '打开插件管理' },
        { id: 'mcp', name: 'mcp', description: '打开 MCP 服务器管理' },
        { id: 'status', name: 'status', description: '查看当前状态' },
        { id: 'clear', name: 'clear', description: '清除对话历史并重置会话' },
        { id: 'compact', name: 'compact', description: '手动压缩对话历史' },
        { id: 'tasks', name: 'tasks', description: '查看后台任务' },
        { id: 'workflows', name: 'workflows', description: '查看工作流运行' },
      ];

      const allCommands = [...sdkCommands, ...localCommands];
      let filteredCommands = allCommands;
      if (filterText && filterText.trim().length > 0) {
        const filter = filterText.toLowerCase();
        filteredCommands = allCommands.filter((command) =>
          command.id.toLowerCase().includes(filter) || command.name.toLowerCase().includes(filter),
        );
      }
      const commands = filteredCommands.map((command) => ({
        id: command.id,
        name: command.name,
        description: command.description,
      }));
      this.postMessage({ command: 'slashCommandsResponse', commands });
    } catch (error) {
      console.error('[DesktopHost] 获取指令失败:', error);
      this.postMessage({ command: 'slashCommandsError', error: `获取指令失败: ${error}` });
    }
  }

  // ------------------------------------------------------------------
  // Throttled message updates (ported from vsce ChatSession)
  // ------------------------------------------------------------------

  private immediateUpdateChatMessages(): void {
    if (this.updateTimer) {
      clearTimeout(this.updateTimer);
      this.updateTimer = undefined;
    }
    this.pendingUpdate = false;
    this.postMessage({ command: 'updateMessages', messages: this.messages });
  }

  private throttledUpdateChatMessages(messages: Message[]): void {
    this.messages = messages;

    if (this.forceNextUpdateImmediate) {
      this.forceNextUpdateImmediate = false;
      this.immediateUpdateChatMessages();
      return;
    }

    // leading edge
    if (!this.pendingUpdate && !this.updateTimer) {
      this.postMessage({ command: 'updateMessages', messages: this.messages });
      this.pendingUpdate = true;
      // trailing edge after 300ms cooldown
      this.updateTimer = setTimeout(() => {
        this.postMessage({ command: 'updateMessages', messages: this.messages });
        this.pendingUpdate = false;
        this.updateTimer = undefined;
      }, 300);
    }
  }

  private throttledStreamingContentUpdate(messageId: string, accumulated: string, stage: 'streaming' | 'end'): void {
    if (stage === 'end') {
      if (this.streamingContentTimer) {
        clearTimeout(this.streamingContentTimer);
        this.streamingContentTimer = undefined;
      }
      this.pendingStreamingContent = undefined;
      this.postMessage({ command: 'updateStreamingContent', messageId, accumulated, stage });
      return;
    }

    this.pendingStreamingContent = { messageId, accumulated, stage };
    if (!this.streamingContentTimer) {
      this.postMessage({ command: 'updateStreamingContent', ...this.pendingStreamingContent });
      this.streamingContentTimer = setTimeout(() => {
        if (this.pendingStreamingContent) {
          this.postMessage({ command: 'updateStreamingContent', ...this.pendingStreamingContent });
          this.pendingStreamingContent = undefined;
        }
        this.streamingContentTimer = undefined;
      }, 16);
    }
  }

  private throttledStreamingReasoningUpdate(messageId: string, accumulated: string, stage: 'streaming' | 'end'): void {
    if (stage === 'end') {
      if (this.streamingReasoningTimer) {
        clearTimeout(this.streamingReasoningTimer);
        this.streamingReasoningTimer = undefined;
      }
      this.pendingStreamingReasoning = undefined;
      this.postMessage({ command: 'updateStreamingReasoning', messageId, accumulated, stage });
      return;
    }

    this.pendingStreamingReasoning = { messageId, accumulated, stage };
    if (!this.streamingReasoningTimer) {
      this.postMessage({ command: 'updateStreamingReasoning', ...this.pendingStreamingReasoning });
      this.streamingReasoningTimer = setTimeout(() => {
        if (this.pendingStreamingReasoning) {
          this.postMessage({ command: 'updateStreamingReasoning', ...this.pendingStreamingReasoning });
          this.pendingStreamingReasoning = undefined;
        }
        this.streamingReasoningTimer = undefined;
      }, 16);
    }
  }
}

function parseHeaders(headersStr?: string): Record<string, string> | undefined {
  if (!headersStr || !headersStr.trim()) {
    return undefined;
  }
  try {
    const headers: Record<string, string> = {};
    const lines = headersStr.split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) {
        continue;
      }
      const colonIndex = trimmed.indexOf(':');
      if (colonIndex === -1) {
        continue;
      }
      const key = trimmed.slice(0, colonIndex).trim();
      const value = trimmed.slice(colonIndex + 1).trim();
      if (key) {
        headers[key] = value;
      }
    }
    return Object.keys(headers).length > 0 ? headers : undefined;
  } catch (e) {
    console.error('[DesktopHost] Failed to parse headers:', e);
    return undefined;
  }
}
