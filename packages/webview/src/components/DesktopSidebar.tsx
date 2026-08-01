import React, { useState } from 'react';
import { Tooltip } from './Tooltip';
import { ConfirmDialog } from './ConfirmDialog';
import { MoreIcon } from './HeaderIcons';
import { MoreMenu } from './MoreMenu';
import type { DesktopSessionGroup, DesktopSessionEntry } from '../types';
import '../styles/DesktopApp.css';

/** dataTransfer MIME carrying { workdir, sessionId } while a sidebar session drags. */
export const SESSION_DRAG_MIME = 'application/x-wave-session';

export interface DesktopSidebarProps {
  onNewSession: () => void;
  /** Cmd/Ctrl+Click on the 新对话 button: start the new session in an additional pane. */
  onNewSessionInPane: () => void;
  isStreaming: boolean;
  /** No workdir picked yet — starting a new session is not possible. */
  disabled: boolean;
  /** Desktop host: the more menu (settings/enterprise console/login) lives here. */
  onOpenSettings: () => void;
  onOpenEnterpriseConsole: () => void;
  onLogin: () => void;
  onLogout: () => void;
  isAuthenticated: boolean;
  /** Session tree groups, one per recent directory (FR-020). */
  sessionTree: DesktopSessionGroup[];
  /** Active session id — gets the running dot while streaming. */
  currentSessionId?: string;
  /** Sessions shown in panes — those other than currentSessionId get a weak highlight. */
  visibleSessionIds?: string[];
  onSelectSession: (workdir: string, sessionId: string) => void;
  /** Cmd/Ctrl+Click: open the session in an additional pane to the right. */
  onOpenPane: (workdir: string, sessionId: string) => void;
  /** Delete a session from the index (also cleans up worktree if applicable). */
  onDeleteSession: (sessionId: string) => void;
}

const dirName = (workdir: string): string =>
  workdir.split('/').filter(Boolean).pop() ?? workdir;

// A group is identified by (host, workdir) — the same directory may exist on
// the local machine and on an SSH host, and those are distinct groups (spec
// docs/specs/ui/desktop-app.md 「SSH 远程主机」scenario 9).
const groupKey = (group: DesktopSessionGroup): string => `${group.host}:${group.workdir}`;

const isMacPlatform = (): boolean =>
  typeof navigator !== 'undefined' && navigator.platform.toUpperCase().startsWith('MAC');

/**
 * Left rail for the desktop host: app title, "新对话" button, and the session
 * history tree (FR-020) — one collapsible group per recent directory holding up
 * to 5 recent sessions. Clicking a session restores it (switching workdir first
 * when it lives in another directory).
 */
