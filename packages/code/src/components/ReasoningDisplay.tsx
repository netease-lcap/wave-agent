import React from "react";
import { Box, Text } from "ink";
import type { ReasoningBlock } from "wave-agent-sdk";
import { Markdown } from "./Markdown.js";

interface ReasoningDisplayProps {
  block: ReasoningBlock;
  isExpanded?: boolean;
}

export const ReasoningDisplay: React.FC<ReasoningDisplayProps> = ({
  block,
  isExpanded = false,
}) => {
  const { content } = block;

  if (!content || !content.trim()) {
    return null;
  }

  return (
    <Box
      borderRight={false}
      borderTop={false}
      borderBottom={false}
      borderStyle="classic"
      borderColor="blue"
      paddingLeft={1}
    >
      <Box flexDirection="column">
        {isExpanded ? (
          <Text color="white">{content}</Text>
        ) : (
          <Markdown>{content}</Markdown>
        )}
      </Box>
    </Box>
  );
};
