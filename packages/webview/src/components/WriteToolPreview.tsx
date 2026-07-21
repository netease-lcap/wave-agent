import React from 'react';
import { ExternalLinkIcon } from './HeaderIcons';
import type { ToolBlock } from '../types';

interface WriteToolPreviewProps {
  toolBlock: ToolBlock;
  vscode: { postMessage: (message: unknown) => void };
}

export const WriteToolPreview: React.FC<WriteToolPreviewProps> = ({ toolBlock, vscode }) => {
  const toolStatusColor = toolBlock.stage === 'running' || toolBlock.stage === 'streaming'
    ? 'var(--vscode-editorWarning-foreground, #cca700)'
    : toolBlock.success === true
      ? 'var(--vscode-testing-iconPassed, #73c991)'
      : (toolBlock.error || toolBlock.success === false)
        ? 'var(--vscode-testing-iconFailed, #f14c4c)'
        : 'var(--vscode-descriptionForeground, #888)';

  let filePath = '';
  let content: string | null = null;
  try {
    if (toolBlock.parameters) {
      const params = JSON.parse(toolBlock.parameters);
      filePath = params.file_path || '';
      content = typeof params.content === 'string' ? params.content : null;
    }
  } catch {
    content = null;
  }

  const openFile = () => {
    if (filePath) {
      vscode.postMessage({ command: 'openFile', path: filePath });
    }
  };

  const header = (
    <div className="write-tool-header">
      <span className="tool-status-dot" style={{ color: toolStatusColor }}>●</span>
      <span className="write-tool-label">{toolBlock.name || 'Tool'}</span>
      {filePath && (
        <span className="write-tool-path" onClick={openFile}>{filePath}</span>
      )}
    </div>
  );

  if (content === null) {
    return <div className="write-tool-preview">{header}</div>;
  }

  return (
    <div className="write-tool-preview">
      {header}
      {toolBlock.shortResult && (
        <div className="write-tool-stats">{toolBlock.shortResult}</div>
      )}
      <div className="write-preview-box">
        <pre className="write-preview-content">{content}</pre>
        <div className="write-preview-scrim" />
        <button
          className="write-preview-open"
          aria-label="打开预览"
          data-testid="write-preview-open"
          onClick={openFile}
        >
          <ExternalLinkIcon className="write-preview-open-icon" />
        </button>
      </div>
    </div>
  );
};
