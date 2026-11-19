import React from "react";
import type { ConversationFileEntry } from "../utils/conversationFiles";
import { baseNameOf } from "../utils/fileTreePaths";
import { FileTextIcon } from "./HeaderIcons";
import { FileTypeIcon } from "./FileTypeIcon";
import { isDesktopHost } from "../utils/platform";

interface ConversationFileListProps {
  files: ConversationFileEntry[];
  /** Open a file in this panel (same flow as clicking a message file path). */
  onOpenFile: (path: string) => void;
}

/**
 * The file panel's list view (spec: 文件展示优化): the files this conversation
 * read or wrote, most recent first, one row each — click to open.
 *
 * Only files, never artifacts: an artifact is a URL with no folder of its own,
 * so it has neither a place in this list nor the "reveal in folder" style
 * actions a file row could offer.
 */
export const ConversationFileList: React.FC<ConversationFileListProps> = ({
  files,
  onOpenFile,
}) => (
  <div
    className="file-pane-conversation-files"
    data-testid="file-pane-conversation-files"
  >
    <div className="file-pane-conversation-files-caption">当前对话的文件</div>
    <div className="file-pane-conversation-file-list">
      {files.map((file) => (
        <button
          key={file.absolutePath}
          type="button"
          className="file-pane-conversation-file-row"
          data-testid="file-pane-conversation-file-row"
          title={file.displayPath}
          onClick={() => onOpenFile(file.path)}
        >
          {isDesktopHost() ? (
            // 桌面端按文件名解析的类型图标（与右侧 `Project files` 文件树同一颗、
            // 同一套配色）：设计师 2026-11-18 截图指出「同一个界面里两套图标」。
            // 盒仍是 16×16（改前是 PanelKindIcon kind="file" size={16}）⇒ 行高与
            // 文件名左缘零变化。插件端保留原 feather 图标。
            <FileTypeIcon
              fileName={baseNameOf(file.absolutePath)}
              size={16}
              className="file-pane-conversation-file-icon"
            />
          ) : (
            <FileTextIcon className="file-pane-conversation-file-icon" />
          )}
          <span className="file-pane-conversation-file-name">{file.name}</span>
        </button>
      ))}
    </div>
  </div>
);
