import React from "react";
import { Box, Text } from "ink";
import type { SlashBlock } from "wave-agent-sdk";

interface SlashDisplayProps {
  block: SlashBlock;
  isExpanded?: boolean;
}

export const SlashDisplay: React.FC<SlashDisplayProps> = ({
  block,
  isExpanded = false,
}) => {
  const { command, args, stage, shortResult, error, result } = block;

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
      </Box>

      {/* Display shortResult in collapsed state */}
      {!isExpanded && shortResult && !error && (
        <Box paddingLeft={2} flexDirection="column">
          {shortResult.split("\n").map((line, index) => (
            <Text key={index} color="gray">
              {line}
            </Text>
          ))}
        </Box>
      )}

      {/* Display complete result in expanded state */}
      {isExpanded && result && (
        <Box paddingLeft={2} flexDirection="column">
          <Text color="cyan" bold>
            Result:
          </Text>
          <Text color="white">{result}</Text>
        </Box>
      )}

      {/* Error information always displayed */}
      {error && (
        <Box paddingLeft={2}>
          <Text color="red">
            Error: {typeof error === "string" ? error : String(error)}
          </Text>
        </Box>
      )}
    </Box>
  );
};
