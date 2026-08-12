import React from "react";
import type { SessionMetadata } from "wave-agent-sdk";
import { formatSessionLabel } from "../utils/session";

export interface SessionListProps {
  sessions: SessionMetadata[];
  currentSession?: SessionMetadata | null;
  onSessionSelect: (sessionId: string) => void;
  loading?: boolean;
  // When set, matching fragments of each session label are highlighted.
  highlightQuery?: string;
}

/**
 * Split text into fragments, marking case-insensitive matches of query so they
 * can be rendered as highlighted spans. Avoids dangerouslySetInnerHTML.
 */
const highlightMatch = (text: string, query: string): React.ReactNode => {
  const trimmed = query.trim();
  if (!trimmed) return text;

  const lowerText = text.toLowerCase();
  const lowerQuery = trimmed.toLowerCase();
  const fragments: React.ReactNode[] = [];

  let cursor = 0;
  let matchIndex = lowerText.indexOf(lowerQuery, cursor);
  let key = 0;

  while (matchIndex !== -1) {
    if (matchIndex > cursor) {
      fragments.push(text.substring(cursor, matchIndex));
    }
    fragments.push(
      <span key={key++} className="session-list-highlight">
        {text.substring(matchIndex, matchIndex + lowerQuery.length)}
      </span>,
    );
    cursor = matchIndex + lowerQuery.length;
    matchIndex = lowerText.indexOf(lowerQuery, cursor);
  }

  if (cursor < text.length) {
    fragments.push(text.substring(cursor));
  }

  return fragments;
};

/**
 * Session list body shared by SessionListPopup (VS Code header popup).
 * Rendering only — search/filter state is owned by the parent.
 */
export const SessionList: React.FC<SessionListProps> = ({
  sessions,
  currentSession,
  onSessionSelect,
  loading = false,
  highlightQuery = "",
}) => {
  return (
    <div className="session-list-results">
      {loading ? (
        <div className="session-list-loading">
          <span className="codicon codicon-loading codicon-modifier-spin"></span>
          正在加载...
        </div>
      ) : sessions.length === 0 ? (
        <div className="session-list-empty">未找到匹配的历史记录</div>
      ) : (
        <ul className="session-list-items">
          {sessions.map((session) => (
            <li
              key={session.id}
              className={`session-list-item ${session.id === currentSession?.id ? "session-list-item--current" : ""}`}
              onClick={() => onSessionSelect(session.id)}
              data-testid={`session-list-item-${session.id}`}
            >
              <div className="session-list-item-title">
                {highlightMatch(formatSessionLabel(session), highlightQuery)}
              </div>
              <div className="session-list-item-time">
                {new Date(session.lastActiveAt).toLocaleString()}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};

export default SessionList;
