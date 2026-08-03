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
import { ConfigStore, type DesktopConfigData, type SessionIndexEntry } from './configStore';
import { LOCAL_HOST, parseSshConfigHosts, addSshHost, buildSshSpawnArgs, withRemoteLoginShell } from './sshHosts';
import { resolveRemoteWaveBinary, remotePathExists, listRemoteDirs } from './remoteCli';
import { getWorkspaceDiff } from './gitDiff';
import { TerminalManager } from './terminal';
import { PortForwardManager } from './portForward';
import { checkForUpdate } from './updateChecker';
import { HOST_CHANNEL } from './channels';
import type { PanelKind } from './menu';

interface PendingConfirmation {
  resolve: (decision: PermissionDecision) => void;
  agent: StdioAgent;
  toolName: string;
  confirmationType: string;
  toolInput: unknown;
  planContent?: string;
  suggestedPrefix?: string;
  hidePersistentOption?: boolean;
}

interface WorktreeInfo {
  path: string;
  branch: string;
  baseBranch: string;
  repoRoot: string;
}

interface Pane {
  paneId: string;
  agent: StdioAgent | null;
  /** Width as a ratio of its row (sidebar/preview excluded); undefined = equal split. */
  width?: number;
  /** Pane row: 0 = top, 1 = bottom. Undefined = row 0. At most two rows. */
  row?: 0 | 1;
}

interface PaneThrottle {
  updateTimer?: NodeJS.Timeout;
  pendingUpdate: boolean;
  forceNextUpdateImmediate: boolean;
  streamingContentTimer?: NodeJS.Timeout;
  pendingStreamingContent?: { messageId: string; accumulated: string; stage: 'streaming' | 'end' };
  streamingReasoningTimer?: NodeJS.Timeout;
  pendingStreamingReasoning?: { messageId: string; accumulated: string; stage: 'streaming' | 'end' };
}
/** Minimum chat-pane width — mirrors the webview DesktopShell MIN_PANE_WIDTH. */
const MIN_PANE_WIDTH_PX = 360;
/** Minimum height of a pane row — mirrors the webview DesktopShell MIN_ROW_HEIGHT. */
const MIN_PANE_ROW_HEIGHT_PX = 280;
/** Fixed sidebar width — mirrors DesktopApp.css .desktop-sidebar. */
const SIDEBAR_WIDTH_PX = 240;
/** Float tolerance for ratio-vs-minimum comparisons. */
const WIDTH_EPSILON = 1e-9;

export class DesktopHost {
  private mainWindow: BrowserWindow | null = null;

  // stdio infrastructure
  private client: StdioClient | null = null;
  private router: NotificationRouter | null = null;
  private initPromise: Promise<void> | null = null;
  private cliVersion: string | null = null;

  // Remote (ssh) host infrastructure: host name → its own shared stdio
  // client. Each remote host runs its own `wave --stdio` over ssh, so sessions
  // on different hosts never share a process (spec scenario 9).
  private remoteHosts = new Map<
    string,
    { client: StdioClient | null; router: NotificationRouter | null; initPromise: Promise<void> }
  >();

  // agent pool (multi-session parallel): `${host}\u0000${sessionId}` → live
  // StdioAgent (composite key keeps sessions from different hosts distinct).
  // No capacity limit — agents live until their session is deleted or the app
  // exits. Panes bind agents for display; unbound agents keep streaming in
  // background.
  private agents = new Map<string, StdioAgent>();
  /** Side table: agent → host (local or an ssh config host name). */
  private agentHosts = new Map<StdioAgent, string>();
  /** Pending host selected in each pane's new-session workdir picker. */
  private hostState = new Map<string, string>();
  // Split panes, ordered left→right. Each pane binds at most one agent (none
  // in the new-session state); the focused pane receives sidebar clicks and
  // the 新对话 action. Always at least one pane.
  private panes: Pane[] = [{ paneId: 'pane-1', agent: null }];
  private focusedPaneId = 'pane-1';
  private paneCounter = 1;
  // Preview-pane width as last reported by the webview (0 = closed). Used to
  // deduct the preview from the chat area in min-pane-width checks.
  private previewWidthPx = 0;
  /** Top row's height as a fraction of the pane area; undefined while there is a single row. */
  private topRowHeight?: number;
  private inputDrafts = new Map<string, string>(); // keyed by paneId
  private agentWorktreeInfo = new Map<StdioAgent, WorktreeInfo>();
  private workdir: string | undefined;

  // Per-pane view state. messages/tasks/backgroundTasks/queuedMessages/isStreaming/
  // isCommandRunning/sessionId are derived from the pane's bound agent (its
  // StdioAgent cache); only fields the agent does not cache live here.
  private workflowRuns = new Map<string, SerializableWorkflowRun[]>(); // keyed by paneId
  private sessionTree: Array<{ host: string; workdir: string; sessions: Array<{ sessionId: string; title: string; lastActiveAt: number; hasWorktree: boolean; running: boolean }> }> = [];
  private pendingConfirmations = new Map<string, PendingConfirmation>();

  // Throttling state, per pane so concurrently streaming panes update
  // independently (same cadence as vsce ChatSession).
  private paneThrottles = new Map<string, PaneThrottle>();

  private updateCheckTriggered = false;
  private lastIsAuthenticated = false;

  /** Latest panel toggle state reported by each pane's webview (drives the 面板 menu). */
  private panePanelState = new Map<string, PanelKind[]>();

  /** Fired when the focused pane's panel state (or the focus itself) changes — rebuilds the app menu. */
  onPanelStateChanged: ((checked: PanelKind[]) => void) | null = null;

  /** PTY terminals keyed by webview termId (one per pane). */
  private terminalManager = new TerminalManager({
    onData: (termId, data) => this.postMessage({ command: 'desktopTerminalData', termId, data }),
    onExit: (termId, info) => this.postMessage({ command: 'desktopTerminalExit', termId, ...info }),
  });

  /** SSH tunnels serving remote preview URLs, refcounted per (host, remote port). */
  private portForwardManager = new PortForwardManager();

  /** Focused pane's agent — the default target for unscoped webview commands. */
  private get activeAgent(): StdioAgent | null {
    return this.panes.find((p) => p.paneId === this.focusedPaneId)?.agent ?? null;
  }

  /** Agent bound to a specific pane; no paneId resolves to the focused pane. */
  private agentForPane(paneId?: string): StdioAgent | null {
    if (paneId === undefined) return this.activeAgent;
    return this.panes.find((p) => p.paneId === paneId)?.agent ?? null;
  }

  /** Pane currently showing the given agent, if any. */
  private paneIdForAgent(agent: StdioAgent): string | undefined {
    return this.panes.find((p) => p.agent === agent)?.paneId;
  }

  /** Composite agent registry key — keeps hosts' sessionId namespaces apart. */
  private agentKey(host: string, sessionId: string): string {
    return `${host}\u0000${sessionId}`;
  }

  /** Host an agent runs on (local or an ssh config host name). */
  private hostForAgent(agent: StdioAgent | null): string {
    if (!agent) return LOCAL_HOST;
    return this.agentHosts.get(agent) ?? LOCAL_HOST;
  }

  /** Host in effect for a pane: its bound agent's host, else its pending picker host. */
  private hostForPane(paneId?: string): string {
    const agent = this.agentForPane(paneId);
    if (agent) return this.hostForAgent(agent);
    return this.hostState.get(paneId ?? this.focusedPaneId) ?? LOCAL_HOST;
  }

  /**
   * Host in effect for the whole host selector: the focused pane's agent host
   * (a live session pins the picker to its host), else the focused pane's
   * pending picker host. Defaults to 本地.
   */
  private get currentHost(): string {
    if (this.activeAgent) return this.hostForAgent(this.activeAgent);
    return this.hostState.get(this.focusedPaneId) ?? LOCAL_HOST;
  }

  private throttleFor(paneId: string): PaneThrottle {
    let t = this.paneThrottles.get(paneId);
    if (!t) {
      t = { pendingUpdate: false, forceNextUpdateImmediate: false };
      this.paneThrottles.set(paneId, t);
    }
    return t;
  }

  // Derived views over the active agent — its StdioAgent cache is the single
  // source of truth, so these are read-only getters (no duplicated host state).
  private get messages(): Message[] { return this.activeAgent?.messages ?? []; }
  private get tasks(): Task[] { return this.activeAgent?.tasks ?? []; }
  private get backgroundTasks(): BackgroundTaskSummary[] { return this.activeAgent?.backgroundTasks ?? []; }
  private get messageQueue(): QueuedMessage[] { return this.activeAgent?.queuedMessages ?? []; }
  private get sessionId(): string | undefined { return this.activeAgent?.sessionId; }
  private get isStreaming(): boolean { return this.activeAgent?.isStreaming ?? false; }
  private get isCommandRunning(): boolean { return this.activeAgent?.isCommandRunning ?? false; }

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
   * Menu enablement hook — index.ts assigns this to reflect pane/streaming
   * state in the application menu (新对话 / 关闭分屏).
   */
  onMenuStateChange?: (state: { canNewSession: boolean; canClosePane: boolean }) => void;

  /** 会话 → 新对话 (CmdOrCtrl+N): new session in the focused pane, same as the sidebar button. */
  async newSessionInFocusedPane(): Promise<void> {
    await this.handleNewSession(this.focusedPaneId);
  }

  /** 会话 → 并排新对话 (CmdOrCtrl+Shift+N): new session in a fresh pane, same as Cmd/Ctrl+Click on the sidebar button. */
  async newSessionInNewPane(): Promise<void> {
    await this.handleNewSessionInNewPane();
  }

  /**
   * 会话 → 关闭分屏 (CmdOrCtrl+W): close the focused pane. With multiple panes
   * this matches the pane close button; on the sole pane it resets that pane
   * to a fresh session. The detached agent is never destroyed — the session
   * keeps running in the background and stays in the sidebar.
   */
  async closeFocusedPane(): Promise<void> {
    if (this.panes.length > 1) {
      this.handleClosePane(this.focusedPaneId);
      return;
    }
    const pane = this.panes[0];
    if (pane?.agent) await this.handleNewSession(pane.paneId);
  }

  /**
   * Effective theme for the preload's sync IPC — applied to <html data-theme>
   * before first paint so the initial frame already matches the OS appearance
   * (FR-019, no light↔dark flash on launch).
   */
  getInitialEffectiveTheme(): 'light' | 'dark' {
    return this.getCurrentEffectiveTheme();
  }

  /** Graceful shutdown for app quit (FR-015): destroy every live agent. */
  async dispose(): Promise<void> {
    nativeTheme.off('updated', this.onNativeThemeUpdated);
    this.terminalManager.killAll();
    this.portForwardManager.dispose();
    for (const t of this.paneThrottles.values()) {
      for (const timer of [t.updateTimer, t.streamingContentTimer, t.streamingReasoningTimer]) {
        if (timer) clearTimeout(timer);
      }
    }
    this.paneThrottles.clear();
    await Promise.allSettled([...this.agents.values()].map((agent) => agent.destroy()));
    this.agents.clear();
    this.agentHosts.clear();
    this.panes = [{ paneId: 'pane-1', agent: null }];
    this.focusedPaneId = 'pane-1';
    this.hostState.clear();
    for (const { client } of this.remoteHosts.values()) {
      client?.dispose();
    }
    this.remoteHosts.clear();
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

  /** Toggle a panel on the focused pane — menu items and shortcuts share this path. */
  toggleFocusedPanePanel(kind: PanelKind): void {
    this.postMessage({ command: 'desktopTogglePanel', paneId: this.focusedPaneId, kind });
  }

  private emitPanelState(): void {
    this.onPanelStateChanged?.(this.panePanelState.get(this.focusedPaneId) ?? []);
  }

  /** Insert a host-generated system message into a pane's chat stream (focused pane by default). */
  private pushSystemMessage(content: string, paneId?: string): void {
    const targetPaneId = paneId ?? this.focusedPaneId;
    const agent = this.agentForPane(targetPaneId);
    const message = {
      id: `host-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      role: 'assistant',
      blocks: [{ type: 'text', content }],
      timestamp: new Date().toISOString(),
    } as unknown as Message;
    if (agent) {
      agent.messages = [...agent.messages, message];
    }
    this.postMessage({ command: 'appendMessage', paneId: targetPaneId, message });
  }

  private sendWorkdirState(): void {
    const host = this.currentHost;
    this.postMessage({
      command: 'desktopWorkdirState',
      workdir: this.workdir,
      host,
      hosts: parseSshConfigHosts(),
      recentWorkdirs: this.configStore.getRecentWorkdirsForHost(host),
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

  /** Ensure the shared stdio client for a host exists (local or remote). */
  private ensureClientFor(host: string): Promise<void> {
    if (host === LOCAL_HOST) return this.ensureClient();
    return this.ensureRemoteHostClient(host);
  }

  /**
   * Spawn a remote `wave --stdio` over ssh. Resolves the remote binary first
   * (probing `node -v` / `command -v wave`, auto-installing via npmmirror when
   * missing), then spawns `ssh <host> <wave> --stdio` as the host's shared
   * client. Failed init deletes the entry so a later attempt can retry.
   */
  private ensureRemoteHostClient(host: string): Promise<void> {
    const existing = this.remoteHosts.get(host);
    if (existing) return existing.initPromise;

    const entry: { client: StdioClient | null; router: NotificationRouter | null; initPromise: Promise<void> } = {
      client: null,
      router: null,
      initPromise: Promise.resolve(),
    };
    this.remoteHosts.set(host, entry);

    entry.initPromise = (async () => {
      const { binaryPath } = await resolveRemoteWaveBinary(host);
      // Run the remote wave under the user's login shell — its npm bin shim
      // (`#!/usr/bin/env node`) needs node on PATH, which nvm-style installs
      // only provide in interactive rc files.
      const remoteRun = await withRemoteLoginShell(host, `${binaryPath} --stdio`);
      const client = new StdioClient('ssh', buildSshSpawnArgs(host, remoteRun));
      const router = new NotificationRouter(client);
      router.registerGlobal('authUrl', (params) => {
        const p = params as { url?: string };
        if (p?.url) void shell.openExternal(p.url);
      });
      router.attach();
      entry.client = client;
      entry.router = router;
    })();

    entry.initPromise.catch(() => {
      // Allow retry after a failed init.
      this.remoteHosts.delete(host);
    });
    return entry.initPromise;
  }

