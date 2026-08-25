import React, { useState, useRef, useEffect, useCallback } from "react";
import "../styles/DesktopApp.css";

export interface DesktopWorktreeControlsProps {
  branches: string[];
  /** Selected base branch. */
  branch: string;
  /** Whether the worktree checkbox is on. */
  worktreeChecked: boolean;
  /** Worktree creation is in flight — show "创建中" and disable the controls. */
  creating?: boolean;
  /** Branch list is still being fetched — show "分支获取中…" and disable the trigger. */
  loading?: boolean;
  onBranchChange: (branch: string) => void;
  onWorktreeChange: (checked: boolean) => void;
}

/**
 * Branch selector + worktree checkbox shown next to the workdir selector on
 * the new-session page (FR-022/FR-023). Only rendered when the current workdir
 * is a git repo. Same dropdown pattern as DesktopWorkdirSelector: relative
 * container, menu expands upward, click-outside closes.
 */
export const DesktopWorktreeControls: React.FC<
  DesktopWorktreeControlsProps
> = ({
  branches,
  branch,
  worktreeChecked,
  creating = false,
  loading = false,
  onBranchChange,
  onWorktreeChange,
}) => {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const onMouseDown = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", onMouseDown);
    return () => document.removeEventListener("mousedown", onMouseDown);
  }, [menuOpen]);

  const handleSelectBranch = useCallback(
    (b: string) => {
      setMenuOpen(false);
      onBranchChange(b);
      triggerRef.current?.focus();
    },
    [onBranchChange],
  );

  return (
    <div
      className="desktop-worktree-controls"
      data-testid="desktop-worktree-controls"
    >
      <div className="desktop-workdir-container" ref={menuRef}>
        <div
          className="desktop-workdir-trigger"
          ref={triggerRef}
          onClick={loading ? undefined : () => setMenuOpen((o) => !o)}
          onKeyDown={
            loading
              ? undefined
              : (e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    setMenuOpen((o) => !o);
                  } else if (e.key === "Escape" && menuOpen) {
                    e.preventDefault();
                    setMenuOpen(false);
                  }
                }
          }
          title={loading ? "分支获取中…" : `基准分支：${branch}`}
          data-testid="desktop-branch-selector"
          aria-expanded={menuOpen}
          aria-haspopup="listbox"
          role="button"
          tabIndex={loading ? -1 : 0}
        >
          <span className="codicon codicon-git-branch"></span>
          {loading ? (
            <span className="desktop-workdir-name desktop-branch-loading">
              分支获取中…
            </span>
          ) : (
            <span className="desktop-workdir-name">{branch}</span>
          )}
          <span className="codicon codicon-chevron-down desktop-workdir-caret"></span>
        </div>
        {menuOpen && (
          <div
            className="desktop-workdir-menu"
            role="listbox"
            data-testid="desktop-branch-menu"
          >
            {branches.map((b) => (
              <div
                key={b}
                className={`desktop-workdir-menu-item${b === branch ? " desktop-branch-active" : ""}`}
                role="option"
                tabIndex={0}
                onClick={() => handleSelectBranch(b)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    handleSelectBranch(b);
                  } else if (e.key === "Escape") {
                    e.preventDefault();
                    setMenuOpen(false);
                    triggerRef.current?.focus();
                  }
                }}
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
      <label
        className="desktop-worktree-checkbox"
        data-testid="desktop-worktree-checkbox"
      >
        <input
          type="checkbox"
          checked={worktreeChecked}
          disabled={creating}
          onChange={(e) => onWorktreeChange(e.target.checked)}
        />
        <span>worktree</span>
        {creating && (
          <span
            className="desktop-worktree-creating"
            data-testid="desktop-worktree-creating"
          >
            worktree 创建中…
          </span>
        )}
      </label>
    </div>
  );
};

export default DesktopWorktreeControls;
