import React, { type ReactNode } from "react";
import type { FocusFoldItem } from "../utils/focusItems";
import { TOOL_STATUS_COLORS } from "../utils/statusColors";
import type { Message } from "../types";
import "../styles/FocusFoldRow.css";

export interface FocusFoldRowProps {
  item: FocusFoldItem;
  expanded: boolean;
  onToggle: () => void;
  /** 折叠卡内的消息渲染。由 MessageList 传入，复用行渲染的一切上下文。 */
  renderMessage: (message: Message, indexInFold: number) => ReactNode;
}

function foldLabel(item: FocusFoldItem): string {
  if (item.live) {
    if (item.runningToolName) return "正在执行 " + item.runningToolName + "…";
    if (item.callCount > 0 || item.hasReasoning) return "正在思考…";
    return "进行中…";
  }
  if (item.callCount > 0) return item.callCount + " 次工具调用";
  if (item.hasReasoning) return "思考过程";
  return "过程";
}

function foldMeta(item: FocusFoldItem): string | null {
  if (item.errorCount > 0) return item.errorCount + " 个失败";
  if (item.live && item.callCount > 0) return "已 " + item.callCount + " 次";
  return null;
}

/**
 * Focus 视图里「一轮」折叠成的那一行。
 *
 * 收起时只是卡头；展开后把这一轮的消息原样交给 `renderMessage`（即 <Message>），
 * 所以卡内不做任何渲染逻辑的复制 —— 折叠单位是整条消息，展开态天然复用现有行。
 */
export const FocusFoldRow: React.FC<FocusFoldRowProps> = ({
  item,
  expanded,
  onToggle,
  renderMessage,
}) => {
  const meta = foldMeta(item);
  // 圆点与时间线同族：跑完了绿、有失败红、还在跑蓝（与工具/文本块的状态色同源），
  // 这样「一张卡 + 卡外答复」连起来是一条同色的时间线，而不是一颗灰点挂在绿点上方。
  const dotColor =
    item.errorCount > 0
      ? TOOL_STATUS_COLORS.error
      : item.live
        ? TOOL_STATUS_COLORS.running
        : TOOL_STATUS_COLORS.success;
  return (
    <div
      style={{ ["--dot-color" as string]: dotColor }}
      className={
        "focus-fold" +
        (expanded ? " is-open" : "") +
        (item.live ? " is-live" : "") +
        (item.errorCount > 0 ? " has-error" : "")
      }
      data-testid="focus-fold"
      data-fold-key={item.key}
    >
      <button
        type="button"
        className="focus-fold-head"
        aria-expanded={expanded}
        data-testid="focus-fold-head"
        onClick={onToggle}
      >
        <span className="focus-fold-dot" aria-hidden="true" />
        <span className="focus-fold-label">{foldLabel(item)}</span>
        {meta && <span className="focus-fold-meta">{meta}</span>}
        <span className="focus-fold-chevron" aria-hidden="true" />
      </button>
      {expanded && (
        <div className="focus-fold-body" data-testid="focus-fold-body">
          {item.messages.map((message, index) => renderMessage(message, index))}
        </div>
      )}
    </div>
  );
};
