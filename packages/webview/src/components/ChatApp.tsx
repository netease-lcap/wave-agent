import React, {
  useEffect,
  useReducer,
  useCallback,
  useMemo,
  useRef,
  useState,
} from "react";
import { MessageList } from "./MessageList";
import { MessageInput } from "./MessageInput";
import type { MessageInputHandle } from "./MessageInput";
import { ChatHeader } from "./ChatHeader";
import { Tooltip } from "./Tooltip";
import { TaskList } from "./TaskList";
import { QueuedMessageList } from "./QueuedMessageList";
import { ConfirmationDialog } from "./ConfirmationDialog";
import { ConfirmDialog } from "./ConfirmDialog";
import { RewindPopup } from "./RewindPopup";
import type { RewindCheckpoint } from "./RewindPopup";
import { ModelPopup } from "./ModelPopup";
import { ToastStack } from "./ToastStack";
import { BtwPanel } from "./BtwPanel";
import PluginDialog from "./PluginDialog";
import McpDialog from "./McpDialog";
import StatusDialog from "./StatusDialog";
import BackgroundTaskManager from "./BackgroundTaskManager";
import WorkflowManager from "./WorkflowManager";
import WelcomeView from "./WelcomeView";
import LoadingLogo from "./LoadingLogo";
import { NewSessionIcon, SidebarExpandIcon, CloseIcon } from "./HeaderIcons";
import { DesktopHostSelector } from "./DesktopHostSelector";
import { DesktopSidebar } from "./DesktopSidebar";
import { DesktopShell } from "./DesktopShell";
import type { AccountCardAccount } from "./AccountCard";
import SettingsPage from "./SettingsPage";
import type { NavKey } from "./SettingsPage";
import { SessionBoard } from "./SessionBoard";
import { DesktopWorkdirSelector } from "./DesktopWorkdirSelector";
import { DesktopWorktreeControls } from "./DesktopWorktreeControls";
import { PreviewPane } from "./PreviewPane";
import { DiffPane } from "./DiffPane";
import { TerminalPane, prefetchTerminalLib } from "./TerminalPane";
import { FilePane } from "./FilePane";
import { PlanPane } from "./PlanPane";
import { DesktopPanelTabs } from "./DesktopPanelTabs";
import { PanelEmptyState } from "./PanelEmptyState";
import type {
  ChatAppProps,
  ConfirmationDecision,
  ConfigurationData,
  DesktopPanelKind,
  FileViewState,
  PanelTab,
  ThemeSource,
  ToolBlock,
  ToolBlockUpdateCallbackParams,
  UpdateToast,
} from "../types";
import { EXIT_PLAN_MODE_TOOL_NAME } from "wave-agent-sdk/dist/constants/tools.js";
import { collectWriteEditBlocks, pathsMatch } from "../utils/fileAutoRefresh";
import { chatReducer, initialState } from "../reducers/chatReducer";
import "../styles/ChatApp.css";

/** Desktop conversation-level panels: fixed left→right order regardless of check order. */
export const PANEL_ORDER: DesktopPanelKind[] = [
  "preview",
  "plan",
  "diff",
  "terminal",
  "file",
];
/** Chinese names shown in the panel tabs / space hints. */
export const PANEL_LABELS: Record<DesktopPanelKind, string> = {
  preview: "预览",
  plan: "计划",
  diff: "差异",
  terminal: "终端",
  file: "文件",
};
const PANEL_DEFAULT_WIDTH = 420;
const PANEL_MIN_WIDTH = 320;
/** The conversation (message) area never shrinks below this when opening/dragging panels. */
const CHAT_MAIN_MIN_WIDTH = 360;

/**
 * Hostname spellings that name the same remote service through an ssh tunnel:
 * the forward always targets the remote's `localhost:<port>`, so every
 * loopback and all-interfaces spelling refers to the same endpoint (aligned
 * with VS Code's LOCALHOST_ADDRESSES / ALL_INTERFACES_ADDRESSES, whose
 * mapHasAddressLocalhostOrAllInterfaces treats them as one tunnel). Both
 * bracketed and bare IPv6 forms are covered — URL.hostname serializes the
 * former, terminal/Markdown links may carry the latter.
 */
const LOOPBACK_OR_ALL_INTERFACES_HOSTS = new Set([
  "localhost",
  "127.0.0.1",
  "::1",
  "[::1]",
  "0:0:0:0:0:0:0:1",
  "[0:0:0:0:0:0:0:1]",
  "0.0.0.0",
  "::",
  "[::]",
  "0:0:0:0:0:0:0:0",
  "[0:0:0:0:0:0:0:0]",
]);

/**
 * Canonical form of a preview URL for same-link comparison: collapses the
 * loopback/all-interfaces host spellings above to `localhost`, so clicking
 * `http://127.0.0.1:5173/app` after `http://localhost:5173/app` reuses the
 * established tunnel instead of release + re-acquire churn. Non-loopback URLs
 * (external sites) are returned unchanged.
 */
function canonicalForwardUrl(raw: string): string {
  try {
    const u = new URL(raw);
    if (LOOPBACK_OR_ALL_INTERFACES_HOSTS.has(u.hostname.toLowerCase()))
      u.hostname = "localhost";
    return u.href;
  } catch {
    return raw;
  }
}

/**
 * True when the dragged payload is OS file(s) (dataTransfer "Files").
 * Session/pane split drags carry a custom MIME type without "Files" and are
 * highlighted by DesktopShell's insertion indicators, not the upload overlay.
 */
function isFileDragEvent(e: React.DragEvent): boolean {
  return e.dataTransfer.types.includes("Files");
}

/**
 * Panel group snapshot, remembered per session. Keys are session ids, plus one
 * `new:<paneId>` bucket per pane for the new-session state (no session bound
 * yet); the bucket migrates to the session id once the first message binds
 * one. The cache also carries a pane's group across the unmount/remount a
 * move between window rows forces (React cannot reparent) — the remount reads
 * the same session's entry. DesktopApp prunes entries whose owner is gone.
 */
interface PanelGroupState {
  /** Open panel tabs in tab order (multi-instance kinds may repeat). */
  checked: PanelTab[];
  /** Shared panel-slot width (tabbed layout: one slot, one width). */
  panelWidth: number;
  /** Currently active tab id; null when no tab is open. */
  activePanel: string | null;
  /** Plan panel markdown (ExitPlanMode content); null = no plan yet. */
  planContent: string | null;
  /**
   * This session's remote port forward (scenario 18). The tunnel is owned by
   * the session, not the pane: it survives panel close, host switches, pane
   * rebinding and unmount/remount — only session deletion, ssh process death
   * or app exit release it. This reference is display bookkeeping only.
   */
  forward: RemoteForwardRef | null;
  /** Last forward failure for this session, shown in the preview stub. */
  forwardError: string | null;
}

/**
 * The in-flight/established remote port forward requested by this session. Set
 * when a remote localhost link is clicked (before the host replies). A pane
 * rebinding to another session must keep the previous session's forward held
 * (the host tunnels stay alive independently), so references live in the
 * per-session panel-group cache rather than a single pane ref.
 */
interface RemoteForwardRef {
  host: string;
  remotePort: number;
  /** The original remote URL the user clicked (kept for comment rewriting). */
  originalUrl: string;
  /** Matches the desktopForwardPortResult reply; stale replies are dropped. */
  requestId: string;
}

const panelGroupCache = new Map<string, PanelGroupState>();

/** Fresh panel-group state, used when a session gets its first forward. */
function emptyPanelGroup(): PanelGroupState {
  return {
    checked: [],
    panelWidth: PANEL_DEFAULT_WIDTH,
    activePanel: null,
    planContent: null,
    forward: null,
    forwardError: null,
  };
}

/**
 * Drop cached panel groups whose owner is gone. The keep-set covers live pane
 * buckets and the sessions in the sidebar tree / pane bindings, so a deleted
 * session forgets its panel group while a merely hidden one keeps it.
 */
export function prunePanelGroupCache(keepKeys: Set<string>): void {
  for (const key of [...panelGroupCache.keys()]) {
    if (!keepKeys.has(key)) panelGroupCache.delete(key);
  }
}

/**
 * Desktop sidebar collapsed → the leftmost chat header shows this expand button
 * (spec 「侧边栏收起/展开」scenario 4). In split view the root instance builds it
 * once and DesktopShell threads it into the first pane of the top row.
 * Icon = Figma sidebar-expand（外框 + 朝右箭头 →，与侧栏内收起按钮的
 * sidebar-collapse 外框+左条区分方向）。
 */
const SidebarExpandButton: React.FC<{ onClick: () => void }> = ({
  onClick,
}) => (
  <Tooltip text="展开侧边栏" position="bottom">
    <button
      className="header-button"
      onClick={onClick}
      data-testid="desktop-sidebar-expand"
      aria-label="展开侧边栏"
    >
      <SidebarExpandIcon />
    </button>
  </Tooltip>
);

