import React, { useLayoutEffect, useRef } from "react";
import { Box, type DOMElement } from "ink";

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
 * terminal: the content is rendered once and translated up by `scrollOffset`
 * rows, and rows outside the viewport are clipped away.
 *
 * Height is bounded by construction — a line that wraps grows the content
 * instead of the frame — so the row budget of the surrounding layout holds no
 * matter how many rows the content really needs.
 *
 * The row count is read back from the layout rather than predicted from the
 * text: by the time this effect runs, Yoga has wrapped the content to the
 * terminal width, so the computed height already includes wrapped rows.
 */
export const ScrolledContent: React.FC<ScrolledContentProps> = ({
  children,
  visibleRows,
  scrollOffset,
  onMeasuredRows,
}) => {
  const contentRef = useRef<DOMElement | null>(null);
  const reportedRows = useRef(0);

  useLayoutEffect(() => {
    const yogaNode = contentRef.current?.yogaNode;
    if (!yogaNode) {
      return;
    }
    const rows = Math.round(yogaNode.getComputedHeight());
    if (rows > 0 && rows !== reportedRows.current) {
      reportedRows.current = rows;
      onMeasuredRows(rows);
    }
  });

  return (
    <Box
      maxHeight={visibleRows}
      overflow="hidden"
      flexShrink={0}
      flexDirection="column"
    >
      <Box
        ref={contentRef}
        flexDirection="column"
        // Without this the fixed-height parent shrinks the content to fit and
        // renders garbled rows instead of clipping them.
        flexShrink={0}
        marginTop={-scrollOffset}
      >
        {children}
      </Box>
    </Box>
  );
};

ScrolledContent.displayName = "ScrolledContent";
