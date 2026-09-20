import React, { useEffect, useState } from "react";
import { Box, Text, useInput, useStdout } from "ink";
import {
  BASH_TOOL_NAME,
  EDIT_TOOL_NAME,
  WRITE_TOOL_NAME,
  EXIT_PLAN_MODE_TOOL_NAME,
  ENTER_PLAN_MODE_TOOL_NAME,
  ASK_USER_QUESTION_TOOL_NAME,
  ARTIFACT_TOOL_NAME,
} from "wave-agent-sdk";
import { buildDiffLinesFromParams } from "./DiffDisplay.js";
import { renderMarkdownToAnsi } from "./Markdown.js";
import { ScrolledContent } from "./ScrolledContent.js";
import { highlightToAnsi } from "../utils/highlightUtils.js";

// Helper function to generate descriptive action text
const getActionDescription = (
  toolName: string,
  toolInput?: Record<string, unknown>,
): string => {
  if (!toolInput) {
    return "Execute operation";
  }

  switch (toolName) {
    case BASH_TOOL_NAME:
      return `Execute command: ${toolInput.command || "unknown command"}`;
    case EDIT_TOOL_NAME:
      return `Edit file: ${toolInput.file_path || "unknown file"}`;
    case WRITE_TOOL_NAME:
      return `Write to file: ${toolInput.file_path || "unknown file"}`;
    case EXIT_PLAN_MODE_TOOL_NAME:
      return "Review and approve the plan";
    case ENTER_PLAN_MODE_TOOL_NAME:
      return "Enter plan mode for complex task planning";
    case ASK_USER_QUESTION_TOOL_NAME:
      return "Answer questions to clarify intent";
    case ARTIFACT_TOOL_NAME:
      if (toolInput.action === "read") {
        return `Read artifact: ${toolInput.url || "unknown artifact"}`;
      }
      return `Publish file: ${toolInput.file_path || "unknown file"}`;
    default:
      return "Execute operation";
  }
};

// Row budget for the scroll indicators (↑ more / ↓ more, up to one each).
const SCROLL_INDICATOR_BUDGET = 2;
// Row budget for the fixed scroll-key hint shown when content is scrollable.
const SCROLL_HINT_BUDGET = 1;

export interface ConfirmationDetailsProps {
  toolName: string;
  toolInput?: Record<string, unknown>;
  planContent?: string;
  warning?: string;
  /** Available height (rows) for the whole details block, computed by
   *  ChatInterface from the terminal size. Used to size the scrollable
   *  content area so the dynamic output never exceeds terminal height. */
  maxHeight?: number;
}

export const ConfirmationDetails: React.FC<ConfirmationDetailsProps> = ({
  toolName,
  toolInput,
  planContent,
  warning,
  maxHeight,
}) => {
  const startLineNumber =
    (toolInput?.startLineNumber as number | undefined) ??
    (toolName === WRITE_TOOL_NAME ? 1 : undefined);

  // Terminal width is needed to render the plan's Markdown (table column widths
  // are computed from it), matching <Markdown>'s own default.
  const { stdout } = useStdout();
  const columns = stdout?.columns ?? 80;

  const headerRows = 2 + (warning ? 1 : 0);

  // Number of content rows rendered at once. The header stays fixed above the
  // scrollable area; rows are budgeted for the scroll indicators and hint.
  const visibleCount = Math.max(
    1,
    (maxHeight ?? 24) -
      headerRows -
      SCROLL_INDICATOR_BUDGET -
      SCROLL_HINT_BUDGET,
  );

  // Content linearized into rows so the details area can be scrolled with
  // PgUp/PgDn while the confirmation options stay fixed at the bottom.
  const diffLines = buildDiffLinesFromParams({
    toolName,
    parameters: JSON.stringify(toolInput),
    startLineNumber,
  });

  const showToolInput =
    toolName !== WRITE_TOOL_NAME &&
    toolName !== EDIT_TOOL_NAME &&
    toolName !== EXIT_PLAN_MODE_TOOL_NAME &&
    toolName !== ENTER_PLAN_MODE_TOOL_NAME &&
    toolName !== ASK_USER_QUESTION_TOOL_NAME &&
    toolName !== BASH_TOOL_NAME &&
    !!toolInput;

  const jsonLines = showToolInput
    ? highlightToAnsi(JSON.stringify(toolInput, null, 2), "json")
        .split("\n")
        .map((line, index) => (
          <Box
            key={`json-${index}`}
            paddingLeft={2}
            borderLeft
            borderColor="cyan"
          >
            <Text>{line || " "}</Text>
          </Box>
        ))
    : [];

  const showPlan =
    toolName !== ASK_USER_QUESTION_TOOL_NAME &&
    toolName === EXIT_PLAN_MODE_TOOL_NAME &&
    !!planContent;

  // The plan is Markdown (the agent writes it to a .md file), so it is rendered
  // with the same renderer as assistant messages and then linearized into rows
  // for the row-slicing scroll above — same treatment as the JSON/diff rows.
  const planLines = showPlan
    ? renderMarkdownToAnsi(planContent!, columns)
        .split("\n")
        .map((line, index) => (
          <Box key={`plan-${index}`}>
            <Text>{line || " "}</Text>
          </Box>
        ))
    : [];

  const contentLines: React.ReactNode[] = [
    ...diffLines,
    ...jsonLines,
    ...planLines,
  ];

  // Rows really occupied by the content (wrapped rows included), measured after
  // layout by <ScrolledContent> — see that component for why it is measured
  // instead of counted from the row array.
  const [contentRows, setContentRows] = useState(0);
  const [scrollOffset, setScrollOffset] = useState(0);

  // Reset scrolling when a new confirmation appears.
  useEffect(() => {
    setScrollOffset(0);
  }, [toolName, toolInput, planContent]);

  const maxScroll = Math.max(0, contentRows - visibleCount);

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
  const hasMoreAbove = clampedOffset > 0;
  const hasMoreBelow = clampedOffset + visibleCount < contentRows;

  return (
    <Box
      flexDirection="column"
      flexShrink={0}
      borderStyle="single"
      borderColor="yellow"
      borderBottom={false}
      borderLeft={false}
      borderRight={false}
    >
      <Text color="yellow" bold wrap="truncate-end">
        Tool: {toolName}
      </Text>
      <Text color="yellow" wrap="truncate-end">
        {getActionDescription(toolName, toolInput)}
      </Text>
      {warning && (
        <Text color="red" wrap="truncate-end">
          ⚠ {warning}
        </Text>
      )}

      {hasMoreAbove && (
        <Box>
          <Text color="gray" dimColor>
            ↑ {clampedOffset} more
          </Text>
        </Box>
      )}
      <ScrolledContent
        visibleRows={visibleCount}
        scrollOffset={clampedOffset}
        onMeasuredRows={setContentRows}
      >
        {contentLines}
      </ScrolledContent>
      {hasMoreBelow && (
        <Box>
          <Text color="gray" dimColor>
            ↓ {contentRows - clampedOffset - visibleCount} more
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
    </Box>
  );
};

ConfirmationDetails.displayName = "ConfirmationDetails";