export const ChatApp: React.FC<ChatAppProps> = ({
  vscode,
  host,
  paneId,
  sidebarExpandButton,
  headerActions,
  onOpenSettingsFromPane,
}) => {
  const [state, dispatch] = useReducer(chatReducer, initialState);
  const [queueEditWarning, setQueueEditWarning] = useState<string | null>(null);
  // In-app toasts (VS Code-style, bottom-right). Desktop host only: pushed via
  // `showToast` (update announcements), acknowledged via `toastAction`.
  const [toasts, setToasts] = useState<UpdateToast[]>([]);
  // 桌面侧边栏账户卡片快照（desktopAccountInfo push，窗口级）。null = 宿主尚未推送
  //（此时不渲染卡片）；已登录态由 host 逐主机维护（跟随聚焦分屏）。
  const [accountInfo, setAccountInfo] = useState<AccountCardAccount | null>(
    null,
  );
  // Message id awaiting rewind confirmation; non-null shows the ConfirmDialog.
  const [pendingRewindId, setPendingRewindId] = useState<string | null>(null);
  // /rewind popup: checkpoint list requested from the host on open.
  const [rewindPopupOpen, setRewindPopupOpen] = useState(false);
  const [rewindCheckpoints, setRewindCheckpoints] = useState<
    RewindCheckpoint[]
  >([]);
  const [rewindCheckpointsLoading, setRewindCheckpointsLoading] =
    useState(false);
  // /model popup: configured models requested from the host on open.
  const [modelPopupOpen, setModelPopupOpen] = useState(false);
  const [configuredModels, setConfiguredModels] = useState<string[]>([]);
  const [currentModel, setCurrentModel] = useState<string | undefined>(
    undefined,
  );
  const [modelLoading, setModelLoading] = useState(false);
  // /btw side-question panel (webview spec story 3). Non-null while the panel is
  // open; `loading` while the askBtw RPC is in flight, `answer` afterwards
  // (including the bare-/btw usage hint and API-error strings).
  const [btwPanel, setBtwPanel] = useState<{
    question: string;
    answer: string;
    loading: boolean;
    contentStarted: boolean;
  } | null>(null);
  // Question of the in-flight askBtw RPC. Cleared on close so a late reply is
  // dropped (scenario 7); matched against the reply's echoed question so a stale
  // reply never lands on a newer panel (scenario 6/7).
  const btwActiveRef = useRef<string | null>(null);
  // Session the current /btw panel belongs to. Compared against
  // state.currentSession.id in an effect below: the panel is conversation-scoped
  // (spec scenario 14), and desktop pane instances stay mounted across
  // conversation switches (ChatApp is keyed by paneId, not sessionId), so a
  // local useState alone would leak the previous conversation's panel.
  const btwSessionRef = useRef<string | undefined>(undefined);
  // Accumulated streaming text from the compaction fork; its last 30 characters
  // render after the "正在压缩对话" hint (streaming tail, same style as the
  // CLI loading indicator). Cleared when compaction ends.
  const [compactionStream, setCompactionStream] = useState("");
  // Desktop new-session worktree controls (FR-022/FR-023).
  const [worktreeBranch, setWorktreeBranch] = useState<string>("");
  const [worktreeChecked, setWorktreeChecked] = useState(true);
  // True while the host is creating the worktree after the first message was
  // sent with the checkbox on — shows "worktree 创建中…" next to the checkbox.
  // Cleared by the host's desktopWorktreeCreated ack (success or failure).
  const [worktreeCreating, setWorktreeCreating] = useState(false);
  // Per-pane git branches for this pane's OWN workdir (FR-022). The host-level
  // workdir follows the focused pane — sharing it would bleed one pane's
  // directory/branch into a sibling new-session pane, so each new-session pane
  // queries branches against its own session workdir.
  const [paneGitBranches, setPaneGitBranches] = useState<{
    branches: string[];
    current: string;
  } | null>(null);
  // True while a desktopListGitBranches request is in flight — the branch
  // selector shows a "分支获取中…" placeholder instead of disappearing
  // (remote hosts can take seconds to connect before the list arrives).
  const [branchesLoading, setBranchesLoading] = useState(false);
  // The pane's effective cwd: its own session workdir wins; a new-session pane
  // (state.workdir empty during spawn) falls back to the most recently selected
  // repo root from recents — never to the host-level workdir, which follows the
  // focused pane and would bleed a sibling worktree session's path/branch into
  // this new pane until the spawn finishes and setInitialState lands.
  const effectiveWorkdir =
    state.workdir ??
    (host?.type === "desktop"
      ? (host?.recentWorkdirs?.[0] ?? host?.workdir)
      : undefined);
  // The new-session pickers (workdir selector + worktree controls) show a
  // directory the USER chose, decoupled from the pane's session cwd: the
  // session cwd only wins when it is itself a user-chosen directory (it sits
  // in recents — e.g. a session started from that repo). Internal cwds like a
  // worktree path (or a bash-cd drift) are never user choices, so the pickers
  // fall back to the most recently selected repo instead of flashing the
  // worktree path into them before the first message hides them.
  const pickerWorkdir =
    host?.type === "desktop"
      ? state.workdir && host?.recentWorkdirs?.includes(state.workdir)
        ? state.workdir
        : (host?.recentWorkdirs?.[0] ?? host?.workdir)
      : effectiveWorkdir;
  const isDesktop = host?.type === "desktop";
  // Desktop sidebar collapsed (spec 「侧边栏收起/展开」): fully hidden, chat takes
  // the whole width; the leftmost chat header's expand button restores it.
  // Persisted so a restart keeps the choice (scenario 7). Only the root
  // instance (paneId undefined) owns this — panes receive the expand button
  // as a ready-made ReactNode via sidebarExpandButton.
  const [sidebarCollapsed, setSidebarCollapsed] = useState<boolean>(() => {
    try {
      return localStorage.getItem("wave.desktopSidebarCollapsed") === "1";
    } catch {
      // localStorage unavailable (sandboxed webview): default to expanded.
      return false;
    }
  });
  const handleSidebarCollapsedChange = useCallback((collapsed: boolean) => {
    setSidebarCollapsed(collapsed);
    try {
      localStorage.setItem(
        "wave.desktopSidebarCollapsed",
        collapsed ? "1" : "0",
      );
    } catch {
      // localStorage unavailable (sandboxed webview): the collapse still works
      // for this session, it just won't persist.
    }
  }, []);
  // Batch 2 (designer prototype): desktop settings full-page and session board
  // view switches. Only the root instance (paneId undefined) owns these — a
  // split-view pane never renders them. settingsOpen covers the desktop
  // "设置" entry (MoreMenu); VSCE/JetBrains open a host-side editor tab webview
  // instead and never set this.
  const [settingsOpen, setSettingsOpen] = useState(false);
  // 打开设置页时选中的初始导航项（更多菜单打开 → global；/agents → subagents、
  // /skills → skills）。desktop 每次打开都会重挂载 SettingsPage，此值经
  // initialNav 传入；IDE 由 openSettings message 的 nav 走 host 下发。
  const [settingsNav, setSettingsNav] = useState<NavKey>("global");
  // 设置页「新建/编辑」预填的 AI 对话框提示词（desktop 关设置页后写入输入框；
  // 见 handlePrefillPrompt）。
  const [pendingPrefillPrompt, setPendingPrefillPrompt] = useState<
    string | null
  >(null);
  const [sessionBoardOpen, setSessionBoardOpen] = useState(false);
  // 桌面端主题偏好（host 为真源）：初值取 setInitialState.theme.source，此后随
  // host 广播（desktopThemeSource / 重推快照）同步，设置页「全局设置」主题行据此
  // 显示当前选中项。VSCE/JetBrains 无此偏好，恒为默认 "system" 且不渲染主题行。
  const [themeSource, setThemeSource] = useState<ThemeSource>(
    () => state.theme?.source ?? "system",
  );
  useEffect(() => {
    if (state.theme?.source) setThemeSource(state.theme.source);
  }, [state.theme?.source]);
  // Context-usage percentage pushed by the host (batch 2 compress button).
  // Undefined = no usage info received yet (spec 场景 4: label without %).
  const [contextUsage, setContextUsage] = useState<number | undefined>();
  // AGENTS.md editor contents (batch 2 personalization view). null = not yet
  // loaded; loaded on demand when the settings page opens, saved via the
  // setAgentsContent RPC.
  const [userAgentsContent, setUserAgentsContent] = useState<string | null>(
    null,
  );
  const [projectAgentsContent, setProjectAgentsContent] = useState<
    string | null
  >(null);
  const expandBtn =
    paneId === undefined && sidebarCollapsed ? (
      <SidebarExpandButton
        onClick={() => handleSidebarCollapsedChange(false)}
      />
    ) : null;
  // 收起态 header leading：展开侧边栏 + 新对话 + 分割线（对齐原型
  // WorkspaceHeader.vue `workspace-header-start` 收起分支：sidebar-expand /
  // new-chat-header 按钮 / 1px divider / 标题）。单 pane（root）与分屏第一
  // pane 共用；`expand` 为 null（侧边栏展开）时不渲染整组。
  const collapsedLeading = (expand: React.ReactNode) =>
    expand ? (
      <div className="header-collapsed-leading">
        {expand}
        <Tooltip text="新建对话" position="bottom">
          <button
            className="header-button"
            onClick={handleClearChat}
            disabled={state.isStreaming}
            data-testid="collapsed-new-session-btn"
            aria-label="新建对话"
          >
            <NewSessionIcon />
          </button>
        </Tooltip>
        <span className="header-collapsed-divider" />
      </div>
    ) : null;
  // The pane's effective host ('local' or an SSH host name): a pane-bound
  // session's host (authoritative `desktopPanes` push) wins; the single-pane
  // layout reads the host-level current host. Remote sessions run the whole
  // agent on the remote host, so local-only surfaces — the preview/diff/
  // terminal panels and preview-pane localhost links — are suppressed for them.
  const paneHost = paneId
    ? host?.panes?.find((p) => p.paneId === paneId)?.host
    : undefined;
  const effectiveHost = paneHost ?? host?.host ?? "local";
  const effectiveHostRef = useRef(effectiveHost);
  const gitBranches = isDesktop ? paneGitBranches : null;
  const effectiveWorkdirRef = useRef(effectiveWorkdir);
  // Desktop only: the panel group follows the session bound to this pane. The
  // cache key is the session id from the host-authoritative `desktopPanes`
  // push, or the pane's new-session bucket while no session is bound.
  const boundSessionId = paneId
    ? host?.panes?.find((p) => p.paneId === paneId)?.sessionId
    : undefined;
  const groupKey = paneId ? (boundSessionId ?? `new:${paneId}`) : undefined;
  const groupKeyRef = useRef(groupKey);
  // Set when the user sends a message from this pane's new-session state. The
  // new-session bucket migrates to the session id only when that message binds
  // one — a sidebar switch to an existing session must not inherit the bucket.
  const sentFromNewSessionRef = useRef(false);
  // Desktop remote sessions: port-forward failure shown in the empty-preview
  // stub with a retry entry (scenario 16). Null = no error. Restored from the
  // session's cached group so a pane rebinding away and back keeps the error.
  const [previewForwardError, setPreviewForwardError] = useState<string | null>(
    () =>
      (groupKey ? panelGroupCache.get(groupKey)?.forwardError : undefined) ??
      null,
  );
  // Bumped when a re-acquire returns the SAME forwarded URL — the [url] effect
  // in PreviewPane would otherwise early-return and skip the forced reload a
  // retry after a guest load failure needs. Remounting restarts the webview.
  const [previewEpoch, setPreviewEpoch] = useState(0);
  // Desktop only: the plan panel's latest ExitPlanMode markdown (null = no plan
  // yet). Per-session: approval/rejection keep the panel open, and pane
  // remounts restore it from the group cache. The plan tab is unique, so the
  // content stays a single per-conversation value rather than per-tab.
  const [planContent, setPlanContent] = useState<string | null>(
    () =>
      (groupKey ? panelGroupCache.get(groupKey)?.planContent : undefined) ??
      null,
  );
  // The pane's current remote port forward (see RemoteForwardRef above). State
  // rather than a ref because a pane rebinding to another session must drop its
  // own current forward WITHOUT dropping the previous session's (the host
  // tunnels stay alive independently, scenario 18): the per-session references
  // live in panelGroupCache, this state only mirrors the bound session's one
  // for rendering the preview stub.
  const [currentForward, setCurrentForward] = useState<RemoteForwardRef | null>(
    () =>
      (groupKey ? panelGroupCache.get(groupKey)?.forward : undefined) ?? null,
  );
  // Mirrors of the forward state, refreshed on every render. Message is a
  // React.memo component whose DOM click handler captures props.onOpenPreview
  // at mount time — a useCallback that closes over the state values would pin
  // the FIRST values forever and the same-link dedup in
  // handleOpenRemotePreview would never see the established forward. The
  // handlers read the refs at click time instead (same pattern as
  // TerminalPane.tsx:117-119).
  const currentForwardRef = useRef(currentForward);
  currentForwardRef.current = currentForward;
  const previewForwardErrorRef = useRef(previewForwardError);
  previewForwardErrorRef.current = previewForwardError;
  const forwardSeqRef = useRef(0);
  const planContentRef = useRef<string | null>(planContent);
  // Desktop only: conversation-level panel tabs. Multi-instance kinds (preview /
  // diff / file) may open several tabs at once; terminal / plan are unique (the
  // open handlers activate the existing tab instead of adding a second). When
  // this session's group was cached (session revisited, or the pane moved
  // across window rows), restore it. A ref mirror lets the memoized Message
  // handlers read the current tabs at click time without pinning the first
  // render's values (same pattern as the forward refs above).
  const [tabs, setTabs] = useState<PanelTab[]>(
    () => (groupKey ? panelGroupCache.get(groupKey)?.checked : undefined) ?? [],
  );
  const tabsRef = useRef(tabs);
  tabsRef.current = tabs;
  // Desktop panel expand/collapse (spec「面板展开/折叠」): the header button
  // toggles whether the panel slot is visible. Collapsing only HIDES the slot —
  // the open tabs, their active tab and the dragged width all survive, and the
  // next expand restores them (「折叠/收起不影响面板内已打开的 tab 数量和状态，
  // 再次展开保留上次宽度并自动打开上一次查看的 tab」). A session that restores
  // tabs starts expanded (legacy "tabs visible" behavior); one with no tabs
  // starts collapsed so the empty-state page only appears after an explicit
  // expand.
  const [panelExpanded, setPanelExpanded] = useState<boolean>(() =>
    groupKey
      ? (panelGroupCache.get(groupKey)?.checked?.length ?? 0) > 0
      : false,
  );
  // Per-kind sequential tab-id source (preview-1, preview-2, …). Restored ids
  // are absorbed into the counters (see the groupKey effect below) so a tab
  // minted after a session switch can never collide with a restored one.
  const tabSeqRef = useRef<Record<DesktopPanelKind, number>>({
    preview: 0,
    plan: 0,
    diff: 0,
    terminal: 0,
    file: 0,
  });
  useEffect(() => {
    // Absorb every restored tab id into its kind's counter (initial mount and
    // each session switch — the key change runs this after the swap effect
    // re-seeded `tabs`).
    const current = tabsRef.current;
    for (const t of current) {
      const m = /^(\w+)-(\d+)$/.exec(t.id);
      if (m && m[1] in tabSeqRef.current) {
        const kind = m[1] as DesktopPanelKind;
        tabSeqRef.current[kind] = Math.max(
          tabSeqRef.current[kind],
          Number(m[2]),
        );
      }
    }
    // Intentional: only run when the session group key changes — the swap
    // effect above re-seeds `tabs` first, so re-running per tab tweak is
    // unnecessary (the max() absorption is idempotent anyway).
  }, [groupKey]);
  // Tabbed panels: one shared slot width for every panel type.
  const [panelWidth, setPanelWidth] = useState<number>(
    () =>
      (groupKey ? panelGroupCache.get(groupKey)?.panelWidth : undefined) ??
      PANEL_DEFAULT_WIDTH,
  );
  // The active panel tab id; null when no panel is open.
  const [activeTabId, setActiveTabId] = useState<string | null>(
    () =>
      (groupKey ? panelGroupCache.get(groupKey)?.activePanel : undefined) ??
      null,
  );
  const activeTabIdRef = useRef(activeTabId);
  activeTabIdRef.current = activeTabId;
  // Remote forward replies (desktopForwardPortResult) carry the requestId minted
  // in acquireForward; the map routes the reply to the preview tab that asked
  // for the tunnel so a sibling preview tab's URL is never overwritten.
  const forwardTabIdRef = useRef<Map<string, string>>(new Map());
  // Desktop preview fullscreen (spec: 预览面板全屏): the pane fills the content
  // area, the conversation column and the other panels are hidden until the
  // user toggles back (button or Esc). Per-pane: each ChatApp owns its panes.
  // Generalized to the tabbed panel slot (any active panel can go fullscreen).
  const [previewFullscreen, setPreviewFullscreen] = useState(false);
  const chatContainerRef = useRef<HTMLDivElement>(null);
  // Desktop drag-and-drop file upload: a counter tracks nested dragenter /
  // dragleave so quick in/out passes don't flicker the overlay. Only real
  // file drags ("Files" in dataTransfer) raise the overlay — session/pane
  // split drags carry custom MIME types and are highlighted by
  // DesktopShell's insertion indicators instead.
  const [dragActive, setDragActive] = useState(false);
  const dragCounterRef = useRef(0);
  const handleDragEnter = useCallback((e: React.DragEvent) => {
    if (!isFileDragEvent(e)) return;
    e.preventDefault();
    dragCounterRef.current += 1;
    setDragActive(true);
  }, []);
  const handleDragOver = useCallback((e: React.DragEvent) => {
    if (!isFileDragEvent(e)) return;
    e.preventDefault();
    // Visual "copy" cursor hint. jsdom's DataTransferPolyfill exposes
    // dropEffect as read-only, so guard for the test environment.
    try {
      e.dataTransfer.dropEffect = "copy";
    } catch {
      // ignore: dropEffect is only a cursor hint
    }
  }, []);
  const handleDragLeave = useCallback((e: React.DragEvent) => {
    if (!isFileDragEvent(e)) return;
    e.preventDefault();
    dragCounterRef.current -= 1;
    if (dragCounterRef.current <= 0) {
      dragCounterRef.current = 0;
      setDragActive(false);
    }
  }, []);
  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    dragCounterRef.current = 0;
    setDragActive(false);
    const files = e.dataTransfer.files;
    if (files && files.length > 0) {
      messageInputRef.current?.uploadFiles(files);
    }
  }, []);
  const panelWidthRef = useRef(panelWidth);
  // Mirrors so the stable message listener can reach the panel logic (defined
  // below) without re-subscribing.
  const togglePanelRef = useRef<(kind: DesktopPanelKind) => void>(() => {});
  const ensureTabRef = useRef<(kind: DesktopPanelKind) => string | null>(
    () => null,
  );
  const panelDisabledRef = useRef<DesktopPanelKind[]>([]);
  const messageInputRef = useRef<MessageInputHandle>(null);
  const messageListRef = useRef<{
    scrollToBottom: (behavior?: ScrollBehavior) => void;
  }>(null);
  const stateRef = useRef(state);
  // The pane this instance renders; undefined = single view (IDE hosts and the
  // desktop single-pane layout). Ref mirror for use inside stable callbacks.
  const paneIdRef = useRef<string | undefined>(paneId);

  // Keep stateRef in sync with state
  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  useEffect(() => {
    effectiveWorkdirRef.current = effectiveWorkdir;
  }, [effectiveWorkdir]);

  useEffect(() => {
    effectiveHostRef.current = effectiveHost;
  }, [effectiveHost]);

  useEffect(() => {
    planContentRef.current = planContent;
  }, [planContent]);

  useEffect(() => {
    panelWidthRef.current = panelWidth;
  }, [panelWidth]);

  // Cache the whole panel group under the current session so it survives this
  // ChatApp being unmounted/remounted (pane moved across window rows) and so a
  // later session switch can restore it. Skipped on the render where the key
  // flips — the swap effect below re-seeds the state from the new key first.
  useEffect(() => {
    if (!groupKey || groupKey !== groupKeyRef.current) return;
    panelGroupCache.set(groupKey, {
      checked: tabs,
      panelWidth,
      activePanel: activeTabId,
      planContent,
      forward: currentForward,
      forwardError: previewForwardError,
    });
  }, [
    groupKey,
    tabs,
    panelWidth,
    activeTabId,
    planContent,
    currentForward,
    previewForwardError,
  ]);

  // Session switch: swap in the incoming session's remembered panel group
  // (empty when it has none — panels never leak across sessions). Only the
  // layout/check state is restored; panel content rebuilds for the new
  // context (diff refetches, preview reloads, terminal respawns). A pane's
  // new-session bucket migrates to the session id once the first message
  // binds one, keeping the setup made before sending it.
  useEffect(() => {
    if (!paneId || !groupKey || groupKey === groupKeyRef.current) return;
    const prevKey = groupKeyRef.current;
    groupKeyRef.current = groupKey;
    let group = panelGroupCache.get(groupKey);
    if (
      !group &&
      prevKey?.startsWith("new:") &&
      !groupKey.startsWith("new:") &&
      sentFromNewSessionRef.current
    ) {
      group = panelGroupCache.get(prevKey);
      if (group) {
        panelGroupCache.set(groupKey, group);
        panelGroupCache.delete(prevKey);
      }
    }
    sentFromNewSessionRef.current = false;
    setPreviewForwardError(group?.forwardError ?? null);
    setCurrentForward(group?.forward ?? null);
    setTabs(group?.checked ?? []);
    setPanelWidth(group?.panelWidth ?? PANEL_DEFAULT_WIDTH);
    // A session that restores tabs shows them (legacy behavior); one without
    // tabs starts collapsed — the empty state needs an explicit expand.
    setPanelExpanded((group?.checked?.length ?? 0) > 0);
    // The restored active tab must be one of the restored open tabs; a stale
    // cache entry (active pointing at a closed tab) falls back to the first.
    const restoredActive = group?.activePanel ?? null;
    const active =
      restoredActive !== null &&
      (group?.checked ?? []).some((t) => t.id === restoredActive)
        ? restoredActive
        : (group?.checked?.[0]?.id ?? null);
    setActiveTabId(active);
    setPlanContent(group?.planContent ?? null);
  }, [paneId, groupKey]);

  useEffect(() => {
    paneIdRef.current = paneId;
  }, [paneId]);

  // Desktop only: keep <html data-theme> in sync with the resolved theme so the
  // inlined --vscode-* variable set swaps without a reload (FR-018). VSCE/JB
  // inject their own variables and never set state.theme, so this is inert there.
  useEffect(() => {
    if (state.theme) {
      document.documentElement.setAttribute(
        "data-theme",
        state.theme.effective,
      );
    }
  }, [state.theme]);

  // Auto-dismiss the queue-edit warning banner
  useEffect(() => {
    if (!queueEditWarning) return;
    const timer = setTimeout(() => setQueueEditWarning(null), 4000);
    return () => clearTimeout(timer);
  }, [queueEditWarning]);

  // Desktop: reset the worktree controls when the branch list changes (i.e. the
  // workdir was re-queried). Default to the repo's current branch, checked.
  useEffect(() => {
    setWorktreeBranch(gitBranches?.current ?? "");
    setWorktreeChecked(true);
  }, [gitBranches]);

  // Handle messages from VS Code extension
  useEffect(() => {
    // Session-scoped host pushes are pane-tagged on desktop (FR-032). This pane
    // consumes a message when it is untagged (single view / IDE hosts / global
    // commands) or tagged with this pane's id. Messages tagged with a different
    // paneId belong to a sibling pane and are ignored here.
    const myPane = paneIdRef.current;
    const forThisPane = (message: { paneId?: string }): boolean =>
      myPane === undefined || message.paneId === myPane;

    const handleMessage = (event: MessageEvent) => {
      const message = event.data;

      // Desktop plan panel: route an ExitPlanMode plan to the plan pane (opens
      // it on the first plan, then keeps the latest plan until the user closes
      // the pane). Shared by showConfirmation and the setInitialState replay.
      const routePlanToPanel = (planContent: unknown) => {
        if (typeof planContent !== "string" || planContent.trim() === "")
          return;
        setPlanContent(planContent);
        // The plan tab is unique — only open it when none is open yet, so an
        // updated plan never yanks the active tab away mid-conversation.
        if (!tabsRef.current.some((t) => t.kind === "plan")) {
          ensureTabRef.current("plan");
        }
      };

      switch (message.command) {
        case "updateMessages":
          if (!forThisPane(message)) break;
          dispatch({ type: "SET_MESSAGES", payload: message.messages });
          break;
        case "updateTasks":
          if (!forThisPane(message)) break;
          dispatch({ type: "SET_TASKS", payload: message.tasks });
          if (message.isTaskListCollapsed !== undefined) {
            dispatch({
              type: "SET_TASK_LIST_COLLAPSED",
              payload: message.isTaskListCollapsed,
            });
          }
          break;
        case "updateBackgroundTasks":
          if (!forThisPane(message)) break;
          dispatch({ type: "SET_BACKGROUND_TASKS", payload: message.tasks });
          break;
        case "updateWorkflowRuns":
          if (!forThisPane(message)) break;
          dispatch({ type: "SET_WORKFLOW_RUNS", payload: message.runs });
          break;
        case "updateSelection":
          if (!forThisPane(message)) break;
          dispatch({ type: "UPDATE_SELECTION", payload: message.selection });
          break;
        case "updatePermissionMode":
          if (!forThisPane(message)) break;
          dispatch({ type: "SET_PERMISSION_MODE", payload: message.mode });
          break;
        case "updateWorkdir":
          if (!forThisPane(message)) break;
          dispatch({ type: "SET_WORKDIR", payload: message.workdir });
          break;
        case "desktopGitBranches":
          // Per-pane branch list reply (FR-052). Routed by paneId so a sibling
          // pane's reply never overwrites this pane's selector.
          if (!forThisPane(message)) break;
          setPaneGitBranches(message.result ?? null);
          setBranchesLoading(false);
          break;
        case "desktopWorktreeCreated":
          // Worktree creation finished (success or failure) — clear the
          // "worktree 创建中" indicator.
          if (!forThisPane(message)) break;
          setWorktreeCreating(false);
          break;
        case "desktopForwardPortResult":
          // Remote preview port-forward reply (scenario 15/16). The forward is
          // session-scoped, so the reply is matched against the session whose
          // cached forward carries this requestId — a reply that lands after
          // the pane rebinds to another session still updates the owning
          // session's cached forward instead of being dropped. The forwarded
          // URL is applied to the preview TAB that requested the tunnel (map in
          // forwardTabIdRef) so a sibling preview tab's URL is never clobbered.
          if (!forThisPane(message)) break;
          {
            let targetKey: string | undefined;
            panelGroupCache.forEach((g, key) => {
              if (g.forward?.requestId === message.requestId) targetKey = key;
            });
            if (targetKey === undefined) break;
            const target = panelGroupCache.get(targetKey);
            if (!target) break;
            const tabId = message.requestId
              ? forwardTabIdRef.current.get(message.requestId)
              : undefined;
            const patchCachedTabUrl = (url: string) => {
              // Keep the cached group's tabs in sync for remounts/session
              // switches even when this pane is not the current one.
              target.checked = target.checked.map((t) =>
                t.id === tabId ? { ...t, previewUrl: url } : t,
              );
            };
            if (message.error) {
              target.forwardError = String(message.error);
              if (targetKey === groupKeyRef.current)
                setPreviewForwardError(String(message.error));
            } else {
              target.forwardError = null;
              if (targetKey === groupKeyRef.current) {
                setPreviewForwardError(null);
                if (tabId) {
                  const prevUrl = tabsRef.current.find(
                    (t) => t.id === tabId,
                  )?.previewUrl;
                  setTabs((prev) =>
                    prev.map((t) =>
                      t.id === tabId
                        ? { ...t, previewUrl: message.url as string }
                        : t,
                    ),
                  );
                  patchCachedTabUrl(message.url as string);
                  // Same URL as before (re-acquire after a guest load failure):
                  // remount so the webview actually reloads instead of the [url]
                  // effect early-returning on an unchanged prop.
                  if (message.url === prevUrl) setPreviewEpoch((e) => e + 1);
                }
              } else if (tabId) {
                // A reply for a session this pane is NOT bound to only touches
                // that session's cached tabs — never this pane's live tabs.
                patchCachedTabUrl(message.url as string);
              }
            }
          }
          break;
        case "desktopFileContent":
          // File panel content reply (file panel spec scenario 1/2). Routed by
          // paneId so a sibling pane's reply never overwrites this pane's view;
          // within the pane it lands on the file tab showing the same path. When
          // no tab shows that path yet (a blank tab opened from "＋" before the
          // host resolved a path), the reply binds the ACTIVE file tab to it.
          if (!forThisPane(message)) break;
          {
            const fv = message.fileView as FileViewState;
            setTabs((prev) =>
              prev.some((t) => t.kind === "file" && t.filePath === fv.path)
                ? prev.map((t) =>
                    t.kind === "file" && t.filePath === fv.path
                      ? { ...t, fileView: fv }
                      : t,
                  )
                : prev.map((t) =>
                    t.id === activeTabIdRef.current && t.kind === "file"
                      ? { ...t, filePath: fv.path, fileView: fv }
                      : t,
                  ),
            );
          }
          break;
        case "updateQueue":
          if (!forThisPane(message)) break;
          dispatch({ type: "SET_QUEUED_MESSAGES", payload: message.queue });
          break;
        case "updateQueuedMessageMissing":
          if (!forThisPane(message)) break;
          // The edited queue message no longer exists. Keep input content, exit editing.
          dispatch({ type: "SET_EDITING_QUEUED_ID", payload: null });
          setQueueEditWarning("编辑的队列消息已不存在！");
          break;
        case "updateCommandRunning":
          if (!forThisPane(message)) break;
          dispatch({ type: "SET_COMMAND_RUNNING", payload: message.running });
          break;
        case "rewindCheckpoints":
          if (!forThisPane(message)) break;
          setRewindCheckpoints(message.checkpoints || []);
          setRewindCheckpointsLoading(false);
          break;
        case "configuredModels":
          if (!forThisPane(message)) break;
          setConfiguredModels(message.models || []);
          setCurrentModel(message.currentModel);
          setModelLoading(false);
          break;
        case "btwStream":
          if (!forThisPane(message)) break;
          // Streaming chunks from the askBtw RPC (spec scenario 6): thinking
          // chunks show live while they stream, but once the first content
          // chunk arrives the accumulated thinking text is discarded and only
          // content is kept (user decision: thinking is not shown after the
          // thinking phase ends).
          if (
            !btwActiveRef.current ||
            message.question !== btwActiveRef.current
          )
            break;
          setBtwPanel((panel) => {
            if (!panel) return panel;
            const content =
              typeof message.content === "string" ? message.content : "";
            if (message.type === "content") {
              const base = panel.contentStarted ? panel.answer : "";
              return { ...panel, contentStarted: true, answer: base + content };
            }
            if (panel.contentStarted) return panel;
            return { ...panel, answer: panel.answer + content };
          });
          break;
        case "btwResponse":
          if (!forThisPane(message)) break;
          // Drop late replies: the panel must be open, the panel's question must
          // still match the in-flight one, and the reply must echo the same question.
          if (
            btwActiveRef.current &&
            message.question === btwActiveRef.current
          ) {
            setBtwPanel((panel) =>
              panel
                ? { ...panel, answer: message.answer ?? "", loading: false }
                : panel,
            );
          }
          break;
        case "btwError":
          if (!forThisPane(message)) break;
          if (
            btwActiveRef.current &&
            message.question === btwActiveRef.current
          ) {
            setBtwPanel((panel) =>
              panel
                ? {
                    ...panel,
                    answer: `(API error: ${message.error ?? "unknown"})`,
                    loading: false,
                  }
                : panel,
            );
          }
          break;
        // Test-only handlers
        case "startStreaming":
          if (!forThisPane(message)) break;
          dispatch({ type: "START_STREAMING" });
          break;
        case "endStreaming":
          if (!forThisPane(message)) break;
          dispatch({ type: "END_STREAMING" });
          break;
        case "ensureUIReset":
          if (!forThisPane(message)) break;
          dispatch({ type: "END_STREAMING" });
          break;
        case "updateSessions":
          dispatch({ type: "SET_SESSIONS", payload: message.sessions });
          break;
        case "updateCurrentSession":
          if (!forThisPane(message)) break;
          dispatch({ type: "SET_CURRENT_SESSION", payload: message.session });
          break;
        case "showConfirmation":
          if (!forThisPane(message)) break;
          // Plan panel (desktop): the ExitPlanMode plan full text lives in the
          // plan pane, not the (compact) confirmation dialog — mirror the VSCE
          // claudePlanPreview panel and the JB editor column. The dialog gets
          // the plan stripped so it stays small.
          if (message.toolName === EXIT_PLAN_MODE_TOOL_NAME) {
            routePlanToPanel(message.planContent);
          }
          dispatch({
            type: "SHOW_CONFIRMATION",
            payload: {
              confirmationId: message.confirmationId,
              toolName: message.toolName,
              confirmationType: message.confirmationType,
              toolInput: message.toolInput,
              planContent:
                message.toolName === EXIT_PLAN_MODE_TOOL_NAME
                  ? undefined
                  : message.planContent,
              suggestedPrefix: message.suggestedPrefix,
              hidePersistentOption: message.hidePersistentOption,
              permissionMode: message.permissionMode,
              warning: message.warning,
            },
          });
          // Scroll to bottom when confirmation is shown
          setTimeout(() => {
            if (
              messageListRef.current &&
              typeof messageListRef.current.scrollToBottom === "function"
            ) {
              messageListRef.current.scrollToBottom("smooth");
            }
          }, 0);
          break;
        case "planContent":
          // Desktop /plan display: host pushes the current plan file contents
          // to the shared Plan pane (same routing as an ExitPlanMode plan).
          if (!forThisPane(message)) break;
          routePlanToPanel(message.content);
          break;
        case "configurationResponse":
          dispatch({
            type: "SET_CONFIGURATION_DATA",
            payload: message.configurationData,
          });
          break;
        case "projectSettings":
          // Project settings (.wave/settings.json merged enabledPlugins) are
          // per-workdir, so on Desktop each pane may hold a different value —
          // must be pane-guarded (unlike the shared global configurationResponse).
          if (!forThisPane(message)) break;
          dispatch({
            type: "SET_PROJECT_SETTINGS",
            payload: { enabledPlugins: message.enabledPlugins },
          });
          break;
        case "setInitialState":
          if (!forThisPane(message)) break;
          // Desktop plan panel: replayed pending confirmations (pane rebind to a
          // session with confirmations in flight) also carry an ExitPlanMode
          // plan — route it so the panel survives the replay.
          for (const c of message.pendingConfirmations ||
            (message.pendingConfirmation
              ? [message.pendingConfirmation]
              : [])) {
            if (c.toolName === EXIT_PLAN_MODE_TOOL_NAME) {
              routePlanToPanel(c.planContent);
            }
          }
          dispatch({
            type: "SET_INITIAL_STATE",
            payload: {
              messages: message.messages,
              tasks: message.tasks,
              isStreaming: message.isStreaming,
              isCommandRunning: message.isCommandRunning,
              isTaskListCollapsed: message.isTaskListCollapsed,
              isRestoring: message.isRestoring,
              sessions: message.sessions,
              currentSession: message.session,
              configurationData: message.configurationData,
              pendingConfirmations:
                message.pendingConfirmations ||
                (message.pendingConfirmation
                  ? [message.pendingConfirmation]
                  : []),
              selection: message.selection,
              inputContent: message.inputContent,
              permissionMode: message.permissionMode,
              attachedImages: message.attachedImages,
              queuedMessages: message.queuedMessages,
              isAuthenticated: message.isAuthenticated,
              workdir: message.workdir,
              theme: message.theme,
              // Hosts (VSCE messageHandler / Desktop desktopHost) include the
              // running background tasks + workflow runs in the snapshot so a
              // webview re-init / pane switch does not wipe them. Without this
              // the reducer falls back to [] and /tasks shows "暂无后台任务"
              // until the next incremental updateBackgroundTasks (e.g. stop).
              backgroundTasks: message.backgroundTasks,
              workflowRuns: message.workflowRuns,
            },
          });
          break;
        case "desktopThemeChange":
          document.documentElement.setAttribute(
            "data-theme",
            message.effective,
          );
          break;
        case "desktopThemeSource":
          // Theme preference broadcast — keeps the settings selection in sync
          // on every instance after 跟随系统/浅色/深色 is picked (the theme
          // itself was already applied by the desktopThemeChange above).
          setThemeSource(message.source);
          break;
        case "showToast":
          // Toasts are window-global (no paneId) — only the root instance (the
          // one that renders the shell/sidebar, never a split-view pane) tracks
          // them, so a multi-pane desktop never stacks duplicates.
          if (myPane !== undefined) break;
          setToasts((prev) => [
            ...prev.filter((t) => t.id !== message.toast.id),
            message.toast,
          ]);
          break;
        case "desktopAccountInfo":
          // Sidebar account card — window-global like showToast (the sidebar
          // renders on the root instance only), so pane instances ignore it.
          if (myPane !== undefined) break;
          setAccountInfo({
            isAuthenticated: message.isAuthenticated === true,
            user: message.user ?? null,
            plan: message.plan ?? null,
            apiQuota: message.apiQuota ?? null,
            update: message.update ?? null,
          });
          break;
        case "desktopTogglePanel":
          if (!forThisPane(message)) break;
          togglePanelRef.current(message.kind as DesktopPanelKind);
          break;
        case "showDialog":
          if (!forThisPane(message)) break;
          dispatch({
            type: "SHOW_DIALOG",
            payload: { type: message.dialogType },
          });
          break;
        case "configurationUpdated":
          dispatch({ type: "HIDE_DIALOG" });
          break;
        case "statusResponse":
          if (!forThisPane(message)) break;
          if (message.configurationData) {
            dispatch({
              type: "SET_CONFIGURATION_DATA",
              payload: message.configurationData,
            });
          }
          break;
        case "configurationError":
          if (!forThisPane(message)) break;
          dispatch({ type: "SET_CONFIGURATION_ERROR", payload: message.error });
          break;
        case "prefillPrompt":
          if (!forThisPane(message)) break;
          // IDE 设置页（settings-preview-entry）「新建/编辑」经 host 转发：
          // 关闭设置 tab 后向聊天 webview 下发预填提示词（spec：AI 对话框
          // 在当前会话继续，预填文本可编辑）。
          if (typeof message.prompt === "string") {
            messageInputRef.current?.loadDraft(message.prompt);
          }
          break;
        case "focusInput":
          if (!forThisPane(message)) break;
          // When a confirm/rewind dialog is open in this pane, focus its
          // primary action instead of the message input. The input is hidden
          // (display:none) during a tool-permission confirmation, so focusing it
          // silently no-ops; a rewind modal also covers it. Landing focus on
          // the dialog lets the user act on it immediately (Enter to confirm,
          // Esc to cancel) right after the pane switch. Falls back to the
          // message input when no dialog is open.
          {
            const root = chatContainerRef.current ?? document;
            const rewindBtn = root.querySelector<HTMLElement>(
              ".confirm-dialog-btn-confirm:not([disabled])",
            );
            if (rewindBtn) {
              rewindBtn.focus();
              break;
            }
            const applyBtn = root.querySelector<HTMLElement>(
              ".confirmation-btn-apply:not([disabled])",
            );
            if (applyBtn) {
              applyBtn.focus();
              break;
            }
            if (
              messageInputRef.current &&
              typeof messageInputRef.current.focus === "function"
            ) {
              messageInputRef.current.focus();
            }
          }
          break;
        case "triggerShortcut":
          if (!forThisPane(message)) break;
          // Forwarded IDE keymap shortcut (JetBrains): the component-scoped AnAction
          // intercepts the IDE action and forwards the intended operation here, since
          // registerCustomShortcutSet consumes the AWT event before CEF can see it.
          if (
            messageInputRef.current &&
            typeof messageInputRef.current.triggerShortcut === "function"
          ) {
            messageInputRef.current.triggerShortcut(message.name);
          }
          break;
        case "scrollToBottom":
          if (!forThisPane(message)) break;
          // Scroll the message list to bottom
          if (
            messageListRef.current &&
            typeof messageListRef.current.scrollToBottom === "function"
          ) {
            messageListRef.current.scrollToBottom("smooth");
          }
          break;
        // Incremental update commands for streaming optimization
        case "appendMessage":
          if (!forThisPane(message)) break;
          dispatch({ type: "APPEND_MESSAGE", payload: message.message });
          break;
        case "compactionStateChange":
          if (!forThisPane(message)) break;
          dispatch({
            type: "SET_COMPACTING",
            payload: message.isCompacting === true,
          });
          if (!message.isCompacting) setCompactionStream("");
          break;
        case "compactionContentUpdate":
          if (!forThisPane(message)) break;
          // The CLI delivers the accumulated compaction text; the hint renders
          // only its last 30 characters (streaming tail).
          setCompactionStream(message.content);
          break;
        case "updateStreamingContent":
          if (!forThisPane(message)) break;
          dispatch({
            type: "UPDATE_STREAMING_CONTENT",
            payload: {
              messageId: message.messageId,
              chunk: message.chunk,
              stage: message.stage,
            },
          });
          break;
        case "updateStreamingReasoning":
          if (!forThisPane(message)) break;
          dispatch({
            type: "UPDATE_STREAMING_REASONING",
            payload: {
              messageId: message.messageId as string,
              chunk: message.chunk as string,
              stage: message.stage as "end" | "streaming",
            },
          });
          break;
        case "updateToolBlock":
          if (!forThisPane(message)) break;
          dispatch({
            type: "UPDATE_TOOL_BLOCK",
            payload: message.params as ToolBlockUpdateCallbackParams,
          });
          break;
        case "updateErrorBlock":
          if (!forThisPane(message)) break;
          dispatch({
            type: "APPEND_ERROR_BLOCK",
            payload: { error: message.error },
          });
          break;
        case "authStatusResponse":
          dispatch({
            type: "SET_AUTHENTICATED",
            payload: message.isAuthenticated || false,
          });
          // The account card mirrors the host's per-host auth state; the user
          // came along with the response (desktop host forwards it).
          setAccountInfo((prev) => ({
            ...(prev ?? { isAuthenticated: false }),
            isAuthenticated: message.isAuthenticated === true,
            user: message.user ?? prev?.user ?? null,
          }));
          break;
        case "contextUsage":
          // Context-window usage push (batch 2 上下文用量指示器). Session-scoped
          // on desktop (each pane's session reports its own usage), so the reply
          // is pane-routed like the other per-session pushes.
          if (!forThisPane(message)) break;
          setContextUsage(
            typeof message.percent === "number"
              ? Math.min(100, Math.max(0, message.percent))
              : undefined,
          );
          break;
        case "agentsContentResponse":
          // AGENTS.md editor contents (settings 个性化 view). Requested by the
          // settings page (root instance only), so replies are untagged — the
          // pane guard below would drop them in a split-view pane, which is
          // correct: panes never render the settings page.
          if (message.scope === "project") {
            setProjectAgentsContent(
              typeof message.content === "string" ? message.content : "",
            );
          } else {
            setUserAgentsContent(
              typeof message.content === "string" ? message.content : "",
            );
          }
          break;
        case "loginResponse":
          if (message.success) {
            dispatch({ type: "SET_AUTHENTICATED", payload: true });
            setAccountInfo((prev) => ({
              isAuthenticated: true,
              user: message.user ?? prev?.user ?? null,
              plan: prev?.plan ?? null,
              apiQuota: prev?.apiQuota ?? null,
            }));
          }
          break;
        case "logoutResponse":
          if (message.success) {
            dispatch({ type: "SET_AUTHENTICATED", payload: false });
            // 登出即清空用量 —— host 随后会推 desktopAccountInfo 全量快照。
            setAccountInfo({
              isAuthenticated: false,
              user: null,
              plan: null,
              apiQuota: null,
            });
          }
          break;
      }
    };

    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, []);

  // Desktop multi-pane (FR-032): session-scoped commands carry this pane's id
  // so the host routes them to the agent bound to this pane. Untagged when
  // paneId is undefined (IDE hosts) — those backends ignore the field.
  const postToHost = useCallback(
    (message: Record<string, unknown>) => {
      const pid = paneIdRef.current;
      vscode.postMessage(
        pid === undefined ? message : { ...message, paneId: pid },
      );
    },
    [vscode],
  );

  // Desktop: query this pane's own workdir for its git branches (FR-052). Each
  // pane asks independently so a new-session pane keeps its workdir/branch even
  // when focus moves to a sibling pane (which would otherwise rewire the host's
  // global workdir). Clear stale branches first so the selector hides until the
  // fresh reply lands.
  //
  // Depend ONLY on pickerWorkdir (a primitive string) — never on the host
  // object reference, and never on host.workdir. Rationale: when a new pane
  // boots, activateAgentInPane sends desktopWorkdirState to update the host's
  // global workdir from the previously-focused sibling's path to this pane's
  // repo root. That changes host.workdir even though THIS pane's
  // effectiveWorkdir is unchanged (spawn-before = recents[0] fallback; spawn-after
  // = state.workdir = agent.cwd = the same recents[0]). Re-querying on a
  // host.workdir change would null out the branches and flash the selector
  // twice. A genuine user workdir switch changes recents[0] (and thus
  // pickerWorkdir), which is the only re-query signal we want. Likewise a
  // worktree creation must not re-query: the spawned session's cwd is the
  // worktree path, which is not a user-chosen directory (not in recents), so
  // pickerWorkdir stays on the user's repo — and the query signal never fires
  // before the first message hides the pickers.
  useEffect(() => {
    if (!isDesktop) return;
    setPaneGitBranches(null);
    if (!pickerWorkdir) {
      setBranchesLoading(false);
      return;
    }
    setBranchesLoading(true);
    postToHost({
      command: "desktopListGitBranches",
      workdir: pickerWorkdir,
      paneId,
    });
  }, [pickerWorkdir, isDesktop, postToHost, paneId]);

  const handleClearChat = useCallback(() => {
    // /clear 斜杠命令：三端统一为"原地清空当前会话"，streaming 期间忽略。
    if (stateRef.current.isStreaming) return;

    postToHost({
      command: "clearChat",
    });
  }, [postToHost]);

  const handleToastDismiss = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const handleToastAction = useCallback(
    (toast: UpdateToast) => {
      if (!toast.action) return;
      postToHost({
        command: "toastAction",
        toastId: toast.id,
        action: toast.action,
      });
      // 动作语义在宿主（打开下载页/聚焦会话等）——回传后即关闭 toast。
      setToasts((prev) => prev.filter((t) => t.id !== toast.id));
    },
    [postToHost],
  );

  // Desktop split-view: when the focused session changes (Ctrl+Tab, clicking a
  // pane, selecting a sidebar session), drop toasts pointing at the newly
  // focused session — their job (nudge the user over) is done, the confirmation
  // dialog pops now that the session is visible, and the toast would otherwise
  // linger as a duplicate prompt (spec「后台会话活动通知」scenario 12).
  const focusedSessionKey =
    host?.type === "desktop"
      ? (() => {
          const focusedPane = host.panes?.find(
            (p) => p.paneId === (host.focusedPaneId ?? host.panes?.[0]?.paneId),
          );
          return focusedPane?.sessionId
            ? `${focusedPane.host ?? "local"}:${focusedPane.sessionId}`
            : null;
        })()
      : null;

  useEffect(() => {
    if (!focusedSessionKey) return;
    setToasts((prev) => {
      const next = prev.filter(
        (t) =>
          !(
            t.action?.type === "focusSession" &&
            `${t.action.host}:${t.action.sessionId}` === focusedSessionKey
          ),
      );
      return next.length === prev.length ? prev : next;
    });
  }, [focusedSessionKey]);

  // Desktop 的"新对话"入口（侧边栏按钮）：由宿主 spawn 新 agent 承载全新会话，
  // 当前会话在后台继续，因此流式期间保持可用。
  const handleDesktopNewSession = useCallback(() => {
    postToHost({
      command: "newSession",
    });
  }, [postToHost]);

  const handleLogin = useCallback(() => {
    vscode.postMessage({ command: "login" });
  }, [vscode]);

  const handleOpenSettings = useCallback(
    (nav?: NavKey) => {
      if (isDesktop) {
        if (paneId !== undefined && onOpenSettingsFromPane) {
          // Pane layout (single or split, spec agent-config.md 场景 5): this
          // instance only renders its chat container — the full-page settings
          // live on the root instance's DesktopShell. Delegate so /config、
          // /agents、/skills、/mcp 在任一对话（含发过消息的）都能打开设置页。
          onOpenSettingsFromPane(nav);
          return;
        }
        // Batch 2: desktop opens the settings full-page (spec 场景 1). Load the
        // configuration + AGENTS.md editor contents on entry; the page reads the
        // latest from its own props when it renders. /agents、/skills、/hooks
        // 斜杠命令携带 nav（subagents/skills/hooks）选中对应选项卡
        // （spec agents-command.md / hooks-command.md）。
        setSettingsOpen(true);
        if (nav) setSettingsNav(nav);
        vscode.postMessage({ command: "getConfiguration" });
        vscode.postMessage({ command: "getAgentsContent", scope: "user" });
        return;
      }
      // IDE hosts (VSCE/JetBrains): the host opens the settings tab webview in
      // the editor area (spec 场景 10) and serves the shared SettingsPage there.
      // nav 随 openSettings 透传，host 经 settingsState 下发给设置页。
      vscode.postMessage({ command: "openSettings", ...(nav ? { nav } : {}) });
    },
    [vscode, isDesktop, paneId, onOpenSettingsFromPane],
  );

  const handleOpenEnterpriseConsole = useCallback(() => {
    const url = stateRef.current.configurationData?.serverUrl;
    if (url) {
      vscode.postMessage({ command: "openExternal", url });
    }
  }, [vscode]);

  // 账户卡片的「帮助文档」：serverUrl + /docs 走系统浏览器（spec 场景 4）.
  const handleOpenHelpDocs = useCallback(() => {
    const url = stateRef.current.configurationData?.serverUrl;
    if (url) {
      vscode.postMessage({
        command: "openExternal",
        url: `${url.replace(/\/+$/, "")}/docs/`,
      });
    }
  }, [vscode]);

  const handleLogout = useCallback(() => {
    vscode.postMessage({ command: "logout" });
  }, [vscode]);

  // 更新按钮状态机（交互设计 §4）：S2 确认后通知宿主下载；S4 确认后通知宿主
  // 安装并重启。宿主随后推回 desktopAccountInfo.update 流转状态。
  const handleDownloadUpdate = useCallback(() => {
    vscode.postMessage({ command: "desktopUpdateDownload" });
  }, [vscode]);
  const handleRestartApp = useCallback(() => {
    vscode.postMessage({ command: "desktopUpdateRestart" });
  }, [vscode]);

  // Batch 2 settings full-page (desktop): close returns to the conversation
  // view; the next 设置 click re-opens it (spec 场景 1/11). The AGENTS.md
  // editor contents are re-fetched on open so unsaved edits are discarded.
  const handleCloseSettings = useCallback(() => {
    setSettingsOpen(false);
  }, []);

  // 设置页「新建/编辑」→ 关闭设置页并预填 AI 对话框提示词（desktop）。设置页
  // 打开期间 chatContainer 卸载（settingsOpen 替换视图），MessageInput 重挂载
  // 后才能写入——用 pendingPrefillPrompt + effect 在渲染后写入并聚焦。
  const handlePrefillPrompt = useCallback((prompt: string) => {
    setSettingsOpen(false);
    setSessionBoardOpen(false);
    setPendingPrefillPrompt(prompt);
  }, []);

  // chatContainer 重挂载完成后把待填提示词写入输入框
  useEffect(() => {
    if (!settingsOpen && pendingPrefillPrompt !== null) {
      messageInputRef.current?.loadDraft(pendingPrefillPrompt);
      setPendingPrefillPrompt(null);
    }
  }, [settingsOpen, pendingPrefillPrompt]);

  // Batch 2 session board (desktop): 活动 button toggles the board view; the
  // board's 返回当前会话 closes it (spec 场景 6). Settings and board are
  // mutually exclusive — opening one closes the other.
  const handleOpenSessionBoard = useCallback(() => {
    setSessionBoardOpen(true);
    setSettingsOpen(false);
  }, []);

  const handleCloseSessionBoard = useCallback(() => {
    setSessionBoardOpen(false);
  }, []);

  const handleSendMessage = useCallback(
    (
      text: string,
      images?: Array<{ data: string; mediaType: string }>,
      force: boolean = false,
    ) => {
      const trimmedText = text.trim();
      if (!trimmedText && (!images || images.length === 0)) return;

      // Intercept local slash commands — open dialogs instead of sending to agent
      if (trimmedText === "/clear") {
        handleClearChat();
        return;
      }
      if (trimmedText === "/compact" || trimmedText.startsWith("/compact ")) {
        const customInstructions =
          trimmedText.slice("/compact".length).trim() || undefined;
        postToHost({
          command: "compact",
          customInstructions,
        });
        return;
      }
      if (trimmedText === "/config") {
        // 不再弹窗：与点击头部设置按钮一致，打开设置页「全局设置」选项卡
        // （2026-08-29 用户拍板，对齐 /agents → subagents、/skills → skills；
        // 见 SettingsPage 全局设置视图）。
        handleOpenSettings();
        return;
      }
      if (trimmedText === "/plugin") {
        dispatch({ type: "SHOW_DIALOG", payload: { type: "plugin" } });
        return;
      }
      if (trimmedText === "/mcp") {
        // 不再弹窗：唤起设置页并选中「MCP 服务」选项卡（2026-08-29 用户拍板，
        // 弹窗内容已迁移到设置页，见 SettingsMcpView）。
        handleOpenSettings("mcp");
        return;
      }
      if (trimmedText === "/status") {
        dispatch({ type: "SHOW_DIALOG", payload: { type: "status" } });
        return;
      }
      if (trimmedText === "/tasks") {
        dispatch({ type: "SHOW_DIALOG", payload: { type: "tasks" } });
        return;
      }
      if (trimmedText === "/workflows" || trimmedText === "/workflows ") {
        dispatch({ type: "SHOW_DIALOG", payload: { type: "workflows" } });
        return;
      }
      if (trimmedText === "/agents") {
        // 不再弹窗：唤起设置页并选中「子代理」选项卡（2026-08-29 用户拍板，
        // 弹窗内容已迁移到设置页，见 SettingsSubagentsView）。
        handleOpenSettings("subagents");
        return;
      }
      if (trimmedText === "/skills") {
        // 不再弹窗：唤起设置页并选中「技能」选项卡（见 SettingsSkillsView）。
        handleOpenSettings("skills");
        return;
      }
      if (trimmedText === "/hooks") {
        // 唤起设置页并选中「钩子」选项卡（对齐 /agents → subagents、/skills →
        // skills 的现有模式；见 SettingsHooksView）。
        handleOpenSettings("hooks");
        return;
      }
      if (trimmedText === "/rewind") {
        if (stateRef.current.isStreaming) return;
        setRewindPopupOpen(true);
        setRewindCheckpointsLoading(true);
        postToHost({ command: "listRewindCheckpoints" });
        return;
      }
      // /model is allowed mid-stream (spec scenario 8): no isStreaming guard.
      if (trimmedText === "/model") {
        setModelPopupOpen(true);
        setModelLoading(true);
        postToHost({ command: "getConfiguredModels" });
        return;
      }
      // /btw side question — answered out-of-band via askBtw, never enters the chat.
      if (trimmedText === "/btw" || trimmedText.startsWith("/btw ")) {
        const question = trimmedText.slice("/btw".length).trim();
        if (!question) {
          // Code span keeps `<your question>` from being parsed as an HTML tag.
          setBtwPanel({
            question: "",
            answer: "`用法：/btw <你的问题>`",
            loading: false,
            contentStarted: false,
          });
          return;
        }
        btwActiveRef.current = question;
        setBtwPanel({
          question,
          answer: "",
          loading: true,
          contentStarted: false,
        });
        postToHost({ command: "askBtw", question });
        return;
      }
      // /plan — host-local command (CLI Ink overlay / IDE plan preview /
      // desktop Plan panel). Forwarded to the host instead of being sent to the
      // agent; the host switches to plan mode or shows the current plan.
      if (trimmedText === "/plan" || trimmedText.startsWith("/plan ")) {
        const args = trimmedText.slice("/plan".length).trim() || undefined;
        postToHost({ command: "planCommand", args });
        return;
      }

      // Desktop worktree flow (FR-023): on the first message of a new session
      // with the worktree checkbox on, create the worktree first — the main
      // process switches into it and forwards this message.
      if (paneId && groupKeyRef.current?.startsWith("new:"))
        sentFromNewSessionRef.current = true;
      if (
        host?.type === "desktop" &&
        !stateRef.current.messages.some(
          (m) => !(m.role === "user" && m.isMeta),
        ) &&
        worktreeChecked &&
        effectiveWorkdirRef.current &&
        gitBranches
      ) {
        setWorktreeCreating(true);
        postToHost({
          command: "desktopCreateWorktree",
          workdir: effectiveWorkdirRef.current,
          baseBranch: worktreeBranch || gitBranches.current,
          text: trimmedText,
          images: images,
        });
        return;
      }

      // Send to extension
      postToHost({
        command: "sendMessage",
        text: trimmedText,
        images: images,
        force: force,
      });
    },
    [
      handleClearChat,
      handleOpenSettings,
      host,
      worktreeChecked,
      worktreeBranch,
      postToHost,
      paneId,
      gitBranches,
    ],
  );

  const handleAbortMessage = useCallback(() => {
    if (!state.isStreaming) return;

    postToHost({
      command: "abortMessage",
    });
  }, [state.isStreaming, postToHost]);

  const handleDeleteQueuedMessage = useCallback(
    (id: string) => {
      // Optimistically update local state (filter by id)
      const newQueue = state.queuedMessages.filter((qm) => qm.id !== id);
      dispatch({ type: "SET_QUEUED_MESSAGES", payload: newQueue });

      // If the deleted one is being edited, exit editing mode
      if (state.editingQueuedId === id) {
        dispatch({ type: "SET_EDITING_QUEUED_ID", payload: null });
      }

      // Notify extension to delete from SDK's queue by id
      postToHost({
        command: "deleteQueuedMessageById",
        id,
      });
    },
    [state.queuedMessages, state.editingQueuedId, postToHost],
  );

  const handleEditQueuedMessage = useCallback(
    (id: string) => {
      const qm = state.queuedMessages.find((m) => m.id === id);
      if (!qm) return;

      const text = qm.content || qm.text || "";

      // Load content into this pane's input via the imperative ref (scoped to this
      // pane only; window.postMessage would be received by all split-view panes).
      messageInputRef.current?.loadQueuedEditContent(text);
      dispatch({ type: "SET_EDITING_QUEUED_ID", payload: id });
    },
    [state.queuedMessages],
  );

  const handleSendQueuedMessage = useCallback(
    (id: string) => {
      const qm = state.queuedMessages.find((m) => m.id === id);
      if (!qm) return;

      const text = qm.content || qm.text || "";
      const images = qm.images?.map((img) => ({
        data: img.path || "",
        mediaType: img.mimeType || "",
      }));

      // force=true: terminate current conversation and send this message immediately
      handleSendMessage(text, images, true);

      // Optimistically remove from queue + notify backend (and exit editing if applicable)
      handleDeleteQueuedMessage(id);
    },
    [state.queuedMessages, handleSendMessage, handleDeleteQueuedMessage],
  );

  const handleSubmitQueuedEdit = useCallback(
    (
      id: string,
      text: string,
      images?: Array<{ data: string; mediaType: string }>,
    ) => {
      postToHost({
        command: "updateQueuedMessage",
        id,
        text,
        images,
      });
      dispatch({ type: "SET_EDITING_QUEUED_ID", payload: null });
    },
    [postToHost],
  );

  const handleCancelQueuedEdit = useCallback(() => {
    dispatch({ type: "SET_EDITING_QUEUED_ID", payload: null });
  }, []);

  const handleDialogClose = useCallback(() => {
    dispatch({ type: "HIDE_DIALOG" });
  }, []);

  // 设置页保存配置（全局设置/个性化视图）：经 updateConfiguration RPC 写回，
  // 等待 host 回发 configurationResponse（成功）或 configurationError（失败）。
  // 注意：不能在此 dispatch SET_CONFIGURATION_ERROR undefined —— 该 reducer
  // case 会把 configurationLoading 复位为 false，与上一条 LOADING true 在
  // React 批处理下合并后 saving 从未变 true，SettingsPage 的保存反馈 effect
  // 将永不触发（真机实测复现）。
  const handleConfigurationSave = useCallback(
    (configData: ConfigurationData) => {
      dispatch({ type: "SET_CONFIGURATION_LOADING", payload: true });
      vscode.postMessage({
        command: "updateConfiguration",
        configurationData: configData,
      });
    },
    [vscode],
  );

  // A message counts as chat content only when the UI renders it — hidden meta
  // user messages (e.g. SessionStart hook additionalContext, isMeta: true) do
  // not, so they must not suppress the welcome page, the desktop new-session
  // pickers, or the desktop worktree trigger.
  const hasVisibleMessages = state.messages.some(
    (m) => !(m.role === "user" && m.isMeta),
  );

  // Welcome page shows only when there are no visible messages yet. Login is optional:
  // a direct-connect config (baseURL/apiKey) works without authentication, so an
  // unauthenticated user who sends a message must still see the chat, not the welcome page.
  const showWelcome = !hasVisibleMessages;
  // Withhold the welcome page until the initial state (incl. auth status) has
  // arrived, otherwise logged-in users see the login CTA flash before
  // setInitialState updates isAuthenticated to true.
  const showWelcomeReady = showWelcome && state.initialized;

  // Initialize webview and load sessions on component mount
  useEffect(() => {
    dispatch({ type: "SET_SESSIONS_LOADING", payload: true });
    vscode.postMessage({
      command: "webviewReady",
    });
  }, [vscode]);

  const handleSessionSelect = useCallback(
    (sessionId: string) => {
      if (state.isStreaming) return;

      // 清空当前任务列表：避免恢复期间残留旧会话的任务，
      // 并让新会话任务从空状态进入（若全部已完成则直接保持隐藏）
      dispatch({ type: "SET_TASKS", payload: [] });

      postToHost({
        command: "restoreSession",
        sessionId,
      });
    },
    [state.isStreaming, postToHost],
  );

  const handleInputCleared = useCallback(() => {
    dispatch({ type: "INPUT_CLEARED" });
  }, []);

  // Desktop panel comments (preview element picks, diff-line comments) land in
  // this pane's input (not sent), so several can be batched and edited before
  // sending.
  const handleAddComment = useCallback((text: string) => {
    messageInputRef.current?.appendText(text);
  }, []);

  // Re-focus input when command finishes running (e.g., after bang execution)
  useEffect(() => {
    if (!state.isCommandRunning && messageInputRef.current) {
      messageInputRef.current.focus();
    }
  }, [state.isCommandRunning]);

  const handleConfirmation = useCallback(
    (confirmationId: string, decision?: ConfirmationDecision) => {
      postToHost({
        command: "confirmationResponse",
        confirmationId,
        approved: true,
        decision,
      });
      dispatch({ type: "HIDE_CONFIRMATION", payload: confirmationId });
    },
    [postToHost],
  );

  const handleRejection = useCallback(
    (confirmationId: string) => {
      postToHost({
        command: "confirmationResponse",
        confirmationId,
        approved: false,
      });
      dispatch({ type: "HIDE_CONFIRMATION", payload: confirmationId });
    },
    [postToHost],
  );

  const handleRewindToMessage = useCallback(
    (messageId: string) => {
      if (state.isStreaming) return;
      setPendingRewindId(messageId);
    },
    [state.isStreaming],
  );

  // /rewind popup selection reuses the same ConfirmDialog flow as the
  // per-message rewind button.
  const handleRewindCheckpointSelect = useCallback((messageId: string) => {
    setRewindPopupOpen(false);
    setPendingRewindId(messageId);
    messageInputRef.current?.focus();
  }, []);

  const handleRewindPopupClose = useCallback(() => {
    setRewindPopupOpen(false);
    messageInputRef.current?.focus();
  }, []);

  // /model popup: send the switch and close silently (no toast/system message).
  const handleModelSelect = useCallback(
    (model: string) => {
      postToHost({ command: "setModel", model });
      setModelPopupOpen(false);
      messageInputRef.current?.focus();
    },
    [postToHost],
  );

  const handleModelPopupClose = useCallback(() => {
    setModelPopupOpen(false);
    messageInputRef.current?.focus();
  }, []);

  // Close the /btw panel. While a request is in flight, clearing btwActiveRef
  // makes the late reply a no-op (scenario 7: closing during loading drops it).
  const handleBtwClose = useCallback(() => {
    btwActiveRef.current = null;
    setBtwPanel(null);
    messageInputRef.current?.focus();
  }, []);

  // The /btw panel is conversation-scoped (spec scenario 14): switching to
  // another conversation closes it, so the new conversation never shows the old
  // one's panel. Desktop panes key ChatApp by paneId (not sessionId), so a
  // sidebar session switch leaves this component mounted — without this effect
  // the local btwPanel useState would survive the switch (setInitialState only
  // resets reducer state, not local state). Clearing btwActiveRef also drops any
  // in-flight askBtw reply that lands after the switch. `previous !== undefined`
  // keeps the initial mount (no conversation assigned yet) a no-op.
  useEffect(() => {
    const sessionId = state.currentSession?.id;
    const previous = btwSessionRef.current;
    btwSessionRef.current = sessionId;
    if (previous !== undefined && previous !== sessionId) handleBtwClose();
  }, [state.currentSession?.id, handleBtwClose]);

  const handleRewindConfirm = useCallback(() => {
    const messageId = pendingRewindId;
    setPendingRewindId(null);
    if (messageId) {
      postToHost({
        command: "rewindToMessage",
        messageId,
      });
    }
  }, [pendingRewindId, postToHost]);

  const showPanelHint = useCallback(
    (text: string) => {
      // Route local validations (panel min-width refusals, preview URL checks)
      // through the host's global toast so desktop hints share one presentation
      // with host failures instead of a second hint style.
      postToHost({ command: "desktopShowHint", text });
    },
    [postToHost],
  );

  // Desktop remote sessions: request an ssh port forward for the clicked
  // localhost URL (scenario 15). The main process picks a local port, starts
  // `ssh -N -L` and replies with the rewritten 127.0.0.1 address, which the
  // preview pane then loads. Repeated clicks on the SAME link while the forward
  // is established or connecting are no-ops — the tunnel is reused, not rebuilt.
  const acquireForward = useCallback(
    (host: string, url: string, tabId?: string) => {
      // The forward is keyed by the session's panel-group key; without one (a
      // pane-less desktop view) there is nothing to cache the reference under.
      if (!groupKey) return;
      let remotePort: number;
      try {
        const u = new URL(url);
        if (u.protocol !== "http:" && u.protocol !== "https:") {
          showPanelHint("仅支持 http/https 链接");
          return;
        }
        remotePort = Number(u.port) || (u.protocol === "https:" ? 443 : 80);
      } catch {
        showPanelHint("无效的预览链接");
        return;
      }
      const requestId = `fwd-${++forwardSeqRef.current}`;
      const fwd = { host, remotePort, originalUrl: url, requestId };
      setCurrentForward(fwd);
      // Remember which preview tab asked for this tunnel so the port-forward
      // reply lands on that tab (a sibling preview tab keeps its own URL).
      if (tabId) forwardTabIdRef.current.set(requestId, tabId);
      // Keep the reference in the session's cached group immediately (not via the
      // state-sync effect below) so a desktopForwardPortResult reply — which may
      // arrive on the very next event-loop turn — can match this forward even if
      // the effect hasn't flushed yet. A pane rebinding to another session then
      // keeps THIS session's forward cached for when it comes back.
      let group = panelGroupCache.get(groupKey);
      if (!group) {
        group = emptyPanelGroup();
        panelGroupCache.set(groupKey, group);
      }
      group.forward = fwd;
      // The session id scopes the tunnel's lifetime on the host — it stays alive
      // across UI actions and is only released when the session is deleted
      // (scenario 18).
      postToHost({
        command: "desktopForwardPort",
        host,
        url,
        requestId,
        sessionId: groupKey,
      });
    },
    [postToHost, showPanelHint, groupKey],
  );

  // Desktop: idle-preload the lazily injected xterm chunk so the first
  // terminal open doesn't pay the fetch+parse cost.
  useEffect(() => {
    if (!isDesktop) return;
    const id = window.requestIdleCallback?.(() => prefetchTerminalLib());
    return () => {
      if (id !== undefined) window.cancelIdleCallback?.(id);
    };
  }, [isDesktop]);

  // Check a panel on: it shares its row with the message area. When the
  // checked panels would squeeze the conversation below its minimum width,
  // auto-replace already-open panels — oldest-checked first (the array is in
  // check order) — until the new panel fits, and hint which ones were closed
  // (「面板空间不足自动替换」). Replaced panels only get unchecked: they stay
  // mounted so their content survives and re-checking restores it. Only when
  // even closing every old panel cannot fit the new one (window narrower than
  // the minimum conversation + panel widths) is the open refused — and then
  // nothing is closed, so a failed replace never takes old panels down.
  // Generates a fresh tab id (kind-prefixed, monotonically increasing per kind).
  const genTabId = useCallback((kind: DesktopPanelKind): string => {
    tabSeqRef.current[kind] += 1;
    return `${kind}-${tabSeqRef.current[kind]}`;
  }, []);

  // Shared space guard: the conversation column must keep its minimum width
  // next to the panel; a shrunken window clamps the shared slot width before
  // the panel shows. Refuses (with a hint) when even that cannot fit.
  const ensurePanelSpace = useCallback((): boolean => {
    const containerW = chatContainerRef.current?.getBoundingClientRect().width;
    if (containerW) {
      // Tabbed layout: one slot, so the only space guard is whether the
      // conversation column keeps its minimum width next to the panel.
      if (containerW - PANEL_MIN_WIDTH < CHAT_MAIN_MIN_WIDTH) {
        showPanelHint("空间不足，无法开启面板");
        return false;
      }
      if (panelWidthRef.current > containerW - CHAT_MAIN_MIN_WIDTH) {
        // The shared width is wider than the room available (window shrank
        // since the last open) — clamp it before showing the panel.
        setPanelWidth(containerW - CHAT_MAIN_MIN_WIDTH);
      }
    }
    return true;
  }, [showPanelHint]);

  // Append a NEW tab instance and activate it. Multi-instance kinds (preview /
  // diff / file) call this for every open action; single-instance kinds route
  // through ensureUniqueTab instead. Returns the new id, or null when the space
  // guard refuses (nothing is opened in that case).
  const addTab = useCallback(
    (tab: Omit<PanelTab, "id">): string | null => {
      if (!ensurePanelSpace()) return null;
      const id = genTabId(tab.kind);
      setTabs((prev) => [...prev, { ...tab, id }]);
      setActiveTabId(id);
      // Opening a tab via any path (link, file path, "＋", empty-state entry)
      // brings the panel back if it was collapsed — the raised tab wins over
      // the previously viewed one (「除非用户通过其他方式调起新的 tab 那么以调起
      // 时候的 tab 为优先」).
      setPanelExpanded(true);
      return id;
    },
    [ensurePanelSpace, genTabId],
  );

  // Open-or-activate a single-instance kind (terminal / plan): the existing tab
  // is activated, never duplicated.
  const ensureUniqueTab = useCallback(
    (kind: DesktopPanelKind): string | null => {
      const existing = tabsRef.current.find((t) => t.kind === kind);
      if (existing) {
        setActiveTabId(existing.id);
        setPanelExpanded(true);
        return existing.id;
      }
      return addTab({ kind });
    },
    [addTab],
  );

  useEffect(() => {
    ensureTabRef.current = ensureUniqueTab;
  }, [ensureUniqueTab]);

  // "＋" tab-bar menu: only preview is multi-instance — every click adds a
  // fresh blank tab (its address bar lets the user type a new URL). All other
  // kinds (plan/diff/terminal/file) are single-instance: open-or-activate the
  // unique tab, never duplicating.
  const tryOpenPanel = useCallback(
    (kind: DesktopPanelKind): boolean => {
      if (kind === "preview") {
        return addTab({ kind }) !== null;
      }
      return ensureUniqueTab(kind) !== null;
    },
    [ensureUniqueTab, addTab],
  );

  // Close one tab: removes it from the open set; closing the active tab falls
  // back to its left neighbor (PreviewPane closeTab convention); closing the
  // last tab collapses the whole slot and exits panel fullscreen. Browser-tab
  // semantics: closing destroys the instance — re-opening via a link or "＋"
  // creates a fresh one (terminal PTYs / preview guests do not survive close).
  const handleCloseTab = useCallback((tabId: string) => {
    const tabs = tabsRef.current;
    const idx = tabs.findIndex((t) => t.id === tabId);
    if (idx === -1) return;
    const closed = tabs[idx];
    const next = tabs.filter((t) => t.id !== tabId);
    setTabs(next);
    if (activeTabIdRef.current === tabId) {
      setActiveTabId(next.length ? next[Math.max(0, idx - 1)].id : null);
    }
    if (closed.kind === "preview" || next.length === 0) {
      setPreviewFullscreen(false);
    }
  }, []);

  // Header 面板按钮: expand/collapse the right-hand panel (spec「面板展开/折
  // 叠」). Collapsing hides the slot but keeps every tab instance mounted
  // (display:none in the slot JSX) — tabs, the active tab and the dragged width
  // all survive, and the next expand restores them. Fullscreen can't stay on
  // while collapsed (the slot hides the whole chat column), so collapsing
  // exits it; expanding leaves it untouched.
  const handleTogglePanelExpanded = useCallback(() => {
    setPanelExpanded((prev) => {
      const next = !prev;
      if (!next) setPreviewFullscreen(false);
      return next;
    });
  }, []);

  // Clicking a tab: switch the active panel without closing anything.
  const handleActivatePanel = useCallback((tabId: string) => {
    setActiveTabId(tabId);
  }, []);

  // Header 面板 menu (checkbox per kind). Checking a multi-instance kind opens
  // a fresh tab; unchecking closes ALL tabs of that kind — the checkbox mirrors
  // "any tab of this kind is open" (a single-instance kind has at most one).
  const handleTogglePanel = useCallback(
    (kind: DesktopPanelKind) => {
      if (panelDisabledRef.current.includes(kind)) return;
      if (tabsRef.current.some((t) => t.kind === kind)) {
        const next = tabsRef.current.filter((t) => t.kind !== kind);
        setTabs(next);
        const active = activeTabIdRef.current;
        if (active && !next.some((t) => t.id === active)) {
          setActiveTabId(next.length ? next[next.length - 1].id : null);
        }
        if (kind === "preview" || next.length === 0) {
          setPreviewFullscreen(false);
        }
      } else {
        tryOpenPanel(kind);
      }
    },
    [tryOpenPanel],
  );

  useEffect(() => {
    togglePanelRef.current = handleTogglePanel;
  }, [handleTogglePanel]);

  // Desktop file panel (spec: 文件面板): a file path clicked in a message or
  // terminal opens here instead of the OS. Show the panel immediately with a
  // loading stub; the host reads the file (local fs or over ssh) and replies
  // with desktopFileContent to fill it in. The host is captured per-pane so a
  // split-view sibling's click never resolves against this pane's host.
  // IDE hosts (VSCE/JetBrains) keep the plain openFile RPC that opens the file
  // in the IDE — only the desktop host intercepts the click for the panel.
  const handleOpenFile = useCallback(
    (path: string, startLine?: number, endLine?: number) => {
      if (!path) return;
      if (!isDesktop) {
        vscode.postMessage({ command: "openFile", path, startLine, endLine });
        return;
      }
      // The file panel is single-instance: any file click activates the one
      // file tab and switches it to the new path (soft-refresh — the old
      // content stays until the host reply lands, matching the diff pane).
      // Only when no file tab exists yet is a fresh one added.
      const existing = tabsRef.current.find((t) => t.kind === "file");
      if (existing) {
        setActiveTabId(existing.id);
        setPanelExpanded(true);
        setTabs((prev) =>
          prev.map((t) =>
            t.id === existing.id
              ? {
                  ...t,
                  filePath: path,
                  startLine,
                  endLine,
                  fileView: t.fileView
                    ? {
                        ...t.fileView,
                        path,
                        loading: true,
                        startLine,
                        endLine,
                      }
                    : {
                        path,
                        host: effectiveHost,
                        loading: true,
                        startLine,
                        endLine,
                      },
                }
              : t,
          ),
        );
      } else if (
        addTab({
          kind: "file",
          filePath: path,
          startLine,
          endLine,
          fileView: {
            path,
            host: effectiveHost,
            loading: true,
            startLine,
            endLine,
          },
        }) === null
      ) {
        return; // space guard refused — nothing opened
      }
      postToHost({
        command: "openFile",
        path,
        host: effectiveHost,
        startLine,
        endLine,
      });
    },
    [isDesktop, addTab, effectiveHost, postToHost, vscode],
  );

  // Desktop file panel auto-refresh (spec: 文件面板自动刷新): when the agent
  // finishes a Write/Edit on the file currently shown, re-read it (soft refresh
  // via the same openFile → desktopFileContent chain, so the host resolves the
  // path and the panel keeps its old content until the reply lands). Only the
  // FIRST observation of a block's completion triggers a refresh: each block's
  // last-seen stage is remembered, so a repeated end-state update (result
  // enrichment, images) or switching back to a session whose history already
  // contains the block never re-fires.
  const fileToolStagesRef = useRef<Map<string, ToolBlock["stage"]>>(new Map());
  useEffect(() => {
    if (!isDesktop) return;
    const filePaths = tabsRef.current
      .filter((t) => t.kind === "file" && t.filePath)
      .map((t) => t.filePath)
      .filter((p): p is string => p !== undefined);
    const workdir = effectiveWorkdirRef.current;
    const stages = fileToolStagesRef.current;
    for (const ref of collectWriteEditBlocks(state.messages)) {
      const key = `${ref.messageId}:${ref.blockId}`;
      const prev = stages.get(key);
      const completed = ref.stage === "end" && ref.success === true;
      if (prev === undefined) {
        // First observation (history loaded via setInitialState/SET_MESSAGES or
        // the block's earlier stages arrived): record, never fire for a block
        // that is already completed on arrival.
        stages.set(key, ref.stage);
        continue;
      }
      if (prev !== "end" && completed && ref.targetPath) {
        // Re-read every open file tab the block touched.
        for (const path of filePaths) {
          if (pathsMatch(ref.targetPath, path, workdir)) {
            handleOpenFile(path);
          }
        }
      }
      stages.set(key, ref.stage);
    }
  }, [state.messages, isDesktop, handleOpenFile]);

  // Local sessions only: leave the panel and open the file in the OS default
  // app (remote hosts have no local file — the button is hidden).
  const handleOpenFileExternal = useCallback(
    (path: string) => {
      if (!isDesktop || !path) return;
      postToHost({ command: "desktopOpenFileExternal", path });
    },
    [isDesktop, postToHost],
  );

  // Authoritative clamp at drag time: keep the shared panel slot within
  // [320, container - conversation minimum].
  const handlePanelWidthChange = useCallback((width: number) => {
    let clamped = Math.max(width, PANEL_MIN_WIDTH);
    const containerW = chatContainerRef.current?.getBoundingClientRect().width;
    if (containerW) {
      clamped = Math.min(clamped, containerW - CHAT_MAIN_MIN_WIDTH);
    }
    setPanelWidth(clamped);
  }, []);

  // Desktop only: clicking a localhost link opens a NEW preview tab ("新链接新
  // tab") instead of navigating the existing one — several addresses can be
  // previewed side by side. Message.tsx gates on waveHostType, so this never
  // fires in IDE hosts.
  const handleOpenPreview = useCallback(
    (url: string) => {
      addTab({ kind: "preview", previewUrl: url });
    },
    [addTab],
  );

  // Remote localhost link handler: open a NEW preview tab and forward. The same
  // URL — under any loopback/all-interfaces host spelling — with the tunnel
  // already established just re-activates the tab that owns it (the tunnel is
  // reused, not rebuilt, scenario 15/16). Every other click — a different path,
  // a different origin, another service entirely — opens a fresh preview tab;
  // tunnels are session-scoped and only die when the session is deleted
  // (scenario 18).
  const handleOpenRemotePreview = useCallback(
    (url: string) => {
      // Read the refs, not the state values: this callback is captured by the
      // memoized Message component at mount, so closing over state would freeze
      // the first render's values and break the same-link dedup below.
      const current = currentForwardRef.current;
      const sameUrl =
        current &&
        canonicalForwardUrl(current.originalUrl) === canonicalForwardUrl(url) &&
        previewForwardErrorRef.current === null;
      const owningTab = current
        ? tabsRef.current.find(
            (t) =>
              t.id === forwardTabIdRef.current.get(current.requestId) &&
              t.kind === "preview",
          )
        : undefined;
      if (sameUrl && owningTab) {
        setActiveTabId(owningTab.id);
        setPanelExpanded(true);
        return;
      }
      const tabId = addTab({ kind: "preview" });
      if (tabId === null) return; // space refused
      setPreviewForwardError(null);
      acquireForward(effectiveHostRef.current, url, tabId);
    },
    [addTab, acquireForward],
  );

  // Retry after a failed forward (scenario 16): re-request the same tunnel.
  // The host treats a failed entry as gone, so a fresh forward is established.
  const handleRemotePreviewRetry = useCallback(() => {
    const fwd = currentForwardRef.current;
    if (!fwd) return;
    setPreviewForwardError(null);
    acquireForward(
      fwd.host,
      fwd.originalUrl,
      forwardTabIdRef.current.get(fwd.requestId),
    );
  }, [acquireForward]);

  const openPreviewHandler =
    effectiveHost !== "local" ? handleOpenRemotePreview : handleOpenPreview;

  // Diff/terminal need a workdir; preview only needs a URL. Remote sessions
  // keep diff/terminal (git and the shell run over ssh) and gain preview via
  // port forwarding (scenario 15); only the workdir requirement remains.
  const panelDisabled: DesktopPanelKind[] = useMemo(
    () => (effectiveWorkdir ? [] : ["diff", "terminal"]),
    [effectiveWorkdir],
  );

  useEffect(() => {
    panelDisabledRef.current = panelDisabled;
  }, [panelDisabled]);

  // Report this pane's toggle state so the desktop app menu's 面板 checkboxes
  // reflect the focused pane (one checkbox per kind — any tab of that kind
  // counts as checked).
  useEffect(() => {
    if (!isDesktop) return;
    postToHost({
      command: "desktopPanelState",
      checked: Array.from(new Set(tabs.map((t) => t.kind))),
    });
  }, [tabs, isDesktop, postToHost]);

  // Esc exits preview fullscreen (spec 场景 2). Registered only while
  // fullscreen is active; pane-level dialogs handle their own Esc first
  // (document capture + stopPropagation), so they close without exiting.
  useEffect(() => {
    if (!isDesktop || !previewFullscreen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setPreviewFullscreen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [isDesktop, previewFullscreen]);

  // Width ceiling for the shared panel slot: container minus the
  // conversation-area minimum. Render-time estimate — the drag handler
  // re-clamps authoritatively on every mousemove.
  const panelMaxWidth = (): number => {
    const containerW =
      chatContainerRef.current?.getBoundingClientRect().width ??
      window.innerWidth;
    return containerW - CHAT_MAIN_MIN_WIDTH;
  };

  const renderPanelSlot = (tab: PanelTab) => {
    const { id, kind } = tab;
    const isActive = activeTabId === id;
    const common = {
      width: panelWidth,
      onWidthChange: (w: number) => handlePanelWidthChange(w),
      maxWidth: panelMaxWidth(),
    };

    if (kind === "preview") {
      const url = tab.previewUrl ?? "";
      const isForwardOwner =
        currentForward !== null &&
        forwardTabIdRef.current.get(currentForward.requestId) === id;
      const pane = (
        <PreviewPane
          key={`${id}:${previewEpoch}`}
          url={url}
          originalUrl={currentForward?.originalUrl}
          onRetry={currentForward ? handleRemotePreviewRetry : undefined}
          vscode={vscode}
          onAddComment={handleAddComment}
          onLastTabClosed={() => handleCloseTab(id)}
          onTitleChange={(title) => {
            setTabs((prev) =>
              prev.map((t) =>
                t.id === id ? { ...t, previewTitle: title } : t,
              ),
            );
          }}
          onNavigate={(url) => {
            // Address-bar commits and in-guest navigation become the tab's
            // URL, so the page a session was last showing survives a session
            // switch / remount (kept in the session's cached panel group).
            setTabs((prev) => {
              const cur = prev.find((t) => t.id === id);
              if (!cur || cur.previewUrl === url) return prev;
              return prev.map((t) =>
                t.id === id ? { ...t, previewUrl: url } : t,
              );
            });
          }}
          {...common}
        />
      );
      if (url) return pane;
      // Empty preview: reuse PreviewPane with a blank tab so the address bar
      // and "+" tab actions stay available — typing a URL starts previewing.
      // A remote forward error (no URL yet) overlays a retry stub instead.
      return (
        <div
          className="preview-pane-empty-wrap"
          style={{ width: common.width }}
          data-testid="preview-pane-empty"
        >
          {pane}
          {isForwardOwner && previewForwardError && (
            <div
              className="preview-pane-forward-error"
              data-testid="preview-forward-error"
            >
              <span>远程预览加载失败：{previewForwardError}</span>
              <button
                className="preview-pane-button"
                data-testid="preview-forward-retry"
                onClick={handleRemotePreviewRetry}
              >
                重试
              </button>
            </div>
          )}
        </div>
      );
    }
    if (kind === "diff") {
      return (
        <DiffPane
          vscode={vscode}
          paneId={paneId}
          visible={isActive}
          isStreaming={state.isStreaming}
          sessionId={state.currentSession?.id}
          workdir={effectiveWorkdir}
          onAddComment={handleAddComment}
          {...common}
        />
      );
    }
    if (kind === "file") {
      return (
        <FilePane
          fileView={tab.fileView ?? null}
          onOpenExternal={handleOpenFileExternal}
          workdir={effectiveWorkdir}
          vscode={vscode}
          onOpenFileInPanel={(path) => handleOpenFile(path)}
          {...common}
        />
      );
    }
    if (kind === "plan") {
      return <PlanPane content={planContent} {...common} />;
    }
    return (
      <TerminalPane
        vscode={vscode}
        paneId={paneId}
        visible={isActive}
        sessionId={state.currentSession?.id}
        workdir={effectiveWorkdir}
        onOpenPreview={openPreviewHandler}
        {...common}
      />
    );
  };

  const chatBodyContent = state.isRestoring ? (
    // Desktop restore in progress: the pane already switched to the target
    // session — show the sweep animation over the message + input area until
    // the host finishes connecting and replaying the transcript (spec 场景 7).
    <div
      className="chat-restoring-overlay"
      data-testid="chat-restoring-overlay"
    >
      <LoadingLogo />
    </div>
  ) : (
    <>
      {showWelcomeReady ? (
        <WelcomeView
          isDesktop={isDesktop}
          isAuthenticated={state.isAuthenticated}
          // Login is optional: a direct-connect config (baseURL + apiKey) works
          // without SSO auth, so an unauthenticated user with one must not be
          // nudged to log in (spec sso-auth「更多菜单与欢迎页」场景 5).
          hasDirectConnectConfig={
            !!(
              state.configurationData?.apiKey &&
              state.configurationData?.baseURL
            )
          }
          onLogin={handleLogin}
        />
      ) : showWelcome ? (
        <LoadingLogo />
      ) : (
        <MessageList
          // 按会话 id 重挂载：切换会话是全新上下文，初始加载强制滚到底，
          // 并重置上一会话遗留的 userScrolledUp（否则在旧会话向上翻过历史后
          // 点开长会话，force 滚动被否决、停在新列表中间——见 longchat-switch e2e）。
          key={state.currentSession?.id}
          ref={messageListRef}
          messages={state.messages}
          queuedMessages={state.queuedMessages}
          isStreaming={state.isStreaming}
          isCompacting={state.isCompacting}
          compactionStream={compactionStream}
          vscode={vscode}
          onRewindToMessage={handleRewindToMessage}
          workdir={state.workdir}
          onOpenPreview={openPreviewHandler}
          onOpenFile={handleOpenFile}
        />
      )}

      {/* 扫光加载动画期间（初始状态尚未就绪且无消息）不展示输入区域，
          只让 LoadingLogo 单独占据主体；就绪后由欢迎页/消息列表带出输入框。 */}
      {showWelcomeReady || !showWelcome ? (
        <div
          className={`input-area-container${isDesktop && state.pendingConfirmations.length > 0 ? " input-area-container--confirm" : ""}`}
        >
          <div
            style={{
              display:
                state.pendingConfirmations.length === 0 ? "block" : "none",
            }}
          >
            <TaskList
              // 按会话 id 重挂载：切换会话时重置“观察过未完成任务”的跟踪，
              // 使全部已完成的新会话立即隐藏，而不是沿用上一会话的 5 秒宽限
              key={state.currentSession?.id}
              tasks={state.tasks}
              isCollapsed={state.isTaskListCollapsed}
              onToggleCollapse={() =>
                dispatch({ type: "TOGGLE_TASK_LIST_COLLAPSE" })
              }
            />
            <QueuedMessageList
              queuedMessages={state.queuedMessages}
              isCollapsed={state.isQueueCollapsed}
              onToggleCollapse={() =>
                dispatch({ type: "TOGGLE_QUEUE_COLLAPSE" })
              }
              onEdit={handleEditQueuedMessage}
              onSend={handleSendQueuedMessage}
              onDelete={handleDeleteQueuedMessage}
              editingQueuedId={state.editingQueuedId}
              vscode={vscode}
            />
          </div>

          <div
            style={{
              display:
                state.pendingConfirmations.length === 0 ? "block" : "none",
            }}
          >
            <MessageInput
              ref={messageInputRef}
              onSendMessage={handleSendMessage}
              isStreaming={state.isStreaming}
              onAbortMessage={handleAbortMessage}
              onSubmitQueuedEdit={handleSubmitQueuedEdit}
              editingQueuedId={state.editingQueuedId}
              onCancelQueuedEdit={handleCancelQueuedEdit}
              shouldClearInput={state.shouldClearInput}
              onInputCleared={handleInputCleared}
              vscode={vscode}
              selection={state.selection}
              inputContent={state.inputContent}
              sessionId={state.currentSession?.id}
              permissionMode={state.permissionMode}
              initialAttachedImages={state.attachedImages}
              paneId={paneId}
              contextUsage={contextUsage}
              showContextUsage={hasVisibleMessages}
              disabled={host?.type === "desktop" && !effectiveWorkdir}
              workdirSelector={
                host?.type === "desktop" && !hasVisibleMessages ? (
                  <>
                    <DesktopHostSelector
                      host={effectiveHost}
                      hosts={host.hosts}
                      onSelectHost={host.onSelectHost}
                      onAddHost={host.onAddHost}
                    />
                    <DesktopWorkdirSelector
                      host={effectiveHost}
                      workdir={pickerWorkdir}
                      recentWorkdirs={host.recentWorkdirs}
                      onSelectWorkdir={host.onSelectWorkdir}
                      onSelectRemotePath={(path) =>
                        host.onSelectRemotePath(path, effectiveHost)
                      }
                      onListRemoteDir={(path, requestId) =>
                        host.onListRemoteDir(path, effectiveHost, requestId)
                      }
                      onSelectRecentWorkdir={host.onSelectRecentWorkdir}
                      onRemoveRecentWorkdir={host.onRemoveRecentWorkdir}
                    />
                    {pickerWorkdir && (gitBranches || branchesLoading) && (
                      <DesktopWorktreeControls
                        branches={gitBranches?.branches ?? []}
                        branch={worktreeBranch || gitBranches?.current || ""}
                        worktreeChecked={worktreeChecked}
                        creating={worktreeCreating}
                        loading={!gitBranches && branchesLoading}
                        onBranchChange={setWorktreeBranch}
                        onWorktreeChange={setWorktreeChecked}
                      />
                    )}
                  </>
                ) : undefined
              }
              rewindPopup={
                <RewindPopup
                  isVisible={rewindPopupOpen}
                  isLoading={rewindCheckpointsLoading}
                  checkpoints={rewindCheckpoints}
                  onSelect={handleRewindCheckpointSelect}
                  onClose={handleRewindPopupClose}
                />
              }
              modelPopup={
                <ModelPopup
                  isVisible={modelPopupOpen}
                  isLoading={modelLoading}
                  models={configuredModels}
                  currentModel={currentModel}
                  onSelect={handleModelSelect}
                  onClose={handleModelPopupClose}
                />
              }
              btwPopup={
                btwPanel ? (
                  <BtwPanel
                    question={btwPanel.question}
                    answer={btwPanel.answer}
                    isLoading={btwPanel.loading}
                    onClose={handleBtwClose}
                  />
                ) : undefined
              }
            />
          </div>

          {state.pendingConfirmations.length > 0 && (
            <ConfirmationDialog
              key={state.pendingConfirmations[0].confirmationId}
              data-confirmation-id={
                state.pendingConfirmations[0].confirmationId
              }
              confirmation={state.pendingConfirmations[0]}
              onConfirm={handleConfirmation}
              onReject={handleRejection}
            />
          )}
        </div>
      ) : null}
    </>
  );

  // Batch 2 settings full-page (desktop): rendered in place of chatContainer
  // when settingsOpen. The board and settings are mutually exclusive (opening
  // one closes the other, see handleOpenSessionBoard).
  const settingsPage = isDesktop ? (
    <SettingsPage
      configurationData={state.configurationData ?? null}
      onSave={handleConfigurationSave}
      themeSource={themeSource}
      onThemeChange={(source) => {
        // 乐观更新本实例选中态；host 持久化后回广播 desktopThemeSource（幂等）。
        setThemeSource(source);
        postToHost({ command: "setThemeSource", source });
      }}
      onClose={handleCloseSettings}
      userAgentsContent={userAgentsContent}
      projectAgentsContent={projectAgentsContent}
      onLoadAgentsContent={(scope) =>
        vscode.postMessage({
          command: "getAgentsContent",
          scope,
          workdir: scope === "project" ? effectiveWorkdir : undefined,
        })
      }
      workdir={effectiveWorkdir}
      saving={state.configurationLoading}
      configurationError={state.configurationError}
      initialNav={settingsNav}
      vscode={vscode}
      projectSettings={state.projectSettings}
      onLoadProjectSettings={() =>
        postToHost({ command: "getProjectSettings" })
      }
      onToggleBuiltinPlugin={(pluginId, enabled) =>
        postToHost({
          command: "setBuiltinPluginEnabled",
          pluginId,
          enabled,
          scope: "project",
        })
      }
      onPrefillPrompt={handlePrefillPrompt}
      onOpenExternalFile={handleOpenFileExternal}
    />
  ) : null;

  // Batch 2 session board (desktop): rendered in place of chatContainer when
  // sessionBoardOpen. Clicking a card restores that session — workdir resolved
  // from the board's own group data so the host can route the switch.
  const sessionBoard = isDesktop ? (
    <SessionBoard
      groups={host?.sessionTree ?? []}
      onSelectSession={(sessionId) => {
        const group = (host?.sessionTree ?? []).find((g) =>
          g.sessions.some((s) => s.sessionId === sessionId),
        );
        const workdir = group?.workdir ?? host?.workdir;
        if (workdir) host?.onSelectSession(workdir, sessionId);
      }}
      onBack={handleCloseSessionBoard}
    />
  ) : null;

  // Dialogs render at the component root — not inside chatContainer — so they
  // stay visible in every layout, including the desktop split-view shell.
  const dialogs = (
    <>
      {state.activeDialog === "plugin" && (
        <PluginDialog vscode={vscode} onClose={handleDialogClose} />
      )}
      {state.activeDialog === "mcp" && (
        <McpDialog vscode={vscode} onClose={handleDialogClose} />
      )}
      {state.activeDialog === "status" && (
        <StatusDialog
          onClose={handleDialogClose}
          vscode={vscode}
          isDesktop={isDesktop}
        />
      )}
      {state.activeDialog === "tasks" && (
        <BackgroundTaskManager
          tasks={state.backgroundTasks}
          vscode={vscode}
          onClose={handleDialogClose}
        />
      )}
      {state.activeDialog === "workflows" && (
        <WorkflowManager
          runs={state.workflowRuns}
          vscode={vscode}
          onCancel={handleDialogClose}
        />
      )}
      {pendingRewindId && (
        <ConfirmDialog
          title="确定要回滚到此消息吗？"
          description="这将删除之后的所有消息并撤销相关的文件更改。"
          onConfirm={handleRewindConfirm}
          onCancel={() => setPendingRewindId(null)}
        />
      )}
      <ToastStack
        toasts={toasts}
        onDismiss={handleToastDismiss}
        onAction={handleToastAction}
      />
    </>
  );

  const chatContainer = (
    <div
      className={`chat-container${
        showWelcomeReady
          ? isDesktop
            ? " chat-container--welcome"
            : " chat-container--welcome-ide"
          : ""
      }${dragActive ? " drag-active" : ""}`}
      data-testid="chat-container"
      ref={isDesktop ? chatContainerRef : undefined}
      onDragEnter={isDesktop ? handleDragEnter : undefined}
      onDragOver={isDesktop ? handleDragOver : undefined}
      onDragLeave={isDesktop ? handleDragLeave : undefined}
      onDrop={isDesktop ? handleDrop : undefined}
    >
      {dragActive && (
        <div className="chat-drag-overlay" data-testid="chat-drag-overlay">
          <i className="codicon codicon-cloud-upload"></i>
          <span className="chat-drag-overlay-title">释放以上传文件</span>
          <span className="chat-drag-overlay-sub">
            支持多文件，上传到当前对话
          </span>
        </div>
      )}
      {queueEditWarning && (
        <div
          className="queue-edit-warning-banner"
          role="alert"
          data-testid="queue-edit-warning"
        >
          <span className="queue-edit-warning-text">{queueEditWarning}</span>
          <button
            className="queue-edit-warning-close"
            onClick={() => setQueueEditWarning(null)}
            aria-label="关闭"
          >
            <CloseIcon className="queue-edit-warning-close-icon" />
          </button>
        </div>
      )}
      <ChatHeader
        leading={
          paneId !== undefined
            ? collapsedLeading(sidebarExpandButton)
            : collapsedLeading(expandBtn)
        }
        onNewSession={handleClearChat}
        newSessionDisabled={state.isStreaming}
        onAbortMessage={handleAbortMessage}
        messages={state.messages}
        sessions={state.sessions}
        currentSession={state.currentSession}
        onSessionSelect={handleSessionSelect}
        sessionsLoading={state.sessionsLoading}
        onOpenSettings={handleOpenSettings}
        onOpenEnterpriseConsole={handleOpenEnterpriseConsole}
        onOpenHelpDocs={handleOpenHelpDocs}
        onLogin={handleLogin}
        onLogout={handleLogout}
        isAuthenticated={state.isAuthenticated}
        // Desktop: 会话新建/历史按钮回归 DesktopSidebar（revert #2021 移除
        // 聊天顶栏「历史对话」跨目录弹窗入口后，顶栏不再渲染会话按钮）。
        hideSessionButtons={isDesktop}
        hideMoreButton={isDesktop}
        panelToggle={
          isDesktop
            ? {
                expanded: panelExpanded,
                onToggle: handleTogglePanelExpanded,
              }
            : undefined
        }
        headerActions={headerActions}
      />
      {isDesktop ? (
        <div
          className={`desktop-chat-body${
            previewFullscreen ? " preview-fullscreen" : ""
          }`}
        >
          {!previewFullscreen && (
            <div className="desktop-chat-main">{chatBodyContent}</div>
          )}
          {panelExpanded || tabs.length > 0 ? (
            <div
              className="desktop-panel-slot"
              data-testid="desktop-panel-slot"
              style={{
                width: panelWidth,
                // Collapsed: keep the slot mounted (display:none) so preview
                // guests / terminal PTYs survive; the next expand restores it
                // instantly with tabs, active tab and width intact. When there
                // is nothing to keep mounted (no tabs) the slot is simply not
                // rendered above.
                display: panelExpanded ? undefined : "none",
              }}
            >
              {tabs.length > 0 ? (
                <>
                  <DesktopPanelTabs
                    tabs={tabs}
                    activeTabId={activeTabId}
                    disabled={panelDisabled}
                    onActivate={handleActivatePanel}
                    onClose={handleCloseTab}
                    onAdd={tryOpenPanel}
                    fullscreen={previewFullscreen}
                    onToggleFullscreen={() => setPreviewFullscreen((v) => !v)}
                  />
                  <div className="desktop-panel-body">
                    {tabs.map((tab) => (
                      <div
                        key={tab.id}
                        className="desktop-panel-stack"
                        style={{
                          display: activeTabId === tab.id ? undefined : "none",
                        }}
                      >
                        {renderPanelSlot(tab)}
                      </div>
                    ))}
                  </div>
                </>
              ) : (
                <PanelEmptyState
                  disabled={panelDisabled}
                  onOpen={tryOpenPanel}
                />
              )}
            </div>
          ) : null}
        </div>
      ) : (
        // IDE hosts: the chat body always renders inside two flex wrappers.
        // Outside the welcome page they are plain flex-column pass-throughs
        // (layout equivalent to the old flat fragment); on the welcome page the
        // CSS switches them to group-centering (brand + input card together,
        // same as the desktop welcome scene). The wrappers are always present
        // so entering/leaving the welcome page never unmounts the input card
        // (e.g. the abort button must survive clearing the chat while
        // streaming).
        <div className="ide-chat-wrap">
          <div className="ide-chat-main">{chatBodyContent}</div>
        </div>
      )}
    </div>
  );

  if (host?.type === "desktop") {
    // FR-032 split-view: when the host has pushed a pane layout, DesktopShell
    // owns the row of paneId-scoped ChatApp instances. This instance then only
    // contributes its pane-scoped chatContainer (rendered below); without a
    // paneId it would double-render, so bail out to the shell instead.
    if ((host.panes?.length ?? 0) > 0 && paneId === undefined) {
      return (
        <>
          <DesktopShell
            vscode={vscode}
            host={host}
            onOpenSettings={handleOpenSettings}
            onOpenEnterpriseConsole={handleOpenEnterpriseConsole}
            onOpenHelpDocs={handleOpenHelpDocs}
            onLogin={handleLogin}
            onLogout={handleLogout}
            onDownloadUpdate={handleDownloadUpdate}
            onRestartApp={handleRestartApp}
            account={accountInfo}
            sidebarExpandButton={expandBtn}
            collapsed={sidebarCollapsed}
            onCollapsedChange={handleSidebarCollapsedChange}
            settingsOpen={settingsOpen}
            onCloseSettings={handleCloseSettings}
            sessionBoardOpen={sessionBoardOpen}
            onCloseSessionBoard={handleCloseSessionBoard}
            settingsPage={settingsPage}
            sessionBoard={sessionBoard}
            sessionBoardActive={sessionBoardOpen}
            onOpenSessionBoard={handleOpenSessionBoard}
          />
          {dialogs}
        </>
      );
    }
    // Inside DesktopShell each pane renders only its own chatContainer; the
    // sidebar / preview pane live in the shell / single-pane layout.
    if (paneId !== undefined) {
      return (
        <>
          {chatContainer}
          {dialogs}
        </>
      );
    }
    return (
      <div className="desktop-layout">
        <DesktopSidebar
          onNewSession={handleDesktopNewSession}
          onNewSessionInPane={() =>
            postToHost({ command: "desktopNewSessionInPane" })
          }
          isStreaming={state.isStreaming}
          disabled={!host.workdir}
          onOpenSettings={handleOpenSettings}
          onOpenEnterpriseConsole={handleOpenEnterpriseConsole}
          onOpenHelpDocs={handleOpenHelpDocs}
          onLogin={handleLogin}
          onLogout={handleLogout}
          onDownloadUpdate={handleDownloadUpdate}
          onRestartApp={handleRestartApp}
          account={accountInfo}
          hostLabel={effectiveHost}
          sessionTree={host.sessionTree}
          currentSessionId={state.currentSession?.id}
          onSelectSession={host.onSelectSession}
          onOpenPane={host.onOpenPane}
          onDeleteSession={host.onDeleteSession}
          collapsed={sidebarCollapsed}
          onCollapsedChange={handleSidebarCollapsedChange}
          sessionBoardActive={sessionBoardOpen}
          onOpenSessionBoard={handleOpenSessionBoard}
        />
        {settingsOpen
          ? settingsPage
          : sessionBoardOpen
            ? sessionBoard
            : chatContainer}
        {dialogs}
      </div>
    );
  }

  return (
    <>
      {chatContainer}
      {dialogs}
    </>
  );
};
