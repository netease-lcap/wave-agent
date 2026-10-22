import React, { useState } from "react";
import { Box, Text, useWindowSize } from "ink";
import { Markdown } from "./Markdown.js";
import { ScrolledContent } from "./ScrolledContent.js";
import { useLineScroll } from "../hooks/useLineScroll.js";
import { BtwState } from "../managers/inputReducer.js";
import { streamingTail } from "../utils/streamingText.js";

/** Rows moved by one ↑/↓ press (aligned with Claude Code's btw pager). */
export const BTW_SCROLL_LINES = 3;
/**
 * Rows the overlay leaves free inside the terminal so the frame never outgrows
 * it: its own chrome (top margin, question line, content margin, hint = 4) plus
 * the rows around it that must stay on screen (the streaming tail above, and
 * the input box + status line below = 4), plus slack for a wrapped question.
 * Claude Code reserves the same 11 rows (CHROME_ROWS 5 + OUTER_CHROME_ROWS 6).
 */
export const BTW_CHROME_ROWS = 11;
/** Smallest usable answer viewport, whatever the terminal size. */
export const BTW_MIN_VIEWPORT_ROWS = 5;
/** Footer hint with scrolling enabled — shown only while the answer overflows. */
export const BTW_SCROLL_HINT = "↑/↓ to scroll · Esc to dismiss";
/** Footer hint for an answer that fits — unchanged from before scrolling. */
export const BTW_DISMISS_HINT = "Escape to dismiss";

interface BtwDisplayProps {
  btwState: BtwState;
  /** Terminal rows. Defaults to the live window size; tests pass it explicitly
   *  so the viewport budget is deterministic. */
  rows?: number;
}

/**
 * `/btw` overlay: the question line, the answer (Markdown, or the loading
 * indicator while it streams) and the dismiss hint.
 *
 * The answer is rendered inside a fixed-height viewport rather than in the
 * frame's natural height, so a long answer cannot push the top of the terminal
 * out of reach: it scrolls with ↑/↓ (and Ctrl+P/Ctrl+N) while it overflows,
 * and the viewport is recomputed from the terminal size on resize. Esc — and
 * only Esc — dismisses the overlay.
 */
export const BtwDisplay: React.FC<BtwDisplayProps> = ({ btwState, rows }) => {
  const { rows: terminalRows } = useWindowSize();
  const availableRows = rows ?? terminalRows;
  const viewportRows = Math.max(
    BTW_MIN_VIEWPORT_ROWS,
    availableRows - BTW_CHROME_ROWS,
  );

  const answer = btwState.answer ?? "";

  // Rows really occupied by the answer (wrapped rows included), measured after
  // layout by <ScrolledContent> — see that component for why it is measured
  // instead of counted from the Markdown source. Zero while the answer is still
  // streaming: the loading line is a single row and has nothing to scroll.
  const [measuredRows, setMeasuredRows] = useState(0);
  const contentRows = btwState.isLoading ? 0 : measuredRows;

  const { scrollOffset, canScroll } = useLineScroll({
    totalLines: contentRows,
    visibleCount: viewportRows,
    lineStep: BTW_SCROLL_LINES,
    resetKey: btwState.question,
  });

  // Rendered for a real question (loading or answered) and for the bare
  // `/btw` usage message (question === "", answer set).
  if (!btwState.question && !btwState.answer) {
    return null;
  }

  // The SDK surfaces failure as the answer string; classify by prefix so it
  // renders in error color (aligned with Claude Code's error display).
  const isError =
    !btwState.isLoading &&
    (answer.startsWith("(API error") ||
      answer.startsWith("(The model tried to call") ||
      answer === "No response received");

  return (
    <Box flexDirection="column" marginTop={1}>
      {btwState.question && (
        <Box>
          <Text color="warning" bold>
            /btw{" "}
          </Text>
          <Text dimColor>{btwState.question}</Text>
        </Box>
      )}
      <Box marginTop={1} flexDirection="column">
        {btwState.isLoading ? (
          <Box>
            <Text color="gray">✻ Answering</Text>
            {btwState.answer && (
              <Text color="gray" wrap="truncate-end">
                {" "}
                {streamingTail(btwState.answer)}
              </Text>
            )}
          </Box>
        ) : (
          <ScrolledContent
            visibleRows={viewportRows}
            scrollOffset={scrollOffset}
            onMeasuredRows={setMeasuredRows}
          >
            {isError ? (
              <Text color="error">{answer}</Text>
            ) : (
              <Markdown>{answer}</Markdown>
            )}
          </ScrolledContent>
        )}
      </Box>
      {btwState.answer && (
        <Box marginTop={1}>
          <Text dimColor>{canScroll ? BTW_SCROLL_HINT : BTW_DISMISS_HINT}</Text>
        </Box>
      )}
    </Box>
  );
};

BtwDisplay.displayName = "BtwDisplay";
