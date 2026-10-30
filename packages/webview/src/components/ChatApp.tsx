import React, {
  useEffect,
  useReducer,
  useCallback,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
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
import { ToastStack } from "./ToastStack";
import { BtwPanel } from "./BtwPanel";
import McpDialog from "./McpDialog";
import StatusDialog from "./StatusDialog";
import BackgroundTaskManager from "./BackgroundTaskManager";
import WorkflowManager from "./WorkflowManager";
import RemoteNewSessionDialog from "./RemoteNewSessionDialog";
import RemoteSessionListPage from "./RemoteSessionListPage";
import WelcomeView from "./WelcomeView";
import QuickStartTemplates from "./QuickStartTemplates";
import LoadingLogo from "./LoadingLogo";
import { SidebarExpandIcon, CloseIcon } from "./HeaderIcons";
import { useDesktopChrome } from "./DesktopChromeContext";
import { useHostMessage } from "../utils/useHostMessage";
import { useSessionRename } from "../utils/useSessionRename";
import { DesktopHostSelector } from "./DesktopHostSelector";
import { DesktopShell } from "./DesktopShell";
import type { AccountCardAccount } from "./AccountCard";
import SettingsPage from "./SettingsPage";
import type { NavKey } from "./SettingsPage";
import { SessionBoard } from "./SessionBoard";
import { SessionListPopup } from "./SessionListPopup";
import type { SessionMetadata } from "wave-agent-sdk/types";
import { PluginMarketPage } from "./PluginMarketPage";
import { ArtifactsPage } from "./ArtifactsPage";
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
  BackgroundTaskSummary,
  ChatAppProps,
  ConfirmationDecision,
  ConfirmationRequest,
  ConfigurationData,
  DesktopPanelKind,
  FileViewState,
  OpenFileTab,
  PanelTab,
  PrefillDraftRequest,
  PushNotificationControl,
  ThemeSource,
  ToastKind,
  ToolBlock,
  ToolBlockUpdateCallbackParams,
  UpdateChannel,
  UpdateToast,
} from "../types";
import { EXIT_PLAN_MODE_TOOL_NAME } from "wave-agent-sdk/constants";
// Type-only, borrowed the same way types/index.ts does it: the four facts are
// part of the host → webview contract (fixtures defines `PushState`), and the
// import is erased so nothing runtime-bound survives.
import type { ConfiguredModel, PushState } from "wave-webview-fixtures";
import { collectWriteEditBlocks, pathsMatch } from "../utils/fileAutoRefresh";
import {
  activeFileOf,
  allOpenFiles,
  openFilesOf,
  patchOpenFile,
  patchOpenFileByPath,
} from "../utils/fileTabs";
import { collectConversationFiles } from "../utils/conversationFiles";
import {
  askDiscardUnsavedDraft,
  isFileViewDirty,
  registerDraftSource,
  setDiscardAsker,
} from "../utils/fileDraftGuard";
import { toAbsoluteFilePath } from "../utils/messageUtils";
import { isMacHiddenTitlebar, isRemotePageHost } from "../utils/platform";
import { chatReducer, initialState } from "../reducers/chatReducer";
import {
  sessionUi,
  PANEL_DEFAULT_WIDTH,
  FILE_TREE_DEFAULT_WIDTH,
} from "../utils/sessionUiStore";
import type {
  SessionUiState,
  RemoteForwardRef,
  DiffSelection,
  BtwPanelState,
} from "../utils/sessionUiStore";
import {
  parkGroup,
  parkedGroupsFor,
  releaseParkedGroups,
  reportLiveGuests,
  subscribeParkedGroups,
  unparkGroup,
} from "../utils/previewGuestKeep";
import "../styles/ChatApp.css";

/** Chinese names shown in the panel tabs / space hints. */
export const PANEL_LABELS: Record<DesktopPanelKind, string> = {
  preview: "预览",
  plan: "计划",
  diff: "差异",
  terminal: "终端",
  file: "文件",
};
// 上翻时锚点在转录里失效了（rewind / 截断）之后，换下一个已加载 id 重试的次数上限。
// 三次足够跳过「被裁掉的那几条」，又不至于把一次坏锚点变成一个请求风暴。
const EARLIER_ANCHOR_RETRY_LIMIT = 3;

/** 右侧面板（含空态）的最小宽度：拖拽下限、自动分栏下限、开面板空间守卫共用。
    设计师 2026-10-30 评论 `div.desktop-panel-empty`「这页的最小宽度可以再窄一些，
    186px 我看下效果」，随后又定「副标题不折行，202px」——原值 320。
    202 = 副标题 13px 文字自然宽 169 + 左右内衬 32 + 左边框 1，正好一行放下；
    201 就会折成两行（实测内容盒 168 < 169）。
    ⚠️ 空态入口的容器查询断点是 307（内容盒），202 时内容盒 169 仍在单列区间。 */
const PANEL_MIN_WIDTH = 202;
/** The conversation (message) area never shrinks below this when opening/dragging panels. */
const CHAT_MAIN_MIN_WIDTH = 360;
// A slot the user never dragged splits the row 40% conversation / 60% panel
// (spec desktop-right-panel.md「右侧面板 · 展开/折叠、空间守卫与欢迎页共存」场景 7-9,
// 2026-09-09 拍板替代 2026-09-03 的「对话列恒 360、面板铺满剩余」语义): the
// conversation takes round(40% × row), floored at CHAT_MAIN_MIN_WIDTH, and the
// slot gets the remainder. On rows ≥ 900px the 40% share clears the 360 floor
// and the conversation widens past it; narrower rows keep the 360 floor.
const AUTO_CHAT_ROW_RATIO = 0.4;

/**
 * Delay before the branch-selector/worktree-checkbox loading placeholder shows
 * while a branch query is in flight (desktop-sessions.md「基于分支的 worktree
 * 隔离会话」场景 7/8 + desktop-remote.md「SSH 远程主机」场景 25). A remote host's first query has
 * to stand up an SSH tunnel and the remote daemon (seconds), so the wait needs
 * visible feedback instead of the controls silently vanishing; a local reply
 * lands far below this threshold, so the placeholder never flashes on quick
 * switches.
 */
export const BRANCH_LIST_LOADING_DELAY_MS = 300;

/**
 * Coalescing window for `desktopReportMessageStats` — the renderer telling the
 * desktop host how much conversation it is holding for the memory curve
 * (memorySampler.ts samples once a minute). Streaming changes the list on every
 * delta, so the window folds those bursts into one report carrying the latest
 * count.
 */
const MESSAGE_STATS_REPORT_INTERVAL_MS = 5000;

/**
 * 新会话状态：列表里没有可见消息（隐藏的 meta 消息不计）**且**宿主没说过这条
 * 会话已经产生过消息。空列表只是必要条件——`/rewind` 回到第一条、`/clear` 都会
 * 把已有会话的列表清空，那两处仍然不是新会话（发送要续在原会话里，目录/host/
 * worktree 三组选择器也要收起）。`hasContent` 缺失（老宿主不下发）退回旧判据。
 */
const isNewSessionState = (
  hasContent: boolean | undefined,
  messages: ReadonlyArray<{ role?: unknown; isMeta?: boolean }>,
): boolean =>
  hasContent !== true &&
  !messages.some((m) => !(m.role === "user" && m.isMeta));

/** Panel width for a never-dragged slot in a `containerW`-wide row. */
const autoPanelWidth = (containerW: number): number => {
  const conversation = Math.max(
    CHAT_MAIN_MIN_WIDTH,
    Math.round(containerW * AUTO_CHAT_ROW_RATIO),
  );
  return Math.max(PANEL_MIN_WIDTH, containerW - conversation);
};

/**
 * Any background task (shell / subagent / workflow) still running in the
 * current session. While one is active, IDE in-place session switches
 * (clearChat「新建对话」/ `/clear`, restoreSession「加载历史」) are blocked —
 * spec session-management.md「IDE 插件聊天头部」场景 6/7. Desktop's parallel
 * session model doesn't apply.
 */
const hasRunningBackgroundTask = (tasks: BackgroundTaskSummary[]): boolean =>
  tasks.some((t) => t.status === "running");

/**
 * 一个流式分片折进 /btw 面板（spec commands/btw-command.md 场景 6）：思考分片先
 * 累积着实时显示，首个 content 分片一到就丢掉思考阶段累积的文本、只留内容（用户
 * 决定：思考阶段结束后不再显示思考内容）。
 */
function applyBtwChunk(
  panel: BtwPanelState,
  content: string,
  type?: string,
): BtwPanelState {
  if (type === "content") {
    const base = panel.contentStarted ? panel.answer : "";
    return { ...panel, contentStarted: true, answer: base + content };
  }
  if (panel.contentStarted) return panel;
  return { ...panel, answer: panel.answer + content };
}

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

// Panel-group snapshot storage (per session) moved to utils/sessionUiStore —
// the unified session-UI-state store (存取/迁移/失效一套代码). ChatApp keeps
// the React 编排 (useState mirror + swap/sync effects below); tests import
// prunePanelGroupCache from here for backward compatibility.
export { prunePanelGroupCache } from "../utils/sessionUiStore";

