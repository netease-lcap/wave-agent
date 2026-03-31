import React from "react";
import { Box, Text } from "ink";
import { Markdown } from "./Markdown.js";
import chalk from "chalk";
import { BtwState } from "../managers/inputReducer.js";

interface BtwDisplayProps {
  btwState: BtwState;
}

export const BtwDisplay: React.FC<BtwDisplayProps> = ({ btwState }) => {
  if (!btwState.isActive) {
    return null;
  }

  return (
    <Box flexDirection="column" paddingX={1} marginTop={0} marginBottom={0}>
      <Box>
        <Text bold color="cyan">
          BY THE WAY
        </Text>
      </Box>

      {btwState.question ? (
        <Box flexDirection="column">
          <Text italic color="gray">
            Question: {btwState.question}
          </Text>
        </Box>
      ) : (
        <Box>
          <Text color="yellow">Type your side question and press Enter...</Text>
        </Box>
      )}

      {btwState.isLoading && (
        <Box>
          <Text color="yellow">AI is answering...</Text>
        </Box>
      )}

      {btwState.answer && (
        <Box flexDirection="column">
          <Markdown>{btwState.answer}</Markdown>
        </Box>
      )}

      <Box>
        <Text dimColor>Press {chalk.bold("ESC")} to dismiss</Text>
      </Box>
    </Box>
  );
};
