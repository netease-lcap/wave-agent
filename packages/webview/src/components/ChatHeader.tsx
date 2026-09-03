import React, { useRef, useState } from "react";
import { Tooltip } from "./Tooltip";
import {
  NewSessionIcon,
  HistoryIcon,
  MoreIcon,
  PanelCollapseIcon,
  PanelExpandIcon,
} from "./HeaderIcons";
import { SessionListPopup } from "./SessionListPopup";
import { MoreMenu } from "./MoreMenu";
import { getSessionTitle } from "../utils/session";
import type { ChatHeaderProps } from "../types";
import "../styles/ChatHeader.css";

export const ChatHeader: React.FC<ChatHeaderProps> = ({
  onNewSession,
  newSessionDisabled = false,
  messages,
  sessions,
  currentSession,
  onSessionSelect,
  sessionsLoading,
  onOpenSettings,
  onOpenEnterpriseConsole,
  onOpenHelpDocs,
  onLogin,
  onLogout,
  isAuthenticated,
  hideSessionButtons = false,
  hideMoreButton = false,
  panelToggle,
  leading,
  macTrafficSpacer = false,
  headerActions,
}) => {
  const [showSessionList, setShowSessionList] = useState(false);
  const [showMoreMenu, setShowMoreMenu] = useState(false);
  // Menu triggers; the popups return focus here on Escape / item activation.
  const moreBtnRef = useRef<HTMLButtonElement>(null);

  const title = getSessionTitle(currentSession, messages);

  return (
    <div className="chat-header" data-testid="chat-header">
      {/* macOS 隐藏标题栏 + 侧边栏收起：最左端让给系统红绿灯，该段为窗口
          拖拽区（spec「macOS 隐藏标题栏」场景 3）。 */}
      {macTrafficSpacer && (
        <div
          className="chat-header-mac-traffic"
          aria-hidden="true"
          data-testid="chat-header-mac-traffic"
        />
      )}
      {leading}
      <div className="header-title">{title}</div>
      <div className="header-buttons">
        {!hideSessionButtons && (
          <>
            <Tooltip text="新建对话" position="bottom">
              <button
                className="header-button"
                onClick={onNewSession}
                disabled={newSessionDisabled}
                data-testid="new-session-btn"
                aria-label="新建对话"
              >
                <NewSessionIcon />
              </button>
            </Tooltip>
            <Tooltip text="历史对话" position="bottom">
              <button
                className="header-button"
                onClick={() => setShowSessionList((prev) => !prev)}
                data-testid="history-btn"
                aria-label="历史对话"
              >
                <HistoryIcon />
              </button>
            </Tooltip>
          </>
        )}
        {!hideMoreButton && (
          <Tooltip text="更多" position="bottom">
            <button
              ref={moreBtnRef}
              className="header-button"
              onClick={() => setShowMoreMenu((prev) => !prev)}
              data-testid="more-btn"
              aria-label="更多"
              aria-haspopup="menu"
              aria-expanded={showMoreMenu}
            >
              <MoreIcon />
            </button>
          </Tooltip>
        )}
        {panelToggle && (
          <Tooltip
            text={panelToggle.expanded ? "收起面板" : "展开面板"}
            position="bottom"
          >
            <button
              className="header-button header-panel-toggle"
              onClick={panelToggle.onToggle}
              data-testid="panel-toggle-btn"
              aria-label={panelToggle.expanded ? "收起面板" : "展开面板"}
              aria-expanded={panelToggle.expanded}
            >
              {panelToggle.expanded ? (
                <PanelCollapseIcon />
              ) : (
                <PanelExpandIcon />
              )}
            </button>
          </Tooltip>
        )}
        {headerActions}
      </div>
      {showSessionList && (
        <SessionListPopup
          sessions={sessions}
          currentSession={currentSession}
          onSessionSelect={onSessionSelect}
          loading={sessionsLoading}
          onClose={() => setShowSessionList(false)}
        />
      )}
      {showMoreMenu && !hideMoreButton && (
        <MoreMenu
          onOpenSettings={onOpenSettings}
          onOpenEnterpriseConsole={onOpenEnterpriseConsole}
          onOpenHelpDocs={onOpenHelpDocs}
          onLogin={onLogin}
          onLogout={onLogout}
          isAuthenticated={isAuthenticated}
          onClose={() => setShowMoreMenu(false)}
          triggerRef={moreBtnRef}
        />
      )}
    </div>
  );
};
