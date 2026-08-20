import React, { useState, useRef, useEffect, useCallback } from "react";
import { QueueChevronIcon } from "./HeaderIcons";
import type { ReasoningBlock } from "../types";

// 思考块最短展示时长：推理结束时若展示不足该时长，保持展开至满时长再自动收起，
// 避免"思考过程很短 → 展开又立刻收起"的闪烁（见 specs/core/stream-content-updates.md）。
const MIN_EXPANDED_MS = 1000;
// 展开/收起高度过渡时长，与 .reasoning-collapse 的 transition-duration 保持一致。
const COLLAPSE_TRANSITION_MS = 200;

interface ReasoningBlockViewProps {
  block: ReasoningBlock;
  renderContent: (content: string) => React.ReactNode;
}

export const ReasoningBlockView: React.FC<ReasoningBlockViewProps> = ({
  block,
  renderContent,
}) => {
  // Reasoning that is already finished on mount (e.g. loaded from history) starts
  // collapsed; an in-progress block starts expanded and auto-collapses on finish.
  const [collapsed, setCollapsed] = useState(block.stage === "end");
  // Content stays mounted while visible and during the collapse transition, then
  // unmounts so collapsed blocks don't keep rendered markdown in the DOM.
  const [contentMounted, setContentMounted] = useState(block.stage !== "end");
  const prevStageRef = useRef(block.stage);
  // When the block last became expanded (mount or manual expand). Used to enforce
  // the minimum display time before auto-collapse.
  const expandedAtRef = useRef(Date.now());
  const autoCollapseTimerRef = useRef<number | null>(null);
  const unmountTimerRef = useRef<number | null>(null);

  const clearTimer = useCallback(
    (ref: React.MutableRefObject<number | null>) => {
      if (ref.current !== null) {
        clearTimeout(ref.current);
        ref.current = null;
      }
    },
    [],
  );

  // 收起：1fr → 0fr 过渡（内容仍在 DOM），过渡结束后卸载内容。
  const collapse = useCallback(() => {
    clearTimer(autoCollapseTimerRef);
    setCollapsed(true);
    if (contentMounted) {
      clearTimer(unmountTimerRef);
      unmountTimerRef.current = window.setTimeout(() => {
        setContentMounted(false);
      }, COLLAPSE_TRANSITION_MS);
    } else {
      setContentMounted(false);
    }
  }, [clearTimer, contentMounted]);

  // 展开：先以 0fr 挂载内容，下一帧切 1fr 播放展开过渡。
  const expand = useCallback(() => {
    clearTimer(autoCollapseTimerRef);
    clearTimer(unmountTimerRef);
    expandedAtRef.current = Date.now();
    setCollapsed(true);
    setContentMounted(true);
    requestAnimationFrame(() => setCollapsed(false));
  }, [clearTimer]);

  // Auto-collapse once when reasoning finishes (stage transitions from non-'end' to 'end').
  // 展示不足最短展示时长时，延迟到满时长再收起；已满则立即（平滑）收起。
  useEffect(() => {
    if (prevStageRef.current !== "end" && block.stage === "end") {
      prevStageRef.current = "end";
      clearTimer(autoCollapseTimerRef);
      const visibleMs = Date.now() - expandedAtRef.current;
      const waitMs = Math.max(0, MIN_EXPANDED_MS - visibleMs);
      autoCollapseTimerRef.current = window.setTimeout(collapse, waitMs);
      return () => clearTimer(autoCollapseTimerRef);
    }
    prevStageRef.current = block.stage;
  }, [block.stage, collapse, clearTimer]);

  // 卸载时清理所有挂起的定时器。
  useEffect(() => {
    return () => {
      clearTimer(autoCollapseTimerRef);
      clearTimer(unmountTimerRef);
    };
  }, [clearTimer]);

  const toggle = useCallback(() => {
    if (collapsed) {
      expand();
    } else {
      collapse();
    }
  }, [collapsed, expand, collapse]);

  const inProgress =
    block.stage !== "end" && typeof block.startTime === "number";
  const [now, setNow] = useState(() => Date.now());

  // While reasoning is in progress, tick every second to grow the elapsed counter.
  useEffect(() => {
    if (!inProgress) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [inProgress]);

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

  return (
    <div className="reasoning-block">
      <div className="reasoning-header" onClick={toggle}>
        <span className="reasoning-dot" />
        <span className="reasoning-title">{title}</span>
        <QueueChevronIcon
          className={`reasoning-chevron${collapsed ? "" : " expanded"}`}
        />
      </div>
      {contentMounted && (
        <div
          className={`reasoning-collapse${collapsed ? "" : " expanded"}`}
          style={{
            transition: `grid-template-rows ${COLLAPSE_TRANSITION_MS}ms ease`,
          }}
        >
          <div className="reasoning-collapse-inner">
            <div className="reasoning-content">
              {renderContent(block.content || "")}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
