import React, { useState, useRef, useEffect, useCallback } from 'react';
import '../styles/DesktopApp.css';

export interface DesktopWorktreeControlsProps {
  branches: string[];
  /** Selected base branch. */
  branch: string;
  /** Whether the worktree checkbox is on. */
  worktreeChecked: boolean;
  onBranchChange: (branch: string) => void;
  onWorktreeChange: (checked: boolean) => void;
}

/**
 * Branch selector + worktree checkbox shown next to the workdir selector on
 * the new-session page (FR-022/FR-023). Only rendered when the current workdir
 * is a git repo. Same dropdown pattern as DesktopWorkdirSelector: relative
 * container, menu expands upward, click-outside closes.
 */
export const DesktopWorktreeControls: React.FC<DesktopWorktreeControlsProps> = ({
  branches,
  branch,
  worktreeChecked,
  onBranchChange,
  onWorktreeChange,
}) => {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const onMouseDown = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', onMouseDown);
    return () => document.removeEventListener('mousedown', onMouseDown);
  }, [menuOpen]);

  const handleSelectBranch = useCallback(
    (b: string) => {
      setMenuOpen(false);
      onBranchChange(b);
    },
    [onBranchChange],
  );

  return (
    <div className="desktop-worktree-controls" data-testid="desktop-worktree-controls">
      <div className="desktop-workdir-container" ref={menuRef}>
        <div
          className="desktop-workdir-trigger"
          onClick={() => setMenuOpen((o) => !o)}
          title={`基准分支：${branch}`}
          data-testid="desktop-branch-selector"
          aria-expanded={menuOpen}
          role="button"
        >
          <span className="codicon codicon-git-branch"></span>
          <span className="desktop-workdir-name">{branch}</span>
          <span className="codicon codicon-chevron-down desktop-workdir-caret"></span>
        </div>
        {menuOpen && (
          <div className="desktop-workdir-menu" role="listbox" data-testid="desktop-branch-menu">
            {branches.map((b) => (
              <div
                key={b}
                className={`desktop-workdir-menu-item${b === branch ? ' desktop-branch-active' : ''}`}
                role="option"
                onClick={() => handleSelectBranch(b)}
                title={b}
                data-testid="desktop-branch-item"
              >
                <span className="codicon codicon-git-branch"></span>
                <span className="desktop-workdir-menu-path">
                  <span className="desktop-workdir-menu-name">{b}</span>
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
      <label className="desktop-worktree-checkbox" data-testid="desktop-worktree-checkbox">
        <input
          type="checkbox"
          checked={worktreeChecked}
          onChange={(e) => onWorktreeChange(e.target.checked)}
        />
        <span>worktree</span>
      </label>
    </div>
  );
};

export default DesktopWorktreeControls;
