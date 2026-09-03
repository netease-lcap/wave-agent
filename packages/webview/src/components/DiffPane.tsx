import React, { useCallback, useEffect, useRef, useState } from "react";
import type { VsCodeApi } from "../types";
import { renderWordLevelDiff } from "../utils/diffHighlight";
import { RefreshIcon } from "./HeaderIcons";
import "../styles/DiffViewer.css";
import "../styles/DiffPane.css";

export type WorkspaceFileStatus =
  | "added"
  | "modified"
  | "deleted"
  | "renamed"
  | "untracked";

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

type DiffState =
  | { kind: "loading" }
  | { kind: "not-a-repo" }
  | { kind: "ok"; files: WorkspaceDiffFile[] };

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

const MIN_WIDTH = 320;

export interface DiffPaneProps {
  vscode: VsCodeApi;
  width: number;
  onWidthChange: (width: number) => void;
  maxWidth: number;
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
}

/** Workspace git-diff panel: accordion of per-file collapsible diff blocks. */
export const DiffPane: React.FC<DiffPaneProps> = ({
  vscode,
  width,
  onWidthChange,
  maxWidth,
  paneId,
  visible,
  isStreaming,
  sessionId,
  workdir,
  onAddComment,
}) => {
  const [state, setState] = useState<DiffState>({ kind: "loading" });
  // Mutual-exclusion accordion: at most one file is expanded at a time, so the
  // DOM holds every file header but only one file's hunks (bounded rendering
  // for large workspace diffs — data is still loaded once for all files).
  // The expanded path survives refreshes; defaults to the first file.
  const [expandedPath, setExpandedPath] = useState<string | null>(null);
  // True while a refresh request is in flight; drives the toolbar spinner.
  const [refreshing, setRefreshing] = useState(false);
  const asideRef = useRef<HTMLElement | null>(null);

  // Inline diff-line comment box (GitHub/GitLab style): hovering a line shows a
  // "+" button; clicking opens a comment box under that line whose contents
  // are appended to the chat input (not sent) so several can be batched.
  interface CommentTarget {
    lineKey: string;
    file: WorkspaceDiffFile;
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

  const submitComment = useCallback(() => {
    const target = commentTarget;
    const comment = commentDraft.trim();
    if (!target || !comment) return;
    onAddCommentRef.current?.(
      formatDiffComment({
        path: target.file.path,
        prefix: target.prefix,
        text: target.text,
        comment,
      }),
    );
    setCommentTarget(null);
    setCommentDraft("");
  }, [commentTarget, commentDraft]);

  const cancelComment = useCallback(() => {
    setCommentTarget(null);
    setCommentDraft("");
  }, []);

  // Auto-focus the textarea when a comment box opens.
  useEffect(() => {
    if (commentTarget) commentInputRef.current?.focus();
  }, [commentTarget]);

  // Hard refresh clears current content to the loading placeholder (used when
  // the session/workdir context changes); soft refresh keeps showing the old
  // content until the new diff arrives, so auto-refreshes don't flicker.
  const refresh = useCallback(
    (hard = false) => {
      if (hard) setState({ kind: "loading" });
      setRefreshing(true);
      // Refresh rewrites the hunks, so any open comment box + draft is stale.
      setCommentTarget(null);
      setCommentDraft("");
      vscode.postMessage({
        command: "desktopGetWorkspaceDiff",
        ...(paneId ? { paneId } : {}),
      });
    },
    [vscode, paneId],
  );

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      const msg = event.data;
      if (msg?.command !== "desktopWorkspaceDiff") return;
      if (paneId !== undefined && msg.paneId !== paneId) return;
      const result = msg.result;
      setRefreshing(false);
      setState(
        result?.kind === "ok"
          ? { kind: "ok", files: result.files }
          : { kind: "not-a-repo" },
      );
      // Default the first file to expanded on the first diff; keep the
      // currently expanded file across refreshes once the user has chosen one.
      setExpandedPath((prev) => prev ?? result?.files?.[0]?.path ?? null);
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [paneId]);

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

  const toggleFile = (path: string) => {
    // Mutual exclusion: expanding one file collapses every other.
    setExpandedPath((prev) => (prev === path ? null : path));
  };

  const onDragStart = (e: React.MouseEvent) => {
    e.preventDefault();
    const handle = e.currentTarget as HTMLElement;
    // Keep the handle lit + cursor locked for the whole drag — :hover and the
    // 6px-only col-resize cursor both flicker as the pointer outruns the handle.
    handle.style.background = "var(--vscode-focusBorder, #007fd4)";
    document.body.classList.add("is-panel-resizing");
    const rect = asideRef.current?.getBoundingClientRect();
    const onMove = (ev: MouseEvent) => {
      const next = (rect?.right ?? 0) - ev.clientX;
      onWidthChange(Math.min(Math.max(next, MIN_WIDTH), maxWidth));
    };
    const onUp = () => {
      handle.style.background = "";
      document.body.classList.remove("is-panel-resizing");
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  const renderHunks = (file: WorkspaceDiffFile) => {
    const elements: React.ReactNode[] = [];
    // Removed/added lines awaiting word-level pairing; `idx` is the original
    // hunk line index (stable key + comment target).
    let pendingRemoved: { text: string; idx: number }[] = [];
    let pendingAdded: { text: string; idx: number }[] = [];

    const renderDiffLine = (
      prefix: string,
      cls: string,
      content: React.ReactNode,
      idx: number,
      text: string,
    ) => {
      const lineKey = `${file.path}:${idx}`;
      const isOpen = commentTarget?.lineKey === lineKey;
      return (
        <React.Fragment key={idx}>
          <div className={cls}>
            <span className="diff-prefix">{prefix}</span>
            <span className="diff-content">{content}</span>
            <button
              className="diff-line-comment-btn"
              title="评论这行"
              aria-label={`评论 ${file.path} 第 ${idx + 1} 行`}
              data-testid={`diff-comment-add-${idx}`}
              onClick={() =>
                setCommentTarget({
                  lineKey,
                  file,
                  prefix,
                  text: text.slice(0, 30),
                })
              }
            >
              <i className="codicon codicon-add" />
            </button>
          </div>
          {isOpen && (
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
                    cancelComment();
                  }
                }}
              />
              <div className="diff-comment-box-footer">
                <span className="diff-comment-box-tag" title={file.path}>
                  {file.path}
                </span>
                <button
                  className="diff-comment-box-cancel"
                  data-testid="diff-comment-cancel"
                  onClick={cancelComment}
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
          )}
        </React.Fragment>
      );
    };

    // Pair pending removed/added lines by position; unpaired lines (added-only
    // or removed-only blocks) are highlighted as whole lines, same as the
    // message-list diff block.
    const flushPending = () => {
      const maxLines = Math.max(pendingRemoved.length, pendingAdded.length);
      for (let i = 0; i < maxLines; i++) {
        const oldLine = pendingRemoved[i];
        const newLine = pendingAdded[i];
        if (oldLine && newLine) {
          const { removedParts, addedParts } = renderWordLevelDiff(
            oldLine.text,
            newLine.text,
            `pair-${oldLine.idx}`,
          );
          elements.push(
            renderDiffLine(
              "-",
              "diff-line diff-line-removed",
              removedParts,
              oldLine.idx,
              oldLine.text,
            ),
          );
          elements.push(
            renderDiffLine(
              "+",
              "diff-line diff-line-added",
              addedParts,
              newLine.idx,
              newLine.text,
            ),
          );
        } else if (oldLine) {
          const { removedParts } = renderWordLevelDiff(
            oldLine.text,
            "",
            `removed-${oldLine.idx}`,
          );
          elements.push(
            renderDiffLine(
              "-",
              "diff-line diff-line-removed",
              removedParts,
              oldLine.idx,
              oldLine.text,
            ),
          );
        } else if (newLine) {
          const { addedParts } = renderWordLevelDiff(
            "",
            newLine.text,
            `added-${newLine.idx}`,
          );
          elements.push(
            renderDiffLine(
              "+",
              "diff-line diff-line-added",
              addedParts,
              newLine.idx,
              newLine.text,
            ),
          );
        }
      }
      pendingRemoved = [];
      pendingAdded = [];
    };

    file.hunks.split("\n").forEach((line, i) => {
      if (line.startsWith("+")) {
        pendingAdded.push({ text: line.slice(1), idx: i });
        return;
      }
      if (line.startsWith("-")) {
        pendingRemoved.push({ text: line.slice(1), idx: i });
        return;
      }
      // Context lines, hunk headers and trailing markers end the current
      // pairing block.
      flushPending();
      if (line.startsWith("@@")) {
        elements.push(
          <div key={i} className="diff-line-hunk">
            {line}
          </div>,
        );
      } else if (line.startsWith("\\")) {
        elements.push(
          <div key={i} className="diff-line-ellipsis">
            {line}
          </div>,
        );
      } else {
        const content = line.startsWith(" ") ? line.slice(1) : line;
        elements.push(
          renderDiffLine(
            " ",
            "diff-line diff-line-context",
            content,
            i,
            content,
          ),
        );
      }
    });
    flushPending();
    return elements;
  };

  const renderFile = (file: WorkspaceDiffFile) => {
    const isExpanded = expandedPath === file.path;
    return (
      <div
        className="diff-file"
        key={file.path}
        data-testid={`diff-file-${file.status}`}
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
              renderHunks(file)
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

  return (
    <aside
      ref={asideRef}
      className="preview-pane diff-pane"
      style={{ width }}
      data-testid="diff-pane"
    >
      <div className="preview-pane-drag-handle" onMouseDown={onDragStart} />
      <div className="preview-pane-inner">
        <div className="preview-pane-toolbar">
          <span className="desktop-panel-toolbar-title">差异</span>
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
        </div>
        <div className="diff-pane-body">
          {state.kind === "loading" && (
            <div className="desktop-panel-placeholder">加载中…</div>
          )}
          {state.kind === "not-a-repo" && (
            <div className="desktop-panel-placeholder">非 git 仓库</div>
          )}
          {state.kind === "ok" && state.files.length === 0 && (
            <div className="desktop-panel-placeholder">无改动</div>
          )}
          {state.kind === "ok" && state.files.map(renderFile)}
        </div>
      </div>
    </aside>
  );
};

export default DiffPane;
