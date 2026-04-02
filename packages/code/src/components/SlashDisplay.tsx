import React from "react";
import { Box, Text } from "ink";
import type { SlashBlock } from "wave-agent-sdk";

interface SlashDisplayProps {
  block: SlashBlock;
}

export const SlashDisplay: React.FC<SlashDisplayProps> = ({ block }) => {
  const { command, args, stage, shortResult } = block;

  const getStatusColor = () => {
    switch (stage) {
      case "running":
        return "yellow";
      case "success":
        return "green";
      case "error":
        return "red";
      case "aborted":
        return "gray";
      default:
        return "white";
    }
  };

  return (
    <Box flexDirection="column">
      <Box>
        <Text color={getStatusColor()}>/ </Text>
        <Text color="white">{command}</Text>
        {args && <Text color="gray"> {args}</Text>}
        {shortResult && <Text color="gray"> {shortResult}</Text>}
      </Box>
    </Box>
  );
};
