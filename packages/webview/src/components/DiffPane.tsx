import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { VsCodeApi } from '../types';
import '../styles/DiffViewer.css';
import '../styles/DiffPane.css';

export type WorkspaceFileStatus = 'added' | 'modified' | 'deleted' | 'renamed' | 'untracked';

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
  | { kind: 'loading' }
  | { kind: 'not-a-repo' }
  | { kind: 'ok'; files: WorkspaceDiffFile[] };

const STATUS_LABEL: Record<WorkspaceFileStatus, string> = {
  added: '新增',
  modified: '修改',
  deleted: '删除',
  renamed: '重命名',
  untracked: '未跟踪',
};

export interface DiffComment {
  path?: string;
  prefix?: string;
  text?: string;
  comment?: string;
}

/** User-visible markdown for a diff-line comment — appended to the chat input. */
export function formatDiffComment(msg: DiffComment): string {
  const prefixLabel = msg.prefix && msg.prefix !== ' ' ? `\`${msg.prefix}\`` : '';
  const location = [prefixLabel, msg.text ? `「${msg.text}」` : ''].filter(Boolean).join('');
  const lines = [`**差异评论** · ${msg.path ?? ''}`, location, '', msg.comment ?? ''];
  return lines.join('\n');
}

const MIN_WIDTH = 320;

// Windowed-list constants (VS Code multi-diff editor pattern: diff data is
// loaded once for all files, but the DOM only mounts viewport-visible items —
// the equivalent of MultiDiffEditorWidgetImpl's virtualized render + ObjectPool
// releasing the DiffEditorWidget of scrolled-out items).
const HEADER_HEIGHT = 30; // .diff-file-header estimate, corrected by ResizeObserver
const BODY_PADDING = 8; // .diff-file-body vertical padding
const LINE_HEIGHT = 14.4; // 12px font × 1.2 line-height
const DEFAULT_VIEWPORT = 800; // jsdom has no layout; real height comes from ResizeObserver
const OVERSCAN_PX = 300; // keep rendering this much above/below the viewport for smooth scrolling

/** Height estimate for an unmeasured file block; exact once ResizeObserver reports. */
function estimateFileHeight(file: WorkspaceDiffFile, collapsed: boolean): number {
  if (collapsed) return HEADER_HEIGHT;
  let lines = file.hunks ? file.hunks.split('\n').length : 0;
  if (file.binary || !file.hunks) lines += 1; // binary / no-content placeholder line
  if (file.truncated) lines += 1; // truncation note
  return HEADER_HEIGHT + BODY_PADDING + lines * LINE_HEIGHT;
}

/** Windowed list item: mounts its file block at an absolute offset and reports
 *  the real rendered height via ResizeObserver so the layout stays exact.
 *  Scrolled-out items unmount — their "widget" is released, like VS Code's
 *  ObjectPool returning a DiffEditorWidget to the pool. */
