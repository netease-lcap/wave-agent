import React, { type ReactNode } from "react";
import type { FocusFoldItem } from "../utils/focusItems";
import { QueueChevronIcon } from "./HeaderIcons";
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
  // 进行态只有两种文案：在跑具体工具，或者「没有工具在跑」（模型推理、两次
  // 工具之间）的兜底 —— 后者就是桌面端 focus 行的 Thinking… 口径。兜底只有
  // 一条，避免再出一种「进行中…」让同一轮多跳一次文案。
  if (item.live) {
    return item.runningToolName
      ? "正在执行 " + item.runningToolName + "…"
      : "正在思考…";
  }
  if (item.callCount > 0) return item.callCount + " 次工具调用";
  if (item.hasReasoning) return "思考过程";
  return "过程";
}

function foldMeta(item: FocusFoldItem): string | null {
  // 进行态不出任何计数：轮内每多一次调用、每多一个失败，数字就变一次，
  // 文案跟着跳（spec 场景 3）。计数只在轮结束后的结算文案里出现。
  if (item.live) return null;
  if (item.errorCount > 0) return item.errorCount + " 个失败";
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
  const label = foldLabel(item);
  return (
    <div
      className={
        "focus-fold" +
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
        {/* 进行态的扫光要在按钮里再画一份同样的文案。那一份是纯视觉替身：
            `aria-hidden` 让读屏只读一遍摘要 —— `::after { content: attr(…) }`
            做不到这一点，伪元素的内容会计入按钮的 accessible name（摘要会被
            读两遍）。文案仍只在这里算一次、两处共用。 */}
        <span className="focus-fold-label">
          {label}
          {item.live && (
            <span className="focus-fold-sweep" aria-hidden="true">
              {label}
            </span>
          )}
        </span>
        {meta && <span className="focus-fold-meta">{meta}</span>}
        {/* 与思考块 / 压缩块同一颗折叠图标（QueueChevronIcon，16px 盒）。
            排在文案之后，与 CC 桌面端一致：它的折叠箭头是内容之后的一个
            独立 shrink-0 小按钮（desktop 6.28899.6 ion-dist.asar
            assets/v1/shared-9-BGHwpAny.js 的 mF / gF），不做行尾对齐。所以
            文案在轮内换（正在思考… ↔ 正在执行 Bash…）时箭头会跟着挪一点 ——
            与 CC 同样接受这点，不为它另加钉死规则。 */}
        <QueueChevronIcon
          className={`focus-fold-chevron${expanded ? " expanded" : ""}`}
        />
      </button>
      {expanded && (
        <div className="focus-fold-body" data-testid="focus-fold-body">
          {item.messages.map((message, index) => renderMessage(message, index))}
        </div>
      )}
    </div>
  );
};
