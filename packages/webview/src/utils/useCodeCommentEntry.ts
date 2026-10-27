import { useCallback, useEffect, useRef, useState } from "react";
import {
  selectedUnitRange,
  selectionAnchor,
  toContainerPoint,
  unitIndexOf,
  type CommentUnitRange,
} from "./commentUnits";
import { useClickOutside } from "./useClickOutside";

/** A unit range plus the point (container content coordinates) it shows at. */
export interface CommentEntryAnchor extends CommentUnitRange {
  x: number;
  y: number;
}

export interface UseCodeCommentEntryOptions {
  /**
   * False in the states that carry no comment entry at all — an image, a
   * markdown render, the editor, an empty/error pane (spec scenarios 5 and 9).
   */
  enabled: boolean;
}

export interface CodeCommentEntryState {
  /** Attach to the positioned element that hosts the `data-comment-unit` lines. */
  containerRef: React.RefObject<HTMLDivElement>;
  menu: CommentEntryAnchor | null;
  chip: CommentEntryAnchor | null;
  /** Last line the user clicked, right-clicked or selected — the toolbar target. */
  anchor: CommentUnitRange | null;
  menuRef: React.RefObject<HTMLDivElement>;
  closeMenu: () => void;
  clearChip: () => void;
  /** Spread on that same container element. */
  containerProps: {
    onContextMenu: (event: React.MouseEvent<HTMLDivElement>) => void;
    onMouseUp: (event: React.MouseEvent<HTMLDivElement>) => void;
  };
}

/**
 * The two comment entries of a code view (spec「文件面板评论」/「差异面板行评论」):
 * right click on a line opens a one-item menu, and selecting text floats a
 * button at the end of the selection. Neither needs a permanently reserved
 * gutter, which is what lets line numbers sit flush against the left edge.
 *
 * The hook owns only the gesture state; opening the comment box is the view's
 * job (it knows what text a unit contributes to the appended markdown).
 */
export function useCodeCommentEntry({
  enabled,
}: UseCodeCommentEntryOptions): CodeCommentEntryState {
  const containerRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [menu, setMenu] = useState<CommentEntryAnchor | null>(null);
  const [chip, setChip] = useState<CommentEntryAnchor | null>(null);
  const [anchor, setAnchor] = useState<CommentUnitRange | null>(null);

  const closeMenu = useCallback(() => setMenu(null), []);
  const clearChip = useCallback(() => setChip(null), []);

  useClickOutside({
    refs: [menuRef],
    enabled: !!menu,
    onClickOutside: closeMenu,
  });

  // Browsers report a vanishing selection (click elsewhere, Esc, Ctrl+A) through
  // selectionchange; without this the floating button would outlive its text.
  useEffect(() => {
    if (!enabled) return;
    const sync = () => {
      const container = containerRef.current;
      const range = selectedUnitRange(container);
      const point = range ? selectionAnchor(container, range) : null;
      setChip(range && point ? { ...range, ...point } : null);
    };
    document.addEventListener("selectionchange", sync);
    return () => document.removeEventListener("selectionchange", sync);
  }, [enabled]);

  // A view that stops offering comments (switching to an image, entering the
  // editor) must not leave a stale menu or button behind.
  useEffect(() => {
    if (enabled) return;
    setMenu(null);
    setChip(null);
    setAnchor(null);
  }, [enabled]);

  const onContextMenu = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      const container = containerRef.current;
      if (!enabled || !container) return;
      const target = event.target as HTMLElement;
      // Text fields inside the view (the comment box's textarea) keep the native
      // menu: copy/paste has to work there.
      if (target.closest?.("textarea, input, .line-comment-box")) return;
      const clicked = unitIndexOf(target, container);
      const selected = selectedUnitRange(container);
      // A right click inside a live selection comments the selection (like every
      // editor); anywhere else it comments the line under the pointer.
      const range =
        selected &&
        clicked !== null &&
        clicked >= selected.from &&
        clicked <= selected.to
          ? selected
          : clicked !== null
            ? { from: clicked, to: clicked }
            : selected;
      if (!range) return;
      event.preventDefault();
      setAnchor(range);
      setChip(null);
      setMenu({
        ...range,
        ...toContainerPoint(container, event.clientX, event.clientY),
      });
    },
    [enabled],
  );

  const onMouseUp = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      const container = containerRef.current;
      if (!enabled || !container) return;
      const selected = selectedUnitRange(container);
      const single = selected
        ? null
        : unitIndexOf(event.target as Node, container);
      const range =
        selected ?? (single !== null ? { from: single, to: single } : null);
      if (!range) return;
      setAnchor(range);
      const point = selected ? selectionAnchor(container, selected) : null;
      setChip(selected && point ? { ...selected, ...point } : null);
    },
    [enabled],
  );

  return {
    containerRef,
    menu,
    chip,
    anchor,
    menuRef,
    closeMenu,
    clearChip,
    containerProps: { onContextMenu, onMouseUp },
  };
}