export const DesktopSidebar: React.FC<DesktopSidebarProps> = ({
  onNewSession,
  onNewSessionInPane,
  isStreaming,
  disabled,
  onOpenSettings,
  onOpenEnterpriseConsole,
  onLogin,
  onLogout,
  isAuthenticated,
  sessionTree,
  currentSessionId,
  visibleSessionIds,
  onSelectSession,
  onOpenPane,
  onDeleteSession,
}) => {
  // Explicit expand/collapse overrides; groups without an entry are expanded
  // by default — the tree starts fully expanded on every app launch (expansion
  // state is not persisted).
  const [overrides, setOverrides] = useState<Record<string, boolean>>({});
  const [showMoreMenu, setShowMoreMenu] = useState(false);
  // Session awaiting delete confirmation; non-null shows the ConfirmDialog.
  const [pendingDelete, setPendingDelete] = useState<{ sessionId: string; title: string; description?: string } | null>(null);

  const isExpanded = (group: DesktopSessionGroup): boolean =>
    overrides[groupKey(group)] ?? true;

  const toggleGroup = (group: DesktopSessionGroup) => {
    setOverrides((prev) => ({
      ...prev,
      [groupKey(group)]: !(prev[groupKey(group)] ?? true),
    }));
  };

  const renderSession = (group: DesktopSessionGroup, session: DesktopSessionEntry) => {
    // FR-031 multi-session parallel: the host derives `session.running` for every
    // live session; the active one also falls back to the local streaming flag so
    // its dot appears without waiting for the next tree refresh.
    const running = session.running || (session.sessionId === currentSessionId && isStreaming);
    // Waiting takes precedence: a session blocked on user confirmation is not
    // meaningfully "running", and it needs attention more than the running dot.
    const waiting = session.waitingConfirmation ?? false;
    const isCurrent = session.sessionId === currentSessionId;
    // A session displayed in a non-focused pane gets the weak highlight.
    const isVisible = !isCurrent && (visibleSessionIds?.includes(session.sessionId) ?? false);
    return (
      <li
        key={session.sessionId}
        className={`desktop-session-item${isCurrent ? ' desktop-session-item--current' : ''}${isVisible ? ' desktop-session-item--visible' : ''}`}
        draggable
        onDragStart={(e) => {
          // Drag into the chat area opens the session in a new pane (drop on a
          // pane gap inserts there, anywhere else appends at the right end).
          e.dataTransfer.setData(SESSION_DRAG_MIME, JSON.stringify({ workdir: group.workdir, sessionId: session.sessionId }));
          try {
            e.dataTransfer.effectAllowed = 'copy';
          } catch {
            // jsdom's DataTransfer polyfill exposes a read-only effectAllowed.
          }
        }}
        onClick={(e) => {
          // Cmd on macOS / Ctrl elsewhere opens the session in a new pane to
          // the right; a plain click keeps the replace-focused-pane behavior.
          if (isMacPlatform() ? e.metaKey : e.ctrlKey) {
            onOpenPane(group.workdir, session.sessionId);
          } else {
            onSelectSession(group.workdir, session.sessionId);
          }
        }}
        data-testid={`desktop-session-item-${session.sessionId}`}
      >
        {running || waiting ? (
          <i
            className={`codicon codicon-${waiting ? 'bell' : 'loading codicon-modifier-spin'} desktop-session-status-icon`}
            style={{ color: waiting ? 'var(--vscode-charts-purple, #b180d7)' : 'var(--vscode-charts-blue, #59a4f9)' }}
            title={waiting ? '等待确认' : '正在运行'}
          />
        ) : (
          <span className="desktop-session-dot" aria-hidden="true" />
        )}
        <span className="desktop-session-title">{session.title || '新对话'}</span>
        <button
          className="desktop-session-delete"
          title="删除会话"
          onClick={(e) => {
            e.stopPropagation();
            // Worktree sessions warn about the worktree dir + temp branch and
            // the loss of uncommitted changes.
            const label = session.title || '新对话';
            setPendingDelete({
              sessionId: session.sessionId,
              title: `确定删除会话「${label}」？`,
              description: session.hasWorktree
                ? '该会话的 worktree 目录与临时分支将一并删除，未提交的改动将丢失。'
                : undefined,
            });
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
        <Tooltip text="更多" position="bottom">
          <button
            className="desktop-sidebar-more-btn"
            onClick={() => setShowMoreMenu((prev) => !prev)}
            data-testid="desktop-more-btn"
            aria-label="更多"
          >
            <MoreIcon />
          </button>
        </Tooltip>
      </div>
      {showMoreMenu && (
        <MoreMenu
          onOpenSettings={onOpenSettings}
          onOpenEnterpriseConsole={onOpenEnterpriseConsole}
          onLogin={onLogin}
          onLogout={onLogout}
          isAuthenticated={isAuthenticated}
          onClose={() => setShowMoreMenu(false)}
        />
      )}
      <button
        className="desktop-sidebar-new-chat"
        onClick={(e) => {
          // Cmd on macOS / Ctrl elsewhere opens the new session side-by-side
          // in a fresh pane; a plain click keeps the replace-focused-pane
          // behavior (same branching as session items above).
          if (isMacPlatform() ? e.metaKey : e.ctrlKey) {
            onNewSessionInPane();
          } else {
            onNewSession();
          }
        }}
        // 新对话在会话运行（streaming）期间也可用 — 多会话并行，旧会话在后台继续生成（FR-031）。
        disabled={disabled}
        title={isMacPlatform() ? '新对话（Cmd+Click 并排打开）' : '新对话（Ctrl+Click 并排打开）'}
        data-testid="desktop-new-session"
      >
        <span className="codicon codicon-add"></span>
        <span>新对话</span>
      </button>
      <div className="desktop-session-tree" data-testid="desktop-session-tree">
        {sessionTree.map((group) => {
          const expanded = isExpanded(group);
          return (
            <div
              key={groupKey(group)}
              className="desktop-session-group"
              data-testid={`desktop-session-group-${groupKey(group)}`}
            >
              <div
                className="desktop-session-group-header"
                onClick={() => toggleGroup(group)}
                title={group.workdir}
              >
                <span className={`codicon codicon-chevron-${expanded ? 'down' : 'right'}`}></span>
                <span className="desktop-session-group-name">{dirName(group.workdir)}</span>
                {group.host !== 'local' && (
                  <span className="desktop-session-group-host" title={group.host}>
                    {group.host}
                  </span>
                )}
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
      {pendingDelete && (
        <ConfirmDialog
          title={pendingDelete.title}
          description={pendingDelete.description}
          onConfirm={() => {
            onDeleteSession(pendingDelete.sessionId);
            setPendingDelete(null);
          }}
          onCancel={() => setPendingDelete(null)}
        />
      )}
    </div>
  );
};

export default DesktopSidebar;
