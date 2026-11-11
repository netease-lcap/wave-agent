import React, { useState, useEffect } from "react";
import { QueueChevronIcon } from "./HeaderIcons";
import { streamingTail } from "../utils/streamingText";
import type { ReasoningBlock } from "../types";

interface ReasoningBlockViewProps {
  block: ReasoningBlock;
  renderContent: (content: string) => React.ReactNode;
}

export const ReasoningBlockView: React.FC<ReasoningBlockViewProps> = ({
  block,
  renderContent,
}) => {
  // Always starts collapsed — streaming or loaded from history. While reasoning
  // is being generated the block is a single fixed-height line (title + tail,
  // no expand affordance), so growing content never changes the row height and
  // never pushes the rows above it (tools with clickable paths) around. The
  // user's expand/collapse choice only exists once the block has finished, and
  // it is never overridden afterwards.
  const [collapsed, setCollapsed] = useState(true);

  const streaming = block.stage === "streaming";
  const inProgress = streaming && typeof block.startTime === "number";
  const [now, setNow] = useState(() => Date.now());

  // While reasoning is in progress, tick every second to grow the elapsed counter.
  useEffect(() => {
    if (!inProgress) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [inProgress]);

  // Defense in depth: Message.renderBlock already skips empty reasoning
  // blocks before calling this component (the gateway occasionally sends a
  // reasoning_content of just "\n" — the model reports reasoning_tokens but
  // gives no real text). Keeping the same guard here means a future call
  // site that forgets that check still can't render an empty collapsed
  // shell, matching the CLI's ReasoningDisplay.tsx. Placed after every hook
  // so the early return never changes hook call order between renders.
  if (!block.content || !block.content.trim()) {
    return null;
  }

  let title = "思考";
  if (inProgress) {
    const seconds = Math.max(
      0,
      Math.floor((now - (block.startTime as number)) / 1000),
    );
    title = `思考中 ${seconds}s`;
  } else if (
    block.stage === "end" &&
    typeof block.startTime === "number" &&
    typeof block.endTime === "number" &&
    block.endTime >= block.startTime
  ) {
    const seconds = Math.round((block.endTime - block.startTime) / 1000);
    if (seconds > 0) {
      title = `思考 (用时 ${seconds}s)`;
    }
  }

  // Same tail shape as tool blocks' compactParams (last 30 chars, newlines
  // flattened). It exists only while streaming: once the block ends the line
  // shrinks back to title + chevron at the same fixed height.
  const tail = streaming ? streamingTail(block.content) : "";

  const header = (
    <>
      <span className="reasoning-dot" />
      <span className="reasoning-title">{title}</span>
      {tail ? <span className="reasoning-tail">{tail}</span> : null}
      {!streaming && (
        <QueueChevronIcon
          className={`reasoning-chevron${collapsed ? "" : " expanded"}`}
        />
      )}
    </>
  );

  return (
    <div className="reasoning-block">
      {/* Streaming header is inert on purpose: no chevron, not a button, no
          aria-expanded. Only a finished block is togglable (F-11 / WCAG
          2.1.1 / 4.1.2: a button gets Enter/Space for free and exposes
          aria-expanded; Message.css resets its UA styling so the
          appearance matches the original div). */}
      {streaming ? (
        <div className="reasoning-header reasoning-header--static">
          {header}
        </div>
      ) : (
        <button
          type="button"
          className="reasoning-header"
          aria-expanded={!collapsed}
          onClick={() => setCollapsed((c) => !c)}
        >
          {header}
        </button>
      )}
      {!collapsed && (
        <div className="reasoning-content">
          {renderContent(block.content || "")}
        </div>
      )}
    </div>
  );
};