  /** Resolve the (client, router) pair for a host, throwing if not initialized. */
  private clientFor(host: string): { client: StdioClient; router: NotificationRouter } {
    if (host === LOCAL_HOST) {
      if (!this.client || !this.router) throw new Error('StdioClient not initialized');
      return { client: this.client, router: this.router };
    }
    const entry = this.remoteHosts.get(host);
    if (!entry?.client || !entry.router) throw new Error(`StdioClient not initialized for host ${host}`);
    return { client: entry.client, router: entry.router };
  }

  /** Utility (non-session-scoped) client for a host — auth, plugins, git RPCs. */
  private utilityClientFor(host: string): StdioClient {
    return this.clientFor(host).client;
  }

  // ------------------------------------------------------------------
  // Agent pool lifecycle (multi-session parallel, FR-031)
  // ------------------------------------------------------------------

  /**
   * Callback factory: builds a StdioAgent whose view callbacks are routed to
   * the pane currently bound to this agent. While the agent is unbound
   * (background session), its incremental events never reach the webview, so
   * sessions never cross-talk. Tree/index callbacks run unconditionally
   * because the sidebar is a global view reflecting all sessions.
   */
  private createAgent(opts: { host: string; workdir?: string; worktreeInfo?: WorktreeInfo }): StdioAgent {
    const { client, router } = this.clientFor(opts.host);
    // The callbacks close over agentRef but only run after the constructor
    // returns, so the const binding is always initialized by call time.
    const paneIdOf = () => this.paneIdForAgent(agentRef);

    const callbacks: StdioAgentCallbacks = {
      // NOTE: onMessagesChange deliberately does NOT push the full list to the
      // view (the agent keeps its own cache). Every mutation also fires a
      // dedicated incremental callback (user/assistantMessageAdded, streaming,
      // toolBlockUpdated, bang…), so pushing the list here would make the
      // webview append each message twice. Full-list pushes happen explicitly
      // on restore / rewind / compact via pushPaneSessionState /
      // throttledUpdateChatMessages.
      onCompactBlockAdded: () => {
        const paneId = paneIdOf();
        if (!paneId) return;
        this.throttleFor(paneId).forceNextUpdateImmediate = true;
        this.throttledUpdateChatMessages(paneId);
      },
      onCompactionStateChange: (isCompacting: boolean) => {
        const paneId = paneIdOf();
        if (paneId) this.postMessage({ command: 'compactionStateChange', isCompacting, paneId });
      },
      onUserMessageAdded: (message: Message) => {
        const paneId = paneIdOf();
        if (paneId) this.postMessage({ command: 'appendMessage', paneId, message });
        this.ensureSessionRegistered(agentRef);
      },
      onAssistantMessageAdded: (message: Message) => {
        const paneId = paneIdOf();
        if (paneId) this.postMessage({ command: 'appendMessage', paneId, message });
      },
      onAssistantContentUpdated: (params) => {
        const paneId = paneIdOf();
        if (paneId) this.throttledStreamingContentUpdate(paneId, params.messageId, params.accumulated, params.stage);
      },
      onAssistantReasoningUpdated: (params) => {
        const paneId = paneIdOf();
        if (paneId) this.throttledStreamingReasoningUpdate(paneId, params.messageId, params.accumulated, params.stage);
      },
      onToolBlockUpdated: (params) => {
        const paneId = paneIdOf();
        if (paneId) this.postMessage({ command: 'updateToolBlock', paneId, params });
      },
      onErrorBlockAdded: (error: string) => {
        const paneId = paneIdOf();
        if (paneId) this.postMessage({ command: 'updateErrorBlock', paneId, error });
      },
      onTasksChange: (tasks: Task[]) => {
        const paneId = paneIdOf();
        if (paneId) this.postMessage({ command: 'updateTasks', paneId, tasks });
      },
      onBackgroundTasksChange: (tasks: BackgroundTaskSummary[]) => {
        const paneId = paneIdOf();
        if (!paneId) return;
        this.postMessage({ command: 'updateBackgroundTasks', paneId, tasks });
        void this.refreshWorkflowRuns(paneId);
      },
      onSessionIdChange: (sessionId: string) => {
        this.rekeyAgent(agentRef, sessionId);
        const paneId = paneIdOf();
        if (paneId) {
          this.postMessage({
            command: 'updateCurrentSession',
            paneId,
            session: {
              id: sessionId,
              sessionType: 'main',
              workdir: agentRef.workingDirectory,
              lastActiveAt: new Date(),
              latestTotalTokens: agentRef.latestTotalTokens ?? 0,
              firstMessage: this.configStore.getSessionIndex().find((e) => e.sessionId === sessionId)?.title || undefined,
            } as SessionMetadata,
          });
          this.pushPanes();
        }
        // /clear 换来的新空会话不进索引（否则侧边栏出现空标题条目）；与品牌
        // 新会话一致，待首条用户消息时由 ensureSessionRegistered 登记。
        if (agentRef.messages.length > 0) {
          this.registerSessionInIndex(agentRef, sessionId);
          this.refreshSessionTree();
        }
      },
      onPermissionModeChange: (mode: PermissionMode) => {
        const paneId = paneIdOf();
        if (paneId) this.postMessage({ command: 'updatePermissionMode', paneId, mode });
      },
      onWorkdirChange: (workdir: string) => {
        const paneId = paneIdOf();
        if (paneId) this.postMessage({ command: 'updateWorkdir', paneId, workdir });
      },
      onLoadingChange: (loading: boolean) => {
        // StdioAgent already wrote isStreaming on the agent; refresh the sidebar
        // running-dot for every session, not just the visible ones.
        const paneId = paneIdOf();
        if (paneId) this.postMessage({ command: loading ? 'startStreaming' : 'endStreaming', paneId });
        if (!loading) {
          this.touchSessionInIndex(agentRef);
        }
        this.refreshSessionTree();
      },
      onCommandRunningChange: (running: boolean) => {
        const paneId = paneIdOf();
        if (paneId) this.postMessage({ command: 'updateCommandRunning', paneId, running });
      },
      onQueuedMessagesChange: (messages: QueuedMessage[]) => {
        const paneId = paneIdOf();
        if (paneId) this.postMessage({ command: 'updateQueue', paneId, queue: messages });
      },
      onMcpServersChange: (servers: McpServerStatus[]) => {
        const paneId = paneIdOf();
        if (paneId) this.postMessage({ command: 'mcpServersUpdate', paneId, servers });
      },
      onBangMessageAdded: () => {
        const paneId = paneIdOf();
        if (paneId) this.postMessage({ command: 'updateMessages', paneId, messages: agentRef.messages });
      },
      onBangMessageUpdated: () => {
        const paneId = paneIdOf();
        if (paneId) this.postMessage({ command: 'updateMessages', paneId, messages: agentRef.messages });
      },
      onBangMessageCompleted: () => {
        const paneId = paneIdOf();
        if (paneId) this.postMessage({ command: 'updateMessages', paneId, messages: agentRef.messages });
      },
      onNotificationMessageAdded: (params) => {
        const paneId = paneIdOf();
        if (paneId && params.message) {
          this.postMessage({ command: 'appendMessage', paneId, message: params.message });
        }
      },
      onPermissionRequest: (requestId, context) => {
        void this.handleToolPermissionRequest(agentRef, context).then((decision) => {
          agentRef.sendPermissionResponse(requestId, decision);
        });
      },
    };

    const agentRef = new StdioAgent(client, router, callbacks);
    this.agentHosts.set(agentRef, opts.host);
    if (opts.worktreeInfo) this.agentWorktreeInfo.set(agentRef, opts.worktreeInfo);
    return agentRef;
  }

  /** Create + initialize a fresh agent and register it in the pool. */
  private async spawnAgent(opts: { host?: string; workdir?: string; worktreeInfo?: WorktreeInfo; worktreeName?: string; isNewWorktree?: boolean }): Promise<StdioAgent> {
    const host = opts.host ?? LOCAL_HOST;
    await this.ensureClientFor(host);
    const config = this.configStore.getConfiguration();
    const agent = this.createAgent({ ...opts, host });
    await agent.initialize({
      workdir: opts.workdir,
      apiKey: config.apiKey || undefined,
      defaultHeaders: parseHeaders(config.headers),
      baseURL: config.baseURL || undefined,
      model: config.model,
      fastModel: config.fastModel,
      language: config.language,
      worktreeName: opts.worktreeName,
      isNewWorktree: opts.isNewWorktree,
    });
    if (agent.sessionId) {
      this.agents.set(this.agentKey(host, agent.sessionId), agent);
    }
    return agent;
  }

  /** Bind an agent to a pane (replacing whatever it showed) and focus the pane. */
  private bindAgentToPane(paneId: string, agent: StdioAgent | null): void {
    const pane = this.panes.find((p) => p.paneId === paneId);
    if (!pane) return;
    // Panel groups follow the session, so the outgoing session's PTY dies with
    // the switch — the webview respawns one when the incoming session's group
    // has the terminal checked. A same-agent rebind keeps it alive.
    if (pane.agent !== agent) this.terminalManager.killForPane(paneId);
    this.clearThrottleState(paneId);
    pane.agent = agent;
    this.focusedPaneId = paneId;
    if (agent) this.touchAgentAsRecent(agent);
  }

  /**
   * Mark an agent as most-recently-used by moving it to the end of the pool
   * Map — iteration order doubles as the recency order activateWorkdir uses
   * to pick a reusable session.
   */
  private touchAgentAsRecent(agent: StdioAgent): void {
    const key = this.agentKey(this.hostForAgent(agent), agent.sessionId ?? '');
    if (!agent.sessionId || this.agents.get(key) !== agent) return;
    this.agents.delete(key);
    this.agents.set(key, agent);
  }

  /** Point a pane at an agent: sync workdir context, refresh sidebar, push its state. */
  private async activateAgentInPane(paneId: string, agent: StdioAgent): Promise<void> {
    this.bindAgentToPane(paneId, agent);
    this.hostState.set(paneId, this.hostForAgent(agent));
    const dir = agent.workingDirectory;
    if (dir && dir !== this.workdir) {
      // this.workdir follows the focused pane's real cwd (used by the file
      // list / diff / terminal panels). It is NOT the source for new-session
      // spawn cwd — that comes exclusively from the user's recents (see
      // handleNewSession). Session activation must never write recents: the
      // list reflects only directories the user deliberately opened, so a
      // session whose cwd drifted into a worktree path (e.g. bash cd) can't
      // pollute it. See desktop-app.md「会话管理」scenario 9.
      this.workdir = dir;
    }
    this.sendWorkdirState();
    this.refreshSessionTree();
    this.pushPanes();
    await this.pushPaneSessionState(paneId);
    this.postMessage({ command: 'scrollToBottom', paneId });
    this.postMessage({ command: 'focusInput', paneId });
  }

