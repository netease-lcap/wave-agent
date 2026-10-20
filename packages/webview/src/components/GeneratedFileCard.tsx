import React, { useEffect, useRef, useState } from "react";
import {
  ChevronDownIcon,
  FileCodeIcon,
  FileTextIcon,
  FolderIcon,
  OpenBrowserIcon,
} from "./HeaderIcons";

/**
 * 对话里生成出的文件卡片（spec desktop/desktop-artifacts.md「对话中的生成
 * 文件卡片」）。原型：`#view-type-conv` 的 `.fc` —— 图标块 + 文件名/副信息 +
 * 右侧下拉按钮，菜单三项：打开文件 / 在浏览器中打开 / 打开文件所在文件夹。
 *
 * 三个动作都发既有宿主命令：打开文件走 `openFile`（桌面端由 ChatApp 路由到
 * 文件面板），另两项是桌面端独有命令（`desktopOpenFileExternal` 用系统默认
 * 应用打开、`desktopRevealInFolder` 在文件管理器里定位）。因此本卡片只在
 * desktop 宿主渲染 —— 其它宿主没有这三条路径。
 */
export interface GeneratedFileCardProps {
  /** 展示用文件名（basename）。 */
  fileName: string;
  /** 副信息：工作目录下的相对路径。 */
  subtitle?: string;
  onOpenFile: () => void;
  onOpenExternal: () => void;
  onRevealInFolder: () => void;
}

export const GeneratedFileCard: React.FC<GeneratedFileCardProps> = ({
  fileName,
  subtitle,
  onOpenFile,
  onOpenExternal,
  onRevealInFolder,
}) => {
  const [menuOpen, setMenuOpen] = useState(false);
  const cardRef = useRef<HTMLDivElement | null>(null);
  const toggleRef = useRef<HTMLButtonElement | null>(null);

  // 点卡片外或 Esc 关闭菜单（菜单展开期间才挂监听）。
  useEffect(() => {
    if (!menuOpen) return;
    const onPointerDown = (event: MouseEvent) => {
      if (!cardRef.current?.contains(event.target as Node)) setMenuOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setMenuOpen(false);
        toggleRef.current?.focus();
      }
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [menuOpen]);

  const isMarkdown = /\.(md|markdown)$/i.test(fileName);
  const Icon = isMarkdown ? FileTextIcon : FileCodeIcon;

  const run = (action: () => void) => {
    setMenuOpen(false);
    action();
  };

  return (
    <div
      className="generated-file-card"
      data-testid="generated-file-card"
      ref={cardRef}
    >
      <span className="generated-file-card-icon" aria-hidden="true">
        <Icon />
      </span>
      <span className="generated-file-card-meta">
        <span className="generated-file-card-name" title={fileName}>
          {fileName}
        </span>
        {subtitle && (
          <span className="generated-file-card-sub">{subtitle}</span>
        )}
      </span>
      <span className="generated-file-card-actions">
        <button
          type="button"
          className="generated-file-card-toggle"
          data-testid="generated-file-card-toggle"
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          ref={toggleRef}
          onClick={() => setMenuOpen((open) => !open)}
        >
          在浏览器中打开
          <ChevronDownIcon className="generated-file-card-chevron" />
        </button>
        {menuOpen && (
          <div
            className="generated-file-card-menu"
            role="menu"
            data-testid="generated-file-card-menu"
          >
            <button
              type="button"
              role="menuitem"
              className="generated-file-card-item"
              data-testid="generated-file-open"
              onClick={() => run(onOpenFile)}
            >
              <FileTextIcon />
              打开文件
            </button>
            <button
              type="button"
              role="menuitem"
              className="generated-file-card-item"
              data-testid="generated-file-open-browser"
              onClick={() => run(onOpenExternal)}
            >
              <OpenBrowserIcon />
              在浏览器中打开
            </button>
            <button
              type="button"
              role="menuitem"
              className="generated-file-card-item"
              data-testid="generated-file-open-folder"
              onClick={() => run(onRevealInFolder)}
            >
              <FolderIcon />
              打开文件所在文件夹
            </button>
          </div>
        )}
      </span>
    </div>
  );
};
