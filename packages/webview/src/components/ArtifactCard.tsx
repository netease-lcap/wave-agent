import React from "react";
import { OpenBrowserIcon } from "./HeaderIcons";

/**
 * 对话里「发布到创作集」的 artifact 卡片（PM 3500358560332032）。
 *
 * artifact 只有 URL，本地没有对应文件，所以卡片上只有一个动作「在浏览器中
 * 打开」，不带下拉菜单。样式走 `.message-file-card*`。
 *
 * 只读纯展示：打开动作由调用方决定（桌面端发 `openExternal`）。
 */
export interface ArtifactCardProps {
  /** 卡片标题：artifact 标题，缺省时用文件名。 */
  title: string;
  /** 副信息：版本 / 「已发布」之类的短提示。 */
  subtitle?: string;
  onOpenInBrowser: () => void;
}

export const ArtifactCard: React.FC<ArtifactCardProps> = ({
  title,
  subtitle,
  onOpenInBrowser,
}) => (
  <div className="message-file-card artifact-card" data-testid="artifact-card">
    <span className="message-file-card-icon" aria-hidden="true">
      <OpenBrowserIcon />
    </span>
    <span className="message-file-card-meta">
      <span className="message-file-card-name" title={title}>
        {title}
      </span>
      {subtitle && <span className="message-file-card-sub">{subtitle}</span>}
    </span>
    <span className="message-file-card-actions">
      <button
        type="button"
        className="message-file-card-toggle"
        data-testid="artifact-card-open"
        onClick={onOpenInBrowser}
      >
        在浏览器中打开
      </button>
    </span>
  </div>
);
