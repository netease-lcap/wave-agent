import React from "react";
import type { ConversationFileEntry } from "../utils/conversationFiles";
import { FileTextIcon } from "./HeaderIcons";
import { PanelKindIcon } from "./PanelKindIcon";
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
            // 桌面端与会话面板标签、文件空态用同一颗官方「文件」图标（PanelKindIcon
            // kind="file"，Figma Component 12 · 13561:39702）；1029 第十轮设计师评论
            // 「和这里保持一致」指的就是面板标签那颗。IDE 宿主保留原 feather 图标。
            <PanelKindIcon
              kind="file"
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
