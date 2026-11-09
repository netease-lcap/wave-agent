import React, { useState } from "react";
import {
  outlineGap,
  shouldShowOutline,
  type TranscriptOutlineItem,
} from "../utils/transcriptOutline";
import "../styles/TranscriptOutline.css";

export interface TranscriptOutlineProps {
  items: readonly TranscriptOutlineItem[];
  /** 当前这一轮（视口顶之上最近的那条用户消息）的 id。 */
  activeId?: string;
  /** 内容列的实际宽度，决定大纲显不显示。0 = 还没测到。 */
  columnWidth: number;
  /** 滚动容器的可视高度，决定刻度间距与垂直居中位置。 */
  viewportHeight: number;
  /** 内容列左侧的留白（列左边缘到滚动容器左边缘），决定大纲显不显示。 */
  columnInset: number;
  /** 点了某个刻度：把该消息落位（父组件的 scrollToMessage）。 */
  onJump: (id: string) => void;
}

/** 预览卡宽度上限。窄列时按列宽夹取，避免溢出内容区（spec 场景 5）。 */
const CARD_MAX_WIDTH_PX = 280;
const CARD_COLUMN_INSET_PX = 40;

/**
 * 内容区左边缘的竖排刻度大纲（spec `ui/transcript-outline.md`）。
 *
 * 它挂在滚动面上、内容列之外：刻度住在 800px 列左侧的留白里（对齐 Codex），
 * 而列自己 `overflow-x: clip`，住在列里的刻度一旦往左越过列的内边距就会被裁
 * 掉。因此**任何宽度下都不占用正文**；宽度不够时按 spec 场景 10 整体返回
 * null，而不是改成窄版形态。
 */
export function TranscriptOutline({
  items,
  activeId,
  columnWidth,
  columnInset,
  viewportHeight,
  onJump,
}: TranscriptOutlineProps) {
  const [hoveredId, setHoveredId] = useState<string | null>(null);

  if (!shouldShowOutline(columnWidth, columnInset, items.length)) return null;

  const cardMaxWidth =
    columnWidth > 0
      ? Math.max(
          160,
          Math.min(CARD_MAX_WIDTH_PX, columnWidth - CARD_COLUMN_INSET_PX),
        )
      : CARD_MAX_WIDTH_PX;

  return (
    <div
      className="outline-rail"
      data-testid="transcript-outline"
      role="presentation"
    >
      <div
        className="outline-ticks"
        role="navigation"
        aria-label="消息大纲"
        style={{
          // 刻度列垂直居中：上下各留 OUTLINE_VERTICAL_RESERVE_PX / 2，首/末
          // 刻度的预览卡因此不会溢出视口（见 transcriptOutline 的常量注释）。
          top: viewportHeight > 0 ? Math.round(viewportHeight / 2) : "50vh",
          gap: outlineGap(items.length, viewportHeight),
        }}
      >
        {items.map((item) => {
          const active = item.id === activeId;
          return (
            <button
              key={item.id}
              type="button"
              className={`outline-tick${active ? " outline-tick--active" : ""}`}
              data-testid="outline-tick"
              data-message-id={item.id}
              aria-current={active ? "true" : undefined}
              aria-label={item.question}
              onMouseEnter={() => setHoveredId(item.id)}
              onMouseLeave={() => setHoveredId(null)}
              onFocus={() => setHoveredId(item.id)}
              onBlur={() => setHoveredId(null)}
              onClick={() => onJump(item.id)}
            >
              {hoveredId === item.id && (
                <span
                  className="outline-card"
                  data-testid="outline-card"
                  style={{ maxWidth: cardMaxWidth }}
                >
                  <span className="outline-card-question">{item.question}</span>
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
