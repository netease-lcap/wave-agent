import React, { useState, useRef, useEffect, useCallback } from 'react';
import '../styles/DesktopApp.css';

export interface DesktopWorkdirSelectorProps {
  workdir?: string;
  recentWorkdirs: string[];
  /**
   * Current host ('local' or an SSH host name). Remote hosts have no Electron
   * directory picker — the 浏览… action becomes a 输入路径… text input and the
   * path is validated with `test -d` on the host (spec scenario 4).
   */
  host?: string;
  onSelectWorkdir: () => void;
  /** Remote-only: select a workdir by absolute path on `host`. */
  onSelectRemotePath?: (path: string, host: string) => void;
  /** `host` scopes the recents lookup to a specific host (defaults to the current one). */
  onSelectRecentWorkdir: (path: string, host?: string) => void;
  onRemoveRecentWorkdir: (path: string, host?: string) => void;
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
  host,
  onSelectWorkdir,
  onSelectRemotePath,
  onSelectRecentWorkdir,
  onRemoveRecentWorkdir,
}) => {
  const [menuOpen, setMenuOpen] = useState(false);
  const [editingPath, setEditingPath] = useState(false);
  const [pathInput, setPathInput] = useState('');
  const menuRef = useRef<HTMLDivElement>(null);
  const pathInputRef = useRef<HTMLInputElement>(null);
  const isRemote = host !== undefined && host !== 'local';

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
    : isRemote
      ? '选择远程目录…'
      : '选择工作目录…';

  const handleBrowse = useCallback(() => {
    setMenuOpen(false);
    onSelectWorkdir();
  }, [onSelectWorkdir]);

  const openPathInput = useCallback(() => {
    setEditingPath(true);
    setPathInput(workdir ?? '');
    requestAnimationFrame(() => pathInputRef.current?.focus());
  }, [workdir]);

  const submitPath = useCallback(() => {
    const p = pathInput.trim();
    if (!p) return;
    setMenuOpen(false);
    setEditingPath(false);
    setPathInput('');
    onSelectRemotePath?.(p, host as string);
  }, [pathInput, host, onSelectRemotePath]);

  const handleSelectRecent = useCallback(
    (path: string) => {
      setMenuOpen(false);
      onSelectRecentWorkdir(path, host);
    },
    [host, onSelectRecentWorkdir],
  );

  const handleRemoveRecent = useCallback(
    (e: React.MouseEvent, path: string) => {
      e.stopPropagation();
      onRemoveRecentWorkdir(path, host);
    },
    [host, onRemoveRecentWorkdir],
  );

  return (
    <div className="desktop-workdir-container" ref={menuRef}>
      <div
        className="desktop-workdir-trigger"
        onClick={() => setMenuOpen((o) => !o)}
        title={workdir ?? (isRemote ? '选择远程目录…' : '选择工作目录…')}
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
          {isRemote && editingPath ? (
            <div className="desktop-host-add" data-testid="desktop-workdir-path-input">
              <input
                ref={pathInputRef}
                className="desktop-host-add-input"
                placeholder="/home/user/project"
                value={pathInput}
                onChange={(e) => setPathInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') submitPath();
                  else if (e.key === 'Escape') setEditingPath(false);
                }}
              />
            </div>
          ) : (
            <div
              className="desktop-workdir-menu-item"
              role="option"
              onClick={isRemote ? openPathInput : handleBrowse}
              data-testid={isRemote ? 'desktop-workdir-path-entry' : 'desktop-workdir-browse'}
            >
              <span className="codicon codicon-folder-opened"></span>
              <span>{isRemote ? '输入路径…' : '浏览…'}</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default DesktopWorkdirSelector;
