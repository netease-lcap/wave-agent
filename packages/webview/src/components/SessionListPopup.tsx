import React, { useEffect, useMemo, useRef, useState } from 'react';
import type { SessionMetadata } from 'wave-agent-sdk';
import { formatSessionLabel } from '../utils/session';
import { SessionList } from './SessionList';
import '../styles/SessionListPopup.css';

interface SessionListPopupProps {
  sessions: SessionMetadata[];
  currentSession?: SessionMetadata;
  onSessionSelect: (sessionId: string) => void;
  onClose: () => void;
  loading: boolean;
}

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
      <SessionList
        sessions={filteredSessions}
        currentSession={currentSession}
        onSessionSelect={handleSelect}
        loading={loading}
        highlightQuery={query}
      />
    </div>
  );
};

export default SessionListPopup;
