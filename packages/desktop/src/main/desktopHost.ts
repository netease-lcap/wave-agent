/**
 * DesktopHost — the Electron counterpart of ChatSession + MessageHandler.
 *
 * Owns the shared StdioClient, the per-workdir StdioAgent and the full
 * webview↔agent message protocol. All webview commands arrive via
 * handleWebviewMessage(); agent notifications are translated back into the
 * exact message shapes the webview already understands (ported from
 * packages/vscode/src/session/{chatSession,messageHandler}.ts).
 */

import {
  app,
  dialog,
  shell,
  nativeTheme,
  powerMonitor,
  type BrowserWindow,
} from "electron";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
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
  ToolBlock,
  ErrorBlock,
} from "wave-agent-sdk/types";
import {
  EDIT_TOOL_NAME,
  WRITE_TOOL_NAME,
  BASH_TOOL_NAME,
  EXIT_PLAN_MODE_TOOL_NAME,
  ENTER_PLAN_MODE_TOOL_NAME,
  ASK_USER_QUESTION_TOOL_NAME,
} from "wave-agent-sdk/constants";
import { StdioClient } from "./stdio/stdioClient";
import type { JsonRpcClient } from "./stdio/jsonRpcClient";
import { StdioAgent, type StdioAgentCallbacks } from "./stdio/stdioAgent";
import { NotificationRouter } from "./stdio/notificationRouter";
import {
  resolveWaveBinary,
  ensureCliUpToDate,
  getCliVersion,
} from "./stdio/binaryResolver";
import {
  ConfigStore,
  type DesktopConfigData,
  type SessionIndexEntry,
} from "./configStore";
import { LOCAL_HOST, parseSshConfigHosts, addSshHost } from "./sshHosts";
import {
  remotePathExists,
  listRemoteDirs,
  readRemoteFile,
  ensureRemoteDaemon,
  connectRemoteDaemon,
  REMOTE_FILE_MAX_LINES,
  REMOTE_FILE_MAX_BYTES,
} from "./remoteCli";
import type { ToastAction, UpdateToast } from "wave-webview-fixtures";
import type { ChildProcess } from "child_process";
import { getWorkspaceDiff } from "./gitDiff";
import { TerminalManager } from "./terminal";
import { PortForwardManager, type AuthCallbackForward } from "./portForward";
import {
  checkForUpdate,
  type UpdateInfo as ManualUpdateInfo,
} from "./updateChecker";
import { AutoUpdaterService } from "./updateAutoUpdater";
import { HOST_CHANNEL } from "./channels";
import type { PanelKind } from "./menu";

interface PendingConfirmation {
  resolve: (decision: PermissionDecision) => void;
  /** Remote daemon requestId — used to dedup re-attached snapshots and to
   *  send the response back over the daemon client for re-surfaced entries. */
  requestId: string;
  agent: StdioAgent;
  toolName: string;
  confirmationType: string;
  toolInput: unknown;
  planContent?: string;
  suggestedPrefix?: string;
  hidePersistentOption?: boolean;
  permissionMode?: PermissionMode;
  warning?: string;
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
  streamingContentTimer?: NodeJS.Timeout;
  pendingStreamingContent?: { messageId: string; chunk: string };
  streamingReasoningTimer?: NodeJS.Timeout;
  pendingStreamingReasoning?: { messageId: string; chunk: string };
}
/** Minimum chat-pane width — mirrors the webview DesktopShell MIN_PANE_WIDTH. */
const MIN_PANE_WIDTH_PX = 360;
/** Minimum height of a pane row — mirrors the webview DesktopShell MIN_ROW_HEIGHT. */
const MIN_PANE_ROW_HEIGHT_PX = 280;
/** Fixed sidebar width — mirrors DesktopApp.css .desktop-sidebar. */
const SIDEBAR_WIDTH_PX = 240;
/** Float tolerance for ratio-vs-minimum comparisons. */
const WIDTH_EPSILON = 1e-9;
/** Max auto-reconnect attempts after a dropped ssh tunnel (spec: SSH 远程会话自动重连). */
const AUTO_RECONNECT_MAX_ATTEMPTS = 5;
/**
 * After a system sleep/wake the network stack takes tens of seconds to come
 * back (Wi-Fi association, DHCP, 802.1x/VPN auth). Auto-reconnect launched
 * in that window burns its attempts on dead air — wait this long after the
 * system `resume` event before starting an attempt (spec scenario 2/11).
 */
const AUTO_RECONNECT_RESUME_GRACE_MS = 8000;

/** A pane-bound session targeted by the auto-reconnect after a dropped tunnel. */
interface ReconnectTarget {
  paneId: string;
  sessionId: string;
  workdir: string;
  host: string;
  entry?: SessionIndexEntry;
}

export class DesktopHost {
  private mainWindow: BrowserWindow | null = null;

  // stdio infrastructure
  private client: StdioClient | null = null;
  private router: NotificationRouter | null = null;
  private initPromise: Promise<void> | null = null;
  private cliVersion: string | null = null;

  // Remote (ssh) host infrastructure: host name → its own shared JSON-RPC
  // client. Each remote host runs a `wave --daemon` (nohup, survives this app),
  // reached through a unix-socket ssh tunnel — so sessions on different hosts
  // never share a process, and remote sessions outlive the desktop app (spec
  // scenario 9 + SSH 后台模式). The tunnel is a plain `ssh -N -L` child.
  private remoteHosts = new Map<
    string,
    {
      client: JsonRpcClient | null;
      router: NotificationRouter | null;
      tunnel: ChildProcess | null;
      initPromise: Promise<void>;
    }
  >();

  /**
   * Base delay (ms) between auto-reconnect attempts after a dropped tunnel;
   * doubles per failure (5s → 10s → 20s → 40s). The 5s base stretches the
   * retry window (≈75s of backoff + per-attempt SSH timeouts) so attempts
   * still land after a slow post-resume network recovery. A static so tests
   * can shrink it without faking timers.
   */
  private static autoReconnectBaseDelayMs = 5000;
  /**
   * Post-resume network grace (ms) before the first auto-reconnect attempt;
   * a static so tests can shrink it without faking timers.
   */
  private static autoReconnectResumeGraceMs = AUTO_RECONNECT_RESUME_GRACE_MS;
  /** Timestamp of the last system `resume` event (0 = none since launch). */
  private lastResumeAt = 0;

  private readonly onSystemResume = () => {
    this.lastResumeAt = Date.now();
  };

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
  private panes: Pane[] = [{ paneId: "pane-1", agent: null }];
  private focusedPaneId = "pane-1";
  private paneCounter = 1;
  // Preview-pane width as last reported by the webview (0 = closed). Used to
  // deduct the preview from the chat area in min-pane-width checks.
  private previewWidthPx = 0;
  /** Top row's height as a fraction of the pane area; undefined while there is a single row. */
  private topRowHeight?: number;
  private inputDrafts = new Map<string, string>(); // keyed by `session:<sessionId>` or `new:<paneId>`
  private agentWorktreeInfo = new Map<StdioAgent, WorktreeInfo>();
  private workdir: string | undefined;

  // Per-pane view state. messages/tasks/backgroundTasks/queuedMessages/isStreaming/
  // isCommandRunning/sessionId are derived from the pane's bound agent (its
  // StdioAgent cache); only fields the agent does not cache live here.
  private workflowRuns = new Map<string, SerializableWorkflowRun[]>(); // keyed by paneId
  private sessionTree: Array<{
    host: string;
    workdir: string;
    sessions: Array<{
      sessionId: string;
      title: string;
      lastActiveAt: number;
      hasWorktree: boolean;
      running: boolean;
    }>;
  }> = [];
  private pendingConfirmations = new Map<string, PendingConfirmation>();
  /**
   * Optimistic session restores in flight (spec「历史会话即时进入与恢复加载动画」):
   * keyed by paneId, holding the target session + a monotonic token. While an
   * entry exists the pane's webview already shows the target session (header +
   * sidebar highlight) behind the sweep loading overlay; the old agent stays
   * bound underneath until the restore finishes. A newer selection/activation/
   * close bumps the token, which the in-flight restore detects and aborts.
   */
  private pendingRestores = new Map<
    string,
    { sessionId: string; workdir: string; token: number }
  >();
  private restoreToken = 0;

  // Throttling state, per pane so concurrently streaming panes update
  // independently (same cadence as vsce ChatSession).
  private paneThrottles = new Map<string, PaneThrottle>();

  private updateCheckTriggered = false;
  private lastIsAuthenticated = false;
  /** electron-updater path, created lazily once a serverUrl is configured. */
  private autoUpdaterService: AutoUpdaterService | null = null;

  /** Latest panel toggle state reported by each pane's webview (drives the 面板 menu). */
  private panePanelState = new Map<string, PanelKind[]>();

  /** Fired when the focused pane's panel state (or the focus itself) changes — rebuilds the app menu. */
  onPanelStateChanged: ((checked: PanelKind[]) => void) | null = null;

  /** PTY terminals keyed by webview termId (one per pane). */
  private terminalManager = new TerminalManager({
    onData: (termId, data) =>
      this.postMessage({ command: "desktopTerminalData", termId, data }),
    onExit: (termId, info) =>
      this.postMessage({ command: "desktopTerminalExit", termId, ...info }),
  });

  /** SSH tunnels serving remote preview URLs, refcounted per (host, remote port). */
  private portForwardManager = new PortForwardManager();

  /** One-shot SSO callback tunnels per host — closed when that host's login settles. */
  private pendingAuthTunnels = new Map<string, AuthCallbackForward>();

  /** Focused pane's agent — the default target for unscoped webview commands. */
  private get activeAgent(): StdioAgent | null {
    return (
      this.panes.find((p) => p.paneId === this.focusedPaneId)?.agent ?? null
    );
  }

  /** Agent bound to a specific pane; no paneId resolves to the focused pane. */
  private agentForPane(paneId?: string): StdioAgent | null {
    if (paneId === undefined) return this.activeAgent;
    return this.panes.find((p) => p.paneId === paneId)?.agent ?? null;
  }

