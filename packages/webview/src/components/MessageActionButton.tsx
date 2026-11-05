import React from "react";
import { Tooltip } from "./Tooltip";
import "../styles/Message.css";

/**
 * 消息右上角动作组里的一颗圆角小按钮（悬停消息时整组出现）。
 *
 * 存在的理由只有一个：消息上的动作按钮必须长得一样。回滚（用户消息）、复制与
 * 「把本轮转到后台」（助手消息）是同一类动作——都不改消息内容、都作用于这一轮
 * ——所以它们走同一个组件而不是各写一段 markup：底色、圆角、tooltip、单一可读
 * 文案全在这里，调用处只给图标与文案（spec: multi-agent/task-background-execution.md
 * 「前台工具后台化」场景 6、ui/message-rendering-system.md「助手消息的复制按钮」）。
 *
 * 只出按钮、不出容器：一组按钮共用一个 `.message-actions` 容器（见 Message.tsx），
 * 容器负责钉在右上角与 hover 显隐——同一条消息上可能同时挂两颗（复制 + 转后台），
 * 各渲染一个绝对定位容器会叠在一起。
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
);
