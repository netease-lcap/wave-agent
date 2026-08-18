import React from "react";
import { Box, Text } from "ink";
import { Markdown } from "./Markdown.js";
import { BtwState } from "../managers/inputReducer.js";
import { streamingTail } from "../utils/streamingText.js";

interface BtwDisplayProps {
  btwState: BtwState;
}

export const BtwDisplay: React.FC<BtwDisplayProps> = ({ btwState }) => {
  // Rendered for a real question (loading or answered) and for the bare
  // `/btw` usage message (question === "", answer set).
  if (!btwState.question && !btwState.answer) {
    return null;
  }

  const answer = btwState.answer ?? "";

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
            <Text color="gray">✻ Answering...</Text>
            {btwState.answer && (
              <Text color="gray" wrap="truncate-end">
                {" "}
                {streamingTail(btwState.answer)}
              </Text>
            )}
          </Box>
        ) : isError ? (
          <Text color="error">{answer}</Text>
        ) : (
          <Markdown>{answer}</Markdown>
        )}
      </Box>
      {btwState.question && btwState.answer && (
        <Box marginTop={1}>
          <Text dimColor>Escape to dismiss</Text>
        </Box>
      )}
      {!btwState.question && btwState.answer && (
        <Box marginTop={1}>
          <Text dimColor>Escape to dismiss</Text>
        </Box>
      )}
    </Box>
  );
};

BtwDisplay.displayName = "BtwDisplay";
