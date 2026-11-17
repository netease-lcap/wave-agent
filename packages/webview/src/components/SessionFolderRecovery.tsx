import React from "react";
import "../styles/SessionFolderRecovery.css";

export interface SessionFolderRecoveryProps {
  /** 会话最后已知的工作目录（宿主仍记着的那个已不存在的路径），让用户认出是哪一场。 */
  workdir?: string;
  /** 「选择文件夹」：宿主自己弹系统对话框、自己搬迁，webview 只发命令。 */
  onChooseFolder: () => void;
  /** 「删除会话」：走既有删除链路（spec 明确不做归档）。 */
  onDelete: () => void;
}

/**
 * 会话目录缺失后的恢复提示（spec desktop/desktop-sessions.md「会话目录缺失后的
 * 恢复（换文件夹继续）」场景 2）：这个会话的目录在磁盘上已不存在，输入框位置换成
 * 这块提示——**不给发送入口**，先把「用什么目录继续」解决掉才能再说话。
 *
 * 只有桌面端会挂它（宿主探测结果 `folderMissing` 只有桌面端下发，见 ChatApp 的
 * `sessionFolderMissing`）；占的是 composer 那个槽位，所以消息列表不会被遮挡。
 */
export const SessionFolderRecovery: React.FC<SessionFolderRecoveryProps> = ({
  workdir,
  onChooseFolder,
  onDelete,
}) => (
  <div
    className="session-folder-recovery"
    data-testid="session-folder-recovery"
  >
    <p className="session-folder-recovery-text">
      当前工作目录已不存在。选择一个新文件夹继续这场对话。
    </p>
    {workdir && (
      <div
        className="session-folder-recovery-path"
        title={workdir}
        data-testid="session-folder-recovery-path"
      >
        {workdir}
      </div>
    )}
    <div className="session-folder-recovery-actions">
      <button
        type="button"
        className="session-folder-recovery-btn session-folder-recovery-btn--primary"
        data-testid="session-folder-recovery-choose"
        onClick={onChooseFolder}
      >
        选择文件夹
      </button>
      <button
        type="button"
        className="session-folder-recovery-btn"
        data-testid="session-folder-recovery-delete"
        onClick={onDelete}
      >
        删除会话
      </button>
    </div>
  </div>
);

export default SessionFolderRecovery;
