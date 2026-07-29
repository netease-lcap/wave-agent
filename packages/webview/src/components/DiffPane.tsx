import React, { useCallback, useEffect, useRef, useState } from 'react';
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

const MIN_WIDTH = 320;

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
}) => {
  const [state, setState] = useState<DiffState>({ kind: 'loading' });
  // Collapsed paths survive refreshes; files are expanded by default.
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());
  const asideRef = useRef<HTMLElement | null>(null);

  const refresh = useCallback(() => {
    setState({ kind: 'loading' });
    vscode.postMessage({ command: 'desktopGetWorkspaceDiff', ...(paneId ? { paneId } : {}) });
  }, [vscode, paneId]);

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      const msg = event.data;
      if (msg?.command !== 'desktopWorkspaceDiff') return;
      if (paneId !== undefined && msg.paneId !== paneId) return;
      const result = msg.result;
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
    if (becameVisible || contextChanged || generationEnded) refresh();
  }, [visible, sessionId, workdir, isStreaming, refresh]);

  const toggleFile = (path: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  };

  const onDragStart = (e: React.MouseEvent) => {
    e.preventDefault();
    const rect = asideRef.current?.getBoundingClientRect();
    const onMove = (ev: MouseEvent) => {
      const next = widthFromLeft ? ev.clientX - (rect?.left ?? 0) : (rect?.right ?? 0) - ev.clientX;
      onWidthChange(Math.min(Math.max(next, MIN_WIDTH), maxWidth));
    };
    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  const renderHunks = (hunks: string) =>
    hunks.split('\n').map((line, i) => {
      let cls = 'diff-line diff-line-context';
      let prefix = ' ';
      let content = line;
      if (line.startsWith('@@')) {
        return (
          <div key={i} className="diff-line-hunk">
            {line}
          </div>
        );
      }
      if (line.startsWith('+')) {
        cls = 'diff-line diff-line-added';
        prefix = '+';
        content = line.slice(1);
      } else if (line.startsWith('-')) {
        cls = 'diff-line diff-line-removed';
        prefix = '-';
        content = line.slice(1);
      } else if (line.startsWith('\\')) {
        return (
          <div key={i} className="diff-line-ellipsis">
            {line}
          </div>
        );
      } else if (line.startsWith(' ')) {
        content = line.slice(1);
      }
      return (
        <div key={i} className={cls}>
          <span className="diff-prefix">{prefix}</span>
          <span className="diff-content">{content}</span>
        </div>
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
              renderHunks(file.hunks)
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
            onClick={refresh}
          >
            <i className="codicon codicon-refresh" />
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
        <div className="diff-pane-body">
          {state.kind === 'loading' && <div className="desktop-panel-placeholder">加载中…</div>}
          {state.kind === 'not-a-repo' && (
            <div className="desktop-panel-placeholder">非 git 仓库</div>
          )}
          {state.kind === 'ok' && state.files.length === 0 && (
            <div className="desktop-panel-placeholder">无改动</div>
          )}
          {state.kind === 'ok' && state.files.map(renderFile)}
        </div>
      </div>
    </aside>
  );
};

export default DiffPane;