/**
 * Desktop sidebar collapsed → the leftmost chat header shows this expand button
 * (spec 「侧边栏收起/展开」scenario 4). Built by every instance that occupies the
 * window's left edge — the root single layout or the first top-row pane — from
 * the window-level sidebarCollapsed (DesktopChromeContext).
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
  firstPane,
  headerActions,
  onOpenSettingsFromPane,
  onOpenPluginMarketFromPane,
  prefillRequest,
  onPrefillApplied,
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
  // 服务地址（企业控制台 / 帮助文档 / Beta 开关可用性）——由宿主的
  // `authStatusResponse.serverUrl` 驱动（CLI 侧 getAuthStatus 解析，配置回包
  // 不再携带它）。空串 = 宿主尚未下发。
  const [serverUrl, setServerUrl] = useState("");
  // 窗口级 chrome 状态（侧边栏收起 + macOS 全屏）单一权威在 DesktopChromeContext
  //（DesktopApp 根提供）：root 单布局 / DesktopShell pane 各实例同源读取，不再
  // 各自持有副本或 props 下行（见 DesktopChromeContext.tsx 头注释）。
  const { sidebarCollapsed, setSidebarCollapsed, fullScreen } =
    useDesktopChrome();
  // Message id awaiting rewind confirmation; non-null shows the ConfirmDialog.
  const [pendingRewindId, setPendingRewindId] = useState<string | null>(null);
  // 「放弃未保存的修改？」（spec desktop-file-panel.md「文件面板内编辑与保存」场景
  // 5/6）：对话框只由窗口根的实例渲染（与 showToast 同一条口径，多分屏不叠层），
  // 但发起方既可能是某个 pane（取消编辑、换文件、关 tab），也可能是窗口 chrome
  // （换会话 / 换工作目录）。两端通过 utils/fileDraftGuard 的 asker 接头，答案回
  // 到同一个 Promise。
  const draftDiscardResolversRef = useRef<Array<(ok: boolean) => void>>([]);
  const [draftDiscardOpen, setDraftDiscardOpen] = useState(false);
  // In-flight rewind requests, keyed by requestId. The host answers with a
  // `rewindResult` (no payload) and the webview cuts its own list, so a reply
  // that arrives late — or for a rewind already superseded — must not touch the
  // current list (same shape as useSessionRename's pending map).
  const pendingRewindsRef = useRef(new Map<string, string>());
  // 远控页的两道「写操作」确认（第二批解禁，spec「页面能执行的那批宿主命令」）：
  // `/clear` 会把电脑侧那条会话换绑成新的 sessionId（并跑 Session hooks），底栏
  // 切换模型（`setModel`）写的是**用户级** `~/.wave/settings.json`——两者在手机上
  // 都不是「只影响这一页」的动作，所以远端各问一次。IDE 端与桌面端不变：它们的
  // `/clear` 早就没有确认、切换模型也没有（改动只在一处 UI，不动那两端的既有手感）。
  const [pendingClearConfirm, setPendingClearConfirm] = useState(false);
  const [pendingModelSwitch, setPendingModelSwitch] = useState<string | null>(
    null,
  );
  // 插件变更待应用（spec ecosystem/plugin.md「插件变更提示」，2026-09-23 起）：
  // 桌面端宿主把「落盘了但没生效」发成一条 `pluginChangePending`，这里弹一个**强
  // 引导**确认框——原先只有顶部一句轻提示，用户会直接忽略，插件装完不运行
  // `/reload-plugins` 就不生效。点「立即重新加载」回发既有的 `reloadPlugins`
  // 命令（与斜杠命令同一条就地重载路径），结果提示由宿主发出。
  const [pluginChangePending, setPluginChangePending] = useState(false);
  // /rewind popup: checkpoint list requested from the host on open.
  const [rewindPopupOpen, setRewindPopupOpen] = useState(false);
  const [rewindCheckpoints, setRewindCheckpoints] = useState<
    RewindCheckpoint[]
  >([]);
  const [rewindCheckpointsLoading, setRewindCheckpointsLoading] =
    useState(false);
  // 模型选择器（spec ui/model-selection.md「输入卡片底栏切换模型」）：会话一变就
  // 向宿主拉一次清单 + 当前模型（宿主从 settings/env 解析链给出，本地不写死），
  // 底栏按钮才有东西可显示。
  const [configuredModels, setConfiguredModels] = useState<ConfiguredModel[]>(
    [],
  );
  const [currentModel, setCurrentModel] = useState<string | undefined>(
    undefined,
  );
  // 设置页「补全模型」下拉只要名字（它的候选与对话模型同源）。
  const configuredModelNames = useMemo(
    () => configuredModels.map((m) => m.name),
    [configuredModels],
  );
  // /resume picker. IDE hosts reuse the header popup and its list
  // (state.sessions); the desktop opens a centered modal fed by the host's
  // on-disk session scan of the current conversation's host, which is what
  // makes CLI-created sessions reachable (they are not in the desktop index).
  const [resumePickerOpen, setResumePickerOpen] = useState(false);
  // 远控页的「会话」整页列表（spec remote/remote-web.md「手机端的会话列表与删除」）。
  // 只有那一端会置 true——IDE / 桌面端的入口仍是各自的会话面（下拉 / 侧栏），
  // 它们连这个开关都不会碰。
  const [sessionPageOpen, setSessionPageOpen] = useState(false);
  const [resumeSessions, setResumeSessions] = useState<SessionMetadata[]>([]);
  const [resumeLoading, setResumeLoading] = useState(false);
  // One-shot scan correlation: a stale reply (host switched, /resume pressed
  // again) must not populate the picker.
  const resumeRequestIdRef = useRef("");
  // Session whose context-usage percentage contextUsage currently holds. Kept
  // in sync synchronously by the setInitialState / updateCurrentSession message
  // handlers (not by a passive effect — see the race note at those handlers).
  const usageSessionRef = useRef<string | undefined>(undefined);
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
  // 「先指定文件夹」引导气泡（desktop 新会话、尚未选目录时）：从 CodeWave 高码
  // 应用唤起 IDE 后用户不知道要先选文件夹才能提问。点「×」后本会话内不再出现；
  // 选到目录后由 effectiveWorkdir 非空自动收回（见 workdirSelector 的 guide 传参）。
  const [workdirGuideDismissed, setWorkdirGuideDismissed] = useState(false);
  // Per-pane git branches for this pane's OWN workdir (FR-022). The host-level
  // workdir follows the focused pane — sharing it would bleed one pane's
  // directory/branch into a sibling new-session pane, so each new-session pane
  // queries branches against its own session workdir. The result is keyed by
  // the workdir it was queried for: a reply that lands after the user has
  // switched to another directory never matches the current pickerWorkdir, so
  // a previous repo's branch state can't flash over the new directory while
  // the fresh branch list is still in flight.
  const [paneGitBranches, setPaneGitBranches] = useState<{
    workdir: string;
    branches: string[];
    current: string;
  } | null>(null);
  // Per-pane branch-query status: which workdir is being queried and whether
  // the loading placeholder is due to show. `loading` only flips true after
  // BRANCH_LIST_LOADING_DELAY_MS (the query still has no reply), so a fast
  // local reply never renders a placeholder while a slow remote one does
  // (desktop-sessions.md 场景 7/8/25). Cleared by the reply for this workdir.
  const [paneBranchesQuery, setPaneBranchesQuery] = useState<{
    workdir: string;
    loading: boolean;
  } | null>(null);
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
  // Desktop settings full-page 的「当前项目」：设置页挂在 root 实例（paneId
  // undefined，无自己会话），其当前项目 = 聚焦 pane 的会话目录，host 以
  // desktopWorkdirState.workdir（= desktopHost this.workdir，每次聚焦/激活更新）
  // 权威推送。不能复用 effectiveWorkdir：它把窗口 recents 头优先于 host.workdir
  // （该回退专为新会话 pane 防兄弟 pane 路径渗入而写）——recents 头 ≠ 当前聚焦
  // 会话的项目时（恢复历史会话不写 recents），以 recents 头作「当前项目」会把
  // host 按聚焦 pane 解析并回发的项目设置（workdir 归属键=聚焦 pane）当过期回复
  // 丢弃，开关恒显另一项目的旧快照（与 PR #2152 AGENTS.md 同族：webview 端
  // 「当前项目」身份取错）。pane 实例（有自己会话/新建会话）维持 effectiveWorkdir。
  const settingsWorkdir =
    paneId === undefined && host?.type === "desktop"
      ? (host?.workdir ?? host?.recentWorkdirs?.[0])
      : effectiveWorkdir;
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
  // 文件面板列表态的数据（spec desktop-file-panel.md「文件面板列出当前对话的文
  // 件」）：本对话读过/写过的文件，从消息流派生——宿主没有「本对话涉及的文件」
  // 这条数据，派生也就顺带让它对远程会话与所有宿主都成立。IDE 宿主没有该面板，
  // 跳过这道全景扫描（与 fileAutoRefresh 那道 effect 同一个开销量级）。
  const conversationFiles = useMemo(
    () =>
      isDesktop
        ? collectConversationFiles(state.messages, effectiveWorkdir)
        : [],
    [isDesktop, state.messages, effectiveWorkdir],
  );
  // The remote-control Web page (spec remote-control「Web 页作为第五种宿主」):
  // the shim sets `window.waveRemotePage` — the same flag the remote-control
  // settings view reads to skip drawing the QR it is itself the target of. That
  // page hides the new/history buttons like the desktop does and gets one entry
  // of its own: the sessions the serving process holds right now, which is all
  // it can open.
  //
  // It is also the host every guard in this file is about: rendering the IDE
  // branch buys it the IDE's UI, but not the IDE's capabilities (no editor, no
  // settings tab, no plugin manager, no local host to route a command to), so
  // the entries below that can only fail there are not rendered at all
  // (spec remote/remote-web.md 场景 21).
  const isRemotePage = isRemotePageHost();
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
  // 见 handlePrefillPrompt）。无 pane 单布局 targetPaneId 为空、由本实例 effect
  // 直接写本地输入框；pane 布局（FR-032）targetPaneId = 点击瞬间的 focused pane，
  // 请求经 DesktopShell 下行给该 pane 的 ChatApp 写回（prefillRequest prop）。
  // 内部状态名 pendingPrefill 与 prefillRequest prop（pane ChatApp 收到的下行
  // 请求）区分——root 自己发请求、pane-scoped 实例收请求。
  const [pendingPrefill, setPendingPrefill] =
    useState<PrefillDraftRequest | null>(null);
  // 每次「新建/编辑」点击递增，作 pane ChatApp effect 识别「新请求」的 nonce。
  const prefillNonceRef = useRef(0);
  // prefill 请求附带的 openFile 打开动作（编辑配置：会话视图右侧文件面板）。
  // 两个 prefill 应用 effect 位于 handleOpenFile 定义之前（组件体后部 const 有
  // TDZ），经 ref 调用最新实现绕开声明顺序（同下方 togglePanelRef 模式）。
  const openFileRef = useRef<(path: string) => void>(() => {});
  const [sessionBoardOpen, setSessionBoardOpen] = useState(false);
  // 插件市场整页（spec ecosystem/plugin.md「插件市场」场景 1/2）：侧边栏入口打开的
  // 整页视图，同为「后开者优先」——与设置页、会话状态看板互斥。
  const [pluginMarketOpen, setPluginMarketOpen] = useState(false);
  // 创作集整页（spec desktop/desktop-artifacts.md）：与插件市场同为账号级整页，
  // 两者互斥（同一时刻只覆盖 pane 行一次）。
  const [artifactsOpen, setArtifactsOpen] = useState(false);
  // 桌面端主题偏好（host 为真源）：**只**由未打标签的窗口级广播
  // desktopThemeSource 驱动（启动时 host 会随其它窗口级状态推一次）。曾经的
  // setInitialState.theme 副本已删除——那是 pane 作用域消息，而渲染设置页的是
  // root 实例（分屏 rows 可见时不消费带 paneId 的消息），重启后选中项因此回落。
  // VSCE/JetBrains 无此偏好，恒为默认 "system" 且不渲染主题行。
  const [themeSource, setThemeSource] = useState<ThemeSource>("system");
  // 桌面端更新通道（host 为真源）：同上，只由窗口级广播 desktopUpdateChannel
  // 驱动（见「接收 Beta 版更新」开关重启后回落的修复）。VSCE/JetBrains 无此
  // 字段，恒为默认 "stable" 且不渲染开关行。
  const [updateChannel, setUpdateChannel] = useState<UpdateChannel>("stable");
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
  // AGENTS.md 保存进行中（设置「个性化」视图）：点击保存置 pending，host 回发
  // agentsContentSaved 后落定以复位按钮/文本区禁用；保存结果 toast 由宿主发出。
  const [agentsSaving, setAgentsSaving] = useState(false);
  // 该实例是否占据窗口最左侧（其顶栏需承载「侧边栏收起 → 展开按钮 + 红绿灯让
  // 该实例是否占据窗口最左侧（其顶栏需承载「侧边栏收起 → 展开按钮 + 红绿灯让
  // 位段」）：root 单布局（paneId undefined），或 DesktopShell 首行首 pane
  //（firstPane 由 shell 显式标记）。身份与收起状态都同源于 context —— 运行期
  // 收起/展开（含全屏让位）即时反映，不再有 pane 快照过期的问题。
  const isLeftmostChatHeader = paneId === undefined || firstPane === true;
  const expandBtn =
    sidebarCollapsed && isLeftmostChatHeader ? (
      <SidebarExpandButton onClick={() => setSidebarCollapsed(false)} />
    ) : null;
  // 收起态 header leading：展开侧边栏 + 分割线（评论 2026-09：header 里的
  // 「新建对话」图标钮与功能已拿掉——展开后该入口在侧边栏/新会话处提供）。
  // 单 pane（root）与分屏第一 pane 共用；`expand` 为 null（侧边栏展开）时不
  // 渲染整组。
  const collapsedLeading = (expand: React.ReactNode) =>
    expand ? (
      <div className="header-collapsed-leading">
        {expand}
        <span className="header-collapsed-divider" />
      </div>
    ) : null;
  // macOS 隐藏标题栏 + 侧边栏收起：最左侧顶栏的收起态 leading 正处于窗口左上角
  // 系统红绿灯的落位，让出一段 76px 拖拽区（spec「macOS 隐藏标题栏」场景 3）。
  // 让位与展开按钮同源（上面同一条件），展开按钮不会压在红绿灯上。
  const macTrafficSpacer =
    isMacHiddenTitlebar() &&
    sidebarCollapsed &&
    isLeftmostChatHeader &&
    !fullScreen;
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
  // 文件面板目录树的根、差异面板的数据源 = 会话的**工作根**（`.wave/rules/
  // workdir.md`）：起点是会话打开时的目录，agent 用 EnterWorktree 切进工作树时
  // 随之切换、ExitWorktree 切回；而 Bash 里 `cd` 只挪「相对路径基准」，不该让用户
  // 眼前的面板换项目。宿主在 desktopPanes 里下发 `workspaceRoot`（老宿主没有该
  // 字段时退回 `sessionCwd`），`currentWorkdir` 不参与。
  const paneForRoot = paneId
    ? host?.panes?.find((p) => p.paneId === paneId)
    : undefined;
  const workspaceRootForPane =
    paneForRoot?.workspaceRoot ?? paneForRoot?.sessionCwd ?? effectiveWorkdir;
  // Branch info only "exists" when it was fetched FOR the currently displayed
  // workdir. During a workdir switch — and before the first reply for the new
  // directory lands — this is null, so the branch/worktree controls stay
  // hidden until the fresh reply confirms the new directory is a git repo. The
  // check happens at render time (not by clearing state in an effect), so not
  // even a single intermediate frame can show the previous repo's branch state
  // (e.g. "main") next to a directory that isn't a git repo.
  const gitBranches =
    isDesktop && paneGitBranches?.workdir === pickerWorkdir
      ? paneGitBranches
      : null;
  // Loading placeholder for the branch/worktree controls: only once the delay
  // has elapsed for the CURRENT picker workdir (never a stale one — the query
  // status is scoped by workdir exactly like gitBranches above).
  const branchesLoading =
    isDesktop &&
    !gitBranches &&
    paneBranchesQuery?.loading === true &&
    paneBranchesQuery.workdir === pickerWorkdir;
  const effectiveWorkdirRef = useRef(effectiveWorkdir);
  // Settings full-page 归属守卫用的「当前项目」镜像（root 实例与 host.workdir
  // 一致，见 settingsWorkdir 注释；pane 实例 == effectiveWorkdirRef）。
  const settingsWorkdirRef = useRef(settingsWorkdir);
  // Desktop only: the panel group follows the session bound to this pane. The
  // cache key is the session id from the host-authoritative `desktopPanes`
  // push, or the pane's new-session bucket while no session is bound.
  const boundSessionId = paneId
    ? host?.panes?.find((p) => p.paneId === paneId)?.sessionId
    : undefined;
  // Host-authoritative "has this pane's session ever produced a message"
  // (`desktopPanes` carries it). It is the only thing that separates a brand-new
  // session from an old one whose list happens to be empty — a `/rewind` back to
  // the first message or a `/clear` empties the list but leaves a running
  // session, and sending there must continue in that session (see the worktree
  // branch in handleSendMessage). undefined = an older host did not send it.
  const paneHasContent = paneId
    ? host?.panes?.find((p) => p.paneId === paneId)?.hasContent
    : undefined;
  const groupKey = paneId ? (boundSessionId ?? `new:${paneId}`) : undefined;
  const groupKeyRef = useRef(groupKey);
  const paneHasContentRef = useRef(paneHasContent);
  // Set when the user sends a message from this pane's new-session state. The
  // new-session bucket migrates to the session id only when that message binds
  // one — a sidebar switch to an existing session must not inherit the bucket.
  const sentFromNewSessionRef = useRef(false);
  // /btw side-question panel（spec commands/btw-command.md 场景 14）：面板属于
  // **发起它的那个对话**，切走只是隐去、切回来原样恢复（含还在跑的那条），所以
  // 状态存在会话快照里，本地只留一份镜像。归属键与面板组同源：桌面 pane 用
  // groupKey（绑定会话的 id，未绑定时 `new:<paneId>`）；IDE / 远控页没有 pane，
  // 用 currentSession.id。`btwStateKey` = 本地镜像当前反映的那个键，它比 btwKey
  // 晚一个提交——这正是下面回写 effect 里 `btwStateKey !== btwKeyRef.current`
  // 那道守卫要识别的那一个提交。
  const btwKey = groupKey ?? state.currentSession?.id;
  const [btwPanel, setBtwPanel] = useState<BtwPanelState | null>(
    () => (btwKey ? sessionUi.get(btwKey)?.btwPanel : undefined) ?? null,
  );
  const [btwStateKey, setBtwStateKey] = useState(btwKey);
  const btwKeyRef = useRef(btwKey);
  // Desktop remote sessions: port-forward failure shown in the empty-preview
  // stub with a retry entry (scenario 16). Null = no error. Restored from the
  // session's cached group so a pane rebinding away and back keeps the error.
  const [previewForwardError, setPreviewForwardError] = useState<string | null>(
    () =>
      (groupKey ? sessionUi.get(groupKey)?.forwardError : undefined) ?? null,
  );
  // Bumped when a re-acquire returns the SAME forwarded URL — the [url] effect
  // in PreviewPane would otherwise early-return and skip the forced reload a
  // retry after a guest load failure needs. Remounting restarts the webview.
  // 代号本身按会话组各存一份（见 guestEpochRef）；这个 state 只是「某组代号变了，
  // 需要重渲染」的信号，值不参与任何 React key。
  const [, setPreviewEpochTick] = useState(0);
  // preview guest 跨会话保活（spec desktop-right-panel.md「右侧面板 · preview guest
  // 跨会话保活」）：切走的会话组登记在窗口级台账（utils/previewGuestKeep.ts）里，
  // 它的 preview guest 继续挂在常驻层（见 previewGuestEntries /
  // .preview-guest-layer），只有真正关闭才销毁——关 tab、重置（epoch）、会话/分屏
  // 消失、超出保活额度。台账是模块级的（额度跨分屏共享），本实例订阅自己名下的
  // 条目；owner 让每个停靠 guest 只由一个 ChatApp 实例渲染。
  const guestOwnerRef = useRef<object>({});
  const retainedPreviewGroups = useSyncExternalStore(
    subscribeParkedGroups,
    () => parkedGroupsFor(guestOwnerRef.current),
  );
  // guest 条目的稳定次序：React 在同一父节点内重排 keyed 子节点会移动 <webview>
  // 的 DOM 节点（对 Electron 来说等于重新挂载 → guest 被销毁）。每个 key 只在
  // 首次出现时分配序号，之后永远按序号渲染。
  const guestOrderRef = useRef<Map<string, number>>(new Map());
  const guestSeqRef = useRef(0);
  // 每个会话组最后一次的 remount 代号（`guestEpochRef`）：只在该组自己的 guest
  // 需要重新加载时推进（本地 .html 同 URL 重新获取、远端转发重试）。停靠组必须
  // 记住自己的代号——否则当前组代号一变，停靠组的 React key 跟着变，切回来时
  // guest 被重新挂载（保活失效）。同理反向也不能污染：代号若只是一组全局计数，
  // A 组重试后切到 B 组，B 的 key 会从 0 抬到 1，保活中的 B 组 guest 被无谓重建。
  const guestEpochRef = useRef<Map<string, number>>(new Map());
  // Local .html preview (spec desktop-preview.md「本地 HTML 文件预览」):
  // in-flight desktopPreviewFile requests keyed by requestId, plus the source
  // path to fall back to (file panel) when the host replies with an error.
  const previewFileRequestsRef = useRef<
    Map<string, { tabId: string; path: string }>
  >(new Map());
  const pendingPreviewFallbackRef = useRef<Map<string, { path: string }>>(
    new Map(),
  );
  // Desktop only: the plan panel's latest ExitPlanMode markdown (null = no plan
  // yet). Per-session: approval/rejection keep the panel open, and pane
  // remounts restore it from the group cache. The plan tab is unique, so the
  // content stays a single per-conversation value rather than per-tab.
  const [planContent, setPlanContent] = useState<string | null>(
    () => (groupKey ? sessionUi.get(groupKey)?.planContent : undefined) ?? null,
  );
  // Desktop diff panel: sidebar (file tree + commit list) visibility and the
  // viewing range. Both are per-session (spec desktop-diff-panel.md「文件树与导航」
  // 场景 4 /「差异面板查看范围」场景 5), so they ride the sessionUi snapshot
  // alongside the panel tabs and are restored on a session switch.
  const [diffTreeVisible, setDiffTreeVisible] = useState<boolean>(
    () =>
      (groupKey ? sessionUi.get(groupKey)?.diffTreeVisible : undefined) ?? true,
  );
  // Desktop file panel: the workspace tree column's visibility and width, per
  // session like everything else in the panel group (spec desktop-file-panel.md
  // 「文件面板工作区目录树」). Restored on a session switch below.
  const [fileTreeVisible, setFileTreeVisible] = useState<boolean>(
    () =>
      (groupKey ? sessionUi.get(groupKey)?.fileTreeVisible : undefined) ?? true,
  );
  const [fileTreeWidth, setFileTreeWidth] = useState<number>(
    () =>
      (groupKey ? sessionUi.get(groupKey)?.fileTreeWidth : undefined) ??
      FILE_TREE_DEFAULT_WIDTH,
  );
  const [diffSelection, setDiffSelection] = useState<DiffSelection>(
    () =>
      (groupKey ? sessionUi.get(groupKey)?.diffSelection : undefined) ?? {
        kind: "all",
      },
  );
  // Desktop plan panel: the ExitPlanMode plan content a setInitialState replay
  // carried for a re-activated session, staged until the swap-effect ordering
  // settles (see the routing effect below). Null = nothing staged.
  const [planReplayContent, setPlanReplayContent] = useState<string | null>(
    null,
  );
  // The pane's current remote port forward (see RemoteForwardRef above). State
  // rather than a ref because a pane rebinding to another session must drop its
  // own current forward WITHOUT dropping the previous session's (the host
  // tunnels stay alive independently, scenario 18): the per-session references
  // live in the sessionUi store, this state only mirrors the bound session's one
  // for rendering the preview stub.
  const [currentForward, setCurrentForward] = useState<RemoteForwardRef | null>(
    () => (groupKey ? sessionUi.get(groupKey)?.forward : undefined) ?? null,
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
    () => (groupKey ? sessionUi.get(groupKey)?.checked : undefined) ?? [],
  );
  const tabsRef = useRef(tabs);
  tabsRef.current = tabs;
  // 文件面板的未保存草稿（spec desktop-file-panel.md「文件面板内编辑与保存」）：
  // 判定与丢弃都落在 tab 态上，声明在这里是因为「离开」的守卫散落在关闭 tab、
  // 打开另一个文件、换会话等既有回调里，它们都在调用时读最新的 tabsRef。
  // 草稿挂在每个已打开文件上（面板内多标签），所以「有没有未保存的修改」要扫
  // 全部文件而不是只看激活的那个。
  const hasDirtyDraft = useCallback(
    () =>
      allOpenFiles(tabsRef.current).some((f) => isFileViewDirty(f.fileView)),
    [],
  );
  const discardAllDrafts = useCallback(() => {
    setTabs((prev) =>
      prev.map((t) => {
        const files = openFilesOf(t);
        if (!files.some((f) => isFileViewDirty(f.fileView))) return t;
        return {
          ...t,
          openFiles: files.map((f) =>
            isFileViewDirty(f.fileView)
              ? {
                  ...f,
                  fileView: {
                    ...f.fileView!,
                    draft: undefined,
                    saving: undefined,
                    saveError: undefined,
                    diskChanged: undefined,
                  },
                }
              : f,
          ),
        };
      }),
    );
  }, []);
  // 当前 state（tabs/宽度/激活 tab…）属于哪个会话组。它必须是被 swap effect 与
  // setTabs 一起切换的 state，而不是 groupKey 或 groupKeyRef：`groupKey` 一到就
  // 是新会话的，`groupKeyRef.current` 在 swap effect 里即刻改写；两者都会在
  // 「state 还没换过去」的那一两个提交里先行变成新会话，于是快照写错组（把上一
  // 会话的 tabs 写进新会话的缓存）、guest 的 React key 抖动（<webview> 被重建，
  // 保活失效）。state 与 state 之间永远同步。
  const [stateGroupKey, setStateGroupKey] = useState<string | null>(
    groupKey ?? null,
  );
  // guest 的 key 必须跟「state 属于哪个组」走（stateGroupKey；理由见其声明处）：
  // 用 groupKey 或 groupKeyRef 都会在切换提交里让 key 从 `s1#x` 变成 `s2#x`，
  // React 于是把 <webview> 摘掉重建，保活前功尽弃。无 pane 的单栏布局没有会话
  // 键，用 "root" 占位（那里「切换会话」不重挂载 ChatApp，guest 一直在显示态）。
  const stateGuestGroup = stateGroupKey ?? groupKey ?? "root";
  // 重置「当前 state 所属会话组」的 preview guest（重挂载 = 真重新加载）。代号按组
  // 存，所以别的组（停靠保活中的 guest）不受影响；这也让「切回来还是同一个
  // <webview>」与「本组重试后真的重载」两件事同时成立。
  const bumpPreviewEpoch = useCallback(() => {
    guestEpochRef.current.set(
      stateGuestGroup,
      (guestEpochRef.current.get(stateGuestGroup) ?? 0) + 1,
    );
    setPreviewEpochTick((n) => n + 1);
  }, [stateGuestGroup]);
  // Desktop panel expand/collapse (spec desktop-right-panel.md「右侧面板 · 展开/折叠、
  // 空间守卫与欢迎页共存」): the header button
  // toggles whether the panel slot is visible. Collapsing only HIDES the slot —
  // the open tabs, their active tab and the dragged width all survive, and the
  // next expand restores them (「折叠/收起不影响面板内已打开的 tab 数量和状态，
  // 再次展开保留上次宽度并自动打开上一次查看的 tab」). The expanded/collapsed
  // state is remembered PER SESSION like the tabs and width (场景 10: 切走再切回
  // 保持折叠，不因还有 tab 而自动展开); a group with no cached entry yet starts
  // collapsed so the empty-state page only appears after an explicit expand.
  const [panelExpanded, setPanelExpanded] = useState<boolean>(() => {
    const cached = groupKey ? sessionUi.get(groupKey) : undefined;
    return cached
      ? (cached.panelExpanded ?? (cached.checked?.length ?? 0) > 0)
      : false;
  });
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
  // Per-open-file id source (f1, f2, …) for the file panel's own tab strip.
  // Restored ids are absorbed into it in the same effect as the tab ids.
  const openFileSeqRef = useRef(0);
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
    for (const t of current) {
      for (const f of openFilesOf(t)) {
        const m = /^f(\d+)$/.exec(f.id);
        if (m) {
          openFileSeqRef.current = Math.max(
            openFileSeqRef.current,
            Number(m[1]),
          );
        }
      }
    }
    // Intentional: only run when the session group key changes — the swap
    // effect above re-seeds `tabs` first, so re-running per tab tweak is
    // unnecessary (the max() absorption is idempotent anyway).
  }, [groupKey]);
  // Tabbed panels: one shared slot width for every panel type.
  const [panelWidth, setPanelWidth] = useState<number>(
    () =>
      (groupKey ? sessionUi.get(groupKey)?.panelWidth : undefined) ??
      PANEL_DEFAULT_WIDTH,
  );
  // True once the user manually dragged the slot width; a slot never dragged
  // auto-splits the row 40/60 again when it opens (see
  // PanelGroupState.panelWidthManual).
  const [panelWidthManual, setPanelWidthManual] = useState<boolean>(
    () =>
      (groupKey ? sessionUi.get(groupKey)?.panelWidthManual : undefined) ??
      false,
  );
  // The active panel tab id; null when no panel is open.
  const [activeTabId, setActiveTabId] = useState<string | null>(
    () => (groupKey ? sessionUi.get(groupKey)?.activePanel : undefined) ?? null,
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
  // 「这一轮还在跑」：全屏里的浮动对话框据此在「输入卡」与「正在工作」之间切换
  // （spec desktop-preview.md 场景 9）。生成与斜杠命令都算——用户从浮动框发出的
  // 两者都必须看得见「已经发出去了」。
  const turnRunning = state.isStreaming || state.isCommandRunning;
  const chatContainerRef = useRef<HTMLDivElement>(null);
  // The shared panel slot; its left-edge drag handle (rendered once on the slot,
  // see .panel-slot-drag-handle) anchors on this element's fixed right edge.
  const panelSlotRef = useRef<HTMLDivElement>(null);
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
  const panelWidthManualRef = useRef(panelWidthManual);
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
  // 「最近目录」那条请求的 requestId：回执只认最后一次问出去的那条。远控页每开
  // 一次弹窗问一次，两次点击挨得近时先后两条回执会乱序到达，陈旧的那条会把整份
  // 列表覆盖回旧值（它是整份快照，不是增量）。
  const recentWorkdirsRequestRef = useRef<string | undefined>(undefined);
  // The pane this instance renders; undefined = the root instance (sidebar +
  // shell). Ref mirror for use inside stable callbacks.
  const paneIdRef = useRef<string | undefined>(paneId);
  // Latest mirrors for the once-registered message listener: whether this root
  // instance currently renders the pane rows (vs. the settings page / session
  // board / plugin market full page, which replace the rows and unmount the pane
  // ChatApps).
  const rowsVisibleRef = useRef(
    !settingsOpen && !sessionBoardOpen && !pluginMarketOpen,
  );
  rowsVisibleRef.current =
    !settingsOpen && !sessionBoardOpen && !pluginMarketOpen && !artifactsOpen;

  // Keep stateRef in sync with state
  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  useEffect(() => {
    effectiveWorkdirRef.current = effectiveWorkdir;
  }, [effectiveWorkdir]);

  useEffect(() => {
    settingsWorkdirRef.current = settingsWorkdir;
  }, [settingsWorkdir]);

  useEffect(() => {
    effectiveHostRef.current = effectiveHost;
  }, [effectiveHost]);

  useEffect(() => {
    paneHasContentRef.current = paneHasContent;
  }, [paneHasContent]);

  useEffect(() => {
    planContentRef.current = planContent;
  }, [planContent]);

  useEffect(() => {
    panelWidthRef.current = panelWidth;
  }, [panelWidth]);

  useEffect(() => {
    panelWidthManualRef.current = panelWidthManual;
  }, [panelWidthManual]);

  // Cache the whole panel group under the current session so it survives this
  // ChatApp being unmounted/remounted (pane moved across window rows) and so a
  // later session switch can restore it. Skipped on the render where the key
  // flips — the swap effect below re-seeds the state from the new key first.
  useEffect(() => {
    if (!groupKey || groupKey !== stateGroupKey) return;
    const snapshot: SessionUiState = {
      checked: tabs,
      panelWidth,
      panelWidthManual,
      activePanel: activeTabId,
      panelExpanded,
      planContent,
      diffTreeVisible,
      fileTreeVisible,
      fileTreeWidth,
      diffSelection,
      forward: currentForward,
      forwardError: previewForwardError,
      btwPanel,
    };
    sessionUi.set(groupKey, snapshot);
  }, [
    groupKey,
    stateGroupKey,
    tabs,
    panelWidth,
    panelWidthManual,
    activeTabId,
    panelExpanded,
    planContent,
    diffTreeVisible,
    fileTreeVisible,
    fileTreeWidth,
    diffSelection,
    currentForward,
    previewForwardError,
    btwPanel,
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
    // First try the incoming session's own entry; when this switch is the
    // first message binding a session to a `new:<paneId>` bucket, that bucket
    // migrates to the session id (move) so the pre-send setup survives.
    let group = sessionUi.get(groupKey);
    if (
      !group &&
      prevKey?.startsWith("new:") &&
      !groupKey.startsWith("new:") &&
      sentFromNewSessionRef.current
    ) {
      group = sessionUi.move(prevKey, groupKey);
    }
    sentFromNewSessionRef.current = false;
    // Fullscreen belongs to the outgoing session's preview tab — switching
    // sessions must always exit it (a pane rebinding away would otherwise carry
    // a stale true over and hide the conversation column + panel slot for good;
    // PM bug 3465519197988352「预览全屏叉掉后对话框消失」). Switching is the
    // universal escape hatch even if a close path ever misses its own reset.
    setPreviewFullscreen(false);
    setPreviewForwardError(group?.forwardError ?? null);
    setCurrentForward(group?.forward ?? null);
    // 新会话的 tabs 一起换掉，stateGroupKey 必须跟着同一个批换（见其声明处）——
    // 慢一个批就会在中间那一个提交里「新组名 + 旧 tabs」。
    setStateGroupKey(groupKey);
    setTabs(group?.checked ?? []);
    setPanelWidth(group?.panelWidth ?? PANEL_DEFAULT_WIDTH);
    setPanelWidthManual(group?.panelWidthManual ?? false);
    // Expanded/collapsed is remembered per session like the tabs and width
    // (spec 场景 10) — a session the user collapsed keeps its slot hidden on
    // return even though its tabs are still open; a session without a cached
    // entry starts collapsed, the empty state needs an explicit expand.
    setPanelExpanded(group?.panelExpanded ?? (group?.checked?.length ?? 0) > 0);
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
    setDiffTreeVisible(group?.diffTreeVisible ?? true);
    setFileTreeVisible(group?.fileTreeVisible ?? true);
    setFileTreeWidth(group?.fileTreeWidth ?? FILE_TREE_DEFAULT_WIDTH);
    setDiffSelection(group?.diffSelection ?? { kind: "all" });
    // 切走的会话：它的 preview guest 不销毁，登记为停靠组保活（额度与 LRU 见
    // utils/previewGuestKeep.ts）。登记必须落在这一个提交里——晚一个提交，槽位
    // 已按新会话重建，guest 会被连同销毁，「切走再切回不重载」就失效了。
    const previewTabCount = (list: PanelTab[] | undefined) =>
      (list ?? []).filter((t) => t.kind === "preview").length;
    if (prevKey) {
      // 可见数就地改成新会话的值：park 掉的那一个 guest 正是上一刻还算在可见数里
      // 的（上报是 state 驱动的，此刻还停留在上一会话的值），不改就会把它既算作
      // 可见又算作停靠——额度少一个，白白多淘汰一个会话。
      reportLiveGuests(
        guestOwnerRef.current,
        groupKey,
        previewTabCount(group?.checked),
      );
      parkGroup(
        guestOwnerRef.current,
        prevKey,
        previewTabCount(sessionUi.get(prevKey)?.checked),
      );
    }
  }, [paneId, groupKey]);

  // /btw 面板随会话换：换到别的会话就换成它自己那份（没有就是 null —— 面板从不
  // 串对话），换回来则恢复离开时的样子，加载中的那份照样接着跑（spec 场景 14）。
  // 与上面的面板组同一套编排：本实例在会话切换时不重挂载（桌面 pane 按 paneId
  // 挂载、IDE / 远控页连 id 都不变），只有 effect 能换掉本地镜像。
  useEffect(() => {
    if (btwKey === btwKeyRef.current) return;
    btwKeyRef.current = btwKey;
    setBtwStateKey(btwKey);
    setBtwPanel(btwKey ? (sessionUi.get(btwKey)?.btwPanel ?? null) : null);
  }, [btwKey]);

  // 本地镜像回写会话快照：流式每个分片都写一次，于是「切走那一刻的快照」就是
  // 当时屏幕上的样子，切回来原样播种。换键的那一个提交跳过——此时 btwStateKey
  // 还是上一个会话的、btwKeyRef 已指向新会话，写下去就把旧面板塞进新会话了。
  useEffect(() => {
    if (!btwStateKey || btwStateKey !== btwKeyRef.current) return;
    sessionUi.patch(btwStateKey, { btwPanel });
  }, [btwStateKey, btwPanel]);

  // 切到的会话重新成为前台：把它从保活台账里摘掉（guest 改由本实例的可见分支渲
  // 染）。必须等 state 真的换过去（stateGroupKey 与 tabs 同批切换）——在 swap
  // effect 里立刻摘掉的话，「新会话 tabs 还没进 state」的那一两个提交会既没有 live
  // 条目也没有停靠条目，常驻层整个消失，<webview> 被摘掉重建（保活失效）。重叠的
  // 那一个提交由 previewGuestEntries 的 key 去重兜住（两边 key 相同 → React 原地
  // 复用）。
  useEffect(() => {
    if (stateGroupKey) unparkGroup(stateGroupKey);
  }, [stateGroupKey]);

  // 可见 guest 数上报（额度含可见者，窗口级汇总）：本实例的会话里多出一个 preview
  // tab 也可能挤掉最旧的停靠组。stateGroupKey 也在依赖里——换会话时可见数可能不变
  // （两边各一个 preview tab），但里面那个 guest 已经换人了，必须重新上报一次。
  const livePreviewGuests = tabs.filter((t) => t.kind === "preview").length;
  useEffect(() => {
    reportLiveGuests(guestOwnerRef.current, stateGuestGroup, livePreviewGuests);
  }, [livePreviewGuests, stateGuestGroup]);

  // 实例卸载（分屏关闭 / 窗口关闭）：名下的停靠 guest 随之销毁、释放额度。
  useEffect(() => {
    const owner = guestOwnerRef.current;
    return () => releaseParkedGroups(owner);
  }, []);

  // Desktop plan panel: ExitPlanMode plans that arrive via the setInitialState
  // replay of a re-activated session are routed HERE instead of in the message
  // handler. The host pushes `desktopPanes` + the session snapshot back-to-back
  // (activateAgentInPane), so the renderer usually batches them into ONE commit:
  // routing eagerly would run BEFORE the swap effect above re-seeds tabs/
  // planContent from the incoming session's cache and the reseed would wipe the
  // just-opened plan tab. Deferring past the swap effect means the plan opens
  // on top of the restored group (and the same effect handles the un-batched
  // case where the snapshot lands in its own commit).
  useEffect(() => {
    if (planReplayContent === null) return;
    setPlanReplayContent(null);
    setPlanContent(planReplayContent);
    if (!groupKey) {
      // Single view (no pane/session group): the committed tabs are current and
      // the guarded open path used by routePlanToPanel applies.
      if (!tabsRef.current.some((t) => t.kind === "plan")) {
        ensureTabRef.current("plan");
      }
      return;
    }
    const restored = sessionUi.get(groupKey)?.checked;
    const planInCache = restored?.some((t) => t.kind === "plan") ?? false;
    const planInCommitted = tabsRef.current.some((t) => t.kind === "plan");
    if (planInCache) {
      // The restored group already shows a plan tab — only the content updates
      // (the reseed restored that tab and its active position).
      return;
    }
    if (planInCommitted) {
      // A same-commit session flip re-seeds tabs from the incoming group's
      // cache, dropping the committed (outgoing) plan tab — a cache without a
      // plan tab while the committed tabs have one only happens on a flip (the
      // cache effect skipped that commit). ensureTabRef would consult the stale
      // committed list and merely "activate" the tab being dropped — append a
      // fresh one to the re-seeded list instead.
      tabSeqRef.current.plan += 1;
      const planId = `plan-${tabSeqRef.current.plan}`;
      setTabs((prev) => [...prev, { kind: "plan", id: planId }]);
      setActiveTabId(planId);
      setPanelExpanded(true);
    } else {
      // No plan tab anywhere: open one through the guarded path (it reads the
      // committed tabs, which match the re-seeded list when no flip happened).
      ensureTabRef.current("plan");
    }
  }, [planReplayContent, groupKey]);

  useEffect(() => {
    paneIdRef.current = paneId;
  }, [paneId]);

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

  // Handle messages from VS Code extension. The listener is registered once
  // via useHostMessage (stable listener, latest handler per render); every
  // mutable capture below is a ref or a stable setState, so per-render
  // recreation is behavior-identical to the previous once-registered closure.
  //
  // The pane this instance consumes a message when it is tagged with its own
  // id; messages tagged for a sibling pane are ignored here.
  //
  // The root instance (myPane === undefined) consumes window-global UNTAGGED
  // messages (workdir/sessions/panes/account/toast…) — the sidebar's data.
  // Pane-tagged pushes go to the pane that owns the session; the root only
  // consumes them while the pane rows are hidden (settings page / session
  // board replace the rows and unmount the pane ChatApps), because the host
  // still tags those replies (project settings, hooks/mcp config) to the
  // focused pane. While the rows are visible the target pane is mounted and
  // owns its tagged pushes — the root must not ALSO consume them or the same
  // dialog/toast would render twice, once over the shell and once inside the
  // pane (spec「启动即单个分屏」).
  const myPane = paneIdRef.current;
  const forThisPane = (message: { paneId?: string }): boolean => {
    if (myPane !== undefined) return message.paneId === myPane;
    if (message.paneId === undefined) return true;
    // While the rows are visible, tagged pushes belong to the mounted pane
    // instance; once the rows are hidden the target pane is unmounted and
    // only the root can take the reply (see the rationale above).
    return !rowsVisibleRef.current;
  };
  // /btw 回包的归属路由（spec commands/btw-command.md 场景 14）：回包只带
  // `question`，归属会话按它反查——在途那条可能在用户切走之后才回来，它得落回
  // 自己那个会话的快照，而不是屏幕上的这一个。落到当前会话走本地 setState（回写
  // effect 负责入快照），落到别的会话直接 patch 快照。
  // 查不到归属但本实例还没有会话身份（宿主尚未绑会话）时，就地作用在本地镜像上：
  // 那时不存在「切到别的会话」，也就无所谓归属，保持旧行为。
  const routeBtwReply = (
    question: string,
    fold: (panel: BtwPanelState) => BtwPanelState,
  ) => {
    const owner = sessionUi.keyByBtwQuestion(question);
    if (!owner) {
      setBtwPanel((panel) =>
        !btwKeyRef.current && panel?.loading && panel.question === question
          ? fold(panel)
          : panel,
      );
      return;
    }
    if (owner === btwKeyRef.current) {
      setBtwPanel((panel) => (panel ? fold(panel) : panel));
      return;
    }
    const cached = sessionUi.get(owner)?.btwPanel;
    if (cached) sessionUi.patch(owner, { btwPanel: fold(cached) });
  };
  // 上翻取更早（spec ui/message-rendering-system.md「首屏一页，上翻按需取更早」）：
  // 「还有没有更早」由宿主的回包决定，页面只负责在滚到顶时开口要、把回来的一页接在
  // 列表前面。归属键是 requestId——用户在顶部停留会连续翻页，晚到的旧页必须丢弃。
  const [hasEarlier, setHasEarlier] = useState(false);
  const [isLoadingEarlier, setIsLoadingEarlier] = useState(false);
  const earlierRequestRef = useRef<string | undefined>(undefined);
  const earlierSeqRef = useRef(0);
  // anchorLost 的退让：换已加载列表里的下一个 id 再试，最多这么多次。
  const earlierAnchorAttemptsRef = useRef(0);
  const messagesRef = useRef(state.messages);
  messagesRef.current = state.messages;

  const sendLoadEarlier = (before: string) => {
    const requestId = `earlier-${++earlierSeqRef.current}`;
    earlierRequestRef.current = requestId;
    setIsLoadingEarlier(true);
    const pid = paneIdRef.current;
    const payload = { command: "loadEarlierMessages", before, requestId };
    vscode.postMessage(
      pid === undefined ? payload : { ...payload, paneId: pid },
    );
  };

  const handleMessage = (message: MessageEvent["data"]) => {
    // Desktop plan panel: route an ExitPlanMode plan to the plan pane (opens
    // it on the first plan, then keeps the latest plan until the user closes
    // the pane). Shared by showConfirmation and the setInitialState replay.
    const routePlanToPanel = (planContent: unknown) => {
      if (typeof planContent !== "string" || planContent.trim() === "") return;
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
        // 整表替换之后，上翻的开关回到宿主说的那一份（缺省 = 老宿主，不提供上翻）。
        setHasEarlier(message.hasEarlier === true);
        setIsLoadingEarlier(false);
        earlierAnchorAttemptsRef.current = 0;
        break;
      case "earlierMessages":
        if (!forThisPane(message)) break;
        // 晚到的旧页（用户已经翻走 / 会话已换）丢弃。
        if (message.requestId !== earlierRequestRef.current) break;
        if (message.anchorLost) {
          // 锚点在转录里没了（rewind / 截断 / 换会话）：换成已加载列表里的下一个
          // id 再试，**不要**当成「没有更早」——判错这段历史就再也翻不出来。
          const attempt = earlierAnchorAttemptsRef.current + 1;
          const next = messagesRef.current[attempt]?.id;
          earlierAnchorAttemptsRef.current = attempt;
          if (next && attempt <= EARLIER_ANCHOR_RETRY_LIMIT) {
            sendLoadEarlier(next);
          } else {
            setIsLoadingEarlier(false);
            setHasEarlier(false);
          }
          break;
        }
        earlierAnchorAttemptsRef.current = 0;
        dispatch({ type: "PREPEND_MESSAGES", payload: message.messages });
        setHasEarlier(message.hasMore);
        setIsLoadingEarlier(false);
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
      // 机器侧最近打开的工作目录（远控 Web 页「新建会话」）：每开一次弹窗问一次，
      // 宿主回整份列表。它与会话列表无关——会话全删光之后仍然有内容，这正是它
      // 存在的理由（spec core/recent-workdirs.md）。
      case "recentWorkdirsResponse":
        if (!forThisPane(message)) break;
        if (message.requestId !== recentWorkdirsRequestRef.current) break;
        dispatch({
          type: "SET_RECENT_WORKDIRS",
          payload: message.dirs,
        });
        break;
      // 会话列表的两类标记（远控 Web 页）：远程 shim 在每次重读后整组重发，
      // 「待确认」与「运行中」一起给（见 SET_SESSION_STATUS）。
      case "updateSessionStatus":
        if (!forThisPane(message)) break;
        dispatch({
          type: "SET_SESSION_STATUS",
          payload: { waiting: message.waiting, running: message.running },
        });
        break;
      // Web Push 开关的状态（远控 Web 页）：页面挂载时问一次，之后开 / 关各答一次，
      // 每次都把四个事实整组发回来 —— 菜单照**当前事实**渲染，不做乐观猜测（spec
      // remote/remote-pwa.md「锁屏也能知道」场景 6/7）。
      case "pushState":
        if (!forThisPane(message)) break;
        setPushState({
          supported: message.supported,
          subscribed: message.subscribed,
          needsHomeScreen: message.needsHomeScreen,
          reason: message.reason,
        });
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
        // pane's reply never overwrites this pane's selector. The result is
        // keyed by the workdir it was queried for (null = not a git repo), so
        // a stale reply for a directory the user has since switched away from
        // is quarantined instead of shown over the current directory.
        if (!forThisPane(message)) break;
        setPaneGitBranches(
          message.result
            ? {
                workdir: message.workdir,
                branches: message.result.branches ?? [],
                current: message.result.current ?? "",
              }
            : null,
        );
        // Clear the loading state only for the workdir this reply is for — a
        // late reply for a directory the user already switched away from must
        // not hide the placeholder of the in-flight query for the new one.
        setPaneBranchesQuery((cur) =>
          cur && cur.workdir === message.workdir ? null : cur,
        );
        break;
      case "desktopWorktreeCreated":
        // Worktree creation finished (success or failure) — clear the
        // "worktree 创建中" indicator.
        if (!forThisPane(message)) break;
        setWorktreeCreating(false);
        break;
      case "desktopResumeSessions":
        // Reply to /resume's disk scan (one-shot: a newer request supersedes
        // this one). An error reply means the host could not be read — the
        // host already explained why via toast, so close instead of showing an
        // empty list that would read as "no history".
        if (String(message.requestId) !== resumeRequestIdRef.current) break;
        setResumeLoading(false);
        if (message.error) {
          setResumePickerOpen(false);
          break;
        }
        setResumeSessions(message.sessions ?? []);
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
          const targetKey = sessionUi.keyByForwardRequestId(message.requestId);
          if (targetKey === undefined) break;
          const tabId = message.requestId
            ? forwardTabIdRef.current.get(message.requestId)
            : undefined;
          const patchCachedTabUrl = (url: string) => {
            // Keep the cached group's tabs in sync for remounts/session
            // switches even when this pane is not the current one — via the
            // store's patch (direct cache mutation is banned).
            const cached = sessionUi.get(targetKey);
            if (!cached) return;
            sessionUi.patch(targetKey, {
              checked: cached.checked.map((t) =>
                t.id === tabId ? { ...t, previewUrl: url } : t,
              ),
            });
          };
          if (message.error) {
            sessionUi.patch(targetKey, {
              forwardError: String(message.error),
            });
            if (targetKey === groupKeyRef.current)
              setPreviewForwardError(String(message.error));
          } else {
            sessionUi.patch(targetKey, { forwardError: null });
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
                if (message.url === prevUrl) bumpPreviewEpoch();
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
        // within the pane it lands on the open file with the same path.
        if (!forThisPane(message)) break;
        {
          const fv = message.fileView as FileViewState;
          // 面板内多标签（spec「文件面板已打开文件的标签」）后，path 是这条回包
          // 的归属键：落到条上同路径的那个文件上。条上没有这个文件（标签被关
          // 了、或回包飞在半路用户已关掉）就丢弃——旧模型里「绑到当前空白标签」
          // 的兜底已经没有对应物。
          setTabs((prev) =>
            prev.map((t) =>
              patchOpenFileByPath(t, fv.path, (f) => {
                // 「路径已不在」是状态不是错误（spec desktop-file-panel.md 场景
                // 13）：标签保留、标为不可用并给出「关闭标签」，内容区显示
                // 「文件已不存在」，不再退化成一条读失败横幅。内容留着（可能是
                // 之前读到的那份），下次读成功时连同 `deleted` 一起清掉。
                if (fv.missing) {
                  return {
                    ...f,
                    deleted: true,
                    fileView: {
                      ...(f.fileView ?? fv),
                      missing: true,
                      error: undefined,
                    },
                  };
                }
                // 草稿在身时这份重读不回填（spec desktop-file-panel.md「文件面板
                // 内编辑与保存」场景 8）：自动刷新、再次点开同一路径都会走到这里，
                // 直接替换就把用户没保存的修改吞了。只把「磁盘变了」告诉面板，
                // 由用户选「覆盖」还是「重新加载」；内容没变则什么都不做。
                if (f.fileView?.draft !== undefined) {
                  if (fv.error || fv.content === f.fileView.content) return f;
                  return {
                    ...f,
                    fileView: { ...f.fileView, diskChanged: true },
                  };
                }
                return { ...f, deleted: undefined, fileView: fv };
              }),
            ),
          );
        }
        break;
      case "desktopFileSaveResult":
        // 面板内保存的回包（spec desktop-file-panel.md「文件面板内编辑与保存」场
        // 景 4/7/10）。按 requestId 归到发起保存的那个文件（多标签下 tab 已不再
        // 唯一对应一个文件）：回包落地时用户可能已经取消编辑，甚至已经切到别的
        // 文件——状态一律以那个文件此刻的样子为准。
        if (!forThisPane(message)) break;
        {
          const fileId = fileSaveRequestsRef.current.get(message.requestId);
          if (!fileId) break;
          fileSaveRequestsRef.current.delete(message.requestId);
          const patchSaving = (patch: (fv: FileViewState) => FileViewState) =>
            setTabs((prev) =>
              prev.map((t) =>
                patchOpenFile(t, fileId, (f) =>
                  f.fileView ? { ...f, fileView: patch(f.fileView) } : f,
                ),
              ),
            );
          if (message.status === "saved") {
            patchSaving((fileView) => ({
              ...fileView,
              // 保存成功 = 磁盘此刻就是草稿内容：只读正文换成草稿那份、
              // 并发校验的基准换成回包里的哈希，编辑态退出。
              content: fileView.draft ?? fileView.content,
              contentHash: message.contentHash ?? fileView.contentHash,
              draft: undefined,
              saving: undefined,
              saveError: undefined,
              diskChanged: undefined,
            }));
            // 轻量反馈（本 pane 自己的 toast 栈）。连存两次（保存 → 冲突 →
            // 覆盖）只留一条「已保存」，不叠成一摞同样的痕。
            setToasts((prev) => [
              ...prev.filter((t) => t.message !== "已保存"),
              {
                id: `file-saved-${Date.now()}`,
                message: "已保存",
                type: "success",
              },
            ]);
            break;
          }
          patchSaving((fileView) => {
            if (message.status === "conflict") {
              // 磁盘被改过：草稿原样留着、不退出编辑态，回包里的磁盘哈希落到
              // contentHash 上——用户点「覆盖」就是按它再写一次；点「重新加载」
              // 则丢弃草稿重读。
              return {
                ...fileView,
                saving: undefined,
                saveError: undefined,
                diskChanged: true,
                contentHash: message.contentHash ?? fileView.contentHash,
              };
            }
            // denied / error：草稿完整保留、仍在编辑态，用户可重试或取消。
            return {
              ...fileView,
              saving: undefined,
              saveError: message.message ?? "保存失败，请重试",
            };
          });
        }
        break;
      case "desktopPreviewFileResult":
        // Local .html preview reply (spec: desktop-preview.md「本地 HTML 文件
        // 预览」). Matched by requestId against the pending preview request —
        // a URL fills the requesting tab (remount via epoch when the tab
        // already shows it), an error closes the placeholder tab and falls
        // back to the file panel's normal open flow (scenario 4).
        if (!forThisPane(message)) break;
        {
          const req = previewFileRequestsRef.current.get(message.requestId);
          if (!req) break;
          previewFileRequestsRef.current.delete(message.requestId);
          if (message.url) {
            setTabs((prev) =>
              prev.map((t) =>
                t.id === req.tabId
                  ? { ...t, previewUrl: message.url as string }
                  : t,
              ),
            );
            const tab = tabsRef.current.find((t) => t.id === req.tabId);
            if (!tab) {
              // The tab was closed while the acquire was in flight — the host
              // just registered a reference nothing will release; cancel it.
              pendingPreviewFallbackRef.current.delete(req.tabId);
              postToHost({
                command: "desktopPreviewFileRelease",
                path: req.path,
              });
            } else if (tab.previewUrl === message.url) {
              // Re-acquire returned the same URL: bump the epoch so the
              // PreviewPane remounts and actually reloads.
              bumpPreviewEpoch();
            }
          } else {
            // Preview refused (missing/oversized/unpreviewable): drop the
            // placeholder tab and open the file panel on the source path.
            setTabs((prev) => prev.filter((t) => t.id !== req.tabId));
            if (tabsRef.current.length <= 1) setPanelExpanded(false);
            const pending = pendingPreviewFallbackRef.current.get(req.tabId);
            pendingPreviewFallbackRef.current.delete(req.tabId);
            if (pending) openFileInPanelRef.current(pending.path);
          }
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
      case "rewindResult": {
        if (!forThisPane(message)) break;
        const requestId = String(message.requestId);
        const anchor = pendingRewindsRef.current.get(requestId);
        // Unknown / already-consumed reply, or one for a different anchor:
        // dropping it is the whole point of carrying the attribution key.
        if (anchor === undefined || message.messageId !== anchor) break;
        pendingRewindsRef.current.delete(requestId);
        // The host reports success only after the session file was rewritten;
        // the list is cut locally rather than re-sent (rewind carries no
        // payload). A failure leaves the list exactly as it was.
        if (message.ok === true) {
          dispatch({
            type: "TRUNCATE_MESSAGES",
            payload: { messageId: anchor },
          });
        }
        break;
      }
      case "configuredModels":
        if (!forThisPane(message)) break;
        setConfiguredModels(message.models || []);
        setCurrentModel(message.currentModel);
        break;
      case "btwStream": {
        if (!forThisPane(message)) break;
        // Streaming chunks from the askBtw RPC (spec scenario 6): thinking
        // chunks show live while they stream, but once the first content
        // chunk arrives the accumulated thinking text is discarded and only
        // content is kept (user decision: thinking is not shown after the
        // thinking phase ends). 归属见 routeBtwReply——在途请求可能在用户切走
        // 之后才流完，它照旧往自己那个会话的快照里写，切回来连同流式尾部一起恢复。
        routeBtwReply(message.question, (panel) =>
          applyBtwChunk(
            panel,
            typeof message.content === "string" ? message.content : "",
            message.type,
          ),
        );
        break;
      }
      case "btwResponse":
        if (!forThisPane(message)) break;
        // 迟到回包落在它所属的会话上；找不到归属（面板被手动关掉、或从没发起）
        // 就整条丢弃（场景 10）。
        routeBtwReply(message.question, (panel) => ({
          ...panel,
          answer: message.answer ?? "",
          loading: false,
        }));
        break;
      case "btwError":
        if (!forThisPane(message)) break;
        routeBtwReply(message.question, (panel) => ({
          ...panel,
          answer: `(API error: ${message.error ?? "unknown"})`,
          loading: false,
        }));
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
      case "updateSessions": {
        dispatch({ type: "SET_SESSIONS", payload: message.sessions });
        // /btw 面板按会话存在快照里（场景 14），所以非桌面端也要有失效收口：
        // 桌面端由 DesktopApp 在会话树更新时统一 prune，IDE / 远控页没有那一层，
        // 就在这里把已删除会话的那份扔掉——否则内存里会堆着再也回不去的答案。
        if (!isDesktop) {
          const sessions = Array.isArray(message.sessions)
            ? message.sessions
            : [];
          const keep = new Set<string>(
            sessions.map((s: { id: string }) => s.id),
          );
          if (btwKeyRef.current) keep.add(btwKeyRef.current);
          sessionUi.prune(keep);
        }
        break;
      }
      case "updateCurrentSession":
        if (!forThisPane(message)) break;
        // Same synchronous conversation-scoped usage clear as setInitialState:
        // the desktop host pushes updateCurrentSession when an agent's session
        // id changes (onSessionIdChange rekey) while this pane stays mounted.
        {
          const nextSessionId = message.session?.id;
          if (
            usageSessionRef.current !== undefined &&
            usageSessionRef.current !== nextSessionId
          ) {
            setContextUsage(undefined);
          }
          usageSessionRef.current = nextSessionId;
        }
        dispatch({ type: "SET_CURRENT_SESSION", payload: message.session });
        break;
      case "showConfirmation":
        if (!forThisPane(message)) break;
        // Plan panel (desktop): the ExitPlanMode plan full text lives in the
        // plan pane, not the (compact) confirmation dialog — mirror the VSCE
        // claudePlanPreview panel and the JB editor column. The dialog gets
        // the plan stripped so it stays small.
        //
        // Exception — the remote-control Web page: it has no editor column and
        // no pane system, so the dialog IS the plan's carrier
        // (spec core/plan-mode.md 场景 13 / remote/remote-web.md 场景 19). This
        // is the single place that decides it; ConfirmationDialog just renders
        // whatever plan arrived.
        const planStrippedToPanel =
          message.toolName === EXIT_PLAN_MODE_TOOL_NAME && !isRemotePage;
        if (planStrippedToPanel) {
          routePlanToPanel(message.planContent);
        }
        dispatch({
          type: "SHOW_CONFIRMATION",
          payload: {
            confirmationId: message.confirmationId,
            toolName: message.toolName,
            confirmationType: message.confirmationType,
            toolInput: message.toolInput,
            planContent: planStrippedToPanel ? undefined : message.planContent,
            suggestedPrefix: message.suggestedPrefix,
            hidePersistentOption: message.hidePersistentOption,
            outsideSafeZoneDirectory: message.outsideSafeZoneDirectory,
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
      case "planFileUpdated":
        // Plan panel live refresh (spec: 计划文件更新后刷新计划面板): the model
        // wrote the plan file. Only the content updates — a closed pane must
        // NOT open here (unlike planContent / ExitPlanMode).
        if (!forThisPane(message)) break;
        setPlanContent(message.content);
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
        // The reply carries its own workdir (host 归属键)：归属目录已不是当前
        // 目录（切目录/切会话后才落地）的慢回复直接丢弃（过期即弃），不再按
        // 到达时目录盖章（a3043966 土办法会把上个项目的数据标成当前项目）。
        if (!forThisPane(message)) break;
        // 归属比对用本实例的「当前项目」：pane 实例 = 其会话目录（effectiveWorkdir）；
        // root 全页设置实例 = host.workdir（聚焦 pane 目录，host 权威）——以窗口
        // recents 头作比对会让聚焦会话已切项目后的回包被误判过期而丢弃（见
        // settingsWorkdir 注释），设置页将一直显示上一项目快照。
        if (message.workdir !== settingsWorkdirRef.current) break;
        // workdir 键控快照存 SessionUiStore；reducer 只镜像本次接受的值供
        // 项目设置视图渲染（镜像自身的归属守卫见 SettingsPage）。
        sessionUi.setProjectSettings(message.workdir, {
          enabledPlugins: message.enabledPlugins,
        });
        dispatch({
          type: "SET_PROJECT_SETTINGS",
          payload: {
            enabledPlugins: message.enabledPlugins,
            workdir: message.workdir,
          },
        });
        break;
      case "setInitialState":
        if (!forThisPane(message)) break;
        // The context-usage percentage is conversation-scoped (spec「上下文用量
        // 指示器」场景 6 + session isolation), and desktop panes key ChatApp by
        // paneId, so a session switch must drop the previous session's number
        // here — synchronously in the message handler, NOT in a passive
        // useEffect. The desktop host posts setInitialState and its cached
        // usage replay (activateAgentInPane) as consecutive IPC messages; a
        // passive effect flushing after that replay would wipe the number just
        // posted and leave an empty ring until the next turn (race — the ring
        // intermittently stays blank when flipping between two remote-host
        // conversations). Semantics kept: clear only on a real session change,
        // keep on same-session refreshes, initial mount is a no-op.
        {
          const nextSessionId = message.session?.id;
          if (
            usageSessionRef.current !== undefined &&
            usageSessionRef.current !== nextSessionId
          ) {
            setContextUsage(undefined);
          }
          usageSessionRef.current = nextSessionId;
        }
        // Desktop plan panel: replayed pending confirmations (pane rebind to a
        // session whose ExitPlanMode fired while the conversation was in the
        // background) carry the plan as well, so they need the same two-step
        // treatment showConfirmation gives it: stage the text for the plan pane,
        // and hand the reducer a copy WITHOUT it — otherwise a re-activated
        // session shows the whole plan inside the dialog while the pane opens
        // next to it (the dialog is meant to stay compact). Staged — not routed
        // here — because a same-batch pane rebind re-seeds tabs from the
        // incoming cache after this handler runs and would wipe an eagerly
        // opened plan tab (see the routing effect).
        //
        // Skipped on the remote-control Web page: there the plan is rendered
        // inside the confirmation dialog itself, so staging it for the pane
        // system would open a second carrier for the same plan.
        const replayedConfirmations =
          message.pendingConfirmations ||
          (message.pendingConfirmation ? [message.pendingConfirmation] : []);
        for (const c of replayedConfirmations) {
          if (
            !isRemotePage &&
            c.toolName === EXIT_PLAN_MODE_TOOL_NAME &&
            typeof c.planContent === "string" &&
            c.planContent.trim() !== ""
          ) {
            setPlanReplayContent(c.planContent);
          }
        }
        setHasEarlier(message.hasEarlier === true);
        setIsLoadingEarlier(false);
        earlierAnchorAttemptsRef.current = 0;
        dispatch({
          type: "SET_INITIAL_STATE",
          payload: {
            messages: message.messages,
            // Rewind snapshots ship an empty list + this flag: the webview cut
            // its own copy and must keep it. Without forwarding the flag the
            // reducer would take the empty list at face value and blank the
            // conversation.
            keepMessages: message.keepMessages,
            tasks: message.tasks,
            isStreaming: message.isStreaming,
            isCommandRunning: message.isCommandRunning,
            // Compaction state is conversation-scoped and the host replays the
            // activated session's own value (desktop: pushPaneSessionState) —
            // forward it or the reducer's `?? false` default swallows it and the
            // hint vanishes when switching back to a still-compacting session.
            isCompacting: message.isCompacting,
            isTaskListCollapsed: message.isTaskListCollapsed,
            isRestoring: message.isRestoring,
            sessions: message.sessions,
            currentSession: message.session,
            // 仅 IDE 宿主随快照带全局配置；desktop 改走窗口级
            // configurationResponse（渲染设置页的 root 实例不消费带 paneId
            // 的快照）。窗口级数据（主题/更新通道）一律不进快照。
            configurationData: message.configurationData,
            // 计划正文已由上面的 staging 路由进 plan 面板，落进 reducer 的这份
            // 确认请求要剔掉它 —— 与 showConfirmation 同口径（远控 Web 页例外：
            // 那里对话框是唯一载者）。
            pendingConfirmations: replayedConfirmations.map(
              (c: ConfirmationRequest): ConfirmationRequest =>
                !isRemotePage && c.toolName === EXIT_PLAN_MODE_TOOL_NAME
                  ? { ...c, planContent: undefined }
                  : c,
            ),
            selection: message.selection,
            inputContent: message.inputContent,
            permissionMode: message.permissionMode,
            attachedImages: message.attachedImages,
            queuedMessages: message.queuedMessages,
            isAuthenticated: message.isAuthenticated,
            workdir: message.workdir,
            // Hosts (VSCE messageHandler / Desktop desktopHost) include the
            // running background tasks + workflow runs in the snapshot so a
            // webview re-init / pane switch does not wipe them. Without this
            // the reducer falls back to [] and /tasks shows "暂无后台任务"
            // until the next incremental updateBackgroundTasks (e.g. stop).
            backgroundTasks: message.backgroundTasks,
            workflowRuns: message.workflowRuns,
            // 会话列表的两类标记随快照一起下发（远控 Web 页）：列表与标记来自
            // 同一次读，所以能一次上屏。其余宿主不携带 —— 缺席时保留现值，见
            // reducer 里那行的注释。
            sessionStatus: message.sessionStatus,
          },
        });
        break;
      case "desktopThemeChange":
        document.documentElement.setAttribute("data-theme", message.effective);
        break;
      case "desktopThemeSource":
        // Theme preference broadcast — keeps the settings selection in sync
        // on every instance after 跟随系统/浅色/深色 is picked (the theme
        // itself was already applied by the desktopThemeChange above).
        setThemeSource(message.source);
        break;
      case "desktopUpdateChannel":
        // Update-channel broadcast — keeps the 设置页「接收 Beta 版更新」开关
        // 选中态 in sync on every instance after the toggle is flipped.
        if (message.channel === "beta" || message.channel === "stable") {
          setUpdateChannel(message.channel);
        }
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
      case "pluginChangePending":
        // 同上：窗口级事件，只有根实例弹一次（多分屏不叠加）。
        if (myPane !== undefined) break;
        setPluginChangePending(true);
        break;
      case "desktopAccountInfo":
        // Sidebar account card — window-global like showToast (the sidebar
        // renders on the root instance only), so pane instances ignore it.
        if (myPane !== undefined) break;
        setAccountInfo({
          isAuthenticated: message.isAuthenticated === true,
          user: message.user ?? null,
          billing: message.billing ?? null,
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
        //
        // 不直接 loadDraft：这条命令可能早于本视图的权威快照到达（webview 刚
        // 建/重挂载时输入框还没挂载，或已挂载但随后会被 setInitialState 重置），
        // 直接写的可选链/快照重置都会把提示词静默丢掉。一律进 pending 队列，由
        // 下方 effect 在「输入框就绪」后写入（与 desktop 的 prefillRequest 同一条
        // 重放路径）。
        if (typeof message.prompt === "string") {
          setPendingPrefill({
            prompt: message.prompt,
            nonce: ++prefillNonceRef.current,
          });
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
      case "discardMessage":
        // The streamed attempt that produced this message failed mid-body and
        // the host is re-issuing it non-streaming — drop the half message.
        if (!forThisPane(message)) break;
        dispatch({
          type: "REMOVE_MESSAGE",
          payload: { messageId: message.messageId },
        });
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
        // Delta of newly produced compaction text — appended, then the hint
        // renders only its last 30 characters (streaming tail). The buffer is
        // cleared when compaction ends (stateChange false above).
        setCompactionStream((prev) => prev + message.content);
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
        // 服务地址来自 CLI 的 getAuthStatus（宿主只缓存/转发）：企业控制台 /
        // 帮助文档按钮与桌面端「接收 Beta 版更新」开关都读它。未登录/查询失败
        // 时宿主省略该字段 —— 保留上一次的值（不是"没有服务地址"）。
        if (message.serverUrl) setServerUrl(message.serverUrl);
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
      case "agentsContentSaved":
        // AGENTS.md save outcome push (setAgentsContent RPC reply), untagged
        // like agentsContentResponse — resets the save-in-progress flag (结果
        // toast 由宿主在发出本消息时一并推送).
        setAgentsSaving(false);
        break;
      case "loginResponse":
        if (message.success) {
          dispatch({ type: "SET_AUTHENTICATED", payload: true });
          setAccountInfo((prev) => ({
            isAuthenticated: true,
            user: message.user ?? prev?.user ?? null,
            billing: prev?.billing ?? null,
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
            billing: null,
            apiQuota: null,
          });
        }
        break;
    }
  };

  useHostMessage(handleMessage);

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

  // 头部标题就地编辑（spec session-management.md「会话重命名入口：CLI 与 IDE
  // 插件」场景 8/9）：乐观更新走 reducer（sessions 列表 + currentSession 一起
  // 改，头部立即变），失败时 useSessionRename 回滚，头部就地给出可见提示。
  const applyRenamedTitle = useCallback((sessionId: string, title: string) => {
    dispatch({ type: "RENAME_SESSION", payload: { sessionId, title } });
  }, []);
  const renameSessionFromHeader = useSessionRename(vscode, applyRenamedTitle);

  // Desktop: query this pane's own workdir for its git branches (FR-052). Each
  // pane asks independently so a new-session pane keeps its workdir/branch even
  // when focus moves to a sibling pane (which would otherwise rewire the host's
  // global workdir). No clearing happens here: the gitBranches workdir key
  // already hides a stale result the moment pickerWorkdir changes (render-time
  // check), so an in-flight query for the previous directory can never render
  // under the current one.
  //
  // Depend ONLY on pickerWorkdir (a primitive string) — never on the host
  // object reference, and never on host.workdir. Rationale: when a new pane
  // boots, activateAgentInPane sends desktopWorkdirState to update the host's
  // global workdir from the previously-focused sibling's path to this pane's
  // repo root. That changes host.workdir even though THIS pane's
  // effectiveWorkdir is unchanged (spawn-before = recents[0] fallback; spawn-after
  // = state.workdir = agent.cwd = the same recents[0]). Re-querying on a
  // host.workdir change would flash the selector twice. A genuine user workdir
  // switch changes recents[0] (and thus pickerWorkdir), which is the only
  // re-query signal we want. Likewise a worktree creation must not re-query:
  // the spawned session's cwd is the worktree path, which is not a user-chosen
  // directory (not in recents), so pickerWorkdir stays on the user's repo — and
  // the query signal never fires before the first message hides the pickers.
  useEffect(() => {
    if (!isDesktop || !pickerWorkdir) {
      setPaneBranchesQuery(null);
      return;
    }
    // Mark this workdir's query as in flight; the placeholder only becomes
    // visible if the delay elapses without a reply (see paneBranchesQuery).
    setPaneBranchesQuery({ workdir: pickerWorkdir, loading: false });
    const timer = setTimeout(() => {
      setPaneBranchesQuery((cur) =>
        cur && cur.workdir === pickerWorkdir
          ? { workdir: pickerWorkdir, loading: true }
          : cur,
      );
    }, BRANCH_LIST_LOADING_DELAY_MS);
    postToHost({
      command: "desktopListGitBranches",
      workdir: pickerWorkdir,
      paneId,
    });
    return () => clearTimeout(timer);
  }, [pickerWorkdir, isDesktop, postToHost, paneId]);

  // 「原地守卫」：清空（`/clear`）或原地恢复替换当前会话会把正在跑的这一轮生成、
  // 正在进行的压缩、正在跑的后台任务打断，或让它们与 UI 脱离 —— streaming / 压缩
  // / 后台任务三态共用这一个守卫位（spec session-management.md 场景 2 / 6 / 7、
  // message-compact.md「压缩期间的会话保护」）。
  //
  // 它只对「原地」动作成立，所以远控页**不套用**：页面上的「新建对话」在机器上
  // 另起一条会话（initialize）、「会话」入口只改页面自己这份 sessionId 与视图，
  // 两条都不触动电脑侧正在跑的那条会话（spec remote/remote-web.md「Web 端也能发起
  // 新会话」场景 10 与「Web 页作为第五种宿主」场景 10；桌面端多会话并行模型同样
  // 不吃这条守卫）。
  const inPlaceBusy =
    state.isStreaming ||
    state.isCompacting ||
    hasRunningBackgroundTask(state.backgroundTasks);
  const inPlaceGuard = !isRemotePage && inPlaceBusy;

  const handleClearChat = useCallback(() => {
    // /clear 斜杠命令 + ChatHeader「新建对话」按钮：原地清空当前会话，streaming、
    // 压缩进行中或存在正在运行的后台任务（后台终端工具/子代理/workflow）期间
    // 忽略——后两者防原地清空把正在跑的任务中断/与 UI 脱离；压缩中清空还会
    // 让压缩摘要写进清空后的新会话（spec message-compact「压缩期间的会话保护」）。
    // 仅 IDE 端可达（桌面端 /clear 已整端移除 2026-09-05，「新建对话」按钮也被
    // hideSessionButtons={isDesktop} 隐藏 —— 见 handleSendMessage）。
    // 这里的守卫**不**收窄成上面的 inPlaceGuard：`/clear` 无论从哪一端触发都是
    // 真正的原地清空，将来若在远控页可达也照旧该被挡住。
    if (
      stateRef.current.isStreaming ||
      stateRef.current.isCompacting ||
      hasRunningBackgroundTask(stateRef.current.backgroundTasks)
    )
      return;

    postToHost({
      command: "clearChat",
    });
  }, [postToHost]);

  // 远控页顶栏「新建对话」：不是 clearChat —— 它打开弹窗，经 shim 发
  // initialize 在远端机器上建一个全新会话（spec remote/remote-web.md「Web 端也能
  // 发起新会话」）。它是新建、不是原地清空，所以页面上不吃那条忙闲守卫——电脑侧
  // 那条会话照旧跑着（同故事场景 10）。
  const handleRemoteNewSession = useCallback(() => {
    dispatch({ type: "SHOW_DIALOG", payload: { type: "remoteNewSession" } });
    // 最近目录跟着机器走（spec core/recent-workdirs.md）：每次开弹窗都问一次，
    // 而不是把上次打开时的列表留在 reducer 里——期间电脑侧可能又用过别的目录。
    // 读不到（旧版电脑 / 通道拒绝）就什么都不发生，弹窗仍列出活会话派生的那些。
    const requestId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    recentWorkdirsRequestRef.current = requestId;
    postToHost({
      command: "getRecentWorkdirs",
      requestId,
    });
  }, [dispatch, postToHost]);

  // 弹窗「最近目录」：**两段合并**（spec core/recent-workdirs.md）。
  //
  // 前一段是当前进程跑过的会话按工作目录去重（sessions 列表本身按最近活跃
  // 排序，直接沿用其顺序）；后一段是这台机器持久化的最近打开目录（宿主读
  // `~/.wave/recent-workdirs.json`，与桌面端共用同一份）——会话全删光时前者为空，
  // 后者正是「仍然记得上次用过哪个目录」的来源。没有会话、也读不到机器列表时
  // （旧版电脑）只留「浏览…」。
  //
  // 归并键是**主仓库根目录**：worktree 会话的 workdir 是它自己的工作树路径，
  // 但选目录是为了「在这个仓库里再开一条会话」，把工作树当目录列出来既重复又
  // 违反直觉（桌面端最近目录同口径：worktree 会话只记仓库根，新建会话时也不
  // 把工作树写进去）。宿主已经给了这份事实（`listDaemonSessions` 每行按
  // createdWorkdir 推导出的 `worktree.repoRoot`，fs-only、不跑 git），推导不出来
  // 就按原目录列——不确定不等于可以猜。sessions 里的 workdir 本身不改写：`@`
  // 文件提及拼绝对路径靠的是那条会话真实的 cwd。
  const remoteRecentDirs = useMemo(() => {
    const seen = new Set<string>();
    for (const s of state.sessions) {
      const dir = s.repoRoot ?? s.workdir;
      if (dir) seen.add(dir);
    }
    for (const dir of state.recentWorkdirs) {
      if (dir) seen.add(dir);
    }
    return [...seen];
  }, [state.sessions, state.recentWorkdirs]);

  const handleToastDismiss = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  // 渲染进程自己发起的轻提示（宿主没参与的动作，如文件面板「复制路径」）：
  // 走同一条顶部 toast 栈与同一套自动消失规则（无 action ⇒ 8s 后自己收）。
  // id 用自增前缀，避免与宿主下发的 toast 撞号。
  const localToastSeqRef = useRef(0);
  const pushToast = useCallback((message: string, kind: ToastKind = "info") => {
    localToastSeqRef.current += 1;
    const id = `local-toast-${localToastSeqRef.current}`;
    setToasts((prev) => [
      ...prev.filter((t) => t.id !== id),
      { id, message, type: kind },
    ]);
  }, []);

  const handleToastAction = useCallback(
    (toast: UpdateToast) => {
      if (!toast.action) return;
      postToHost({
        command: "toastAction",
        toastId: toast.id,
        action: toast.action,
      });
      // 动作语义在宿主（聚焦后台会话）——回传后即关闭 toast。
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
        // configuration on entry; the settings page requests the AGENTS.md
        // editor contents itself (its own mount effect pulls each scope while
        // the value is null — user immediately, project when the 项目级 tab is
        // first activated). /agents、/skills、/hooks 斜杠命令携带 nav
        // (subagents/skills/hooks) 选中对应选项卡（spec agents-command.md /
        // hooks-command.md）。
        //
        // 重置 AGENTS.md 编辑器缓存：缓存不按 workdir 键控、只随首次加载填充
        // 且从不失效——关闭设置 → 切换项目/会话 → 再打开会继续显示上一份加载
        // 的（旧值/别项目）文件。每次打开置 null 后由设置页按需重新读取当前
        // 项目的文件（host 按聚焦 pane 解析 workdir，见 desktopHost
        // handleGetAgentsContent）。
        setUserAgentsContent(null);
        setProjectAgentsContent(null);
        setAgentsSaving(false);
        setSettingsOpen(true);
        if (nav) setSettingsNav(nav);
        vscode.postMessage({ command: "getConfiguration" });
        return;
      }
      // IDE hosts (VSCE/JetBrains): the host opens the settings tab webview in
      // the editor area (spec 场景 10) and serves the shared SettingsPage there.
      // nav 随 openSettings 透传，host 经 settingsState 下发给设置页。
      vscode.postMessage({ command: "openSettings", ...(nav ? { nav } : {}) });
    },
    [vscode, isDesktop, paneId, onOpenSettingsFromPane],
  );

  // Remote-control Web page: the host has no `openExternal` to route to (the page
  // IS a browser), so these two open a plain browser tab instead of a dead
  // request — same URL, native behaviour (spec remote/remote-web.md 场景 21).
  const openInBrowser = useCallback((url: string) => {
    window.open(url, "_blank", "noopener,noreferrer");
  }, []);

  const handleOpenEnterpriseConsole = useCallback(() => {
    if (serverUrl) {
      if (isRemotePage) {
        openInBrowser(serverUrl);
        return;
      }
      vscode.postMessage({ command: "openExternal", url: serverUrl });
    }
  }, [vscode, serverUrl, isRemotePage, openInBrowser]);

  // 账户卡片的「帮助文档」：serverUrl + /docs 走系统浏览器（spec 场景 4）.
  const handleOpenHelpDocs = useCallback(() => {
    if (serverUrl) {
      const url = `${serverUrl.replace(/\/+$/, "")}/docs/`;
      if (isRemotePage) {
        openInBrowser(url);
        return;
      }
      vscode.postMessage({
        command: "openExternal",
        url,
      });
    }
  }, [vscode, serverUrl, isRemotePage, openInBrowser]);

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
  // 后才能写入——用 prefillRequest + effect 在渲染后写入并聚焦。
  //
  // openFile（编辑操作附带的配置文件路径）随同一请求下行：目标 ChatApp 在写入
  // 提示词的同时把该文件打开到右侧文件面板（对齐消息路径点击同款面板），使
  // 「编辑 = 回到会话视图预填 + 对照配置文件」一次完成。
  //
  // FR-032 桌面 pane 布局：设置页全页挂在 root 实例（paneId undefined），而各
  // pane 的输入框在 DesktopShell 内的 pane-scoped ChatApp（ref 各自独立），root
  // 的 messageInputRef 恒 null——直接写会静默丢 prompt。此时捕获点击瞬间的
  // focused pane 作 targetPaneId，把请求留给 DesktopShell 下行到匹配 pane。
  const handlePrefillPrompt = useCallback(
    (prompt: string, openFile?: string) => {
      setSettingsOpen(false);
      setSessionBoardOpen(false);
      const panes = host?.panes;
      if ((panes?.length ?? 0) > 0) {
        setPendingPrefill({
          prompt,
          openFile,
          nonce: ++prefillNonceRef.current,
          targetPaneId: host?.focusedPaneId ?? panes?.[0]?.paneId,
        });
      } else {
        setPendingPrefill({
          prompt,
          openFile,
          nonce: ++prefillNonceRef.current,
        });
      }
    },
    [host?.focusedPaneId, host?.panes],
  );

  // root 单布局（无 pane）：chatContainer 重挂载完成后把待填提示词写入本地输入框
  // （编辑请求另把 openFile 经 openFileRef 打开到本实例的右侧文件面板）。pane
  // 布局的请求带 targetPaneId，改由 pane ChatApp 写回并回调清除，这里跳过。
  //
  // 就绪闸门：**权威快照落地**（state.initialStateReceived）且输入框真的挂载了。
  // 只等「认证状态」不够——宿主 pushInitialState 先发 authStatusResponse（它就
  // 把 initialized 置真、输入区挂载）再发 setInitialState，在两者之间写入的草案会
  // 被紧接着的快照按 inputContent 重置成空（线上缺陷：桌面端「新增钩子」跳回会话
  // 首屏看不到预填文本，切走再切回才有）。未就绪时保留 pending、等下一次渲染重跑，
  // 绝不在这里清空请求。
  useEffect(() => {
    if (settingsOpen || pendingPrefill === null) return;
    if (pendingPrefill.targetPaneId !== undefined) return;
    if (!state.initialStateReceived || state.isRestoring) return;
    const input = messageInputRef.current;
    if (!input) return;
    input.loadDraft(pendingPrefill.prompt);
    if (pendingPrefill.openFile) openFileRef.current(pendingPrefill.openFile);
    setPendingPrefill(null);
  }, [
    settingsOpen,
    pendingPrefill,
    state.initialStateReceived,
    state.isRestoring,
  ]);

  // DesktopShell 下行 prefillRequest 到 pane 后清除 root pending。pane ChatApp
  // 应用时回调（带 nonce）——nonce 不匹配则忽略（防旧回执清掉更新的请求）。
  const handlePrefillApplied = useCallback((nonce: number) => {
    setPendingPrefill((prev) => (prev?.nonce === nonce ? null : prev));
  }, []);

  // Batch 2 session board (desktop): 活动 button is a toggle — it opens the
  // board when closed and closes it when already open (spec 场景 7); the
  // board's 返回当前会话 also closes it (spec 场景 6). Settings and board are
  // mutually exclusive — opening the board closes settings.
  //
  // 2026-10-23 评论（点 `button.desktop-sidebar-new-chat.is-active`「创作集」）：
  // 「创作集选中后，还能同时选中插件市场是不对的」——侧栏三个整页入口（活动 /
  // 插件市场 / 创作集）必须互斥（后开者优先）：只开一个、侧栏也只亮一个。
  const handleToggleSessionBoard = useCallback(() => {
    setSessionBoardOpen((prev) => !prev);
    setSettingsOpen(false);
    setPluginMarketOpen(false);
    setArtifactsOpen(false);
  }, []);

  const handleCloseSessionBoard = useCallback(() => {
    setSessionBoardOpen(false);
  }, []);

  // 插件市场整页（desktop，spec ecosystem/plugin.md「插件市场」场景 1/2）：侧边栏
  // 入口是开关——未打开则打开，已打开则关闭；与设置页、会话状态看板、创作集互斥
  // （后开者优先）。返回当前会话与再次点击入口同效（场景 2）。
  const handleTogglePluginMarket = useCallback(() => {
    setPluginMarketOpen((prev) => !prev);
    setSettingsOpen(false);
    setSessionBoardOpen(false);
    setArtifactsOpen(false);
  }, []);

  const handleClosePluginMarket = useCallback(() => {
    setPluginMarketOpen(false);
  }, []);

  const handleToggleArtifacts = useCallback(() => {
    setArtifactsOpen((prev) => !prev);
    setSettingsOpen(false);
    setSessionBoardOpen(false);
    setPluginMarketOpen(false);
  }, []);

  const handleCloseArtifacts = useCallback(() => {
    setArtifactsOpen(false);
  }, []);

  /**
   * 创作集「新建 → 模板」：关掉页面，把模板提示词预填进**当前选中会话**的输入框
   * （`desktopArtifactsNewFromTemplate` 由宿主下发 prefillPrompt，不新建会话——
   * 建会话会让提示词等 agent spawn 2-3s 且总是落到新对话，见 PM 3500350535448832 /
   * 3500351963339008）。
   */
  const handleNewFromTemplate = useCallback(
    (prompt: string) => {
      setArtifactsOpen(false);
      vscode?.postMessage({
        command: "desktopArtifactsNewFromTemplate",
        prompt,
      });
    },
    [vscode],
  );

  /** 打开（不切换）插件市场整页——供 pane 委派路径调用：pane 实例本身不渲染整页，
   *  且整页覆盖 pane 行后输入框已不可达，故「打开」与「切换」在用户层面是同一个
   *  动作。 */
  const handleOpenPluginMarket = useCallback(() => {
    setPluginMarketOpen(true);
    setSettingsOpen(false);
    setSessionBoardOpen(false);
    setArtifactsOpen(false);
  }, []);

  const handleSendMessage = useCallback(
    (
      text: string,
      images?: Array<{ data: string; mediaType: string }>,
      force: boolean = false,
    ) => {
      const trimmedText = text.trim();
      if (!trimmedText && (!images || images.length === 0)) return;

      // 宿主本地的斜杠命令：**剩下的**那些（设置页 / 插件市场 / 钩子 / 技能 /
      // 子代理 / MCP / 计划 / 远程控制自身）远程控制 Web 页一律不拦
      // （spec remote/remote-web.md 场景 21）：它们背后要么是宿主的**界面**能力，
      // 要么只有宿主侧才有意义，拦下来只会打开一个永远加载中的死弹窗；页面不拦 =
      // 文本按普通消息发给宿主。服务端真能做的两条（/compact、/status）不受影响。
      //
      // 第二批解禁（2026-10-17）之后，`/clear` `/rewind` `/tasks` `/workflows`
      // 不在这条守卫里了：宿主侧方法已在白名单里、shim 有回执，
      // 页面这一侧也没有宿主 UI 依赖（弹窗都长在本组件里），所以远端照常拦截
      // ——见下面各自的注释与 spec「页面能执行的那批宿主命令」。
      //
      // `/btw` 同样在守卫之外（spec「Web 页也能用 /btw 旁路提问」）：它的面板长在
      // 本组件的输入区上方，不在宿主界面里，所以那条「宿主界面能力」的判据对它是
      // 例外——远端照常拦截，否则这句 `/btw 问题` 会作为正文进主对话、还能触发工具。
      const interceptHostLocalCommand = !isRemotePage;

      // Intercept local slash commands — open dialogs instead of sending to agent
      // Desktop: /clear 已整端移除（2026-09-05 拍板），不再拦截 —— 手动敲 /clear
      // 作为普通消息发送（SDK 从未注册 clear，发给模型无害）；IDE 端保留拦截。
      // 远控页现在也拦截（第二批解禁）：`clearMessages` 已在白名单里，但它是**写**
      // 操作（换绑新 sessionId + 跑 Session hooks），所以页面上先确认一次再发
      // ——见 `pendingClearConfirm` 与下面那个 ConfirmDialog。
      if (!isDesktop && trimmedText === "/clear") {
        if (isRemotePage) setPendingClearConfirm(true);
        else handleClearChat();
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
      if (interceptHostLocalCommand && trimmedText === "/config") {
        // 不再弹窗：与点击头部设置按钮一致，打开设置页「全局设置」选项卡
        // （2026-08-29 用户拍板，对齐 /agents → subagents、/skills → skills；
        // 见 SettingsPage 全局设置视图）。
        handleOpenSettings();
        return;
      }
      if (interceptHostLocalCommand && trimmedText === "/plugin") {
        // 桌面端在设置页里不再有「插件市场」入口（spec ecosystem/plugin.md 场景 3、
        // A-016），视图只由侧边栏整页承载，故 /plugin 也落到整页；IDE 宿主没有
        // 侧边栏整页，仍唤起设置页并选中「插件市场」选项卡（对齐 /mcp、/skills）。
        if (isDesktop) {
          if (paneId !== undefined && onOpenPluginMarketFromPane) {
            // pane 实例只渲染自己的会话区，整页在 root 的 DesktopShell 上
            onOpenPluginMarketFromPane();
            return;
          }
          setPluginMarketOpen(true);
          setSettingsOpen(false);
          setSessionBoardOpen(false);
          // 侧栏三个整页入口互斥：/plugin 打开插件市场时也要收起创作集，
          // 否则会同时亮两个入口（2026-10-23 评论）。
          setArtifactsOpen(false);
          return;
        }
        handleOpenSettings("plugins");
        return;
      }
      if (interceptHostLocalCommand && trimmedText === "/reload-plugins") {
        // 插件变更的就地重载：不重建会话、不进对话，只让宿主把磁盘上的插件状态
        // 换装进当前进程内的 live 会话（docs/specs/ecosystem/plugin.md）。
        postToHost({ command: "reloadPlugins" });
        return;
      }
      if (interceptHostLocalCommand && trimmedText === "/mcp") {
        // 不再弹窗：唤起设置页并选中「MCP 服务」选项卡（2026-08-29 用户拍板，
        // 弹窗内容已迁移到设置页，见 SettingsMcpView）。
        handleOpenSettings("mcp");
        return;
      }
      if (trimmedText === "/status") {
        dispatch({ type: "SHOW_DIALOG", payload: { type: "status" } });
        return;
      }
      // `/tasks` 与 `/workflows`：数据由 shim 补齐（`backgroundTasksChange` /
      // `getSessionInfo.backgroundTasks` 与 `getWorkflowRuns`），所以远端照旧拦截
      // ——这两条是只读弹窗，不需要确认。
      if (trimmedText === "/tasks") {
        dispatch({ type: "SHOW_DIALOG", payload: { type: "tasks" } });
        return;
      }
      if (trimmedText === "/workflows" || trimmedText === "/workflows ") {
        dispatch({ type: "SHOW_DIALOG", payload: { type: "workflows" } });
        return;
      }
      if (interceptHostLocalCommand && trimmedText === "/remote-control") {
        // 手机接管本机会话（远端控制面）：不再弹窗，而是唤起设置页并选中
        // 「远程控制」选项卡（2026-10-17 用户拍板，与 /agents → subagents、
        // /skills → skills 同一条既有语义；对话框内容整块搬进了
        // SettingsRemoteControlView）。桌面端与 IDE 端都放行 —— 各自的会话就在
        // 自己那个 stdio 子进程里，手机要在哪套会话上做审批，就得由那台进程去连
        // relay。远控网页本身不拦（`interceptHostLocalCommand`）：那一页就是二维码
        // 指向的东西，在页面上给自己开一个「远程控制」入口是自我指涉。
        handleOpenSettings("remoteControl");
        return;
      }
      if (interceptHostLocalCommand && trimmedText === "/agents") {
        // 不再弹窗：唤起设置页并选中「子代理」选项卡（2026-08-29 用户拍板，
        // 弹窗内容已迁移到设置页，见 SettingsSubagentsView）。
        handleOpenSettings("subagents");
        return;
      }
      if (interceptHostLocalCommand && trimmedText === "/skills") {
        // 不再弹窗：唤起设置页并选中「技能」选项卡（见 SettingsSkillsView）。
        handleOpenSettings("skills");
        return;
      }
      if (interceptHostLocalCommand && trimmedText === "/hooks") {
        // 唤起设置页并选中「钩子」选项卡（对齐 /agents → subagents、/skills →
        // skills 的现有模式；见 SettingsHooksView）。
        handleOpenSettings("hooks");
        return;
      }
      // `/rewind`：检查点由宿主回（远端的 shim 转发 `listRewindCheckpoints`）。
      // 选中一条之后与消息上的回滚按钮走**同一个**确认框（`pendingRewindId`）。
      if (trimmedText === "/rewind") {
        if (stateRef.current.isStreaming) return;
        setRewindPopupOpen(true);
        setRewindCheckpointsLoading(true);
        postToHost({ command: "listRewindCheckpoints" });
        return;
      }
      if (trimmedText === "/resume") {
        // Desktop: scan the current conversation's host's disk (all projects),
        // so sessions this app never created are reachable. IDE hosts: reopen
        // the header popup over the already-loaded list — same scope as the
        // 「历史对话」 button, which the plugin cannot widen (no workspace switch).
        if (isDesktop) {
          const requestId = String(Date.now());
          resumeRequestIdRef.current = requestId;
          setResumeSessions([]);
          setResumeLoading(true);
          setResumePickerOpen(true);
          postToHost({ command: "desktopListResumeSessions", requestId });
        } else {
          setResumePickerOpen(true);
        }
        return;
      }
      // /btw side question — answered out-of-band via askBtw, never enters the chat.
      // Not behind `interceptHostLocalCommand`: the panel is this component's own UI,
      // so the remote page serves it too (route: shim → bridge `askBtw`).
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
        const panel: BtwPanelState = {
          question,
          answer: "",
          loading: true,
          contentStarted: false,
        };
        // 立刻落进会话快照（不等回写 effect）：本地的「这条在途」判据就是快照里
        // 那条 loading 的面板（keyByBtwQuestion），首个流式分片必须查得到。
        setBtwPanel(panel);
        if (btwKeyRef.current)
          sessionUi.patch(btwKeyRef.current, { btwPanel: panel });
        postToHost({ command: "askBtw", question });
        return;
      }
      // /plan — host-local command (CLI Ink overlay / IDE plan preview /
      // desktop Plan panel). Forwarded to the host instead of being sent to the
      // agent; the host switches to plan mode or shows the current plan. Not on
      // the remote page: there is no plan preview there and no place to show
      // the current plan except the ExitPlanMode card.
      if (
        interceptHostLocalCommand &&
        (trimmedText === "/plan" || trimmedText.startsWith("/plan "))
      ) {
        const args = trimmedText.slice("/plan".length).trim() || undefined;
        postToHost({ command: "planCommand", args });
        return;
      }

      // Desktop worktree flow (FR-023): on the first message of a new session
      // with the worktree checkbox on, create the worktree first — the main
      // process switches into it and forwards this message.
      if (paneId && groupKeyRef.current?.startsWith("new:"))
        sentFromNewSessionRef.current = true;
      // 判据见 isNewSessionState：`/rewind` 回到第一条、`/clear` 之后列表也是空
      // 的，但那条会话已经在跑（有 sessionId、在侧边栏、可能已有 worktree），
      // 此时发送必须走普通发送、在同一会话里继续，不得按新会话规则建 worktree。
      if (
        host?.type === "desktop" &&
        isNewSessionState(
          paneHasContentRef.current,
          stateRef.current.messages,
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
      isDesktop,
      isRemotePage,
      handleClearChat,
      handleOpenSettings,
      host,
      worktreeChecked,
      worktreeBranch,
      postToHost,
      paneId,
      gitBranches,
      onOpenPluginMarketFromPane,
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
  // 保存期间 configurationLoading=true 禁用保存按钮；host 回发
  // configurationResponse / configurationError 后落定复位（saving=false）。
  // 保存结果 toast 由宿主全局提示，设置页不渲染页面内反馈（见 spec
  // desktop-settings「设置页反馈语义」）。
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

  // 设置「个性化」AGENTS.md 编辑器保存：经 setAgentsContent RPC 写回文件（用户级
  // ~/.wave/AGENTS.md / 项目级 <workdir>/AGENTS.md），host 回发 agentsContentSaved
  // 复位 agentsSaving（成功/失败 toast 由宿主在回发时一并发出）。项目作用域携带
  // 当前 workdir 供 host 解析目标文件。
  const handleSaveAgentsContent = useCallback(
    (scope: "user" | "project", content: string) => {
      setAgentsSaving(true);
      vscode.postMessage({
        command: "setAgentsContent",
        scope,
        content,
        workdir: scope === "project" ? effectiveWorkdir : undefined,
      });
    },
    [vscode, effectiveWorkdir],
  );

  // A message counts as chat content only when the UI renders it — hidden meta
  // user messages (e.g. SessionStart hook additionalContext, isMeta: true) do
  // not, so they must not suppress the welcome page, the desktop new-session
  // pickers, or the desktop worktree trigger.
  const hasVisibleMessages = state.messages.some(
    (m) => !(m.role === "user" && m.isMeta),
  );

  // Welcome page shows only when there are no visible messages yet. An
  // unauthenticated user who sends a message must still see the chat, not the
  // welcome page.
  const showWelcome = !hasVisibleMessages;
  // Withhold the welcome page until the initial state (incl. auth status) has
  // arrived, otherwise logged-in users see the login CTA flash before
  // setInitialState updates isAuthenticated to true.
  const showWelcomeReady = showWelcome && state.initialized;
  // MessageInput 是否已挂载（输入区在欢迎页就绪或已有消息时渲染）。pane-scoped
  // ChatApp 在设置页关闭后重挂载，初始收不到 snapshot（LoadingLogo 无输入框），
  // 需等宿主 webviewReady 回放 setInitialState 后才真正挂载输入框。
  const inputAreaMounted = showWelcomeReady || !showWelcome;
  // 远控页此刻**一条会话都没有**（电脑侧全被删光 / 刚开机还没建）：页面手里既没有
  // sessionId、也没有任何 workdir，而「新建一条」必须先选目录——规格明确不允许
  // 「不选目录直接创建」（隐式落到服务进程的 cwd，spec remote/remote-web.md「Web 端
  // 也能发起新会话」场景 2）。所以这种状态下没有可发出去的会话：见 `inputDisabledReason`。
  const remotePageWithoutSession = isRemotePage && !state.currentSession;
  // 发送入口的禁用原因。三条原因互斥、同一时刻只有一条生效，**登录优先**：
  // 未登录必然发不出消息（实测：无凭据时既无模型请求、也不报错，只是静默挂住），
  // 而「桌面还没选目录」「远控页还没建会话」只是本地还没定位到项目——同时成立时先说
  // 更根本的那条。
  // 文案由本处派生、经 MessageInput 的 `placeholder` 口子传入（组件不硬编码原因），
  // 未禁用时传 undefined ⇒ 组件回落到默认的 /快捷指令 提示。
  // 复用 MessageInput 既有的 disabled 语义（contentEditable=false ＋ 发送/附件/
  // 快捷指令/权限模式按钮置灰）；禁用原因只写在输入框占位文案里——不新增提示行、
  // 不在输入区放登录按钮、不写「请去某处登录」的指路文案（登录入口用户自己能看见：
  // IDE 欢迎页 / 桌面左侧账户卡）。
  const unauthenticated = !state.isAuthenticated;
  const inputDisabledReason = unauthenticated
    ? "请先登录后再发送消息"
    : host?.type === "desktop" && !effectiveWorkdir
      ? "请先选择项目目录"
      : remotePageWithoutSession
        ? "请先新建对话并选择工作目录"
        : undefined;
  const inputDisabled = inputDisabledReason !== undefined;

  // pane-scoped ChatApp（paneId 非空，DesktopShell 内）：收到指向本 pane 的
  // prefillRequest（settings 关闭、pane 行重挂载后随行下发）→ 输入框就绪后
  // loadDraft 并回调 root 清除；编辑请求附带的 openFile 同时在右侧文件面板
  // 打开（与单布局 root effect 同一路径，仅落点为本 pane 自己的面板）。
  // effect 以 nonce 变化识别新请求；仅匹配 pane 收到请求（DesktopShell 过滤
  // targetPaneId），故此 effect 无跨 pane 竞态。若请求到达时输入框尚未挂载
  // （宿主 snapshot 未回放），pending 保持不下发、待 inputAreaMounted 翻转后
  // 本 effect 重跑补写。
  //
  // 闸门里必须有 `initialStateReceived`：pane 行重挂载后宿主先发 authStatusResponse
  // （initialized 置真 ⇒ inputAreaMounted 就为 true），随后才发 setInitialState；
  // 只等 inputAreaMounted 会在两条消息之间写入，写好的草案被快照按 inputContent
  // 重置成空（线上缺陷：设置页「新增钩子」跳回会话首屏看不到预填文本）。
  const prefillRequestNonce = prefillRequest?.nonce;
  const paneInitialStateReceived = state.initialStateReceived;
  useEffect(() => {
    if (paneId === undefined) return;
    if (!prefillRequest || prefillRequestNonce === undefined) return;
    if (!inputAreaMounted || !paneInitialStateReceived) return;
    if (state.isRestoring) return;
    const input = messageInputRef.current;
    if (!input) return;
    input.loadDraft(prefillRequest.prompt);
    if (prefillRequest.openFile) {
      openFileRef.current(prefillRequest.openFile);
    }
    onPrefillApplied?.(prefillRequest.nonce);
  }, [
    prefillRequest,
    prefillRequestNonce,
    paneId,
    onPrefillApplied,
    inputAreaMounted,
    paneInitialStateReceived,
    state.isRestoring,
  ]);

  // Initialize webview and load sessions on component mount
  useEffect(() => {
    dispatch({ type: "SET_SESSIONS_LOADING", payload: true });
    vscode.postMessage({
      command: "webviewReady",
    });
  }, [vscode]);

  const handleSessionSelect = useCallback(
    (sessionId: string) => {
      // 原地守卫（streaming / 压缩中 / 正在跑的后台任务）：恢复替换当前会话会把
      // 后台任务中断或与 UI 脱离，压缩中切换还会让压缩摘要写进切换后的会话
      // （spec message-compact「压缩期间的会话保护」）。远控页的「会话」入口不在
      // 此列——它只改页面自己这份视图，电脑侧那条会话照旧跑着（spec
      // remote/remote-web.md「Web 页作为第五种宿主」场景 10）。
      if (inPlaceGuard) return;

      const restore = () => {
        // 清空当前任务列表：避免恢复期间残留旧会话的任务，
        // 并让新会话任务从空状态进入（若全部已完成则直接保持隐藏）
        dispatch({ type: "SET_TASKS", payload: [] });

        postToHost({
          command: "restoreSession",
          sessionId,
        });
      };
      // 换会话会把 tabs 整份换掉，带草稿的 file tab 随之离开视野：先问（spec
      // desktop-file-panel.md「文件面板内编辑与保存」场景 6）。
      if (!hasDirtyDraft()) {
        restore();
        return;
      }
      void askDiscardUnsavedDraft().then((discard) => {
        if (!discard) return;
        discardAllDrafts();
        restore();
      });
    },
    [inPlaceGuard, postToHost, hasDirtyDraft, discardAllDrafts],
  );

  const handleInputCleared = useCallback(() => {
    dispatch({ type: "INPUT_CLEARED" });
  }, []);

  /**
   * `/resume` picker selection. IDE hosts go through handleSessionSelect so the
   * restore path and its streaming/background-task guard are exactly the ones
   * the 「历史对话」 list uses. Desktop picks arrive from the disk scan, which
   * carries the session's own workdir — the host switches the pane to that
   * session (spawning/activating it) after verifying the directory exists.
   */
  const handleResumeSelect = useCallback(
    (sessionId: string) => {
      setResumePickerOpen(false);
      if (!isDesktop) {
        handleSessionSelect(sessionId);
        return;
      }
      const session = resumeSessions.find((s) => s.id === sessionId);
      if (!session?.workdir) return;
      const resume = () =>
        postToHost({
          command: "desktopResumeSession",
          sessionId,
          workdir: session.workdir,
        });
      // 桌面端的 `/resume` 是宿主侧换会话（同 handleSessionSelect 的离开语义）。
      if (!hasDirtyDraft()) {
        resume();
        return;
      }
      void askDiscardUnsavedDraft().then((discard) => {
        if (!discard) return;
        discardAllDrafts();
        resume();
      });
    },
    [
      isDesktop,
      resumeSessions,
      handleSessionSelect,
      postToHost,
      hasDirtyDraft,
      discardAllDrafts,
    ],
  );

  const handleResumeClose = useCallback(() => {
    setResumePickerOpen(false);
    // Drop the correlation so a scan still in flight cannot repopulate a
    // closed picker.
    resumeRequestIdRef.current = "";
  }, []);

  // Desktop panel comments (preview element picks, diff-line comments) land in
  // this pane's input (not sent), so several can be batched and edited before
  // sending.
  //
  // 2026-09-16 需求八起，预览全屏里这块输入框以**浮动对话框**形态留在视野内
  // （见下方 desktop-chat-body 的 preview-fullscreen 分支），所以评论不再需要先
  // 退出全屏才能被看到：在全屏里点元素加评论，标注就直接出现在右下角的对话框里。
  //
  // 仍然入队而不是同一个 tick 里直接 appendText：输入区可能还没挂载（欢迎页等
  // snapshot 落地的半就绪窗口），同一个 tick 写会落空。队列由紧随其后的 effect 在
  // 「输入区已挂载」后再写入（与 #2496 预填提示词同一条「就绪后写入」路径）。
  // 队列是**追加**语义（分隔符与 MessageInput.appendText 保持一致）：用户连点几个
  // 元素攒评论，绝不能覆盖已经攒下的内容。
  const [pendingCommentAppend, setPendingCommentAppend] = useState<
    string | null
  >(null);
  const handleAddComment = useCallback((text: string) => {
    setPendingCommentAppend((prev) => (prev ? `${prev}\n\n${text}` : text));
  }, []);

  // 评论排队等输入框就绪。闸门只有「输入区已挂载 + 不在恢复态 + ref 拿得到」——
  // 比预填提示词（#2496）那道闸门少一个 `initialStateReceived`，理由是这个窗口里
  // 不存在「写入被快照重置」的风险：预填是**程序化**地在刚挂载的输入框里灌一个草稿，
  // 会撞上 authStatusResponse 与 setInitialState 之间的半就绪窗口；而评论追加发生在
  // 面板已经用起来的时段（快照早落地），写进去的文本同时经 updateInputContent 回到
  // 宿主草稿，迟到的快照拿到的是同一份内容。把快照也当闸门反而有害：宿主没回放快照
  // 的路径（老 demo / 无快照宿主）会让评论卡在队列里不发。
  useEffect(() => {
    if (pendingCommentAppend === null) return;
    if (!inputAreaMounted || state.isRestoring) return;
    const input = messageInputRef.current;
    if (!input) return;
    input.appendText(pendingCommentAppend);
    setPendingCommentAppend(null);
  }, [pendingCommentAppend, inputAreaMounted, state.isRestoring]);

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

  // 「把本轮转到后台」：与输入框里的 Ctrl/Cmd+B 是同一条命令、同一段宿主逻辑
  // （`backgroundCurrentTask`），这里只是把它做成一个可见入口——四个 GUI 宿主
  // 都已注册，远控页亦然（spec: task-background-execution.md「前台工具后台化」）。
  // 不弹确认：它不杀任务、不删文件、不动会话，只是把执行位置换到后台。
  const handleBackgroundCurrentTask = useCallback(() => {
    postToHost({ command: "backgroundCurrentTask" });
  }, [postToHost]);

  // Web Push 通知开关（spec remote/remote-pwa.md「锁屏也能知道」）：手机页是唯一跑在
  // 浏览器里、能持有推送订阅的宿主，所以这段只有它有。页面侧 shim 才是两个事实的
  // 持有者（浏览器能力位、中继登记的订阅 id），这里不问就不猜：挂载时问一次，之后
  // 每次开 / 关都由 shim 把四个事实整组发回来（见 `pushState` 那条 case）。
  const [pushState, setPushState] = useState<PushState | undefined>(undefined);
  useEffect(() => {
    if (!isRemotePage) return;
    vscode.postMessage({ command: "getPushState" });
  }, [isRemotePage, vscode]);
  const pushNotifications = useMemo<PushNotificationControl | undefined>(
    () =>
      isRemotePage && pushState
        ? {
            state: pushState,
            onEnable: () =>
              vscode.postMessage({ command: "enablePushNotifications" }),
            onDisable: () =>
              vscode.postMessage({ command: "disablePushNotifications" }),
          }
        : undefined,
    [isRemotePage, pushState, vscode],
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

  // 底栏选中一个模型：即时回显新模型名（不等宿主回执——setModel 在会话内是同步
  // 生效的），再让宿主落盘。远控页先落进 `pendingModelSwitch`：`setModel` 写的是
  // 用户级配置文件，换的是这台机器上所有会话（以及此后新开的）的模型，值得在手机
  // 上问一次（spec remote/remote-web.md「页面能执行的那批宿主命令」）。
  const handleModelSelect = useCallback(
    (model: string) => {
      if (isRemotePage) {
        setPendingModelSwitch(model);
        return;
      }
      setCurrentModel(model);
      postToHost({ command: "setModel", model });
      messageInputRef.current?.focus();
    },
    [isRemotePage, postToHost],
  );

  // Close the /btw panel of the conversation on screen. 面板置 null 就是「这条不再
  // 在途」的判据，于是迟到的流式增量与最终回答都无处可落（场景 10，与切走不同：
  // 切走只是隐去，切回来还能看到）。别的会话在途的那份不受影响——它们各存各的。
  const handleBtwClose = useCallback(() => {
    if (btwKeyRef.current)
      sessionUi.patch(btwKeyRef.current, { btwPanel: null });
    setBtwPanel(null);
    messageInputRef.current?.focus();
  }, []);

  // Preview fullscreen is conversation-scoped: switching to another
  // conversation always exits it (unlike the /btw panel, which is retained per
  // conversation — see the btw swap/sync effects near the panel-group ones).
  // ChatApp stays mounted across sidebar session switches, so the local
  // fullscreen state would otherwise survive into the next conversation.
  // Fullscreen belongs to the outgoing session's preview tab — a stale true
  // hides the conversation column and the panel slot with no UI left to
  // restore it (关闭全屏预览后对话框消失, PM bug 3465519197988352). Switching
  // conversations is the universal escape hatch. `previous !== undefined`
  // keeps the initial mount a no-op.
  const fullscreenSessionRef = useRef<string | undefined>(undefined);
  useEffect(() => {
    const sessionId = state.currentSession?.id;
    const previous = fullscreenSessionRef.current;
    fullscreenSessionRef.current = sessionId;
    if (previous !== undefined && previous !== sessionId) {
      setPreviewFullscreen(false);
    }
  }, [state.currentSession?.id]);

  // 模型清单与当前模型由宿主解析（settings.json / env 链），底栏要随时显示，所以
  // 挂载时拉一次、会话一换再拉一次（每个会话的 agent 可以带自己的 `--model`）。
  // 远端页也拉（shim 已转发 `getConfiguredModels`），否则手机上的选择器没有候选。
  // 宿主没有 agent 时回空清单 → 选择器自己隐藏；首个会话建好后再拉就有值了。
  const modelSessionId = state.currentSession?.id;
  useEffect(() => {
    postToHost({ command: "getConfiguredModels" });
  }, [modelSessionId, postToHost]);

  const handleClearConfirm = useCallback(() => {
    setPendingClearConfirm(false);
    handleClearChat();
  }, [handleClearChat]);

  const handleModelSwitchConfirm = useCallback(() => {
    const model = pendingModelSwitch;
    setPendingModelSwitch(null);
    if (model) {
      setCurrentModel(model);
      postToHost({ command: "setModel", model });
    }
    messageInputRef.current?.focus();
  }, [pendingModelSwitch, postToHost]);

  /** 插件变更强引导弹窗的确认：走既有 `reloadPlugins` 命令（与 `/reload-plugins`
   *  同一条就地重载路径，不重建会话、不打断正在生成的回合）。 */
  const handlePluginReloadConfirm = useCallback(() => {
    setPluginChangePending(false);
    postToHost({ command: "reloadPlugins" });
  }, [postToHost]);

  const handleRewindConfirm = useCallback(() => {
    const messageId = pendingRewindId;
    setPendingRewindId(null);
    if (messageId) {
      // The host replies with `rewindResult` on this requestId; the list itself
      // is never re-sent — the reply is what authorizes the local cut below.
      const requestId = `rewind-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      pendingRewindsRef.current.set(requestId, messageId);
      postToHost({
        command: "rewindToMessage",
        messageId,
        requestId,
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
      sessionUi.patch(groupKey, { forward: fwd });
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

  // Tabbed layout: opening a panel no longer auto-replaces existing panels
  // (the old multi-select side-by-side model is gone — see spec
  // desktop-right-panel.md「右侧面板 · 展开/折叠、空间守卫与欢迎页共存」): the shared
  // slot space guard below refuses with a hint when the conversation column
  // cannot keep its minimum width, and never closes existing tabs.
  // Generates a fresh tab id (kind-prefixed, monotonically increasing per kind).
  const genTabId = useCallback((kind: DesktopPanelKind): string => {
    tabSeqRef.current[kind] += 1;
    return `${kind}-${tabSeqRef.current[kind]}`;
  }, []);

  // Auto 40/60 split (spec desktop-right-panel.md「右侧面板 · 展开/折叠、空间守卫与
  // 欢迎页共存」场景 7-9): a slot width the user has never manually dragged
  // re-splits the row whenever the panel opens — the conversation keeps ~40%
  // (floor CHAT_MAIN_MIN_WIDTH), the slot takes the remainder. A manual drag
  // (handlePanelWidthChange) marks the slot and locks its width from then on
  // (「手动拖宽后锁定」). Reads the live container width, so a window resize is
  // reflected on the next open/expand.
  const autoFillPanelWidth = useCallback((): void => {
    if (panelWidthManualRef.current) return;
    const containerW = chatContainerRef.current?.getBoundingClientRect().width;
    if (!containerW) return;
    setPanelWidth(autoPanelWidth(containerW));
  }, []);

  // Expanding the panel — from collapsed, from the empty state, or on first
  // mount with restored tabs — re-applies the auto 40/60 split so the slot
  // tracks the space currently available, unless the user dragged the width by
  // hand. (Opening a NEW tab runs its own auto-split through
  // ensurePanelSpace below.)
  const prevPanelExpandedRef = useRef<boolean | null>(null);
  useEffect(() => {
    const was = prevPanelExpandedRef.current;
    prevPanelExpandedRef.current = panelExpanded;
    if (panelExpanded && was !== true) autoFillPanelWidth();
  }, [panelExpanded, autoFillPanelWidth]);

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
      // Never-dragged slots re-apply the 40/60 auto split (spec
      // desktop-right-panel.md「右侧面板 · 展开/折叠」场景 7-9); manual ones keep their
      // width and are only clamped when the window shrank past them.
      if (!panelWidthManualRef.current) {
        setPanelWidth(autoPanelWidth(containerW));
      } else if (panelWidthRef.current > containerW - CHAT_MAIN_MIN_WIDTH) {
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
  // back to its left neighbor (PreviewPane closeTab convention). Browser-tab
  // semantics: closing destroys the instance — re-opening via a link or "＋"
  // creates a fresh one (terminal PTYs / preview guests do not survive close).
  // Closing the LAST tab takes the slot down with it (spec desktop-right-panel.md
  // 场景 10: 关闭最后一个 tab 时右侧面板随之一并收起，不显示空态) — the
  // "expanded but no tabs" empty state is only ever reached by the user
  // explicitly expanding the panel, never as the leftover of a close.
  const handleCloseTab = useCallback(
    (tabId: string) => {
      const tabs = tabsRef.current;
      const idx = tabs.findIndex((t) => t.id === tabId);
      if (idx === -1) return;
      const closed = tabs[idx];
      const doClose = () => {
        // Re-read: the confirm dialog can be answered a tick later, and the
        // tab list may have moved on meanwhile.
        const current = tabsRef.current;
        const at = current.findIndex((t) => t.id === tabId);
        if (at === -1) return;
        const removed = current[at];
        const next = current.filter((t) => t.id !== tabId);
        setTabs(next);
        if (activeTabIdRef.current === tabId) {
          setActiveTabId(next.length ? next[Math.max(0, at - 1)].id : null);
        }
        // Closing a local-.html preview tab releases the pane's re-hosting
        // server reference; with the last reference the host tears the server
        // down (spec desktop-preview.md「本地 HTML 文件预览」 scenario 8). The
        // release is keyed by the tab's file path — other tabs previewing other
        // files (even on the same served root) keep their server alive.
        if (removed.kind === "preview" && removed.previewFilePath) {
          pendingPreviewFallbackRef.current.delete(removed.id);
          postToHost({
            command: "desktopPreviewFileRelease",
            path: removed.previewFilePath,
          });
        }
        if (removed.kind === "preview" || next.length === 0) {
          setPreviewFullscreen(false);
        }
        if (next.length === 0) setPanelExpanded(false);
      };
      // 关掉带草稿的 file tab 等于丢弃它名下所有文件的草稿：先问（spec
      // desktop-file-panel.md「文件面板内编辑与保存」场景 6）。
      if (openFilesOf(closed).some((f) => isFileViewDirty(f.fileView))) {
        void askDiscardUnsavedDraft().then((discard) => {
          if (discard) doClose();
        });
        return;
      }
      doClose();
    },
    [postToHost],
  );

  // Header 面板按钮: expand/collapse the right-hand panel (spec
  // desktop-right-panel.md「右侧面板 · 展开/折叠、空间守卫与欢迎页共存」). Collapsing
  // hides the slot but keeps every tab instance mounted
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
  // Clearing the last remaining tab this way collapses the slot too (same rule
  // as the tab close button, spec 场景 10).
  const handleTogglePanel = useCallback(
    (kind: DesktopPanelKind) => {
      if (panelDisabledRef.current.includes(kind)) return;
      if (tabsRef.current.some((t) => t.kind === kind)) {
        const doClose = () => {
          const closing = tabsRef.current.filter((t) => t.kind === kind);
          const next = tabsRef.current.filter((t) => t.kind !== kind);
          setTabs(next);
          const active = activeTabIdRef.current;
          if (active && !next.some((t) => t.id === active)) {
            setActiveTabId(next.length ? next[next.length - 1].id : null);
          }
          if (kind === "preview" || next.length === 0) {
            setPreviewFullscreen(false);
          }
          // Same release as handleCloseTab when the menu closes every preview
          // tab of the kind (including local-.html preview tabs) — one release
          // per closed file-previewing tab, keyed by its path.
          if (kind === "preview") {
            for (const t of closing) {
              if (t.kind === "preview" && t.previewFilePath) {
                pendingPreviewFallbackRef.current.delete(t.id);
                postToHost({
                  command: "desktopPreviewFileRelease",
                  path: t.previewFilePath,
                });
              }
            }
          }
          if (next.length === 0) setPanelExpanded(false);
        };
        // 取消勾选「文件」会关掉所有 file tab，等于丢弃其中的草稿：先问（spec
        // desktop-file-panel.md「文件面板内编辑与保存」场景 6）。
        if (kind === "file" && hasDirtyDraft()) {
          void askDiscardUnsavedDraft().then((discard) => {
            if (discard) doClose();
          });
          return;
        }
        doClose();
      } else {
        tryOpenPanel(kind);
      }
    },
    [tryOpenPanel, postToHost, hasDirtyDraft],
  );

  useEffect(() => {
    togglePanelRef.current = handleTogglePanel;
  }, [handleTogglePanel]);

  // .html / .htm check for the desktop preview routing (spec
  // desktop-preview.md「本地 HTML 文件预览」— scope is exactly these two
  // extensions; .svg keeps its inline-image path in the file panel).
  const isHtmlPath = (p: string) => /\.(html|htm)$/i.test(p);

  // Desktop .html path click → preview tab (spec「本地 HTML 文件预览」).
  // Same file (normalized absolute path) activates its existing tab and
  // re-requests the URL (scenario 2); a different file adds a new preview
  // tab (multi-instance). The tab starts blank (loading shell) and is filled
  // by the desktopPreviewFileResult reply; an error reply closes the
  // placeholder and falls back to the file panel (scenario 4).
  const handlePreviewHtmlFile = useCallback(
    (path: string) => {
      const normalized = toAbsoluteFilePath(path, effectiveWorkdir) ?? path;
      const existing = tabsRef.current.find(
        (t) =>
          t.kind === "preview" &&
          t.previewFilePath !== undefined &&
          t.previewFilePath === normalized,
      );
      const requestId = `preview-file-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      let tabId: string;
      if (existing) {
        tabId = existing.id;
        setActiveTabId(tabId);
        setPanelExpanded(true);
      } else {
        const id = addTab({
          kind: "preview",
          previewFilePath: normalized,
          previewTitle: normalized.split(/[\\/]/).pop() || normalized,
        });
        if (id === null) return; // space guard refused
        tabId = id;
      }
      previewFileRequestsRef.current.set(requestId, {
        tabId,
        path: normalized,
      });
      pendingPreviewFallbackRef.current.set(tabId, { path: normalized });
      postToHost({
        command: "desktopPreviewFile",
        path: normalized,
        requestId,
      });
    },
    [addTab, effectiveWorkdir, postToHost],
  );

  // Desktop file panel (spec: 文件面板): a file path clicked in a message or
  // terminal opens here instead of the OS. Show the panel immediately with a
  // loading stub; the host reads the file (local fs or over ssh) and replies
  // with desktopFileContent to fill it in. The host is captured per-pane so a
  // split-view sibling's click never resolves against this pane's host.
  // IDE hosts (VSCE/JetBrains) keep the plain openFile RPC that opens the file
  // in the IDE — only the desktop host intercepts the click for the panel.
  // Desktop .html/.htm paths are previewed instead (desktop-preview.md「本地
  // HTML 文件预览」): the host re-hosts the file on a loopback server and the
  // reply fills a preview tab; errors fall back to the file panel below.
  const openFileInPanelRef = useRef<
    (path: string, startLine?: number, endLine?: number) => void
  >(() => {});

  // The file-panel body of handleOpenFile (no .html routing) — used directly
  // by the preview fallback so a refused preview can never loop back into
  // preview routing.
  // ---- 标签带（spec「文件面板已打开文件的标签」）----------------------------
  // 面板是单实例的：第一个 file tab 承载整条标签带（`openFiles` +
  // `activeFileId` 都在它身上），标签带上的操作也都落在它身上。
  const genFileId = useCallback((): string => {
    openFileSeqRef.current += 1;
    return `f${openFileSeqRef.current}`;
  }, []);

  const updateFileTab = useCallback(
    (tabId: string, patch: (t: PanelTab) => PanelTab) => {
      setTabs((prev) => prev.map((t) => (t.id === tabId ? patch(t) : t)));
    },
    [],
  );

  const openFileInPanel = useCallback(
    (path: string, startLine?: number, endLine?: number) => {
      // 面板内多标签（spec「文件面板已打开文件的标签」）：同一条路径已经在条上
      // 就激活它并软刷新（旧内容留着直到回包落地，和差异面板同一手感）；不在条
      // 上就追加一个标签。面板本身是单实例的，所以承载整条标签带的一级 file tab
      // 只有第一个，不再为每个文件开一级 tab。
      const existing = tabsRef.current.find((t) => t.kind === "file");
      if (existing) {
        setActiveTabId(existing.id);
        setPanelExpanded(true);
        const already = openFilesOf(existing).find((f) => f.path === path);
        const fileId = already?.id ?? genFileId();
        updateFileTab(existing.id, (t) => {
          const loadingView: FileViewState = {
            ...(already?.fileView ?? { path, host: effectiveHost }),
            path,
            // 重新读一次就把上一次失败的痕迹清掉（「不存在」也在内）：读的过程中
            // 既不该留着旧错误横幅，也不该留着「已删除」标记。
            error: undefined,
            missing: undefined,
            loading: true,
            startLine,
            endLine,
          };
          const openFiles = already
            ? openFilesOf(t).map((f) =>
                f.id === fileId
                  ? {
                      ...f,
                      deleted: undefined,
                      startLine,
                      endLine,
                      fileView: loadingView,
                    }
                  : f,
              )
            : [
                ...openFilesOf(t),
                { id: fileId, path, startLine, endLine, fileView: loadingView },
              ];
          // 新打开的文件一律进入文件视图：这也是同一条 path 被再次点开时视图能
          // 从列表切回来的唯一开关。
          return { ...t, listMode: undefined, activeFileId: fileId, openFiles };
        });
      } else {
        const fileId = genFileId();
        if (
          addTab({
            kind: "file",
            activeFileId: fileId,
            openFiles: [
              {
                id: fileId,
                path,
                startLine,
                endLine,
                fileView: {
                  path,
                  host: effectiveHost,
                  loading: true,
                  startLine,
                  endLine,
                },
              },
            ],
          }) === null
        ) {
          return; // space guard refused — nothing opened
        }
      }
      postToHost({
        command: "openFile",
        path,
        host: effectiveHost,
        startLine,
        endLine,
      });
    },
    [addTab, effectiveHost, genFileId, postToHost, updateFileTab],
  );
  useEffect(() => {
    openFileInPanelRef.current = openFileInPanel;
  }, [openFileInPanel]);

  /** The file tab that owns this open file (undefined = it was closed). */
  const fileTabOf = useCallback(
    (fileId: string) =>
      tabsRef.current.find((t) => openFilesOf(t).some((f) => f.id === fileId)),
    [],
  );

  /**
   * 关掉标签带上的文件（单个 / 其他 / 右侧 / 全部）。带草稿的先问（spec
   * desktop-file-panel.md「文件面板内编辑与保存」场景 6）——多标签下关一个标签只
   * 丢它自己的草稿，条上其余文件连同草稿都还在。
   */
  const closeFilesByIds = useCallback(
    (tabId: string, ids: string[]) => {
      if (ids.length === 0) return;
      const idset = new Set(ids);
      const tab = tabsRef.current.find((t) => t.id === tabId);
      if (!tab) return;
      const doomed = openFilesOf(tab).filter((f) => idset.has(f.id));
      if (doomed.length === 0) return;
      const run = () =>
        updateFileTab(tabId, (t) => {
          const all = openFilesOf(t);
          const openFiles = all.filter((f) => !idset.has(f.id));
          if (openFiles.length === all.length) return t;
          // 关掉的正是激活文件时，激活位让给剩下的最后一个；全关光就没有激活
          // 文件，面板回列表/空态（spec 场景 14）。
          return {
            ...t,
            openFiles,
            activeFileId: openFiles.some((f) => f.id === t.activeFileId)
              ? t.activeFileId
              : openFiles[openFiles.length - 1]?.id,
          };
        });
      if (doomed.some((f) => isFileViewDirty(f.fileView))) {
        void askDiscardUnsavedDraft().then((discard) => {
          if (discard) run();
        });
        return;
      }
      run();
    },
    [updateFileTab],
  );

  /** 点标签：激活；点的就是激活的那个 = 重新读盘（和浏览器标签同一手感）。 */
  const handleActivateFile = useCallback(
    (fileId: string) => {
      const tab = fileTabOf(fileId);
      if (!tab) return;
      if (tab.activeFileId === fileId) {
        const file = openFilesOf(tab).find((f) => f.id === fileId);
        if (file) openFileInPanelRef.current(file.path);
        return;
      }
      updateFileTab(tab.id, (t) => ({
        ...t,
        activeFileId: fileId,
        listMode: undefined,
      }));
    },
    [fileTabOf, updateFileTab],
  );

  const handleCloseFile = useCallback(
    (fileId: string) => {
      const tab = fileTabOf(fileId);
      if (tab) closeFilesByIds(tab.id, [fileId]);
    },
    [closeFilesByIds, fileTabOf],
  );

  const handleCloseOtherFiles = useCallback(
    (fileId: string) => {
      const tab = fileTabOf(fileId);
      if (!tab) return;
      closeFilesByIds(
        tab.id,
        openFilesOf(tab)
          .filter((f) => f.id !== fileId)
          .map((f) => f.id),
      );
    },
    [closeFilesByIds, fileTabOf],
  );

  const handleCloseFilesRight = useCallback(
    (fileId: string) => {
      const tab = fileTabOf(fileId);
      if (!tab) return;
      const files = openFilesOf(tab);
      const index = files.findIndex((f) => f.id === fileId);
      if (index < 0) return;
      closeFilesByIds(
        tab.id,
        files.slice(index + 1).map((f) => f.id),
      );
    },
    [closeFilesByIds, fileTabOf],
  );

  const handleCloseAllFiles = useCallback(() => {
    const tab = tabsRef.current.find((t) => t.kind === "file");
    if (!tab) return;
    closeFilesByIds(
      tab.id,
      openFilesOf(tab).map((f) => f.id),
    );
  }, [closeFilesByIds]);

  /** 标签重排（Ctrl/Cmd+Shift+←/→）：挪一格，到头就停。 */
  const handleReorderFile = useCallback(
    (fileId: string, delta: number) => {
      const tab = fileTabOf(fileId);
      if (!tab) return;
      updateFileTab(tab.id, (t) => {
        const files = [...openFilesOf(t)];
        const from = files.findIndex((f) => f.id === fileId);
        const to = from + delta;
        if (from < 0 || to < 0 || to >= files.length) return t;
        const [moved] = files.splice(from, 1);
        files.splice(to, 0, moved);
        return { ...t, openFiles: files };
      });
    },
    [fileTabOf, updateFileTab],
  );

  // 「返回文件列表」：只翻列表标志，文件内容仍留在条上——这样正在飞行的
  // desktopFileContent 回复（按 path 归到同一个文件）落下来也不会把用户从列表
  // 拽回文件视图；再次点开同一文件时 openFileInPanel 清掉该标志。
  const handleFilePaneBackToList = useCallback(() => {
    setTabs((prev) =>
      prev.map((t) =>
        t.kind === "file" && openFilesOf(t).length > 0
          ? { ...t, listMode: true }
          : t,
      ),
    );
  }, []);

  // ---- 文件面板内编辑（spec desktop-file-panel.md「文件面板内编辑与保存」）------
  // 草稿落在 `OpenFileTab.fileView.draft` 里，而不是面板组件的内部 state：一级 tab
  // 切换时面板只是 display:none（组件仍活着），但换会话会把整份 tabs 换掉——草稿
  // 跟着文件走才谈得上「切回来还在」，也才能被「离开前统一确认」看见。多标签下
  // 一份草稿只属于它自己的那个文件，切到别的文件不会丢。
  const fileSaveRequestsRef = useRef<Map<string, string>>(new Map());
  const fileSaveSeqRef = useRef(0);

  /** 本 pane 正在看着/编辑的那个文件：编辑类回调都从这里取，没有第二份状态。 */
  const activeFileCtx = useCallback(() => {
    for (const t of tabsRef.current) {
      const file = activeFileOf(t);
      if (file) return { tab: t, file };
    }
    return null;
  }, []);

  /** Patch whichever file the panel is showing (the edit callbacks' target). */
  const patchActiveFile = useCallback(
    (patch: (f: OpenFileTab) => OpenFileTab) => {
      const ctx = activeFileCtx();
      if (!ctx) return;
      patchFileByIdRef.current(ctx.file.id, patch);
    },
    [activeFileCtx],
  );

  /** Patch one open file by id, wherever it lives in this pane's tabs. */
  const patchFileById = useCallback(
    (fileId: string, patch: (f: OpenFileTab) => OpenFileTab) => {
      setTabs((prev) => prev.map((t) => patchOpenFile(t, fileId, patch)));
    },
    [],
  );
  const patchFileByIdRef = useRef(patchFileById);
  patchFileByIdRef.current = patchFileById;

  // 登记给窗口级导航（换会话 / 换工作目录 / 新建 / 删除）做守卫：那些动作的入口
  // 在 DesktopApp / DesktopShell，拿不到本 pane 的 tabs。
  useEffect(
    () =>
      registerDraftSource({
        hasDirty: hasDirtyDraft,
        discard: discardAllDrafts,
      }),
    [hasDirtyDraft, discardAllDrafts],
  );

  // 「放弃未保存的修改？」只由窗口根实例渲染（与 showToast 同一条口径：多分屏不
  // 叠层）。pane 实例发起时也走同一个 asker，答案回同一个 Promise。
  useEffect(() => {
    if (myPane !== undefined) return;
    setDiscardAsker(
      () =>
        new Promise<boolean>((resolve) => {
          draftDiscardResolversRef.current.push(resolve);
          setDraftDiscardOpen(true);
        }),
    );
    return () => setDiscardAsker(null);
  }, [myPane]);

  const settleDraftDiscard = useCallback((discard: boolean) => {
    setDraftDiscardOpen(false);
    const resolvers = draftDiscardResolversRef.current;
    draftDiscardResolversRef.current = [];
    for (const resolve of resolvers) resolve(discard);
  }, []);

  /** 退出编辑态：草稿丢弃，正文回到已读到的 `content`。 */
  const exitFileEdit = useCallback(
    (fileId: string) => {
      patchFileById(fileId, (f) =>
        f.fileView
          ? {
              ...f,
              fileView: {
                ...f.fileView,
                draft: undefined,
                saving: undefined,
                saveError: undefined,
                diskChanged: undefined,
              },
            }
          : f,
      );
    },
    [patchFileById],
  );

  const handleFileStartEdit = useCallback(() => {
    patchActiveFile((f) =>
      f.fileView
        ? {
            ...f,
            fileView: {
              ...f.fileView,
              draft: f.fileView.content ?? "",
              saveError: undefined,
              diskChanged: undefined,
            },
          }
        : f,
    );
  }, [patchActiveFile]);

  const handleFileDraftChange = useCallback(
    (value: string) => {
      patchActiveFile((f) =>
        f.fileView?.draft !== undefined
          ? { ...f, fileView: { ...f.fileView, draft: value } }
          : f,
      );
    },
    [patchActiveFile],
  );

  const handleFileCancelEdit = useCallback(() => {
    const ctx = activeFileCtx();
    if (!ctx) return;
    if (!isFileViewDirty(ctx.file.fileView)) {
      exitFileEdit(ctx.file.id);
      return;
    }
    void askDiscardUnsavedDraft().then((discard) => {
      if (discard) exitFileEdit(ctx.file.id);
    });
  }, [activeFileCtx, exitFileEdit]);

  const handleFileSave = useCallback(
    (content: string) => {
      const ctx = activeFileCtx();
      const fileView = ctx?.file.fileView;
      if (!fileView || fileView.draft === undefined || fileView.saving) return;
      const fileId = ctx.file.id;
      // 与读到的内容一致 = 没做修改：不写盘，直接退出编辑态（场景 4）。磁盘期间
      // 变过的话顺手重读一次，让正文回到磁盘内容。
      if (content === fileView.content) {
        if (fileView.diskChanged) openFileInPanelRef.current(fileView.path);
        exitFileEdit(fileId);
        return;
      }
      // 没有哈希就没有乐观并发校验的基准，不能写（可写性由宿主判定，这里只是兜底）。
      if (!fileView.contentHash) return;
      const requestId = `${Date.now()}-${++fileSaveSeqRef.current}`;
      fileSaveRequestsRef.current.set(requestId, fileId);
      patchFileById(fileId, (f) =>
        f.fileView
          ? {
              ...f,
              fileView: {
                ...f.fileView,
                // 以编辑器此刻的全文为准（onChange 与保存是两次事件）。
                draft: content,
                saving: true,
                saveError: undefined,
              },
            }
          : f,
      );
      postToHost({
        command: "desktopSaveFile",
        path: fileView.path,
        content,
        contentHash: fileView.contentHash,
        requestId,
      });
    },
    [activeFileCtx, exitFileEdit, patchFileById, postToHost],
  );

  /** 「重新加载」：丢弃草稿并按既有 openFile 链路重读磁盘（场景 7）。 */
  const handleFileReload = useCallback(() => {
    const ctx = activeFileCtx();
    if (!ctx?.file.fileView) return;
    exitFileEdit(ctx.file.id);
    openFileInPanelRef.current(ctx.file.fileView.path);
  }, [activeFileCtx, exitFileEdit]);

  /**
   * 自动刷新（spec「文件面板自动刷新」）落在带草稿的文件上时的替代动作：不重读
   * （重读会把还没保存的修改吞掉），只把「磁盘变了」告诉面板，由用户选覆盖还是
   * 重新加载（场景 8）。
   */
  const handleFileAutoRefresh = useCallback(
    (path: string) => {
      const hit = allOpenFiles(tabsRef.current).find((f) => f.path === path);
      if (!hit) return;
      if (hit.fileView?.draft === undefined) {
        openFileInPanelRef.current(path);
        return;
      }
      patchFileById(hit.id, (f) =>
        f.fileView
          ? { ...f, fileView: { ...f.fileView, diskChanged: true } }
          : f,
      );
    },
    [patchFileById],
  );

  const handleOpenFile = useCallback(
    (path: string, startLine?: number, endLine?: number) => {
      if (!path) return;
      const run = () => {
        if (!isDesktop) {
          vscode.postMessage({ command: "openFile", path, startLine, endLine });
          return;
        }
        if (isHtmlPath(path)) {
          handlePreviewHtmlFile(path);
          return;
        }
        openFileInPanel(path, startLine, endLine);
      };
      // 编辑中打开另一个文件不再丢弃任何草稿——面板内多标签后草稿跟着文件走
      // （spec「文件面板已打开文件的标签」），只有「要打开的正是正在编辑的那个
      // 文件」这一条还得让 openFileInPanel 走软刷新（它会重读，回包按草稿优先
      // 处理）。其余情况不需要问。
      const sameFileBeingEdited = allOpenFiles(tabsRef.current).some(
        (f) => f.path === path && f.fileView?.draft !== undefined,
      );
      if (!isDesktop || sameFileBeingEdited || !hasDirtyDraft()) {
        run();
        return;
      }
      void askDiscardUnsavedDraft().then((discard) => {
        if (!discard) return;
        discardAllDrafts();
        run();
      });
    },
    [
      isDesktop,
      vscode,
      handlePreviewHtmlFile,
      openFileInPanel,
      hasDirtyDraft,
      discardAllDrafts,
    ],
  );

  // prefill 应用 effect（位于本 useCallback 定义之前）经 ref 调用最新
  // handleOpenFile —— 打开编辑请求附带的配置文件到右侧文件面板。
  useEffect(() => {
    openFileRef.current = handleOpenFile;
  }, [handleOpenFile]);

  // Desktop file panel auto-refresh (spec: 文件面板自动刷新): when the agent
  // finishes a Write/Edit on the file currently shown, re-read it (soft refresh
  // via the same openFile → desktopFileContent chain, so the host resolves the
  // path and the panel keeps its old content until the reply lands). Only the
  // FIRST observation of a block's completion triggers a refresh: each block's
  // last-seen stage is remembered, so a repeated end-state update (result
  // enrichment, images) or switching back to a session whose history already
  // contains the block never re-fires.
  // Local .html preview tabs reload through the same trigger (spec
  // desktop-preview.md「本地 HTML 文件预览」 scenario 5): the matching tab
  // re-requests its URL and remounts, so the pane shows the new bytes.
  const fileToolStagesRef = useRef<Map<string, ToolBlock["stage"]>>(new Map());
  useEffect(() => {
    if (!isDesktop) return;
    // 条上每个已打开文件都要重新读一遍（多标签后一次写盘可能命中条上多个文件）。
    const filePaths = allOpenFiles(tabsRef.current).map((f) => f.path);
    const previewFilePaths = tabsRef.current
      .filter((t) => t.kind === "preview" && t.previewFilePath)
      .map((t) => t.previewFilePath)
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
        // Re-read every open file tab the block touched. A tab with an unsaved
        // draft is not re-read — that would swallow the user's edits (spec
        // desktop-file-panel.md「文件面板内编辑与保存」场景 8); it only gets the
        // 「磁盘变了」marker instead.
        for (const path of filePaths) {
          if (pathsMatch(ref.targetPath, path, workdir)) {
            handleFileAutoRefresh(path);
          }
        }
        // Reload every preview tab previewing that .html file.
        for (const path of previewFilePaths) {
          if (pathsMatch(ref.targetPath, path, workdir)) {
            handlePreviewHtmlFile(path);
          }
        }
      }
      stages.set(key, ref.stage);
    }
  }, [state.messages, isDesktop, handleFileAutoRefresh, handlePreviewHtmlFile]);

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
  // [PANEL_MIN_WIDTH, container - conversation minimum]. A drag also marks the slot as
  // manually resized — from then on it never auto-splits again (「手动拖宽后
  // 锁定宽度」, see PanelGroupState.panelWidthManual).
  const handlePanelWidthChange = useCallback((width: number) => {
    setPanelWidthManual(true);
    let clamped = Math.max(width, PANEL_MIN_WIDTH);
    const containerW = chatContainerRef.current?.getBoundingClientRect().width;
    if (containerW) {
      clamped = Math.min(clamped, containerW - CHAT_MAIN_MIN_WIDTH);
    }
    setPanelWidth(clamped);
  }, []);

  // Dragging the shared slot's left edge resizes the panel. One handle lives on
  // the slot itself (not inside each pane) so the divider stays draggable in
  // every slot state — open tabs and the empty state alike (spec
  // desktop-right-panel.md「右侧面板 · 空态面板与「＋」新增入口」场景 9). The slot's right edge is fixed for the drag, so width = right − pointer.
  const handleSlotResizeStart = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      // Cursor lock is global (.is-panel-resizing) so it doesn't flicker as the
      // pointer outruns the 6px handle. The line itself is lit by CSS for the
      // same class (DesktopApp.css: .panel-slot-drag-handle::after), so no
      // inline background is needed here.
      document.body.classList.add("is-panel-resizing");
      const rect = panelSlotRef.current?.getBoundingClientRect();
      const onMove = (ev: MouseEvent) => {
        handlePanelWidthChange((rect?.right ?? 0) - ev.clientX);
      };
      const onUp = () => {
        document.body.classList.remove("is-panel-resizing");
        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("mouseup", onUp);
      };
      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onUp);
    },
    [handlePanelWidthChange],
  );

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

  // 桌面端：把自己手里这份消息列表的规模报给宿主（内存曲线用）。宿主对消息内容
  // 零状态（spec ui/message-rendering-system.md「宿主不保留消息内容，用的时候
  // 现取」场景 8），没有数组可数，而这条曲线本来就是关于渲染进程的堆——所以
  // 「这条会话占了多少条 / 多少块」只有屏幕这一份能给。
  //
  // 节流：流式期间列表变化很密，但采样是每分钟一次，按固定窗口把期间的多次变化
  // 合并成一条上报（窗口结束时读最新值，不是窗口开始时的快照）。
  const messageStatsRef = useRef<{ messages: number; blocks: number }>({
    messages: 0,
    blocks: 0,
  });
  const messageStatsTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  useEffect(() => {
    if (!isDesktop) return;
    messageStatsRef.current = {
      messages: state.messages.length,
      blocks: state.messages.reduce(
        (sum, message) => sum + (message.blocks?.length ?? 0),
        0,
      ),
    };
    if (messageStatsTimerRef.current) return;
    messageStatsTimerRef.current = setTimeout(() => {
      messageStatsTimerRef.current = null;
      postToHost({
        command: "desktopReportMessageStats",
        ...messageStatsRef.current,
      });
    }, MESSAGE_STATS_REPORT_INTERVAL_MS);
  }, [state.messages, isDesktop, postToHost]);
  // 卸载时清掉定时器：分屏关掉后宿主那份读数由它自己删（bindAgentToPane /
  // handleClosePane），这里只需保证没有定时器在组件消失后还去 postMessage。
  useEffect(
    () => () => {
      if (messageStatsTimerRef.current) {
        clearTimeout(messageStatsTimerRef.current);
        messageStatsTimerRef.current = null;
      }
    },
    [],
  );

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

  // 退出全屏把焦点还给输入框。全屏期间对话列只是 display:none（保持挂载以留住
  // 草稿），浏览器会把隐藏的 contenteditable 上的焦点收走；不还焦点，用户退出
  // 全屏后必须先点一下输入框才能继续打字。改动前靠「对话列重挂载 + 自动聚焦」
  // 顺带解决，现在保持挂载就得显式还。
  const wasPreviewFullscreenRef = useRef(false);
  useEffect(() => {
    const was = wasPreviewFullscreenRef.current;
    wasPreviewFullscreenRef.current = previewFullscreen;
    if (was && !previewFullscreen) messageInputRef.current?.focus();
  }, [previewFullscreen]);

  const renderPanelSlot = (tab: PanelTab) => {
    const { id, kind } = tab;
    const isActive = activeTabId === id;
    const common = {
      width: panelWidth,
    };

    if (kind === "preview") {
      const url = tab.previewUrl ?? "";
      const isForwardOwner =
        currentForward !== null &&
        forwardTabIdRef.current.get(currentForward.requestId) === id;
      // PreviewPane 的本体不在这里渲染（见 previewGuestEntries 与
      // .preview-guest-layer）：它的 DOM 归属必须与会话/槽位无关，否则切会话时
      // React 摘掉槽位子树就会销毁 <webview>——「切走再切回，预览工具条/主题/位置
      // 全回默认」的根因（spec desktop-right-panel.md「preview guest 跨会话保活」）。
      // 槽位里只留两样：
      //  - 空态外壳（`preview-pane-empty`，全屏宽度覆盖的锚点）；
      //  - remote forward 失败时的重试占位（z-index 10，盖在 guest 之上）。
      if (url) return null;
      return (
        <div
          className="preview-pane-empty-wrap"
          style={{ width: common.width }}
          data-testid="preview-pane-empty"
        >
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
          // Same root as the file tree: a bash `cd` must not reset the panel or
          // re-point it at another repo; EnterWorktree is a real relocation and
          // does move it (spec desktop-diff-panel.md「会话变更差异面板」场景 14/15).
          workdir={workspaceRootForPane}
          onAddComment={handleAddComment}
          treeVisible={diffTreeVisible}
          onTreeVisibleChange={setDiffTreeVisible}
          selection={diffSelection}
          onSelectionChange={setDiffSelection}
          {...common}
        />
      );
    }
    if (kind === "file") {
      return (
        <FilePane
          files={openFilesOf(tab)}
          activeFileId={tab.activeFileId}
          listMode={tab.listMode}
          conversationFiles={conversationFiles}
          onBackToList={handleFilePaneBackToList}
          onOpenExternal={handleOpenFileExternal}
          workdir={effectiveWorkdir}
          // The tree is rooted at the session's workspace root (`.wave/rules/
          // workdir.md`): a bash `cd` moves the relative-path basis, not the
          // tree the user reads; EnterWorktree does re-root it.
          treeRoot={workspaceRootForPane}
          treeVisible={fileTreeVisible}
          onTreeVisibleChange={setFileTreeVisible}
          treeWidth={fileTreeWidth}
          onTreeWidthChange={setFileTreeWidth}
          paneId={paneId}
          vscode={vscode}
          onOpenFileInPanel={(path) => handleOpenFile(path)}
          onActivateFile={handleActivateFile}
          onCloseFile={handleCloseFile}
          onCloseOtherFiles={handleCloseOtherFiles}
          onCloseFilesRight={handleCloseFilesRight}
          onCloseAllFiles={handleCloseAllFiles}
          onToast={pushToast}
          onReorderFile={handleReorderFile}
          onAddComment={handleAddComment}
          onStartEdit={handleFileStartEdit}
          onDraftChange={handleFileDraftChange}
          onSaveDraft={handleFileSave}
          onCancelEdit={handleFileCancelEdit}
          onReloadDraft={handleFileReload}
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

  // ---- preview guest 常驻层（spec desktop-right-panel.md「preview guest 跨会话保活」）----
  // guest 的宿主是下面这份清单，而不是槽位里的 tab stack：槽位子树随会话切换整体
  // 重建（tabs / 宽度 / 激活 tab 都按新会话重播种），挂在里面的 `<webview>` 会被
  // 连同销毁——这正是「切走再切回，预览的工具条/主题/位置全回默认」的根因。清单
  // 的 key 与 React 位置在会话切换时都不变，翻转的只有「显示 ↔ 停靠」，于是
  // guest 一直活着，页面自身状态（原型工具条、主题、滚动位置）全部保留。
  type PreviewGuestEntry = {
    /** `${groupKey}#${tabId}`：跨会话稳定，切回时命中同一个 PreviewPane 实例。 */
    key: string;
    group: string;
    tabId: string;
    /** PreviewPane 的 React key：只随该组自己的「重置」代号变（换掉即重挂载重载）。 */
    epoch: number;
    url: string;
    width: number;
    originalUrl?: string;
    onRetry?: () => void;
    onAddComment?: (text: string) => void;
    onTitleChange: (title: string) => void;
    onNavigate: (url: string) => void;
    /** 停靠：保活但不显示（非激活一级 tab / 面板折叠 / 已切走的会话）。 */
    parked: boolean;
  };

  /** 停靠组的事件回落：它的 tab 状态不在本组 state 里（state 已是新会话的），
   *  写回 sessionUi 快照——切回来时由 swap effect 按快照重播种，于是 [url]
   *  effect 认定「已经在要去的地址」、不会再多导航一次。 */
  const patchCachedPreviewTab = useCallback(
    (group: string, tabId: string, patch: Partial<PanelTab>) => {
      const cached = sessionUi.get(group);
      if (!cached) return;
      sessionUi.patch(group, {
        checked: cached.checked.map((t) =>
          t.id === tabId ? { ...t, ...patch } : t,
        ),
      });
    },
    [],
  );
  const setPreviewTabUrl = useCallback(
    (group: string, tabId: string, url: string) => {
      if (group !== (groupKeyRef.current ?? "root")) {
        patchCachedPreviewTab(group, tabId, { previewUrl: url });
        return;
      }
      // Address-bar commits and in-guest navigation become the tab's URL, so the
      // page a session was last showing survives a session switch (kept in the
      // session's cached panel group).
      setTabs((prev) => {
        const cur = prev.find((t) => t.id === tabId);
        if (!cur || cur.previewUrl === url) return prev;
        return prev.map((t) =>
          t.id === tabId ? { ...t, previewUrl: url } : t,
        );
      });
    },
    [patchCachedPreviewTab],
  );
  const setPreviewTabTitle = useCallback(
    (group: string, tabId: string, title: string) => {
      if (group !== (groupKeyRef.current ?? "root")) {
        patchCachedPreviewTab(group, tabId, { previewTitle: title });
        return;
      }
      setTabs((prev) =>
        prev.map((t) => (t.id === tabId ? { ...t, previewTitle: title } : t)),
      );
    },
    [patchCachedPreviewTab],
  );

  const previewGuestEntries = (() => {
    const entries: PreviewGuestEntry[] = [];
    const push = (
      group: string,
      tab: PanelTab,
      opts: {
        parked: boolean;
        width: number;
        originalUrl?: string;
        onRetry?: () => void;
        live: boolean;
      },
    ) => {
      entries.push({
        key: `${group}#${tab.id}`,
        group,
        tabId: tab.id,
        // 代号一律取「这个条目所属组自己的」——显示态与停靠态必须同源，否则
        // 停留在某个显示态的组会因为别的组重试而被改名重挂。
        epoch: guestEpochRef.current.get(group) ?? 0,
        url: tab.previewUrl ?? "",
        width: opts.width,
        originalUrl: opts.originalUrl,
        onRetry: opts.onRetry,
        // 停靠的 guest 收不到用户操作（面板不可见），评论也没有归属会话可落：
        // 一律不接（场景 5）。
        onAddComment: opts.live ? handleAddComment : undefined,
        onTitleChange: (title) => setPreviewTabTitle(group, tab.id, title),
        onNavigate: (url) => setPreviewTabUrl(group, tab.id, url),
        parked: opts.parked,
      });
    };
    // 当前 state 所属会话的 preview tabs：活动的那个显示，其余停靠（切一级 tab
    // 不重载）。用 stateGuestGroup 而非 liveGuestGroup 的理由见其定义处。
    for (const tab of tabs) {
      if (tab.kind !== "preview") continue;
      push(stateGuestGroup, tab, {
        parked: !panelExpanded || activeTabId !== tab.id,
        width: panelWidth,
        originalUrl: currentForward?.originalUrl,
        onRetry: currentForward ? handleRemotePreviewRetry : undefined,
        live: true,
      });
    }
    // 停靠会话组的 preview tabs：一律停靠，宽度/URL 取该组自己的快照（不是当前
    // 会话的宽），这样面板宽度变化不会连带改停靠 guest 的缩放基准。
    //
    // 按 key 去重（而不是跳过「当前会话组」）：切回一个保活组的那个提交里，
    // groupKey 已经换了但 tabs 还是上一组的（swap effect 还没跑），此时该组的
    // guest 只能由这条停靠分支提供——少渲染一帧就会把 <webview> 摘掉，保活
    // 前功尽弃。下一个提交 tabs 换成该组自己的快照，key 相同 → React 原地复用。
    const seenGuestKeys = new Set(entries.map((e) => e.key));
    for (const group of retainedPreviewGroups) {
      const cached = sessionUi.get(group);
      for (const tab of cached?.checked ?? []) {
        if (tab.kind !== "preview") continue;
        const key = `${group}#${tab.id}`;
        if (seenGuestKeys.has(key)) continue;
        seenGuestKeys.add(key);
        push(group, tab, {
          parked: true,
          width: cached?.panelWidth ?? PANEL_DEFAULT_WIDTH,
          originalUrl: cached?.forward?.originalUrl,
          live: false,
        });
      }
    }
    for (const entry of entries) {
      if (!guestOrderRef.current.has(entry.key)) {
        guestOrderRef.current.set(entry.key, guestSeqRef.current++);
      }
    }
    // 稳定次序（见 guestOrderRef 注释）：绝不因保活组的增减而重排——同一父节点
    // 内重排 keyed 子节点会让 React 移动 <webview> DOM 节点，等于重新挂载。
    return entries.sort(
      (a, b) =>
        (guestOrderRef.current.get(a.key) ?? 0) -
        (guestOrderRef.current.get(b.key) ?? 0),
    );
  })();

  // 空态「快捷方式」区块：只在空态（尚无消息且初始状态就绪）出现，点了把整段
  // 模板填进输入框（与设置页「新建/编辑」预填走同一个 loadDraft）。桌面端与 IDE
  // 的位置不同（见 chatBodyContent 里两处渲染点），这里只构造一次避免两份 props。
  // 远控页在「电脑侧一条会话都没有」时不渲染：那里输入框是禁用的（见
  // `remotePageWithoutSession`），点模板只会往一个发不出去的框里塞文本。
  const quickStartBlock =
    showWelcomeReady && !remotePageWithoutSession ? (
      <QuickStartTemplates
        onApplyTemplate={(prompt) => messageInputRef.current?.loadDraft(prompt)}
      />
    ) : null;

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
          // 切走再切回来时按它恢复阅读位置（虚拟列表内核按会话 id 记锚点）。
          docKey={state.currentSession?.id}
          messages={state.messages}
          queuedMessages={state.queuedMessages}
          isStreaming={state.isStreaming}
          isCompacting={state.isCompacting}
          compactionStream={compactionStream}
          vscode={vscode}
          // 远端也能回滚了（第二批解禁）：宿主侧就是桌面端那条链路
          // （`truncateHistory` + `revertTo` 还原电脑侧工作区文件），页面上先确认
          // 一次再发——文案由 `pendingRewindId` 那个 ConfirmDialog 按端切。
          onRewindToMessage={handleRewindToMessage}
          onBackgroundCurrentTask={handleBackgroundCurrentTask}
          // 上翻取更早：滚到顶时这里会拿到一条「要一页更早的」请求，锚点是当前
          // 已加载的第一条（spec ui/message-rendering-system.md「首屏一页，上翻按需
          // 取更早」）。
          hasEarlier={hasEarlier}
          isLoadingEarlier={isLoadingEarlier}
          onLoadEarlier={sendLoadEarlier}
          workdir={state.workdir}
          onOpenPreview={openPreviewHandler}
          onOpenFile={handleOpenFile}
        />
      )}

      {/* IDE 宿主的「快捷方式」仍在输入卡上方（与桌面端分叉排布，原因见下方
          桌面端那处的注释）。 */}
      {!isDesktop && quickStartBlock}

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
              models={configuredModels}
              currentModel={currentModel}
              onSelectModel={handleModelSelect}
              initialAttachedImages={state.attachedImages}
              paneId={paneId}
              contextUsage={contextUsage}
              showContextUsage={hasVisibleMessages}
              disabled={inputDisabled}
              placeholder={inputDisabledReason}
              workdirSelector={
                host?.type === "desktop" &&
                isNewSessionState(paneHasContent, state.messages) ? (
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
                      guide={
                        // 只在**还没有目录**的新会话里引导选目录（用户 2026-10-13 口径：
                        // 已有目录时不再多一次确认——宿主自动带出的最近目录直接可用，
                        // 不打扰；自己选的目录更是明确意图）。选到目录后 guide 因
                        // effectiveWorkdir 非空自动消失。
                        !workdirGuideDismissed && !effectiveWorkdir
                          ? {
                              text: "请先选择要开发的文件夹",
                              onDismiss: () => setWorkdirGuideDismissed(true),
                            }
                          : undefined
                      }
                    />
                    {gitBranches ? (
                      <DesktopWorktreeControls
                        branches={gitBranches.branches}
                        branch={worktreeBranch || gitBranches.current || ""}
                        worktreeChecked={worktreeChecked}
                        creating={worktreeCreating}
                        onBranchChange={setWorktreeBranch}
                        onWorktreeChange={setWorktreeChecked}
                      />
                    ) : branchesLoading ? (
                      <div
                        className="desktop-branches-loading"
                        data-testid="desktop-branches-loading"
                      >
                        分支加载中…
                      </div>
                    ) : null}
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

      {/* 空态「快捷方式」：12 个开发场景分类 → 该分类的模板，点模板整段填进
          输入框（与设置页「新建/编辑」预填走同一个 loadDraft）。只在空态出现，
          有对话历史后它是「第一次怎么开口」的入口，常驻只会挤掉消息区高度。
          位置只在**桌面端**挪到输入卡下方（设计师 1022 评论「这块放在输入框
          下面间距先不改」）；IDE 宿主仍在输入卡上方（原地不动）。两处留白都由
          父级 flex 的 gap 提供，未额外加 margin/padding。 */}
      {isDesktop && quickStartBlock}
    </>
  );

  // Batch 2 settings full-page (desktop): rendered in place of chatContainer
  // when settingsOpen. The board and settings are mutually exclusive (opening
  // one closes the other, see handleToggleSessionBoard).
  const settingsPage = isDesktop ? (
    <SettingsPage
      configurationData={state.configurationData ?? null}
      serverUrl={serverUrl}
      onSave={handleConfigurationSave}
      themeSource={themeSource}
      onThemeChange={(source) => {
        // 乐观更新本实例选中态；host 持久化后回广播 desktopThemeSource（幂等）。
        setThemeSource(source);
        postToHost({ command: "setThemeSource", source });
      }}
      updateChannel={updateChannel}
      onUpdateChannelChange={(channel) => {
        // 乐观更新本实例选中态；host 持久化后回广播 desktopUpdateChannel（幂等）。
        setUpdateChannel(channel);
        postToHost({ command: "setUpdateChannel", channel });
      }}
      onClose={handleCloseSettings}
      userAgentsContent={userAgentsContent}
      projectAgentsContent={projectAgentsContent}
      onLoadAgentsContent={(scope) =>
        vscode.postMessage({
          command: "getAgentsContent",
          scope,
          // desktop host 按聚焦 pane 自行解析项目目录（见 desktopHost
          // handleGetAgentsContent），此处 workdir 仅作 IDE 宿主备用一致性字段——
          // 用与归属守卫同一「当前项目」身份，避免往线上传 recents 头的旧路径。
          workdir: scope === "project" ? settingsWorkdir : undefined,
        })
      }
      onSaveAgentsContent={handleSaveAgentsContent}
      agentsSaving={agentsSaving}
      workdir={settingsWorkdir}
      saving={state.configurationLoading}
      initialNav={settingsNav}
      vscode={vscode}
      projectSettings={state.projectSettings}
      projectSettingsWorkdir={state.projectSettingsWorkdir}
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
      configuredModels={configuredModelNames}
      onLoadConfiguredModels={() =>
        postToHost({ command: "getConfiguredModels" })
      }
    />
  ) : null;

  // Batch 2 session board (desktop): rendered in place of chatContainer when
  // sessionBoardOpen. Clicking a card restores that session — workdir resolved
  // from the board's own group data so the host can route the switch. The board
  // must also close (spec desktop-sessions.md 场景 3：点击卡片恢复会话并退出
  // 看板视图)——否则视图被 sessionBoardOpen 替换，停留在看板看不到会话。
  const sessionBoard = isDesktop ? (
    <SessionBoard
      groups={host?.sessionTree ?? []}
      onSelectSession={(sessionId) => {
        const group = (host?.sessionTree ?? []).find((g) =>
          g.sessions.some((s) => s.sessionId === sessionId),
        );
        const workdir = group?.workdir ?? host?.workdir;
        handleCloseSessionBoard();
        if (workdir) host?.onSelectSession(workdir, sessionId);
      }}
      onBack={handleCloseSessionBoard}
      collapsed={sidebarCollapsed}
      onExpandSidebar={() => setSidebarCollapsed(false)}
      // 看板替换 pane rows 后占满窗口左缘（侧边栏收起时侧栏整条不渲染），
      // 顶栏的红绿灯让位与对话顶栏同源（同一 macTrafficSpacer 条件）。
      macTrafficSpacer={macTrafficSpacer}
    />
  ) : null;

  // 插件市场整页（desktop，spec ecosystem/plugin.md「插件市场」场景 1/2）：侧边栏
  // 保留，只替换 pane rows（同看板）。复用设置页的插件市场视图，两个入口渲染同一
  // 视图、能力不分叉（同 A-016）。
  const pluginMarket = isDesktop ? (
    <PluginMarketPage
      onBack={handleClosePluginMarket}
      collapsed={sidebarCollapsed}
      onExpandSidebar={() => setSidebarCollapsed(false)}
      macTrafficSpacer={macTrafficSpacer}
      vscode={vscode}
    />
  ) : null;

  // 创作集整页（desktop，spec desktop/desktop-artifacts.md）：侧边栏保留，只替换
  // pane 行（同看板/插件市场）。账号级数据由宿主经 CLI 进程 RPC 取，分类写本机。
  const artifacts = isDesktop ? (
    <ArtifactsPage
      onBack={handleCloseArtifacts}
      collapsed={sidebarCollapsed}
      onExpandSidebar={() => setSidebarCollapsed(false)}
      macTrafficSpacer={macTrafficSpacer}
      vscode={vscode}
      serverUrl={serverUrl}
      onLogin={handleLogin}
      onNewFromTemplate={handleNewFromTemplate}
    />
  ) : null;

  // Dialogs render at the component root — not inside chatContainer — so they
  // stay visible in every layout, including the desktop split-view shell.
  const dialogs = (
    <>
      {/* 远控页的「会话」整页列表（spec remote/remote-web.md「手机端的会话列表与删除」）。
          覆盖在对话之上而不是替换它：对话仍在挂载状态，输入草稿、滚动位置、正在
          跑的那一轮都不因为「去看一眼列表」而丢。 */}
      {isRemotePage && sessionPageOpen && (
        <RemoteSessionListPage
          sessions={state.sessions}
          currentSession={state.currentSession}
          sessionStatus={state.sessionStatus}
          loading={state.sessionsLoading}
          vscode={vscode}
          // 点一行 = 切会话 + 自动回对话页（spec 场景 3）。切会话本身走
          // `handleSessionSelect`，与原先下拉点一行完全同一套本地动作。
          onSelect={(sessionId) => {
            handleSessionSelect(sessionId);
            setSessionPageOpen(false);
          }}
          onBack={() => setSessionPageOpen(false)}
          onRename={renameSessionFromHeader}
        />
      )}
      {/* Desktop `/resume`: centered modal at the pane's root (the desktop chat
          header has no session buttons, and the pane root keeps it usable in
          split view). Its list spans every project on the current host. */}
      {isDesktop && resumePickerOpen && (
        <SessionListPopup
          variant="modal"
          title="恢复会话"
          sessions={resumeSessions}
          currentSession={state.currentSession}
          onSessionSelect={handleResumeSelect}
          loading={resumeLoading}
          showProject
          onClose={handleResumeClose}
        />
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
          workflowRuns={state.workflowRuns}
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
      {state.activeDialog === "remoteNewSession" && (
        <RemoteNewSessionDialog
          recentDirs={remoteRecentDirs}
          vscode={vscode}
          onClose={handleDialogClose}
        />
      )}
      {pendingRewindId && (
        <ConfirmDialog
          title="确定要回滚到此消息吗？"
          // 远端的文案必须点明「电脑侧工作区」：这条路与桌面端完全同源
          // （`truncateHistory` → `reversionManager.revertTo`），除了截断对话还会按
          // 每条消息的 `file_history` 快照把**被控那台机器**上的文件还原——手机上
          // 是一次误触代价最高的动作，不能只说「删除消息」。
          description={
            isRemotePage
              ? "这将删除之后的所有消息，并把电脑侧工作区的文件恢复到回滚点的内容（回滚点之后对文件的改动会被撤销）。"
              : "这将删除之后的所有消息并撤销相关的文件更改。"
          }
          destructive
          onConfirm={handleRewindConfirm}
          onCancel={() => setPendingRewindId(null)}
        />
      )}
      {pendingClearConfirm && (
        <ConfirmDialog
          title="确定要清空当前对话吗？"
          // 忙的时候把话说明白并挡住确认：`handleClearChat` 自带那道原地守卫
          // （streaming / 压缩中 / 有后台任务在跑），此时点「确定」会静默什么都不做
          // —— 在手机上那就成了「按了没反应」。
          description={
            inPlaceBusy
              ? "这台电脑上的会话正在生成或压缩（或有后台任务在跑），等它结束后再清空。"
              : "清空后电脑侧这条会话会换绑成一条新会话（并触发会话钩子），当前对话的消息不会再出现在这里。"
          }
          confirmDisabled={inPlaceBusy}
          destructive
          onConfirm={handleClearConfirm}
          onCancel={() => setPendingClearConfirm(false)}
        />
      )}
      {pendingModelSwitch && (
        <ConfirmDialog
          title={`切换到 ${pendingModelSwitch}？`}
          description="切换会写入这台电脑的用户级配置（~/.wave/settings.json），本机所有会话以及此后新开的会话都会使用这个模型。"
          onConfirm={handleModelSwitchConfirm}
          onCancel={() => {
            setPendingModelSwitch(null);
            messageInputRef.current?.focus();
          }}
        />
      )}
      {pluginChangePending && (
        <ConfirmDialog
          title="插件已变更，重新加载后生效"
          description="重新加载会把磁盘上最新的插件状态应用到当前对话，新插件的命令、技能与子代理随后即可使用；正在生成的回复不会被打断。"
          confirmText="立即重新加载"
          cancelText="稍后"
          onConfirm={handlePluginReloadConfirm}
          onCancel={() => setPluginChangePending(false)}
        />
      )}
      {/* 文件面板的未保存草稿（spec desktop-file-panel.md「文件面板内编辑与保存」
          场景 5/6）：「继续编辑」= 什么都不变，草稿原样留着；「放弃」才让发起方
          继续执行那个离开动作。 */}
      {draftDiscardOpen && (
        <ConfirmDialog
          title="放弃未保存的修改？"
          description="这个文件在面板里有还没保存的修改，继续操作会丢弃它们。"
          confirmText="放弃"
          cancelText="继续编辑"
          destructive
          onConfirm={() => settleDraftDiscard(true)}
          onCancel={() => settleDraftDiscard(false)}
        />
      )}
      <ToastStack
        toasts={toasts}
        onDismiss={handleToastDismiss}
        onAction={handleToastAction}
        // 水平锚点：设置页打开 = 内容列中心（避开 240px 左导航）；普通桌面 =
        // 工作区中心（避开会话侧栏）。使 toast 始终落在用户操作的「右侧界面」。
        anchorSelector={
          isDesktop
            ? settingsOpen
              ? ".settings-page .settings-content"
              : ".desktop-pane-rows"
            : null
        }
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
        leading={collapsedLeading(expandBtn)}
        macTrafficSpacer={macTrafficSpacer}
        onNewSession={isRemotePage ? handleRemoteNewSession : handleClearChat}
        // 禁用态只属于 IDE 那个原地清空语义（见 inPlaceGuard）；远控页重绑为
        // 「在远端机器上另起一条会话」，忙时不置灰。
        newSessionDisabled={inPlaceGuard}
        onAbortMessage={handleAbortMessage}
        messages={state.messages}
        sessions={state.sessions}
        currentSession={state.currentSession}
        onSessionSelect={handleSessionSelect}
        sessionsLoading={state.sessionsLoading}
        // 会话列表的「待确认 / 运行中」标记：只有远控 Web 页有这两组数据（它没有
        // 侧栏，会话列表就是它唯一能标记状态的地方）；其余四端传 undefined，列表
        // 照旧只渲染标题与时间（spec remote/remote-web.md「待确认只在它自己的对话里
        // 弹，对话状态在会话列表标出来」）。
        sessionStatus={isRemotePage ? state.sessionStatus : undefined}
        // `/resume` (IDE hosts) opens this very popup — one list, one scope, no
        // second implementation to drift.
        sessionListOpen={!isDesktop && resumePickerOpen}
        onSessionListClose={handleResumeClose}
        onOpenSettings={handleOpenSettings}
        onOpenEnterpriseConsole={handleOpenEnterpriseConsole}
        onOpenHelpDocs={handleOpenHelpDocs}
        onLogin={handleLogin}
        onLogout={handleLogout}
        isAuthenticated={state.isAuthenticated}
        // Desktop: 会话新建/历史按钮回归 DesktopSidebar（revert #2021 移除
        // 聊天顶栏「历史对话」跨目录弹窗入口后，顶栏不再渲染会话按钮）。
        // Remote Web page: 「历史对话」同口径隐藏、改单个「会话」入口；
        // 「新建对话」例外放行（ChatHeader 按 sessionSwitchButton 渲染），
        // 重绑到远端建新会话（initialize，非 clearChat）。
        hideSessionButtons={isDesktop || isRemotePage}
        sessionSwitchButton={isRemotePage}
        // 远控页专属：顶栏「会话」打开整页列表（不再是借来的下拉）。其余四端不传，
        // 那一端仍是原来的弹窗/侧栏（spec remote/remote-web.md「手机端的会话列表与
        // 删除」场景 1）。
        onOpenSessionPage={
          isRemotePage ? () => setSessionPageOpen(true) : undefined
        }
        // 远控页专属：「切换电脑」入口，路由是页面 shim（REMOTE_PAGE_GATED）。
        onSwitchMachine={
          isRemotePage
            ? () => vscode.postMessage({ command: "openMachinePicker" })
            : undefined
        }
        // 远控页专属：Web Push 通知开关，路由是页面 shim（REMOTE_PAGE_GATED）。
        // 状态还没回来时给 undefined —— 菜单不渲染入口，而不是先画一个会自打脸的
        // 「开启通知」。
        pushNotifications={pushNotifications}
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
        // 头部标题就地改名只给 IDE 插件（spec session-management.md「会话重命名
        // 入口：CLI 与 IDE 插件」场景 8/9/10）。桌面端不传 —— 桌面端的改名入口是
        // 侧边栏会话行菜单的「重命名」弹窗（spec session-management.md 平台边界、
        // desktop-sessions.md「会话重命名」场景 1/2）。设计师 2026-10-30 预览评论：
        // 「这里的重命名功能可以拿掉」。不传 ⇒ `canRename` 为假 ⇒ 标题退回纯展示
        // （无 role/tabIndex/hover 高亮，也不再是 tab 停靠点），标题文字不变。
        onRenameSession={isDesktop ? undefined : renameSessionFromHeader}
      />
      {isDesktop ? (
        <div
          className={`desktop-chat-body${
            previewFullscreen ? " preview-fullscreen" : ""
          }${previewFullscreen && turnRunning ? " preview-working" : ""}`}
        >
          {/* 全屏时对话列**保持挂载**，靠 CSS 缩成底部居中的浮动对话框（见
              DesktopApp.css 的 preview-fullscreen 规则）：整块不渲染会连坐卸载
              <MessageInput>，退出全屏重挂载只能按 state.inputContent（上次宿主快照）
              回填，最后一段输入随之丢失，滚动位置也归零（spec desktop-preview.md
              场景 7）；而自 2026-09-16 需求八起，全屏里这个浮动对话框就是标注与
              发消息的落点（场景 6/8/9），更不能是另一个输入框实例。消息列表与
              任务/队列区在全屏里由 CSS 隐藏。 */}
          <div className="desktop-chat-main">{chatBodyContent}</div>
          {/* 本轮运行中（生成 / 斜杠命令）：输入卡让位给「正在工作」药丸，落在
              浮动对话框同一位置——全屏里也能看出「标注已经发出去、agent 正在执行」
              （spec desktop-preview.md 场景 9）。 */}
          {previewFullscreen && turnRunning && (
            <div
              className="preview-floating-working"
              role="status"
              aria-live="polite"
              data-testid="preview-floating-working"
            >
              <span
                className="preview-floating-working-dots"
                aria-hidden="true"
              >
                <i />
                <i />
                <i />
                <i />
              </span>
              <span className="preview-floating-working-text">正在工作</span>
            </div>
          )}
          {/* preview guest 常驻层：guest 的 DOM 归属与会话/槽位无关，这是「切会
              话不销毁预览」的机制基础。可见态用 CSS 盖在面板 body 的位置上，停
              靠态保留自身尺寸但不显示；槽位里对应的位置只留占位（renderPanelSlot）。 */}
          {previewGuestEntries.length > 0 && (
            <div
              className="preview-guest-layer"
              data-testid="preview-guest-layer"
            >
              {previewGuestEntries.map((entry) => (
                <div
                  key={entry.key}
                  className="preview-guest"
                  data-parked={entry.parked ? "true" : "false"}
                  data-testid="preview-guest"
                  style={{ width: entry.width }}
                >
                  <PreviewPane
                    // 只随该组的「重置」代号重挂载（重新加载 guest）。
                    key={entry.epoch}
                    url={entry.url}
                    originalUrl={entry.originalUrl}
                    onRetry={entry.onRetry}
                    vscode={vscode}
                    onAddComment={entry.onAddComment}
                    onTitleChange={entry.onTitleChange}
                    onNavigate={entry.onNavigate}
                    parked={entry.parked}
                    width={entry.width}
                  />
                </div>
              ))}
            </div>
          )}
          {panelExpanded || tabs.length > 0 ? (
            <div
              ref={panelSlotRef}
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
              <div
                className="panel-slot-drag-handle"
                data-testid="panel-slot-drag-handle"
                onMouseDown={handleSlotResizeStart}
              />
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
    // FR-032 split-view: the host pushes a pane layout at desktopReady (spec
    // desktop-split-pane.md「启动即单个分屏」), so a paneId-scoped instance only
    // contributes its chatContainer while the root instance delegates to
    // DesktopShell. The pre-pane root layout is gone.
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
            settingsOpen={settingsOpen}
            onCloseSettings={handleCloseSettings}
            sessionBoardOpen={sessionBoardOpen}
            onCloseSessionBoard={handleCloseSessionBoard}
            settingsPage={settingsPage}
            sessionBoard={sessionBoard}
            sessionBoardActive={sessionBoardOpen}
            onToggleSessionBoard={handleToggleSessionBoard}
            pluginMarketOpen={pluginMarketOpen}
            onClosePluginMarket={handleClosePluginMarket}
            pluginMarket={pluginMarket}
            pluginMarketActive={pluginMarketOpen}
            onTogglePluginMarket={handleTogglePluginMarket}
            onOpenPluginMarket={handleOpenPluginMarket}
            artifactsOpen={artifactsOpen}
            onCloseArtifacts={handleCloseArtifacts}
            artifacts={artifacts}
            artifactsActive={artifactsOpen}
            onToggleArtifacts={handleToggleArtifacts}
            prefillRequest={pendingPrefill}
            onPrefillApplied={handlePrefillApplied}
          />
          {dialogs}
        </>
      );
    }
    // Inside DesktopShell each pane renders only its own chatContainer; the
    // sidebar / preview pane live in the shell.
    if (paneId !== undefined) {
      return (
        <>
          {chatContainer}
          {dialogs}
        </>
      );
    }
    // Handshake window before the host's first `desktopPanes` lands: show a
    // bare loading placeholder — never the old non-split layout (spec
    // desktop-split-pane.md「启动即单个分屏」场景 3).
    return <div className="desktop-loading" data-testid="desktop-loading" />;
  }

  return (
    <>
      {chatContainer}
      {dialogs}
    </>
  );
};
