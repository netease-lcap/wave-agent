import React from "react";
import { Box, Text } from "ink";
import { Markdown } from "./Markdown.js";
import { BtwState } from "../managers/inputReducer.js";

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
          <>
            {answer !== "" && (
              <Text color="gray" wrap="truncate-end">
                {(() => {
                  const flat = answer.replace(/\n/g, "\\n");
                  return flat.length > 30 ? `…${flat.slice(-30)}` : flat;
                })()}
              </Text>
            )}
            <Text color="gray">✻ Answering...</Text>
          </>
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
