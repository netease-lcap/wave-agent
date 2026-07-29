import React from 'react';

export interface TerminalPaneProps {
  /** Effective cwd of the owning pane's session (worktree path when applicable). */
  workdir?: string;
  width: number;
  onWidthChange: (width: number) => void;
  maxWidth: number;
  onClose: () => void;
}

/** Embedded PTY terminal panel. UI shell lands first; node-pty + xterm.js follow. */
export const TerminalPane: React.FC<TerminalPaneProps> = ({ width, onClose }) => {
  return (
    <aside className="preview-pane terminal-pane" style={{ width }} data-testid="terminal-pane">
      <div className="preview-pane-inner">
        <div className="preview-pane-toolbar">
          <span className="preview-pane-url">终端</span>
          <button className="preview-pane-button" title="关闭" data-testid="terminal-close" onClick={onClose}>
            <i className="codicon codicon-close" />
          </button>
        </div>
        <div className="desktop-panel-placeholder">尚未实现</div>
      </div>
    </aside>
  );
};

export default TerminalPane;
