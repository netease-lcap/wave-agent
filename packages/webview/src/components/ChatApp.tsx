import React, { useEffect, useLayoutEffect, useReducer, useCallback, useRef, useState } from 'react';
import { MessageList } from './MessageList';
import { MessageInput } from './MessageInput';
import type { MessageInputHandle } from './MessageInput';
import { ChatHeader } from './ChatHeader';
import { TaskList } from './TaskList';
import { QueuedMessageList } from './QueuedMessageList';
import { ConfirmationDialog } from './ConfirmationDialog';
import { ConfirmDialog } from './ConfirmDialog';
import { RewindPopup } from './RewindPopup';
import type { RewindCheckpoint } from './RewindPopup';
import ConfigDialog from './ConfigDialog';
import PluginDialog from './PluginDialog';
import McpDialog from './McpDialog';
import StatusDialog from './StatusDialog';
import BackgroundTaskManager from './BackgroundTaskManager';
import WorkflowManager from './WorkflowManager';
import WelcomeView from './WelcomeView';
import LoadingLogo from './LoadingLogo';
import { DesktopHostSelector } from './DesktopHostSelector';
import { DesktopSidebar } from './DesktopSidebar';
import { DesktopShell } from './DesktopShell';
import { DesktopWorkdirSelector } from './DesktopWorkdirSelector';
import { DesktopWorktreeControls } from './DesktopWorktreeControls';
import { PreviewPane } from './PreviewPane';
import { DiffPane } from './DiffPane';
import { TerminalPane, prefetchTerminalLib } from './TerminalPane';
import { FilePane } from './FilePane';
import type {
  ChatAppProps,
  ConfigurationData,
  ConfirmationDecision,
  DesktopPanelKind,
  FileViewState,
  ToolBlockUpdateCallbackParams,
} from '../types';
import { chatReducer, initialState } from '../reducers/chatReducer';
import '../styles/ChatApp.css';

/** Desktop conversation-level panels: fixed left→right order regardless of check order. */
const PANEL_ORDER: DesktopPanelKind[] = ['preview', 'diff', 'terminal', 'file'];
const PANEL_DEFAULT_WIDTH = 420;
const PANEL_MIN_WIDTH = 320;
/** The conversation (message) area never shrinks below this when opening/dragging panels. */
const CHAT_MAIN_MIN_WIDTH = 360;
/** Row minimums for the panel second row (message row / panel row). */
const CHAT_MAIN_MIN_HEIGHT = 240;
const PANEL_ROW_MIN_HEIGHT = 160;
const PANEL_ROW_SEPARATOR_PX = 5;
const PANEL_ROW_DEFAULT_RATIO = 0.35;
const PANEL_HINT_DURATION_MS = 2400;
const PANEL_DRAG_MIME = 'application/x-wave-panel';

type PanelRow = 1 | 2;

/** Default height for a newly created panel second row, clamped to the row
 * minimums so the message area keeps CHAT_MAIN_MIN_HEIGHT. */
function defaultPanelRowHeight(bodyH: number): number {
  return Math.min(
    Math.max(Math.round(bodyH * PANEL_ROW_DEFAULT_RATIO), PANEL_ROW_MIN_HEIGHT),
    Math.max(bodyH - CHAT_MAIN_MIN_HEIGHT - PANEL_ROW_SEPARATOR_PX, PANEL_ROW_MIN_HEIGHT),
  );
}

/** True when a second row can be created without violating either row minimum. */
function canCreatePanelRow(bodyH: number): boolean {
  return bodyH >= CHAT_MAIN_MIN_HEIGHT + PANEL_ROW_SEPARATOR_PX + PANEL_ROW_MIN_HEIGHT;
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
  'localhost',
  '127.0.0.1',
  '::1',
  '[::1]',
  '0:0:0:0:0:0:0:1',
  '[0:0:0:0:0:0:0:1]',
  '0.0.0.0',
  '::',
  '[::]',
  '0:0:0:0:0:0:0:0',
  '[0:0:0:0:0:0:0:0]',
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
    if (LOOPBACK_OR_ALL_INTERFACES_HOSTS.has(u.hostname.toLowerCase())) u.hostname = 'localhost';
    return u.href;
  } catch {
    return raw;
  }
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
  checked: DesktopPanelKind[];
  mounted: DesktopPanelKind[];
  widths: Record<DesktopPanelKind, number>;
  rows: Record<DesktopPanelKind, PanelRow>;
  rowHeight: number | null;
  previewUrl: string | null;
  /** File panel state (which file is open + content); null = never opened. */
  fileView: FileViewState | null;
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
    mounted: [],
    widths: {
      preview: PANEL_DEFAULT_WIDTH,
      diff: PANEL_DEFAULT_WIDTH,
      terminal: PANEL_DEFAULT_WIDTH,
      file: PANEL_DEFAULT_WIDTH,
    },
    rows: { preview: 1, diff: 1, terminal: 1, file: 1 },
    rowHeight: null,
    previewUrl: null,
    fileView: null,
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

