import React, { useEffect, useRef } from "react";
import { Box, useBoxMetrics, type DOMElement } from "ink";

export interface ScrolledContentProps {
  /** Every content row — rows are never sliced, the viewport clips them. */
  children: React.ReactNode;
  /** Largest height the viewport may take, in terminal rows (the row budget
   *  for the content area). Shorter content keeps its natural height. */
  visibleRows: number;
  /** Rows scrolled off the top. */
  scrollOffset: number;
  /** Reports the content height in terminal rows, re-reporting on change. */
  onMeasuredRows: (rows: number) => void;
}

/**
 * Hard-bounded, clipping viewport for content that can be wider than the
 * terminal: the content is rendered once and shifted up by `scrollOffset` rows,
 * and rows outside the viewport are clipped away.
 *
 * Height is bounded by construction — a line that wraps grows the content
 * instead of the frame — so the row budget of the surrounding layout holds no
 * matter how many rows the content really needs.
 *
 * The row count is read back from the layout (`useBoxMetrics`) rather than
 * predicted from the text: by the time it reports, Yoga has wrapped the content
 * to the terminal width, so the measured height already includes wrapped rows.
 */
export const ScrolledContent: React.FC<ScrolledContentProps> = ({
  children,
  visibleRows,
  scrollOffset,
  onMeasuredRows,
}) => {
  const contentRef = useRef<DOMElement | null>(null);
  const { height, hasMeasured } = useBoxMetrics(contentRef);
  const reportedRows = useRef(0);

  useEffect(() => {
    if (!hasMeasured) {
      return;
    }
    const rows = Math.round(height);
    if (rows > 0 && rows !== reportedRows.current) {
      reportedRows.current = rows;
      onMeasuredRows(rows);
    }
  }, [height, hasMeasured, onMeasuredRows]);

  return (
    <Box
      maxHeight={visibleRows}
      overflow="hidden"
      // Children are shifted up by this many rows; `overflow="hidden"` clips
      // whatever the shift pushes out of the viewport.
      contentOffsetY={scrollOffset}
      flexShrink={0}
      flexDirection="column"
    >
      <Box
        ref={contentRef}
        flexDirection="column"
        // Without this the fixed-height parent shrinks the content to fit and
        // renders garbled rows instead of clipping them.
        flexShrink={0}
      >
        {children}
      </Box>
    </Box>
  );
};

ScrolledContent.displayName = "ScrolledContent";
