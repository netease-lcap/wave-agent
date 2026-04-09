import React from "react";
import { Box, Text } from "ink";
import type { BangBlock } from "wave-agent-sdk";
import { getLastLines } from "wave-agent-sdk";

interface BangDisplayProps {
  block: BangBlock;
  isExpanded?: boolean;
}

export const BangDisplay: React.FC<BangDisplayProps> = ({
  block,
  isExpanded = false,
}) => {
  const { command, output, stage, exitCode } = block;
  const MAX_LINES = 3; // Set maximum display lines

  const getStatusColor = () => {
    if (stage === "running") return "yellow";
    if (exitCode === 0) return "green";
    if (exitCode !== null && exitCode !== 0) return "red";
    return "gray"; // Unknown state
  };

  return (
    <Box flexDirection="column">
      <Box>
        <Text color={getStatusColor()}>! </Text>
        <Text color="white">{command}</Text>
      </Box>

      {output && (
        <Box paddingLeft={2} overflow="hidden">
          <Text color="gray">
            {isExpanded ? output : getLastLines(output, MAX_LINES)}
          </Text>
        </Box>
      )}
    </Box>
  );
};
