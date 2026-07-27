import React, { useMemo, useState } from 'react';
import type { SessionMetadata } from 'wave-agent-sdk';
import { formatSessionLabel } from '../utils/session';
import { SessionList } from './SessionList';
import '../styles/DesktopApp.css';

export interface DesktopSidebarProps {
  workdir: string;
  onChangeWorkdir: () => void;
  onNewSession: () => void;
  isStreaming: boolean;
  sessions: SessionMetadata[];
  currentSession?: SessionMetadata | null;
  onSessionSelect: (sessionId: string) => void;
  sessionsLoading: boolean;
}

/**
 * Left rail for the desktop host: new-session button, workdir switcher and
 * the searchable session list (replaces the header session buttons, which are
 * hidden via ChatHeader's hideSessionButtons).
 */
export const DesktopSidebar: React.FC<DesktopSidebarProps> = ({
  workdir,
  onChangeWorkdir,
  onNewSession,
  isStreaming,
  sessions,
  currentSession,
  onSessionSelect,
  sessionsLoading,
}) => {
  const [query, setQuery] = useState('');

  const filteredSessions = useMemo(() => {
    const trimmed = query.trim().toLowerCase();
    if (!trimmed) return sessions;
    return sessions.filter((session) =>
      formatSessionLabel(session).toLowerCase().includes(trimmed)
    );
  }, [sessions, query]);

  const dirName = workdir.split(/[\\/]/).filter(Boolean).pop() || workdir;

  return (
    <div className="desktop-sidebar" data-testid="desktop-sidebar">
      <div className="desktop-sidebar-header">
        <span className="desktop-sidebar-title">Wave 代码智聊</span>
      </div>
      <div className="desktop-sidebar-workdir">
        <div
          className="desktop-sidebar-workdir-main"
          onClick={onChangeWorkdir}
          title={workdir}
          data-testid="desktop-workdir"
        >
          <span className="codicon codicon-folder-opened"></span>
          <span className="desktop-sidebar-workdir-name">{dirName}</span>
          <span className="codicon codicon-chevron-down desktop-sidebar-workdir-caret"></span>
        </div>
        <button
          className="desktop-sidebar-workdir-new"
          onClick={onNewSession}
          disabled={isStreaming}
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
