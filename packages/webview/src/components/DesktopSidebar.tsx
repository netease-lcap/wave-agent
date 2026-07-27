import React from 'react';
import '../styles/DesktopApp.css';

export interface DesktopSidebarProps {
  onNewSession: () => void;
  isStreaming: boolean;
  /** No workdir picked yet — starting a new session is not possible. */
  disabled: boolean;
}

/**
 * Left rail for the desktop host: app title + a single "新对话" button.
 * The session history list was removed for now (a redesign is planned);
 * the workdir selector lives inside the message input instead
 * (DesktopWorkdirSelector, new-session state only).
 */
export const DesktopSidebar: React.FC<DesktopSidebarProps> = ({
  onNewSession,
  isStreaming,
  disabled,
}) => {
  return (
    <div className="desktop-sidebar" data-testid="desktop-sidebar">
      <div className="desktop-sidebar-header">
        <span className="desktop-sidebar-title">Wave 代码智聊</span>
      </div>
      <button
        className="desktop-sidebar-new-chat"
        onClick={onNewSession}
        disabled={isStreaming || disabled}
        title="新对话"
        data-testid="desktop-new-session"
      >
        <span className="codicon codicon-add"></span>
        <span>新对话</span>
      </button>
    </div>
  );
};

export default DesktopSidebar;
