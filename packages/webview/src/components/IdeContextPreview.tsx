import React, { useCallback, useEffect, useRef } from "react";
import { renderCodeHighlight, renderFileMarkdown } from "./FilePane";
import { resolveMarkdownLinkTarget } from "../utils/markdownLinkTarget";
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
  /**
   * 正在预览的那个文件的路径，用作 markdown 正文里**相对链接**的解析基准。
   *
   * 这份正文是渲染进应用文档的：一个没被接管的 `<a href="a.md">` 会被浏览器按
   * **页面自己的地址**解析，于是点一下就把整页导航走（远控页实测落成静态站点
   * 一个不存在的对象，就地把内容换成错误页）。有路径 + 有 `onOpenFile` 才接管，
   * 两者缺一都保持默认行为——`@终端` 那类「内容不来自某个文件」的弹层没有基准，
   * 也不该猜。
   */
  filePath?: string;
  /** markdown 正文里点到**本地文件**：交给调用方按它自己的通道打开（文件面板 /
   * 远控页的按需读取）。不传则链接保持默认行为。 */
  onOpenFile?: (path: string) => void;
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
  filePath,
  onOpenFile,
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

  /**
   * 正文里的相对链接按**被预览的那份文件的目录**解析，交回调用方就地打开
   * （与文件面板 `FilePane.handleMarkdownClick` 同一套判据、同一个解析器）。
   *
   * 不接管的那几种由解析器自己回答 `null`：`#锚点`、外链（`http(s)` / `mailto`
   * …）、以及没有基准路径时的相对链接——它们的默认行为是对的。解析出本地路径
   * 就必须 `preventDefault`：这份 HTML 挂在应用文档里，放任默认行为等于把页面
   * 导航走。
   */
  const handleDocClick = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      if (!filePath || !onOpenFile) return;
      const anchor =
        event.target instanceof Element
          ? event.target.closest("a[href]")
          : null;
      const href = anchor?.getAttribute("href");
      if (!href) return;
      const target = resolveMarkdownLinkTarget(href, filePath);
      if (!target) return;
      event.preventDefault();
      onOpenFile(target);
    },
    [filePath, onOpenFile],
  );

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
          {/* 标题单行省略号收尾（见 CSS）：文件名可以任意长，全名留在这里给
              桌面端 hover 看。 */}
          <span className="ide-context-preview-title" title={title}>
            {title}
          </span>
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
            onClick={handleDocClick}
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
