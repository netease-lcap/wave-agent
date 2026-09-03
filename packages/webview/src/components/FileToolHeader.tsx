import React from "react";
import type { ToolBlock } from "../types";
import { getToolStatusColor } from "../utils/statusColors";

interface FileToolHeaderProps {
  toolBlock: ToolBlock;
  filePath: string;
  onOpenFile: () => void;
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
      {filePath && (
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
      )}
    </div>
  );
};
