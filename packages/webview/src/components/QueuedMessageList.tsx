import React, { useRef, useState, useEffect } from "react";
import { Tooltip } from "./Tooltip";
import {
  QueueChevronIcon,
  QueueEditIcon,
  QueueSendIcon,
  QueueTrashIcon,
} from "./HeaderIcons";
import type { QueuedMessageListProps } from "../types";
import { isDesktopHost } from "../utils/platform";
import "../styles/QueuedMessageList.css";

export const QueuedMessageList: React.FC<QueuedMessageListProps> = ({
  queuedMessages,
  isCollapsed,
  onToggleCollapse,
  onEdit,
  onSend,
  onDelete,
  editingQueuedId,
}) => {
  const listRef = useRef<HTMLDivElement>(null);
  const [showScrim, setShowScrim] = useState(false);
  // 指针是否停在操作按钮组上：用于暂时压掉「整条 hover 显示完整文案」的那条提示，
  // 否则悬停按钮会同时冒出文案提示 + 按钮提示两条（设计师 0917：hover 要有提示说明
  // 这个按钮是做什么的）。仅桌面端参与（IDE 宿主不加按钮提示）。
  const [actionsHovered, setActionsHovered] = useState(false);
  const desktopHost = isDesktopHost();

  /** 桌面端给图标按钮包一层 hover 提示；IDE 宿主原样返回（只有 aria-label）。 */
  const withActionTooltip = (label: string, node: React.ReactElement) =>
    desktopHost ? (
      <Tooltip text={label} position="top">
        {node}
      </Tooltip>
    ) : (
      node
    );

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
      setShowScrim(
        el.scrollHeight > el.clientHeight &&
          el.scrollTop + el.clientHeight < el.scrollHeight - 1,
      );
    };
    update();
    el.addEventListener("scroll", update);
    return () => el.removeEventListener("scroll", update);
  }, [isCollapsed, queuedMessages]);

  if (queuedMessages.length === 0) {
    return null;
  }

  return (
    <div
      className="queued-message-list-container"
      data-testid="queued-message-list"
    >
      <div
        className="queued-message-list-header"
        onClick={onToggleCollapse}
        aria-label={isCollapsed ? "展开消息队列" : "折叠消息队列"}
      >
        <QueueChevronIcon
          className={`queued-chevron${isCollapsed ? "" : " expanded"}`}
        />
        <span className="queued-message-list-title">
          消息队列 ({queuedMessages.length})
        </span>
      </div>

      <div
        className={`queued-items${isCollapsed ? "" : " expanded"}`}
        ref={listRef}
      >
        {items.map((qm, index) => {
          const id = qm.id ?? String(index);
          const fullText =
            (qm.type === "bang" ? "!" : "") + (qm.content || qm.text || "");
          const isEditing =
            editingQueuedId != null && editingQueuedId === qm.id;
          return (
            <Tooltip
              key={id}
              text={fullText}
              position="top"
              // 指针在操作按钮组上时，用 class 把「整条文案提示」压掉（CSS 只隐藏气泡）。
              // 不要改用 Tooltip 的 disabled：那会把外层 tooltip-container span 卸载/重建，
              // 行子树连按钮一起被 React 重建 → 光标下的元素被替换 → mouseleave/mouseenter
              // 自激循环，整条下拉抖动（设计师 0917 报的）。
              className={`queued-item-tooltip${actionsHovered ? " tooltip-suppressed" : ""}`}
            >
              <div
                className={`queued-item${isEditing ? " editing" : ""}`}
                data-testid={`queued-item-${id}`}
              >
                <span className="queued-item-text">{fullText}</span>
                <div
                  className="queued-item-actions"
                  onMouseEnter={
                    desktopHost ? () => setActionsHovered(true) : undefined
                  }
                  onMouseLeave={
                    desktopHost ? () => setActionsHovered(false) : undefined
                  }
                >
                  {withActionTooltip(
                    "编辑",
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
                    </button>,
                  )}
                  {withActionTooltip(
                    "立即发送",
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
                    </button>,
                  )}
                  {withActionTooltip(
                    "删除",
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
                    </button>,
                  )}
                </div>
              </div>
            </Tooltip>
          );
        })}
      </div>
      {showScrim && (
        <div className="queued-items-scrim" aria-hidden="true"></div>
      )}
    </div>
  );
};
