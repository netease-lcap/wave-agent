import React, { useCallback, useEffect, useRef, useState } from "react";
import type { VsCodeApi } from "../types";
import { formatCodeComment } from "../utils/codeComment";
import { diffSelectionKey, type DiffSelection } from "../utils/sessionUiStore";
import { useHostMessage } from "../utils/useHostMessage";
import {
  DIFF_COLLAPSE_THRESHOLD,
  DIFF_MIN_DIFF_WIDTH,
  DIFF_TREE_WIDTH,
  DIFF_WORD_HIGHLIGHT_LIMIT,
  nextExpandedPath,
  totalChangedLines,
} from "../utils/diffHunks";
import {
  DiffFileRows,
  type DiffLineCommentTarget,
  type DiffViewMode,
} from "./DiffFileRows";
import { DiffFileTree } from "./DiffFileTree";
import { TreeToggleIcon } from "./FilePaneToolbarIcons";
import { RefreshIcon } from "./HeaderIcons";
import { LineCommentBox } from "./LineCommentBox";
import { PanePlaceholder, PaneShell } from "./PaneShell";
import { Tooltip } from "./Tooltip";
import { isDesktopHost } from "../utils/platform";
import "../styles/DiffViewer.css";
import "../styles/DiffPane.css";

export type WorkspaceFileStatus =
  | "added"
  | "modified"
  | "deleted"
  | "renamed"
  | "untracked";

// Contract shapes mirror the CLI's diff service
// (`packages/code/src/utils/workspaceDiff.ts`), which answers the desktop's
// `getWorkspaceDiff` RPC on whichever host owns the repository. The webview is
// shared by four hosts, so it cannot import that module — keep the two
// definitions in sync when the payload changes.
export interface WorkspaceDiffFile {
  path: string;
  status: WorkspaceFileStatus;
  oldPath?: string;
  additions: number;
  deletions: number;
  hunks: string;
  truncated: boolean;
  binary: boolean;
}

export interface WorkspaceDiffCommit {
  sha: string;
  shortSha: string;
  subject: string;
}

export interface WorkspaceDiffBase {
  label: string;
  sha: string | null;
  kind: "default-branch" | "env" | "head" | "index";
  ref: string | null;
}

export type WorkspaceDiffScope =
  | { kind: "all" }
  | { kind: "uncommitted" }
  | { kind: "commit"; sha: string; shortSha: string; subject: string };

/** A merge/rebase/cherry-pick/revert still in flight (host answers this). */
export type TransientGitOperation =
  | "merge"
  | "rebase"
  | "cherry-pick"
  | "revert";

type DiffState =
  | { kind: "loading" }
  | { kind: "not-a-repo" }
  | { kind: "transient"; operation: TransientGitOperation }
  | {
      kind: "ok";
      base?: WorkspaceDiffBase;
      scope?: WorkspaceDiffScope;
      commits: WorkspaceDiffCommit[];
      files: WorkspaceDiffFile[];
      /** Range is too large to expand a file by default (degradation layer 1). */
      collapseAll: boolean;
    };

const STATUS_LABEL: Record<WorkspaceFileStatus, string> = {
  added: "新增",
  modified: "修改",
  deleted: "删除",
  renamed: "重命名",
  untracked: "未跟踪",
};

/** Why the panel is empty while a git operation is half-finished. */
const TRANSIENT_LABEL: Record<TransientGitOperation, string> = {
  merge: "正在合并（merge）",
  rebase: "正在变基（rebase）",
  "cherry-pick": "正在拣选提交（cherry-pick）",
  revert: "正在回滚（revert）",
};

/** The panel's own selection for a range the host echoed back. */
function selectionFromScope(scope: WorkspaceDiffScope): DiffSelection {
  if (scope.kind === "commit") return { kind: "commit", sha: scope.sha };
  if (scope.kind === "uncommitted") return { kind: "uncommitted" };
  return { kind: "all" };
}

/** Labels of the two named ranges ("全部改动" / "未提交改动"). */
const RANGE_LABEL: Record<"all" | "uncommitted", string> = {
  all: "全部改动",
  uncommitted: "未提交改动",
};

