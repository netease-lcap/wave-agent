import React, { useCallback, useEffect, useRef, useState } from "react";
import type { VsCodeApi } from "../types";
import { useHostMessage } from "../utils/useHostMessage";
import {
  DIFF_COLLAPSE_THRESHOLD,
  DIFF_MIN_DIFF_WIDTH,
  DIFF_TREE_WIDTH,
  DIFF_WORD_HIGHLIGHT_LIMIT,
  nextExpandedPath,
  totalChangedLines,
} from "../utils/diffHunks";
import { DiffFileRows, type DiffViewMode } from "./DiffFileRows";
import { DiffFileTree } from "./DiffFileTree";
import { RefreshIcon } from "./HeaderIcons";
import { PanePlaceholder, PaneShell } from "./PaneShell";
import "../styles/DiffViewer.css";
import "../styles/DiffPane.css";

export type WorkspaceFileStatus =
  | "added"
  | "modified"
  | "deleted"
  | "renamed"
  | "untracked";

// Contract shapes mirror the host's `packages/desktop/src/main/gitDiff.ts`
// (the webview is shared by four hosts, so it cannot import from the desktop
// package — keep the two definitions in sync when the payload changes).
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
  kind: "default-branch" | "head" | "index";
  ref: string | null;
}

export type WorkspaceDiffScope =
  | { kind: "all" }
  | { kind: "commit"; sha: string; shortSha: string; subject: string };

type DiffState =
  | { kind: "loading" }
  | { kind: "not-a-repo" }
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

export interface DiffComment {
  path?: string;
  prefix?: string;
  text?: string;
  comment?: string;
}

/** User-visible markdown for a diff-line comment — appended to the chat input. */
export function formatDiffComment(msg: DiffComment): string {
  const prefixLabel =
    msg.prefix && msg.prefix !== " " ? `\`${msg.prefix}\`` : "";
  const location = [prefixLabel, msg.text ? `「${msg.text}」` : ""]
    .filter(Boolean)
    .join("");
  const lines = [
    `**差异评论** · ${msg.path ?? ""}`,
    location,
    "",
    msg.comment ?? "",
  ];
  return lines.join("\n");
}

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
  /** Selected commit sha, or null for "all changes". Per-session state. */
  selectedCommit: string | null;
  onSelectedCommitChange: (sha: string | null) => void;
}

