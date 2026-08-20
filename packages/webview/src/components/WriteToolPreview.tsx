import React from "react";
import { ExternalLinkIcon } from "./HeaderIcons";
import { FileToolHeader } from "./FileToolHeader";
import type { ToolBlock } from "../types";
import { toRelativePath } from "../utils/messageUtils";

interface WriteToolPreviewProps {
  toolBlock: ToolBlock;
  vscode: { postMessage: (message: unknown) => void };
  workdir?: string;
}

export const WriteToolPreview: React.FC<WriteToolPreviewProps> = ({
  toolBlock,
  vscode,
  workdir,
}) => {
  let filePath = "";
  let content: string | null = null;
  try {
    if (toolBlock.parameters) {
      const params = JSON.parse(toolBlock.parameters);
      filePath = params.file_path || "";
      content = typeof params.content === "string" ? params.content : null;
    }
  } catch {
    content = null;
  }

  const openFile = () => {
    if (filePath) {
      vscode.postMessage({ command: "openFile", path: filePath });
    }
  };

  const header = (
    <FileToolHeader
      toolBlock={toolBlock}
      filePath={toRelativePath(filePath, workdir)}
      onOpenFile={openFile}
    />
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
      {/* 挂载即播放 0fr→1fr 入场动画（.tool-reveal），避免预览一次性出现的高度突跳 */}
      <div className="tool-reveal">
        <div className="tool-reveal-inner">
          <div className="write-preview-box">
            <div className="write-preview-scroll">
              <pre className="write-preview-content">{content}</pre>
            </div>
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
      </div>
    </div>
  );
};
