import React, { useState, useRef, useEffect } from 'react';
import { QueueChevronIcon } from './HeaderIcons';
import type { ReasoningBlock } from '../types';

interface ReasoningBlockViewProps {
  block: ReasoningBlock;
  renderContent: (content: string) => React.ReactNode;
}

export const ReasoningBlockView: React.FC<ReasoningBlockViewProps> = ({ block, renderContent }) => {
  const [collapsed, setCollapsed] = useState(false);
  const prevStageRef = useRef(block.stage);

  // Auto-collapse once when reasoning finishes (stage transitions from non-'end' to 'end').
  useEffect(() => {
    if (prevStageRef.current !== 'end' && block.stage === 'end') {
      setCollapsed(true);
    }
    prevStageRef.current = block.stage;
  }, [block.stage]);

  return (
    <div className="reasoning-block">
      <div className="reasoning-header" onClick={() => setCollapsed(c => !c)}>
        <span className="reasoning-dot" />
        <span className="reasoning-title">思考</span>
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
