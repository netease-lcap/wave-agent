import React, { useEffect, useMemo, useRef, useState } from 'react';
import type { SessionMetadata } from 'wave-agent-sdk';
import { formatSessionLabel } from '../utils/session';
import '../styles/SessionListPopup.css';

interface SessionListPopupProps {
  sessions: SessionMetadata[];
  currentSession?: SessionMetadata;
  onSessionSelect: (sessionId: string) => void;
  onClose: () => void;
  loading: boolean;
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
      </span>
    );
    cursor = matchIndex + lowerQuery.length;
    matchIndex = lowerText.indexOf(lowerQuery, cursor);
  }

  if (cursor < text.length) {
    fragments.push(text.substring(cursor));
  }

  return fragments;
};

export const SessionListPopup: React.FC<SessionListPopupProps> = ({
  sessions,
  currentSession,
  onSessionSelect,
  onClose,
  loading
}) => {
  const [query, setQuery] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const popupRef = useRef<HTMLDivElement>(null);

  // Focus search input on mount
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Click outside + Escape to close
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (popupRef.current && !popupRef.current.contains(event.target as Node)) {
        onClose();
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [onClose]);

  const filteredSessions = useMemo(() => {
    const trimmed = query.trim().toLowerCase();
    if (!trimmed) return sessions;
    return sessions.filter((session) =>
      formatSessionLabel(session).toLowerCase().includes(trimmed)
    );
  }, [sessions, query]);

  const handleSelect = (sessionId: string) => {
    onSessionSelect(sessionId);
    onClose();
  };

  return (
    <div ref={popupRef} className="session-list-popup" data-testid="session-list-popup">
      <input
        ref={inputRef}
        type="text"
        className="session-list-search"
        placeholder="搜索关键词"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      <div className="session-list-label">历史对话</div>
      <div className="session-list-results">
        {loading ? (
          <div className="session-list-loading">
            <span className="codicon codicon-loading codicon-modifier-spin"></span>
            正在加载...
          </div>
        ) : filteredSessions.length === 0 ? (
          <div className="session-list-empty">未找到匹配的历史记录</div>
        ) : (
          <ul className="session-list-items">
            {filteredSessions.map((session) => (
              <li
                key={session.id}
                className={`session-list-item ${session.id === currentSession?.id ? 'session-list-item--current' : ''}`}
                onClick={() => handleSelect(session.id)}
                data-testid={`session-list-item-${session.id}`}
              >
                <div className="session-list-item-title">
                  {highlightMatch(formatSessionLabel(session), query)}
                </div>
                <div className="session-list-item-time">
                  {new Date(session.lastActiveAt).toLocaleString()}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
};

export default SessionListPopup;
