import React, { useEffect, useRef } from "react";
import type { SessionMetadata } from "wave-agent-sdk/types";
import type { SessionListStatus } from "../types";
import { formatSessionLabel } from "../utils/session";
import { LoadingRingIcon, StatusDotIcon } from "./HeaderIcons";

export interface SessionListProps {
  sessions: SessionMetadata[];
  currentSession?: SessionMetadata | null;
  onSessionSelect: (sessionId: string) => void;
  loading?: boolean;
  // When set, matching fragments of each session label are highlighted.
  highlightQuery?: string;
  /** Keyboard selection index (roving tabindex); the item at this index gets
   *  aria-selected + tabIndex 0. Managed by the popup's search input. */
  selectedIndex?: number;
  /** Render each session's project path under its label. Used where the list
   *  spans projects (desktop `/resume`), so two same-titled sessions from
   *  different directories are distinguishable. */
  showProject?: boolean;
  /** 「待确认 / 运行中」标记（远控 Web 页专用，见 ChatHeaderProps）。其余宿主不传，
   *  标记槽整体不渲染，行与从前一模一样。 */
  sessionStatus?: SessionListStatus;
}

/**
 * 会话行的状态标记。规则与桌面端侧栏一致（spec remote/remote-web.md「待确认只在它
 * 自己的对话里弹，对话状态在会话列表标出来」场景 5/6）：
 * - **当前那条**只标「运行中」——它自己的待确认请求已经作为卡片弹在它眼前，再标
 *   一次就是重复提醒；
 * - **其余会话**两种都标，优先级 **待确认 > 运行中**（一条只出一个标记，不叠两个）；
 * - 「已完成」不标：绿点是「完成但没看」，桌面端靠打开会话消掉，这一页没有等价
 *   的已读状态来源，宁可不标（场景 6）。
 * 没有标记时返回 null —— 调用方据此整块不渲染，宿主不传 `sessionStatus` 时行的
 * DOM 与从前完全一致。
 */
const sessionStatusMarker = (
  status: SessionListStatus,
  sessionId: string,
  isCurrent: boolean,
): React.ReactNode => {
  if (!isCurrent && status.waiting.includes(sessionId))
    return <StatusDotIcon color="#E6A23C" label="等待确认" size={16} />;
  if (status.running.includes(sessionId)) return <LoadingRingIcon size={16} />;
  return null;
};

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
  selectedIndex = 0,
  showProject = false,
  sessionStatus,
}) => {
  const selectedItemRef = useRef<HTMLLIElement>(null);

  // Keep the keyboard-selected item in view while moving with the arrows.
  useEffect(() => {
    const el = selectedItemRef.current;
    if (el && typeof el.scrollIntoView === "function") {
      el.scrollIntoView({ block: "nearest" });
    }
  }, [selectedIndex]);

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
        <ul className="session-list-items" role="listbox">
          {sessions.map((session, i) => {
            const isCurrent = session.id === currentSession?.id;
            const marker = sessionStatus
              ? sessionStatusMarker(sessionStatus, session.id, isCurrent)
              : null;
            return (
              <li
                key={session.id}
                ref={i === selectedIndex ? selectedItemRef : undefined}
                className={`session-list-item ${isCurrent ? "session-list-item--current" : ""} ${i === selectedIndex ? "session-list-item--selected" : ""}`}
                role="option"
                aria-selected={i === selectedIndex}
                tabIndex={i === selectedIndex ? 0 : -1}
                onClick={() => onSessionSelect(session.id)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    onSessionSelect(session.id);
                  }
                }}
                data-testid={`session-list-item-${session.id}`}
              >
                <div className="session-list-item-head">
                  <div className="session-list-item-title">
                    {highlightMatch(
                      formatSessionLabel(session),
                      highlightQuery,
                    )}
                  </div>
                  {/* Only rendered when there is something to show, so the row's
                      DOM is untouched for the hosts that pass no status. */}
                  {marker && (
                    <div
                      className="session-list-item-status"
                      data-testid={`session-list-status-${session.id}`}
                    >
                      {marker}
                    </div>
                  )}
                </div>
                {showProject && session.workdir && (
                  <div
                    className="session-list-item-project"
                    title={session.workdir}
                  >
                    {session.workdir}
                  </div>
                )}
                {/* Missing for a session with no messages yet (a live session the
                    remote page lists before its first turn) — omitted rather than
                    rendered as an invalid date. */}
                {session.lastActiveAt && (
                  <div className="session-list-item-time">
                    {new Date(session.lastActiveAt).toLocaleString()}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
};

export default SessionList;
