import React from 'react';
import type { SessionMetadata } from 'wave-agent-sdk';
import type { SessionSelectorProps } from '../types';
import '../styles/SessionSelector.css';

export const SessionSelector: React.FC<SessionSelectorProps> = ({
  sessions,
  currentSession,
  onSessionSelect,
  loading,
  disabled
}) => {
  const handleSessionChange = (event: React.ChangeEvent<HTMLSelectElement>) => {
    const sessionId = event.target.value;
    if (sessionId && sessionId !== currentSession?.id) {
      onSessionSelect(sessionId);
    }
  };

  const formatSessionLabel = (session: SessionMetadata): string => {
    // Use firstMessage content if available, limited to 30 characters
    if (session.firstMessage && session.firstMessage.trim()) {
      const content = session.firstMessage.trim();
      return content.length > 30 ? content.substring(0, 30) + '...' : content;
    }
    
    // Fallback to date/time format
    const date = new Date(session.lastActiveAt).toLocaleDateString();
    const time = new Date(session.lastActiveAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    return `${date} ${time}`;
  };

  // Check if currentSession exists in the sessions list
  const currentSessionExists = currentSession && sessions.some(session => session.id === currentSession.id);
  
  // If currentSession doesn't exist in sessions list, we need to render it as a temporary option
  const shouldRenderCurrentSession = currentSession && !currentSessionExists;

  return (
    <div className="session-selector" data-testid="session-selector">
      <select
        value={currentSession?.id || ''}
        onChange={handleSessionChange}
        disabled={disabled || loading}
        className="session-dropdown"
        data-testid="session-dropdown"
      >
        <option value="" disabled>
          {loading ? '加载会话...' : '选择会话'}
        </option>
        {shouldRenderCurrentSession && (
          <option key={currentSession.id} value={currentSession.id}>
            新会话
          </option>
        )}
        {sessions.map((session) => (
          <option key={session.id} value={session.id}>
            {formatSessionLabel(session)}
          </option>
        ))}
      </select>
    </div>
  );
};