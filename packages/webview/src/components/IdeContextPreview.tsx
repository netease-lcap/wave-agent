import React, { useEffect, useRef } from "react";
import { renderCodeHighlight, renderFileMarkdown } from "./FilePane";
import "../styles/IdeContextPreview.css";

interface IdeContextPreviewProps {
  /** 弹窗标题（或文件名） */
  title: string;
  /** 进入弹窗的全文 */
  content: string;
  /**
   * 按 markdown 渲染正文。远控页按需读来的 **Markdown 文档**走这一档（与桌面端
   * 计划面板同一套渲染器）；代码、日志、配置留在等宽 `<pre>`——它们的缩进与换行
   * 都是信息，过一遍 markdown 会被吃成列表、缩进代码块和双倍行距。
   */
  markdown?: boolean;
  /**
   * 代码档的原文件路径：有它就按扩展名选语言上高亮（与文件面板同一份配色），
   * 没有就是纯等宽文本。与 `markdown` 二选一，同时给时以 `markdown` 为准。
   */
  codePath?: string;
  /** 标题栏右侧的一句短说明（「前 256 KB / 共 5.0 MB」这类，放不下就省略）。 */
  note?: string;
  /** 正文上方单独一行提示（「可能有编码问题」）：它说的是内容怎么读，比标题栏
   * 能放下的那句话长，挤在右侧只会被 ellipsis 吃掉。 */
  notice?: string;
  onClose: () => void;
}

/**
 * 全屏只读弹层：用户消息里 `@终端` / `@问题` 标签的全文（spec
 * `ui/ide-context-mentions.md`），以及远控页按需读取的文件内容（spec
 * `remote/remote-web.md`「点消息里的文件路径看内容」）。
 *
 * 沿用图片预览那类全屏遮罩：点遮罩或按 ESC 关闭。与图片的区别只在于内容是
 * 文本——所以正文可选中复制（终端输出和报错最常被复制），并且关闭后焦点回到
 * 打开它的那个标签上。
 */
export const IdeContextPreview: React.FC<IdeContextPreviewProps> = ({
  title,
  content,
  markdown = false,
  codePath,
  note,
  notice,
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
          {note && (
            <span className="ide-context-preview-note" title={note}>
              {note}
            </span>
          )}
          <button
            type="button"
            className="ide-context-preview-close"
            aria-label="关闭"
            onClick={onClose}
          >
            ✕
          </button>
        </div>
        {notice && <div className="ide-context-preview-notice">{notice}</div>}
        {markdown ? (
          <div
            className="ide-context-preview-doc message-content markdown-content"
            data-testid="ide-context-preview-doc"
            dangerouslySetInnerHTML={{ __html: renderFileMarkdown(content) }}
          />
        ) : codePath ? (
          <pre className="ide-context-preview-body">
            <code
              className="hljs"
              data-testid="ide-context-preview-code"
              // 高亮串出自 hljs、且已过 `sanitizeFileMarkdown`（与文件面板
              // 同一道消毒），不是任意 HTML。
              dangerouslySetInnerHTML={{
                __html: renderCodeHighlight(content, codePath),
              }}
            />
          </pre>
        ) : (
          <pre className="ide-context-preview-body">{content}</pre>
        )}
      </div>
    </div>
  );
};

export default IdeContextPreview;
