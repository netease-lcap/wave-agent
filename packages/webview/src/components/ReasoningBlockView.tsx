import React, { useState, useRef, useEffect } from 'react';
import { QueueChevronIcon } from './HeaderIcons';
import type { ReasoningBlock } from '../types';

interface ReasoningBlockViewProps {
  block: ReasoningBlock;
  renderContent: (content: string) => React.ReactNode;
}

export const ReasoningBlockView: React.FC<ReasoningBlockViewProps> = ({ block, renderContent }) => {
  // Reasoning that is already finished on mount (e.g. loaded from history) starts
  // collapsed; an in-progress block starts expanded and auto-collapses on finish.
  const [collapsed, setCollapsed] = useState(block.stage === 'end');
  const prevStageRef = useRef(block.stage);

  // Auto-collapse once when reasoning finishes (stage transitions from non-'end' to 'end').
  useEffect(() => {
    if (prevStageRef.current !== 'end' && block.stage === 'end') {
      setCollapsed(true);
    }
    prevStageRef.current = block.stage;
  }, [block.stage]);

  const inProgress = block.stage !== 'end' && typeof block.startTime === 'number';
  const [now, setNow] = useState(() => Date.now());

  // While reasoning is in progress, tick every second to grow the elapsed counter.
  useEffect(() => {
    if (!inProgress) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [inProgress]);

  let title = '思考';
  if (inProgress) {
    const seconds = Math.max(0, Math.floor((now - (block.startTime as number)) / 1000));
    title = `思考中 ${seconds}s`;
  } else if (
    block.stage === 'end' &&
    typeof block.startTime === 'number' &&
    typeof block.endTime === 'number' &&
    block.endTime >= block.startTime
  ) {
    const seconds = Math.round((block.endTime - block.startTime) / 1000);
    title = `思考 (用时 ${seconds}s)`;
  }

  return (
    <div className="reasoning-block">
      <div className="reasoning-header" onClick={() => setCollapsed(c => !c)}>
        <span className="reasoning-dot" />
        <span className="reasoning-title">{title}</span>
        <QueueChevronIcon className={`reasoning-chevron${collapsed ? '' : ' expanded'}`} />
      </div>
      {!collapsed && (
        <div className="reasoning-content">
          {renderContent(block.content || '')}
        </div>
      )}
    </div>
  );
};
