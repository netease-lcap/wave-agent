import React from "react";
import { Box, Text, useInput, useWindowSize } from "ink";
import { useLineScroll } from "../hooks/useLineScroll.js";

// Row budget for the scroll indicators (↑ more / ↓ more, up to one each).
const SCROLL_INDICATOR_BUDGET = 2;
// Row budget for the fixed scroll-key hint shown when content is scrollable.
const SCROLL_HINT_BUDGET = 1;
// Overlay height as a fraction of the terminal height (spec: 50-60%).
const PLAN_OVERLAY_HEIGHT_RATIO = 0.55;

export interface PlanViewProps {
  path?: string;
  content?: string;
  message?: string;
  /** Available height (rows) for the whole overlay, computed by default from
   *  the terminal size. Tests pass it explicitly for determinism. */
  maxHeight?: number;
  onCancel: () => void;
}

/**
 * Overlay shown by the /plan command:
 * - With `message` only: a plain status line (e.g. "Enabled plan mode").
 * - With `path`/`content`: the current plan file contents as plain text lines
 *   (no Markdown), fixed at ~55% of the terminal height with PgUp/PgDn and
 *   Ctrl+u/Ctrl+d scrolling and ↑/↓ "N more" indicators.
 * Esc dismisses the overlay.
 */
export const PlanView: React.FC<PlanViewProps> = ({
  path,
  content,
  message,
  maxHeight,
  onCancel,
}) => {
  const { rows } = useWindowSize();
  const overlayMaxHeight =
    maxHeight ?? Math.max(Math.round(rows * PLAN_OVERLAY_HEIGHT_RATIO), 10);

  const isMessageOnly = message !== undefined && content === undefined;

  useInput((_input, key) => {
    if (key.escape) {
      onCancel();
    }
  });

  // Hook order must be stable across renders, so compute the scroll state
  // before the message-only early return.
  const headerRows = 2 + (path ? 1 : 0); // "Current Plan" + path + footer hint
  const visibleCount = Math.max(
    1,
    overlayMaxHeight -
      headerRows -
      SCROLL_INDICATOR_BUDGET -
      SCROLL_HINT_BUDGET,
  );
  const planLines =
    !isMessageOnly && content !== undefined && content !== ""
      ? content.split("\n")
      : [];
  const { scrollOffset, hasMoreAbove, hasMoreBelow } = useLineScroll({
    totalLines: planLines.length,
    visibleCount,
  });

  if (isMessageOnly) {
    return (
      <Box
        flexDirection="column"
        paddingX={1}
        borderStyle="single"
        borderColor="cyan"
        borderLeft={false}
        borderRight={false}
      >
        <Text color="cyan">{message}</Text>
        <Text dimColor>Press Escape to continue</Text>
      </Box>
    );
  }

  const visibleLines = planLines.slice(
    scrollOffset,
    scrollOffset + visibleCount,
  );

  return (
    <Box
      flexDirection="column"
      paddingX={1}
      borderStyle="single"
      borderColor="cyan"
      borderLeft={false}
      borderRight={false}
    >
      <Text color="cyan" bold>
        Current Plan
      </Text>
      {path ? (
        <Text dimColor wrap="truncate-end">
          {path}
        </Text>
      ) : null}
      {hasMoreAbove && (
        <Box>
          <Text color="gray" dimColor>
            ↑ {scrollOffset} more
          </Text>
        </Box>
      )}
      {visibleLines.length > 0 ? (
        visibleLines.map((line, index) => (
          <Box key={scrollOffset + index}>
            <Text>{line || " "}</Text>
          </Box>
        ))
      ) : (
        <Text>No plan written yet.</Text>
      )}
      {hasMoreBelow && (
        <Box>
          <Text color="gray" dimColor>
            ↓ {planLines.length - scrollOffset - visibleCount} more
          </Text>
        </Box>
      )}
      {(hasMoreAbove || hasMoreBelow) && (
        <Box>
          <Text color="gray" dimColor>
            PgUp/PgDn page • Ctrl+u/d half page
          </Text>
        </Box>
      )}
      <Text dimColor>Press Escape to continue</Text>
    </Box>
  );
};

PlanView.displayName = "PlanView";
