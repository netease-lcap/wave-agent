import React, { useEffect, useMemo, useRef, useState } from "react";
import type { SessionMetadata } from "wave-agent-sdk";
import { useClickOutside } from "../utils/useClickOutside";
import { formatSessionLabel } from "../utils/session";
import { SessionList } from "./SessionList";
import "../styles/SessionListPopup.css";

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
  loading,
}) => {
  const [query, setQuery] = useState("");
  // Keyboard selection index into the filtered list; 0 = first item.
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const popupRef = useRef<HTMLDivElement>(null);

  // Focus search input on mount
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Click outside + Escape to close
  useClickOutside({
    refs: [popupRef],
    onClickOutside: onClose,
  });
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  const filteredSessions = useMemo(() => {
    const trimmed = query.trim().toLowerCase();
    if (!trimmed) return sessions;
    return sessions.filter((session) =>
      formatSessionLabel(session).toLowerCase().includes(trimmed),
    );
  }, [sessions, query]);

  // A new query or session list resets the keyboard selection to the first
  // match, and the index is clamped so Enter always picks a real item.
  useEffect(() => {
    setSelectedIndex(0);
  }, [query, sessions]);

  const handleSelect = (sessionId: string) => {
    onSessionSelect(sessionId);
    onClose();
  };

  const handleSearchKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (filteredSessions.length > 0) {
        setSelectedIndex((i) => Math.min(i + 1, filteredSessions.length - 1));
      }
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelectedIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const session = filteredSessions[selectedIndex];
      if (session) handleSelect(session.id);
    }
  };

  return (
    <div
      ref={popupRef}
      className="session-list-popup"
      data-testid="session-list-popup"
    >
      <input
        ref={inputRef}
        type="text"
        className="session-list-search"
        placeholder="搜索关键词"
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setSelectedIndex(0);
        }}
        onKeyDown={handleSearchKeyDown}
      />
      <div className="session-list-label">历史对话</div>
      <SessionList
        sessions={filteredSessions}
        currentSession={currentSession}
        onSessionSelect={handleSelect}
        loading={loading}
        highlightQuery={query}
        selectedIndex={selectedIndex}
      />
    </div>
  );
};

export default SessionListPopup;