/**
 * Workspace git-diff panel: a sidebar (file tree with the commit list under it)
 * plus an accordion of per-file collapsible diff blocks that can render unified
 * or side by side.
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
  selectedCommit,
  onSelectedCommitChange,
}) => {
  const [state, setState] = useState<DiffState>({ kind: "loading" });
  // Mutual-exclusion accordion: at most one file is expanded at a time, so the
  // DOM holds every file header but only one file's hunks (bounded rendering
  // for large workspace diffs — data is still loaded once for all files).
  // `undefined` = the user has not chosen a file yet, `null` = they collapsed
  // every file; see nextExpandedPath for how a fresh result maps onto these.
  const [expandedPath, setExpandedPath] = useState<string | null | undefined>(
    undefined,
  );
  const [viewMode, setViewMode] = useState<DiffViewMode>("unified");
  // True while a refresh request is in flight; drives the toolbar spinner.
  const [refreshing, setRefreshing] = useState(false);
  const [narrow, setNarrow] = useState(false);
  // Monotonic request id: a commit switch and a refresh can be in flight at the
  // same time, and the late reply of the previous range must never be painted.
  const requestIdRef = useRef(0);
  /** Range the last request asked for — see the selection-change effect below. */
  const requestedCommitRef = useRef(selectedCommit);

  // Inline diff-line comment box (GitHub/GitLab style): hovering a line shows a
  // "+" button; clicking opens a comment box under that line whose contents
  // are appended to the chat input (not sent) so several can be batched.
  interface CommentTarget {
    /** Raw hunk line index — also the id of the button that opened the box. */
    index: number;
    prefix: string;
    text: string;
  }
  const [commentTarget, setCommentTarget] = useState<CommentTarget | null>(
    null,
  );
  const [commentDraft, setCommentDraft] = useState("");
  const onAddCommentRef = useRef(onAddComment);
  onAddCommentRef.current = onAddComment;
  const commentInputRef = useRef<HTMLTextAreaElement | null>(null);
  const asideRef = useRef<HTMLElement>(null);
  // File the accordion should scroll to once it re-renders expanded (set by a
  // tree click — the accordion does not exist until after that render).
  const pendingScrollRef = useRef<string | null>(null);
  const fileRefs = useRef(new Map<string, HTMLDivElement>());

  const closeComment = useCallback(() => {
    setCommentTarget(null);
    setCommentDraft("");
  }, []);

  const submitComment = useCallback(() => {
    const target = commentTarget;
    const comment = commentDraft.trim();
    if (!target || !comment) return;
    onAddCommentRef.current?.(
      formatDiffComment({
        // Only the expanded file can hold an open comment box.
        path: expandedPath ?? "",
        prefix: target.prefix,
        text: target.text,
        comment,
      }),
    );
    closeComment();
  }, [commentTarget, commentDraft, expandedPath, closeComment]);

  // Auto-focus the textarea when a comment box opens.
  useEffect(() => {
    if (commentTarget) commentInputRef.current?.focus();
  }, [commentTarget]);

  // Hard refresh clears current content to the loading placeholder (used when
  // the session/workdir context changes); soft refresh keeps showing the old
  // content until the new diff arrives, so auto-refreshes don't flicker.
  const refresh = useCallback(
    (hard = false, commit: string | null = selectedCommit) => {
      if (hard) setState({ kind: "loading" });
      setRefreshing(true);
      // A new result rewrites the hunks, so any open comment box + draft is
      // stale (spec「行评论」场景 4).
      closeComment();
      requestIdRef.current += 1;
      requestedCommitRef.current = commit;
      vscode.postMessage({
        command: "desktopGetWorkspaceDiff",
        ...(paneId ? { paneId } : {}),
        requestId: requestIdRef.current,
        ...(commit ? { commit } : {}),
      });
    },
    [vscode, paneId, selectedCommit, closeComment],
  );

  // Switching the range re-points the accordion at a different file list.
  const pickCommit = (sha: string | null) => {
    // Compared against the requested range, not the prop: the prop is echoed
    // back by the parent, so a double click would otherwise fire twice.
    if (sha === requestedCommitRef.current) return;
    onSelectedCommitChange(sha);
    refresh(false, sha);
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
      if (requestId !== undefined && requestId !== requestIdRef.current) return;
      const result = message.result;
      setRefreshing(false);
      if (result?.kind !== "ok") {
        setState({ kind: "not-a-repo" });
        return;
      }
      // Sort by path here so the file tree, the accordion and the "first file"
      // default all agree on one order (the host returns git's own order).
      const files: WorkspaceDiffFile[] = [...(result.files ?? [])].sort(
        (a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0),
      );
      const collapseAll = totalChangedLines(files) > DIFF_COLLAPSE_THRESHOLD;
      setState({
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
      // per-session selection instead of leaving a dead sha selected.
      const scope = result.scope;
      if (scope && scope.kind !== "commit" && selectedCommit !== null)
        onSelectedCommitChange(null);
    },
    { paneId },
  );

  // Refresh triggers: first mount (prev.visible starts false), re-show,
  // session/workdir change while visible, generation end while visible.
  const prevRef = useRef({ visible: false, sessionId, workdir, isStreaming });
  useEffect(() => {
    const prev = prevRef.current;
    prevRef.current = { visible, sessionId, workdir, isStreaming };
    const becameVisible = visible && !prev.visible;
    const contextChanged =
      visible && (prev.sessionId !== sessionId || prev.workdir !== workdir);
    const generationEnded = visible && prev.isStreaming && !isStreaming;
    if (contextChanged) refresh(true);
    else if (becameVisible || generationEnded) refresh();
  }, [visible, sessionId, workdir, isStreaming, refresh]);

  // The selected range is per-session state owned by the parent, which restores
  // it one commit AFTER this pane first sees the new session (child effects run
  // before the parent's swap effect) — so the context-change trigger above fires
  // with the OUTGOING session's commit. Re-issue whenever the range the panel is
  // told to show differs from the one it last asked for; the requestId guard then
  // drops the stale reply.
  useEffect(() => {
    if (requestedCommitRef.current === selectedCommit) return;
    requestedCommitRef.current = selectedCommit;
    if (!visible) return;
    refresh(false, selectedCommit);
  }, [selectedCommit, visible, refresh]);

  // Auto-hide the sidebar when the panel leaves too little room for the diff
  // itself (spec「文件树与导航」场景 5). Only the layout degrades — the
  // user's show/hide memory is untouched, so widening brings the tree back.
  useEffect(() => {
    const el = asideRef.current;
    if (!el) return;
    const measure = (available: number) => {
      if (available <= 0) return; // jsdom / pre-layout: keep the default
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
    // jsdom has no layout and no scrollIntoView.
    if (el && typeof el.scrollIntoView === "function")
      el.scrollIntoView({ block: "start" });
  }, [expandedPath]);

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
  const additions = files.reduce((sum, file) => sum + file.additions, 0);
  const deletions = files.reduce((sum, file) => sum + file.deletions, 0);

  const renderCommentBox = (index: number) =>
    commentTarget?.index === index ? (
      <div className="diff-comment-box" data-testid="diff-comment-box">
        <textarea
          ref={commentInputRef}
          className="diff-comment-input"
          data-testid="diff-comment-input"
          placeholder="评论这行改动…"
          value={commentDraft}
          onChange={(e) => setCommentDraft(e.target.value)}
          onKeyDown={(e) => {
            // IME composing (e.g. Chinese pinyin): Enter confirms the
            // candidate, not a submit. keyCode 229 covers older engines
            // where isComposing is unset.
            if (e.nativeEvent.isComposing || e.keyCode === 229) return;
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              submitComment();
            } else if (e.key === "Escape") {
              e.preventDefault();
              closeComment();
            }
          }}
        />
        <div className="diff-comment-box-footer">
          <span className="diff-comment-box-tag" title={expandedPath ?? ""}>
            {expandedPath}
          </span>
          <button
            className="diff-comment-box-cancel"
            data-testid="diff-comment-cancel"
            onClick={closeComment}
          >
            取消
          </button>
          <button
            className="diff-comment-box-send"
            title="添加到输入框"
            data-testid="diff-comment-submit"
            disabled={commentDraft.trim() === ""}
            onClick={submitComment}
          >
            添加
          </button>
        </div>
      </div>
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
                commentIndex={commentTarget?.index ?? null}
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
  const showSidebar =
    treeVisible && !narrow && state.kind === "ok" && files.length > 0;

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
            <span className="diff-range" title={rangeTitle}>
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
          <button
            className="preview-pane-button"
            title={treeVisible ? "隐藏文件树" : "显示文件树"}
            aria-pressed={treeVisible}
            data-testid="diff-tree-toggle"
            onClick={() => onTreeVisibleChange(!treeVisible)}
          >
            <i className="codicon codicon-list-tree" />
          </button>
          <div className="diff-view-switch" role="group" aria-label="差异视图">
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
          <button
            className="preview-pane-button"
            title="刷新"
            data-testid="diff-refresh"
            onClick={() => refresh()}
          >
            <RefreshIcon
              className={`preview-pane-icon${refreshing ? " is-spinning" : ""}`}
            />
          </button>
        </>
      }
      bodyClassName="diff-pane-body"
    >
      <div className="diff-pane-layout">
        {showSidebar && (
          <div className="diff-sidebar" data-testid="diff-sidebar">
            <DiffFileTree
              files={files}
              selectedPath={expandedPath ?? null}
              onSelect={selectFromTree}
            />
            {/* Commit selection sits under the tree (spec「提交选择」场景 1);
                a range with no commits renders no list at all (场景 4). */}
            {commits.length > 0 && (
              <div className="diff-commits" data-testid="diff-commits">
                <button
                  className={`diff-commit${
                    selectedCommit === null ? " is-selected" : ""
                  }`}
                  aria-pressed={selectedCommit === null}
                  data-testid="diff-commit-all"
                  onClick={() => pickCommit(null)}
                >
                  <span className="diff-commit-subject">全部改动</span>
                </button>
                {commits.map((commit) => (
                  <button
                    key={commit.sha}
                    className={`diff-commit${
                      selectedCommit === commit.sha ? " is-selected" : ""
                    }`}
                    aria-pressed={selectedCommit === commit.sha}
                    data-testid="diff-commit"
                    data-sha={commit.sha}
                    title={`${commit.subject} (${commit.sha})`}
                    onClick={() => pickCommit(commit.sha)}
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
          {state.kind === "ok" && state.files.length === 0 && (
            <PanePlaceholder>无改动</PanePlaceholder>
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
