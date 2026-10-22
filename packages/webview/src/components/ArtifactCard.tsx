import React from "react";
import { OpenBrowserIcon } from "./HeaderIcons";

/**
 * 对话里「发布到创作集」的 artifact 卡片（PM 3500358560332032）。
 *
 * 与生成文件卡片（`GeneratedFileCard`）的区别：artifact 只有 URL，本地没有
 * 对应文件，所以卡片上只有一个动作「在浏览器中打开」，不带下拉菜单。视觉沿用
 * 生成文件卡片的配方（同一套 `generated-file-card-*` 类），两张卡片在同一个
 * 对话流里看起来是同一族。
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
  <div
    className="generated-file-card artifact-card"
    data-testid="artifact-card"
  >
    <span className="generated-file-card-icon" aria-hidden="true">
      <OpenBrowserIcon />
    </span>
    <span className="generated-file-card-meta">
      <span className="generated-file-card-name" title={title}>
        {title}
      </span>
      {subtitle && <span className="generated-file-card-sub">{subtitle}</span>}
    </span>
    <span className="generated-file-card-actions">
      <button
        type="button"
        className="generated-file-card-toggle"
        data-testid="artifact-card-open"
        onClick={onOpenInBrowser}
      >
        在浏览器中打开
      </button>
    </span>
  </div>
);
