import React, { useRef } from "react";
import type { CommentEntryAnchor } from "../utils/useCodeCommentEntry";
import type { CommentUnitRange } from "../utils/commentUnits";
import { isDesktopHost } from "../utils/platform";
import { CommentChipIcon } from "./CommentChipIcon";
import { Tooltip } from "./Tooltip";

export interface CodeCommentEntryProps {
  /** Button that follows a text selection. */
  chip: CommentEntryAnchor | null;
  /** Right-click menu, positioned at the pointer. */
  menu: CommentEntryAnchor | null;
  menuRef: React.RefObject<HTMLDivElement>;
  /** 「评论第 3 行」/「评论第 3–5 行」 — the chip's accessible name. */
  labelOf: (target: CommentUnitRange) => string;
  onOpen: (target: CommentUnitRange) => void;
  onCloseMenu: () => void;
}

/**
 * The comment entries themselves, rendered inside the code view's positioned
 * container so both stay glued to the text they belong to (the container
 * scrolls, the offsets are content coordinates). Shared by the diff pane and the
 * file pane — the surrounding views differ, the entries must not.
 */
export const CodeCommentEntry: React.FC<CodeCommentEntryProps> = ({
  chip,
  menu,
  menuRef,
  labelOf,
  onOpen,
  onCloseMenu,
}) => {
  // 1029 评论（第十四批）：桌面端的悬停提示从原生 `title` 换成自绘 `Tooltip`。
  // 她原话：「我这还是看不到，换成桌面端自绘的 Tooltip」—— 原生 title 是系统 UI 层
  // 画的（约 1s 延迟、不进截图），换成和文件面板图标同一套（深色气泡、间距 4px、
  // 100ms）。锚点用 `anchorRef` 指向按钮本身：Tooltip 默认拿包裹层当锚点，而这个
  // 按钮是 `position: absolute` + 行内 `left/top`，包裹层必须 `display: contents`
  // （见 LineCommentBox.css），没有自己的盒子可量。
  // IDE / 插件端不动：仍是原生 `title`，也不加这层包裹。
  const chipRef = useRef<HTMLButtonElement>(null);
  const desktop = isDesktopHost();

  const renderChip = (anchor: CommentEntryAnchor) => (
    <button
      ref={chipRef}
      type="button"
      className="code-comment-chip"
      data-testid="code-comment-chip"
      style={{ left: anchor.x, top: anchor.y }}
      // 桌面端交给 Tooltip，留住 title 会双弹（原生 + 自绘）。
      title={desktop ? undefined : labelOf(anchor)}
      aria-label={labelOf(anchor)}
      // Keep the selection alive: focusing the button would collapse it, and
      // the range would be gone before the click lands.
      onMouseDown={(event) => {
        event.preventDefault();
        event.stopPropagation();
      }}
      onClick={() => onOpen({ from: anchor.from, to: anchor.to })}
    >
      {/* 1029 评论（第十二批）：「这个图标的样式我放在桌面的icon文件夹里面了」
          ⇒ 桌面端换成设计源的两态气泡（评论normal / 评论hover），IDE / 插件
          宿主保留原 codicon。两态同时渲染、由 CSS `:hover` 切换显隐，hover
          不触发组件重渲染（与文件面板工具条那套「一态一份矢量」同口径）。 */}
      {desktop ? (
        <>
          <CommentChipIcon className="code-comment-chip-icon is-normal" />
          <CommentChipIcon hover className="code-comment-chip-icon is-hover" />
        </>
      ) : (
        <i className="codicon codicon-comment" aria-hidden="true" />
      )}
    </button>
  );

  return (
    <>
      {chip &&
        (desktop ? (
          <Tooltip
            text={labelOf(chip)}
            position="top"
            className="code-comment-chip-tooltip"
            anchorRef={chipRef}
          >
            {renderChip(chip)}
          </Tooltip>
        ) : (
          renderChip(chip)
        ))}
      {menu && (
        <div
          ref={menuRef}
          className="code-comment-menu"
          data-testid="code-comment-menu"
          role="menu"
          style={{ left: menu.x, top: menu.y }}
        >
          <button
            type="button"
            role="menuitem"
            className="code-comment-menu-item"
            data-testid="code-comment-menu-add"
            onClick={() => {
              onCloseMenu();
              onOpen({ from: menu.from, to: menu.to });
            }}
          >
            添加评论
          </button>
        </div>
      )}
    </>
  );
};

export default CodeCommentEntry;