  /** Push the pane layout (rows, order, session bindings, widths, focus) to the webview. */
  private pushPanes(): void {
    this.postMessage({
      command: 'desktopPanes',
      panes: this.panes.map((p) => ({
        paneId: p.paneId,
        sessionId: p.agent?.sessionId,
        host: p.agent ? this.hostForAgent(p.agent) : (this.hostState.get(p.paneId) ?? LOCAL_HOST),
        width: p.width,
        row: p.row ?? 0,
      })),
      rowHeights: this.topRowHeight != null ? [this.topRowHeight, 1 - this.topRowHeight] : undefined,
      focusedPaneId: this.focusedPaneId,
    });
    this.emitMenuState();
  }

  /** Menu enablement — index.ts reflects this in the application menu. */
  private emitMenuState(): void {
    this.onMenuStateChange?.({
      // 新对话 is always available (like the sidebar button) — a streaming
      // session keeps generating in the background while the pane switches.
      canNewSession: true,
      // Multiple panes: close removes one. Sole pane: close resets it, which
      // is only meaningful while it still shows a session.
      canClosePane: this.panes.length > 1 || this.panes[0]?.agent != null,
    });
  }

  /** Focus a pane: it becomes the target for sidebar clicks and 新对话. */
  private handleFocusPane(paneId: string): void {
    if (!this.panes.some((p) => p.paneId === paneId)) return;
    if (this.focusedPaneId === paneId) return;
    this.focusedPaneId = paneId;
    const dir = this.activeAgent?.workingDirectory;
    if (dir) this.workdir = dir;
    // Always push: switching panes may also switch the pane's host, and the
    // workdir picker must reflect the newly focused pane's recents.
    this.sendWorkdirState();
    this.pushPanes();
    this.emitPanelState();
    // The newly focused pane may run on a different host — re-query that
    // host's auth status so the sidebar 更多 menu's 登录/退出登录 entry shows
    // the new host's state, not the previous pane's cached value (spec SSO
    // scenario 6). Same pattern as handleSelectHost.
    const host = this.hostForPane(paneId);
    this.ensureClientFor(host)
      .then(() => this.refreshAuthStatus(host))
      .catch((error) => {
        this.pushSystemMessage(
          `连接主机 ${host} 失败：${error instanceof Error ? error.message : String(error)}`,
        );
      });
  }

  /**
   * Open a session in a new pane (Cmd/Ctrl+Click on a sidebar session, or a
   * sidebar drag-drop). A session already visible in a pane focuses that pane
   * instead of duplicating it. Pane placement/overflow rules live in
   * insertNewPane; a drag drop passes an explicit target row/position and is
   * always honored — the row scrolls horizontally below the min width, same
   * as pane moves.
   */
  private async handleOpenPane(workdir: string, sessionId: string, opts?: unknown): Promise<void> {
    if (!sessionId) return;
    const existing = this.panes.find((p) => p.agent?.sessionId === sessionId);
    if (existing) {
      this.handleFocusPane(existing.paneId);
      this.postMessage({ command: 'focusInput', paneId: existing.paneId });
      return;
    }
    const o = (opts ?? {}) as { insertionIndex?: unknown; row?: unknown; newRow?: unknown };
    const insertionIndex = typeof o.insertionIndex === 'number' && Number.isFinite(o.insertionIndex)
      ? Math.trunc(o.insertionIndex) : undefined;
    const optRow = o.row === 0 || o.row === 1 ? o.row : undefined;
    const newRow = o.newRow === 'above' || o.newRow === 'below' ? o.newRow : undefined;
    const paneId = this.insertNewPane({ insertionIndex, row: optRow, newRow });
    if (!paneId) return;
    await this.bindSessionToPane(paneId, workdir, sessionId);
  }

  /**
   * Insert a fresh (unbound) pane into the layout and focus it. Shared by
   * Cmd/Ctrl+Click session open (handleOpenPane) and new-session-in-pane.
   * `opts.insertionIndex` inserts at a position within the target row;
   * `opts.row` picks the row (default: the focused pane's row); `opts.newRow`
   * ('above'|'below') splits the single row into two and puts the new pane
   * alone in the fresh row. Without an explicit target the pane spills into
   * the other row (or a fresh second row) when the focused row is full, and
   * the insertion is refused only when nothing fits. Existing panes in the
   * target row shrink proportionally so the layout keeps the user's manual
   * ratios. Returns the new paneId, or null when refused (a lightweight
   * system message has already been shown).
   */
  private insertNewPane(opts: { insertionIndex?: number; row?: 0 | 1; newRow?: 'above' | 'below' } = {}): string | null {
    const { insertionIndex, row: optRow, newRow } = opts;
    const hasSecondRow = this.panes.some((p) => p.row === 1);
    const paneId = `pane-${++this.paneCounter}`;

    if (newRow && !hasSecondRow) {
      // Split the single row into two; the new pane is alone in its fresh row.
      if (!this.canSplitRows()) {
        this.pushSystemMessage('窗口高度不足，无法拆分为两行', this.focusedPaneId);
        return null;
      }
      if (newRow === 'above') this.panes.forEach((p) => { p.row = 1; });
      this.panes.push({ paneId, agent: null, row: newRow === 'above' ? 0 : 1 });
    } else {
      // A drag drop names its target row and skips the width gate; a click
      // overflows into the other row, a fresh second row, or a refusal.
      const named = optRow !== undefined;
      let targetRow = optRow ?? (newRow === 'above' ? 0 : newRow === 'below' ? 1 : this.rowOfPane(this.focusedPaneId));
      if (!named && !this.canAddPane(targetRow)) {
        const otherRow = targetRow === 0 ? 1 : 0;
        if (hasSecondRow && this.canAddPane(otherRow)) {
          targetRow = otherRow;
        } else if (!hasSecondRow && this.canSplitRows()) {
          targetRow = 1;
        } else {
          this.pushSystemMessage(
            hasSecondRow ? '窗口宽度不足，无法添加更多分屏' : '空间不足，无法添加更多分屏',
            this.focusedPaneId,
          );
          return null;
        }
      }
      const rowPanes = this.panes.filter((p) => (p.row ?? 0) === targetRow);
      const count = rowPanes.length;
      const widths = rowPanes.map((p) => p.width ?? 1 / count);
      rowPanes.forEach((p, i) => { p.width = widths[i] * (count / (count + 1)); });
      const at = insertionIndex === undefined ? count : Math.max(0, Math.min(count, insertionIndex));
      rowPanes.splice(at, 0, { paneId, agent: null, width: 1 / (count + 1), row: targetRow });
      const others = this.panes.filter((p) => (p.row ?? 0) !== targetRow);
      this.panes = targetRow === 0 ? [...rowPanes, ...others] : [...others, ...rowPanes];
    }
    this.focusedPaneId = paneId;
    this.normalizePaneRows();
    this.pushPanes();
    this.emitPanelState();
    return paneId;
  }

  /**
   * Min-width gate for adding a pane to a row: every pane in that row (current
   * + new) must fit at MIN_PANE_WIDTH_PX within the chat area (window minus
   * sidebar and the preview pane). The webview applies the same rule on its
   * measured row, so this is the authoritative backstop.
   */
  private canAddPane(row: 0 | 1): boolean {
    if (!this.mainWindow) return true;
    const [windowWidth] = this.mainWindow.getContentSize();
    if (!windowWidth) return true;
    const chatArea = windowWidth - SIDEBAR_WIDTH_PX - this.previewWidthPx;
    const rowCount = this.panes.filter((p) => (p.row ?? 0) === row).length;
    return chatArea / (rowCount + 1) >= MIN_PANE_WIDTH_PX - WIDTH_EPSILON;
  }

  /** Min-height gate for splitting into two rows (each at least MIN_PANE_ROW_HEIGHT_PX). */
  private canSplitRows(): boolean {
    if (!this.mainWindow) return true;
    const [, windowHeight] = this.mainWindow.getContentSize();
    if (!windowHeight) return true;
    return windowHeight / 2 >= MIN_PANE_ROW_HEIGHT_PX;
  }

  /** The row a pane sits in; unknown panes report the top row. */
  private rowOfPane(paneId: string): 0 | 1 {
    return this.panes.find((p) => p.paneId === paneId)?.row ?? 0;
  }

  /**
   * Keep the layout invariant: panes sequenced row-major (row 0 first), a row
   * 1 without any row-0 pane is promoted to row 0, and the top-row height
   * fraction exists exactly while two rows do.
   */
  private normalizePaneRows(): void {
    let row0 = this.panes.filter((p) => (p.row ?? 0) === 0);
    const row1 = this.panes.filter((p) => p.row === 1);
    if (row0.length === 0 && row1.length > 0) {
      row1.forEach((p) => { p.row = 0; });
      row0 = row1;
    }
    this.panes = row1.length > 0 && row1 !== row0 ? [...row0, ...row1] : row0;
    if (this.panes.some((p) => p.row === 1)) {
      if (this.topRowHeight == null) this.topRowHeight = 0.5;
    } else {
      this.topRowHeight = undefined;
    }
  }

  /** Redistribute a row's widths so they sum to 1 (after a pane leaves it). */
  private renormalizeRowWidths(row: 0 | 1): void {
    const rowPanes = this.panes.filter((p) => (p.row ?? 0) === row);
    if (rowPanes.length === 0 || rowPanes.every((p) => p.width === undefined)) return;
    const sum = rowPanes.reduce<number>((total, p) => total + (p.width ?? 0), 0);
    if (sum > WIDTH_EPSILON) rowPanes.forEach((p) => { p.width = (p.width ?? 0) / sum; });
  }

  /**
   * Move a pane (drag the pane header). `toRow`+`toIndex` inserts it at a
   * position within the target row (cross-row moves shrink the target row and
   * re-expand the source row proportionally); `newRow` ('above'|'below')
   * splits the single row into two with the pane alone in the fresh row.
   */
  private handleMovePane(paneId: string, opts: { toRow?: unknown; toIndex?: unknown; newRow?: unknown }): void {
    const from = this.panes.findIndex((p) => p.paneId === paneId);
    if (from === -1) return;
    const fromRow = this.panes[from].row ?? 0;
    const newRow = opts.newRow === 'above' || opts.newRow === 'below' ? opts.newRow : undefined;
    const toRow = opts.toRow === 0 || opts.toRow === 1 ? opts.toRow : undefined;
    const toIndex = typeof opts.toIndex === 'number' && Number.isFinite(opts.toIndex)
      ? Math.trunc(opts.toIndex) : undefined;
    const hasSecondRow = this.panes.some((p) => p.row === 1);

    // Split into two rows: the moved pane becomes the sole member of its row.
    const wantsSplit = (newRow != null && !hasSecondRow)
      || (toRow != null && toRow !== fromRow && !this.panes.some((p) => (p.row ?? 0) === toRow));
    if (wantsSplit) {
      if (this.panes.length <= 1) return;
      if (!this.canSplitRows()) {
        this.pushSystemMessage('窗口高度不足，无法拆分为两行', this.focusedPaneId);
        return;
      }
      const targetRow = newRow != null ? (newRow === 'above' ? 0 : 1) : toRow!;
      const [moved] = this.panes.splice(from, 1);
      moved.row = targetRow;
      moved.width = undefined;
      this.panes.forEach((p) => { p.row = targetRow === 0 ? 1 : 0; });
      this.renormalizeRowWidths(targetRow === 0 ? 1 : 0);
      this.panes.push(moved);
      this.normalizePaneRows();
      this.pushPanes();
      return;
    }
    if (toIndex === undefined) return;

    const targetRow = toRow ?? fromRow;
    const [moved] = this.panes.splice(from, 1);
    if (targetRow === fromRow) {
      const rowPanes = this.panes.filter((p) => (p.row ?? 0) === fromRow);
      const at = Math.max(0, Math.min(rowPanes.length, toIndex));
      rowPanes.splice(at, 0, moved);
      const others = this.panes.filter((p) => (p.row ?? 0) !== fromRow);
      this.panes = fromRow === 0 ? [...rowPanes, ...others] : [...others, ...rowPanes];
    } else {
      this.renormalizeRowWidths(fromRow);
      const rowPanes = this.panes.filter((p) => (p.row ?? 0) === targetRow);
      const count = rowPanes.length;
      rowPanes.forEach((p) => { p.width = (p.width ?? 1 / count) * (count / (count + 1)); });
      moved.row = targetRow;
      moved.width = 1 / (count + 1);
      const at = Math.max(0, Math.min(count, toIndex));
      rowPanes.splice(at, 0, moved);
      const others = this.panes.filter((p) => (p.row ?? 0) !== targetRow);
      this.panes = targetRow === 0 ? [...rowPanes, ...others] : [...others, ...rowPanes];
    }
    this.pushPanes();
  }

