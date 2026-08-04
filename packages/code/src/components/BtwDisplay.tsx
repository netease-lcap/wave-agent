import React from "react";
import { Box, Text, useStdout } from "ink";
import { Markdown } from "./Markdown.js";
import { BtwState } from "../managers/inputReducer.js";

interface BtwDisplayProps {
  btwState: BtwState;
}

export const UP_ARROW = "\u2191";
export const DOWN_ARROW = "\u2193";

const CHROME_ROWS = 5;
const OUTER_CHROME_ROWS = 6;

export const BtwDisplay: React.FC<BtwDisplayProps> = ({ btwState }) => {
  const { stdout } = useStdout();
  const rows = stdout.rows ?? 24;

  // Rendered for a real question (loading or answered) and for the bare
  // `/btw` usage message (question === "", answer set).
  if (!btwState.question && !btwState.answer) {
    return null;
  }

  const maxContentHeight = Math.max(5, rows - CHROME_ROWS - OUTER_CHROME_ROWS);
  const scrollOffset = btwState.scrollOffset ?? 0;
  const answer = btwState.answer ?? "";
  const visibleAnswer = answer
    .split("\n")
    .slice(scrollOffset, scrollOffset + maxContentHeight)
    .join("\n");

  // The SDK surfaces failure as the answer string; classify by prefix so it
  // renders in error color (aligned with Claude Code's error display).
  const isError =
    !btwState.isLoading &&
    (answer.startsWith("(API error") ||
      answer.startsWith("(The model tried to call") ||
      answer === "No response received");

  return (
    <Box flexDirection="column" paddingLeft={2} marginTop={1}>
      {btwState.question && (
        <Box>
          <Text color="warning" bold>
            /btw{" "}
          </Text>
          <Text dimColor>{btwState.question}</Text>
        </Box>
      )}
      <Box marginLeft={2} marginTop={1} flexDirection="column">
        {btwState.isLoading ? (
          <Box>
            <Text color="yellow">✻ </Text>
            <Text color="warning">Answering...</Text>
          </Box>
        ) : isError ? (
          <Text color="error">{visibleAnswer}</Text>
        ) : (
          <Markdown>{visibleAnswer}</Markdown>
        )}
      </Box>
      {btwState.question && btwState.answer && (
        <Box marginLeft={2} marginTop={1}>
          <Text dimColor>
            {UP_ARROW}/{DOWN_ARROW} to scroll · Space, Enter, or Escape to
            dismiss
          </Text>
        </Box>
      )}
    </Box>
  );
};

BtwDisplay.displayName = "BtwDisplay";