const MeasuredDiffItem: React.FC<{
  file: WorkspaceDiffFile;
  top: number;
  onMeasure: (path: string, height: number) => void;
  children?: React.ReactNode;
}> = ({ file, top, onMeasure, children }) => {
  const ref = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver((entries) => {
      const height = entries[0]?.contentRect.height;
      if (height) onMeasure(file.path, height);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [file.path, onMeasure]);
  return (
    <div ref={ref} className="diff-file-virtual-item" style={{ top }}>
      {children}
    </div>
  );
};

export interface DiffPaneProps {
  vscode: VsCodeApi;
  width: number;
  onWidthChange: (width: number) => void;
  maxWidth: number;
  onClose: () => void;
  /** Split-view pane this diff panel belongs to; filters host responses. */
  paneId?: string;
  /** Hidden panels stay mounted; a re-show triggers a fresh load. */
  visible: boolean;
  /** True→false edge while visible triggers a refresh (generation ended). */
  isStreaming: boolean;
  /** Session identity / workdir changes re-point the panel while visible. */
  sessionId?: string;
  workdir?: string;
  /** Second-row layout: panels pack from the left, so the width drag anchors
   * the (fixed) left edge instead of the right edge. */
  widthFromLeft?: boolean;
  /** Receives a formatted diff-line comment; appended to this pane's chat input. */
  onAddComment?: (text: string) => void;
}

/** Workspace git-diff panel: accordion of per-file collapsible diff blocks. */
export const DiffPane: React.FC<DiffPaneProps> = ({
  vscode,
  width,
  onWidthChange,
  maxWidth,
  onClose,
  paneId,
  visible,
  isStreaming,
  sessionId,
  workdir,
  widthFromLeft,
  onAddComment,
}) => {
  const [state, setState] = useState<DiffState>({ kind: 'loading' });
  // Collapsed paths survive refreshes; files are expanded by default.
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());
  // True while a refresh request is in flight; drives the toolbar spinner.
  const [refreshing, setRefreshing] = useState(false);
  const asideRef = useRef<HTMLElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  // Windowed list state: the scroll offset, the scroll container's viewport
  // height, and per-file measured heights (keyed by path, surviving refreshes).
  const [scrollTop, setScrollTop] = useState(0);
  const [viewport, setViewport] = useState(DEFAULT_VIEWPORT);
  const [measuredHeights, setMeasuredHeights] = useState<ReadonlyMap<string, number>>(new Map());

  const handleMeasure = useCallback((path: string, height: number) => {
    setMeasuredHeights((prev) => {
      if (prev.get(path) === height) return prev;
      const next = new Map(prev);
      next.set(path, height);
      return next;
    });
  }, []);

  // Track the scroll container's viewport height so the visible window stays exact.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver((entries) => {
      const height = entries[0]?.contentRect.height;
      if (height) setViewport(height);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // Inline diff-line comment box (GitHub/GitLab style): hovering a line shows a
  // "+" button; clicking opens a comment box under that line whose contents
  // are appended to the chat input (not sent) so several can be batched.
  interface CommentTarget {
    lineKey: string;
    file: WorkspaceDiffFile;
    prefix: string;
    text: string;
  }
  const [commentTarget, setCommentTarget] = useState<CommentTarget | null>(null);
  const [commentDraft, setCommentDraft] = useState('');
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
    setCommentDraft('');
  }, [commentTarget, commentDraft]);

  const cancelComment = useCallback(() => {
    setCommentTarget(null);
    setCommentDraft('');
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
      if (hard) setState({ kind: 'loading' });
      setRefreshing(true);
      // Refresh rewrites the hunks, so any open comment box + draft is stale.
      setCommentTarget(null);
      setCommentDraft('');
      vscode.postMessage({ command: 'desktopGetWorkspaceDiff', ...(paneId ? { paneId } : {}) });
    },
    [vscode, paneId],
  );

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      const msg = event.data;
      if (msg?.command !== 'desktopWorkspaceDiff') return;
      if (paneId !== undefined && msg.paneId !== paneId) return;
      const result = msg.result;
      setRefreshing(false);
      setState(result?.kind === 'ok' ? { kind: 'ok', files: result.files } : { kind: 'not-a-repo' });
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [paneId]);

  // Refresh triggers: first mount (prev.visible starts false), re-show,
  // session/workdir change while visible, generation end while visible.
  const prevRef = useRef({ visible: false, sessionId, workdir, isStreaming });
  useEffect(() => {
    const prev = prevRef.current;
    prevRef.current = { visible, sessionId, workdir, isStreaming };
    const becameVisible = visible && !prev.visible;
    const contextChanged = visible && (prev.sessionId !== sessionId || prev.workdir !== workdir);
    const generationEnded = visible && prev.isStreaming && !isStreaming;
    if (contextChanged) refresh(true);
    else if (becameVisible || generationEnded) refresh();
  }, [visible, sessionId, workdir, isStreaming, refresh]);

  const toggleFile = (path: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
    // Collapse/expand changes the height drastically; drop any stale measured
    // height so the estimate (which accounts for the collapsed state) wins
    // until ResizeObserver re-measures the mounted item.
    setMeasuredHeights((prev) => {
      if (!prev.has(path)) return prev;
      const next = new Map(prev);
      next.delete(path);
      return next;
    });
  };

  // Layout: absolute offset + height per file. Collapsed files are exactly
  // header-height; expanded files use the measured height once known.
  const files = state.kind === 'ok' ? state.files : [];
  const layout = useMemo(() => {
    const offsets: number[] = [];
    const heights: number[] = [];
    let total = 0;
    for (const file of files) {
      offsets.push(total);
      const height = collapsed.has(file.path)
        ? HEADER_HEIGHT
        : measuredHeights.get(file.path) ?? estimateFileHeight(file, collapsed.has(file.path));
      heights.push(height);
      total += height;
    }
    return { offsets, heights, total };
  }, [files, collapsed, measuredHeights]);

  // Only items intersecting the viewport (plus overscan) are mounted.
  const visibleIndices = useMemo(() => {
    const { offsets, heights, total } = layout;
    // Clamp so a stale scrollTop from a previous, longer file list (e.g. after
    // refresh) never blanks the pane until the next scroll event.
    const effectiveScrollTop = Math.min(scrollTop, Math.max(0, total - viewport));
    const startY = effectiveScrollTop - OVERSCAN_PX;
    const endY = effectiveScrollTop + viewport + OVERSCAN_PX;
    const out: number[] = [];
    for (let i = 0; i < files.length; i++) {
      if (offsets[i] + heights[i] < startY || offsets[i] > endY) continue;
      out.push(i);
    }
    return out;
  }, [layout, files.length, scrollTop, viewport]);

  const handleScroll = (e: React.UIEvent<HTMLDivElement>) => {
    setScrollTop(e.currentTarget.scrollTop);
  };

  const onDragStart = (e: React.MouseEvent) => {
    e.preventDefault();
    const handle = e.currentTarget as HTMLElement;
    // Keep the handle lit + cursor locked for the whole drag — :hover and the
    // 6px-only col-resize cursor both flicker as the pointer outruns the handle.
    handle.style.background = 'var(--vscode-focusBorder, #007fd4)';
    document.body.classList.add('is-panel-resizing');
    const rect = asideRef.current?.getBoundingClientRect();
    const onMove = (ev: MouseEvent) => {
      const next = widthFromLeft ? ev.clientX - (rect?.left ?? 0) : (rect?.right ?? 0) - ev.clientX;
      onWidthChange(Math.min(Math.max(next, MIN_WIDTH), maxWidth));
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

  const renderHunks = (file: WorkspaceDiffFile) =>
    file.hunks.split('\n').map((line, i) => {
      if (line.startsWith('@@')) {
        return (
          <div key={i} className="diff-line-hunk">
            {line}
          </div>
        );
      }
      if (line.startsWith('\\')) {
        return (
          <div key={i} className="diff-line-ellipsis">
            {line}
          </div>
        );
      }
      let cls = 'diff-line diff-line-context';
      let prefix = ' ';
      let content = line;
      if (line.startsWith('+')) {
        cls = 'diff-line diff-line-added';
        prefix = '+';
        content = line.slice(1);
      } else if (line.startsWith('-')) {
        cls = 'diff-line diff-line-removed';
        prefix = '-';
        content = line.slice(1);
      } else if (line.startsWith(' ')) {
        content = line.slice(1);
      }
      const lineKey = `${file.path}:${i}`;
      const isOpen = commentTarget?.lineKey === lineKey;
      return (
        <React.Fragment key={i}>
          <div className={cls}>
            <span className="diff-prefix">{prefix}</span>
            <span className="diff-content">{content}</span>
            <button
              className="diff-line-comment-btn"
              title="评论这行"
              aria-label={`评论 ${file.path} 第 ${i + 1} 行`}
              data-testid={`diff-comment-add-${i}`}
              onClick={() => setCommentTarget({ lineKey, file, prefix, text: content.slice(0, 30) })}
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
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    submitComment();
                  } else if (e.key === 'Escape') {
                    e.preventDefault();
                    cancelComment();
                  }
                }}
              />
              <div className="diff-comment-box-footer">
                <span className="diff-comment-box-tag" title={file.path}>{file.path}</span>
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
                  disabled={commentDraft.trim() === ''}
                  onClick={submitComment}
                >
                  添加
                </button>
              </div>
            </div>
          )}
        </React.Fragment>
      );
    });

  const renderFile = (file: WorkspaceDiffFile) => {
    const isCollapsed = collapsed.has(file.path);
    return (
      <div className="diff-file" key={file.path} data-testid={`diff-file-${file.status}`}>
        <button
          className="diff-file-header"
          aria-expanded={!isCollapsed}
          onClick={() => toggleFile(file.path)}
        >
          <i className={`codicon codicon-chevron-${isCollapsed ? 'right' : 'down'}`} />
          <span className={`diff-file-status diff-file-status-${file.status}`}>
            {STATUS_LABEL[file.status]}
          </span>
          <span className="diff-file-path" title={file.oldPath ? `${file.oldPath} → ${file.path}` : file.path}>
            {file.path}
          </span>
          <span className="diff-file-stats">
            <span className="diff-file-stats-add">+{file.additions}</span>
            <span className="diff-file-stats-del">-{file.deletions}</span>
          </span>
        </button>
        {!isCollapsed && (
          <div className="diff-file-body">
            {file.binary ? (
              <div className="diff-line-ellipsis">二进制文件，不显示差异</div>
            ) : file.hunks ? (
              renderHunks(file)
            ) : (
              <div className="diff-line-ellipsis">
                {file.status === 'renamed' && file.oldPath
                  ? `重命名自 ${file.oldPath}`
                  : '无内容差异'}
              </div>
            )}
            {file.truncated && <div className="diff-line-ellipsis">差异过大，已截断…</div>}
          </div>
        )}
      </div>
    );
  };

  return (
    <aside ref={asideRef} className="preview-pane diff-pane" style={{ width }} data-testid="diff-pane">
      <div className="preview-pane-drag-handle" onMouseDown={onDragStart} />
      <div className="preview-pane-inner">
        <div className="preview-pane-toolbar">
          <span className="preview-pane-url">差异</span>
          <button
            className="preview-pane-button"
            title="刷新"
            data-testid="diff-refresh"
            onClick={() => refresh()}
          >
            <i className={`codicon codicon-refresh${refreshing ? ' codicon-modifier-spin' : ''}`} />
          </button>
          <button
            className="preview-pane-button"
            title="关闭"
            data-testid="diff-close"
            onClick={onClose}
          >
            <i className="codicon codicon-close" />
          </button>
        </div>
        <div className="diff-pane-body" ref={scrollRef} onScroll={handleScroll}>
          {state.kind === 'loading' && <div className="desktop-panel-placeholder">加载中…</div>}
          {state.kind === 'not-a-repo' && (
            <div className="desktop-panel-placeholder">非 git 仓库</div>
          )}
          {state.kind === 'ok' && state.files.length === 0 && (
            <div className="desktop-panel-placeholder">无改动</div>
          )}
          {state.kind === 'ok' && state.files.length > 0 && (
            <div className="diff-file-virtual-spacer" style={{ height: layout.total }}>
              {visibleIndices.map((i) => (
                <MeasuredDiffItem
                  key={files[i].path}
                  file={files[i]}
                  top={layout.offsets[i]}
                  onMeasure={handleMeasure}
                >
                  {renderFile(files[i])}
                </MeasuredDiffItem>
              ))}
            </div>
          )}
        </div>
      </div>
    </aside>
  );
};

export default DiffPane;
