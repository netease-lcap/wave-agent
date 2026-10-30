import React from "react";
import { Tooltip } from "./Tooltip";
import "../styles/Message.css";

/**
 * 消息上的那颗圆角小按钮（悬停时出现在消息右上角）。
 *
 * 存在的理由只有一个：消息上的动作按钮必须长得一样。回滚（用户消息）与
 * 「把本轮转到后台」（助手消息）是同一类动作——都不改消息内容、都作用于这一轮
 * ——所以它们走同一个组件而不是各写一段 markup：位置、底色、圆角、hover 显隐、
 * 单一 tooltip 全在这里，两处调用只给图标与文案（spec:
 * multi-agent/task-background-execution.md「前台工具后台化」场景 6）。
 */
export const MessageActionButton: React.FC<{
  /** codicon 名，不含 `codicon-` 前缀（如 `history`、`tasklist`）。 */
  icon: string;
  /** 唯一的可读文案：既是 tooltip，也是无障碍名称。 */
  label: string;
  onClick: () => void;
  /** 供测试定位；同一个页面上可能不止一颗。 */
  testId?: string;
}> = ({ icon, label, onClick, testId }) => (
  <div className="message-actions">
    <Tooltip text={label} position="bottom">
      <button
        className="message-action-btn"
        aria-label={label}
        data-testid={testId}
        onClick={onClick}
      >
        <i className={`codicon codicon-${icon}`}></i>
      </button>
    </Tooltip>
  </div>
);
