import React, { useMemo, useState, useRef, useEffect, useCallback } from 'react';
import type { SessionMetadata } from 'wave-agent-sdk';
import { formatSessionLabel } from '../utils/session';
import { SessionList } from './SessionList';
import '../styles/DesktopApp.css';

export interface DesktopSidebarProps {
  workdir?: string;
  recentWorkdirs: string[];
  onSelectWorkdir: () => void;
  onSelectRecentWorkdir: (path: string) => void;
  onRemoveRecentWorkdir: (path: string) => void;
  onNewSession: () => void;
  isStreaming: boolean;
  sessions: SessionMetadata[];
  currentSession?: SessionMetadata | null;
  onSessionSelect: (sessionId: string) => void;
  sessionsLoading: boolean;
}

/**
 * Left rail for the desktop host: new-session button, workdir dropdown and
 * the searchable session list (replaces the header session buttons, which are
 * hidden via ChatHeader's hideSessionButtons).
 *
 * The workdir header is a custom dropdown trigger (same pattern as the
 * permission-mode dropdown in MessageInput): a relative container holds the
 * trigger + an absolutely-positioned menu that expands downward (the header
 * sits near the top of the sidebar). Clicking outside closes it.
 */
export const DesktopSidebar: React.FC<DesktopSidebarProps> = ({
  workdir,
  recentWorkdirs,
  onSelectWorkdir,
  onSelectRecentWorkdir,
  onRemoveRecentWorkdir,
  onNewSession,
  isStreaming,
  sessions,
  currentSession,
  onSessionSelect,
  sessionsLoading,
}) => {
  const [query, setQuery] = useState('');
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // Close the workdir dropdown when clicking outside of it.
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

  const filteredSessions = useMemo(() => {
    const trimmed = query.trim().toLowerCase();
    if (!trimmed) return sessions;
    return sessions.filter((session) =>
      formatSessionLabel(session).toLowerCase().includes(trimmed)
    );
  }, [sessions, query]);

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
    <div className="desktop-sidebar" data-testid="desktop-sidebar">
      <div className="desktop-sidebar-header">
        <span className="desktop-sidebar-title">Wave 代码智聊</span>
      </div>
      <div className="desktop-sidebar-workdir">
        <div className="desktop-workdir-container" ref={menuRef}>
          <div
            className="desktop-sidebar-workdir-main"
            onClick={() => setMenuOpen((o) => !o)}
            title={workdir ?? '选择工作目录…'}
            data-testid="desktop-workdir"
            aria-expanded={menuOpen}
            role="button"
          >
            <span className="codicon codicon-folder-opened"></span>
            <span className="desktop-sidebar-workdir-name">{dirName}</span>
            <span className="codicon codicon-chevron-down desktop-sidebar-workdir-caret"></span>
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
        <button
          className="desktop-sidebar-workdir-new"
          onClick={onNewSession}
          disabled={isStreaming || !workdir}
          title="新建会话"
          data-testid="desktop-new-session"
        >
          <span className="codicon codicon-add"></span>
        </button>
      </div>
      <div className="desktop-sidebar-sessions">
        <input
          type="text"
          className="session-list-search"
          placeholder="搜索关键词"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <div className="session-list-label">历史对话</div>
        <SessionList
          sessions={filteredSessions}
          currentSession={currentSession}
          onSessionSelect={onSessionSelect}
          loading={sessionsLoading}
          highlightQuery={query}
        />
      </div>
    </div>
  );
};

export default DesktopSidebar;
