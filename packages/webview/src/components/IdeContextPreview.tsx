import React, { useEffect, useRef } from "react";
import "../styles/IdeContextPreview.css";

interface IdeContextPreviewProps {
  /** 弹窗标题（终端输出 / 当前文件的问题） */
  title: string;
  /** 进入消息正文的全文 */
  content: string;
  onClose: () => void;
}

/**
 * 用户消息里 `@终端` / `@问题` 标签的全文弹窗（spec
 * `ui/ide-context-mentions.md`「用户消息里的上下文标签」）。
 *
 * 沿用图片预览那类全屏遮罩：点遮罩或按 ESC 关闭。与图片的区别只在于内容是
 * 文本——所以正文可选中复制（终端输出和报错最常被复制），并且关闭后焦点回到
 * 打开它的那个标签上。
 */
export const IdeContextPreview: React.FC<IdeContextPreviewProps> = ({
  title,
  content,
  onClose,
}) => {
  const panelRef = useRef<HTMLDivElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    returnFocusRef.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    panelRef.current?.focus();

    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        onClose();
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      returnFocusRef.current?.focus();
    };
  }, [onClose]);

  return (
    <div
      className="ide-context-preview-overlay"
      role="presentation"
      onClick={onClose}
    >
      <div
        ref={panelRef}
        className="ide-context-preview"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="ide-context-preview-header">
          <span className="ide-context-preview-title">{title}</span>
          <button
            type="button"
            className="ide-context-preview-close"
            aria-label="关闭"
            onClick={onClose}
          >
            ✕
          </button>
        </div>
        <pre className="ide-context-preview-body">{content}</pre>
      </div>
    </div>
  );
};

export default IdeContextPreview;
