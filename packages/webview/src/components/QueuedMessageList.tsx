import React, { useRef, useState, useEffect } from 'react';
import { Tooltip } from './Tooltip';
import { QueueChevronIcon, QueueEditIcon, QueueSendIcon, QueueTrashIcon } from './HeaderIcons';
import type { QueuedMessageListProps } from '../types';
import '../styles/QueuedMessageList.css';

export const QueuedMessageList: React.FC<QueuedMessageListProps> = ({
  queuedMessages,
  isCollapsed,
  onToggleCollapse,
  onEdit,
  onSend,
  onDelete,
  editingQueuedId
}) => {
  const listRef = useRef<HTMLDivElement>(null);
  const [showScrim, setShowScrim] = useState(false);

  const items = isCollapsed ? queuedMessages.slice(0, 1) : queuedMessages;

  // Show bottom scrim only when expanded and the list overflows / can scroll.
  useEffect(() => {
    if (isCollapsed) {
      setShowScrim(false);
      return;
    }
    const el = listRef.current;
    if (!el) return;
    const update = () => {
      setShowScrim(el.scrollHeight > el.clientHeight && el.scrollTop + el.clientHeight < el.scrollHeight - 1);
    };
    update();
    el.addEventListener('scroll', update);
    return () => el.removeEventListener('scroll', update);
  }, [isCollapsed, queuedMessages]);

  if (queuedMessages.length === 0) {
    return null;
  }

  return (
    <div className="queued-message-list-container" data-testid="queued-message-list">
      <div
        className="queued-message-list-header"
        onClick={onToggleCollapse}
        aria-label={isCollapsed ? '展开消息队列' : '折叠消息队列'}
      >
        <QueueChevronIcon className={`queued-chevron${isCollapsed ? '' : ' expanded'}`} />
        <span className="queued-message-list-title">消息队列 ({queuedMessages.length})</span>
      </div>

      <div className={`queued-items${isCollapsed ? '' : ' expanded'}`} ref={listRef}>
        {items.map((qm, index) => {
          const id = qm.id ?? String(index);
          const fullText = (qm.type === 'bang' ? '!' : '') + (qm.content || qm.text || '');
          const isEditing = editingQueuedId != null && editingQueuedId === qm.id;
          return (
            <Tooltip key={id} text={fullText} position="top" className="queued-item-tooltip">
              <div
                className={`queued-item${isEditing ? ' editing' : ''}`}
                data-testid={`queued-item-${id}`}
              >
                <span className="queued-item-text">{fullText}</span>
                <div className="queued-item-actions">
                  <button
                    className="queued-action-button"
                    onClick={(e) => {
                      e.stopPropagation();
                      if (qm.id != null) onEdit(qm.id);
                    }}
                    aria-label="编辑"
                    data-testid={`queued-edit-${id}`}
                  >
                    <QueueEditIcon />
                  </button>
                  <button
                    className="queued-action-button"
                    onClick={(e) => {
                      e.stopPropagation();
                      if (qm.id != null) onSend(qm.id);
                    }}
                    aria-label="立即发送"
                    data-testid={`queued-send-${id}`}
                  >
                    <QueueSendIcon />
                  </button>
                  <button
                    className="queued-action-button"
                    onClick={(e) => {
                      e.stopPropagation();
                      if (qm.id != null) onDelete(qm.id);
                    }}
                    aria-label="删除"
                    data-testid={`queued-delete-${id}`}
                  >
                    <QueueTrashIcon />
                  </button>
                </div>
              </div>
            </Tooltip>
          );
        })}
      </div>
      {showScrim && <div className="queued-items-scrim" aria-hidden="true"></div>}
    </div>
  );
};
