import React, { useEffect, useMemo, useRef, useState } from "react";
import type { SessionMetadata } from "wave-agent-sdk/types";
import type { SessionListStatus } from "../types";
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
  /** "dropdown" = anchored under the chat header (plugin hosts, triggered by the
   *  「历史对话」 button). "modal" = centered dialog with a scrim (desktop
   *  `/resume`, which has no header session buttons). Both share the search
   *  box, keyboard handling and list rendering below. */
  variant?: "dropdown" | "modal";
  /** Show each session's project path — the modal list spans every project on
   *  the host, so the path is what tells two same-titled sessions apart. */
  showProject?: boolean;
  /** Dialog label for the modal variant. */
  title?: string;
  /** 「待确认 / 运行中」标记（远控 Web 页专用，见 ChatHeaderProps）。 */
  sessionStatus?: SessionListStatus;
}

export const SessionListPopup: React.FC<SessionListPopupProps> = ({
  sessions,
  currentSession,
  onSessionSelect,
  onClose,
  loading,
  variant = "dropdown",
  showProject = false,
  title = "历史对话",
  sessionStatus,
}) => {
  const [query, setQuery] = useState("");
  // Keyboard selection index into the filtered list, remembered together with
  // the (query, list) it was made on: a new query or a fresh list starts over at
  // the first match by derivation, instead of resetting the index in an effect
  // (which painted the old index on the new list for a frame).
  const [nav, setNav] = useState<{
    index: number;
    query: string;
    sessions: SessionMetadata[];
  } | null>(null);
  const selectedIndex =
    nav && nav.query === query && nav.sessions === sessions ? nav.index : 0;
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

  const handleSelect = (sessionId: string) => {
    onSessionSelect(sessionId);
    onClose();
  };

  const handleSearchKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (filteredSessions.length > 0) {
        setNav({
          index: Math.min(selectedIndex + 1, filteredSessions.length - 1),
          query,
          sessions,
        });
      }
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setNav({ index: Math.max(selectedIndex - 1, 0), query, sessions });
    } else if (e.key === "Enter") {
      e.preventDefault();
      const session = filteredSessions[selectedIndex];
      if (session) handleSelect(session.id);
    }
  };

  const isModal = variant === "modal";

  return (
    <>
      {isModal && (
        <div className="session-list-popup-scrim" data-testid="resume-scrim" />
      )}
      <div
        ref={popupRef}
        className={`session-list-popup${
          isModal ? " session-list-popup--modal" : ""
        }`}
        role={isModal ? "dialog" : undefined}
        aria-modal={isModal || undefined}
        aria-label={isModal ? title : undefined}
        data-testid={isModal ? "resume-session-popup" : "session-list-popup"}
      >
        <input
          ref={inputRef}
          type="text"
          className="session-list-search"
          placeholder="搜索关键词"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            // 换关键词先把「上一份结果上的选中」丢掉（派生值随即回到第一条）。
            setNav(null);
          }}
          onKeyDown={handleSearchKeyDown}
        />
        <div className="session-list-label">{title}</div>
        <SessionList
          sessions={filteredSessions}
          currentSession={currentSession}
          onSessionSelect={handleSelect}
          loading={loading}
          highlightQuery={query}
          selectedIndex={selectedIndex}
          showProject={showProject}
          sessionStatus={sessionStatus}
        />
      </div>
    </>
  );
};

export default SessionListPopup;