  /**
   * Key for a pane's input draft. Drafts are per-session (desktop-app.md
   * 「会话管理」scenario 11/12): typed-but-unsent text must not leak across
   * sessions shown in the same pane, and follows the session between panes.
   * A pane targeting an in-flight restore resolves to the pending session
   * (its webview already shows that session behind the overlay); a pane with
   * no session yet (welcome state / blank new-session agent) falls back to a
   * pane-scoped key so each split's fresh input stays independent.
   */
  private draftKeyForPane(paneId: string): string {
    const sessionId =
      this.pendingRestores.get(paneId)?.sessionId ??
      this.agentForPane(paneId)?.sessionId ??
      undefined;
    return sessionId ? `session:${sessionId}` : `new:${paneId}`;
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
      t = {};
      this.paneThrottles.set(paneId, t);
    }
    return t;
  }

  // Derived views over the active agent — its StdioAgent cache is the single
  // source of truth, so these are read-only getters (no duplicated host state).
  private get messages(): Message[] {
    return this.activeAgent?.messages ?? [];
  }
  private get tasks(): Task[] {
    return this.activeAgent?.tasks ?? [];
  }
  private get backgroundTasks(): BackgroundTaskSummary[] {
    return this.activeAgent?.backgroundTasks ?? [];
  }
  private get messageQueue(): QueuedMessage[] {
    return this.activeAgent?.queuedMessages ?? [];
  }
  private get sessionId(): string | undefined {
    return this.activeAgent?.sessionId;
  }
  private get isStreaming(): boolean {
    return this.activeAgent?.isStreaming ?? false;
  }
  private get isCommandRunning(): boolean {
    return this.activeAgent?.isCommandRunning ?? false;
  }

  /**
   * Posted to the renderer whenever the OS appearance flips so it can swap the
   * `data-theme` attribute and the inlined `--vscode-*` variable set without a
   * reload (FR-018). Desktop follows the OS appearance only — no in-app toggle
   * (FR-016), matching the IDE plugins.
   */
  private readonly onNativeThemeUpdated = () => {
    this.postMessage({
      command: "desktopThemeChange",
      effective: this.getCurrentEffectiveTheme(),
    });
  };

  constructor(private readonly configStore: ConfigStore) {
    nativeTheme.on("updated", this.onNativeThemeUpdated);
    powerMonitor.on("resume", this.onSystemResume);
  }

  setMainWindow(win: BrowserWindow): void {
    this.mainWindow = win;
  }

  /**
   * Menu enablement hook — index.ts assigns this to reflect pane/streaming
   * state in the application menu (新对话 / 关闭分屏).
   */
  onMenuStateChange?: (state: {
    canNewSession: boolean;
    canClosePane: boolean;
  }) => void;

  /** 对话 → 新对话 (CmdOrCtrl+N): new session in the focused pane, same as the sidebar button. */
  async newSessionInFocusedPane(): Promise<void> {
    await this.handleNewSession(this.focusedPaneId);
  }

  /** 对话 → 并排新对话 (CmdOrCtrl+Shift+N): new session in a fresh pane, same as Cmd/Ctrl+Click on the sidebar button. */
  async newSessionInNewPane(): Promise<void> {
    await this.handleNewSessionInNewPane();
  }

  /**
   * 对话 → 关闭分屏 (CmdOrCtrl+W): close the focused pane. With multiple panes
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
    // Closing a sole empty session is a no-op — it already is the fresh
    // session that closing would reset to (and 新对话 / Cmd+N always spawn
    // instead, so the button is never a dead click).
    if (pane?.agent && (pane.agent.messages.length > 0 || pane.agent.isStreaming)) {
      await this.handleNewSession(pane.paneId);
    }
  }

  /**
   * Effective theme for the preload's sync IPC — applied to <html data-theme>
   * before first paint so the initial frame already matches the OS appearance
   * (FR-019, no light↔dark flash on launch).
   */
  getInitialEffectiveTheme(): "light" | "dark" {
    return this.getCurrentEffectiveTheme();
  }

  /** Graceful shutdown for app quit (FR-015): destroy every live agent. */
  async dispose(): Promise<void> {
    nativeTheme.off("updated", this.onNativeThemeUpdated);
    powerMonitor.off("resume", this.onSystemResume);
    this.terminalManager.killAll();
    this.portForwardManager.dispose();
    for (const t of this.paneThrottles.values()) {
      for (const timer of [
        t.streamingContentTimer,
        t.streamingReasoningTimer,
      ]) {
        if (timer) clearTimeout(timer);
      }
    }
    this.paneThrottles.clear();
    // Local agents die with the app; remote agents run on a daemon that must
    // survive this quit, so their sessions are left running (真后台).
    await Promise.allSettled(
      [...this.agents.values()]
        .filter((agent) => this.hostForAgent(agent) === LOCAL_HOST)
        .map((agent) => agent.destroy()),
    );
    this.agents.clear();
    this.agentHosts.clear();
    this.panes = [{ paneId: "pane-1", agent: null }];
    this.focusedPaneId = "pane-1";
    this.hostState.clear();
    for (const { client, tunnel } of this.remoteHosts.values()) {
      client?.dispose();
      tunnel?.kill();
    }
    this.remoteHosts.clear();
    this.client?.dispose();
    this.client = null;
    this.router = null;
    this.initPromise = null;
  }

  private getCurrentEffectiveTheme(): "light" | "dark" {
    try {
      return nativeTheme.shouldUseDarkColors ? "dark" : "light";
    } catch {
      return "dark";
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
    this.postMessage({
      command: "desktopTogglePanel",
      paneId: this.focusedPaneId,
      kind,
    });
  }

  private emitPanelState(): void {
    this.onPanelStateChanged?.(
      this.panePanelState.get(this.focusedPaneId) ?? [],
    );
  }

  /**
   * Surface an event as a non-modal in-app toast (VS Code-style, bottom-right).
   * Window-global: the webview shows it on the root instance only, so it never
   * becomes a chat message and never flips the pane out of the new-session
   * picker state.
   */
  private showToast(toast: Omit<UpdateToast, "id">): void {
    this.postMessage({
      command: "showToast",
      toast: {
        id: `toast-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        ...toast,
      },
    });
  }

  /** Insert a host-generated system message into a pane's chat stream (focused pane by default). */
  private pushSystemMessage(content: string, paneId?: string): void {
    const targetPaneId = paneId ?? this.focusedPaneId;
    const agent = this.agentForPane(targetPaneId);
    const message = {
      id: `host-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      role: "assistant",
      blocks: [{ type: "text", content }],
      timestamp: new Date().toISOString(),
    } as unknown as Message;
    if (agent) {
      agent.messages = [...agent.messages, message];
    }
    this.postMessage({
      command: "appendMessage",
      paneId: targetPaneId,
      message,
    });
  }

  /**
   * Pull the authoritative message list (getMessages RPC) into the agent's
   * cache and push it to the pane's webview as updateMessages. Replaces the
   * removed full-snapshot messagesChange push for structural transitions
   * (compact / clearChat / rewind) where incremental events can't rebuild the
   * list. Binding is re-checked after the RPC — the agent may have been
   * rebound while the request was in flight.
   */
  private async pullAndPushMessages(
    agent: StdioAgent,
    paneId: string,
  ): Promise<void> {
    try {
      await agent.getMessages();
    } catch (error) {
      console.warn("[DesktopHost] getMessages failed:", error);
    }
    if (this.agentForPane(paneId) === agent) {
      this.postMessage({
        command: "updateMessages",
        paneId,
        messages: agent.messages,
      });
    }
  }

  private sendWorkdirState(): void {
    const host = this.currentHost;
    this.postMessage({
      command: "desktopWorkdirState",
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
        binaryPath = await ensureCliUpToDate(targetVersion, (msg) =>
          this.showToast({ message: msg }),
        );
      } catch (error) {
        // Upgrade/install failure — fall back to whatever binary is resolvable.
        console.warn(
          "[DesktopHost] ensureCliUpToDate failed, falling back:",
          error,
        );
        this.showToast({
          message: `wave-code CLI 升级失败：${error instanceof Error ? error.message : String(error)}。可通过 npm install -g wave-code@${targetVersion} 手动升级`,
        });
        binaryPath = resolveWaveBinary(undefined, targetVersion);
      }
      this.cliVersion = getCliVersion(binaryPath);

      this.client = new StdioClient(binaryPath, ["--stdio"]);
      this.router = new NotificationRouter(this.client);
      this.router.registerGlobal("authUrl", (params) => {
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
   * Ensure the remote host's wave daemon is running, then attach to it through
   * a unix-socket ssh tunnel. The daemon is launched detached (nohup) and
   * survives this app's quit — pending approvals and running sessions live
   * there and are re-attached on the next launch. Failed init deletes the
   * entry so a later attempt can retry.
   */
  private ensureRemoteHostClient(host: string): Promise<void> {
    const existing = this.remoteHosts.get(host);
    if (existing) return existing.initPromise;

    const entry: {
      client: JsonRpcClient | null;
      router: NotificationRouter | null;
      tunnel: ChildProcess | null;
      initPromise: Promise<void>;
    } = {
      client: null,
      router: null,
      tunnel: null,
      initPromise: Promise.resolve(),
    };
    this.remoteHosts.set(host, entry);

    entry.initPromise = (async () => {
      const daemonSocket = await ensureRemoteDaemon(
        host,
        app.getVersion(),
        (msg) => this.showToast({ message: msg }),
      );
      const { client, tunnel } = await connectRemoteDaemon(host, daemonSocket);
      const router = new NotificationRouter(client);
      router.registerGlobal("authUrl", (params) => {
        const p = params as { url?: string };
        // The daemon's SSO callback server listens on the remote 127.0.0.1 —
        // forward the callback port to this machine's loopback before opening
        // the browser (spec: SSO 登录 scenario 8).
        if (p?.url) void this.handleRemoteAuthUrl(host, p.url);
      });
      router.attach();
      entry.client = client;
      entry.router = router;
      entry.tunnel = tunnel;
      // The ssh tunnel dropped (network blip, host reboot) — the daemon keeps
      // running remotely, so release the local host entry + pool agents so a
      // later access re-attaches. Detach, never destroy: the remote session
      // must survive until the user deletes it (真后台).
      client.onClosed(() => {
        this.remoteHosts.delete(host);
        tunnel.kill();
        // Collect pane-bound sessions BEFORE detaching (dropHostAgents unbinds
        // panes) so the auto-reconnect can re-attach them through a fresh
        // tunnel without the user re-selecting them.
        const targets = this.collectReconnectTargets(host);
        this.dropHostAgents(host);
        if (targets.length > 0) this.startAutoReconnect(targets);
      });
    })();

    entry.initPromise.catch(() => {
      // Allow retry after a failed init.
      this.remoteHosts.delete(host);
    });
    return entry.initPromise;
  }

  /** Resolve the (client, router) pair for a host, throwing if not initialized. */
  private clientFor(host: string): {
    client: JsonRpcClient;
    router: NotificationRouter;
  } {
    if (host === LOCAL_HOST) {
      if (!this.client || !this.router)
        throw new Error("StdioClient not initialized");
      return { client: this.client, router: this.router };
    }
    const entry = this.remoteHosts.get(host);
    if (!entry?.client || !entry.router)
      throw new Error(`StdioClient not initialized for host ${host}`);
    return { client: entry.client, router: entry.router };
  }

  /** Utility (non-session-scoped) client for a host — auth, plugins, git RPCs. */
  private utilityClientFor(host: string): JsonRpcClient {
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
  private createAgent(opts: {
    host: string;
    workdir?: string;
    worktreeInfo?: WorktreeInfo;
  }): StdioAgent {
    const { client, router } = this.clientFor(opts.host);
    // The callbacks close over agentRef but only run after the constructor
    // returns, so the const binding is always initialized by call time.
    const paneIdOf = () => this.paneIdForAgent(agentRef);

    const callbacks: StdioAgentCallbacks = {
      // NOTE: no full-list push here. The server no longer emits messagesChange;
      // the cache is kept fresh via incremental appends below (user/assistant
      // adds, bang mirroring) and pull-based refreshes on structural transitions
      // (webviewReady / restore / compact / clearChat / rewind) via
      // getMessages(). Full-list pushes to the webview happen only through
      // pullAndPushMessages (updateMessages) and pushPaneSessionState
      // (setInitialState).
      onCompactBlockAdded: () => {
        const paneId = paneIdOf();
        if (!paneId) return;
        // Compaction truncates the list server-side; pull it and replace the
        // webview list.
        void this.pullAndPushMessages(agentRef, paneId);
      },
      onCompactionStateChange: (isCompacting: boolean) => {
        const paneId = paneIdOf();
        if (paneId)
          this.postMessage({
            command: "compactionStateChange",
            isCompacting,
            paneId,
          });
      },
      onUserMessageAdded: (message: Message) => {
        // Keep the cache mirroring the server (no messagesChange snapshot
        // arrives anymore) — feeds FR-024 title + idle checks.
        agentRef.messages = [...agentRef.messages, message];
        const paneId = paneIdOf();
        if (paneId)
          this.postMessage({ command: "appendMessage", paneId, message });
        this.ensureSessionRegistered(agentRef);
      },
      onAssistantMessageAdded: (message: Message) => {
        agentRef.messages = [...agentRef.messages, message];
        const paneId = paneIdOf();
        if (paneId)
          this.postMessage({ command: "appendMessage", paneId, message });
      },
      onAssistantContentUpdated: (params) => {
        // The webview merges streaming deltas via UPDATE_STREAMING_CONTENT,
        // but the cache only ever saw the initial empty assistant message.
        // Mirror the deltas into it so a session switch (setInitialState from
        // the cache) renders the full assistant reply.
        agentRef.messages = agentRef.messages.map((m) => {
          if (m.id !== params.messageId) return m;
          const textIndex = m.blocks.findIndex((b) => b.type === "text");
          const blocks: Message["blocks"] =
            textIndex === -1
              ? [
                  ...m.blocks,
                  {
                    type: "text" as const,
                    content: params.chunk,
                    stage: params.stage,
                  },
                ]
              : m.blocks.map((b, idx) =>
                  idx === textIndex && b.type === "text"
                    ? {
                        ...b,
                        content: b.content + params.chunk,
                        stage: params.stage,
                      }
                    : b,
                );
          return { ...m, blocks };
        });
        const paneId = paneIdOf();
        if (paneId)
          this.throttledStreamingContentUpdate(
            paneId,
            params.messageId,
            params.chunk,
            params.stage,
          );
      },
      onAssistantReasoningUpdated: (params) => {
        // Mirror reasoning deltas into the cache too (UPDATE_STREAMING_REASONING
        // semantics: chunk append, startTime on first chunk, endTime on end).
        agentRef.messages = agentRef.messages.map((m) => {
          if (m.id !== params.messageId) return m;
          const reasoningIndex = m.blocks.findIndex(
            (b) => b.type === "reasoning",
          );
          const blocks: Message["blocks"] =
            reasoningIndex === -1
              ? [
                  ...m.blocks,
                  {
                    type: "reasoning" as const,
                    content: params.chunk,
                    stage: params.stage,
                    startTime: Date.now(),
                    ...(params.stage === "end" ? { endTime: Date.now() } : {}),
                  },
                ]
              : m.blocks.map((b, idx) =>
                  idx === reasoningIndex && b.type === "reasoning"
                    ? {
                        ...b,
                        content: b.content + params.chunk,
                        stage: params.stage,
                        startTime: b.startTime ?? Date.now(),
                        ...(params.stage === "end"
                          ? { endTime: b.endTime ?? Date.now() }
                          : {}),
                      }
                    : b,
                );
          return { ...m, blocks };
        });
        const paneId = paneIdOf();
        if (paneId)
          this.throttledStreamingReasoningUpdate(
            paneId,
            params.messageId,
            params.chunk,
            params.stage,
          );
      },
      onToolBlockUpdated: (params) => {
        // Mirror tool block merges into the cache too (UPDATE_TOOL_BLOCK
        // semantics: create on first update, merge fields, append
        // parametersChunk to the accumulated parameters).
        const { messageId, id: toolBlockId, parametersChunk, ...rest } = params;
        agentRef.messages = agentRef.messages.map((m) => {
          if (m.id !== messageId) return m;
          const toolIndex = m.blocks.findIndex(
            (b) => b.type === "tool" && b.id === toolBlockId,
          );
          const blocks: Message["blocks"] =
            toolIndex === -1
              ? [
                  ...m.blocks,
                  {
                    type: "tool" as const,
                    id: toolBlockId,
                    name: rest.name || "",
                    stage: rest.stage || "start",
                    result: rest.result || "",
                    success: rest.success ?? false,
                    ...rest,
                    parameters:
                      (rest.parameters || "") + (parametersChunk || ""),
                  },
                ]
              : m.blocks.map((b, idx) => {
                  if (idx !== toolIndex || b.type !== "tool") return b;
                  const merged: ToolBlock = { ...b, ...rest };
                  if (parametersChunk) {
                    merged.parameters = (b.parameters || "") + parametersChunk;
                  }
                  return merged;
                });
          return { ...m, blocks };
        });
        const paneId = paneIdOf();
        if (paneId)
          this.postMessage({ command: "updateToolBlock", paneId, params });
      },
      onErrorBlockAdded: (error: string) => {
        // Mirror the error block into the cache too (APPEND_ERROR_BLOCK
        // semantics: append to the last assistant message, creating one if no
        // assistant message exists yet).
        const newErrorBlock: ErrorBlock = { type: "error", content: error };
        let targetIndex = -1;
        for (let i = agentRef.messages.length - 1; i >= 0; i--) {
          if (agentRef.messages[i].role === "assistant") {
            targetIndex = i;
            break;
          }
        }
        if (targetIndex === -1) {
          agentRef.messages = [
            ...agentRef.messages,
            {
              id: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`,
              role: "assistant",
              timestamp: new Date().toISOString(),
              blocks: [newErrorBlock],
            },
          ];
        } else {
          agentRef.messages = agentRef.messages.map((m, idx) =>
            idx === targetIndex
              ? { ...m, blocks: [...m.blocks, newErrorBlock] }
              : m,
          );
        }
        const paneId = paneIdOf();
        if (paneId)
          this.postMessage({ command: "updateErrorBlock", paneId, error });
      },
      onTasksChange: (tasks: Task[]) => {
        const paneId = paneIdOf();
        if (paneId) this.postMessage({ command: "updateTasks", paneId, tasks });
      },
      onBackgroundTasksChange: (tasks: BackgroundTaskSummary[]) => {
        const paneId = paneIdOf();
        if (!paneId) return;
        this.postMessage({ command: "updateBackgroundTasks", paneId, tasks });
        void this.refreshWorkflowRuns(paneId);
      },
      onSessionIdChange: (sessionId: string) => {
        this.rekeyAgent(agentRef, sessionId);
        const paneId = paneIdOf();
        if (paneId) {
          this.postMessage({
            command: "updateCurrentSession",
            paneId,
            session: {
              id: sessionId,
              sessionType: "main",
              workdir: agentRef.workingDirectory,
              lastActiveAt: new Date(),
              latestTotalTokens: agentRef.latestTotalTokens ?? 0,
              firstMessage:
                this.configStore
                  .getSessionIndex()
                  .find((e) => e.sessionId === sessionId)?.title || undefined,
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
        if (paneId)
          this.postMessage({ command: "updatePermissionMode", paneId, mode });
      },
      onWorkdirChange: (workdir: string) => {
        const paneId = paneIdOf();
        if (paneId)
          this.postMessage({ command: "updateWorkdir", paneId, workdir });
      },
      onLoadingChange: (loading: boolean) => {
        // StdioAgent already wrote isStreaming on the agent; refresh the sidebar
        // running-dot for every session, not just the visible ones.
        const paneId = paneIdOf();
        if (paneId)
          this.postMessage({
            command: loading ? "startStreaming" : "endStreaming",
            paneId,
          });
        if (!loading) {
          this.touchSessionInIndex(agentRef);
        }
        this.refreshSessionTree();
      },
      onCommandRunningChange: (running: boolean) => {
        const paneId = paneIdOf();
        if (paneId)
          this.postMessage({
            command: "updateCommandRunning",
            paneId,
            running,
          });
      },
      onQueuedMessagesChange: (messages: QueuedMessage[]) => {
        const paneId = paneIdOf();
        if (paneId)
          this.postMessage({ command: "updateQueue", paneId, queue: messages });
      },
      onMcpServersChange: (servers: McpServerStatus[]) => {
        const paneId = paneIdOf();
        if (paneId)
          this.postMessage({ command: "mcpServersUpdate", paneId, servers });
      },
      onBangMessageAdded: (params) => {
        // Bang commands append a user message with a bang block — no
        // userMessageAdded fires for it, so mirror it into the cache (same
        // shape the server builds) to keep full-state pushes coherent, then
        // forward the params incrementally. Params are nested because they
        // carry a `command` field that would clobber the postMessage
        // discriminator.
        agentRef.messages = [
          ...agentRef.messages,
          {
            id: params.messageId,
            role: "user",
            timestamp: new Date().toISOString(),
            blocks: [
              {
                type: "bang",
                command: params.command,
                output: "",
                stage: "running",
                exitCode: null,
              },
            ],
          } as Message,
        ];
        const paneId = paneIdOf();
        if (paneId)
          this.postMessage({ command: "bangMessageAdded", paneId, params });
      },
      onBangMessageUpdated: (params) => {
        agentRef.messages = agentRef.messages.map((m) =>
          m.id === params.messageId
            ? {
                ...m,
                blocks: m.blocks.map((b, idx) =>
                  idx === m.blocks.length - 1 && b.type === "bang"
                    ? { ...b, command: params.command, output: params.output }
                    : b,
                ),
              }
            : m,
        );
        const paneId = paneIdOf();
        if (paneId)
          this.postMessage({ command: "bangMessageUpdated", paneId, params });
      },
      onBangMessageCompleted: (params) => {
        agentRef.messages = agentRef.messages.map((m) =>
          m.id === params.messageId
            ? {
                ...m,
                blocks: m.blocks.map((b, idx) =>
                  idx === m.blocks.length - 1 && b.type === "bang"
                    ? {
                        ...b,
                        command: params.command,
                        exitCode: params.exitCode,
                        stage: "end",
                        ...(params.output !== undefined
                          ? { output: params.output }
                          : {}),
                      }
                    : b,
                ),
              }
            : m,
        );
        const paneId = paneIdOf();
        if (paneId)
          this.postMessage({ command: "bangMessageCompleted", paneId, params });
      },
      onNotificationMessageAdded: (params) => {
        const paneId = paneIdOf();
        if (paneId && params.message) {
          this.postMessage({
            command: "appendMessage",
            paneId,
            message: params.message,
          });
        }
      },
      onPermissionRequest: (requestId, context) => {
        void this.handleToolPermissionRequest(
          agentRef,
          context,
          requestId,
        ).then((decision) => {
          agentRef.sendPermissionResponse(requestId, decision);
        });
      },
      onBtwContent: (params) => {
        const paneId = paneIdOf();
        if (paneId) {
          this.postMessage({
            command: "btwStream",
            paneId,
            question: params.question,
            content: params.content,
            type: params.type,
          });
        }
      },
    };

    const agentRef = new StdioAgent(client, router, callbacks);
    this.agentHosts.set(agentRef, opts.host);
    if (opts.worktreeInfo)
      this.agentWorktreeInfo.set(agentRef, opts.worktreeInfo);
    return agentRef;
  }

  /** Create + initialize a fresh agent and register it in the pool. */
  private async spawnAgent(opts: {
    host?: string;
    workdir?: string;
    worktreeInfo?: WorktreeInfo;
    worktreeName?: string;
    isNewWorktree?: boolean;
    sessionId?: string;
  }): Promise<StdioAgent> {
    const host = opts.host ?? LOCAL_HOST;
    await this.ensureClientFor(host);
    const config = this.configStore.getConfiguration();
    const agent = this.createAgent({ ...opts, host });
    await agent.initialize({
      workdir: opts.workdir,
      // Restoring an existing session (e.g. re-attaching to a remote daemon
      // session): the daemon reuses the live agent instead of forking a second
      // one writing to the same transcript. Fresh sessions omit the field.
      ...(opts.sessionId ? { restoreSessionId: opts.sessionId } : {}),
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

  /**
   * A message-less, non-streaming agent is new-session scaffolding: no session
   * index entry, so the sidebar can never bring it back. Such agents must be
   * destroyed when their pane releases them, or the pool accumulates orphans.
   */
  private isBlankAgent(agent: StdioAgent): boolean {
    return agent.messages.length === 0 && !agent.isStreaming;
  }

  /** Bind an agent to a pane (replacing whatever it showed) and focus the pane. */
  private bindAgentToPane(paneId: string, agent: StdioAgent | null): void {
    const pane = this.panes.find((p) => p.paneId === paneId);
    if (!pane) return;
    // Panel groups follow the session, so the outgoing session's PTY dies with
    // the switch — the webview respawns one when the incoming session's group
    // has the terminal checked. A same-agent rebind keeps it alive.
    if (pane.agent !== agent) {
      this.terminalManager.killForPane(paneId);
      // The cached workflow runs belong to the outgoing session — drop them so
      // the incoming session never flashes a stale list.
      this.workflowRuns.delete(paneId);
    }
    const outgoing = pane.agent;
    this.clearThrottleState(paneId);
    pane.agent = agent;
    this.focusedPaneId = paneId;
    if (agent) this.touchAgentAsRecent(agent);
    // Replacing or releasing a blank agent (worktree/workdir/host switch)
    // would otherwise leak it in the pool until the app quits.
    if (outgoing && outgoing !== agent && this.isBlankAgent(outgoing)) {
      void this.discardAgent(outgoing);
    }
  }

  /**
   * Mark an agent as most-recently-used by moving it to the end of the pool
   * Map — iteration order doubles as the recency order activateWorkdir uses
   * to pick a reusable session.
   */
  private touchAgentAsRecent(agent: StdioAgent): void {
    const key = this.agentKey(this.hostForAgent(agent), agent.sessionId ?? "");
    if (!agent.sessionId || this.agents.get(key) !== agent) return;
    this.agents.delete(key);
    this.agents.set(key, agent);
  }

  /** Point a pane at an agent: sync workdir context, refresh sidebar, push its state. */
  private async activateAgentInPane(
    paneId: string,
    agent: StdioAgent,
  ): Promise<void> {
    // Any fresh activation supersedes an in-flight restore for this pane — the
    // restore's token check later discards its half-spawned agent.
    this.pendingRestores.delete(paneId);
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
    this.postMessage({ command: "scrollToBottom", paneId });
    this.postMessage({ command: "focusInput", paneId });
  }

  /** Push the pane layout (rows, order, session bindings, widths, focus) to the webview. */
  private pushPanes(): void {
    this.postMessage({
      command: "desktopPanes",
      panes: this.panes.map((p) => ({
        paneId: p.paneId,
        sessionId: p.agent?.sessionId,
        host: p.agent
          ? this.hostForAgent(p.agent)
          : (this.hostState.get(p.paneId) ?? LOCAL_HOST),
        width: p.width,
        row: p.row ?? 0,
      })),
      rowHeights:
        this.topRowHeight != null
          ? [this.topRowHeight, 1 - this.topRowHeight]
          : undefined,
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
        this.showToast({
          message: `连接主机 ${host} 失败：${error instanceof Error ? error.message : String(error)}`,
        });
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
  private async handleOpenPane(
    workdir: string,
    sessionId: string,
    opts?: unknown,
  ): Promise<void> {
    if (!sessionId) return;
    const existing = this.panes.find((p) => p.agent?.sessionId === sessionId);
    if (existing) {
      this.handleFocusPane(existing.paneId);
      this.postMessage({ command: "focusInput", paneId: existing.paneId });
      return;
    }
    const o = (opts ?? {}) as {
      insertionIndex?: unknown;
      row?: unknown;
      newRow?: unknown;
    };
    const insertionIndex =
      typeof o.insertionIndex === "number" && Number.isFinite(o.insertionIndex)
        ? Math.trunc(o.insertionIndex)
        : undefined;
    const optRow = o.row === 0 || o.row === 1 ? o.row : undefined;
    const newRow =
      o.newRow === "above" || o.newRow === "below" ? o.newRow : undefined;
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
  private insertNewPane(
    opts: {
      insertionIndex?: number;
      row?: 0 | 1;
      newRow?: "above" | "below";
    } = {},
  ): string | null {
    const { insertionIndex, row: optRow, newRow } = opts;
    const hasSecondRow = this.panes.some((p) => p.row === 1);
    const paneId = `pane-${++this.paneCounter}`;

    if (newRow && !hasSecondRow) {
      // Split the single row into two; the new pane is alone in its fresh row.
      if (!this.canSplitRows()) {
        this.showToast({ message: "窗口高度不足，无法拆分为两行" });
        return null;
      }
      if (newRow === "above")
        this.panes.forEach((p) => {
          p.row = 1;
        });
      this.panes.push({ paneId, agent: null, row: newRow === "above" ? 0 : 1 });
    } else {
      // A drag drop names its target row and skips the width gate; a click
      // overflows into the other row, a fresh second row, or a refusal.
      const named = optRow !== undefined;
      let targetRow =
        optRow ??
        (newRow === "above"
          ? 0
          : newRow === "below"
            ? 1
            : this.rowOfPane(this.focusedPaneId));
      if (!named && !this.canAddPane(targetRow)) {
        const otherRow = targetRow === 0 ? 1 : 0;
        if (hasSecondRow && this.canAddPane(otherRow)) {
          targetRow = otherRow;
        } else if (!hasSecondRow && this.canSplitRows()) {
          targetRow = 1;
        } else {
          this.showToast({
            message: hasSecondRow
              ? "窗口宽度不足，无法添加更多分屏"
              : "空间不足，无法添加更多分屏",
          });
          return null;
        }
      }
      const rowPanes = this.panes.filter((p) => (p.row ?? 0) === targetRow);
      const count = rowPanes.length;
      const widths = rowPanes.map((p) => p.width ?? 1 / count);
      rowPanes.forEach((p, i) => {
        p.width = widths[i] * (count / (count + 1));
      });
      const at =
        insertionIndex === undefined
          ? count
          : Math.max(0, Math.min(count, insertionIndex));
      rowPanes.splice(at, 0, {
        paneId,
        agent: null,
        width: 1 / (count + 1),
        row: targetRow,
      });
      const others = this.panes.filter((p) => (p.row ?? 0) !== targetRow);
      this.panes =
        targetRow === 0 ? [...rowPanes, ...others] : [...others, ...rowPanes];
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
      row1.forEach((p) => {
        p.row = 0;
      });
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
    if (rowPanes.length === 0 || rowPanes.every((p) => p.width === undefined))
      return;
    const sum = rowPanes.reduce<number>(
      (total, p) => total + (p.width ?? 0),
      0,
    );
    if (sum > WIDTH_EPSILON)
      rowPanes.forEach((p) => {
        p.width = (p.width ?? 0) / sum;
      });
  }

  /**
   * Move a pane (drag the pane header). `toRow`+`toIndex` inserts it at a
   * position within the target row (cross-row moves shrink the target row and
   * re-expand the source row proportionally); `newRow` ('above'|'below')
   * splits the single row into two with the pane alone in the fresh row.
   */
  private handleMovePane(
    paneId: string,
    opts: { toRow?: unknown; toIndex?: unknown; newRow?: unknown },
  ): void {
    const from = this.panes.findIndex((p) => p.paneId === paneId);
    if (from === -1) return;
    const fromRow = this.panes[from].row ?? 0;
    const newRow =
      opts.newRow === "above" || opts.newRow === "below"
        ? opts.newRow
        : undefined;
    const toRow = opts.toRow === 0 || opts.toRow === 1 ? opts.toRow : undefined;
    const toIndex =
      typeof opts.toIndex === "number" && Number.isFinite(opts.toIndex)
        ? Math.trunc(opts.toIndex)
        : undefined;
    const hasSecondRow = this.panes.some((p) => p.row === 1);

    // Split into two rows: the moved pane becomes the sole member of its row.
    const wantsSplit =
      (newRow != null && !hasSecondRow) ||
      (toRow != null &&
        toRow !== fromRow &&
        !this.panes.some((p) => (p.row ?? 0) === toRow));
    if (wantsSplit) {
      if (this.panes.length <= 1) return;
      if (!this.canSplitRows()) {
        this.showToast({ message: "窗口高度不足，无法拆分为两行" });
        return;
      }
      const targetRow = newRow != null ? (newRow === "above" ? 0 : 1) : toRow!;
      const [moved] = this.panes.splice(from, 1);
      moved.row = targetRow;
      moved.width = undefined;
      this.panes.forEach((p) => {
        p.row = targetRow === 0 ? 1 : 0;
      });
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
      this.panes =
        fromRow === 0 ? [...rowPanes, ...others] : [...others, ...rowPanes];
    } else {
      this.renormalizeRowWidths(fromRow);
      const rowPanes = this.panes.filter((p) => (p.row ?? 0) === targetRow);
      const count = rowPanes.length;
      rowPanes.forEach((p) => {
        p.width = (p.width ?? 1 / count) * (count / (count + 1));
      });
      moved.row = targetRow;
      moved.width = 1 / (count + 1);
      const at = Math.max(0, Math.min(count, toIndex));
      rowPanes.splice(at, 0, moved);
      const others = this.panes.filter((p) => (p.row ?? 0) !== targetRow);
      this.panes =
        targetRow === 0 ? [...rowPanes, ...others] : [...others, ...rowPanes];
    }
    this.pushPanes();
  }

  /** Apply separator-drag widths for one row (ratios in that row's order, normalized here). */
  private handleResizePanes(widths: unknown, row: unknown): void {
    const r = row === 1 ? 1 : 0;
    const rowPanes = this.panes.filter((p) => (p.row ?? 0) === r);
    if (!Array.isArray(widths) || widths.length !== rowPanes.length) return;
    if (
      widths.some((w) => typeof w !== "number" || !Number.isFinite(w) || w <= 0)
    )
      return;
    const sum = widths.reduce((total: number, w: number) => total + w, 0);
    if (sum <= WIDTH_EPSILON) return;
    rowPanes.forEach((p, i) => {
      p.width = widths[i] / sum;
    });
    this.pushPanes();
  }

  /** Apply row-separator drag heights ([top, bottom] px or ratios, normalized here). */
  private handleResizePaneRows(heights: unknown): void {
    if (!Array.isArray(heights) || heights.length !== 2) return;
    if (
      heights.some(
        (h) => typeof h !== "number" || !Number.isFinite(h) || h <= 0,
      )
    )
      return;
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
    const closedAgent = this.panes[idx].agent;
    const closedRow = this.panes[idx].row ?? 0;
    this.panes.splice(idx, 1);
    // Only the pane-scoped new-session draft dies with the pane — session
    // drafts belong to the conversation, which keeps running in the background.
    this.inputDrafts.delete(`new:${paneId}`);
    this.workflowRuns.delete(paneId);
    this.hostState.delete(paneId);
    // An in-flight restore for the closed pane is dead — its token check
    // discards the half-spawned agent.
    this.pendingRestores.delete(paneId);
    // A blank agent has no session to keep running in the background — destroy
    // it instead of leaving it orphaned in the pool.
    if (closedAgent && this.isBlankAgent(closedAgent)) {
      void this.discardAgent(closedAgent);
    }
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
      this.postMessage({ command: "focusInput", paneId: neighbor.paneId });
      this.emitPanelState();
    }
    this.pushPanes();
  }

  /**
   * Bind an existing session to a pane: reuse a live agent from the pool when
   * possible, otherwise start an optimistic restore (the pane switches to the
   * target behind the sweep overlay while the agent spawns + replays).
   */
  private async bindSessionToPane(
    paneId: string,
    workdir: string,
    sessionId: string,
  ): Promise<void> {
    const entry = this.configStore
      .getSessionIndex()
      .find((e) => e.sessionId === sessionId);
    const host = entry?.host ?? LOCAL_HOST;
    const agent = this.agents.get(this.agentKey(host, sessionId));
    if (agent) {
      this.hostState.set(paneId, host);
      await this.activateAgentInPane(paneId, agent);
      return;
    }
    // Worktree sessions are grouped under the repo root in the sidebar, but
    // their session files live at the worktree path — resolve the real
    // directory the same way handleSelectSession does, otherwise restore
    // looks in the wrong project store and the pane stays a new session.
    const targetDir = entry?.worktree ? entry.cwd : workdir;
    this.startPaneRestore(paneId, { sessionId, workdir: targetDir, host });
    void this.runPaneRestore(paneId, {
      sessionId,
      workdir: targetDir,
      host,
      entry,
    });
  }

  /**
   * Mark a pane as "restoring a session": the webview immediately switches to
   * the target session (header + sidebar highlight + sweep overlay) while the
   * old agent stays bound underneath. pushPaneSessionState reads this entry to
   * override the session + set isRestoring. Returns the restore token, which
   * runPaneRestore uses to detect superseding actions.
   */
  private startPaneRestore(
    paneId: string,
    opts: { sessionId: string; workdir: string; host: string },
  ): void {
    this.pendingRestores.set(paneId, {
      sessionId: opts.sessionId,
      workdir: opts.workdir,
      token: ++this.restoreToken,
    });
    this.hostState.set(paneId, opts.host);
    // Refresh the pane's host label immediately — the pane is switching to the
    // target host while the restore (possibly a slow SSH connect) runs behind
    // the sweep overlay.
    this.pushPanes();
    void this.pushPaneSessionState(paneId);
  }

  /**
   * Background half of startPaneRestore: connect the host, spawn + restore the
   * agent, then activate it in the pane. Every step re-checks the restore
   * token — a newer selection, activation or pane close supersedes this
   * restore, in which case the freshly spawned agent is discarded. Returns
   * true when the pane is settled (restored, or superseded by a newer action);
   * false only in autoReconnect mode after a failed attempt, meaning the
   * sequence should back off and retry.
   */
  private async runPaneRestore(
    paneId: string,
    opts: {
      sessionId: string;
      workdir: string;
      host: string;
      entry?: SessionIndexEntry;
      autoReconnect?: boolean;
    },
  ): Promise<boolean> {
    const token = this.pendingRestores.get(paneId)?.token;
    let agent: StdioAgent | undefined;
    try {
      agent = await this.spawnAgent({
        host: opts.host,
        workdir: opts.workdir,
        worktreeInfo: opts.entry?.worktree,
        sessionId: opts.sessionId,
      });
      if (this.pendingRestores.get(paneId)?.token !== token) {
        await this.discardAgent(agent);
        return true;
      }
      await agent.restoreSession(opts.sessionId);
      if (this.pendingRestores.get(paneId)?.token !== token) {
        await this.discardAgent(agent);
        return true;
      }
      // Restore is a bare RPC — the daemon does not deliver the transcript, so
      // pull it into the cache. Without this, a re-attached session (remote or
      // local) opens with an empty list and its agent looks "blank".
      try {
        await agent.getMessages();
      } catch (error) {
        console.warn("[DesktopHost] getMessages failed:", error);
      }
      this.rekeyAgent(agent, opts.sessionId);
      // activateAgentInPane clears the pending entry — the pane is now live.
      await this.activateAgentInPane(paneId, agent);
      this.ensureSessionRegistered(agent);
      this.touchSessionInIndex(agent);
      this.refreshSessionTree();
      // Re-attach approvals the daemon held while no client was connected —
      // they resurface as the same dialogs a live session would show.
      if (opts.host !== LOCAL_HOST) {
        void this.attachPendingPermissionsForSession(
          opts.host,
          opts.sessionId,
          agent,
        );
      }
      return true;
    } catch (error) {
      console.error("[DesktopHost] 恢复会话失败:", error);
      // A superseded restore already cleaned up via its token checks.
      if (this.pendingRestores.get(paneId)?.token !== token) return true;
      if (opts.autoReconnect) {
        // Auto-reconnect mode: keep the sweep overlay (pendingRestores entry)
        // — the sequence retries and owns the give-up message. Discard an
        // agent that never made it into a pane.
        if (agent && this.paneIdForAgent(agent) !== paneId) {
          void this.discardAgent(agent);
        }
        return false;
      }
      this.pendingRestores.delete(paneId);
      // A failed restore leaves the previous agent bound (or nothing for a
      // fresh pane) — push that state so the overlay disappears. An agent
      // that never made it into a pane is destroyed.
      if (agent && this.paneIdForAgent(agent) !== paneId) {
        void this.discardAgent(agent);
      }
      await this.pushPaneSessionState(paneId);
      this.pushSystemMessage(
        `恢复会话失败: ${error instanceof Error ? error.message : String(error)}`,
        paneId,
      );
      return true;
    }
  }

  /**
   * Remove a spawned-but-unbound agent from the pool and destroy it. The
   * shared stdio client survives (other sessions may still use it); the
   * router entry dies with the agent.
   */
  private async discardAgent(agent: StdioAgent): Promise<void> {
    const host = this.hostForAgent(agent);
    for (const [key, a] of this.agents) {
      if (a === agent) this.agents.delete(key);
    }
    this.agentHosts.delete(agent);
    this.agentWorktreeInfo.delete(agent);
    if (agent.sessionId) {
      try {
        this.clientFor(host).router.unregister(agent.sessionId);
      } catch {
        // Client may already be gone; best-effort
      }
    }
    await agent.destroy().catch(() => {
      /* best-effort */
    });
  }

  /**
   * Detach every agent of a host from the pool WITHOUT destroying it — the
   * session keeps running on the remote daemon (真后台) and is re-attached
   * through a fresh tunnel on the next access. Pane bindings are released to
   * the new-session state (the picker stays on the remote host); sidebar
   * running/waiting markers vanish because a disconnected host cannot report
   * live state, which is also what a dead daemon looks like (spec scenario 10).
   */
  private dropHostAgents(host: string): void {
    const released = new Set<StdioAgent>();
    for (const [key, agent] of this.agents) {
      if (this.hostForAgent(agent) === host) {
        this.agents.delete(key);
        released.add(agent);
      }
    }
    for (const agent of released) {
      this.agentHosts.delete(agent);
      this.agentWorktreeInfo.delete(agent);
      for (const [confirmationId, p] of this.pendingConfirmations) {
        if (p.agent === agent) this.pendingConfirmations.delete(confirmationId);
      }
    }
    for (const pane of this.panes) {
      if (pane.agent && released.has(pane.agent)) {
        this.bindAgentToPane(pane.paneId, null);
        this.workflowRuns.delete(pane.paneId);
      }
    }
    if (released.size > 0) {
      this.refreshSessionTree();
      this.pushPanes();
    }
  }

  // -- auto-reconnect (spec: SSH 远程会话自动重连) -------------------------------

  /** Pane-bound sessions of a host whose tunnel dropped — auto-reconnect targets. */
  private collectReconnectTargets(host: string): ReconnectTarget[] {
    const index = this.configStore.getSessionIndex();
    const targets: ReconnectTarget[] = [];
    for (const pane of this.panes) {
      const agent = pane.agent;
      if (!agent || !agent.sessionId) continue;
      if (this.hostForAgent(agent) !== host) continue;
      const entry = index.find((e) => e.sessionId === agent.sessionId);
      targets.push({
        paneId: pane.paneId,
        sessionId: agent.sessionId,
        workdir: entry?.cwd ?? agent.workingDirectory ?? "",
        host,
        entry,
      });
    }
    return targets;
  }

  /** Launch one auto-reconnect sequence per affected pane. */
  private startAutoReconnect(targets: ReconnectTarget[]): void {
    for (const t of targets) {
      void this.autoReconnectPane(t);
    }
  }

  /**
   * Re-attach a pane's session after its host's tunnel dropped. Each attempt
   * reuses the sidebar-restore machinery (overlay + token checks); a failure
   * keeps the overlay and backs off (base delay doubles per attempt). Any user
   * action that supersedes the restore — new session, pane close, host switch,
   * manual re-select — stops the sequence: canAutoReconnect and the restore
   * token checks both detect it.
   */
  private async autoReconnectPane(t: ReconnectTarget): Promise<void> {
    for (let attempt = 1; attempt <= AUTO_RECONNECT_MAX_ATTEMPTS; attempt++) {
      if (!this.canAutoReconnect(t)) return;
      // A tunnel that dropped on system sleep triggers this on wake, when the
      // network stack is usually not back yet — wait out the post-resume grace
      // so attempts don't burn on dead air (spec scenario 2/11).
      await this.waitForNetworkGraceIfResumed();
      if (!this.canAutoReconnect(t)) return;
      this.startPaneRestore(t.paneId, {
        sessionId: t.sessionId,
        workdir: t.workdir,
        host: t.host,
      });
      const handled = await this.runPaneRestore(t.paneId, {
        ...t,
        autoReconnect: true,
      });
      if (handled) return;
      if (attempt < AUTO_RECONNECT_MAX_ATTEMPTS) {
        await new Promise((resolve) =>
          setTimeout(
            resolve,
            DesktopHost.autoReconnectBaseDelayMs * 2 ** (attempt - 1),
          ),
        );
      }
    }
    // Give up: clear the overlay (the pane returns to the new-session state)
    // and tell the user the session is still running remotely and reachable.
    if (this.pendingRestores.get(t.paneId)?.sessionId === t.sessionId) {
      this.pendingRestores.delete(t.paneId);
      await this.pushPaneSessionState(t.paneId);
      this.pushSystemMessage(
        `与 ${t.host} 的连接断开后自动重连失败（已尝试 ${AUTO_RECONNECT_MAX_ATTEMPTS} 次），会话仍在远端运行，请检查网络后从侧边栏重新进入。`,
        t.paneId,
      );
    }
  }

  /** Wait out the post-resume network grace period when the system just woke up. */
  private async waitForNetworkGraceIfResumed(): Promise<void> {
    const remaining =
      DesktopHost.autoReconnectResumeGraceMs - (Date.now() - this.lastResumeAt);
    if (remaining > 0) {
      await new Promise((resolve) => setTimeout(resolve, remaining));
    }
  }

  /** Per-attempt pre-check: the pane must still be the empty restore target. */
  private canAutoReconnect(t: ReconnectTarget): boolean {
    const pane = this.panes.find((p) => p.paneId === t.paneId);
    if (!pane) return false; // pane closed
    if (pane.agent) return false; // user bound a session (incl. a manual re-attach)
    if (this.hostState.get(t.paneId) !== t.host) return false; // host switched
    // No entry yet = the first attempt (startPaneRestore runs after this
    // check); an entry that no longer targets this session means a user
    // action superseded the restore.
    const pending = this.pendingRestores.get(t.paneId);
    if (pending && pending.sessionId !== t.sessionId) return false;
    return true;
  }

  /** Lazily-created per-pane throttle state. */
  private paneThrottle(paneId: string): PaneThrottle {
    let t = this.paneThrottles.get(paneId);
    if (!t) {
      t = {};
      this.paneThrottles.set(paneId, t);
    }
    return t;
  }

  /** Clear a pane's throttle timers/pending slots (before rebind or close). */
  private clearThrottleState(paneId: string): void {
    const t = this.paneThrottles.get(paneId);
    if (!t) return;
    for (const timer of [t.streamingContentTimer, t.streamingReasoningTimer]) {
      if (timer) clearTimeout(timer);
    }
    this.paneThrottles.delete(paneId);
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
      if (a === agent) {
        oldKey = key;
        break;
      }
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
  private async activateWorkdir(opts: {
    host?: string;
    dir: string;
    forceNew?: boolean;
    paneId?: string;
  }): Promise<void> {
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
        if (this.panes.some((p) => p.agent === agent && p.paneId !== paneId))
          continue;
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
      this.showToast({
        message: `初始化失败：${error instanceof Error ? error.message : String(error)}`,
      });
    }
  }

  // ------------------------------------------------------------------
  // Tool permission flow
  // ------------------------------------------------------------------

  private handleToolPermissionRequest(
    agent: StdioAgent,
    context: ToolPermissionContext,
    requestId: string,
  ): Promise<PermissionDecision> {
    return new Promise((resolve) => {
      this.pushPendingConfirmation(agent, context, requestId, resolve);
    });
  }

  /** Record a pending tool confirmation and pop its dialog when the session is visible. */
  private pushPendingConfirmation(
    agent: StdioAgent,
    context: ToolPermissionContext,
    requestId: string,
    resolve: (decision: PermissionDecision) => void,
  ): void {
    const confirmationId = `confirmation_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;

    let confirmationType: string;
    if ([EDIT_TOOL_NAME, WRITE_TOOL_NAME].includes(context.toolName)) {
      confirmationType = "代码修改待确认";
    } else if (context.toolName === BASH_TOOL_NAME) {
      confirmationType = "命令执行待确认";
    } else if (
      context.toolName === EXIT_PLAN_MODE_TOOL_NAME ||
      context.toolName === ENTER_PLAN_MODE_TOOL_NAME
    ) {
      confirmationType = "计划待确认";
    } else if (context.toolName === ASK_USER_QUESTION_TOOL_NAME) {
      confirmationType = "问题待回答";
    } else {
      confirmationType = "操作待确认";
    }

    this.pendingConfirmations.set(confirmationId, {
      resolve,
      requestId,
      agent,
      toolName: context.toolName,
      confirmationType,
      toolInput: context.toolInput,
      planContent: context.planContent,
      suggestedPrefix: context.suggestedPrefix,
      hidePersistentOption: context.hidePersistentOption,
      permissionMode: context.permissionMode,
      warning: context.warning,
    });
    this.refreshSessionTree();

    // Only a visible session pops the dialog; a background session's request
    // stays pending and is surfaced when the user switches back to it.
    const paneId = this.paneIdForAgent(agent);
    if (paneId) {
      this.postMessage({
        command: "showConfirmation",
        paneId,
        confirmationId,
        toolName: context.toolName,
        confirmationType,
        toolInput: context.toolInput,
        planContent: context.planContent,
        suggestedPrefix: context.suggestedPrefix,
        hidePersistentOption: context.hidePersistentOption,
        permissionMode: context.permissionMode,
        warning: context.warning,
      });
    }
  }

  /**
   * Re-attach a remote session's pending approvals after a disconnect
   * (spec scenario 4/5): the daemon holds them while no client is connected,
   * and a fresh tunnel snapshot surfaces them as the same confirmation dialogs
   * a live session would show. Re-surfaced entries resolve straight back to
   * the daemon client — there is no in-process wait for them.
   */
  private async attachPendingPermissionsForSession(
    host: string,
    sessionId: string,
    agent: StdioAgent,
  ): Promise<void> {
    try {
      const result = (await this.utilityClientFor(host).request(
        "listPendingPermissions",
      )) as {
        requests: Array<{
          requestId: string;
          sessionId?: string;
          context: ToolPermissionContext;
        }>;
      };
      for (const req of result.requests ?? []) {
        if (req.sessionId && req.sessionId !== sessionId) continue;
        if (
          [...this.pendingConfirmations.values()].some(
            (p) => p.requestId === req.requestId,
          )
        )
          continue;
        this.pushPendingConfirmation(
          agent,
          req.context,
          req.requestId,
          (decision) => {
            agent.sendPermissionResponse(req.requestId, decision);
          },
        );
      }
    } catch (error) {
      console.error("[DesktopHost] 恢复待确认审批失败:", error);
    }
  }

  private handleConfirmationResponse(
    confirmationId: string,
    approved: boolean,
    decision?: PermissionDecision,
  ): void {
    const pending = this.pendingConfirmations.get(confirmationId);
    if (!pending) {
      console.warn("[DesktopHost] 收到未知确认响应:", confirmationId);
      return;
    }
    this.pendingConfirmations.delete(confirmationId);
    this.refreshSessionTree();
    if (approved) {
      pending.resolve(
        decision ?? ({ behavior: "allow" } as PermissionDecision),
      );
    } else {
      pending.resolve({
        behavior: "deny",
        message: "用户拒绝了操作",
      } as PermissionDecision);
      void pending.agent.abortMessage();
    }
    const paneId = this.paneIdForAgent(pending.agent) ?? this.focusedPaneId;
    this.postMessage({ command: "focusInput", paneId });
    this.postMessage({ command: "scrollToBottom", paneId });
  }

  // ------------------------------------------------------------------
  // Initial state / sessions
  // ------------------------------------------------------------------

  private async pushInitialState(): Promise<void> {
    const configurationData = this.configStore.getConfiguration();
    let isAuthenticated = false;
    try {
      const authResult = (await this.utilityClientFor(this.currentHost).request(
        "getAuthStatus",
      )) as { isAuthenticated: boolean; serverUrl: string };
      isAuthenticated = authResult.isAuthenticated;
      if (authResult.serverUrl) {
        this.configStore.setConfiguration({ serverUrl: authResult.serverUrl });
        configurationData.serverUrl = authResult.serverUrl;
      }
    } catch (error) {
      console.error(
        "[DesktopHost] Failed to get auth status on webview ready:",
        error,
      );
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
    // Workflow runs refresh in the background — a live remote session's RPC
    // round trip (SSH hop) must not delay the session switch. The cache shows
    // immediately; refreshWorkflowRuns supersedes it when the response lands.
    if (agent) {
      void this.refreshWorkflowRuns(paneId).catch(() => {});
    }
    // The pane binding may have changed while a workflow-runs refresh was in
    // flight (a restore completed / a new session selected). Re-read everything
    // at send time so the pushed message is self-consistent; the pending entry
    // is also resolved here so a stale overlay can never clobber a completed
    // restore.
    const current = this.agentForPane(paneId);
    const pending = this.pendingRestores.get(paneId);
    const pendingConfirmations = Array.from(this.pendingConfirmations.entries())
      .filter(([, p]) => p.agent === current)
      .map(([confirmationId, p]) => ({
        confirmationId,
        toolName: p.toolName,
        confirmationType: p.confirmationType,
        toolInput: p.toolInput,
        suggestedPrefix: p.suggestedPrefix,
        permissionMode: p.permissionMode,
      }));

    this.postMessage({
      command: "setInitialState",
      paneId,
      messages: current?.messages ?? [],
      tasks: current?.tasks ?? [],
      backgroundTasks: current?.backgroundTasks ?? [],
      workflowRuns: this.workflowRuns.get(paneId) ?? [],
      inputContent: this.inputDrafts.get(this.draftKeyForPane(paneId)) ?? "",
      isStreaming: current?.isStreaming ?? false,
      isCommandRunning: current?.isCommandRunning ?? false,
      isCompacting: current?.isCompacting ?? false,
      // While a restore is pending the pane already shows the target session,
      // so the session override comes from the pending target, not the
      // still-bound old agent (which only feeds the overlay's underlying view).
      isRestoring: !!pending,
      session: pending
        ? {
            id: pending.sessionId,
            sessionType: "main",
            workdir: pending.workdir,
            lastActiveAt: new Date(),
            latestTotalTokens: 0,
            // The restored transcript isn't loaded yet — backfill the header title
            // from the session index like the post-restore push does.
            firstMessage:
              this.configStore
                .getSessionIndex()
                .find((e) => e.sessionId === pending.sessionId)?.title ||
              undefined,
          }
        : current?.sessionId
          ? {
              id: current.sessionId,
              sessionType: "main",
              workdir: current.workingDirectory,
              lastActiveAt: new Date(),
              latestTotalTokens: current.latestTotalTokens,
              // Backfill the header title from the session index: after compaction
              // the pushed messages start at the compact boundary, so the webview
              // can no longer derive the first user message itself.
              firstMessage:
                this.configStore
                  .getSessionIndex()
                  .find((e) => e.sessionId === current.sessionId)?.title ||
                undefined,
            }
          : undefined,
      configurationData,
      pendingConfirmations,
      permissionMode: current?.getPermissionMode(),
      queuedMessages: current?.queuedMessages ?? [],
      isAuthenticated: this.lastIsAuthenticated,
      workdir: current?.workingDirectory,
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
        this.postMessage({ command: "desktopSessionTree", groups: [] });
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
          waitingConfirmation: agent
            ? agentsWithPendingConfirmation.has(agent)
            : false,
        };
      }),
    }));
    this.postMessage({
      command: "desktopSessionTree",
      groups: this.sessionTree,
    });
  }

  /** Upsert an agent's session into the desktop-owned session index (FR-024). */
  private registerSessionInIndex(
    agent: StdioAgent,
    sessionId: string,
    title = "",
  ): void {
    const cwd = agent.workingDirectory;
    if (!cwd || !this.configStore) return;
    const existing = this.configStore
      .getSessionIndex()
      .find((e) => e.sessionId === sessionId);
    // An agent without worktree context must never clobber the persisted
    // worktree info of an existing entry.
    const worktreeInfo =
      this.agentWorktreeInfo.get(agent) ?? existing?.worktree;
    // Worktree sessions group under the original repo root (workdir) while the
    // agent's actual working directory (cwd) stays the worktree path (FR-024).
    this.configStore.upsertSession({
      sessionId,
      host: this.hostForAgent(agent),
      // An established title wins; a re-registration must never wipe it.
      title: title || existing?.title || "",
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
    const existing = this.configStore
      .getSessionIndex()
      .find((e) => e.sessionId === sessionId);
    if (existing?.title) return;
    this.registerSessionInIndex(
      agent,
      sessionId,
      sessionTitleFromMessages(agent.messages),
    );
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
    const entry = this.configStore
      .getSessionIndex()
      .find((e) => e.sessionId === sessionId);
    const host = entry?.host ?? LOCAL_HOST;
    const target = this.agents.get(this.agentKey(host, sessionId));
    const boundPaneIds = this.panes
      .filter(
        (p) =>
          p.agent !== null &&
          (p.agent === target || p.agent.sessionId === sessionId),
      )
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
      ? target.destroy().catch(() => {
          /* best-effort */
        })
      : Promise.resolve();

    this.configStore.removeSession(sessionId);
    // The conversation (and its per-session draft) is gone.
    this.inputDrafts.delete(`session:${sessionId}`);
    // The session is gone — release every tunnel it referenced. Tunnels are
    // session-scoped (scenario 18): deleting a session is one of the only ways
    // a physical ssh forward closes, alongside the process dying on its own and
    // the app quitting.
    this.portForwardManager.releaseSession(sessionId);
    // Update the sidebar right away — the worktree cleanup below runs in the
    // background and must not hold back the tree refresh.
    this.refreshSessionTree();

    if (resetSolePane) {
      if (
        entry?.worktree &&
        (await this.pathExistsOn(host, entry.worktree.repoRoot))
      ) {
        await this.activateWorkdir({
          host,
          dir: entry.worktree.repoRoot,
          forceNew: true,
        });
      } else {
        await this.handleNewSession(undefined, true);
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
      result = (await this.utilityClientFor(h).request("createWorktree", {
        workdir,
        baseBranch,
        name,
      })) as typeof result;
    } catch (error) {
      this.pushSystemMessage(
        `创建 worktree 失败：${error instanceof Error ? error.message : String(error)}`,
      );
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
      this.showToast({
        message: `初始化失败：${error instanceof Error ? error.message : String(error)}`,
      });
      return;
    }
    if (text) {
      await this.handleSendMessage(text, images);
    }
  }

  /** FR-052 proxy: branch list for the new-session worktree selector. The
   * reply carries paneId so each pane consumes only its own branch list — a
   * sibling pane focusing and re-querying must not overwrite this pane. */
  private async handleListGitBranches(
    workdir: string,
    paneId?: string,
  ): Promise<void> {
    const h = this.hostForPane(paneId);
    try {
      // A fresh launch's first query (webview mount) can land before
      // webviewReady has spawned the stdio client. Await the client instead of
      // replying null — the webview never re-queries on a null reply, which
      // would leave the branch/worktree controls hidden until the user
      // re-picks a workdir.
      await this.ensureClientFor(h);
      const result = await this.utilityClientFor(h).request("listGitBranches", {
        workdir,
      });
      this.postMessage({
        command: "desktopGitBranches",
        workdir,
        paneId,
        result,
      });
    } catch {
      this.postMessage({
        command: "desktopGitBranches",
        workdir,
        paneId,
        result: null,
      });
    }
  }

  /** Best-effort worktree removal via stdio (FR-053), routed to the entry's host. */
  private async removeWorktree(
    host: string,
    params: { path: string; branch: string; repoRoot: string },
  ): Promise<void> {
    try {
      await this.utilityClientFor(host).request("removeWorktree", params);
    } catch {
      // best-effort — stdio removeWorktree never throws
    }
  }

  private async refreshWorkflowRuns(paneId: string): Promise<void> {
    const agent = this.agentForPane(paneId);
    if (!agent) return;
    const runs = await agent.getWorkflowRuns();
    // The pane may have switched to another session while the RPC was in
    // flight — never write a stale session's runs into the new one.
    if (this.agentForPane(paneId) !== agent) return;
    this.workflowRuns.set(paneId, runs);
    this.postMessage({ command: "updateWorkflowRuns", paneId, runs });
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
      case "desktopReady":
        // workdir is per-launch only (never persisted) — a fresh launch
        // always starts at the placeholder until the user picks a directory.
        this.sendWorkdirState();
        break;

      case "desktopSelectWorkdir":
        await this.handleSelectWorkdir();
        break;

      case "desktopSelectHost":
        await this.handleSelectHost(msg.host as string);
        break;

      case "desktopShowHint":
        // Webview-side local validations (pane/panel min-size refusals, preview
        // URL checks) route through the same global toast so desktop hints share
        // one presentation with host failures instead of a second hint style.
        this.showToast({ message: msg.text as string });
        break;

      case "desktopAddHost":
        await this.handleAddHost(msg.connectionString as string);
        break;

      case "desktopSelectRemotePath":
        await this.handleSelectRemotePath(
          msg.host as string,
          msg.path as string,
        );
        break;

      case "desktopListRemoteDir":
        await this.handleListRemoteDir(
          msg.host as string,
          msg.path as string,
          msg.requestId as string,
        );
        break;

      case "desktopSelectRecentWorkdir":
        await this.handleSelectRecentWorkdir(
          msg.path as string,
          msg.host as string | undefined,
        );
        break;

      case "desktopRemoveRecentWorkdir":
        this.configStore.removeRecentWorkdir({
          host: (msg.host as string) ?? this.currentHost,
          path: msg.path as string,
        });
        this.sendWorkdirState();
        break;

      case "desktopSelectSession":
        await this.handleSelectSession(
          msg.workdir as string,
          msg.sessionId as string,
        );
        break;

      // -- chat lifecycle ----------------------------------------------
      case "webviewReady":
        await this.handleWebviewReady();
        break;

      case "sendMessage":
        await this.handleSendMessage(
          msg.text as string,
          msg.images as Array<{ data: string; mediaType: string }> | undefined,
          msg.force as boolean | undefined,
          pid,
        );
        break;

      case "abortMessage":
        await this.agentForPane(pid)?.abortMessage();
        break;

      case "clearChat": {
        // 与 IDE 插件对齐：/clear 原地清空当前会话（agent.clearMessages 会
        // 中止进行中的生成并换新 sessionId），不 spawn 新 agent。clearMessages
        // 触发的 sessionIdChange 在 RPC 中途到达——先把缓存清空，让该处理器
        // 的空会话守卫（messages.length > 0）仍然成立；随后按需拉取权威的
        // （已清空的）列表并推给 webview。
        const agent = this.agentForPane(pid);
        if (agent) {
          agent.messages = [];
          await agent.clearMessages();
          await this.pullAndPushMessages(agent, pid);
        }
        break;
      }

      case "newSession":
        await this.handleNewSession(pid);
        break;

      case "desktopNewSessionInPane":
        await this.handleNewSessionInNewPane();
        break;

      case "compact":
        try {
          await this.agentForPane(pid)?.compact(
            (msg.customInstructions as string) || undefined,
          );
        } catch (error) {
          this.pushSystemMessage(`压缩对话失败: ${error}`, pid);
        }
        break;

      case "rewindToMessage":
        await this.handleRewindToMessage(msg.messageId as string, pid);
        break;

      case "listRewindCheckpoints":
        await this.handleListRewindCheckpoints(pid);
        break;

      case "getConfiguredModels":
        await this.handleGetConfiguredModels(pid);
        break;

      case "setModel":
        await this.handleSetModel(msg.model as string, pid);
        break;

      case "askBtw":
        await this.handleAskBtw(msg.question as string, pid);
        break;

      case "confirmationResponse":
        this.handleConfirmationResponse(
          msg.confirmationId as string,
          msg.approved as boolean,
          msg.decision as PermissionDecision | undefined,
        );
        break;

      case "setPermissionMode":
        try {
          await this.agentForPane(pid)?.setPermissionMode(
            msg.mode as PermissionMode,
          );
        } catch (error) {
          this.pushSystemMessage(`设置权限模式失败: ${error}`, pid);
        }
        break;

      // -- message queue -------------------------------------------------
      case "deleteQueuedMessage":
        await this.agentForPane(pid)?.removeQueuedMessage(msg.index as number);
        break;

      case "updateQueuedMessage": {
        const ok = await this.agentForPane(pid)?.updateQueuedMessageById(
          msg.id as string,
          {
            content: msg.text as string,
            images: msg.images as
              | Array<{ path: string; mimeType: string }>
              | undefined,
          },
        );
        if (!ok) {
          this.postMessage({
            command: "updateQueuedMessageMissing",
            paneId: pid,
            id: msg.id,
          });
        }
        break;
      }

      case "deleteQueuedMessageById":
        await this.agentForPane(pid)?.removeQueuedMessageById(msg.id as string);
        break;

      // -- sessions -------------------------------------------------------
      case "desktopDeleteSession":
        await this.handleDeleteSession(msg.sessionId as string);
        break;

      case "desktopCreateWorktree":
        await this.handleCreateWorktree(
          msg.workdir as string,
          msg.baseBranch as string | undefined,
          msg.name as string | undefined,
          msg.text as string | undefined,
          msg.images as Array<{ data: string; mediaType: string }> | undefined,
          msg.host as string | undefined,
        );
        break;

      case "desktopListGitBranches":
        await this.handleListGitBranches(
          msg.workdir as string,
          msg.paneId as string | undefined,
        );
        break;

      // Read-only workspace diff for the diff panel — runs git directly in
      // the main process rather than via the stdio CLI (large output, and
      // the CLI has no reusable implementation). Remote sessions run the git
      // and file reads over ssh (spec scenario 14).
      case "desktopGetWorkspaceDiff": {
        const paneAgent = this.agentForPane(pid);
        const cwd = paneAgent?.workingDirectory ?? this.workdir;
        const result = cwd
          ? await getWorkspaceDiff(cwd, this.hostForAgent(paneAgent))
          : ({ kind: "not-a-repo" } as const);
        this.postMessage({
          command: "desktopWorkspaceDiff",
          paneId: pid,
          result,
        });
        break;
      }

      // -- terminal panel ---------------------------------------------------
      case "desktopTerminalCreate": {
        const paneAgent = this.agentForPane(pid);
        const cwd = paneAgent?.workingDirectory ?? this.workdir;
        if (!cwd) {
          this.postMessage({
            command: "desktopTerminalExit",
            termId: msg.termId,
            error: "无法确定终端工作目录",
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

      case "desktopTerminalInput":
        this.terminalManager.write(msg.termId as string, msg.data as string);
        break;

      case "desktopTerminalResize":
        this.terminalManager.resize(
          msg.termId as string,
          msg.cols as number,
          msg.rows as number,
        );
        break;

      case "desktopTerminalKill":
        this.terminalManager.kill(msg.termId as string);
        break;

      // Remote preview: forward a localhost URL over ssh and load the
      // rewritten loopback address (spec scenario 15-18). The webview sends
      // the host it computed (effectiveHost); defaults to the pane's host. The
      // session id scopes the tunnel's lifetime — it survives UI actions and is
      // only released when the session is deleted (scenario 18).
      case "desktopForwardPort": {
        const host = (msg.host as string) || this.hostForPane(pid);
        try {
          const result = await this.portForwardManager.acquire(
            host,
            msg.url as string,
            msg.sessionId as string | undefined,
          );
          this.postMessage({
            command: "desktopForwardPortResult",
            paneId: pid,
            requestId: msg.requestId,
            url: result.url,
            originalUrl: result.originalUrl,
          });
        } catch (error) {
          this.postMessage({
            command: "desktopForwardPortResult",
            paneId: pid,
            requestId: msg.requestId,
            error: error instanceof Error ? error.message : String(error),
          });
        }
        break;
      }

      // Pane panel toggle state — drives the 面板 menu checkboxes.
      case "desktopPanelState": {
        this.panePanelState.set(pid, (msg.checked as PanelKind[]) ?? []);
        if (pid === this.focusedPaneId) this.emitPanelState();
        break;
      }

      case "desktopOpenPane":
        await this.handleOpenPane(
          msg.workdir as string,
          msg.sessionId as string,
          {
            insertionIndex: msg.insertionIndex,
            row: msg.row,
            newRow: msg.newRow,
          },
        );
        break;

      case "desktopClosePane":
        this.handleClosePane(msg.paneId as string);
        break;

      case "desktopFocusPane":
        this.handleFocusPane(msg.paneId as string);
        break;

      case "desktopMovePane":
        this.handleMovePane(msg.paneId as string, {
          toRow: msg.toRow,
          toIndex: msg.toIndex,
          newRow: msg.newRow,
        });
        break;

      case "desktopResizePanes":
        this.handleResizePanes(msg.widths, msg.row);
        break;

      case "desktopResizePaneRows":
        this.handleResizePaneRows(msg.heights);
        break;

      case "desktopPreviewState":
        // The preview pane reports its width (0 = closed) so the min-pane-width
        // gate can deduct it from the chat area.
        this.previewWidthPx =
          typeof msg.width === "number" && msg.width > 0 ? msg.width : 0;
        break;

      case "restoreSession":
        await this.handleRestoreSession(msg.sessionId as string);
        break;

      // -- configuration (FR-006) ------------------------------------------
      case "getConfiguration":
        this.postMessage({
          command: "configurationResponse",
          configurationData: this.configStore.getConfiguration(),
        });
        break;

      case "updateConfiguration":
        await this.handleUpdateConfiguration(
          msg.configurationData as DesktopConfigData,
        );
        break;

      // -- status / updates (FR-009/010) -------------------------------------
      case "getStatus": {
        const paneAgent = this.agentForPane(pid);
        this.postMessage({
          command: "statusResponse",
          version: app.getVersion(),
          sessionId: paneAgent?.sessionId ?? "",
          // Report the session root (initialize-time cwd), not the subdir the
          // agent bash-cd'd into — the workdir shown must match what @file
          // searches, not the agent's transient cwd.
          workdir:
            paneAgent?.sessionCwd ??
            paneAgent?.workingDirectory ??
            this.workdir ??
            "",
          configurationData: this.configStore.getConfiguration(),
        });
        break;
      }

      case "checkForUpdates":
        await this.handleCheckForUpdates(true);
        break;

      // -- auth ----------------------------------------------------------------
      case "getAuthStatus":
        await this.handleGetAuthStatus();
        break;

      case "login":
        await this.handleLogin();
        break;

      case "logout":
        await this.handleLogout();
        break;

      // -- MCP --------------------------------------------------------------------
      case "getMcpServers": {
        const paneAgent = this.agentForPane(pid);
        const servers = paneAgent ? await paneAgent.getMcpServers() : [];
        this.postMessage({
          command: "mcpServersResponse",
          paneId: pid,
          servers,
        });
        break;
      }

      case "getSubagentConfigurations": {
        const paneAgent = this.agentForPane(pid);
        const configurations = paneAgent
          ? await paneAgent.getSubagentConfigurations()
          : [];
        this.postMessage({
          command: "subagentConfigurationsResponse",
          paneId: pid,
          configurations,
        });
        break;
      }

      case "connectMcpServer":
        try {
          await this.agentForPane(pid)?.connectMcpServer(
            msg.serverName as string,
          );
        } catch (error) {
          this.showToast({ message: `连接 MCP 服务器失败: ${error}` });
        }
        break;

      case "disconnectMcpServer":
        try {
          await this.agentForPane(pid)?.disconnectMcpServer(
            msg.serverName as string,
          );
        } catch (error) {
          this.showToast({ message: `断开 MCP 服务器失败: ${error}` });
        }
        break;

      // -- plugins / marketplace ---------------------------------------------------
      case "listPlugins":
        await this.handleListPlugins();
        break;

      case "installPlugin":
        await this.handlePluginMutation("installPlugin", {
          pluginId: msg.pluginId,
          scope: msg.scope as Scope | undefined,
        });
        break;

      case "enablePlugin":
        await this.handlePluginMutation("enablePlugin", {
          pluginId: msg.pluginId,
          scope: msg.scope as Scope | undefined,
        });
        break;

      case "disablePlugin":
        await this.handlePluginMutation("disablePlugin", {
          pluginId: msg.pluginId,
          scope: msg.scope as Scope | undefined,
        });
        break;

      case "getProjectSettings":
        await this.handleGetProjectSettings(pid);
        break;

      case "setBuiltinPluginEnabled":
        await this.handleSetBuiltinPluginEnabled(
          pid,
          msg.pluginId as string,
          msg.enabled as boolean,
          msg.scope as Scope | undefined,
        );
        break;

      case "uninstallPlugin":
        await this.handlePluginMutation("uninstallPlugin", {
          pluginId: msg.pluginId,
        });
        break;

      case "updatePlugin":
        await this.handlePluginMutation("updatePlugin", {
          pluginId: msg.pluginId,
        });
        break;

      case "listMarketplaces":
        await this.handleListMarketplaces();
        break;

      case "addMarketplace":
        await this.handleMarketplaceMutation("addMarketplace", {
          input: msg.input,
        });
        break;

      case "removeMarketplace":
        await this.handleMarketplaceMutation("removeMarketplace", {
          name: msg.name,
        });
        break;

      case "updateMarketplace":
        await this.handleMarketplaceMutation("updateMarketplace", {
          name: msg.name,
        });
        break;

      // -- background tasks / workflows ----------------------------------------------
      case "getBackgroundTaskOutput": {
        const paneAgent = this.agentForPane(pid);
        const output = paneAgent
          ? await paneAgent.getBackgroundTaskOutput(msg.taskId as string)
          : null;
        this.postMessage({
          command: "backgroundTaskOutput",
          paneId: pid,
          taskId: msg.taskId,
          output,
        });
        break;
      }

      case "stopBackgroundTask": {
        const paneAgent = this.agentForPane(pid);
        const success = paneAgent
          ? await paneAgent.stopBackgroundTask(msg.taskId as string)
          : false;
        this.postMessage({
          command: "backgroundTaskStopped",
          paneId: pid,
          taskId: msg.taskId,
          success,
        });
        break;
      }

      case "backgroundCurrentTask": {
        const paneAgent = this.agentForPane(pid);
        await paneAgent?.backgroundCurrentTask();
        break;
      }

      case "getWorkflowRuns": {
        const paneAgent = this.agentForPane(pid);
        const runs = paneAgent ? await paneAgent.getWorkflowRuns() : [];
        this.postMessage({
          command: "workflowRunsResponse",
          paneId: pid,
          runs,
        });
        break;
      }

      case "stopWorkflowRun": {
        const paneAgent = this.agentForPane(pid);
        const success = paneAgent
          ? await paneAgent.stopWorkflowRun(msg.runId as string)
          : false;
        this.postMessage({
          command: "workflowRunStopped",
          paneId: pid,
          runId: msg.runId,
          success,
        });
        break;
      }

      // -- prompt history --------------------------------------------------------------
      case "requestHistory":
        await this.handleRequestHistory();
        break;

      case "searchHistory":
        await this.handleSearchHistory(msg.query as string);
        break;

      // -- file suggestions / uploads ---------------------------------------------------
      case "requestFileSuggestions":
        await this.handleFileSuggestions(
          msg.filterText as string,
          msg.requestId as string,
        );
        break;

      case "uploadFilesToArtifacts":
        await this.handleUploadFilesToArtifacts(
          msg.files as Array<{ name: string; data: ArrayBuffer }>,
        );
        break;

      // -- file panel: paths clicked in messages open here, not the OS ----------
      case "openFile":
        await this.handleFilePanelOpen(
          pid,
          msg.path as string,
          msg.startLine as number | undefined,
          msg.endLine as number | undefined,
        );
        break;

      case "previewImage":
        // Remote images render inline in the panel as base64; local ones too.
        await this.handleFilePanelOpen(pid, msg.path as string);
        break;

      // Local sessions only: leave the panel and open in the OS default app.
      case "desktopOpenFileExternal":
        await this.handleOpenPath(msg.path as string);
        break;

      case "openExternal": {
        const url = msg.url as string;
        if (url && /^(https?|mailto):/.test(url)) {
          try {
            await shell.openExternal(url);
          } catch (error) {
            this.pushSystemMessage(`打开外部链接失败: ${error}`);
          }
        } else {
          console.warn(
            "[DesktopHost] Refused to open external URL with unexpected scheme:",
            url,
          );
        }
        break;
      }

      case "toastAction":
        this.handleToastAction(msg.action as ToastAction);
        break;

      case "showError":
        console.error("[DesktopHost] Webview error:", msg.message);
        this.pushSystemMessage(`${msg.message as string}`);
        break;

      case "updateInputContent": {
        // The webview tags every update with the session its input belonged to
        // at edit time, so a debounced save arriving after the pane switched
        // sessions still lands on the right conversation (scenario 12). Untagged
        // messages (session-less hosts) fall back to the pane's current session.
        const sessionId = msg.sessionId as string | undefined;
        if (sessionId) {
          this.inputDrafts.set(
            `session:${sessionId}`,
            (msg.content as string) ?? "",
          );
        } else {
          this.inputDrafts.set(
            this.draftKeyForPane(pid),
            (msg.content as string) ?? "",
          );
        }
        break;
      }

      case "requestSlashCommands":
        await this.handleSlashCommandsRequest(msg.filterText as string, pid);
        break;

      default:
        console.warn("[DesktopHost] Unhandled webview command:", msg.command);
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
          console.warn("[DesktopHost] Update check failed:", err);
        });
      }
    } catch (error) {
      console.error("[DesktopHost] 初始化智能体失败:", error);
      this.showToast({
        message: `初始化失败：${error instanceof Error ? error.message : String(error)}。可通过侧边栏切换工作目录重试，或重启应用`,
      });
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
      const authResult = (await this.utilityClientFor(host).request(
        "getAuthStatus",
      )) as {
        isAuthenticated: boolean;
        user?: { id: string; email?: string };
        serverUrl: string;
      };
      if (authResult.serverUrl) {
        this.configStore.setConfiguration({ serverUrl: authResult.serverUrl });
      }
      this.lastIsAuthenticated = authResult.isAuthenticated;
      this.postMessage({
        command: "authStatusResponse",
        isAuthenticated: authResult.isAuthenticated,
        user: authResult.user,
        serverUrl: authResult.serverUrl,
      });
    } catch (error) {
      console.error(
        `[DesktopHost] Failed to get auth status for host ${host}:`,
        error,
      );
    }
  }

  /**
   * Pick a host for the focused pane's new-session workdir picker. Only
   * hosts from ~/.ssh/config (or 本地) are accepted; switching host re-sends
   * workdir state so the picker shows that host's recents (spec scenario 1).
   */
  private async handleSelectHost(host: string): Promise<void> {
    if (host !== LOCAL_HOST && !parseSshConfigHosts().includes(host)) {
      this.showToast({ message: `未知主机：${host}` });
      return;
    }
    const pid = this.focusedPaneId;
    const active = this.agentForPane(pid);
    // A message-less agent is still the new-session picker state (新对话 binds a
    // fresh empty agent to the pane). Switching host releases it so the pane's
    // reported host follows the picker — a bound agent would otherwise pin the
    // label to its own host and the selector never leaves the old one. The
    // empty agent has no session yet, so releasing it loses nothing.
    if (
      active &&
      active.messages.length === 0 &&
      !active.isStreaming &&
      this.hostForAgent(active) !== host
    ) {
      this.bindAgentToPane(pid, null);
      this.pushPaneSessionState(pid);
    }
    this.hostState.set(pid, host);
    // The picker's default workdir is the new host's first recent directory
    // (desktop-app.md scenario 23). A released or never-bound pane still holds
    // the previous host's directory in both the host-side current workdir and
    // the webview's state.workdir — clear both so the picker falls back to the
    // new host's recents[0] instead of showing a stale path from another host.
    // A bound agent (real session) pins the pane to its own host, so skip.
    if (!this.agentForPane(pid)) {
      this.workdir = undefined;
      this.postMessage({
        command: "updateWorkdir",
        paneId: pid,
        workdir: undefined,
      });
    }
    // Establish the host's client eagerly, then re-query the auth status on
    // that host — the state cached at webview-ready belongs to the previous
    // host, so without the re-query the welcome page keeps showing the old
    // host's 登录 button. Failures surface as a system message, the picker
    // updates immediately.
    this.ensureClientFor(host)
      .then(() => this.refreshAuthStatus(host))
      .catch((error) => {
        this.showToast({
          message: `连接主机 ${host} 失败：${error instanceof Error ? error.message : String(error)}`,
        });
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
      this.showToast({
        message: error instanceof Error ? error.message : String(error),
      });
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
    // Same as handleSelectHost: with no bound agent the pane is still the
    // new-session picker, so clear the previous host's workdir from both the
    // host-side state and the webview (desktop-app.md scenario 23).
    if (!this.agentForPane(pid)) {
      this.workdir = undefined;
      this.postMessage({
        command: "updateWorkdir",
        paneId: pid,
        workdir: undefined,
      });
    }
    this.ensureClientFor(name)
      .then(() => this.refreshAuthStatus(name))
      .catch((error) => {
        this.showToast({
          message: `连接主机 ${name} 失败：${error instanceof Error ? error.message : String(error)}`,
        });
      });
    // Notices surface as a window-global toast — pushing them as chat messages
    // would flip the pane out of the new-session picker state and hide the
    // host/workdir selectors.
    this.showToast({ message: `已添加主机：${name}` });
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
  private async handleSelectRemotePath(
    host: string,
    path: string,
  ): Promise<void> {
    if (host === LOCAL_HOST || !path) return;
    if (!parseSshConfigHosts().includes(host)) {
      this.showToast({ message: `未知主机：${host}` });
      return;
    }
    if (!(await remotePathExists(host, path))) {
      this.showToast({ message: `远端目录不存在：${path}` });
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
  private async handleListRemoteDir(
    host: string,
    path: string,
    requestId: string,
  ): Promise<void> {
    if (host === LOCAL_HOST || !path || !requestId) return;
    try {
      const { resolvedPath, dirs } = await listRemoteDirs(host, path);
      this.postMessage({
        command: "desktopRemoteDirList",
        host,
        requestId,
        resolvedPath,
        dirs,
      });
    } catch (error) {
      this.postMessage({
        command: "desktopRemoteDirList",
        host,
        requestId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private async handleSelectWorkdir(): Promise<void> {
    if (!this.mainWindow) return;
    const result = await dialog.showOpenDialog(this.mainWindow, {
      title: "选择工作目录",
      properties: ["openDirectory", "createDirectory"],
    });
    if (result.canceled || result.filePaths.length === 0) return;
    // The OS dialog only picks local directories — the picker's host is
    // pinned to 本地 after a browse.
    this.hostState.set(this.focusedPaneId, LOCAL_HOST);
    await this.activateWorkdir({ host: LOCAL_HOST, dir: result.filePaths[0] });
  }

  private async handleSelectRecentWorkdir(
    dir: string,
    host?: string,
  ): Promise<void> {
    const h = host ?? this.hostState.get(this.focusedPaneId) ?? LOCAL_HOST;
    if (!(await this.pathExistsOn(h, dir))) {
      // Picker-only hygiene: removing a recent dir never touches the
      // index-derived session tree (FR-006), so no refreshSessionTree here.
      this.configStore.removeRecentWorkdir({ host: h, path: dir });
      this.sendWorkdirState();
      this.showToast({ message: `目录不存在：${dir}，已从最近列表移除` });
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
  private async handleSelectSession(
    workdir: string,
    sessionId: string,
    paneId?: string,
  ): Promise<void> {
    if (!workdir || !sessionId) return;
    const pid = paneId ?? this.focusedPaneId;
    const pane = this.panes.find((p) => p.paneId === pid);
    if (!pane) return;
    if (pane.agent?.sessionId === sessionId) return; // already shown in this pane
    // An older restore for this pane is still heading to the same session —
    // clicking again must not restart the SSH connect + transcript replay.
    if (this.pendingRestores.get(pid)?.sessionId === sessionId) return;

    // One session, one pane — refocus where it's already visible.
    const otherPane = this.panes.find((p) => p.agent?.sessionId === sessionId);
    if (otherPane) {
      this.handleFocusPane(otherPane.paneId);
      this.postMessage({ command: "focusInput", paneId: otherPane.paneId });
      return;
    }

    const entry = this.configStore
      .getSessionIndex()
      .find((e) => e.sessionId === sessionId);
    const host = entry?.host ?? LOCAL_HOST;
    const targetDir = entry?.worktree ? entry.cwd : workdir;

    // A live agent activates with zero network round trips — checked before
    // the optimistic switch, so clicking a session that is already running
    // (e.g. streaming in a background pane) never waits for an SSH probe.
    const live = this.agents.get(this.agentKey(host, sessionId));
    if (live) {
      this.hostState.set(pid, host);
      await this.activateAgentInPane(pid, live);
      return;
    }

    // Historical session: switch the pane to the target immediately behind the
    // sweep overlay, then spawn + restore in the background — the SSH connect
    // and transcript replay can take seconds on a remote host. The token guard
    // aborts the restore if the user picks/activates something else first.
    // Carry the entry's worktree info so re-registration keeps the session
    // grouped under the repo root (and recents free of the ephemeral path).
    this.startPaneRestore(pid, { sessionId, workdir: targetDir, host });

    void (async () => {
      // The directory probe is a remote `ssh test -d` (fresh process, no
      // connection reuse) — it must run behind the overlay, not in front of
      // the pane switch, or the user waits for the SSH hop before the
      // "selected" feedback (desktop-app.md「历史会话即时进入」scenario 2).
      if (!(await this.pathExistsOn(host, targetDir))) {
        // Directory gone — cancel the still-in-flight restore so the overlay
        // drops and the previous agent falls back, then auto-clear the stale
        // index entry (worktree or not, per FR-020 stale-directory behavior).
        // For non-worktree dirs the entry is also removed from the
        // recent-workdirs picker list.
        if (this.pendingRestores.get(pid)?.sessionId === sessionId) {
          this.pendingRestores.delete(pid);
          await this.pushPaneSessionState(pid);
        }
        this.configStore.removeSession(sessionId);
        this.inputDrafts.delete(`session:${sessionId}`);
        if (!entry?.worktree) {
          this.configStore.removeRecentWorkdir({ host, path: workdir });
          this.sendWorkdirState();
        }
        this.refreshSessionTree();
        this.showToast({
          message: entry?.worktree
            ? `worktree 目录不存在：${targetDir}，已从会话列表移除`
            : `目录不存在：${workdir}，已从最近列表与会话列表移除`,
        });
        return;
      }

      // A restore from another pane may have rekeyed this session into the
      // pool while the probe was in flight — activate it rather than spawn a
      // duplicate agent.
      const nowLive = this.agents.get(this.agentKey(host, sessionId));
      if (nowLive) {
        this.hostState.set(pid, host);
        await this.activateAgentInPane(pid, nowLive);
        return;
      }

      await this.runPaneRestore(pid, {
        sessionId,
        workdir: targetDir,
        host,
        entry,
      });
    })();
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
  private sessionCycleSnapshot: Array<{
    workdir: string;
    sessionId: string;
  }> | null = null;
  private sessionCycleIndex = -1;

  async activateAdjacentSession(direction: 1 | -1): Promise<void> {
    const currentId = this.activeAgent?.sessionId;
    if (
      !this.sessionCycleSnapshot ||
      this.sessionCycleSnapshot[this.sessionCycleIndex]?.sessionId !== currentId
    ) {
      const flat = this.sessionTree.flatMap((group) =>
        group.sessions.map((s) => ({
          workdir: group.workdir,
          sessionId: s.sessionId,
        })),
      );
      const index = flat.findIndex((s) => s.sessionId === currentId);
      this.sessionCycleSnapshot = flat;
      // An untracked current session sits before the first entry for next and
      // after the last for previous, so the first press lands on an edge.
      this.sessionCycleIndex =
        index === -1 ? (direction === 1 ? -1 : flat.length) : index;
    }
    const snapshot = this.sessionCycleSnapshot;
    if (!snapshot || snapshot.length === 0) return;
    this.sessionCycleIndex =
      (this.sessionCycleIndex + direction + snapshot.length) % snapshot.length;
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
      this.pushSystemMessage("请先选择工作目录", pid);
      return;
    }

    try {
      const processedImages = images?.length
        ? images.map((image) => ({
            path: image.data,
            mimeType: image.mediaType,
          }))
        : undefined;

      if (text.startsWith("!")) {
        await agent.bang(text.slice(1));
      } else {
        await agent.sendMessage(text, processedImages, force ?? false);
      }
    } catch (error) {
      console.error("[DesktopHost] 发送消息失败:", error);
      this.pushSystemMessage(`发送消息失败: ${error}`, pid);
    }
  }

  /**
   * New session in a pane (FR-031/032): spawn a fresh agent and bind it to the
   * pane WITHOUT aborting, clearing or destroying the previous one — background
   * sessions keep generating. No-op when the pane's session is already empty.
   * `backOffOnRestore` is set by the delete-session flow: its automatic
   * replacement must yield to a historical session the user selected while the
   * delete was in flight (the pane's agent is still null during the restore,
   * so the generic stale-guard below cannot see the selection).
   */
  private async handleNewSession(
    paneId?: string,
    backOffOnRestore = false,
  ): Promise<void> {
    const pid = paneId ?? this.focusedPaneId;
    const active = this.agentForPane(pid);
    // New session cwd = the most recently user-selected repo root (recents),
    // decoupled from the previous session's state (worktree session, bash cd,
    // etc.). See desktop-app.md「会话管理」scenario 8. No fallback to
    // this.workdir — it follows the focused pane and could be a worktree path.
    // The host is the pane's pending picker host (spec scenario 1/9).
    const host = this.hostState.get(pid) ?? LOCAL_HOST;
    const dir = this.configStore.getRecentWorkdirsForHost(host)[0];
    if (!dir) {
      // No recents — the user never picked a directory (scenario 10). The 新对话
      // entry must still work: release the pane to the blank new-session state
      // (workdir picker shows the "选择工作目录…" placeholder) instead of
      // silently dropping the click. A real session's agent is not blank, so it
      // stays in the pool and remains re-selectable from the sidebar; only a
      // blank agent is discarded by bindAgentToPane. Sending a message here is
      // still intercepted by handleSendMessage's 请先选择工作目录 guard.
      if (backOffOnRestore && this.pendingRestores.has(pid)) return;
      this.bindAgentToPane(pid, null);
      this.workdir = undefined;
      this.postMessage({
        command: "updateWorkdir",
        paneId: pid,
        workdir: undefined,
      });
      this.sendWorkdirState();
      this.pushPanes();
      await this.pushPaneSessionState(pid);
      return;
    }
    // No no-op guard for an already-empty active session: clicking 新对话 is an
    // explicit intent, and the blank agent is discarded by bindAgentToPane when
    // replaced (delete-sole-session auto-replacement used to make the button a
    // silent dead click — user feedback "点不动").
    try {
      const agent = await this.spawnAgent({ host, workdir: dir });
      // Spawning is slow (agent init) — the user may have selected another
      // session meanwhile; don't clobber their view, and destroy the
      // just-spawned agent so it doesn't linger orphaned in the pool.
      if (this.agentForPane(pid) !== active) {
        await this.discardAgent(agent);
        return;
      }
      if (backOffOnRestore && this.pendingRestores.has(pid)) {
        // The user selected a historical session while the delete was in
        // flight — its restore owns this pane. Destroy the just-spawned
        // agent so it doesn't linger orphaned in the pool.
        await this.discardAgent(agent);
        return;
      }
      await this.activateAgentInPane(pid, agent);
    } catch (error) {
      console.error("[DesktopHost] 新建对话失败:", error);
      this.pushSystemMessage(`新建对话失败: ${error}`, pid);
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
    // An already-empty new-session pane is focused instead of duplicated —
    // checked before the dir lookup so an empty recents list can't dead-end
    // the entry (scenario 10): the new pane is still created, just without a
    // bound agent until the user picks a directory.
    const empty = this.panes.find((p) => {
      const a = p.agent;
      return !a || (a.messages.length === 0 && !a.isStreaming);
    });
    if (empty) {
      this.handleFocusPane(empty.paneId);
      this.postMessage({ command: "focusInput", paneId: empty.paneId });
      return;
    }
    const paneId = this.insertNewPane();
    if (!paneId) return;
    if (!dir) {
      // No recents — the user never picked a directory (scenario 10). Insert a
      // blank new-session pane (workdir picker shows the "选择工作目录…"
      // placeholder) without spawning an agent; sending a message here is still
      // intercepted by handleSendMessage's 请先选择工作目录 guard.
      this.workdir = undefined;
      this.postMessage({
        command: "updateWorkdir",
        paneId,
        workdir: undefined,
      });
      this.sendWorkdirState();
      await this.pushPaneSessionState(paneId);
      return;
    }
    try {
      const agent = await this.spawnAgent({ host, workdir: dir });
      // Spawning is slow (agent init) — the pane may have been closed meanwhile.
      // Destroy the just-spawned agent so it doesn't linger orphaned in the pool.
      if (!this.panes.some((p) => p.paneId === paneId)) {
        await this.discardAgent(agent);
        return;
      }
      await this.activateAgentInPane(paneId, agent);
    } catch (error) {
      console.error("[DesktopHost] 新建分屏对话失败:", error);
      this.pushSystemMessage(`新建对话失败: ${error}`, paneId);
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
    const entry = this.configStore
      .getSessionIndex()
      .find((e) => e.sessionId === sessionId);
    const workdir = entry
      ? entry.worktree
        ? entry.cwd
        : entry.workdir
      : this.workdir;
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
      console.error("[DesktopHost] 获取回滚点失败:", error);
    }
    this.postMessage({
      command: "rewindCheckpoints",
      paneId: pid,
      checkpoints,
    });
  }

  private async handleGetConfiguredModels(paneId?: string): Promise<void> {
    const pid = paneId ?? this.focusedPaneId;
    const agent = this.agentForPane(pid);
    let models: string[] = [];
    let currentModel: string | undefined;
    try {
      if (agent) {
        ({ models, currentModel } = await agent.getConfiguredModels());
      }
    } catch (error) {
      console.error("[DesktopHost] 获取模型列表失败:", error);
    }
    this.postMessage({
      command: "configuredModels",
      paneId: pid,
      models,
      currentModel,
    });
  }

  private async handleSetModel(model: string, paneId?: string): Promise<void> {
    const pid = paneId ?? this.focusedPaneId;
    try {
      await this.agentForPane(pid)?.setModel(model);
    } catch (error) {
      console.error("[DesktopHost] 设置模型失败:", error);
    }
  }

  private async handleAskBtw(question: string, paneId?: string): Promise<void> {
    const pid = paneId ?? this.focusedPaneId;
    const agent = this.agentForPane(pid);
    if (!agent) {
      this.postMessage({
        command: "btwError",
        paneId: pid,
        question,
        error: "智能体未初始化",
      });
      return;
    }
    try {
      const answer = await agent.askBtw(question);
      this.postMessage({
        command: "btwResponse",
        paneId: pid,
        question,
        answer,
      });
    } catch (error) {
      console.error("[DesktopHost] 旁路提问失败:", error);
      this.postMessage({
        command: "btwError",
        paneId: pid,
        question,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private async handleRewindToMessage(
    messageId: string,
    paneId?: string,
  ): Promise<void> {
    const pid = paneId ?? this.focusedPaneId;
    const agent = this.agentForPane(pid);
    if (!agent || !this.mainWindow) return;
    // The webview already showed the confirmation dialog — execute directly.
    try {
      const { inputContent } = await agent.rewindToMessage(messageId);
      this.inputDrafts.set(this.draftKeyForPane(pid), inputContent);
      // Rewind truncates the list server-side; pull it into the cache, then
      // setInitialState below carries it to the webview.
      await this.pullAndPushMessages(agent, pid);
      await this.pushPaneSessionState(pid);
      this.postMessage({ command: "focusInput", paneId: pid });
      this.postMessage({ command: "scrollToBottom", paneId: pid });
    } catch (error) {
      console.error("[DesktopHost] 回滚会话失败:", error);
      this.pushSystemMessage(`回滚失败: ${error}`, pid);
    }
  }

  private async handleUpdateConfiguration(
    configData: DesktopConfigData,
  ): Promise<void> {
    try {
      this.configStore.setConfiguration(configData);
      const config = this.configStore.getConfiguration();
      await this.updateAgentConfig(config);
      this.postMessage({ command: "configurationUpdated" });
      this.postMessage({
        command: "configurationResponse",
        configurationData: config,
      });
      this.postMessage({ command: "focusInput" });
      this.postMessage({ command: "scrollToBottom" });
    } catch (error) {
      console.error("[DesktopHost] Failed to save configuration:", error);
      this.postMessage({
        command: "configurationError",
        error: `Failed to save configuration: ${error}`,
      });
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
          this.postMessage({ command: "endStreaming", paneId });
        }
      }
    }
    await this.clearQueue();
  }

  private async handleCheckForUpdates(manual: boolean): Promise<void> {
    const serverUrl = this.configStore.getConfiguration().serverUrl;

    // Logged in → the codechat feed drives updates via electron-updater
    // (background download + one-shot install). Unauthenticated installs fall
    // back to the GitHub Releases flow (system message + download URL).
    if (serverUrl) {
      if (!this.autoUpdaterService) {
        this.autoUpdaterService = new AutoUpdaterService({
          onUpdateAvailable: (info) =>
            this.showToast({
              message: `发现新版本 v${info.version}（当前 v${app.getVersion()}），正在后台下载…`,
            }),
          onUpdateDownloaded: (info) =>
            void this.handleUpdateDownloaded(info.version),
          onError: () => void this.handleAutoUpdaterError(serverUrl),
        });
      }
      const outcome = await this.autoUpdaterService.checkForUpdates(serverUrl);
      if (outcome === "update") return;
      if (outcome === "no-update") {
        if (manual) this.showToast({ message: "当前已是最新版本" });
        return;
      }
      // outcome === 'error': electron-updater already emitted 'error' on this
      // failure (routed above to handleAutoUpdaterError, the single manual
      // fallback). Falling back again here would show two identical
      // "发现新版本" toasts.
      return;
    }

    // checkForUpdate throws when the check itself failed — don't present that
    // as "already up to date".
    let info: ManualUpdateInfo | null = null;
    try {
      info = await checkForUpdate(app.getVersion(), serverUrl);
    } catch (error) {
      console.warn("[DesktopHost] Update check failed:", error);
      if (manual) {
        this.showToast({ message: "检查更新失败，请稍后重试" });
      }
      return;
    }
    if (info) {
      this.showToast({
        message: `发现新版本 v${info.latestVersion}（当前 v${info.currentVersion}）`,
        actionLabel: "打开下载页",
        action: { type: "openDownloadPage", url: info.downloadUrl },
      });
    } else if (manual) {
      this.showToast({ message: "当前已是最新版本" });
    }
  }

  /** The background download (or a later check) errored — degrade to the
   *  manual checker so the user still learns about the update with a URL. */
  private async handleAutoUpdaterError(serverUrl: string): Promise<void> {
    console.warn(
      "[DesktopHost] Auto updater errored, falling back to manual check",
    );
    let info: ManualUpdateInfo | null = null;
    try {
      info = await checkForUpdate(app.getVersion(), serverUrl);
    } catch (error) {
      console.warn("[DesktopHost] Update check failed:", error);
      return;
    }
    if (info) {
      this.showToast({
        message: `发现新版本 v${info.latestVersion}（当前 v${info.currentVersion}）`,
        actionLabel: "打开下载页",
        action: { type: "openDownloadPage", url: info.downloadUrl },
      });
    }
  }

  /** The new version finished downloading — announce it via a toast whose
   *  「重启安装」 button quits and installs directly (no second confirm dialog). */
  private handleUpdateDownloaded(version: string): void {
    this.showToast({
      message: `新版本 v${version} 已下载完成，重启应用以完成安装。`,
      actionLabel: "重启安装",
      action: { type: "quitAndInstall" },
    });
  }

  /** A toast's button was clicked: quit-and-install the downloaded update, or
   *  open the manual download page. The webview sends the opaque action payload
   *  back verbatim, so the host stays the single source of the action semantics. */
  private handleToastAction(action: ToastAction): void {
    if (action.type === "quitAndInstall") {
      this.autoUpdaterService?.quitAndInstall();
    } else if (
      action.type === "openDownloadPage" &&
      /^(https?):/.test(action.url)
    ) {
      void shell.openExternal(action.url);
    }
  }

  private async handleGetAuthStatus(): Promise<void> {
    try {
      const result = (await this.utilityClientFor(this.currentHost).request(
        "getAuthStatus",
      )) as {
        isAuthenticated: boolean;
        user: { id: string; email?: string } | undefined;
        serverUrl: string;
      };
      if (result.serverUrl) {
        this.configStore.setConfiguration({ serverUrl: result.serverUrl });
      }
      this.postMessage({
        command: "authStatusResponse",
        isAuthenticated: result.isAuthenticated,
        user: result.user,
        serverUrl: result.serverUrl,
      });
      this.postMessage({
        command: "configurationResponse",
        configurationData: this.configStore.getConfiguration(),
      });
    } catch (error) {
      console.error("[DesktopHost] 获取认证状态失败:", error);
      this.postMessage({
        command: "authStatusResponse",
        isAuthenticated: false,
        user: null,
      });
    }
  }

  /**
   * Route a remote host's SSO auth URL to the system browser (spec: SSO 登录
   * scenario 8). The daemon's callback server listens on the remote 127.0.0.1
   * and a browser on this machine can't reach it directly — forward the
   * callback port over SSH, rewrite callback_url to the local forwarded port,
   * and only then open the page. The tunnel is kept in pendingAuthTunnels and
   * torn down by handleLogin once the request settles.
   */
  private async handleRemoteAuthUrl(host: string, url: string): Promise<void> {
    try {
      const forward = await this.portForwardManager.forwardAuthCallback(
        host,
        url,
      );
      this.pendingAuthTunnels.set(host, forward);
      void shell.openExternal(forward.authUrl);
    } catch (error) {
      console.error(`[DesktopHost] ${host} 的 SSO 回调端口转发失败:`, error);
      this.pushSystemMessage(
        `登录回调端口转发失败：${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  private async handleLogin(): Promise<void> {
    const host = this.currentHost;
    try {
      const result = (await this.utilityClientFor(host).request("login")) as {
        user: { id: string; email?: string } | undefined;
      };
      this.postMessage({
        command: "loginResponse",
        success: true,
        user: result.user,
      });
      // Reinitialize agent to pick up SSO config
      await this.updateAgentConfig(this.configStore.getConfiguration());
    } catch (error) {
      console.error("[DesktopHost] 登录失败:", error);
      this.postMessage({
        command: "loginResponse",
        success: false,
        error: error instanceof Error ? error.message : String(error),
      });
    } finally {
      // The code exchange has settled (success or failure) — the callback
      // tunnel's job is done, tear it down so no orphan ssh process lingers
      // (spec: SSO 登录 scenario 8).
      const forward = this.pendingAuthTunnels.get(host);
      if (forward) {
        forward.close();
        this.pendingAuthTunnels.delete(host);
      }
    }
  }

  private async handleLogout(): Promise<void> {
    try {
      await this.utilityClientFor(this.currentHost).request("logout");
      this.postMessage({ command: "logoutResponse", success: true });
      await this.updateAgentConfig(this.configStore.getConfiguration());
    } catch (error) {
      console.error("[DesktopHost] 登出失败:", error);
      this.postMessage({
        command: "logoutResponse",
        success: false,
        error: String(error),
      });
    }
  }

  private async handleListPlugins(): Promise<void> {
    try {
      const result = (await this.utilityClientFor(this.currentHost).request(
        "listPlugins",
        { workdir: this.workdir },
      )) as { plugins: unknown[] };
      this.postMessage({
        command: "listPluginsResponse",
        plugins: result.plugins,
      });
    } catch (error) {
      this.showToast({ message: `获取插件列表失败: ${error}` });
    }
  }

  private async handlePluginMutation(
    method: string,
    params: Record<string, unknown>,
  ): Promise<void> {
    try {
      await this.utilityClientFor(this.currentHost).request(method, {
        ...params,
        workdir: this.workdir,
      });
      await this.handleListPlugins();
      // Recreate agent to apply plugin changes
      await this.updateAgentConfig(this.configStore.getConfiguration());
    } catch (error) {
      this.showToast({ message: `插件操作失败: ${error}` });
    }
  }

  private async handleGetProjectSettings(paneId: string): Promise<void> {
    try {
      const workdir =
        this.agentForPane(paneId)?.workingDirectory ?? this.workdir;
      const result = (await this.utilityClientFor(
        this.hostForPane(paneId),
      ).request("getProjectSettings", { workdir })) as {
        enabledPlugins: Record<string, boolean>;
      };
      this.postMessage({
        command: "projectSettings",
        paneId,
        enabledPlugins: result.enabledPlugins,
      });
    } catch (error) {
      this.showToast({ message: `获取项目设置失败: ${error}` });
    }
  }

  private async handleSetBuiltinPluginEnabled(
    paneId: string,
    pluginId: string,
    enabled: boolean,
    scope?: Scope,
  ): Promise<void> {
    try {
      const workdir =
        this.agentForPane(paneId)?.workingDirectory ?? this.workdir;
      const result = (await this.utilityClientFor(
        this.hostForPane(paneId),
      ).request("setBuiltinPluginEnabled", {
        pluginId,
        enabled,
        scope,
        workdir,
      })) as { enabledPlugins: Record<string, boolean> };
      this.postMessage({
        command: "projectSettings",
        paneId,
        enabledPlugins: result.enabledPlugins,
      });
      // Recreate agents so the plugin change applies immediately (mirrors handlePluginMutation)
      await this.updateAgentConfig(this.configStore.getConfiguration());
    } catch (error) {
      this.showToast({ message: `修改项目设置失败: ${error}` });
    }
  }

  private async handleListMarketplaces(): Promise<void> {
    try {
      const marketplaces = await this.utilityClientFor(
        this.currentHost,
      ).request("listMarketplaces", { workdir: this.workdir });
      this.postMessage({ command: "listMarketplacesResponse", marketplaces });
    } catch (error) {
      this.showToast({ message: `获取市场列表失败: ${error}` });
    }
  }

  private async handleMarketplaceMutation(
    method: string,
    params: Record<string, unknown>,
  ): Promise<void> {
    try {
      await this.utilityClientFor(this.currentHost).request(method, {
        ...params,
        workdir: this.workdir,
      });
      await this.handleListMarketplaces();
    } catch (error) {
      this.showToast({ message: `市场操作失败: ${error}` });
    }
  }

  private async handleRequestHistory(): Promise<void> {
    try {
      const result = (await this.utilityClientFor(this.currentHost).request(
        "getPromptHistory",
      )) as { history: unknown[] };
      this.postMessage({ command: "historyResponse", history: result.history });
    } catch (error) {
      console.error("[DesktopHost] 获取历史记录失败:", error);
      this.postMessage({
        command: "historyError",
        error: `获取历史记录失败: ${error}`,
      });
    }
  }

  private async handleSearchHistory(query: string): Promise<void> {
    try {
      const result = (await this.utilityClientFor(this.currentHost).request(
        "searchPromptHistory",
        { query },
      )) as { history: unknown[] };
      this.postMessage({ command: "historyResponse", history: result.history });
    } catch (error) {
      console.error("[DesktopHost] 搜索历史记录失败:", error);
      this.postMessage({
        command: "historyError",
        error: `搜索历史记录失败: ${error}`,
      });
    }
  }

  private async handleFileSuggestions(
    filterText: string,
    requestId: string,
  ): Promise<void> {
    try {
      const suggestions = await this.findWorkspaceFiles(filterText);
      this.postMessage({
        command: "fileSuggestionsResponse",
        suggestions,
        filterText,
        requestId,
      });
    } catch (error) {
      console.error("[DesktopHost] 获取文件建议失败:", error);
      this.postMessage({
        command: "fileSuggestionsError",
        error: `获取文件建议失败: ${error}`,
        requestId,
      });
    }
  }

  private async findWorkspaceFiles(
    filterText: string,
  ): Promise<Record<string, string | boolean>[]> {
    const host = this.currentHost;
    // Anchor @file search to the session's stable root (initialize-time cwd):
    // bash cd drifts this.workdir via pane focus, but file suggestions belong
    // to the project the session started in. Before any agent activation
    // (fresh launch) this.workdir is unset while the webview already treats
    // recents[0] as the effective workdir — mirror that fallback so @file
    // suggestions work before a directory is picked.
    const workdir =
      this.activeAgent?.sessionCwd ??
      this.workdir ??
      this.configStore.getRecentWorkdirsForHost(host)[0];
    if (!workdir) return [];
    try {
      // Remote workdirs are POSIX paths; path.join/basename on Windows would mangle them.
      const join =
        host === LOCAL_HOST
          ? path.join.bind(path)
          : path.posix.join.bind(path.posix);
      const basename =
        host === LOCAL_HOST
          ? path.basename.bind(path)
          : path.posix.basename.bind(path.posix);
      const result = (await this.utilityClientFor(host).request("searchFiles", {
        query: filterText || "",
        maxResults: 20,
        workdir,
      })) as { files: Array<{ path: string; type: string }> };

      const allItems = result.files.map((item) => {
        const relativePath = item.path;
        const fullPath = join(workdir, relativePath);
        const normalizedPath = relativePath.endsWith("/")
          ? relativePath.slice(0, -1)
          : relativePath;
        const name = basename(normalizedPath);
        const extensionMatch = name.match(/\.([^.]+)$/);
        const extension = extensionMatch ? extensionMatch[1] : "";
        const isDirectory = item.type === "directory";
        return {
          path: fullPath,
          relativePath,
          name,
          extension,
          icon: isDirectory ? "codicon-folder" : "codicon-file",
          isDirectory,
        };
      });

      allItems.sort((a, b) => {
        const aNameMatch = (a.name as string)
          .toLowerCase()
          .startsWith((filterText || "").toLowerCase());
        const bNameMatch = (b.name as string)
          .toLowerCase()
          .startsWith((filterText || "").toLowerCase());
        if (aNameMatch && !bNameMatch) return -1;
        if (!aNameMatch && bNameMatch) return 1;
        if (a.isDirectory && !b.isDirectory) return -1;
        if (!a.isDirectory && b.isDirectory) return 1;
        return (a.name as string).localeCompare(b.name as string);
      });

      return allItems;
    } catch (error) {
      console.error("[DesktopHost] 搜索工作区文件失败:", error);
      return [];
    }
  }

  private async handleUploadFilesToArtifacts(
    files: Array<{ name: string; data: ArrayBuffer }>,
  ): Promise<void> {
    try {
      const host = this.currentHost;
      const isRemote = host !== LOCAL_HOST;
      const uploadedFiles: string[] = [];
      const errors: string[] = [];

      for (const file of files) {
        try {
          let finalPath: string;
          if (isRemote) {
            // Remote: write the bytes on the host where the agent runs (via the
            // remote daemon) so the returned path is reachable by its tools —
            // a local path would be invisible to the remote agent.
            const result = (await this.utilityClientFor(host).request(
              "writeArtifactFile",
              {
                name: file.name,
                contentBase64: Buffer.from(file.data).toString("base64"),
              },
            )) as { path: string };
            finalPath = result.path;
          } else {
            const artifactsDir = path.join(os.tmpdir(), "wave-artifacts");
            if (!fs.existsSync(artifactsDir)) {
              fs.mkdirSync(artifactsDir, { recursive: true });
            }
            finalPath = path.join(artifactsDir, file.name);
            let counter = 1;
            while (fs.existsSync(finalPath)) {
              const ext = path.extname(file.name);
              const baseName = path.basename(file.name, ext);
              finalPath = path.join(
                artifactsDir,
                `${baseName}_${counter}${ext}`,
              );
              counter++;
            }
            fs.writeFileSync(finalPath, Buffer.from(file.data));
          }
          uploadedFiles.push(finalPath);
        } catch (error) {
          errors.push(`${file.name}: ${error}`);
        }
      }

      if (uploadedFiles.length > 0) {
        this.postMessage({
          command: "uploadSuccess",
          uploadedFiles,
          message: `成功上传 ${uploadedFiles.length} 个文件到临时目录`,
        });
      }
      if (errors.length > 0) {
        this.postMessage({
          command: "uploadError",
          errors,
          message: `部分文件上传失败: ${errors.length} 个错误`,
        });
      }
    } catch (error) {
      console.error("[DesktopHost] 文件上传处理失败:", error);
      this.postMessage({
        command: "uploadError",
        error: `文件上传处理失败: ${error}`,
      });
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

  /** Image extensions the file panel can inline (local host; remote keys off mime). */
  private readonly FILE_PANEL_IMAGE_EXTS = new Set([
    "png",
    "jpg",
    "jpeg",
    "gif",
    "webp",
    "svg",
    "bmp",
    "ico",
  ]);

  /** Mime per extension for the inline data URL (local images; remote uses `file -b -I`). */
  private readonly IMAGE_MIME_BY_EXT: Record<string, string> = {
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    gif: "image/gif",
    webp: "image/webp",
    svg: "image/svg+xml",
    bmp: "image/bmp",
    ico: "image/x-icon",
  };

  /**
   * Read a file for the file panel and push desktopFileContent to its pane.
   * Local files are read straight from disk; remote ones over ssh (base64 for
   * images, NUL-detected text otherwise). Failures land in fileView.error and
   * render inside the panel — no chat system message (spec scenarios 14/16).
   */
  private async handleFilePanelOpen(
    paneId: string,
    filePath: string,
    startLine?: number,
    endLine?: number,
  ): Promise<void> {
    if (!filePath) return;
    const host = this.hostForPane(paneId);
    try {
      const fileView =
        host === LOCAL_HOST
          ? await this.readLocalFileForPanel(filePath)
          : await this.readRemoteFileForPanel(host, filePath);
      this.postMessage({
        command: "desktopFileContent",
        paneId,
        fileView: { ...fileView, startLine, endLine },
      });
    } catch (error) {
      this.postMessage({
        command: "desktopFileContent",
        paneId,
        fileView: {
          path: filePath,
          host,
          error: error instanceof Error ? error.message : String(error),
        },
      });
    }
  }

  /** Local read: image → base64; text → first 2MB / 2000 lines, NUL-detected. */
  private async readLocalFileForPanel(
    filePath: string,
  ): Promise<Record<string, unknown>> {
    const stat = await fs.promises.stat(filePath).catch(() => null);
    if (!stat) throw new Error(`文件不存在：${filePath}`);
    if (stat.isDirectory()) throw new Error("无法在面板中显示目录");

    const ext = path.extname(filePath).toLowerCase().replace(/^\./, "");
    if (this.FILE_PANEL_IMAGE_EXTS.has(ext)) {
      const data = await fs.promises.readFile(filePath);
      const mime = this.IMAGE_MIME_BY_EXT[ext] ?? "application/octet-stream";
      return {
        path: filePath,
        host: LOCAL_HOST,
        imageBase64: `data:${mime};base64,${data.toString("base64")}`,
      };
    }

    // +1 byte probes whether the file exceeds the cap without a second stat.
    const readLen = REMOTE_FILE_MAX_BYTES + 1;
    const buf = Buffer.alloc(readLen);
    const handle = await fs.promises.open(filePath, "r");
    let bytesRead: number;
    try {
      ({ bytesRead } = await handle.read(buf, 0, readLen, 0));
    } finally {
      await handle.close();
    }
    if (buf.subarray(0, Math.min(bytesRead, 8192)).includes(0)) {
      return {
        path: filePath,
        host: LOCAL_HOST,
        error: "二进制文件无法在面板中显示",
      };
    }
    const rawContent = buf
      .subarray(0, Math.min(bytesRead, REMOTE_FILE_MAX_BYTES))
      .toString("utf8");
    const allLines = rawContent.split("\n");
    const tooManyLines = allLines.length > REMOTE_FILE_MAX_LINES;
    return {
      path: filePath,
      host: LOCAL_HOST,
      content: tooManyLines
        ? allLines.slice(0, REMOTE_FILE_MAX_LINES).join("\n")
        : rawContent,
      truncated: bytesRead > REMOTE_FILE_MAX_BYTES || tooManyLines,
      // Total line count is exact only when the whole file was read (≤ cap).
      totalLines:
        bytesRead <= REMOTE_FILE_MAX_BYTES
          ? allLines.length - (rawContent.endsWith("\n") ? 1 : 0)
          : undefined,
    };
  }

  /** Remote read via ssh; results mirror the local shape (base64 for images). */
  private async readRemoteFileForPanel(
    host: string,
    filePath: string,
  ): Promise<Record<string, unknown>> {
    const result = await readRemoteFile(host, filePath);
    if (result.type === "image") {
      return { path: filePath, host, imageBase64: result.imageBase64 };
    }
    if (result.type === "binary") {
      return { path: filePath, host, error: "二进制文件无法在面板中显示" };
    }
    return {
      path: filePath,
      host,
      content: Buffer.from(result.contentBase64 ?? "", "base64").toString(
        "utf8",
      ),
      truncated: result.truncated,
      totalLines: result.totalLines,
    };
  }

  private async handleSlashCommandsRequest(
    filterText: string,
    paneId?: string,
  ): Promise<void> {
    const pid = paneId ?? this.focusedPaneId;
    try {
      const agent = this.agentForPane(pid);
      const sdkCommands = agent ? await agent.getSlashCommands() : [];

      const localCommands = [
        { id: "config", name: "config", description: "打开配置设置" },
        { id: "plugin", name: "plugin", description: "打开插件管理" },
        { id: "mcp", name: "mcp", description: "打开 MCP 服务器管理" },
        { id: "status", name: "status", description: "查看当前状态" },
        { id: "clear", name: "clear", description: "清除对话历史并重置会话" },
        { id: "compact", name: "compact", description: "手动压缩对话历史" },
        { id: "tasks", name: "tasks", description: "查看后台任务" },
        { id: "workflows", name: "workflows", description: "查看工作流运行" },
        { id: "agents", name: "agents", description: "查看可用 agents" },
        { id: "rewind", name: "rewind", description: "回滚到之前的用户消息" },
        { id: "model", name: "model", description: "切换 AI 模型" },
        { id: "btw", name: "btw", description: "旁路提问（不进入聊天记录）" },
      ];

      const allCommands = [...sdkCommands, ...localCommands];
      let filteredCommands = allCommands;
      if (filterText && filterText.trim().length > 0) {
        const filter = filterText.toLowerCase();
        filteredCommands = allCommands.filter(
          (command) =>
            command.id.toLowerCase().includes(filter) ||
            command.name.toLowerCase().includes(filter),
        );
      }
      const commands = filteredCommands.map((command) => ({
        id: command.id,
        name: command.name,
        description: command.description,
      }));
      this.postMessage({
        command: "slashCommandsResponse",
        paneId: pid,
        commands,
      });
    } catch (error) {
      console.error("[DesktopHost] 获取指令失败:", error);
      this.postMessage({
        command: "slashCommandsError",
        paneId: pid,
        error: `获取指令失败: ${error}`,
      });
    }
  }

  // ------------------------------------------------------------------
  // Throttled streaming updates (ported from vsce ChatSession)
  // ------------------------------------------------------------------

  private throttledStreamingContentUpdate(
    paneId: string,
    messageId: string,
    chunk: string,
    stage: "streaming" | "end",
  ): void {
    const t = this.paneThrottle(paneId);
    if (stage === "end") {
      if (t.streamingContentTimer) {
        clearTimeout(t.streamingContentTimer);
        t.streamingContentTimer = undefined;
      }
      // Flush any chunks still pending inside the cooldown window first
      if (t.pendingStreamingContent) {
        this.postMessage({
          command: "updateStreamingContent",
          paneId,
          ...t.pendingStreamingContent,
          stage: "streaming",
        });
        t.pendingStreamingContent = undefined;
      }
      this.postMessage({
        command: "updateStreamingContent",
        paneId,
        messageId,
        chunk,
        stage,
      });
      return;
    }

    // window-concat: merge all chunks arriving within the cooldown window so
    // no delta is lost (dropping a delta would permanently lose content).
    if (t.pendingStreamingContent) {
      t.pendingStreamingContent.chunk += chunk;
    } else {
      t.pendingStreamingContent = { messageId, chunk };
    }
    if (!t.streamingContentTimer) {
      // leading edge: fire the current delta immediately, then reset pending so
      // the trailing edge only carries chunks arriving within this window
      // (otherwise the leading chunk would be appended twice by the reducer).
      this.postMessage({
        command: "updateStreamingContent",
        paneId,
        ...t.pendingStreamingContent,
        stage,
      });
      t.pendingStreamingContent = undefined;
      t.streamingContentTimer = setTimeout(() => {
        if (t.pendingStreamingContent) {
          this.postMessage({
            command: "updateStreamingContent",
            paneId,
            ...t.pendingStreamingContent,
            stage: "streaming",
          });
          t.pendingStreamingContent = undefined;
        }
        t.streamingContentTimer = undefined;
      }, 16);
    }
  }

  private throttledStreamingReasoningUpdate(
    paneId: string,
    messageId: string,
    chunk: string,
    stage: "streaming" | "end",
  ): void {
    const t = this.paneThrottle(paneId);
    if (stage === "end") {
      if (t.streamingReasoningTimer) {
        clearTimeout(t.streamingReasoningTimer);
        t.streamingReasoningTimer = undefined;
      }
      // Flush any chunks still pending inside the cooldown window first
      if (t.pendingStreamingReasoning) {
        this.postMessage({
          command: "updateStreamingReasoning",
          paneId,
          ...t.pendingStreamingReasoning,
          stage: "streaming",
        });
        t.pendingStreamingReasoning = undefined;
      }
      this.postMessage({
        command: "updateStreamingReasoning",
        paneId,
        messageId,
        chunk,
        stage,
      });
      return;
    }

    // window-concat: merge all chunks arriving within the cooldown window so
    // no delta is lost (dropping a delta would permanently lose content).
    if (t.pendingStreamingReasoning) {
      t.pendingStreamingReasoning.chunk += chunk;
    } else {
      t.pendingStreamingReasoning = { messageId, chunk };
    }
    if (!t.streamingReasoningTimer) {
      // leading edge: fire the current delta immediately, then reset pending so
      // the trailing edge only carries chunks arriving within this window
      // (otherwise the leading chunk would be appended twice by the reducer).
      this.postMessage({
        command: "updateStreamingReasoning",
        paneId,
        ...t.pendingStreamingReasoning,
        stage,
      });
      t.pendingStreamingReasoning = undefined;
      t.streamingReasoningTimer = setTimeout(() => {
        if (t.pendingStreamingReasoning) {
          this.postMessage({
            command: "updateStreamingReasoning",
            paneId,
            ...t.pendingStreamingReasoning,
            stage: "streaming",
          });
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
    if (message.role !== "user" || message.isMeta) continue;
    const text = (message.blocks ?? [])
      .filter((b) => b.type === "text" || b.type === "compact")
      .map((b) => b.content || "")
      .join("")
      .trim();
    if (text) return text.length > 30 ? text.substring(0, 30) + "..." : text;
  }
  return "";
}

function parseHeaders(headersStr?: string): Record<string, string> | undefined {
  if (!headersStr || !headersStr.trim()) {
    return undefined;
  }
  try {
    const headers: Record<string, string> = {};
    const lines = headersStr.split("\n");
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) {
        continue;
      }
      const colonIndex = trimmed.indexOf(":");
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
    console.error("[DesktopHost] Failed to parse headers:", e);
    return undefined;
  }
}
