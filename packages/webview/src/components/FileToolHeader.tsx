import React from 'react';
import type { ToolBlock } from '../types';

interface FileToolHeaderProps {
  toolBlock: ToolBlock;
  filePath: string;
  onOpenFile: () => void;
}

export const FileToolHeader: React.FC<FileToolHeaderProps> = ({ toolBlock, filePath, onOpenFile }) => {
  const toolStatusColor = toolBlock.stage === 'running' || toolBlock.stage === 'streaming'
    ? 'var(--vscode-editorWarning-foreground, #cca700)'
    : toolBlock.success === true
      ? 'var(--vscode-testing-iconPassed, #73c991)'
      : (toolBlock.error || toolBlock.success === false)
        ? 'var(--vscode-testing-iconFailed, #f14c4c)'
        : 'var(--vscode-descriptionForeground, #888)';

  return (
    <div className="write-tool-header">
      <span className="tool-status-dot" style={{ color: toolStatusColor }}>●</span>
      <span className="write-tool-label">{toolBlock.name || 'Tool'}</span>
      {filePath && (
        <span className="write-tool-path" onClick={onOpenFile}>{filePath}</span>
      )}
    </div>
  );
};
