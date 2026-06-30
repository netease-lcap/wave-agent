import React from 'react';
import { SessionSelector } from './SessionSelector';
import { Tooltip } from './Tooltip';
import type { ChatHeaderProps } from '../types';
import '../styles/ChatHeader.css';

export const ChatHeader: React.FC<ChatHeaderProps> = ({
  onClearChat,
  isStreaming,
  sessions,
  currentSession,
  onSessionSelect,
  sessionsLoading
}) => {
  return (
    <div className="chat-header" data-testid="chat-header">
      <div className="header-left">
        <SessionSelector
          sessions={sessions}
          currentSession={currentSession}
          onSessionSelect={onSessionSelect}
          loading={sessionsLoading}
          disabled={isStreaming}
        />
      </div>
      <div className="header-buttons">
        <Tooltip text="清除聊天" position="bottom-left">
          <button
            className="header-button"
            onClick={onClearChat}
            disabled={isStreaming}
            data-testid="clear-chat-btn"
            aria-label="清除聊天"
          >
            <span className="codicon codicon-clear-all"></span>
          </button>
        </Tooltip>
      </div>
    </div>
  );
};