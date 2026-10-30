import React from "react";
import type { ToolBlock } from "../types";
import { getToolStatusColor } from "../utils/statusColors";

interface FileToolHeaderProps {
  toolBlock: ToolBlock;
  filePath: string;
  /**
   * 点路径时的动作。本机宿主是「打开文件」（桌面端文件面板 / IDE 的 openFile
   * RPC），远控页是「就地看内容」（宿主按需读出那份文件，spec
   * remote/remote-web.md「点消息里的文件路径看内容」）。两处都没有时省略 ——
   * 路径退化为纯文本：no role, no tab stop, no handler, 于是没有任何东西看起来
   * 能点却点不动。
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
