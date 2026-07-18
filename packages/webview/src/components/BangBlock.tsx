import React from 'react';
import type { BangBlock as BangBlockType } from '../types';

interface BangBlockProps {
  block: BangBlockType;
}

export const BangBlock: React.FC<BangBlockProps> = ({ block }) => {
  const { command, output, stage, exitCode } = block;
  const isRunning = stage === 'running';

  return (
    <div className="bash-command-unified">
      <div className="bash-command-input">
        <span className="bash-prompt">$</span>
        <span className="bash-command">{command}</span>
        {isRunning && <i className="codicon codicon-loading codicon-modifier-spin" style={{ marginLeft: '8px', fontSize: '12px' }}></i>}
      </div>
      {!isRunning && (
        <div className="bash-command-output">
          {output || `退出代码: ${exitCode}`}
        </div>
      )}
    </div>
  );
};
