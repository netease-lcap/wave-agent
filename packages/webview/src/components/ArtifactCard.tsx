import React from "react";
import { FileCodeIcon } from "./HeaderIcons";

/**
 * 对话里「发布到创作集」的 artifact 卡片（PM 3500358560332032）。
 *
 * artifact 只有 URL，本地没有对应文件，所以卡片上只有一个动作「在浏览器中
 * 打开」，不带下拉菜单。样式走 `.message-file-card*`。
 *
 * 只读纯展示：打开动作由调用方决定（桌面端发 `openExternal`）。
 *
 * 头部图标用 `FileCodeIcon`（= 创作集表格每行的行首图标），**不是**浏览器图标：
 * 图标位表示「对象」，而浏览器字形在本仓是「往外打开」这个**动作**的专用图标
 * （预览面板 / 文件面板工具条那两颗按钮），且卡片右侧按钮文字已经把动作说了
 * 一遍。2026-11-09 设计师裁定「先统一 FileCodeIcon，不分类」——不做按文件类型
 * 分图标（那条链路现在没有 mime/扩展名字段，见 artifactTool.ts 的 metadata）。
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
      <FileCodeIcon />
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
