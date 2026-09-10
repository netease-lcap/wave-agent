import React from "react";
import { ExternalLinkIcon } from "./HeaderIcons";
import { FileToolHeader } from "./FileToolHeader";
import type { ToolBlock } from "../types";
import { toRelativePath } from "../utils/messageUtils";
import { isDesktopHost } from "../utils/platform";

interface WriteToolPreviewProps {
  toolBlock: ToolBlock;
  vscode: { postMessage: (message: unknown) => void };
  workdir?: string;
  /** Host-routed open (desktop opens its file panel via ChatApp.handleOpenFile);
   *  falls back to the plain openFile RPC when absent (IDE hosts). */
  onOpenFile?: (path: string) => void;
}

export const WriteToolPreview: React.FC<WriteToolPreviewProps> = ({
  toolBlock,
  vscode,
  workdir,
  onOpenFile,
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
      if (onOpenFile) {
        onOpenFile(filePath);
      } else {
        vscode.postMessage({ command: "openFile", path: filePath });
      }
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
      <div className="write-preview-box">
        {/* tabIndex（F-10 / WCAG 2.1.1）：max-height 120 + overflow-y:auto 是
            可滚动区域，键盘用户需能聚焦后用方向键翻看完整写入内容。
            仅桌面端注入——焦点环样式只存在于 `[data-host="desktop"]` 层。 */}
        <div
          className="write-preview-scroll"
          tabIndex={isDesktopHost() ? 0 : undefined}
        >
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
  );
};