export interface DiffPaneProps {
  vscode: VsCodeApi;
  width: number;
  /** Split-view pane this diff panel belongs to; filters host responses. */
  paneId?: string;
  /** Hidden panels stay mounted; a re-show triggers a fresh load. */
  visible: boolean;
  /** True→false edge while visible triggers a refresh (generation ended). */
  isStreaming: boolean;
  /** Session identity / workdir changes re-point the panel while visible. */
  sessionId?: string;
  workdir?: string;
  /** Receives a formatted diff-line comment; appended to this pane's chat input. */
  onAddComment?: (text: string) => void;
  /** Sidebar (file tree + commit list) visibility — per-session state. */
  treeVisible: boolean;
  onTreeVisibleChange: (visible: boolean) => void;
  /** Viewing range (all changes / uncommitted / one commit) — per-session. */
  selection: DiffSelection;
  onSelectionChange: (selection: DiffSelection) => void;
}

/**
 * Workspace git-diff panel: a sidebar (file tree, the range switch and the
 * commit list under it) plus an accordion of per-file collapsible diff blocks
 * that can render unified or side by side.
 */
export const DiffPane: React.FC<DiffPaneProps> = ({
  vscode,
  width,
  paneId,
  visible,
  isStreaming,
  sessionId,
  workdir,
  onAddComment,
  treeVisible,
  onTreeVisibleChange,
  selection,
  onSelectionChange,
}) => {
  // Mutual-exclusion accordion: at most one file is expanded at a time, so the
  // DOM holds every file header but only one file's hunks (bounded rendering
  // for large workspace diffs — data is still loaded once for all files).
  // `undefined` = the user has not chosen a file yet, `null` = they collapsed
  // every file; see nextExpandedPath for how a fresh result maps onto these.
  const [expandedPath, setExpandedPath] = useState<string | null | undefined>(
    undefined,
  );
  const [viewMode, setViewMode] = useState<DiffViewMode>("unified");
  // The diff on screen. 上下文（会话 / 工作目录）换了以后它属于上一版 —— 见下面
  // 的 `stateContextKey` 派生。
  const [loadedState, setLoadedState] = useState<DiffState>({
    kind: "loading",
  });
  const [narrow, setNarrow] = useState(false);
  // 请求身份：每发一次请求单调 +1，回包按它认定（换范围与刷新可以同时在途，
  // 上一版的迟到回包绝不能落屏）。「正在刷新」由「已发出的 id > 已回包的 id」
  // 派生，不再是一个在发请求时置 true 的布尔。
  const [request, setRequest] = useState<{
    id: number;
    selection: DiffSelection;
    /** 发出这一版请求时的上下文键：回包落地时连它一起写回。 */
    contextKey: string;
  } | null>(null);
  const [answeredId, setAnsweredId] = useState(0);
  const refreshing = request !== null && request.id > answeredId;
  /** Range the last request asked for — see the trigger settlement below. */
  const requestedKeyRef = useRef(diffSelectionKey(selection));
  // 手里这份差异属于哪个上下文。与当前上下文不一致 ⇒ 它是上一版的，回包到达前
  // 先显示 loading 占位（原来靠发请求时 setState 清内容）。
  const contextKey = `${sessionId ?? ""}\u0000${workdir ?? ""}`;
  const [stateContextKey, setStateContextKey] = useState(contextKey);

  // Inline diff-line comment box: right-clicking a line (or selecting several
  // and using the button that follows the selection) opens a box under that line
  // or range; what it holds is appended to the chat input (not sent) so several
  // can be batched. The entry lives in DiffFileRows — it is the same shared
  // interaction the file pane uses (spec「差异面板行评论」场景 1/2).
  const [commentTarget, setCommentTarget] =
    useState<DiffLineCommentTarget | null>(null);
  const [commentDraft, setCommentDraft] = useState("");
  const onAddCommentRef = useRef(onAddComment);
  onAddCommentRef.current = onAddComment;
  const asideRef = useRef<HTMLElement>(null);
  // File the accordion should scroll to once it re-renders expanded (set by a
  // tree click — the accordion does not exist until after that render).
  const pendingScrollRef = useRef<string | null>(null);
  const fileRefs = useRef(new Map<string, HTMLDivElement>());

  const closeComment = useCallback(() => {
    setCommentTarget(null);
    setCommentDraft("");
  }, []);

  // 发出去的请求换了一版（换范围 / 重新加载）⇒ 上一版的行评论框与草稿都作废
  // （spec「行评论」场景 4）。复位在 render 期与请求同帧完成，且带守卫：只有真的
  // 还开着才写，至多两轮收敛 —— 不再由发请求的那个函数顺手 setState 清掉。
  const [commentEpoch, setCommentEpoch] = useState(0);
  const requestEpoch = request?.id ?? 0;
  if (commentEpoch !== requestEpoch) {
    setCommentEpoch(requestEpoch);
    if (commentTarget !== null) setCommentTarget(null);
    if (commentDraft !== "") setCommentDraft("");
  }

  const submitComment = useCallback(() => {
    const target = commentTarget;
    const comment = commentDraft.trim();
    if (!target || !comment) return;
    onAddCommentRef.current?.(
      formatCodeComment({
        // Only the expanded file can hold an open comment box.
        path: expandedPath ?? "",
        prefix: target.prefix,
        text: target.text,
        comment,
      }),
    );
    closeComment();
  }, [commentTarget, commentDraft, expandedPath, closeComment]);

  /** 打一次差异请求：推进请求身份并记下这次要的范围。唯一入口 —— 事件处理器与
   *  下面的 render 期触发结算共用；消息由那个 effect 发出，它只发消息、不写任何
   *  state，所以「转圈」不晚一帧。 */
  const issueRequest = (next: DiffSelection = selection) => {
    requestedKeyRef.current = diffSelectionKey(next);
    setRequest((prev) => ({
      id: (prev?.id ?? 0) + 1,
      selection: next,
      contextKey,
    }));
  };

  /** 请求身份变了才发一次：这个 effect 只做「发消息」这一件外部动作，不写任何
   *  state（转圈与评论框复位都已由上面的派生 / render 期复位完成）。 */
  const sentRequestIdRef = useRef(0);
  useEffect(() => {
    if (request === null || request.id === sentRequestIdRef.current) return;
    sentRequestIdRef.current = request.id;
    vscode.postMessage({
      command: "desktopGetWorkspaceDiff",
      ...(paneId ? { paneId } : {}),
      requestId: request.id,
      ...(request.selection.kind === "commit"
        ? { commit: request.selection.sha }
        : {}),
      ...(request.selection.kind === "uncommitted"
        ? { scope: "uncommitted" }
        : {}),
    });
  }, [request, vscode, paneId]);

  // 触发结算（render 期，与可见性同一帧）：首次挂载、重新显示、会话 / 工作目录
  // 变化、生成结束、面板被要求换一个范围 —— 与改造前那两个 effect 逐条对应。
  // 快照存 state 并做值比较（同值不写，至多两轮收敛）：这一帧该发请求就顺手推进
  // 请求身份，于是「转圈 / loading 占位」与触发同帧，不会晚一帧提交。
  const selectionKey = diffSelectionKey(selection);
  const triggerKey = `${visible ? 1 : 0}|${sessionId ?? ""}|${workdir ?? ""}|${
    isStreaming ? 1 : 0
  }|${selectionKey}`;
  const [trigger, setTrigger] = useState<{
    key: string;
    visible: boolean;
    sessionId?: string;
    workdir?: string;
    isStreaming: boolean;
  } | null>(null);
  if (trigger?.key !== triggerKey) {
    // 首次渲染的「上一帧」与改造前 prevRef 的初值一致：不可见、上下文已是当前值。
    const prev = trigger ?? { visible: false, sessionId, workdir, isStreaming };
    setTrigger({ key: triggerKey, visible, sessionId, workdir, isStreaming });
    const contextChanged =
      visible && (prev.sessionId !== sessionId || prev.workdir !== workdir);
    const becameVisible = visible && !prev.visible;
    const generationEnded = visible && prev.isStreaming && !isStreaming;
    const rangeChanged = visible && requestedKeyRef.current !== selectionKey;
    if (contextChanged || becameVisible || generationEnded || rangeChanged) {
      issueRequest(selection);
    }
  }

  // Switching the range re-points the accordion at a different file list.
  const pickSelection = (next: DiffSelection) => {
    // Compared against the requested range, not the prop: the prop is echoed
    // back by the parent, so a double click would otherwise fire twice.
    if (diffSelectionKey(next) === requestedKeyRef.current) return;
    onSelectionChange(next);
    issueRequest(next);
  };

  // Layout-only switch: no request, no re-pairing of the hunks (both views read
  // the same parsed rows) — only the open comment box has to go (场景 4).
  const switchView = (mode: DiffViewMode) => {
    if (mode === viewMode) return;
    setViewMode(mode);
    closeComment();
  };

  // Pane routing lives in the hook (paneId option): a pane instance only
  // consumes replies tagged with its own id.
  useHostMessage(
    (message) => {
      if (message?.command !== "desktopWorkspaceDiff") return;
      // Correlation guard: drop the reply of a superseded request (its requestId
      // is echoed back), which otherwise paints a stale range over the fresh
      // one. Replies without an id are pre-request-id hosts — accept them.
      const requestId = message.requestId as number | undefined;
      if (request === null) return;
      if (requestId !== undefined && requestId !== request.id) return;
      const result = message.result;
      // 这一版的回包到了：请求身份落成「已回包」，内容连同它所属的上下文键一起
      // 落地（回包之前上下文就换掉的那些，早在发送侧被判成上一版了）。
      setAnsweredId(request.id);
      setStateContextKey(request.contextKey);
      if (result?.kind === "transient") {
        setLoadedState({ kind: "transient", operation: result.operation });
        return;
      }
      if (result?.kind !== "ok") {
        setLoadedState({ kind: "not-a-repo" });
        return;
      }
      // Sort by path here so the file tree, the accordion and the "first file"
      // default all agree on one order (the host returns git's own order).
      const files: WorkspaceDiffFile[] = [...(result.files ?? [])].sort(
        (a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0),
      );
      const collapseAll = totalChangedLines(files) > DIFF_COLLAPSE_THRESHOLD;
      setLoadedState({
        kind: "ok",
        base: result.base,
        scope: result.scope,
        commits: result.commits ?? [],
        files,
        collapseAll,
      });
      setExpandedPath((prev) => nextExpandedPath(prev, files, collapseAll));
      // The host is authoritative about the range it answered with: a commit
      // that no longer exists fell back to "all changes", so mirror that in the
      // per-session selection instead of leaving a dead sha selected. Writing
      // the requested key too keeps the effect below from re-asking for the
      // range the host just refused.
      const scope = result.scope;
      const hostSelection = scope ? selectionFromScope(scope) : null;
      if (
        hostSelection &&
        diffSelectionKey(hostSelection) !== diffSelectionKey(selection)
      ) {
        requestedKeyRef.current = diffSelectionKey(hostSelection);
        onSelectionChange(hostSelection);
      }
    },
    { paneId },
  );

  // Auto-hide the sidebar when the panel leaves too little room for the diff
  // itself (spec「文件树与导航」场景 5). Only the layout degrades — the
  // user's show/hide memory is untouched, so widening brings the tree back.
  useEffect(() => {
    const el = asideRef.current;
    if (!el) return;
    const measure = (available: number) => {
      if (available <= 0) return; // 还没量到宽度（首帧、面板隐藏）：保持默认
      setNarrow(available < DIFF_TREE_WIDTH + DIFF_MIN_DIFF_WIDTH);
    };
    measure(el.getBoundingClientRect().width || width);
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) measure(entry.contentRect.width);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [width, visible]);

  const toggleFile = (path: string) => {
    // Mutual exclusion: expanding one file collapses every other.
    setExpandedPath((prev) => (prev === path ? null : path));
  };

  const selectFromTree = (path: string) => {
    if (path === expandedPath) return;
    pendingScrollRef.current = path;
    setExpandedPath(path);
  };

  useEffect(() => {
    const path = pendingScrollRef.current;
    if (!path) return;
    pendingScrollRef.current = null;
    const el = fileRefs.current.get(path);
    // 受限 WebView 未必实现 scrollIntoView，有才调。
    if (el && typeof el.scrollIntoView === "function")
      el.scrollIntoView({ block: "start" });
  }, [expandedPath]);

  // 上下文换了 ⇒ 手里这份内容属于上一版：回包到达前显示 loading 占位（原来靠
  // 发请求时 setState 清内容），下游一律读这个派生值，state 本身只由回包写。
  const state: DiffState =
    stateContextKey === contextKey ? loadedState : { kind: "loading" };

  const files = state.kind === "ok" ? state.files : [];
  const scope = state.kind === "ok" ? state.scope : undefined;
  const base = state.kind === "ok" ? state.base : undefined;
  // Split so a narrow slot only ellipsizes the base name and never the
  // `→ 工作树` side (spec「变更基准名过长」); the full value goes in the title.
  const range =
    scope?.kind === "commit"
      ? { lead: null, target: scope.shortSha }
      : base
        ? { lead: base.label, target: "→ 工作树" }
        : null;
  const rangeTitle =
    scope?.kind === "commit"
      ? `${scope.subject} (${scope.sha})`
      : base
        ? [base.label, base.ref, base.sha].filter(Boolean).join(" ")
        : undefined;
  // The host is authoritative: a range with nothing in it says so in its own
  // words ("未提交改动" vs. the fork-point range).
  const emptyText = scope?.kind === "uncommitted" ? "无未提交改动" : "无改动";
  const additions = files.reduce((sum, file) => sum + file.additions, 0);
  const deletions = files.reduce((sum, file) => sum + file.deletions, 0);

  const renderCommentBox = (index: number) =>
    commentTarget?.to === index ? (
      <LineCommentBox
        draft={commentDraft}
        onDraftChange={setCommentDraft}
        onSubmit={submitComment}
        onCancel={closeComment}
        tag={expandedPath ?? ""}
        placeholder={
          commentTarget.from === commentTarget.to
            ? "评论这行改动…"
            : `评论第 ${commentTarget.from}–${commentTarget.to} 行…`
        }
      />
    ) : null;

  const renderFile = (file: WorkspaceDiffFile) => {
    const isExpanded = expandedPath === file.path;
    return (
      <div
        className="diff-file"
        key={file.path}
        data-testid={`diff-file-${file.status}`}
        ref={(el) => {
          if (el) fileRefs.current.set(file.path, el);
          else fileRefs.current.delete(file.path);
        }}
      >
        <button
          className="diff-file-header"
          aria-expanded={isExpanded}
          onClick={() => toggleFile(file.path)}
        >
          <i
            className={`codicon codicon-chevron-${isExpanded ? "down" : "right"}`}
          />
          <span className={`diff-file-status diff-file-status-${file.status}`}>
            {STATUS_LABEL[file.status]}
          </span>
          <span
            className="diff-file-path"
            title={file.oldPath ? `${file.oldPath} → ${file.path}` : file.path}
          >
            {file.path}
          </span>
          <span className="diff-file-stats">
            <span className="diff-file-stats-add">+{file.additions}</span>
            <span className="diff-file-stats-del">-{file.deletions}</span>
          </span>
        </button>
        {isExpanded && (
          <div className="diff-file-body">
            {file.binary ? (
              <div className="diff-line-ellipsis">二进制文件，不显示差异</div>
            ) : file.hunks ? (
              <DiffFileRows
                file={file}
                viewMode={viewMode}
                // Degradation layer 2: an oversized file keeps its line-level
                // colors and comments, but skips the word-level pairing.
                wordHighlight={
                  file.additions + file.deletions <= DIFF_WORD_HIGHLIGHT_LIMIT
                }
                commentRange={commentTarget}
                onComment={setCommentTarget}
                renderCommentBox={renderCommentBox}
              />
            ) : (
              <div className="diff-line-ellipsis">
                {file.status === "renamed" && file.oldPath
                  ? `重命名自 ${file.oldPath}`
                  : "无内容差异"}
              </div>
            )}
            {file.truncated && (
              <div className="diff-line-ellipsis">差异过大，已截断…</div>
            )}
          </div>
        )}
      </div>
    );
  };

  const commits = state.kind === "ok" ? state.commits : [];
  // The range switch and the commit list are the way back when a range is
  // empty (spec「差异面板查看范围」场景 1), so the sidebar outlives the file
  // list: only its tree needs files to show.
  const showSidebar = treeVisible && !narrow && state.kind === "ok";
  const hasCommits = commits.length > 0;

  return (
    <PaneShell
      kind="diff-pane"
      dataTestId="diff-pane"
      width={width}
      asideRef={asideRef}
      toolbar={
        <>
          <span className="desktop-panel-toolbar-title">差异</span>
          {range && (
            <span
              className="diff-range"
              title={rangeTitle}
              data-testid="diff-range"
            >
              {range.lead && (
                <span className="diff-range-lead">{range.lead}</span>
              )}
              {/* A whitespace-only flex item is not rendered, so the gap comes
                  from CSS while the text still reads "main → 工作树". */}
              {range.lead && " "}
              <span className="diff-range-target">{range.target}</span>
            </span>
          )}
          {state.kind === "ok" && files.length > 0 && (
            <span className="diff-totals">
              <span className="diff-file-stats-add">+{additions}</span>
              <span className="diff-file-stats-del">-{deletions}</span>
              <span className="diff-file-count">{files.length} 个文件</span>
            </span>
          )}
          {/* 1009 评论（同族收齐）：差异面板工具条的两颗图标按钮换成自绘气泡。
              两颗的文案本来就是动态的（文件树开关 / 刷新是固定文案），
              `title` 移除后由气泡承载，`aria-label` 取与 `ChatHeader` 的
              面板开关同一套写法（开关类 = 名字随状态变 + `aria-pressed`）。 */}
          {/* 1029 评论（第八批）：「操作按钮放在右侧」/ 树开关「和文件保持一致
              （选中变蓝），也放在右侧」⇒ 三颗控制件收进一个群组，桌面端靠
              `margin-left: auto` 贴到工具条右缘（与文件面板同一位置感）；树开关
              补 `active` 类，复用 `.preview-pane-button.active` 的品牌蓝选中态。
              结构对两个宿主通用 —— 群组内的间距仍是工具条那 8px，插件端布局不变。
              1029 评论（第十批）：「统一并排」这个 `div.diff-view-switch`
              「放隐藏图标的左侧」⇒ 视图开关排在树开关之前（连同 DOM 顺序一起挪，
              视觉顺序与读屏 / Tab 顺序保持一致）。 */}
          <div className="diff-toolbar-actions">
            <div
              className="diff-view-switch"
              role="group"
              aria-label="差异视图"
            >
              <button
                className={`diff-view-option${viewMode === "unified" ? " is-active" : ""}`}
                aria-pressed={viewMode === "unified"}
                data-testid="diff-view-unified"
                onClick={() => switchView("unified")}
              >
                统一
              </button>
              <button
                className={`diff-view-option${viewMode === "split" ? " is-active" : ""}`}
                aria-pressed={viewMode === "split"}
                data-testid="diff-view-split"
                onClick={() => switchView("split")}
              >
                并排
              </button>
            </div>
            <Tooltip
              text={treeVisible ? "隐藏文件树" : "显示文件树"}
              position="bottom"
            >
              <button
                className={`preview-pane-button${treeVisible ? " active" : ""}`}
                aria-label={treeVisible ? "隐藏文件树" : "显示文件树"}
                aria-pressed={treeVisible}
                data-testid="diff-tree-toggle"
                onClick={() => onTreeVisibleChange(!treeVisible)}
              >
                {/* 1029 评论（第九批）「换成和文件面板一样的，仅桌面端」⇒ 桌面端
                    用文件面板同一颗官方矢量（显示 / 隐藏文件树），插件端保留
                    原 codicon。与 FilePane.tsx 的树开关同一处分叉口径。 */}
                {isDesktopHost() ? (
                  <TreeToggleIcon className="preview-pane-icon" />
                ) : (
                  <i
                    className="codicon codicon-list-tree preview-pane-icon"
                    aria-hidden="true"
                  />
                )}
              </button>
            </Tooltip>
            <Tooltip text="刷新" position="bottom">
              <button
                className="preview-pane-button"
                aria-label="刷新"
                data-testid="diff-refresh"
                onClick={() => issueRequest()}
              >
                <RefreshIcon
                  className={`preview-pane-icon${refreshing ? " is-spinning" : ""}`}
                />
              </button>
            </Tooltip>
          </div>
        </>
      }
      bodyClassName="diff-pane-body"
    >
      <div className="diff-pane-layout">
        {showSidebar && (
          <div className="diff-sidebar" data-testid="diff-sidebar">
            {files.length > 0 && (
              <DiffFileTree
                files={files}
                selectedPath={expandedPath ?? null}
                onSelect={selectFromTree}
              />
            )}
            {/* One range at a time, the two named ranges first (spec「差异面板
                查看范围」场景 1); a commit selection shows as its own row. */}
            <div className="diff-scope" data-testid="diff-scope">
              <div
                className="diff-view-switch"
                role="group"
                aria-label="查看范围"
              >
                {(["all", "uncommitted"] as const).map((kind) => (
                  <button
                    key={kind}
                    className={`diff-view-option${
                      selection.kind === kind ? " is-active" : ""
                    }`}
                    aria-pressed={selection.kind === kind}
                    data-testid={`diff-scope-${kind}`}
                    onClick={() => pickSelection({ kind })}
                  >
                    {RANGE_LABEL[kind]}
                  </button>
                ))}
              </div>
            </div>
            {/* Commit selection sits under the range switch (spec「提交选择」
                场景 1); a range with no commits renders no list at all (场景 4). */}
            {hasCommits && (
              <div className="diff-commits" data-testid="diff-commits">
                <div
                  className="diff-commits-title"
                  data-testid="diff-commits-title"
                >
                  提交
                  <span className="diff-commits-count">{commits.length}</span>
                </div>
                {commits.map((commit) => (
                  <button
                    key={commit.sha}
                    className={`diff-commit${
                      selection.kind === "commit" &&
                      selection.sha === commit.sha
                        ? " is-selected"
                        : ""
                    }`}
                    aria-pressed={
                      selection.kind === "commit" &&
                      selection.sha === commit.sha
                    }
                    data-testid="diff-commit"
                    data-sha={commit.sha}
                    title={`${commit.subject} (${commit.sha})`}
                    onClick={() =>
                      pickSelection({ kind: "commit", sha: commit.sha })
                    }
                  >
                    <span className="diff-commit-sha">{commit.shortSha}</span>
                    <span className="diff-commit-subject">
                      {commit.subject}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
        <div className="diff-pane-main">
          {state.kind === "loading" && (
            <PanePlaceholder>加载中…</PanePlaceholder>
          )}
          {state.kind === "not-a-repo" && (
            <PanePlaceholder>非 git 仓库</PanePlaceholder>
          )}
          {state.kind === "transient" && (
            <PanePlaceholder>
              {`${TRANSIENT_LABEL[state.operation]}，暂不展示差异`}
            </PanePlaceholder>
          )}
          {state.kind === "ok" && state.files.length === 0 && (
            <PanePlaceholder>{emptyText}</PanePlaceholder>
          )}
          {state.kind === "ok" && state.collapseAll && (
            <div className="diff-notice" data-testid="diff-collapse-notice">
              差异过大，已折叠全部文件
            </div>
          )}
          {state.kind === "ok" && state.files.map(renderFile)}
        </div>
      </div>
    </PaneShell>
  );
};

export default DiffPane;
