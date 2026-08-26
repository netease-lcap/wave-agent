import { useState } from "react";
import { useInput } from "ink";

export interface UseLineScrollOptions {
  /** Total number of content rows in the scrollable area. */
  totalLines: number;
  /** Number of rows visible at once (computed from the available height). */
  visibleCount: number;
}

/**
 * Fixed-height line scrolling shared by overlays whose content may exceed the
 * terminal: keeps a scroll offset clamped to the visible window and handles
 * PgUp/PgDn (full page) plus Ctrl+u/Ctrl+d (half page, aligned with Claude
 * Code's modal pager keys). Returns the clamped offset and the ↑/↓ indicator
 * flags so callers can render "N more" lines.
 *
 * Scroll position starts at the top on mount; callers that display a new
 * content set remount this hook (e.g. an overlay component keyed by content),
 * which resets the offset naturally.
 */
export function useLineScroll({
  totalLines,
  visibleCount,
}: UseLineScrollOptions): {
  scrollOffset: number;
  hasMoreAbove: boolean;
  hasMoreBelow: boolean;
} {
  const [scrollOffset, setScrollOffset] = useState(0);

  const maxScroll = Math.max(0, totalLines - visibleCount);
  const halfPage = Math.max(1, Math.ceil(visibleCount / 2));

  useInput((input, key) => {
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
  });

  const clampedOffset = Math.min(scrollOffset, maxScroll);
  return {
    scrollOffset: clampedOffset,
    hasMoreAbove: clampedOffset > 0,
    hasMoreBelow: clampedOffset + visibleCount < totalLines,
  };
}
