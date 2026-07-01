import React from 'react';
import { Tooltip } from './Tooltip';
import { Message } from './Message';
import type { QueuedMessage, VsCodeApi } from '../types';
import '../styles/QueuedMessageList.css';

interface QueuedMessageListProps {
  queuedMessages: QueuedMessage[];
  isCollapsed: boolean;
  onToggleCollapse: () => void;
  onDelete: (index: number) => void;
  onSend: (index: number) => void;
  vscode: VsCodeApi;
}

export const QueuedMessageList: React.FC<QueuedMessageListProps> = ({
  queuedMessages,
  isCollapsed,
  onToggleCollapse,
  onDelete,
  onSend,
  vscode
}) => {
  if (queuedMessages.length === 0) {
    return null;
  }

  return (
    <div className={`queued-message-list-container ${isCollapsed ? 'collapsed' : ''}`} data-testid="queued-message-list">
      <Tooltip text={isCollapsed ? "展开消息队列" : "折叠消息队列"} position="top" className="queued-message-list-tooltip">
        <div className="queued-message-list-header" onClick={onToggleCollapse} aria-label={isCollapsed ? "展开消息队列" : "折叠消息队列"}>
          <div className="queued-message-list-title">
            <span className={`codicon codicon-chevron-${isCollapsed ? 'right' : 'down'}`}></span>
            消息队列
          </div>
          <div className="queued-count">
            {queuedMessages.length} 条消息
          </div>
        </div>
      </Tooltip>
      {!isCollapsed && (
        <div className="queued-items">
          {queuedMessages.map((qm, index) => (
            <div key={index} className="queued-item">
              <div className="queued-item-main">
                <div className="queued-item-content">
                  <Message 
                    message={{
                      id: `queued-${index}`,
                      role: 'user',
                      timestamp: new Date().toISOString(),
                      blocks: [
                        { type: 'text', content: (qm.type === 'bang' ? '!' : '') + (qm.content || qm.text || '') },
                        ...(qm.images || []).map(img => ({
                          type: 'image' as const,
                          imageUrls: [img.path || (img as Record<string, string>).data || '']
                        }))
                      ]
                    }}
                    isQueued={true}
                    vscode={vscode}
                  />
                </div>
                <div className="queued-item-actions">
                  {index === 0 && (
                    <Tooltip text="立即发送" position="top">
                      <button 
                        className="action-button send-now" 
                        onClick={(e) => {
                          e.stopPropagation();
                          onSend(index);
                        }}
                        aria-label="立即发送"
                      >
                        <i className="codicon codicon-play"></i>
                      </button>
                    </Tooltip>
                  )}
                  <Tooltip text="删除" position="top">
                    <button 
                      className="action-button delete-queued" 
                      onClick={(e) => {
                        e.stopPropagation();
                        onDelete(index);
                      }}
                      aria-label="删除"
                    >
                      <i className="codicon codicon-trash"></i>
                    </button>
                  </Tooltip>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
