import { useEffect, useState } from "react";
import { useInput } from "ink";

export interface UseLineScrollOptions {
  /** Total number of content rows in the scrollable area. */
  totalLines: number;
  /** Number of rows visible at once (computed from the available height). */
  visibleCount: number;
  /**
   * Rows moved by one ↑/↓ (or Ctrl+P/Ctrl+N) press. Callers that leave it out
   * never see the arrow keys handled at all — the overlay keeps only the page
   * keys, as the /plan and confirmation overlays do.
   */
  lineStep?: number;
  /**
   * Resets the viewport to the top when this value changes. Only needed by
   * callers that swap the content of a mounted overlay (the /btw answer of the
   * next question); a component that is remounted per content set gets the
   * reset for free.
   */
  resetKey?: unknown;
}

/**
 * Fixed-height line scrolling shared by overlays whose content may exceed the
 * terminal: keeps a scroll offset clamped to the visible window and handles
 * PgUp/PgDn (full page) plus Ctrl+u/Ctrl+d (half page, aligned with Claude
 * Code's modal pager keys). With `lineStep`, ↑/↓ and Ctrl+P/Ctrl+N move that
 * many rows — the /btw viewport's keys. Returns the clamped offset, the ↑/↓
 * indicator flags so callers can render "N more" lines, and `canScroll` (the
 * content overflows the viewport).
 *
 * The handlers are active only while the content overflows: a viewport with
 * nothing to scroll must not swallow keys the surrounding UI still needs.
 *
 * Scroll position starts at the top on mount; callers that display a new
 * content set either remount this hook (e.g. an overlay component keyed by
 * content) or pass `resetKey`, which resets the offset naturally.
 */
export function useLineScroll({
  totalLines,
  visibleCount,
  lineStep,
  resetKey,
}: UseLineScrollOptions): {
  scrollOffset: number;
  hasMoreAbove: boolean;
  hasMoreBelow: boolean;
  canScroll: boolean;
} {
  const [scrollOffset, setScrollOffset] = useState(0);

  const maxScroll = Math.max(0, totalLines - visibleCount);
  const halfPage = Math.max(1, Math.ceil(visibleCount / 2));
  const canScroll = totalLines > visibleCount;

  useEffect(() => {
    setScrollOffset(0);
  }, [resetKey]);

  useInput(
    (input, key) => {
      if (key.pageUp) {
        setScrollOffset((offset) => Math.max(0, offset - visibleCount));
      }
      if (key.pageDown) {
        setScrollOffset((offset) => Math.min(maxScroll, offset + visibleCount));
      }
      // Ctrl+u/Ctrl+d scroll half a page — fallback for keyboards without
      // PgUp/PgDn (aligned with Claude Code's modal pager keys).
      if (key.ctrl && input === "u") {
        setScrollOffset((offset) => Math.max(0, offset - halfPage));
      }
      if (key.ctrl && input === "d") {
        setScrollOffset((offset) => Math.min(maxScroll, offset + halfPage));
      }
      if (lineStep) {
        // ↑/↓ scroll the viewport line by line; Ctrl+P/Ctrl+N are the same
        // keys for terminals that swallow the arrows.
        if (key.upArrow || (key.ctrl && input === "p")) {
          setScrollOffset((offset) => Math.max(0, offset - lineStep));
        }
        if (key.downArrow || (key.ctrl && input === "n")) {
          setScrollOffset((offset) => Math.min(maxScroll, offset + lineStep));
        }
      }
    },
    { isActive: canScroll },
  );

  const clampedOffset = Math.min(scrollOffset, maxScroll);
  return {
    scrollOffset: clampedOffset,
    hasMoreAbove: clampedOffset > 0,
    hasMoreBelow: clampedOffset + visibleCount < totalLines,
    canScroll,
  };
}
