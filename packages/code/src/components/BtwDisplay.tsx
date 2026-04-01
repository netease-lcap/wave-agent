import React from "react";
import { Box, Text } from "ink";
import { Markdown } from "./Markdown.js";
import { BtwState } from "../managers/inputReducer.js";

interface BtwDisplayProps {
  btwState: BtwState;
}

export const BtwDisplay: React.FC<BtwDisplayProps> = ({ btwState }) => {
  if (!btwState.isActive) {
    return null;
  }

  return (
    <Box flexDirection="column" marginTop={0} marginBottom={1}>
      {btwState.question && (
        <Box>
          <Text color={btwState.isLoading ? "yellow" : "green"}>● </Text>
          <Text italic color="gray">
            /btw {btwState.question}
          </Text>
        </Box>
      )}

      {btwState.answer && (
        <Box flexDirection="column">
          <Markdown>{btwState.answer}</Markdown>
        </Box>
      )}
    </Box>
  );
};