  /** Apply separator-drag widths for one row (ratios in that row's order, normalized here). */
  private handleResizePanes(widths: unknown, row: unknown): void {
    const r = row === 1 ? 1 : 0;
    const rowPanes = this.panes.filter((p) => (p.row ?? 0) === r);
    if (!Array.isArray(widths) || widths.length !== rowPanes.length) return;
    if (widths.some((w) => typeof w !== 'number' || !Number.isFinite(w) || w <= 0)) return;
    const sum = widths.reduce((total: number, w: number) => total + w, 0);
    if (sum <= WIDTH_EPSILON) return;
    rowPanes.forEach((p, i) => { p.width = widths[i] / sum; });
    this.pushPanes();
  }

  /** Apply row-separator drag heights ([top, bottom] px or ratios, normalized here). */
  private handleResizePaneRows(heights: unknown): void {
    if (!Array.isArray(heights) || heights.length !== 2) return;
    if (heights.some((h) => typeof h !== 'number' || !Number.isFinite(h) || h <= 0)) return;
    if (!this.panes.some((p) => p.row === 1)) return;
    const sum = heights[0] + heights[1];
    this.topRowHeight = heights[0] / sum;
    this.pushPanes();
  }

  /**
   * Close a pane. The bound agent is never destroyed — the session keeps
   * running in the background and stays in the sidebar. The last remaining
   * pane cannot be closed.
   */
  private handleClosePane(paneId: string): void {
    if (this.panes.length <= 1) return;
    const idx = this.panes.findIndex((p) => p.paneId === paneId);
    if (idx === -1) return;
    this.terminalManager.killForPane(paneId);
    this.clearThrottleState(paneId);
    const closedRow = this.panes[idx].row ?? 0;
    this.panes.splice(idx, 1);
    this.inputDrafts.delete(paneId);
    this.workflowRuns.delete(paneId);
    this.hostState.delete(paneId);
    // The closed pane's width returns to its row-mates proportionally; an
    // untouched equal-split row (no explicit widths) stays equal-split.
    this.renormalizeRowWidths(closedRow);
    this.normalizePaneRows();
    this.panePanelState.delete(paneId);
    if (this.focusedPaneId === paneId) {
      const neighbor = this.panes[Math.min(idx, this.panes.length - 1)];
      this.focusedPaneId = neighbor.paneId;
      const dir = neighbor.agent?.workingDirectory;
      if (dir) this.workdir = dir;
      this.sendWorkdirState();
      this.postMessage({ command: 'focusInput', paneId: neighbor.paneId });
      this.emitPanelState();
    }
    this.pushPanes();
  }

  /**
   * Bind an existing session to a pane: reuse a live agent from the pool when
   * possible, otherwise spawn + restore it, then activate in the pane.
   */
  private async bindSessionToPane(paneId: string, workdir: string, sessionId: string): Promise<void> {
    const entry = this.configStore.getSessionIndex().find((e) => e.sessionId === sessionId);
    const host = entry?.host ?? LOCAL_HOST;
    let agent = this.agents.get(this.agentKey(host, sessionId));
    if (!agent) {
      // Worktree sessions are grouped under the repo root in the sidebar, but
      // their session files live at the worktree path — resolve the real
      // directory the same way handleSelectSession does, otherwise restore
      // looks in the wrong project store and the pane stays a new session.
      const targetDir = entry?.worktree ? entry.cwd : workdir;
      try {
        agent = await this.spawnAgent({ host, workdir: targetDir, worktreeInfo: entry?.worktree });
        await agent.restoreSession(sessionId);
        if (agent.sessionId) {
          this.rekeyAgent(agent, agent.sessionId);
        }
      } catch (error) {
        // The pane stays open (empty) so the layout is stable.
        this.pushSystemMessage(`恢复会话失败：${error instanceof Error ? error.message : String(error)}`, paneId);
        this.pushPanes();
        return;
      }
    }
    this.hostState.set(paneId, host);
    await this.activateAgentInPane(paneId, agent);
  }

  /** Lazily-created per-pane throttle state. */
  private paneThrottle(paneId: string): PaneThrottle {
    let t = this.paneThrottles.get(paneId);
    if (!t) {
      t = { pendingUpdate: false, forceNextUpdateImmediate: false };
      this.paneThrottles.set(paneId, t);
    }
    return t;
  }

  /** Clear a pane's throttle timers/pending slots (before rebind or close). */
  private clearThrottleState(paneId: string): void {
    const t = this.paneThrottles.get(paneId);
    if (!t) return;
    for (const timer of [t.updateTimer, t.streamingContentTimer, t.streamingReasoningTimer]) {
      if (timer) clearTimeout(timer);
    }
    this.paneThrottles.delete(paneId);
  }

  private messagesForPane(paneId: string): Message[] {
    return this.agentForPane(paneId)?.messages ?? [];
  }

  private tasksForPane(paneId: string): Task[] {
    return this.agentForPane(paneId)?.tasks ?? [];
  }

  private backgroundTasksForPane(paneId: string): BackgroundTaskSummary[] {
    return this.agentForPane(paneId)?.backgroundTasks ?? [];
  }

  /** Re-register an agent under a new sessionId (keys are host-scoped). */
  private rekeyAgent(agent: StdioAgent, newSessionId: string): void {
    const host = this.hostForAgent(agent);
    let oldKey: string | undefined;
    for (const [key, a] of this.agents) {
      if (a === agent) { oldKey = key; break; }
    }
    const newKey = this.agentKey(host, newSessionId);
    if (oldKey && oldKey !== newKey) {
      this.agents.delete(oldKey);
    }
    this.agents.set(newKey, agent);
  }

  /**
   * Switch a pane into a directory (FR-031). Existing agents are never
   * destroyed — the most recently activated live session in this directory is
   * reused when present (and not already shown in another pane), otherwise a
   * fresh agent is spawned.
   */
  private async activateWorkdir(opts: { host?: string; dir: string; forceNew?: boolean; paneId?: string }): Promise<void> {
    const { dir, forceNew = false } = opts;
    const host = opts.host ?? LOCAL_HOST;
    const paneId = opts.paneId ?? this.focusedPaneId;
    this.workdir = dir;
    this.configStore.addRecentWorkdir({ host, path: dir });

    if (!forceNew) {
      // Pool iteration order is recency order (bindAgentToPane re-keys), so
      // the last match is the most recently activated session in this dir.
      // Only reuse agents running on the same host — a local and a remote
      // session in the same path are different processes (spec scenario 9).
      let best: StdioAgent | null = null;
      for (const agent of this.agents.values()) {
        if (this.hostForAgent(agent) !== host) continue;
        if (agent.workingDirectory !== dir) continue;
        // Never steal an agent shown in another pane — one session, one pane.
        if (this.panes.some((p) => p.agent === agent && p.paneId !== paneId)) continue;
        best = agent;
      }
      if (best) {
        await this.activateAgentInPane(paneId, best);
        return;
      }
    }

    try {
      const agent = await this.spawnAgent({ host, workdir: dir });
      await this.activateAgentInPane(paneId, agent);
    } catch (error) {
      this.pushSystemMessage(`初始化失败：${error instanceof Error ? error.message : String(error)}`, paneId);
    }
  }

  // ------------------------------------------------------------------
  // Tool permission flow
  // ------------------------------------------------------------------

