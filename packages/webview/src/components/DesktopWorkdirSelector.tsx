import React, { useState, useRef, useEffect, useCallback } from 'react';
import '../styles/DesktopApp.css';

export interface DesktopWorkdirSelectorProps {
  workdir?: string;
  recentWorkdirs: string[];
  onSelectWorkdir: () => void;
  onSelectRecentWorkdir: (path: string) => void;
  onRemoveRecentWorkdir: (path: string) => void;
}

/**
 * Workdir dropdown shown at the top-left of the message input (desktop host,
 * new-session state only). Same pattern as the permission-mode dropdown in
 * MessageInput: a relative container holds the trigger + an absolutely
 * positioned menu. The menu expands UPWARD (bottom:100%) because the input
 * sits at the bottom of the viewport. Clicking outside closes it.
 */
export const DesktopWorkdirSelector: React.FC<DesktopWorkdirSelectorProps> = ({
  workdir,
  recentWorkdirs,
  onSelectWorkdir,
  onSelectRecentWorkdir,
  onRemoveRecentWorkdir,
}) => {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // Close the dropdown when clicking outside of it.
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

  const dirName = workdir
    ? workdir.split(/[\\/]/).filter(Boolean).pop() || workdir
    : '选择工作目录…';

  const handleBrowse = useCallback(() => {
    setMenuOpen(false);
    onSelectWorkdir();
  }, [onSelectWorkdir]);

  const handleSelectRecent = useCallback((path: string) => {
    setMenuOpen(false);
    onSelectRecentWorkdir(path);
  }, [onSelectRecentWorkdir]);

  const handleRemoveRecent = useCallback(
    (e: React.MouseEvent, path: string) => {
      e.stopPropagation();
      onRemoveRecentWorkdir(path);
    },
    [onRemoveRecentWorkdir],
  );

  return (
    <div className="desktop-workdir-container" ref={menuRef}>
      <div
        className="desktop-workdir-trigger"
        onClick={() => setMenuOpen((o) => !o)}
        title={workdir ?? '选择工作目录…'}
        data-testid="desktop-workdir"
        aria-expanded={menuOpen}
        role="button"
      >
        <span className="codicon codicon-folder-opened"></span>
        <span className="desktop-workdir-name">{dirName}</span>
        <span className="codicon codicon-chevron-down desktop-workdir-caret"></span>
      </div>
      {menuOpen && (
        <div className="desktop-workdir-menu" role="listbox" data-testid="desktop-workdir-menu">
          {recentWorkdirs.length > 0 && (
            <div className="desktop-workdir-menu-label">最近打开</div>
          )}
          {recentWorkdirs.map((dir) => {
            // VS Code-style two-line entry: basename on top, parent path
            // below in de-emphasized text (keeps long paths readable and
            // disambiguates same-named folders).
            const segments = dir.split(/[\\/]/).filter(Boolean);
            const base = segments.pop() || dir;
            const parent = dir.slice(0, dir.length - base.length).replace(/[\\/]+$/, '');
            return (
              <div
                key={dir}
                className="desktop-workdir-menu-item"
                role="option"
                onClick={() => handleSelectRecent(dir)}
                title={dir}
                data-testid="desktop-workdir-recent-item"
              >
                <span className="codicon codicon-folder"></span>
                <span className="desktop-workdir-menu-path">
                  <span className="desktop-workdir-menu-name">{base}</span>
                  {parent && <span className="desktop-workdir-menu-parent">{parent}</span>}
                </span>
                <button
                  className="desktop-workdir-menu-remove"
                  title="从列表移除"
                  onClick={(e) => handleRemoveRecent(e, dir)}
                  data-testid="desktop-workdir-recent-remove"
                >
                  <span className="codicon codicon-close"></span>
                </button>
              </div>
            );
          })}
          <div className="desktop-workdir-menu-separator" />
          <div
            className="desktop-workdir-menu-item desktop-workdir-menu-browse"
            role="option"
            onClick={handleBrowse}
            data-testid="desktop-workdir-browse"
          >
            <span className="codicon codicon-folder-opened"></span>
            <span>浏览…</span>
          </div>
        </div>
      )}
    </div>
  );
};

export default DesktopWorkdirSelector;
