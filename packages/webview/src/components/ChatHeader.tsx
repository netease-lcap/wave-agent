import React, { useRef, useState } from "react";
import { Tooltip } from "./Tooltip";
import { NewSessionIcon, HistoryIcon, MoreIcon } from "./HeaderIcons";
import { SessionListPopup } from "./SessionListPopup";
import { MoreMenu } from "./MoreMenu";
import { PanelToggleMenu } from "./PanelToggleMenu";
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
  showLoginButton = false,
  panelToggle,
  leading,
}) => {
  const [showSessionList, setShowSessionList] = useState(false);
  const [showMoreMenu, setShowMoreMenu] = useState(false);
  const [showPanelMenu, setShowPanelMenu] = useState(false);
  // Menu triggers; the popups return focus here on Escape / item activation.
  const moreBtnRef = useRef<HTMLButtonElement>(null);
  const panelBtnRef = useRef<HTMLButtonElement>(null);

  const title = getSessionTitle(currentSession, messages);

  return (
    <div className="chat-header" data-testid="chat-header">
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
        {showLoginButton && (
          <button
            type="button"
            className="header-login-button"
            data-testid="header-login-btn"
            aria-label="登录"
            onClick={onLogin}
          >
            登 录
          </button>
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
          <Tooltip text="面板" position="bottom">
            <button
              ref={panelBtnRef}
              className="header-button header-panel-toggle"
              onClick={() => setShowPanelMenu((prev) => !prev)}
              data-testid="panel-toggle-btn"
              aria-label="面板"
              aria-haspopup="menu"
              aria-expanded={showPanelMenu}
            >
              <i className="codicon codicon-layout-sidebar-right" />
              <i className="codicon codicon-chevron-down header-panel-toggle-caret" />
            </button>
          </Tooltip>
        )}
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
      {showPanelMenu && panelToggle && (
        <PanelToggleMenu
          checked={panelToggle.checked}
          onToggle={panelToggle.onToggle}
          disabled={panelToggle.disabled}
          onClose={() => setShowPanelMenu(false)}
          triggerRef={panelBtnRef}
        />
      )}
    </div>
  );
};
