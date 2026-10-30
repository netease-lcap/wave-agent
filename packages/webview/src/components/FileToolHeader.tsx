import React from "react";
import type { ToolBlock } from "../types";
import { getToolStatusColor } from "../utils/statusColors";

interface FileToolHeaderProps {
  toolBlock: ToolBlock;
  filePath: string;
  /**
   * Opens the file in the host. Omitted by hosts that have nowhere to open it —
   * the remote-control Web page (spec remote/remote-web.md 场景 20) — in which
   * case the path renders as plain text: no role, no tab stop, no handler, so
   * there is nothing that looks clickable and does nothing.
   */
  onOpenFile?: () => void;
}

export const FileToolHeader: React.FC<FileToolHeaderProps> = ({
  toolBlock,
  filePath,
  onOpenFile,
}) => {
  return (
    <div className="write-tool-header">
      <span
        className="tool-status-dot"
        style={{ color: getToolStatusColor(toolBlock) }}
      >
        ●
      </span>
      <span className="write-tool-label">{toolBlock.name || "Tool"}</span>
      {filePath &&
        (onOpenFile ? (
          <span
            className="write-tool-path"
            role="button"
            tabIndex={0}
            onClick={onOpenFile}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onOpenFile();
              }
            }}
          >
            {filePath}
          </span>
        ) : (
          <span className="write-tool-path write-tool-path--plain">
            {filePath}
          </span>
        ))}
    </div>
  );
};
