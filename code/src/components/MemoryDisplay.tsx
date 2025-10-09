import React from "react";
import { Box, Text } from "ink";
import type { MemoryBlock } from "wave-agent-sdk";

interface MemoryDisplayProps {
  block: MemoryBlock;
}

export const MemoryDisplay: React.FC<MemoryDisplayProps> = ({ block }) => {
  const { content, isSuccess, memoryType, storagePath } = block;

  const getStatusIcon = () => {
    return isSuccess ? "💾" : "⚠️";
  };

  const getStatusColor = () => {
    return isSuccess ? "green" : "red";
  };

  const getStatusText = () => {
    return isSuccess ? "已添加到记忆" : "记忆添加失败";
  };

  const getStorageText = () => {
    if (!isSuccess) return null;

    if (memoryType === "user") {
      return `记忆已保存到 ${storagePath || "user-memory.md"}`;
    } else {
      return `记忆已保存到 ${storagePath || "WAVE.md"}`;
    }
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
            {getStorageText()}
          </Text>
        </Box>
      )}
    </Box>
  );
};
