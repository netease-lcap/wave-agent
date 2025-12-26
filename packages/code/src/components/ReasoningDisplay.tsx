import React from "react";
import { Box } from "ink";
import type { ReasoningBlock } from "wave-agent-sdk";
import { Markdown } from "./Markdown.js";

interface ReasoningDisplayProps {
  block: ReasoningBlock;
}

export const ReasoningDisplay: React.FC<ReasoningDisplayProps> = ({
  block,
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
        <Markdown>{content}</Markdown>
      </Box>
    </Box>
  );
};
