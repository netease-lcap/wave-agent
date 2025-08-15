import React from "react";
import { Box, Text } from "ink";
import type { MemoryBlock } from "../types";

interface MemoryDisplayProps {
  block: MemoryBlock;
}

export const MemoryDisplay: React.FC<MemoryDisplayProps> = ({ block }) => {
  const { content, isSuccess } = block;

  const getStatusIcon = () => {
    return isSuccess ? "💾" : "⚠️";
  };

  const getStatusColor = () => {
    return isSuccess ? "green" : "red";
  };

  const getStatusText = () => {
    return isSuccess ? "已添加到记忆" : "记忆添加失败";
  };

  return (
    <Box flexDirection="column">
      <Box>
        <Text color={getStatusColor()}>{getStatusIcon()} </Text>
        <Text color={getStatusColor()}>{getStatusText()}</Text>
      </Box>

      {content && (
        <Box marginTop={1} paddingLeft={2}>
          <Box
            borderLeft
            borderColor={isSuccess ? "green" : "red"}
            paddingLeft={1}
          >
            <Text color="gray">{content}</Text>
          </Box>
        </Box>
      )}

      {isSuccess && (
        <Box paddingLeft={2} marginTop={1}>
          <Text color="yellow" dimColor>
            记忆已保存到 LCAP.md
          </Text>
        </Box>
      )}
    </Box>
  );
};
