/**
 * Comment-entry plumbing shared by the two code views (the diff pane and the
 * file pane).
 *
 * Both views mark every line that can carry a comment with
 * `data-comment-unit="<index>"`, where the index is the view's own unit: the
 * source line number in the file pane, the raw hunk line index in the diff pane.
 * The two entries — right click on a line, and the button that follows a text
 * selection — resolve their target from that attribute alone, so neither view
 * keeps its own copy of the interaction (Claude's file viewer and diff pane
 * share one editor extension for the same reason).
 */

export const COMMENT_UNIT_ATTR = "data-comment-unit";

/** Inclusive unit range a comment is anchored to. */
export interface CommentUnitRange {
  from: number;
  to: number;
}

/** Client point → coordinates inside a (possibly scrolling) positioned box. */
export interface CommentPoint {
  x: number;
  y: number;
}

function unitIndex(el: Element): number | null {
  const raw = el.getAttribute(COMMENT_UNIT_ATTR);
  if (raw === null) return null;
  const index = Number(raw);
  return Number.isFinite(index) ? index : null;
}

function unitElements(container: HTMLElement): HTMLElement[] {
  return Array.from(
    container.querySelectorAll<HTMLElement>(`[${COMMENT_UNIT_ATTR}]`),
  );
}

/**
 * True when the line and the selection share at least one character. A
 * collapsed-ish touch at a line boundary must not claim that line: dragging from
 * the start of line 3 to the start of line 6 selects 3–5, not 3–6. Lines with no
 * text at all (blank lines) therefore never match — harmless, because min/max
 * over the remaining lines still spans them.
 */
function overlaps(range: Range, el: HTMLElement): boolean {
  const probe = el.ownerDocument.createRange();
  probe.selectNodeContents(el);
  if (typeof probe.compareBoundaryPoints !== "function")
    return range.intersectsNode?.(el) ?? false;
  // probe.start < range.end && range.start < probe.end. Note the constant's
  // naming: `END_TO_START` compares *this* range's start with the source's end.
  return (
    probe.compareBoundaryPoints(Range.END_TO_START, range) < 0 &&
    range.compareBoundaryPoints(Range.END_TO_START, probe) < 0
  );
}

/** The live selection, when it lies inside `container` and is not collapsed. */
function liveRange(container: HTMLElement): Range | null {
  const selection =
    typeof window === "undefined" ? null : window.getSelection();
  if (!selection || selection.isCollapsed || selection.rangeCount === 0)
    return null;
  const range = selection.getRangeAt(0);
  return container.contains(range.commonAncestorContainer) ? range : null;
}

/** Unit index of the line that owns `node`, or null when it is not a line. */
export function unitIndexOf(
  node: Node | null | undefined,
  container: HTMLElement | null,
): number | null {
  if (!node || !container) return null;
  const el =
    node.nodeType === 1 ? (node as HTMLElement) : (node as Node).parentElement;
  const unit = el?.closest?.(`[${COMMENT_UNIT_ATTR}]`);
  if (!unit || !container.contains(unit)) return null;
  return unitIndex(unit);
}

/** Unit range covered by the live text selection, or null. */
export function selectedUnitRange(
  container: HTMLElement | null,
): CommentUnitRange | null {
  if (!container) return null;
  const range = liveRange(container);
  if (!range) return null;
  let from = Number.POSITIVE_INFINITY;
  let to = Number.NEGATIVE_INFINITY;
  for (const el of unitElements(container)) {
    const index = unitIndex(el);
    if (index === null || !overlaps(range, el)) continue;
    if (index < from) from = index;
    if (index > to) to = index;
  }
  return from <= to ? { from, to } : null;
}

/** Client point → coordinates inside `container`'s content box. */
export function toContainerPoint(
  container: HTMLElement,
  clientX: number,
  clientY: number,
): CommentPoint {
  const box = container.getBoundingClientRect();
  return {
    x: clientX - box.left + container.scrollLeft,
    y: clientY - box.top + container.scrollTop,
  };
}

/** Last rect of the live selection: the end of the highlighted text. */
function selectionRect(): { right: number; bottom: number } | null {
  const selection =
    typeof window === "undefined" ? null : window.getSelection();
  if (!selection || selection.rangeCount === 0) return null;
  const range = selection.getRangeAt(0);
  const rects =
    typeof range.getClientRects === "function" ? range.getClientRects() : null;
  const last = rects && rects.length > 0 ? rects[rects.length - 1] : null;
  if (last) return last;
  if (typeof range.getBoundingClientRect !== "function") return null;
  const box = range.getBoundingClientRect();
  return box.width || box.height ? box : null;
}

function unitRect(container: HTMLElement, index: number): DOMRect | null {
  const el = unitElements(container).find((node) => unitIndex(node) === index);
  return el ? el.getBoundingClientRect() : null;
}

/**
 * Where the floating comment button goes: just under the end of the selection,
 * or — when the selection has no geometry (jsdom, or a browser that reports
 * nothing) — under the last commented line.
 */
export function selectionAnchor(
  container: HTMLElement | null,
  range: CommentUnitRange,
): CommentPoint | null {
  if (!container) return null;
  const rect = selectionRect() ?? unitRect(container, range.to);
  if (!rect) return null;
  return toContainerPoint(container, rect.right, rect.bottom);
}
