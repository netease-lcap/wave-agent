import React, { useState } from 'react';
import type { DesktopSessionGroup, DesktopSessionEntry } from '../types';
import '../styles/DesktopApp.css';

export interface DesktopSidebarProps {
  onNewSession: () => void;
  isStreaming: boolean;
  /** No workdir picked yet — starting a new session is not possible. */
  disabled: boolean;
  /** Session tree groups, one per recent directory (FR-020). */
  sessionTree: DesktopSessionGroup[];
  /** Current workdir — its group defaults to expanded. */
  currentWorkdir?: string;
  /** Active session id — gets the running dot while streaming. */
  currentSessionId?: string;
  onSelectSession: (workdir: string, sessionId: string) => void;
  /** Delete a session from the index (also cleans up worktree if applicable). */
  onDeleteSession: (sessionId: string) => void;
}

const dirName = (workdir: string): string =>
  workdir.split('/').filter(Boolean).pop() ?? workdir;

/**
 * Left rail for the desktop host: app title, "新对话" button, and the session
 * history tree (FR-020) — one collapsible group per recent directory holding up
 * to 5 recent sessions. Clicking a session restores it (switching workdir first
 * when it lives in another directory).
 */
export const DesktopSidebar: React.FC<DesktopSidebarProps> = ({
  onNewSession,
  isStreaming,
  disabled,
  sessionTree,
  currentWorkdir,
  currentSessionId,
  onSelectSession,
  onDeleteSession,
}) => {
  // Explicit expand/collapse overrides; groups without an entry follow the
  // default rule (expanded iff it is the current workdir's group).
  const [overrides, setOverrides] = useState<Record<string, boolean>>({});

  const isExpanded = (workdir: string): boolean =>
    overrides[workdir] ?? workdir === currentWorkdir;

  const toggleGroup = (workdir: string) => {
    setOverrides((prev) => ({
      ...prev,
      [workdir]: !(prev[workdir] ?? workdir === currentWorkdir),
    }));
  };

  const renderSession = (group: DesktopSessionGroup, session: DesktopSessionEntry) => {
    const running = session.sessionId === currentSessionId && isStreaming;
    return (
      <li
        key={session.sessionId}
        className={`desktop-session-item ${session.sessionId === currentSessionId ? 'desktop-session-item--current' : ''}`}
        onClick={() => onSelectSession(group.workdir, session.sessionId)}
        data-testid={`desktop-session-item-${session.sessionId}`}
      >
        <span
          className={`desktop-session-dot${running ? ' desktop-session-dot--running' : ''}`}
          title={running ? '正在运行' : undefined}
        />
        <span className="desktop-session-title">{session.title || '新对话'}</span>
        <button
          className="desktop-session-delete"
          title="删除会话"
          onClick={(e) => {
            e.stopPropagation();
            onDeleteSession(session.sessionId);
          }}
          data-testid={`desktop-session-delete-${session.sessionId}`}
        >
          <span className="codicon codicon-trash"></span>
        </button>
      </li>
    );
  };

  return (
    <div className="desktop-sidebar" data-testid="desktop-sidebar">
      <div className="desktop-sidebar-header">
        <span className="desktop-sidebar-title">Wave 代码智聊</span>
      </div>
      <button
        className="desktop-sidebar-new-chat"
        onClick={onNewSession}
        disabled={isStreaming || disabled}
        title="新对话"
        data-testid="desktop-new-session"
      >
        <span className="codicon codicon-add"></span>
        <span>新对话</span>
      </button>
      <div className="desktop-session-tree" data-testid="desktop-session-tree">
        {sessionTree.map((group) => {
          const expanded = isExpanded(group.workdir);
          return (
            <div
              key={group.workdir}
              className="desktop-session-group"
              data-testid={`desktop-session-group-${group.workdir}`}
            >
              <div
                className="desktop-session-group-header"
                onClick={() => toggleGroup(group.workdir)}
                title={group.workdir}
              >
                <span className={`codicon codicon-chevron-${expanded ? 'down' : 'right'}`}></span>
                <span className="desktop-session-group-name">{dirName(group.workdir)}</span>
              </div>
              {expanded &&
                (group.sessions.length === 0 ? (
                  <div className="desktop-session-empty">无会话</div>
                ) : (
                  <ul className="desktop-session-items">
                    {group.sessions.map((session) => renderSession(group, session))}
                  </ul>
                ))}
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default DesktopSidebar;
