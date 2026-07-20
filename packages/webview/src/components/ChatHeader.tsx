import React, { useState } from 'react';
import { Tooltip } from './Tooltip';
import { NewSessionIcon, HistoryIcon, MoreIcon } from './HeaderIcons';
import { SessionListPopup } from './SessionListPopup';
import { MoreMenu } from './MoreMenu';
import { formatSessionLabel } from '../utils/session';
import type { ChatHeaderProps } from '../types';
import '../styles/ChatHeader.css';

export const ChatHeader: React.FC<ChatHeaderProps> = ({
  onClearChat,
  isStreaming,
  sessions,
  currentSession,
  onSessionSelect,
  sessionsLoading,
  onOpenSettings,
  onOpenEnterpriseConsole,
  onLogout
}) => {
  const [showSessionList, setShowSessionList] = useState(false);
  const [showMoreMenu, setShowMoreMenu] = useState(false);

  const title = currentSession ? formatSessionLabel(currentSession) : '新会话';

  return (
    <div className="chat-header" data-testid="chat-header">
      <div className="header-title">{title}</div>
      <div className="header-buttons">
        <Tooltip text="新建会话" position="left">
          <button
            className="header-button"
            onClick={onClearChat}
            disabled={isStreaming}
            data-testid="clear-chat-btn"
            aria-label="新建会话"
          >
            <NewSessionIcon />
          </button>
        </Tooltip>
        <Tooltip text="历史对话" position="left">
          <button
            className="header-button"
            onClick={() => setShowSessionList((prev) => !prev)}
            data-testid="history-btn"
            aria-label="历史对话"
          >
            <HistoryIcon />
          </button>
        </Tooltip>
        <Tooltip text="更多" position="left">
          <button
            className="header-button"
            onClick={() => setShowMoreMenu((prev) => !prev)}
            data-testid="more-btn"
            aria-label="更多"
          >
            <MoreIcon />
          </button>
        </Tooltip>
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
      {showMoreMenu && (
        <MoreMenu
          onOpenSettings={onOpenSettings}
          onOpenEnterpriseConsole={onOpenEnterpriseConsole}
          onLogout={onLogout}
          onClose={() => setShowMoreMenu(false)}
        />
      )}
    </div>
  );
};