export const ChatApp: React.FC<ChatAppProps> = ({ vscode, host, paneId }) => {
  const [state, dispatch] = useReducer(chatReducer, initialState);
  const [queueEditWarning, setQueueEditWarning] = useState<string | null>(null);
  // Message id awaiting rewind confirmation; non-null shows the ConfirmDialog.
  const [pendingRewindId, setPendingRewindId] = useState<string | null>(null);
  // /rewind popup: checkpoint list requested from the host on open.
  const [rewindPopupOpen, setRewindPopupOpen] = useState(false);
  const [rewindCheckpoints, setRewindCheckpoints] = useState<RewindCheckpoint[]>([]);
  const [rewindCheckpointsLoading, setRewindCheckpointsLoading] = useState(false);
  // Desktop new-session worktree controls (FR-022/FR-023).
  const [worktreeBranch, setWorktreeBranch] = useState<string>('');
  const [worktreeChecked, setWorktreeChecked] = useState(true);
  // Per-pane git branches for this pane's OWN workdir (FR-022). The host-level
  // workdir follows the focused pane — sharing it would bleed one pane's
  // directory/branch into a sibling new-session pane, so each new-session pane
  // queries branches against its own session workdir.
  const [paneGitBranches, setPaneGitBranches] = useState<{ branches: string[]; current: string } | null>(null);
  // The pane's effective cwd: its own session workdir wins; a new-session pane
  // (state.workdir empty during spawn) falls back to the most recently selected
  // repo root from recents — never to the host-level workdir, which follows the
  // focused pane and would bleed a sibling worktree session's path/branch into
  // this new pane until the spawn finishes and setInitialState lands.
  const effectiveWorkdir = state.workdir ?? (host?.type === 'desktop' ? (host?.recentWorkdirs?.[0] ?? host?.workdir) : undefined);
  const isDesktop = host?.type === 'desktop';
  // The pane's effective host ('local' or an SSH host name): a pane-bound
  // session's host (authoritative `desktopPanes` push) wins; the single-pane
  // layout reads the host-level current host. Remote sessions run the whole
  // agent on the remote host, so local-only surfaces — the preview/diff/
  // terminal panels and preview-pane localhost links — are suppressed for them.
  const paneHost = paneId ? host?.panes?.find((p) => p.paneId === paneId)?.host : undefined;
  const effectiveHost = paneHost ?? host?.host ?? 'local';
  const effectiveHostRef = useRef(effectiveHost);
  const gitBranches = isDesktop ? paneGitBranches : null;
  const effectiveWorkdirRef = useRef(effectiveWorkdir);
  // Desktop only: the panel group follows the session bound to this pane. The
  // cache key is the session id from the host-authoritative `desktopPanes`
  // push, or the pane's new-session bucket while no session is bound.
  const boundSessionId = paneId ? host?.panes?.find((p) => p.paneId === paneId)?.sessionId : undefined;
  const groupKey = paneId ? boundSessionId ?? `new:${paneId}` : undefined;
  const groupKeyRef = useRef(groupKey);
  // Set when the user sends a message from this pane's new-session state. The
  // new-session bucket migrates to the session id only when that message binds
  // one — a sidebar switch to an existing session must not inherit the bucket.
  const sentFromNewSessionRef = useRef(false);
  // Desktop only: localhost URL shown in the preview pane. Null = never opened.
  const [previewUrl, setPreviewUrl] = useState<string | null>(
    () => (groupKey ? panelGroupCache.get(groupKey)?.previewUrl : null) ?? null,
  );
  // Desktop remote sessions: port-forward failure shown in the empty-preview
  // stub with a retry entry (scenario 16). Null = no error. Restored from the
  // session's cached group so a pane rebinding away and back keeps the error.
  const [previewForwardError, setPreviewForwardError] = useState<string | null>(
    () => (groupKey ? panelGroupCache.get(groupKey)?.forwardError : undefined) ?? null,
  );
  // Bumped when a re-acquire returns the SAME forwarded URL — the [url] effect
  // in PreviewPane would otherwise early-return and skip the forced reload a
  // retry after a guest load failure needs. Remounting restarts the webview.
  const [previewEpoch, setPreviewEpoch] = useState(0);
  // Desktop only: the file panel's open file + content (null = never opened).
  // Set locally to a loading stub when a path is clicked, then filled by the
  // host's desktopFileContent reply (routed by paneId).
  const [fileView, setFileView] = useState<FileViewState | null>(
    () => (groupKey ? panelGroupCache.get(groupKey)?.fileView : undefined) ?? null,
  );
  // The pane's current remote port forward (see RemoteForwardRef above). State
  // rather than a ref because a pane rebinding to another session must drop its
  // own current forward WITHOUT dropping the previous session's (the host
  // tunnels stay alive independently, scenario 18): the per-session references
  // live in panelGroupCache, this state only mirrors the bound session's one
  // for rendering the preview stub.
  const [currentForward, setCurrentForward] = useState<RemoteForwardRef | null>(
    () => (groupKey ? panelGroupCache.get(groupKey)?.forward : undefined) ?? null,
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
  const previewUrlRef = useRef(previewUrl);
  const fileViewRef = useRef<FileViewState | null>(fileView);
  // Desktop only: conversation-level panel group (checked = visible; mounted =
  // rendered but possibly hidden, so panel content survives unchecking). When
  // this session's group was cached (session revisited, or the pane moved
  // across window rows), restore it.
  const [checkedPanels, setCheckedPanels] = useState<DesktopPanelKind[]>(
    () => (groupKey ? panelGroupCache.get(groupKey)?.checked : undefined) ?? [],
  );
  const [mountedPanels, setMountedPanels] = useState<DesktopPanelKind[]>(
    () => (groupKey ? panelGroupCache.get(groupKey)?.mounted : undefined) ?? [],
  );
  const [panelWidths, setPanelWidths] = useState<Record<DesktopPanelKind, number>>(
    () =>
      (groupKey ? panelGroupCache.get(groupKey)?.widths : undefined) ?? {
        preview: PANEL_DEFAULT_WIDTH,
        diff: PANEL_DEFAULT_WIDTH,
        terminal: PANEL_DEFAULT_WIDTH,
        file: PANEL_DEFAULT_WIDTH,
      },
  );
  // Panel row assignment: 1 = right of the message area (default), 2 = second
  // row below it. Unchecking keeps the assignment; the row follows on recheck.
  const [panelRows, setPanelRows] = useState<Record<DesktopPanelKind, PanelRow>>(
    () =>
      (groupKey ? panelGroupCache.get(groupKey)?.rows : undefined) ?? {
        preview: 1,
        diff: 1,
        terminal: 1,
        file: 1,
      },
  );
  // Pixel height of the panel second row; null until a row is first created.
  const [panelRowHeight, setPanelRowHeight] = useState<number | null>(
    () => (groupKey ? panelGroupCache.get(groupKey)?.rowHeight : undefined) ?? null,
  );
  const [panelHint, setPanelHint] = useState<string | null>(null);
  // VS Code-style translucent overlay over the target row while a panel
  // toolbar drags; geometry is relative to the chat body (top/height in px).
  const [panelDropZone, setPanelDropZone] = useState<{ row: PanelRow; top: number; height: number } | null>(null);
  // True between a panel-toolbar dragstart and dragend; disables guest
  // pointer-events so dragover keeps firing over the preview webview.
  const [panelDragActive, setPanelDragActive] = useState(false);
  const [panelRowSeparatorActive, setPanelRowSeparatorActive] = useState(false);
  const chatContainerRef = useRef<HTMLDivElement>(null);
  const chatBodyRef = useRef<HTMLDivElement>(null);
  const panelHintTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const checkedPanelsRef = useRef(checkedPanels);
  const panelWidthsRef = useRef(panelWidths);
  const panelRowsRef = useRef(panelRows);
  const panelRowHeightRef = useRef(panelRowHeight);
  const panelSlotNodes = useRef(new Map<DesktopPanelKind, HTMLDivElement>());
  // The panel whose toolbar is being dragged (same-document drag source; the
  // MIME alone cannot expose the payload during dragover).
  const draggedPanelRef = useRef<DesktopPanelKind | null>(null);
  // Mirrors so the stable message listener can reach the panel toggle logic
  // (defined below) without re-subscribing.
  const togglePanelRef = useRef<(kind: DesktopPanelKind) => void>(() => {});
  const panelDisabledRef = useRef<DesktopPanelKind[]>([]);
  const messageInputRef = useRef<MessageInputHandle>(null);
  const messageListRef = useRef<{ scrollToBottom: (behavior?: ScrollBehavior) => void }>(null);
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
    previewUrlRef.current = previewUrl;
  }, [previewUrl]);

  useEffect(() => {
    fileViewRef.current = fileView;
  }, [fileView]);

  useEffect(() => {
    checkedPanelsRef.current = checkedPanels;
  }, [checkedPanels]);

  useEffect(() => {
    panelWidthsRef.current = panelWidths;
  }, [panelWidths]);

  useEffect(() => {
    panelRowsRef.current = panelRows;
  }, [panelRows]);

  useEffect(() => {
    panelRowHeightRef.current = panelRowHeight;
  }, [panelRowHeight]);

  // Cache the whole panel group under the current session so it survives this
  // ChatApp being unmounted/remounted (pane moved across window rows) and so a
  // later session switch can restore it. Skipped on the render where the key
  // flips — the swap effect below re-seeds the state from the new key first.
  useEffect(() => {
    if (!groupKey || groupKey !== groupKeyRef.current) return;
    panelGroupCache.set(groupKey, {
      checked: checkedPanels,
      mounted: mountedPanels,
      widths: panelWidths,
      rows: panelRows,
      rowHeight: panelRowHeight,
      // A forwarded URL's tunnel is session-scoped (scenario 18) — it survives
      // pane remounts and session switches, so the URL is cached like a local
      // one: switching away and back restores the same address, which still
      // loads because the host keeps the tunnel alive for the session.
      previewUrl,
      fileView,
      forward: currentForward,
      forwardError: previewForwardError,
    });
  }, [groupKey, checkedPanels, mountedPanels, panelWidths, panelRows, panelRowHeight, previewUrl, fileView, currentForward, previewForwardError]);

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
      prevKey?.startsWith('new:') &&
      !groupKey.startsWith('new:') &&
      sentFromNewSessionRef.current
    ) {
      group = panelGroupCache.get(prevKey);
      if (group) {
        panelGroupCache.set(groupKey, group);
        panelGroupCache.delete(prevKey);
      }
    }
    sentFromNewSessionRef.current = false;
    setPreviewUrl(group?.previewUrl ?? null);
    setPreviewForwardError(group?.forwardError ?? null);
    setCurrentForward(group?.forward ?? null);
    setCheckedPanels(group?.checked ?? []);
    setMountedPanels(group?.mounted ?? []);
    setPanelWidths(group?.widths ?? {
      preview: PANEL_DEFAULT_WIDTH,
      diff: PANEL_DEFAULT_WIDTH,
      terminal: PANEL_DEFAULT_WIDTH,
      file: PANEL_DEFAULT_WIDTH,
    });
    setPanelRows(group?.rows ?? { preview: 1, diff: 1, terminal: 1, file: 1 });
    setPanelRowHeight(group?.rowHeight ?? null);
    setFileView(group?.fileView ?? null);
  }, [paneId, groupKey]);

  useEffect(() => {
    paneIdRef.current = paneId;
  }, [paneId]);

  // Desktop only: keep <html data-theme> in sync with the resolved theme so the
  // inlined --vscode-* variable set swaps without a reload (FR-018). VSCE/JB
  // inject their own variables and never set state.theme, so this is inert there.
  useEffect(() => {
    if (state.theme) {
      document.documentElement.setAttribute('data-theme', state.theme.effective);
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
    setWorktreeBranch(gitBranches?.current ?? '');
    setWorktreeChecked(true);
  }, [gitBranches]);

  // Handle messages from VS Code extension
  useEffect(() => {
    // Session-scoped host pushes are pane-tagged on desktop (FR-032). This pane
    // consumes a message when it is untagged (single view / IDE hosts / global
    // commands) or tagged with this pane's id. Messages tagged with a different
    // paneId belong to a sibling pane and are ignored here.
    const myPane = paneIdRef.current;
    const forThisPane = (message: any): boolean => myPane === undefined || message.paneId === myPane;

    const handleMessage = (event: MessageEvent) => {
      const message = event.data as any;

      switch (message.command) {
        case 'updateMessages':
          if (!forThisPane(message)) break;
          dispatch({ type: 'SET_MESSAGES', payload: message.messages });
          break;
        case 'updateTasks':
          if (!forThisPane(message)) break;
          dispatch({ type: 'SET_TASKS', payload: message.tasks });
          if (message.isTaskListCollapsed !== undefined) {
            dispatch({ type: 'SET_TASK_LIST_COLLAPSED', payload: message.isTaskListCollapsed });
          }
          break;
        case 'updateBackgroundTasks':
          if (!forThisPane(message)) break;
          dispatch({ type: 'SET_BACKGROUND_TASKS', payload: message.tasks });
          break;
        case 'updateWorkflowRuns':
          if (!forThisPane(message)) break;
          dispatch({ type: 'SET_WORKFLOW_RUNS', payload: message.runs });
          break;
        case 'updateSelection':
          if (!forThisPane(message)) break;
          dispatch({ type: 'UPDATE_SELECTION', payload: message.selection });
          break;
        case 'updatePermissionMode':
          if (!forThisPane(message)) break;
          dispatch({ type: 'SET_PERMISSION_MODE', payload: message.mode });
          break;
        case 'updateWorkdir':
          if (!forThisPane(message)) break;
          dispatch({ type: 'SET_WORKDIR', payload: message.workdir });
          break;
        case 'desktopGitBranches':
          // Per-pane branch list reply (FR-052). Routed by paneId so a sibling
          // pane's reply never overwrites this pane's selector.
          if (!forThisPane(message)) break;
          setPaneGitBranches(message.result ?? null);
          break;
        case 'desktopForwardPortResult':
          // Remote preview port-forward reply (scenario 15/16). The forward is
          // session-scoped, so the reply is matched against the session whose
          // cached forward carries this requestId — a reply that lands after
          // the pane rebinds to another session still updates the owning
          // session's cached URL instead of being dropped.
          if (!forThisPane(message)) break;
          {
            let targetKey: string | undefined;
            panelGroupCache.forEach((g, key) => {
              if (g.forward?.requestId === message.requestId) targetKey = key;
            });
            if (targetKey === undefined) break;
            const target = panelGroupCache.get(targetKey);
            if (!target) break;
            if (message.error) {
              target.forwardError = String(message.error);
              if (targetKey === groupKeyRef.current) setPreviewForwardError(String(message.error));
            } else {
              target.forwardError = null;
              target.previewUrl = message.url as string;
              if (targetKey === groupKeyRef.current) {
                setPreviewForwardError(null);
                setPreviewUrl(message.url as string);
                // Same URL as before (re-acquire after a guest load failure):
                // remount so the webview actually reloads instead of the [url]
                // effect early-returning on an unchanged prop.
                if (message.url === previewUrlRef.current) setPreviewEpoch((e) => e + 1);
              }
            }
          }
          break;
        case 'desktopFileContent':
          // File panel content reply (file panel spec scenario 1/2). Routed by
          // paneId so a sibling pane's reply never overwrites this pane's view.
          if (!forThisPane(message)) break;
          setFileView(message.fileView as FileViewState);
          break;
        case 'updateQueue':
          if (!forThisPane(message)) break;
          dispatch({ type: 'SET_QUEUED_MESSAGES', payload: message.queue });
          break;
        case 'updateQueuedMessageMissing':
          if (!forThisPane(message)) break;
          // The edited queue message no longer exists. Keep input content, exit editing.
          dispatch({ type: 'SET_EDITING_QUEUED_ID', payload: null });
          setQueueEditWarning('编辑的队列消息已不存在！');
          break;
        case 'updateCommandRunning':
          if (!forThisPane(message)) break;
          dispatch({ type: 'SET_COMMAND_RUNNING', payload: message.running });
          break;
        case 'rewindCheckpoints':
          if (!forThisPane(message)) break;
          setRewindCheckpoints(message.checkpoints || []);
          setRewindCheckpointsLoading(false);
          break;
        // Test-only handlers
        case 'startStreaming':
          if (!forThisPane(message)) break;
          dispatch({ type: 'START_STREAMING' });
          break;
        case 'endStreaming':
          if (!forThisPane(message)) break;
          dispatch({ type: 'END_STREAMING' });
          break;
        case 'ensureUIReset':
          if (!forThisPane(message)) break;
          dispatch({ type: 'END_STREAMING' });
          break;
        case 'updateSessions':
          dispatch({ type: 'SET_SESSIONS', payload: message.sessions });
          break;
        case 'updateCurrentSession':
          if (!forThisPane(message)) break;
          dispatch({ type: 'SET_CURRENT_SESSION', payload: message.session });
          break;
        case 'showConfirmation':
          if (!forThisPane(message)) break;
          dispatch({
            type: 'SHOW_CONFIRMATION',
            payload: {
              confirmationId: message.confirmationId,
              toolName: message.toolName,
              confirmationType: message.confirmationType,
              toolInput: message.toolInput,
              planContent: message.planContent,
              suggestedPrefix: message.suggestedPrefix,
              hidePersistentOption: message.hidePersistentOption
            }
          });
          // Scroll to bottom when confirmation is shown
          setTimeout(() => {
            if (messageListRef.current && typeof messageListRef.current.scrollToBottom === 'function') {
              messageListRef.current.scrollToBottom('smooth');
            }
          }, 0);
          break;
        case 'configurationResponse':
          dispatch({
            type: 'SET_CONFIGURATION_DATA',
            payload: message.configurationData
          });
          break;
        case 'projectSettings':
          // Project settings (.wave/settings.json merged enabledPlugins) are
          // per-workdir, so on Desktop each pane may hold a different value —
          // must be pane-guarded (unlike the shared global configurationResponse).
          if (!forThisPane(message)) break;
          dispatch({
            type: 'SET_PROJECT_SETTINGS',
            payload: { enabledPlugins: message.enabledPlugins }
          });
          break;
        case 'setInitialState':
          if (!forThisPane(message)) break;
          dispatch({
            type: 'SET_INITIAL_STATE',
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
              pendingConfirmations: message.pendingConfirmations || (message.pendingConfirmation ? [message.pendingConfirmation] : []),
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
            }
          });
          break;
        case 'desktopThemeChange':
          document.documentElement.setAttribute('data-theme', message.effective);
          break;
        case 'desktopTogglePanel':
          if (!forThisPane(message)) break;
          togglePanelRef.current(message.kind as DesktopPanelKind);
          break;
        case 'showConfiguration':
          if (!forThisPane(message)) break;
          dispatch({
            type: 'SHOW_DIALOG',
            payload: {
              type: 'config' as const,
              data: message.configurationData || stateRef.current.configurationData || {},
              error: message.error
            }
          });
          break;
        case 'showDialog':
          if (!forThisPane(message)) break;
          dispatch({ type: 'SHOW_DIALOG', payload: { type: message.dialogType } });
          break;
        case 'configurationUpdated':
          dispatch({ type: 'HIDE_DIALOG' });
          break;
        case 'statusResponse':
          if (!forThisPane(message)) break;
          if (message.configurationData) {
            dispatch({ type: 'SET_CONFIGURATION_DATA', payload: message.configurationData });
          }
          break;
        case 'configurationError':
          if (!forThisPane(message)) break;
          dispatch({ type: 'SET_CONFIGURATION_ERROR', payload: message.error });
          break;
        case 'focusInput':
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
              '.confirm-dialog-btn-confirm:not([disabled])',
            );
            if (rewindBtn) {
              rewindBtn.focus();
              break;
            }
            const applyBtn = root.querySelector<HTMLElement>(
              '.confirmation-btn-apply:not([disabled])',
            );
            if (applyBtn) {
              applyBtn.focus();
              break;
            }
            if (messageInputRef.current && typeof messageInputRef.current.focus === 'function') {
              messageInputRef.current.focus();
            }
          }
          break;
        case 'triggerShortcut':
          if (!forThisPane(message)) break;
          // Forwarded IDE keymap shortcut (JetBrains): the component-scoped AnAction
          // intercepts the IDE action and forwards the intended operation here, since
          // registerCustomShortcutSet consumes the AWT event before CEF can see it.
          if (messageInputRef.current && typeof messageInputRef.current.triggerShortcut === 'function') {
            messageInputRef.current.triggerShortcut(message.name);
          }
          break;
        case 'scrollToBottom':
          if (!forThisPane(message)) break;
          // Scroll the message list to bottom
          if (messageListRef.current && typeof messageListRef.current.scrollToBottom === 'function') {
            messageListRef.current.scrollToBottom('smooth');
          }
          break;
        // Incremental update commands for streaming optimization
        case 'appendMessage':
          if (!forThisPane(message)) break;
          dispatch({ type: 'APPEND_MESSAGE', payload: message.message });
          break;
        // Bang message incremental updates. Hosts post the bang params nested
        // under `params` (they contain a `command` field that would otherwise
        // clobber the postMessage command discriminator).
        case 'bangMessageAdded':
          if (!forThisPane(message)) break;
          console.log('DBG bangMessageAdded', message.params, stateRef.current.messages.length);
          dispatch({ type: 'APPEND_BANG_MESSAGE', payload: message.params });
          break;
        case 'bangMessageUpdated':
          if (!forThisPane(message)) break;
          dispatch({ type: 'UPDATE_BANG_MESSAGE', payload: message.params });
          break;
        case 'bangMessageCompleted':
          if (!forThisPane(message)) break;
          dispatch({ type: 'COMPLETE_BANG_MESSAGE', payload: message.params });
          break;
        case 'compactionStateChange':
          if (!forThisPane(message)) break;
          dispatch({ type: 'SET_COMPACTING', payload: message.isCompacting === true });
          break;
        case 'updateStreamingContent':
          if (!forThisPane(message)) break;
          dispatch({
            type: 'UPDATE_STREAMING_CONTENT',
            payload: { messageId: message.messageId, chunk: message.chunk, stage: message.stage }
          });
          break;
        case 'updateStreamingReasoning':
          if (!forThisPane(message)) break;
          dispatch({
            type: 'UPDATE_STREAMING_REASONING',
            payload: { messageId: message.messageId as string, chunk: message.chunk as string, stage: message.stage as 'end' | 'streaming' }
          });
          break;
        case 'updateToolBlock':
          if (!forThisPane(message)) break;
          dispatch({ type: 'UPDATE_TOOL_BLOCK', payload: message.params as ToolBlockUpdateCallbackParams });
          break;
        case 'updateErrorBlock':
          if (!forThisPane(message)) break;
          dispatch({ type: 'APPEND_ERROR_BLOCK', payload: { error: message.error } });
          break;
        case 'authStatusResponse':
          dispatch({ type: 'SET_AUTHENTICATED', payload: message.isAuthenticated || false });
          break;
        case 'loginResponse':
          if (message.success) {
            dispatch({ type: 'SET_AUTHENTICATED', payload: true });
          }
          break;
        case 'logoutResponse':
          if (message.success) {
            dispatch({ type: 'SET_AUTHENTICATED', payload: false });
          }
          break;
      }
    };

    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, []);

  // Desktop multi-pane (FR-032): session-scoped commands carry this pane's id
  // so the host routes them to the agent bound to this pane. Untagged when
  // paneId is undefined (IDE hosts) — those backends ignore the field.
  const postToHost = useCallback((message: Record<string, unknown>) => {
    const pid = paneIdRef.current;
    vscode.postMessage(pid === undefined ? message : { ...message, paneId: pid });
  }, [vscode]);

  // Desktop: query this pane's own workdir for its git branches (FR-052). Each
  // pane asks independently so a new-session pane keeps its workdir/branch even
  // when focus moves to a sibling pane (which would otherwise rewire the host's
  // global workdir). Clear stale branches first so the selector hides until the
  // fresh reply lands.
  //
  // Depend ONLY on effectiveWorkdir (a primitive string) — never on the host
  // object reference, and never on host.workdir. Rationale: when a new pane
  // boots, activateAgentInPane sends desktopWorkdirState to update the host's
  // global workdir from the previously-focused sibling's path to this pane's
  // repo root. That changes host.workdir even though THIS pane's
  // effectiveWorkdir is unchanged (spawn-before = recents[0] fallback; spawn-after
  // = state.workdir = agent.cwd = the same recents[0]). Re-querying on a
  // host.workdir change would null out the branches and flash the selector
  // twice. A genuine user workdir switch changes recents[0] (and thus
  // effectiveWorkdir), which is the only re-query signal we want.
  useEffect(() => {
    if (!isDesktop) return;
    setPaneGitBranches(null);
    if (!effectiveWorkdir) return;
    postToHost({ command: 'desktopListGitBranches', workdir: effectiveWorkdir, paneId });
  }, [effectiveWorkdir, isDesktop, postToHost, paneId]);

  const handleClearChat = useCallback(() => {
    // /clear 斜杠命令：三端统一为"原地清空当前会话"，streaming 期间忽略。
    if (stateRef.current.isStreaming) return;

    postToHost({
      command: 'clearChat'
    });
  }, [postToHost]);

  // Desktop 的"新对话"入口（侧边栏按钮）：由宿主 spawn 新 agent 承载全新会话，
  // 当前会话在后台继续，因此流式期间保持可用。
  const handleDesktopNewSession = useCallback(() => {
    postToHost({
      command: 'newSession'
    });
  }, [postToHost]);

  const handleLogin = useCallback(() => {
    vscode.postMessage({ command: 'login' });
  }, [vscode]);

  const handleOpenSettings = useCallback(() => {
    dispatch({ type: 'SHOW_DIALOG', payload: { type: 'config', data: stateRef.current.configurationData || {} } });
    vscode.postMessage({ command: 'getConfiguration' });
  }, [vscode]);

  const handleOpenEnterpriseConsole = useCallback(() => {
    const url = stateRef.current.configurationData?.serverUrl;
    if (url) {
      vscode.postMessage({ command: 'openExternal', url });
    }
  }, [vscode]);

  const handleLogout = useCallback(() => {
    vscode.postMessage({ command: 'logout' });
  }, [vscode]);

  const handleSendMessage = useCallback((text: string, images?: Array<{ data: string; mediaType: string; }>, force: boolean = false) => {
    const trimmedText = text.trim();
    if (!trimmedText && (!images || images.length === 0)) return;

    // Intercept local slash commands — open dialogs instead of sending to agent
    if (trimmedText === '/clear') {
      handleClearChat();
      return;
    }
    if (trimmedText === '/compact' || trimmedText.startsWith('/compact ')) {
      const customInstructions = trimmedText.slice('/compact'.length).trim() || undefined;
      postToHost({
        command: 'compact',
        customInstructions
      });
      return;
    }
    if (trimmedText === '/config') {
      dispatch({ type: 'SHOW_DIALOG', payload: { type: 'config', data: stateRef.current.configurationData || {} } });
      vscode.postMessage({ command: 'getConfiguration' });
      return;
    }
    if (trimmedText === '/plugin') {
      dispatch({ type: 'SHOW_DIALOG', payload: { type: 'plugin' } });
      return;
    }
    if (trimmedText === '/mcp') {
      dispatch({ type: 'SHOW_DIALOG', payload: { type: 'mcp' } });
      return;
    }
    if (trimmedText === '/status') {
      dispatch({ type: 'SHOW_DIALOG', payload: { type: 'status' } });
      return;
    }
    if (trimmedText === '/tasks') { dispatch({ type: 'SHOW_DIALOG', payload: { type: 'tasks' } }); return; }
    if (trimmedText === '/workflows' || trimmedText === '/workflows ') { dispatch({ type: 'SHOW_DIALOG', payload: { type: 'workflows' } }); return; }
    if (trimmedText === '/rewind') {
      if (stateRef.current.isStreaming) return;
      setRewindPopupOpen(true);
      setRewindCheckpointsLoading(true);
      postToHost({ command: 'listRewindCheckpoints' });
      return;
    }

    // Desktop worktree flow (FR-023): on the first message of a new session
    // with the worktree checkbox on, create the worktree first — the main
    // process switches into it and forwards this message.
    if (paneId && groupKeyRef.current?.startsWith('new:')) sentFromNewSessionRef.current = true;
    if (
      host?.type === 'desktop' &&
      stateRef.current.messages.length === 0 &&
      worktreeChecked &&
      effectiveWorkdirRef.current &&
      gitBranches
    ) {
      postToHost({
        command: 'desktopCreateWorktree',
        workdir: effectiveWorkdirRef.current,
        baseBranch: worktreeBranch || gitBranches.current,
        text: trimmedText,
        images: images,
      });
      return;
    }

    // Send to extension
    postToHost({
      command: 'sendMessage',
      text: trimmedText,
      images: images,
      force: force
    });
  }, [handleClearChat, host, worktreeChecked, worktreeBranch, postToHost, paneId, gitBranches]);

  const handleAbortMessage = useCallback(() => {
    if (!state.isStreaming) return;

    postToHost({
      command: 'abortMessage'
    });
  }, [state.isStreaming, postToHost]);

  const handleDeleteQueuedMessage = useCallback((id: string) => {
    // Optimistically update local state (filter by id)
    const newQueue = state.queuedMessages.filter(qm => qm.id !== id);
    dispatch({ type: 'SET_QUEUED_MESSAGES', payload: newQueue });

    // If the deleted one is being edited, exit editing mode
    if (state.editingQueuedId === id) {
      dispatch({ type: 'SET_EDITING_QUEUED_ID', payload: null });
    }

    // Notify extension to delete from SDK's queue by id
    postToHost({
      command: 'deleteQueuedMessageById',
      id
    });
  }, [state.queuedMessages, state.editingQueuedId, postToHost]);

  const handleEditQueuedMessage = useCallback((id: string) => {
    const qm = state.queuedMessages.find(m => m.id === id);
    if (!qm) return;

    const text = qm.content || qm.text || '';

    // Load content into this pane's input via the imperative ref (scoped to this
    // pane only; window.postMessage would be received by all split-view panes).
    messageInputRef.current?.loadQueuedEditContent(text);
    dispatch({ type: 'SET_EDITING_QUEUED_ID', payload: id });
  }, [state.queuedMessages]);

  const handleSendQueuedMessage = useCallback((id: string) => {
    const qm = state.queuedMessages.find(m => m.id === id);
    if (!qm) return;

    const text = qm.content || qm.text || '';
    const images = qm.images?.map(img => ({ data: img.path || '', mediaType: img.mimeType || '' }));

    // force=true: terminate current conversation and send this message immediately
    handleSendMessage(text, images, true);

    // Optimistically remove from queue + notify backend (and exit editing if applicable)
    handleDeleteQueuedMessage(id);
  }, [state.queuedMessages, handleSendMessage, handleDeleteQueuedMessage]);

  const handleSubmitQueuedEdit = useCallback((id: string, text: string, images?: Array<{ data: string; mediaType: string; }>) => {
    postToHost({
      command: 'updateQueuedMessage',
      id,
      text,
      images
    });
    dispatch({ type: 'SET_EDITING_QUEUED_ID', payload: null });
  }, [postToHost]);

  const handleCancelQueuedEdit = useCallback(() => {
    dispatch({ type: 'SET_EDITING_QUEUED_ID', payload: null });
  }, []);

  // Configuration handlers
  const handleConfigurationSave = useCallback((configData: ConfigurationData) => {
    dispatch({ type: 'SET_CONFIGURATION_LOADING', payload: true });
    vscode.postMessage({
      command: 'updateConfiguration',
      configurationData: configData
    });
  }, [vscode]);

  const handleDialogClose = useCallback(() => {
    dispatch({ type: 'HIDE_DIALOG' });
  }, []);

  // Welcome page shows only when there are no messages yet. Login is optional:
  // a direct-connect config (baseURL/apiKey) works without authentication, so an
  // unauthenticated user who sends a message must still see the chat, not the welcome page.
  const showWelcome = state.messages.length === 0;
  // Withhold the welcome page until the initial state (incl. auth status) has
  // arrived, otherwise logged-in users see the login CTA flash before
  // setInitialState updates isAuthenticated to true.
  const showWelcomeReady = showWelcome && state.initialized;

  // Initialize webview and load sessions on component mount
  useEffect(() => {
    dispatch({ type: 'SET_SESSIONS_LOADING', payload: true });
    vscode.postMessage({
      command: 'webviewReady'
    });
  }, [vscode]);

  const handleSessionSelect = useCallback((sessionId: string) => {
    if (state.isStreaming) return;

    // 清空当前任务列表：避免恢复期间残留旧会话的任务，
    // 并让新会话任务从空状态进入（若全部已完成则直接保持隐藏）
    dispatch({ type: 'SET_TASKS', payload: [] });

    postToHost({
      command: 'restoreSession',
      sessionId
    });
  }, [state.isStreaming, postToHost]);

  const handleInputCleared = useCallback(() => {
    dispatch({ type: 'INPUT_CLEARED' });
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

  const handleConfirmation = useCallback((confirmationId: string, decision?: ConfirmationDecision) => {
    postToHost({
      command: 'confirmationResponse',
      confirmationId,
      approved: true,
      decision
    });
    dispatch({ type: 'HIDE_CONFIRMATION', payload: confirmationId });
  }, [postToHost]);

  const handleRejection = useCallback((confirmationId: string) => {
    postToHost({
      command: 'confirmationResponse',
      confirmationId,
      approved: false
    });
    dispatch({ type: 'HIDE_CONFIRMATION', payload: confirmationId });
  }, [postToHost]);

  const handleRewindToMessage = useCallback((messageId: string) => {
    if (state.isStreaming) return;
    setPendingRewindId(messageId);
  }, [state.isStreaming]);

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

  const handleRewindConfirm = useCallback(() => {
    const messageId = pendingRewindId;
    setPendingRewindId(null);
    if (messageId) {
      postToHost({
        command: 'rewindToMessage',
        messageId
      });
    }
  }, [pendingRewindId, postToHost]);

  const showPanelHint = useCallback((text: string) => {
    if (panelHintTimer.current) clearTimeout(panelHintTimer.current);
    setPanelHint(text);
    panelHintTimer.current = setTimeout(() => setPanelHint(null), PANEL_HINT_DURATION_MS);
  }, []);

  // Desktop remote sessions: request an ssh port forward for the clicked
  // localhost URL (scenario 15). The main process picks a local port, starts
  // `ssh -N -L` and replies with the rewritten 127.0.0.1 address, which the
  // preview pane then loads. Repeated clicks on the SAME link while the forward
  // is established or connecting are no-ops — the tunnel is reused, not rebuilt.
  const acquireForward = useCallback((host: string, url: string) => {
    // The forward is keyed by the session's panel-group key; without one (a
    // pane-less desktop view) there is nothing to cache the reference under.
    if (!groupKey) return;
    let remotePort: number;
    try {
      const u = new URL(url);
      if (u.protocol !== 'http:' && u.protocol !== 'https:') {
        showPanelHint('仅支持 http/https 链接');
        return;
      }
      remotePort = Number(u.port) || (u.protocol === 'https:' ? 443 : 80);
    } catch {
      showPanelHint('无效的预览链接');
      return;
    }
    const requestId = `fwd-${++forwardSeqRef.current}`;
    const fwd = { host, remotePort, originalUrl: url, requestId };
    setCurrentForward(fwd);
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
    postToHost({ command: 'desktopForwardPort', host, url, requestId, sessionId: groupKey });
  }, [postToHost, showPanelHint, groupKey]);

  // Desktop: idle-preload the lazily injected xterm chunk so the first
  // terminal open doesn't pay the fetch+parse cost.
  useEffect(() => {
    if (!isDesktop) return;
    const id = window.requestIdleCallback?.(() => prefetchTerminalLib());
    return () => {
      if (id !== undefined) window.cancelIdleCallback?.(id);
    };
  }, [isDesktop]);

  // Check a panel on: when its assigned row lacks the width, a first-row panel
  // spills into the second row (creating it when the body is tall enough);
  // only refuse when no row can take it. Mounting is sticky — unchecking only
  // hides.
  const tryOpenPanel = useCallback((kind: DesktopPanelKind): boolean => {
    const assigned = panelRowsRef.current[kind];
    const containerW = chatContainerRef.current?.getBoundingClientRect().width;
    // First-row panels share their line with the message area; second-row
    // panels may span the full width.
    const fitsInRow = (row: PanelRow): boolean => {
      if (!containerW) return true;
      const used =
        checkedPanelsRef.current
          .filter((k) => panelRowsRef.current[k] === row)
          .reduce((sum, k) => sum + panelWidthsRef.current[k], 0) + panelWidthsRef.current[kind];
      return containerW - used >= (row === 1 ? CHAT_MAIN_MIN_WIDTH : 0);
    };
    let row = assigned;
    if (!fitsInRow(row)) {
      if (row === 1 && fitsInRow(2)) {
        row = 2;
      } else {
        showPanelHint('空间不足，无法开启面板');
        return false;
      }
    }
    // Landing in the second row while none is shown (re)creates it — refuse
    // when the body is too short for both row minimums.
    if (row === 2 && !checkedPanelsRef.current.some((k) => panelRowsRef.current[k] === 2)) {
      const bodyH = chatBodyRef.current?.getBoundingClientRect().height;
      if (bodyH) {
        if (!canCreatePanelRow(bodyH)) {
          showPanelHint('空间不足，无法开启面板');
          return false;
        }
        if (panelRowHeightRef.current == null) setPanelRowHeight(defaultPanelRowHeight(bodyH));
      }
    }
    if (row !== assigned) setPanelRows((prev) => ({ ...prev, [kind]: row }));
    setCheckedPanels((prev) => (prev.includes(kind) ? prev : [...prev, kind]));
    setMountedPanels((prev) => (prev.includes(kind) ? prev : [...prev, kind]));
    return true;
  }, [showPanelHint]);

  const handleTogglePanel = useCallback((kind: DesktopPanelKind) => {
    if (panelDisabledRef.current.includes(kind)) return;
    if (checkedPanelsRef.current.includes(kind)) {
      setCheckedPanels((prev) => prev.filter((k) => k !== kind));
      // Closing the preview hides the pane but never releases a remote tunnel
      // (scenario 18): the URL stays cached so re-checking shows the same page,
      // and the host keeps the ssh forward alive until the session is deleted.
    } else {
      tryOpenPanel(kind);
    }
  }, [tryOpenPanel]);

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
        vscode.postMessage({ command: 'openFile', path, startLine, endLine });
        return;
      }
      if (!tryOpenPanel('file')) return;
      // Re-clicking the file already shown re-reads it (soft refresh: keep the
      // old content until the host reply lands, matching the diff pane).
      setFileView((prev) =>
        prev && prev.path === path
          ? { ...prev, loading: true, startLine, endLine }
          : { path, host: effectiveHost, loading: true, startLine, endLine },
      );
      postToHost({ command: 'openFile', path, host: effectiveHost, startLine, endLine });
    },
    [isDesktop, tryOpenPanel, effectiveHost, postToHost, vscode],
  );

  // Local sessions only: leave the panel and open the file in the OS default
  // app (remote hosts have no local file — the button is hidden).
  const handleOpenFileExternal = useCallback(
    (path: string) => {
      if (!isDesktop || !path) return;
      postToHost({ command: 'desktopOpenFileExternal', path });
    },
    [isDesktop, postToHost],
  );

  // Authoritative clamp at drag time: keep the panel within [320, container -
  // other checked panels in the same row - (row 1 only) conversation minimum].
  const handlePanelWidthChange = useCallback((kind: DesktopPanelKind, width: number) => {
    let clamped = Math.max(width, PANEL_MIN_WIDTH);
    const containerW = chatContainerRef.current?.getBoundingClientRect().width;
    if (containerW) {
      const row = panelRowsRef.current[kind];
      const others = checkedPanelsRef.current
        .filter((k) => k !== kind && panelRowsRef.current[k] === row)
        .reduce((sum, k) => sum + panelWidthsRef.current[k], 0);
      clamped = Math.min(clamped, containerW - others - (row === 1 ? CHAT_MAIN_MIN_WIDTH : 0));
    }
    setPanelWidths((prev) => ({ ...prev, [kind]: clamped }));
  }, []);

  // Move a panel between the first row (right of the message area) and the
  // second row (below it). Creating the row refuses with a hint when the body
  // is too short for both row minimums.
  const movePanelToRow = useCallback((kind: DesktopPanelKind, row: PanelRow) => {
    if (panelRowsRef.current[kind] === row) return;
    if (row === 2 && !checkedPanelsRef.current.some((k) => panelRowsRef.current[k] === 2)) {
      const bodyH = chatBodyRef.current?.getBoundingClientRect().height ?? 0;
      if (bodyH) {
        if (!canCreatePanelRow(bodyH)) {
          showPanelHint('空间不足，无法创建面板行');
          return;
        }
        if (panelRowHeightRef.current == null) setPanelRowHeight(defaultPanelRowHeight(bodyH));
      }
    }
    setPanelRows((prev) => ({ ...prev, [kind]: row }));
  }, [showPanelHint]);

  // Panel-toolbar drag source. The toolbars live inside the panel components,
  // so the drag is wired imperatively (same pattern as the pane-header drag in
  // DesktopShell): the press target is recorded on mousedown and a drag that
  // began on a toolbar button is vetoed at dragstart so it stays a click.
  useLayoutEffect(() => {
    if (!isDesktop) return;
    const disposers: Array<() => void> = [];
    for (const kind of mountedPanels) {
      const toolbar = panelSlotNodes.current
        .get(kind)
        ?.querySelector<HTMLElement>('.preview-pane-toolbar');
      if (!toolbar) continue;
      toolbar.draggable = true;
      let pressTarget: EventTarget | null = null;
      const onMouseDown = (e: MouseEvent) => {
        pressTarget = e.target;
      };
      const onDragStart = (e: DragEvent) => {
        if (!e.dataTransfer) return;
        if (
          pressTarget instanceof Element &&
          pressTarget.closest('button, a, input, select, textarea, [role="button"]')
        ) {
          e.preventDefault();
          return;
        }
        draggedPanelRef.current = kind;
        setPanelDragActive(true);
        e.dataTransfer.setData(PANEL_DRAG_MIME, kind);
        try {
          e.dataTransfer.effectAllowed = 'move';
        } catch {
          // jsdom's DataTransfer polyfill exposes a read-only effectAllowed.
        }
      };
      const onDragEnd = () => {
        pressTarget = null;
        draggedPanelRef.current = null;
        setPanelDragActive(false);
        setPanelDropZone(null);
      };
      toolbar.addEventListener('mousedown', onMouseDown);
      toolbar.addEventListener('dragstart', onDragStart);
      toolbar.addEventListener('dragend', onDragEnd);
      disposers.push(() => {
        toolbar.removeEventListener('mousedown', onMouseDown);
        toolbar.removeEventListener('dragstart', onDragStart);
        toolbar.removeEventListener('dragend', onDragEnd);
        toolbar.draggable = false;
      });
    }
    return () => disposers.forEach((dispose) => dispose());
    // previewUrl swaps the preview slot between the stub and PreviewPane —
    // two different toolbar nodes — so the wiring must re-run on that swap.
  }, [isDesktop, mountedPanels, previewUrl]);

  // Hit-testing while a panel toolbar drags over the chat body: the bottom
  // band targets the second row (creating it when absent), the rest targets
  // the first row. The overlay is only shown for an actual row change.
  const handlePanelDragOver = useCallback((e: React.DragEvent) => {
    const kind = draggedPanelRef.current;
    if (!kind || !e.dataTransfer.types.includes(PANEL_DRAG_MIME)) return;
    const body = chatBodyRef.current;
    if (!body) return;
    const rect = body.getBoundingClientRect();
    const y = e.clientY - rect.top;
    const row2Height = panelRowHeightRef.current ?? 0;
    const hasRow2 = checkedPanelsRef.current.some((k) => panelRowsRef.current[k] === 2);
    let target: PanelRow;
    if (hasRow2) {
      target = y >= rect.height - row2Height ? 2 : 1;
    } else {
      // No second row yet: a bottom edge band previews where it would open.
      const band = Math.min(120, Math.max(64, rect.height * 0.3));
      target = y >= rect.height - band ? 2 : 1;
    }
    if (target === panelRowsRef.current[kind]) {
      setPanelDropZone(null);
      return;
    }
    if (target === 2) {
      if (!hasRow2) {
        if (rect.height && !canCreatePanelRow(rect.height)) {
          showPanelHint('空间不足，无法创建面板行');
          setPanelDropZone(null);
          return;
        }
        const h = row2Height || defaultPanelRowHeight(rect.height);
        setPanelDropZone({ row: 2, top: rect.height - h, height: h });
      } else {
        setPanelDropZone({ row: 2, top: rect.height - row2Height, height: row2Height });
      }
    } else {
      setPanelDropZone({ row: 1, top: 0, height: rect.height - row2Height - PANEL_ROW_SEPARATOR_PX });
    }
    e.preventDefault();
  }, [showPanelHint]);

  const handlePanelDragLeave = useCallback((e: React.DragEvent) => {
    const body = chatBodyRef.current;
    if (body && e.relatedTarget instanceof Node && body.contains(e.relatedTarget)) return;
    setPanelDropZone(null);
  }, []);

  const handlePanelDrop = useCallback((e: React.DragEvent) => {
    const kind = draggedPanelRef.current;
    if (!kind || !e.dataTransfer.types.includes(PANEL_DRAG_MIME)) return;
    e.preventDefault();
    const zone = panelDropZone;
    setPanelDropZone(null);
    if (zone) movePanelToRow(kind, zone.row);
  }, [panelDropZone, movePanelToRow]);

  // Dragging the horizontal separator trades message-row height for
  // panel-row height, clamped to both row minimums.
  const handlePanelRowSeparatorMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    const bodyH = chatBodyRef.current?.getBoundingClientRect().height ?? 0;
    const startY = e.clientY;
    const startH = panelRowHeightRef.current ?? defaultPanelRowHeight(bodyH);
    const max = bodyH
      ? Math.max(bodyH - CHAT_MAIN_MIN_HEIGHT - PANEL_ROW_SEPARATOR_PX, PANEL_ROW_MIN_HEIGHT)
      : Number.MAX_SAFE_INTEGER;
    setPanelRowSeparatorActive(true);
    const onMove = (ev: MouseEvent) => {
      setPanelRowHeight(Math.min(Math.max(startH - (ev.clientY - startY), PANEL_ROW_MIN_HEIGHT), max));
    };
    const onUp = () => {
      setPanelRowSeparatorActive(false);
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }, []);

  // Desktop only: open/re-target the preview panel. Clicking a localhost link
  // checks the preview item (refused with a hint when space runs out) and loads
  // the URL. Message.tsx gates on waveHostType, so this never fires in IDE hosts.
  const handleOpenPreview = useCallback((url: string) => {
    if (!checkedPanelsRef.current.includes('preview') && !tryOpenPanel('preview')) return;
    setPreviewUrl(url);
  }, [tryOpenPanel]);

  // Remote localhost link handler: open the preview panel (creating it when
  // absent) and forward. The same URL — under any loopback/all-interfaces
  // host spelling — is a no-op unless the previous attempt failed (scenario
  // 15/16). Every other click — a different path, a different origin, another
  // service entirely — just re-targets the panel; tunnels are session-scoped
  // and only die when the session is deleted (scenario 18).
  const handleOpenRemotePreview = useCallback((url: string) => {
    if (!checkedPanelsRef.current.includes('preview') && !tryOpenPanel('preview')) return;
    // Read the refs, not the state values: this callback is captured by the
    // memoized Message component at mount, so closing over state would freeze
    // the first render's values and break the same-link dedup below.
    const current = currentForwardRef.current;
    if (current && canonicalForwardUrl(current.originalUrl) === canonicalForwardUrl(url) && previewForwardErrorRef.current === null) return;
    setPreviewForwardError(null);
    setPreviewUrl(null); // show the connecting stub while the tunnel comes up
    acquireForward(effectiveHostRef.current, url);
  }, [tryOpenPanel, acquireForward]);

  // Retry after a failed forward (scenario 16): re-request the same tunnel.
  // The host treats a failed entry as gone, so a fresh forward is established.
  const handleRemotePreviewRetry = useCallback(() => {
    const fwd = currentForwardRef.current;
    if (!fwd) return;
    setPreviewForwardError(null);
    acquireForward(fwd.host, fwd.originalUrl);
  }, [acquireForward]);

  const openPreviewHandler = effectiveHost !== 'local' ? handleOpenRemotePreview : handleOpenPreview;

  // Diff/terminal need a workdir; preview only needs a URL. Remote sessions
  // keep diff/terminal (git and the shell run over ssh) and gain preview via
  // port forwarding (scenario 15); only the workdir requirement remains.
  const panelDisabled: DesktopPanelKind[] = effectiveWorkdir ? [] : ['diff', 'terminal'];

  useEffect(() => {
    panelDisabledRef.current = panelDisabled;
  }, [panelDisabled]);

  // Report this pane's toggle state so the desktop app menu's 面板 checkboxes
  // reflect the focused pane.
  useEffect(() => {
    if (!isDesktop) return;
    postToHost({ command: 'desktopPanelState', checked: checkedPanels });
  }, [checkedPanels, isDesktop, postToHost]);

  // Width ceiling for one panel: container minus the other checked panels in
  // the same row and (row 1 only) the conversation-area minimum. Render-time
  // estimate — the drag handler re-clamps authoritatively on every mousemove.
  const panelMaxWidth = (kind: DesktopPanelKind): number => {
    const containerW = chatContainerRef.current?.getBoundingClientRect().width ?? window.innerWidth;
    const row = panelRows[kind];
    const others = checkedPanels
      .filter((k) => k !== kind && panelRows[k] === row)
      .reduce((sum, k) => sum + panelWidths[k], 0);
    return containerW - others - (row === 1 ? CHAT_MAIN_MIN_WIDTH : 0);
  };

  const renderPanelSlot = (kind: DesktopPanelKind) => {
    const common = {
      width: panelWidths[kind],
      onWidthChange: (w: number) => handlePanelWidthChange(kind, w),
      maxWidth: panelMaxWidth(kind),
      onClose: () => handleTogglePanel(kind),
      widthFromLeft: panelRows[kind] === 2,
    };

    // Empty preview (no URL yet) reuses the same left-edge resize handle so it
    // can be widened like the loaded preview/diff/terminal panels.
    const onEmptyPreviewDragStart = (e: React.MouseEvent) => {
      e.preventDefault();
      const handle = e.currentTarget as HTMLElement;
      handle.style.background = 'var(--vscode-focusBorder, #007fd4)';
      document.body.classList.add('is-panel-resizing');
      const rect = handle.parentElement?.getBoundingClientRect();
      const onMove = (ev: MouseEvent) => {
        const next = common.widthFromLeft ? ev.clientX - (rect?.left ?? 0) : (rect?.right ?? 0) - ev.clientX;
        common.onWidthChange(Math.min(Math.max(next, PANEL_MIN_WIDTH), common.maxWidth));
      };
      const onUp = () => {
        handle.style.background = '';
        document.body.classList.remove('is-panel-resizing');
        window.removeEventListener('mousemove', onMove);
        window.removeEventListener('mouseup', onUp);
      };
      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', onUp);
    };

    if (kind === 'preview') {
      return previewUrl ? (
        <PreviewPane
          key={previewEpoch}
          url={previewUrl}
          originalUrl={currentForward?.originalUrl}
          onRetry={currentForward ? handleRemotePreviewRetry : undefined}
          vscode={vscode}
          onAddComment={handleAddComment}
          {...common}
        />
      ) : (
        <aside className="preview-pane" style={{ width: common.width }} data-testid="preview-pane-empty">
          <div className="preview-pane-drag-handle" onMouseDown={onEmptyPreviewDragStart} />
          <div className="preview-pane-inner">
            <div className="preview-pane-toolbar">
              <span className="preview-pane-url">预览</span>
              <button className="preview-pane-button" title="关闭" data-testid="preview-close" onClick={common.onClose}>
                <i className="codicon codicon-close" />
              </button>
            </div>
            <div className="desktop-panel-placeholder">
              {previewForwardError ? (
                <>
                  <span>远程预览加载失败：{previewForwardError}</span>
                  <button className="preview-pane-button" data-testid="preview-forward-retry" onClick={handleRemotePreviewRetry}>
                    重试
                  </button>
                </>
              ) : (
                <>点击消息或终端中的 localhost 链接加载预览</>
              )}
            </div>
          </div>
        </aside>
      );
    }
    if (kind === 'diff') {
      return (
        <DiffPane
          vscode={vscode}
          paneId={paneId}
          visible={checkedPanels.includes('diff')}
          isStreaming={state.isStreaming}
          sessionId={state.currentSession?.id}
          workdir={effectiveWorkdir}
          onAddComment={handleAddComment}
          {...common}
        />
      );
    }
    if (kind === 'file') {
      return (
        <FilePane
          fileView={fileView}
          onOpenExternal={handleOpenFileExternal}
          workdir={effectiveWorkdir}
          {...common}
        />
      );
    }
    return (
      <TerminalPane
        vscode={vscode}
        paneId={paneId}
        visible={checkedPanels.includes('terminal')}
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
    <div className="chat-restoring-overlay" data-testid="chat-restoring-overlay">
      <LoadingLogo />
    </div>
  ) : (
    <>
      {showWelcomeReady ? (
        <WelcomeView
          isAuthenticated={state.isAuthenticated}
          hasDirectConnectConfig={!!(state.configurationData?.apiKey && state.configurationData?.baseURL)}
          onLogin={handleLogin}
        />
      ) : showWelcome ? (
        <LoadingLogo />
      ) : (
        <MessageList
          ref={messageListRef}
          messages={state.messages}
          queuedMessages={state.queuedMessages}
          isStreaming={state.isStreaming}
          isCompacting={state.isCompacting}
          vscode={vscode}
          onRewindToMessage={handleRewindToMessage}
          workdir={state.workdir}
          onOpenPreview={openPreviewHandler}
          onOpenFile={handleOpenFile}
        />
      )}

      <div className={`input-area-container${isDesktop && state.pendingConfirmations.length > 0 ? ' input-area-container--confirm' : ''}`}>
        <div style={{ display: state.pendingConfirmations.length === 0 ? 'block' : 'none' }}>
          <TaskList
            // 按会话 id 重挂载：切换会话时重置“观察过未完成任务”的跟踪，
            // 使全部已完成的新会话立即隐藏，而不是沿用上一会话的 5 秒宽限
            key={state.currentSession?.id}
            tasks={state.tasks}
            isCollapsed={state.isTaskListCollapsed}
            onToggleCollapse={() => dispatch({ type: 'TOGGLE_TASK_LIST_COLLAPSE' })}
          />
          <QueuedMessageList
            queuedMessages={state.queuedMessages}
            isCollapsed={state.isQueueCollapsed}
            onToggleCollapse={() => dispatch({ type: 'TOGGLE_QUEUE_COLLAPSE' })}
            onEdit={handleEditQueuedMessage}
            onSend={handleSendQueuedMessage}
            onDelete={handleDeleteQueuedMessage}
            editingQueuedId={state.editingQueuedId}
            vscode={vscode}
          />
        </div>

        <div style={{ display: state.pendingConfirmations.length === 0 ? 'block' : 'none' }}>
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
            permissionMode={state.permissionMode}
            initialAttachedImages={state.attachedImages}
            disabled={host?.type === 'desktop' && !effectiveWorkdir}
            workdirSelector={
              host?.type === 'desktop' && state.messages.length === 0 ? (
                <>
                  <DesktopHostSelector
                    host={effectiveHost}
                    hosts={host.hosts}
                    onSelectHost={host.onSelectHost}
                    onAddHost={host.onAddHost}
                  />
                  <DesktopWorkdirSelector
                    host={effectiveHost}
                    workdir={effectiveWorkdir}
                    recentWorkdirs={host.recentWorkdirs}
                    onSelectWorkdir={host.onSelectWorkdir}
                    onSelectRemotePath={(path) => host.onSelectRemotePath(path, effectiveHost)}
                    onListRemoteDir={(path, requestId) => host.onListRemoteDir(path, effectiveHost, requestId)}
                    onSelectRecentWorkdir={host.onSelectRecentWorkdir}
                    onRemoveRecentWorkdir={host.onRemoveRecentWorkdir}
                  />
                  {effectiveWorkdir && gitBranches && (
                    <DesktopWorktreeControls
                      branches={gitBranches.branches}
                      branch={worktreeBranch || gitBranches.current}
                      worktreeChecked={worktreeChecked}
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
          />
        </div>

        {state.pendingConfirmations.length > 0 && (
          <ConfirmationDialog
            key={state.pendingConfirmations[0].confirmationId}
            data-confirmation-id={state.pendingConfirmations[0].confirmationId}
            confirmation={state.pendingConfirmations[0]}
            onConfirm={handleConfirmation}
            onReject={handleRejection}
          />
        )}
      </div>
    </>
  );

  // Second row exists while at least one checked panel is assigned to it.
  const hasPanelRow2 = checkedPanels.some((k) => panelRows[k] === 2);
  // With no first-row panels the message area must claim the full first line,
  // otherwise the row separator would share its line (flex-wrap line packing).
  const panelRow1Empty = !checkedPanels.some((k) => panelRows[k] === 1);
  // The last checked second-row panel (by the fixed Preview→Diff→Terminal
  // order) grows to fill the remaining width so the second row spans the full
  // pane width instead of leaving a gap to the right of a lone panel.
  const row2CheckedKinds = PANEL_ORDER.filter(
    (k) => checkedPanels.includes(k) && panelRows[k] === 2,
  );
  const row2FillKind = row2CheckedKinds[row2CheckedKinds.length - 1];

  const chatContainer = (
    <div className="chat-container" data-testid="chat-container" ref={isDesktop ? chatContainerRef : undefined}>
      {queueEditWarning && (
        <div className="queue-edit-warning-banner" role="alert" data-testid="queue-edit-warning">
          <span className="queue-edit-warning-text">{queueEditWarning}</span>
          <button
            className="queue-edit-warning-close"
            onClick={() => setQueueEditWarning(null)}
            aria-label="关闭"
          >
            <i className="codicon codicon-close"></i>
          </button>
        </div>
      )}
      <ChatHeader
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
        onLogin={handleLogin}
        onLogout={handleLogout}
        isAuthenticated={state.isAuthenticated}
        hideSessionButtons={isDesktop}
        hideMoreButton={isDesktop}
        panelToggle={
          isDesktop
            ? { checked: checkedPanels, onToggle: handleTogglePanel, disabled: panelDisabled }
            : undefined
        }
      />
      {isDesktop ? (
        <div
          ref={chatBodyRef}
          className={`desktop-chat-body${hasPanelRow2 ? ' desktop-chat-body--two-rows' : ''}${
            hasPanelRow2 && panelRow1Empty ? ' desktop-chat-body--row1-empty' : ''
          }${panelDragActive ? ' desktop-chat-body--panel-dragging' : ''}`}
          style={
            hasPanelRow2 && panelRowHeight != null
              ? ({ '--panel-row-height': `${panelRowHeight}px` } as React.CSSProperties)
              : undefined
          }
          onDragOver={handlePanelDragOver}
          onDragLeave={handlePanelDragLeave}
          onDrop={handlePanelDrop}
        >
          <div className="desktop-chat-main">{chatBodyContent}</div>
          {PANEL_ORDER.filter((kind) => mountedPanels.includes(kind)).map((kind) => (
            <div
              key={kind}
              ref={(el) => {
                if (el) panelSlotNodes.current.set(kind, el);
                else panelSlotNodes.current.delete(kind);
              }}
              className={`desktop-panel-slot desktop-panel-slot--row-${panelRows[kind]}${
                kind === row2FillKind ? ' desktop-panel-slot--row-2-fill' : ''
              }`}
              style={{ display: checkedPanels.includes(kind) ? undefined : 'none' }}
            >
              {renderPanelSlot(kind)}
            </div>
          ))}
          {hasPanelRow2 && (
            <div
              className={`desktop-panel-row-separator${
                panelRowSeparatorActive ? ' desktop-panel-row-separator--active' : ''
              }`}
              data-testid="desktop-panel-row-separator"
              onMouseDown={handlePanelRowSeparatorMouseDown}
            />
          )}
          {panelDropZone && (
            <div
              className="desktop-panel-dropzone"
              data-testid="desktop-panel-dropzone"
              style={{ top: panelDropZone.top, height: panelDropZone.height }}
            />
          )}
          {panelHint && (
            <div className="desktop-pane-hint" role="status" data-testid="desktop-panel-hint">
              {panelHint}
            </div>
          )}
        </div>
      ) : (
        chatBodyContent
      )}

      {state.activeDialog === 'config' && (
        <ConfigDialog
          configurationData={state.configurationData || {}}
          isLoading={state.configurationLoading}
          error={state.configurationError}
          onSave={handleConfigurationSave}
          onCancel={handleDialogClose}
          projectSettings={state.projectSettings}
          onLoadProjectSettings={() => postToHost({ command: 'getProjectSettings' })}
          onToggleBuiltinPlugin={(pluginId, enabled) =>
            postToHost({ command: 'setBuiltinPluginEnabled', pluginId, enabled, scope: 'project' })
          }
          vscode={vscode}
        />
      )}
      {state.activeDialog === 'plugin' && (
        <PluginDialog vscode={vscode} onClose={handleDialogClose} />
      )}
      {state.activeDialog === 'mcp' && (
        <McpDialog vscode={vscode} onClose={handleDialogClose} />
      )}
      {state.activeDialog === 'status' && (
        <StatusDialog
          onClose={handleDialogClose}
          vscode={vscode}
        />
      )}
      {state.activeDialog === 'tasks' && (
        <BackgroundTaskManager
          tasks={state.backgroundTasks}
          vscode={vscode}
          onClose={handleDialogClose}
        />
      )}
      {state.activeDialog === 'workflows' && (
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
    </div>
  );

  if (host?.type === 'desktop') {
    // FR-032 split-view: when the host has pushed a pane layout, DesktopShell
    // owns the row of paneId-scoped ChatApp instances. This instance then only
    // contributes its pane-scoped chatContainer (rendered below); without a
    // paneId it would double-render, so bail out to the shell instead.
    if ((host.panes?.length ?? 0) > 0 && paneId === undefined) {
      return (
        <DesktopShell
          vscode={vscode}
          host={host}
          onOpenSettings={handleOpenSettings}
          onOpenEnterpriseConsole={handleOpenEnterpriseConsole}
          onLogin={handleLogin}
          onLogout={handleLogout}
          isAuthenticated={state.isAuthenticated}
        />
      );
    }
    // Inside DesktopShell each pane renders only its own chatContainer; the
    // sidebar / preview pane live in the shell / single-pane layout.
    if (paneId !== undefined) {
      return chatContainer;
    }
    return (
      <div className="desktop-layout">
        <DesktopSidebar
          onNewSession={handleDesktopNewSession}
          onNewSessionInPane={() => postToHost({ command: 'desktopNewSessionInPane' })}
          isStreaming={state.isStreaming}
          disabled={!host.workdir}
          onOpenSettings={handleOpenSettings}
          onOpenEnterpriseConsole={handleOpenEnterpriseConsole}
          onLogin={handleLogin}
          onLogout={handleLogout}
          isAuthenticated={state.isAuthenticated}
          hostLabel={effectiveHost}
          sessionTree={host.sessionTree}
          currentSessionId={state.currentSession?.id}
          onSelectSession={host.onSelectSession}
          onOpenPane={host.onOpenPane}
          onDeleteSession={host.onDeleteSession}
        />
        {chatContainer}
      </div>
    );
  }

  return chatContainer;
};