  private handleToolPermissionRequest(agent: StdioAgent, context: ToolPermissionContext): Promise<PermissionDecision> {
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
        agent,
        toolName: context.toolName,
        confirmationType,
        toolInput: context.toolInput,
        planContent: context.planContent,
        suggestedPrefix: context.suggestedPrefix,
        hidePersistentOption: context.hidePersistentOption,
      });
      this.refreshSessionTree();

      // Only a visible session pops the dialog; a background session's request
      // stays pending and is surfaced when the user switches back to it.
      const paneId = this.paneIdForAgent(agent);
      if (paneId) {
        this.postMessage({
          command: 'showConfirmation',
          paneId,
          confirmationId,
          toolName: context.toolName,
          confirmationType,
          toolInput: context.toolInput,
          planContent: context.planContent,
          suggestedPrefix: context.suggestedPrefix,
          hidePersistentOption: context.hidePersistentOption,
        });
      }
    });
  }

  private handleConfirmationResponse(confirmationId: string, approved: boolean, decision?: PermissionDecision): void {
    const pending = this.pendingConfirmations.get(confirmationId);
    if (!pending) {
      console.warn('[DesktopHost] 收到未知确认响应:', confirmationId);
      return;
    }
    this.pendingConfirmations.delete(confirmationId);
    this.refreshSessionTree();
    if (approved) {
      pending.resolve(decision ?? ({ behavior: 'allow' } as PermissionDecision));
    } else {
      pending.resolve({ behavior: 'deny', message: '用户拒绝了操作' } as PermissionDecision);
      void pending.agent.abortMessage();
    }
    const paneId = this.paneIdForAgent(pending.agent) ?? this.focusedPaneId;
    this.postMessage({ command: 'focusInput', paneId });
    this.postMessage({ command: 'scrollToBottom', paneId });
  }

  // ------------------------------------------------------------------
  // Initial state / sessions
  // ------------------------------------------------------------------

  private async pushInitialState(): Promise<void> {
    const configurationData = this.configStore.getConfiguration();
    let isAuthenticated = false;
    try {
      const authResult = (await this.utilityClientFor(this.currentHost).request('getAuthStatus')) as { isAuthenticated: boolean; serverUrl: string };
      isAuthenticated = authResult.isAuthenticated;
      if (authResult.serverUrl) {
        this.configStore.setConfiguration({ serverUrl: authResult.serverUrl });
        configurationData.serverUrl = authResult.serverUrl;
      }
    } catch (error) {
      console.error('[DesktopHost] Failed to get auth status on webview ready:', error);
    }
    this.lastIsAuthenticated = isAuthenticated;
    await this.pushPaneSessionState(this.focusedPaneId);
  }

  /**
   * Push one pane's cached state to the webview (tagged with paneId). Unlike
   * pushInitialState this does NOT re-query auth/config — used on session,
   * workdir and pane switches where only the view changes.
   */
  private async pushPaneSessionState(paneId: string): Promise<void> {
    const configurationData = this.configStore.getConfiguration();
    const agent = this.agentForPane(paneId);
    const pendingConfirmations = Array.from(this.pendingConfirmations.entries())
      .filter(([, pending]) => pending.agent === agent)
      .map(([confirmationId, pending]) => ({
        confirmationId,
        toolName: pending.toolName,
        confirmationType: pending.confirmationType,
        toolInput: pending.toolInput,
        suggestedPrefix: pending.suggestedPrefix,
      }));

    if (agent) {
      const runs = await agent.getWorkflowRuns().catch(() => this.workflowRuns.get(paneId) ?? []);
      this.workflowRuns.set(paneId, runs);
    }

    this.postMessage({
      command: 'setInitialState',
      paneId,
      messages: this.messagesForPane(paneId),
      tasks: this.tasksForPane(paneId),
      backgroundTasks: this.backgroundTasksForPane(paneId),
      workflowRuns: this.workflowRuns.get(paneId) ?? [],
      inputContent: this.inputDrafts.get(paneId) ?? '',
      isStreaming: agent?.isStreaming ?? false,
      isCommandRunning: agent?.isCommandRunning ?? false,
      isCompacting: agent?.isCompacting ?? false,
      session: agent?.sessionId ? {
        id: agent.sessionId,
        sessionType: 'main',
        workdir: agent.workingDirectory,
        lastActiveAt: new Date(),
        latestTotalTokens: agent.latestTotalTokens,
        // Backfill the header title from the session index: after compaction
        // the pushed messages start at the compact boundary, so the webview
        // can no longer derive the first user message itself.
        firstMessage: this.configStore.getSessionIndex().find((e) => e.sessionId === agent.sessionId)?.title || undefined,
      } : undefined,
      configurationData,
      pendingConfirmations,
      permissionMode: agent?.getPermissionMode(),
      queuedMessages: agent?.queuedMessages ?? [],
      isAuthenticated: this.lastIsAuthenticated,
      workdir: agent?.workingDirectory,
      theme: { effective: this.getCurrentEffectiveTheme() },
    });
  }

  /**
   * Refresh the sidebar session tree (FR-020). Data comes entirely from the
   * desktop session index (FR-024) — no stdio listSessions calls and no
   * recent-workdirs involvement. Groups are derived by clustering index
   * entries on `workdir`, ordered by each group's latest `createdAt`
   * descending; sessions within each group are sorted by `createdAt`
   * descending. The order is stable — only creating or deleting a session
   * moves entries — so the keyboard cycle order always matches what the
   * sidebar shows.
   */
  private refreshSessionTree(): void {
    const index = this.configStore.getSessionIndex();
    // Sessions on different hosts never share a group, even at the same path.
    const byGroup = new Map<string, SessionIndexEntry[]>();
    for (const entry of index) {
      const key = `${entry.host}\u0000${entry.workdir}`;
      const list = byGroup.get(key);
      if (list) {
        list.push(entry);
      } else {
        byGroup.set(key, [entry]);
      }
    }
    if (byGroup.size === 0) {
      if (this.sessionTree.length > 0) {
        this.sessionTree = [];
        this.postMessage({ command: 'desktopSessionTree', groups: [] });
      }
      return;
    }
    const sortedGroups = [...byGroup.values()].map((entries) => {
      const sorted = entries.sort((a, b) => b.createdAt - a.createdAt);
      return { host: sorted[0].host, workdir: sorted[0].workdir, sorted };
    });
    sortedGroups.sort((a, b) => b.sorted[0].createdAt - a.sorted[0].createdAt);
    const agentsWithPendingConfirmation = new Set(
      [...this.pendingConfirmations.values()].map((p) => p.agent),
    );
    this.sessionTree = sortedGroups.map(({ host, workdir, sorted }) => ({
      host,
      workdir,
      sessions: sorted.map((s) => {
        const agent = this.agents.get(this.agentKey(s.host, s.sessionId));
        return {
          sessionId: s.sessionId,
          title: s.title,
          lastActiveAt: s.lastActiveAt,
          hasWorktree: !!s.worktree,
          running: agent?.isStreaming ?? false,
          waitingConfirmation: agent ? agentsWithPendingConfirmation.has(agent) : false,
        };
      }),
    }));
    this.postMessage({ command: 'desktopSessionTree', groups: this.sessionTree });
  }

  /** Upsert an agent's session into the desktop-owned session index (FR-024). */
  private registerSessionInIndex(agent: StdioAgent, sessionId: string, title = ''): void {
    const cwd = agent.workingDirectory;
    if (!cwd || !this.configStore) return;
    const existing = this.configStore.getSessionIndex().find((e) => e.sessionId === sessionId);
    // An agent without worktree context must never clobber the persisted
    // worktree info of an existing entry.
    const worktreeInfo = this.agentWorktreeInfo.get(agent) ?? existing?.worktree;
    // Worktree sessions group under the original repo root (workdir) while the
    // agent's actual working directory (cwd) stays the worktree path (FR-024).
    this.configStore.upsertSession({
      sessionId,
      host: this.hostForAgent(agent),
      // An established title wins; a re-registration must never wipe it.
      title: title || existing?.title || '',
      workdir: worktreeInfo?.repoRoot ?? cwd,
      cwd,
      // First registration pins the creation time; re-registrations keep it so
      // sidebar order only changes when a session is created or deleted.
      createdAt: existing?.createdAt ?? Date.now(),
      lastActiveAt: Date.now(),
      worktree: worktreeInfo,
    });
  }

  /**
   * FR-024: the CLI assigns the sessionId during initialize() without emitting
   * sessionIdChange, so a brand-new session never reaches the index through
   * that notification. Register it once real content exists (first user
   * message / restored history), deriving the sidebar title from the first
   * user message — the same 30-char rule the webview header uses.
   */
  private ensureSessionRegistered(agent: StdioAgent): void {
    const sessionId = agent.sessionId;
    if (!sessionId || !this.configStore) return;
    const existing = this.configStore.getSessionIndex().find((e) => e.sessionId === sessionId);
    if (existing?.title) return;
    this.registerSessionInIndex(agent, sessionId, sessionTitleFromMessages(agent.messages));
    this.refreshSessionTree();
  }

  /** Bump lastActiveAt after streaming settles. */
  private touchSessionInIndex(agent: StdioAgent): void {
    if (!agent.sessionId || !this.configStore) return;
    this.configStore.touchSession(agent.sessionId, Date.now());
  }

  /**
   * FR-025: destroy the live agent (if any), remove from index, best-effort
   * worktree+branch cleanup. Deleting the active session moves to a fresh page
   * — back to the repo root for a worktree session, otherwise a new session.
   */
  private async handleDeleteSession(sessionId: string): Promise<void> {
    if (!this.configStore) return;
    const entry = this.configStore.getSessionIndex().find((e) => e.sessionId === sessionId);
    const host = entry?.host ?? LOCAL_HOST;
    const target = this.agents.get(this.agentKey(host, sessionId));
    const boundPaneIds = this.panes
      .filter((p) => p.agent !== null && (p.agent === target || p.agent.sessionId === sessionId))
      .map((p) => p.paneId);

    if (target) {
      this.agents.delete(this.agentKey(host, sessionId));
      this.agentHosts.delete(target);
      this.agentWorktreeInfo.delete(target);
    }

    // Every pane showing the deleted session closes; a sole pane resets to a
    // fresh session below instead. Detach before the reset and destroy in the
    // background: Agent.destroy() is slow (telemetry shutdown, MCP/LSP
    // cleanup), and awaiting it here would let the replacement view below
    // clobber a session the user selects in the meantime.
    let resetSolePane = false;
    for (const paneId of boundPaneIds) {
      // Kill the pane's PTY before any worktree cleanup below — a shell still
      // sitting in the worktree directory would break its removal.
      this.terminalManager.killForPane(paneId);
      if (this.panes.length > 1) {
        this.handleClosePane(paneId);
      } else {
        this.bindAgentToPane(paneId, null);
        resetSolePane = true;
      }
    }
    // Destroy the agent BEFORE removing its worktree directory. The agent's
    // cwd is the worktree path, and Agent.destroy() flushes the session file
    // (which resolves the worktree path via realpath). Previously destroy and
    // removeWorktree raced as independent fire-and-forget calls — the fast
    // `git worktree remove` deleted the directory before the slow destroy
    // reached saveSession, leaving it failing ENOENT and losing the trailing
    // messages. Keep both backgrounded (no UI block) but sequence them:
    // removeWorktree runs only after destroy resolves. destroy() does not
    // dispose the shared stdio client, so the connection stays alive for
    // removeWorktree to reuse.
    const destroyPromise = target
      ? target.destroy().catch(() => { /* best-effort */ })
      : Promise.resolve();

    this.configStore.removeSession(sessionId);
    // Update the sidebar right away — the worktree cleanup below runs in the
    // background and must not hold back the tree refresh.
    this.refreshSessionTree();

    if (resetSolePane) {
      if (entry?.worktree && await this.pathExistsOn(host, entry.worktree.repoRoot)) {
        await this.activateWorkdir({ host, dir: entry.worktree.repoRoot, forceNew: true });
      } else {
        await this.handleNewSession();
      }
    }

    const worktree = entry?.worktree;
    if (worktree) {
      void destroyPromise.then(() =>
        this.removeWorktree(host, {
          path: worktree.path,
          branch: worktree.branch,
          repoRoot: worktree.repoRoot,
        }),
      );
    }
  }

  /**
   * FR-022/FR-023: create worktree via stdio, then switch into it. When the
   * caller passed a first message (worktree checkbox + send in one go), forward
   * it after the switch so the session starts in the worktree.
   */
  private async handleCreateWorktree(
    workdir: string,
    baseBranch?: string,
    name?: string,
    text?: string,
    images?: Array<{ data: string; mediaType: string }>,
    host?: string,
  ): Promise<void> {
    const h = host ?? this.currentHost;
    let result: {
      name: string;
      path: string;
      branch: string;
      baseBranch: string;
      repoRoot: string;
      isNew: boolean;
    };
    try {
      result = (await this.utilityClientFor(h).request('createWorktree', { workdir, baseBranch, name })) as typeof result;
    } catch (error) {
      this.pushSystemMessage(`创建 worktree 失败：${error instanceof Error ? error.message : String(error)}`);
      return;
    }
    let agent: StdioAgent;
    try {
      agent = await this.spawnAgent({
        host: h,
        workdir: result.path,
        // Only a genuinely new worktree fires the WorktreeCreate hook during
        // agent initialization (same as `wave -w`).
        worktreeName: result.name,
        isNewWorktree: result.isNew,
        worktreeInfo: {
          path: result.path,
          branch: result.branch,
          baseBranch: result.baseBranch,
          repoRoot: result.repoRoot,
        },
      });
      await this.activateAgentInPane(this.focusedPaneId, agent);
    } catch (error) {
      this.pushSystemMessage(`初始化失败：${error instanceof Error ? error.message : String(error)}`);
      return;
    }
    if (text) {
      await this.handleSendMessage(text, images);
    }
  }

  /** FR-052 proxy: branch list for the new-session worktree selector. The
   * reply carries paneId so each pane consumes only its own branch list — a
   * sibling pane focusing and re-querying must not overwrite this pane. */
  private async handleListGitBranches(workdir: string, paneId?: string): Promise<void> {
    const h = this.hostForPane(paneId);
    try {
      // A fresh launch's first query (webview mount) can land before
      // webviewReady has spawned the stdio client. Await the client instead of
      // replying null — the webview never re-queries on a null reply, which
      // would leave the branch/worktree controls hidden until the user
      // re-picks a workdir.
      await this.ensureClientFor(h);
      const result = await this.utilityClientFor(h).request('listGitBranches', { workdir });
      this.postMessage({ command: 'desktopGitBranches', workdir, paneId, result });
    } catch {
      this.postMessage({ command: 'desktopGitBranches', workdir, paneId, result: null });
    }
  }

  /** Best-effort worktree removal via stdio (FR-053), routed to the entry's host. */
  private async removeWorktree(host: string, params: { path: string; branch: string; repoRoot: string }): Promise<void> {
    try {
      await this.utilityClientFor(host).request('removeWorktree', params);
    } catch {
      // best-effort — stdio removeWorktree never throws
    }
  }

  private async refreshWorkflowRuns(paneId: string): Promise<void> {
    const agent = this.agentForPane(paneId);
    if (!agent) return;
    const runs = await agent.getWorkflowRuns();
    this.workflowRuns.set(paneId, runs);
    this.postMessage({ command: 'updateWorkflowRuns', paneId, runs });
  }

  // ------------------------------------------------------------------
  // Webview message handling
  // ------------------------------------------------------------------

  async handleWebviewMessage(message: Record<string, unknown>): Promise<void> {
    const msg = message;
    // Pane the webview command targets (defaults to the focused pane).
    const pid = (msg.paneId as string) || this.focusedPaneId;
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

      case 'desktopSelectHost':
        await this.handleSelectHost(msg.host as string);
        break;

      case 'desktopAddHost':
        await this.handleAddHost(msg.connectionString as string);
        break;

      case 'desktopSelectRemotePath':
        await this.handleSelectRemotePath(msg.host as string, msg.path as string);
        break;

      case 'desktopListRemoteDir':
        await this.handleListRemoteDir(msg.host as string, msg.path as string, msg.requestId as string);
        break;

      case 'desktopSelectRecentWorkdir':
        await this.handleSelectRecentWorkdir(msg.path as string, msg.host as string | undefined);
        break;

      case 'desktopRemoveRecentWorkdir':
        this.configStore.removeRecentWorkdir({ host: (msg.host as string) ?? this.currentHost, path: msg.path as string });
        this.sendWorkdirState();
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
          pid,
        );
        break;

      case 'abortMessage':
        await this.agentForPane(pid)?.abortMessage();
        break;

      case 'clearChat': {
        // 与 IDE 插件对齐：/clear 原地清空当前会话（agent.clearMessages 会
        // 中止进行中的生成并换新 sessionId），不 spawn 新 agent。消息列表的
        // 全量推送走显式 updateMessages（agent 的 messagesChange 缓存不直推）。
        const agent = this.agentForPane(pid);
        if (agent) {
          await agent.clearMessages();
          this.throttleFor(pid).forceNextUpdateImmediate = true;
          this.throttledUpdateChatMessages(pid);
        }
        break;
      }

      case 'newSession':
        await this.handleNewSession(pid);
        break;

      case 'desktopNewSessionInPane':
        await this.handleNewSessionInNewPane();
        break;

      case 'compact':
        try {
          await this.agentForPane(pid)?.compact((msg.customInstructions as string) || undefined);
        } catch (error) {
          this.pushSystemMessage(`压缩对话失败: ${error}`, pid);
        }
        break;

      case 'rewindToMessage':
        await this.handleRewindToMessage(msg.messageId as string, pid);
        break;

      case 'listRewindCheckpoints':
        await this.handleListRewindCheckpoints(pid);
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
          await this.agentForPane(pid)?.setPermissionMode(msg.mode as PermissionMode);
        } catch (error) {
          this.pushSystemMessage(`设置权限模式失败: ${error}`, pid);
        }
        break;

      // -- message queue -------------------------------------------------
      case 'deleteQueuedMessage':
        await this.agentForPane(pid)?.removeQueuedMessage(msg.index as number);
        break;

      case 'updateQueuedMessage': {
        const ok = await this.agentForPane(pid)?.updateQueuedMessageById(msg.id as string, {
          content: msg.text as string,
          images: msg.images as Array<{ path: string; mimeType: string }> | undefined,
        });
        if (!ok) {
          this.postMessage({ command: 'updateQueuedMessageMissing', paneId: pid, id: msg.id });
        }
        break;
      }

      case 'deleteQueuedMessageById':
        await this.agentForPane(pid)?.removeQueuedMessageById(msg.id as string);
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
          msg.text as string | undefined,
          msg.images as Array<{ data: string; mediaType: string }> | undefined,
          msg.host as string | undefined,
        );
        break;

      case 'desktopListGitBranches':
        await this.handleListGitBranches(msg.workdir as string, msg.paneId as string | undefined);
        break;

      // Read-only workspace diff for the diff panel — runs git directly in
      // the main process rather than via the stdio CLI (large output, and
      // the CLI has no reusable implementation). Remote sessions run the git
      // and file reads over ssh (spec scenario 14).
      case 'desktopGetWorkspaceDiff': {
        const paneAgent = this.agentForPane(pid);
        const cwd = paneAgent?.workingDirectory ?? this.workdir;
        const result = cwd
          ? await getWorkspaceDiff(cwd, this.hostForAgent(paneAgent))
          : ({ kind: 'not-a-repo' } as const);
        this.postMessage({ command: 'desktopWorkspaceDiff', paneId: pid, result });
        break;
      }

      // -- terminal panel ---------------------------------------------------
      case 'desktopTerminalCreate': {
        const paneAgent = this.agentForPane(pid);
        const cwd = paneAgent?.workingDirectory ?? this.workdir;
        if (!cwd) {
          this.postMessage({
            command: 'desktopTerminalExit',
            termId: msg.termId,
            error: '无法确定终端工作目录',
          });
          break;
        }
        await this.terminalManager.create(
          msg.termId as string,
          cwd,
          (msg.cols as number) || 80,
          (msg.rows as number) || 24,
          pid,
          this.hostForAgent(paneAgent),
        );
        break;
      }

      case 'desktopTerminalInput':
        this.terminalManager.write(msg.termId as string, msg.data as string);
        break;

      case 'desktopTerminalResize':
        this.terminalManager.resize(msg.termId as string, msg.cols as number, msg.rows as number);
        break;

      case 'desktopTerminalKill':
        this.terminalManager.kill(msg.termId as string);
        break;

      // Remote preview: forward a localhost URL over ssh and load the
      // rewritten loopback address (spec scenario 15-18). The webview sends
      // the host it computed (effectiveHost); defaults to the pane's host.
      case 'desktopForwardPort': {
        const host = (msg.host as string) || this.hostForPane(pid);
        try {
          const result = await this.portForwardManager.acquire(host, msg.url as string);
          this.postMessage({
            command: 'desktopForwardPortResult',
            paneId: pid,
            requestId: msg.requestId,
            url: result.url,
            originalUrl: result.originalUrl,
          });
        } catch (error) {
          this.postMessage({
            command: 'desktopForwardPortResult',
            paneId: pid,
            requestId: msg.requestId,
            error: error instanceof Error ? error.message : String(error),
          });
        }
        break;
      }

      case 'desktopReleasePort':
        // Host is required: the pane may have already switched sessions/hosts
        // by the time the webview releases the reference.
        this.portForwardManager.release(msg.host as string, msg.remotePort as number);
        break;

      // Pane panel toggle state — drives the 面板 menu checkboxes.
      case 'desktopPanelState': {
        this.panePanelState.set(pid, (msg.checked as PanelKind[]) ?? []);
        if (pid === this.focusedPaneId) this.emitPanelState();
        break;
      }

      case 'desktopOpenPane':
        await this.handleOpenPane(msg.workdir as string, msg.sessionId as string, {
          insertionIndex: msg.insertionIndex,
          row: msg.row,
          newRow: msg.newRow,
        });
        break;

      case 'desktopClosePane':
        this.handleClosePane(msg.paneId as string);
        break;

      case 'desktopFocusPane':
        this.handleFocusPane(msg.paneId as string);
        break;

      case 'desktopMovePane':
        this.handleMovePane(msg.paneId as string, { toRow: msg.toRow, toIndex: msg.toIndex, newRow: msg.newRow });
        break;

      case 'desktopResizePanes':
        this.handleResizePanes(msg.widths, msg.row);
        break;

      case 'desktopResizePaneRows':
        this.handleResizePaneRows(msg.heights);
        break;

      case 'desktopPreviewState':
        // The preview pane reports its width (0 = closed) so the min-pane-width
        // gate can deduct it from the chat area.
        this.previewWidthPx = typeof msg.width === 'number' && msg.width > 0 ? msg.width : 0;
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
      case 'getStatus': {
        const paneAgent = this.agentForPane(pid);
        this.postMessage({
          command: 'statusResponse',
          version: app.getVersion(),
          sessionId: paneAgent?.sessionId ?? '',
          workdir: paneAgent?.workingDirectory ?? this.workdir ?? '',
          configurationData: this.configStore.getConfiguration(),
        });
        break;
      }

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
        const paneAgent = this.agentForPane(pid);
        const servers = paneAgent ? await paneAgent.getMcpServers() : [];
        this.postMessage({ command: 'mcpServersResponse', paneId: pid, servers });
        break;
      }

      case 'connectMcpServer':
        try {
          await this.agentForPane(pid)?.connectMcpServer(msg.serverName as string);
        } catch (error) {
          this.pushSystemMessage(`连接 MCP 服务器失败: ${error}`, pid);
        }
        break;

      case 'disconnectMcpServer':
        try {
          await this.agentForPane(pid)?.disconnectMcpServer(msg.serverName as string);
        } catch (error) {
          this.pushSystemMessage(`断开 MCP 服务器失败: ${error}`, pid);
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

      case 'getProjectSettings':
        await this.handleGetProjectSettings(pid);
        break;

      case 'setBuiltinPluginEnabled':
        await this.handleSetBuiltinPluginEnabled(
          pid,
          msg.pluginId as string,
          msg.enabled as boolean,
          msg.scope as Scope | undefined,
        );
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
        const paneAgent = this.agentForPane(pid);
        const output = paneAgent ? await paneAgent.getBackgroundTaskOutput(msg.taskId as string) : null;
        this.postMessage({ command: 'backgroundTaskOutput', paneId: pid, taskId: msg.taskId, output });
        break;
      }

      case 'stopBackgroundTask': {
        const paneAgent = this.agentForPane(pid);
        const success = paneAgent ? await paneAgent.stopBackgroundTask(msg.taskId as string) : false;
        this.postMessage({ command: 'backgroundTaskStopped', paneId: pid, taskId: msg.taskId, success });
        break;
      }

      case 'getWorkflowRuns': {
        const paneAgent = this.agentForPane(pid);
        const runs = paneAgent ? await paneAgent.getWorkflowRuns() : [];
        this.postMessage({ command: 'workflowRunsResponse', paneId: pid, runs });
        break;
      }

      case 'stopWorkflowRun': {
        const paneAgent = this.agentForPane(pid);
        const success = paneAgent ? await paneAgent.stopWorkflowRun(msg.runId as string) : false;
        this.postMessage({ command: 'workflowRunStopped', paneId: pid, runId: msg.runId, success });
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
        this.inputDrafts.set(pid, (msg.content as string) ?? '');
        break;

      case 'requestSlashCommands':
        await this.handleSlashCommandsRequest(msg.filterText as string, pid);
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
      const host = this.currentHost;
      if (!this.workdir) {
        // No workdir selected yet — ensure the stdio client (so login/auth
        // still work) but skip agent creation until the user picks a workdir
        // from the sidebar dropdown.
        await this.ensureClientFor(host);
      } else if (this.panes.every((p) => !p.agent)) {
        // First-time bootstrap only: spawn at the chosen workdir when NO pane
        // holds an agent yet. A repeat webviewReady (e.g. a new pane mounting
        // while another pane still runs a worktree session) must not re-spawn —
        // this.workdir may be a stale worktree path from the focused pane, and
        // the new pane's agent is already being spawned by handleNewSessionInNewPane.
        const agent = await this.spawnAgent({ host, workdir: this.workdir });
        this.bindAgentToPane(this.focusedPaneId, agent);
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

  /** Check a directory exists on a host — local via fs, remote via `test -d`. */
  private async pathExistsOn(host: string, dir: string): Promise<boolean> {
    if (host === LOCAL_HOST) return fs.existsSync(dir);
    return remotePathExists(host, dir);
  }

  /**
   * Re-query the auth status on `host` and push it to the webview. Called when
   * the picker switches to a host: lastIsAuthenticated is cached at
   * webview-ready against the then-current host, so without this the welcome
   * page keeps showing the previous host's 登录 button.
   */
  private async refreshAuthStatus(host: string): Promise<void> {
    try {
      const authResult = (await this.utilityClientFor(host).request('getAuthStatus')) as {
        isAuthenticated: boolean;
        user?: { id: string; email?: string };
        serverUrl: string;
      };
      if (authResult.serverUrl) {
        this.configStore.setConfiguration({ serverUrl: authResult.serverUrl });
      }
      this.lastIsAuthenticated = authResult.isAuthenticated;
      this.postMessage({
        command: 'authStatusResponse',
        isAuthenticated: authResult.isAuthenticated,
        user: authResult.user,
        serverUrl: authResult.serverUrl,
      });
    } catch (error) {
      console.error(`[DesktopHost] Failed to get auth status for host ${host}:`, error);
    }
  }

  /**
   * Pick a host for the focused pane's new-session workdir picker. Only
   * hosts from ~/.ssh/config (or 本地) are accepted; switching host re-sends
   * workdir state so the picker shows that host's recents (spec scenario 1).
   */
  private async handleSelectHost(host: string): Promise<void> {
    if (host !== LOCAL_HOST && !parseSshConfigHosts().includes(host)) {
      this.pushSystemMessage(`未知主机：${host}`);
      return;
    }
    const pid = this.focusedPaneId;
    const active = this.agentForPane(pid);
    // A message-less agent is still the new-session picker state (新对话 binds a
    // fresh empty agent to the pane). Switching host releases it so the pane's
    // reported host follows the picker — a bound agent would otherwise pin the
    // label to its own host and the selector never leaves the old one. The
    // empty agent has no session yet, so releasing it loses nothing.
    if (active && active.messages.length === 0 && !active.isStreaming && this.hostForAgent(active) !== host) {
      this.bindAgentToPane(pid, null);
      this.pushPaneSessionState(pid);
    }
    this.hostState.set(pid, host);
    // Establish the host's client eagerly, then re-query the auth status on
    // that host — the state cached at webview-ready belongs to the previous
    // host, so without the re-query the welcome page keeps showing the old
    // host's 登录 button. Failures surface as a system message, the picker
    // updates immediately.
    this.ensureClientFor(host)
      .then(() => this.refreshAuthStatus(host))
      .catch((error) => {
        this.pushSystemMessage(
          `连接主机 ${host} 失败：${error instanceof Error ? error.message : String(error)}`,
        );
      });
    this.sendWorkdirState();
    // The webview's host label reads the pane-bound host from desktopPanes —
    // without a re-push the selector stays on the previous host.
    this.pushPanes();
  }

  /**
   * VSC-style 添加主机…: append a Host block to ~/.ssh/config from an
   * `ssh user@hostname -p port` connection string, then auto-select the new
   * host (spec scenario 5 — the picker refreshes and the new host becomes the
   * current one). The eager client establishment makes auth failures surface
   * immediately instead of at the first agent spawn.
   */
  private async handleAddHost(connectionString: string): Promise<void> {
    let name: string;
    try {
      name = addSshHost(connectionString);
    } catch (error) {
      this.pushSystemMessage(error instanceof Error ? error.message : String(error));
      return;
    }
    const pid = this.focusedPaneId;
    const active = this.agentForPane(pid);
    // Same as handleSelectHost: a bound message-less agent must not pin the
    // pane to its old host — release it so the new host takes effect.
    if (active && active.messages.length === 0 && !active.isStreaming) {
      this.bindAgentToPane(pid, null);
      this.pushPaneSessionState(pid);
    }
    this.hostState.set(pid, name);
    this.ensureClientFor(name)
      .then(() => this.refreshAuthStatus(name))
      .catch((error) => {
        this.pushSystemMessage(
          `连接主机 ${name} 失败：${error instanceof Error ? error.message : String(error)}`,
        );
      });
    this.pushSystemMessage(`已添加主机：${name}`);
    this.sendWorkdirState();
    // Same as handleSelectHost: the pane layout must carry the new host or the
    // selector never leaves the old one.
    this.pushPanes();
  }

  /**
   * Remote workdir via text input (spec scenario 3): validate with
   * `test -d` on the host, then activate. Shared by the picker's typed-path
   * input and the browser panel's 选择此目录 button.
   */
  private async handleSelectRemotePath(host: string, path: string): Promise<void> {
    if (host === LOCAL_HOST || !path) return;
    if (!parseSshConfigHosts().includes(host)) {
      this.pushSystemMessage(`未知主机：${host}`);
      return;
    }
    if (!(await remotePathExists(host, path))) {
      this.pushSystemMessage(`远端目录不存在：${path}`);
      return;
    }
    this.hostState.set(this.focusedPaneId, host);
    await this.activateWorkdir({ host, dir: path });
  }

  /**
   * Remote directory browser (spec scenarios 20/21): list the subdirectories
   * of a remote path and reply with a requestId-matched `desktopRemoteDirList`
   * message. Errors (missing dir, ssh failure) are returned in the reply so
   * the panel can show a retryable error instead of silently entering the
   * session.
   */
  private async handleListRemoteDir(host: string, path: string, requestId: string): Promise<void> {
    if (host === LOCAL_HOST || !path || !requestId) return;
    try {
      const { resolvedPath, dirs } = await listRemoteDirs(host, path);
      this.postMessage({ command: 'desktopRemoteDirList', host, requestId, resolvedPath, dirs });
    } catch (error) {
      this.postMessage({
        command: 'desktopRemoteDirList',
        host,
        requestId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private async handleSelectWorkdir(): Promise<void> {
    if (!this.mainWindow) return;
    const result = await dialog.showOpenDialog(this.mainWindow, {
      title: '选择工作目录',
      properties: ['openDirectory', 'createDirectory'],
    });
    if (result.canceled || result.filePaths.length === 0) return;
    // The OS dialog only picks local directories — the picker's host is
    // pinned to 本地 after a browse.
    this.hostState.set(this.focusedPaneId, LOCAL_HOST);
    await this.activateWorkdir({ host: LOCAL_HOST, dir: result.filePaths[0] });
  }

  private async handleSelectRecentWorkdir(dir: string, host?: string): Promise<void> {
    const h = host ?? this.hostState.get(this.focusedPaneId) ?? LOCAL_HOST;
    if (!(await this.pathExistsOn(h, dir))) {
      // Picker-only hygiene: removing a recent dir never touches the
      // index-derived session tree (FR-006), so no refreshSessionTree here.
      this.configStore.removeRecentWorkdir({ host: h, path: dir });
      this.sendWorkdirState();
      this.pushSystemMessage(`目录不存在：${dir}，已从最近列表移除`);
      return;
    }
    await this.activateWorkdir({ host: h, dir });
  }

  /**
   * Open a session from the sidebar tree (FR-020/031) in a pane (FR-032). Three
   * branches: the live agent is activated in place (nothing destroyed); a
   * historical session spawns a fresh agent + restoreSession; clicking the
   * session already shown in that pane is a no-op. A session visible in another
   * pane just refocuses there (one session, one pane). Worktree sessions live
   * at the worktree path (entry.cwd).
   */
  private async handleSelectSession(workdir: string, sessionId: string, paneId?: string): Promise<void> {
    if (!workdir || !sessionId) return;
    const pid = paneId ?? this.focusedPaneId;
    const pane = this.panes.find((p) => p.paneId === pid);
    if (!pane) return;
    if (pane.agent?.sessionId === sessionId) return; // already shown in this pane

    // One session, one pane — refocus where it's already visible.
    const otherPane = this.panes.find((p) => p.agent?.sessionId === sessionId);
    if (otherPane) {
      this.handleFocusPane(otherPane.paneId);
      this.postMessage({ command: 'focusInput', paneId: otherPane.paneId });
      return;
    }

    const entry = this.configStore.getSessionIndex().find((e) => e.sessionId === sessionId);
    const host = entry?.host ?? LOCAL_HOST;
    const targetDir = entry?.worktree ? entry.cwd : workdir;
    if (!(await this.pathExistsOn(host, targetDir))) {
      // Directory gone — auto-clear the stale index entry (worktree or not,
      // per FR-020 stale-directory behavior). For non-worktree dirs the entry
      // is also removed from the recent-workdirs picker list.
      this.configStore.removeSession(sessionId);
      if (!entry?.worktree) {
        this.configStore.removeRecentWorkdir({ host, path: workdir });
        this.sendWorkdirState();
      }
      this.refreshSessionTree();
      this.pushSystemMessage(
        entry?.worktree
          ? `worktree 目录不存在：${targetDir}，已从会话列表移除`
          : `目录不存在：${workdir}，已从最近列表与会话列表移除`,
        pid,
      );
      return;
    }

    const live = this.agents.get(this.agentKey(host, sessionId));
    if (live) {
      this.hostState.set(pid, host);
      await this.activateAgentInPane(pid, live);
      return;
    }

    // Historical session: spawn a fresh agent in its directory, then restore.
    // Carry the entry's worktree info so re-registration keeps the session
    // grouped under the repo root (and recents free of the ephemeral path).
    try {
      const agent = await this.spawnAgent({ host, workdir: targetDir, worktreeInfo: entry?.worktree });
      // Restore before activating so the view never flashes the fresh agent's
      // empty state (which renders as the new-session directory picker).
      await agent.restoreSession(sessionId);
      this.rekeyAgent(agent, sessionId);
      await this.activateAgentInPane(pid, agent);
      this.ensureSessionRegistered(agent);
      this.touchSessionInIndex(agent);
      this.refreshSessionTree();
    } catch (error) {
      console.error('[DesktopHost] 恢复会话失败:', error);
      this.pushSystemMessage(`恢复会话失败: ${error}`, pid);
    }
  }

  /**
   * Cycle the active session through the flattened sidebar tree order (FR-038)
   * — the keyboard/menu counterpart of clicking a session entry, so it
   * delegates to handleSelectSession for identical semantics (FR-020 click
   * behavior; background sessions keep streaming, FR-031). Next/previous wrap
   * around at the edges; when the current session is not in the tree (a fresh
   * unregistered session), next lands on the first entry and previous on the
   * last. Empty tree or cycling onto the current session is a no-op (the
   * handleSelectSession early-return).
   *
   * The order is frozen in a snapshot at cycle start and dropped as soon as
   * anything outside the cycle changes the current session (click, new
   * session, delete…), falling back to a fresh derivation. The tree itself is
   * creation-ordered and stable, so the snapshot only guards against sessions
   * being created or deleted mid-cycle.
   */
  private sessionCycleSnapshot: Array<{ workdir: string; sessionId: string }> | null = null;
  private sessionCycleIndex = -1;

  async activateAdjacentSession(direction: 1 | -1): Promise<void> {
    const currentId = this.activeAgent?.sessionId;
    if (!this.sessionCycleSnapshot || this.sessionCycleSnapshot[this.sessionCycleIndex]?.sessionId !== currentId) {
      const flat = this.sessionTree.flatMap((group) =>
        group.sessions.map((s) => ({ workdir: group.workdir, sessionId: s.sessionId })),
      );
      const index = flat.findIndex((s) => s.sessionId === currentId);
      this.sessionCycleSnapshot = flat;
      // An untracked current session sits before the first entry for next and
      // after the last for previous, so the first press lands on an edge.
      this.sessionCycleIndex = index === -1 ? (direction === 1 ? -1 : flat.length) : index;
    }
    const snapshot = this.sessionCycleSnapshot;
    if (!snapshot || snapshot.length === 0) return;
    this.sessionCycleIndex = (this.sessionCycleIndex + direction + snapshot.length) % snapshot.length;
    const target = snapshot[this.sessionCycleIndex];
    await this.handleSelectSession(target.workdir, target.sessionId);
  }

  private async handleSendMessage(
    text: string,
    images?: Array<{ data: string; mediaType: string }>,
    force?: boolean,
    paneId?: string,
  ): Promise<void> {
    const pid = paneId ?? this.focusedPaneId;
    const agent = this.agentForPane(pid);
    if (!agent) {
      this.pushSystemMessage('请先选择工作目录', pid);
      return;
    }

    try {
      const processedImages = images?.length
        ? images.map((image) => ({ path: image.data, mimeType: image.mediaType }))
        : undefined;

      if (text.startsWith('!')) {
        await agent.bang(text.slice(1));
      } else {
        await agent.sendMessage(text, processedImages, force ?? false);
      }
    } catch (error) {
      console.error('[DesktopHost] 发送消息失败:', error);
      this.pushSystemMessage(`发送消息失败: ${error}`, pid);
    }
  }

  /**
   * New session in a pane (FR-031/032): spawn a fresh agent and bind it to the
   * pane WITHOUT aborting, clearing or destroying the previous one — background
   * sessions keep generating. No-op when the pane's session is already empty.
   */
  private async handleNewSession(paneId?: string): Promise<void> {
    const pid = paneId ?? this.focusedPaneId;
    const active = this.agentForPane(pid);
    // New session cwd = the most recently user-selected repo root (recents),
    // decoupled from the previous session's state (worktree session, bash cd,
    // etc.). See desktop-app.md「会话管理」scenario 8. No fallback to
    // this.workdir — it follows the focused pane and could be a worktree path;
    // if recents is empty the user hasn't picked a dir yet, so this is a no-op.
    // The host is the pane's pending picker host (spec scenario 1/9).
    const host = this.hostState.get(pid) ?? LOCAL_HOST;
    const dir = this.configStore.getRecentWorkdirsForHost(host)[0];
    if (!dir) return;
    if (active && active.messages.length === 0 && !active.isStreaming) return;
    try {
      const agent = await this.spawnAgent({ host, workdir: dir });
      // Spawning is slow (agent init) — the user may have selected another
      // session meanwhile; don't clobber their view.
      if (this.agentForPane(pid) !== active) return;
      await this.activateAgentInPane(pid, agent);
    } catch (error) {
      console.error('[DesktopHost] 新建会话失败:', error);
      this.pushSystemMessage(`新建会话失败: ${error}`, pid);
    }
  }

  /**
   * New session in a fresh pane (Cmd/Ctrl+Click on the sidebar 新对话 button,
   * or CmdOrCtrl+Shift+N): same workdir rule as 新对话 (most recently used
   * real directory), but the session opens side-by-side instead of replacing
   * the focused pane. An already-empty new-session pane is focused instead of
   * duplicated; placement/overflow follows insertNewPane's rules.
   */
  private async handleNewSessionInNewPane(): Promise<void> {
    const host = this.hostState.get(this.focusedPaneId) ?? LOCAL_HOST;
    const dir = this.configStore.getRecentWorkdirsForHost(host)[0];
    if (!dir) return;
    const empty = this.panes.find((p) => {
      const a = p.agent;
      return !a || (a.messages.length === 0 && !a.isStreaming);
    });
    if (empty) {
      this.handleFocusPane(empty.paneId);
      this.postMessage({ command: 'focusInput', paneId: empty.paneId });
      return;
    }
    const paneId = this.insertNewPane();
    if (!paneId) return;
    try {
      const agent = await this.spawnAgent({ host, workdir: dir });
      // Spawning is slow (agent init) — the pane may have been closed meanwhile.
      if (!this.panes.some((p) => p.paneId === paneId)) return;
      await this.activateAgentInPane(paneId, agent);
    } catch (error) {
      console.error('[DesktopHost] 新建分屏会话失败:', error);
      this.pushSystemMessage(`新建会话失败: ${error}`, paneId);
    }
  }

  private async clearQueue(): Promise<void> {
    for (const pane of this.panes) {
      const agent = pane.agent;
      if (agent && agent.queuedMessages.length > 0) {
        await agent.abortMessage();
      }
    }
  }

  private async handleRestoreSession(sessionId: string): Promise<void> {
    if (!sessionId) return;
    const entry = this.configStore.getSessionIndex().find((e) => e.sessionId === sessionId);
    const workdir = entry ? (entry.worktree ? entry.cwd : entry.workdir) : this.workdir;
    if (workdir) await this.handleSelectSession(workdir, sessionId);
  }

  private async handleListRewindCheckpoints(paneId?: string): Promise<void> {
    const pid = paneId ?? this.focusedPaneId;
    const agent = this.agentForPane(pid);
    let checkpoints: Array<{ id: string; content: string }> = [];
    try {
      if (agent) {
        checkpoints = (await agent.listRewindCheckpoints()).checkpoints;
      }
    } catch (error) {
      console.error('[DesktopHost] 获取回滚点失败:', error);
    }
    this.postMessage({ command: 'rewindCheckpoints', paneId: pid, checkpoints });
  }

  private async handleRewindToMessage(messageId: string, paneId?: string): Promise<void> {
    const pid = paneId ?? this.focusedPaneId;
    const agent = this.agentForPane(pid);
    if (!agent || !this.mainWindow) return;
    // The webview already showed the confirmation dialog — execute directly.
    try {
      const { inputContent } = await agent.rewindToMessage(messageId);
      this.inputDrafts.set(pid, inputContent);
      this.paneThrottle(pid).forceNextUpdateImmediate = true;
      this.throttledUpdateChatMessages(pid);
      await this.pushPaneSessionState(pid);
      this.postMessage({ command: 'focusInput', paneId: pid });
      this.postMessage({ command: 'scrollToBottom', paneId: pid });
    } catch (error) {
      console.error('[DesktopHost] 回滚会话失败:', error);
      this.pushSystemMessage(`回滚失败: ${error}`, pid);
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

  /** Server-side destroy + recreate with restored session, applied to every live agent (FR-031). */
  private async updateAgentConfig(config: DesktopConfigData): Promise<void> {
    const params = {
      apiKey: config.apiKey || undefined,
      baseURL: config.baseURL || undefined,
      defaultHeaders: parseHeaders(config.headers),
      model: config.model,
      fastModel: config.fastModel,
      language: config.language,
    };
    for (const [oldSid, agent] of [...this.agents]) {
      const wasStreaming = agent.isStreaming;
      await agent.updateConfig(params);
      if (agent.sessionId && agent.sessionId !== oldSid) {
        this.rekeyAgent(agent, agent.sessionId);
      }
      if (wasStreaming) {
        agent.isStreaming = false;
        const paneId = this.paneIdForAgent(agent);
        if (paneId) {
          this.postMessage({ command: 'endStreaming', paneId });
        }
      }
    }
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
      const result = (await this.utilityClientFor(this.currentHost).request('getAuthStatus')) as {
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
      const result = (await this.utilityClientFor(this.currentHost).request('login')) as {
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
      await this.utilityClientFor(this.currentHost).request('logout');
      this.postMessage({ command: 'logoutResponse', success: true });
      await this.updateAgentConfig(this.configStore.getConfiguration());
    } catch (error) {
      console.error('[DesktopHost] 登出失败:', error);
      this.postMessage({ command: 'logoutResponse', success: false, error: String(error) });
    }
  }

  private async handleListPlugins(): Promise<void> {
    try {
      const result = (await this.utilityClientFor(this.currentHost).request('listPlugins', { workdir: this.workdir })) as { plugins: unknown[] };
      this.postMessage({ command: 'listPluginsResponse', plugins: result.plugins });
    } catch (error) {
      this.pushSystemMessage(`获取插件列表失败: ${error}`);
    }
  }

  private async handlePluginMutation(method: string, params: Record<string, unknown>): Promise<void> {
    try {
      await this.utilityClientFor(this.currentHost).request(method, { ...params, workdir: this.workdir });
      await this.handleListPlugins();
      // Recreate agent to apply plugin changes
      await this.updateAgentConfig(this.configStore.getConfiguration());
    } catch (error) {
      this.pushSystemMessage(`插件操作失败: ${error}`);
    }
  }

  private async handleGetProjectSettings(paneId: string): Promise<void> {
    try {
      const workdir = this.agentForPane(paneId)?.workingDirectory ?? this.workdir;
      const result = (await this.utilityClientFor(this.hostForPane(paneId)).request('getProjectSettings', { workdir })) as {
        enabledPlugins: Record<string, boolean>;
      };
      this.postMessage({ command: 'projectSettings', paneId, enabledPlugins: result.enabledPlugins });
    } catch (error) {
      this.pushSystemMessage(`获取项目设置失败: ${error}`, paneId);
    }
  }

  private async handleSetBuiltinPluginEnabled(
    paneId: string,
    pluginId: string,
    enabled: boolean,
    scope?: Scope,
  ): Promise<void> {
    try {
      const workdir = this.agentForPane(paneId)?.workingDirectory ?? this.workdir;
      const result = (await this.utilityClientFor(this.hostForPane(paneId)).request('setBuiltinPluginEnabled', {
        pluginId,
        enabled,
        scope,
        workdir,
      })) as { enabledPlugins: Record<string, boolean> };
      this.postMessage({ command: 'projectSettings', paneId, enabledPlugins: result.enabledPlugins });
      // Recreate agents so the plugin change applies immediately (mirrors handlePluginMutation)
      await this.updateAgentConfig(this.configStore.getConfiguration());
    } catch (error) {
      this.pushSystemMessage(`修改项目设置失败: ${error}`, paneId);
    }
  }

  private async handleListMarketplaces(): Promise<void> {
    try {
      const marketplaces = await this.utilityClientFor(this.currentHost).request('listMarketplaces', { workdir: this.workdir });
      this.postMessage({ command: 'listMarketplacesResponse', marketplaces });
    } catch (error) {
      this.pushSystemMessage(`获取市场列表失败: ${error}`);
    }
  }

  private async handleMarketplaceMutation(method: string, params: Record<string, unknown>): Promise<void> {
    try {
      await this.utilityClientFor(this.currentHost).request(method, { ...params, workdir: this.workdir });
      await this.handleListMarketplaces();
    } catch (error) {
      this.pushSystemMessage(`市场操作失败: ${error}`);
    }
  }

  private async handleRequestHistory(): Promise<void> {
    try {
      const result = (await this.utilityClientFor(this.currentHost).request('getPromptHistory')) as { history: unknown[] };
      this.postMessage({ command: 'historyResponse', history: result.history });
    } catch (error) {
      console.error('[DesktopHost] 获取历史记录失败:', error);
      this.postMessage({ command: 'historyError', error: `获取历史记录失败: ${error}` });
    }
  }

  private async handleSearchHistory(query: string): Promise<void> {
    try {
      const result = (await this.utilityClientFor(this.currentHost).request('searchPromptHistory', { query })) as { history: unknown[] };
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
      const host = this.currentHost;
      // Remote workdirs are POSIX paths; path.join/basename on Windows would mangle them.
      const join = host === LOCAL_HOST ? path.join.bind(path) : path.posix.join.bind(path.posix);
      const basename = host === LOCAL_HOST ? path.basename.bind(path) : path.posix.basename.bind(path.posix);
      const result = (await this.utilityClientFor(host).request('searchFiles', {
        query: filterText || '',
        maxResults: 20,
        workdir: this.workdir,
      })) as { files: Array<{ path: string; type: string }> };

      const allItems = result.files.map((item) => {
        const relativePath = item.path;
        const fullPath = join(this.workdir!, relativePath);
        const normalizedPath = relativePath.endsWith('/') ? relativePath.slice(0, -1) : relativePath;
        const name = basename(normalizedPath);
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

  private async handleSlashCommandsRequest(filterText: string, paneId?: string): Promise<void> {
    const pid = paneId ?? this.focusedPaneId;
    try {
      const agent = this.agentForPane(pid);
      const sdkCommands = agent ? await agent.getSlashCommands() : [];

      const localCommands = [
        { id: 'config', name: 'config', description: '打开配置设置' },
        { id: 'plugin', name: 'plugin', description: '打开插件管理' },
        { id: 'mcp', name: 'mcp', description: '打开 MCP 服务器管理' },
        { id: 'status', name: 'status', description: '查看当前状态' },
        { id: 'clear', name: 'clear', description: '清除对话历史并重置会话' },
        { id: 'compact', name: 'compact', description: '手动压缩对话历史' },
        { id: 'tasks', name: 'tasks', description: '查看后台任务' },
        { id: 'workflows', name: 'workflows', description: '查看工作流运行' },
        { id: 'rewind', name: 'rewind', description: '回滚到之前的用户消息' },
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
      this.postMessage({ command: 'slashCommandsResponse', paneId: pid, commands });
    } catch (error) {
      console.error('[DesktopHost] 获取指令失败:', error);
      this.postMessage({ command: 'slashCommandsError', paneId: pid, error: `获取指令失败: ${error}` });
    }
  }

  // ------------------------------------------------------------------
  // Throttled message updates (ported from vsce ChatSession)
  // ------------------------------------------------------------------

  private immediateUpdateChatMessages(paneId: string): void {
    const t = this.paneThrottle(paneId);
    if (t.updateTimer) {
      clearTimeout(t.updateTimer);
      t.updateTimer = undefined;
    }
    t.pendingUpdate = false;
    this.postMessage({ command: 'updateMessages', paneId, messages: this.messagesForPane(paneId) });
  }

  private throttledUpdateChatMessages(paneId: string): void {
    const t = this.paneThrottle(paneId);
    if (t.forceNextUpdateImmediate) {
      t.forceNextUpdateImmediate = false;
      this.immediateUpdateChatMessages(paneId);
      return;
    }

    // leading edge
    if (!t.pendingUpdate && !t.updateTimer) {
      this.postMessage({ command: 'updateMessages', paneId, messages: this.messagesForPane(paneId) });
      t.pendingUpdate = true;
      // trailing edge after 300ms cooldown
      t.updateTimer = setTimeout(() => {
        this.postMessage({ command: 'updateMessages', paneId, messages: this.messagesForPane(paneId) });
        t.pendingUpdate = false;
        t.updateTimer = undefined;
      }, 300);
    }
  }

  private throttledStreamingContentUpdate(paneId: string, messageId: string, accumulated: string, stage: 'streaming' | 'end'): void {
    const t = this.paneThrottle(paneId);
    if (stage === 'end') {
      if (t.streamingContentTimer) {
        clearTimeout(t.streamingContentTimer);
        t.streamingContentTimer = undefined;
      }
      t.pendingStreamingContent = undefined;
      this.postMessage({ command: 'updateStreamingContent', paneId, messageId, accumulated, stage });
      return;
    }

    t.pendingStreamingContent = { messageId, accumulated, stage };
    if (!t.streamingContentTimer) {
      this.postMessage({ command: 'updateStreamingContent', paneId, ...t.pendingStreamingContent });
      t.streamingContentTimer = setTimeout(() => {
        if (t.pendingStreamingContent) {
          this.postMessage({ command: 'updateStreamingContent', paneId, ...t.pendingStreamingContent });
          t.pendingStreamingContent = undefined;
        }
        t.streamingContentTimer = undefined;
      }, 16);
    }
  }

  private throttledStreamingReasoningUpdate(paneId: string, messageId: string, accumulated: string, stage: 'streaming' | 'end'): void {
    const t = this.paneThrottle(paneId);
    if (stage === 'end') {
      if (t.streamingReasoningTimer) {
        clearTimeout(t.streamingReasoningTimer);
        t.streamingReasoningTimer = undefined;
      }
      t.pendingStreamingReasoning = undefined;
      this.postMessage({ command: 'updateStreamingReasoning', paneId, messageId, accumulated, stage });
      return;
    }

    t.pendingStreamingReasoning = { messageId, accumulated, stage };
    if (!t.streamingReasoningTimer) {
      this.postMessage({ command: 'updateStreamingReasoning', paneId, ...t.pendingStreamingReasoning });
      t.streamingReasoningTimer = setTimeout(() => {
        if (t.pendingStreamingReasoning) {
          this.postMessage({ command: 'updateStreamingReasoning', paneId, ...t.pendingStreamingReasoning });
          t.pendingStreamingReasoning = undefined;
        }
        t.streamingReasoningTimer = undefined;
      }, 16);
    }
  }
}

/** First real user message text, trimmed to 30 chars (mirrors the webview header rule). */
function sessionTitleFromMessages(messages: Message[]): string {
  for (const message of messages) {
    if (message.role !== 'user' || message.isMeta) continue;
    const text = (message.blocks ?? [])
      .filter((b) => b.type === 'text' || b.type === 'compact')
      .map((b) => b.content || '')
      .join('')
      .trim();
    if (text) return text.length > 30 ? text.substring(0, 30) + '...' : text;
  }
  return '';
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
