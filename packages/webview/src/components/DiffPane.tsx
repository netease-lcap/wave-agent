import React from 'react';

export interface DiffPaneProps {
  /** Effective cwd of the owning pane's session (worktree path when applicable). */
  workdir?: string;
  width: number;
  onWidthChange: (width: number) => void;
  maxWidth: number;
  onClose: () => void;
}

/** Workspace git-diff panel. UI shell lands first; the git data service follows. */
export const DiffPane: React.FC<DiffPaneProps> = ({ width, onClose }) => {
  return (
    <aside className="preview-pane diff-pane" style={{ width }} data-testid="diff-pane">
      <div className="preview-pane-inner">
        <div className="preview-pane-toolbar">
          <span className="preview-pane-url">差异</span>
          <button className="preview-pane-button" title="关闭" data-testid="diff-close" onClick={onClose}>
            <i className="codicon codicon-close" />
          </button>
        </div>
        <div className="desktop-panel-placeholder">尚未实现</div>
      </div>
    </aside>
  );
};

export default DiffPane;
