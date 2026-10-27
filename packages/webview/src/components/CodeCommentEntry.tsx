import React from "react";
import type { CommentEntryAnchor } from "../utils/useCodeCommentEntry";
import type { CommentUnitRange } from "../utils/commentUnits";

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
}) => (
  <>
    {chip && (
      <button
        type="button"
        className="code-comment-chip"
        data-testid="code-comment-chip"
        style={{ left: chip.x, top: chip.y }}
        title={labelOf(chip)}
        aria-label={labelOf(chip)}
        // Keep the selection alive: focusing the button would collapse it, and
        // the range would be gone before the click lands.
        onMouseDown={(event) => {
          event.preventDefault();
          event.stopPropagation();
        }}
        onClick={() => onOpen({ from: chip.from, to: chip.to })}
      >
        <i className="codicon codicon-comment" aria-hidden="true" />
      </button>
    )}
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

export default CodeCommentEntry;
