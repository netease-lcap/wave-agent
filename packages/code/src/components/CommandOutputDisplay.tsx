import React, { useState, useEffect } from "react";
import { Box, Text } from "ink";
import type { CommandOutputBlock } from "wave-agent-sdk";

interface CommandOutputDisplayProps {
  block: CommandOutputBlock;
  isExpanded?: boolean;
}

export const CommandOutputDisplay: React.FC<CommandOutputDisplayProps> = ({
  block,
  isExpanded = false,
}) => {
  const { command, output, isRunning, exitCode } = block;
  const [isOverflowing, setIsOverflowing] = useState(false);
  const MAX_LINES = 3; // Set maximum display lines

  // Detect if content is overflowing
  useEffect(() => {
    if (output) {
      const lines = output.split("\n");
      setIsOverflowing(!isExpanded && lines.length > MAX_LINES);
    }
  }, [output, isExpanded]);

  const getStatusColor = () => {
    if (isRunning) return "yellow";
    if (exitCode === 0) return "green";
    if (exitCode !== null && exitCode !== 0) return "red";
    return "gray"; // Unknown state
  };

  return (
    <Box flexDirection="column">
      <Box>
        <Text color={getStatusColor()}>$ </Text>
        <Text color="white">{command}</Text>
      </Box>

      {output && (
        <Box marginTop={1} flexDirection="column">
          <Box
            paddingLeft={2}
            borderLeft
            borderColor="gray"
            flexDirection="column"
            height={
              isExpanded
                ? undefined
                : Math.min(output.split("\n").length, MAX_LINES)
            }
            overflow="hidden"
          >
            <Text color="gray">
              {isOverflowing
                ? output.split("\n").slice(-MAX_LINES).join("\n")
                : output}
            </Text>
          </Box>
        </Box>
      )}
    </Box>
  );
};
