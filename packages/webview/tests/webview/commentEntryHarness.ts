import { fireEvent, screen } from "@testing-library/react";

/**
 * Helpers for the comment entries both code views share (spec「文件面板评论」/
 * 「差异面板行评论」场景 1/2): a right-click menu and a button that follows a text
 * selection. Tests drive the gestures, not the internals — every code line is
 * reachable by its own testid (`file-pane-line-<n>` / `diff-line-<index>`) and
 * carries `data-comment-unit`.
 */

/** Right-click a line and take 「添加评论」 from the menu. */
export function openCommentAt(lineTestId: string): void {
  fireEvent.contextMenu(screen.getByTestId(lineTestId));
  fireEvent.click(screen.getByTestId("code-comment-menu-add"));
}

/** Right-click a line without picking anything — asserts on the menu itself. */
export function openCommentMenuAt(lineTestId: string): void {
  fireEvent.contextMenu(screen.getByTestId(lineTestId));
}

/**
 * Select from the first line to the last one (inclusive) and release the mouse,
 * which is what makes the floating comment button appear.
 */
export function selectLines(firstTestId: string, lastTestId: string): void {
  const first = screen.getByTestId(firstTestId);
  const last = screen.getByTestId(lastTestId);
  const range = document.createRange();
  range.setStartBefore(first);
  range.setEndAfter(last);
  const selection = window.getSelection();
  if (!selection) throw new Error("jsdom has no Selection");
  selection.removeAllRanges();
  selection.addRange(range);
  // The button is computed on mouseup, so the release is part of the gesture.
  fireEvent.mouseUp(last);
}

/** Drop the text selection, then release: the button must go away. */
export function clearSelection(lastTestId: string): void {
  window.getSelection()?.removeAllRanges();
  fireEvent.mouseUp(screen.getByTestId(lastTestId));
}
