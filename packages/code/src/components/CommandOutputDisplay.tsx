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
  const MAX_LINES = 10; // 设置最大显示行数

  // 检测内容是否溢出
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
    return "gray"; // 未知状态
  };

  const getStatusText = () => {
    if (isRunning) return "🔄";
    if (exitCode === 0) return "✅";
    if (exitCode === 130) return "⚠️"; // SIGINT (Ctrl+C)
    if (exitCode !== null && exitCode !== 0) return "❌";
    return ""; // 未知状态时不显示文本
  };

  return (
    <Box flexDirection="column">
      <Box>
        <Text color="cyan">$ </Text>
        <Text color="white">{command}</Text>
        <Text color={getStatusColor()}> {getStatusText()}</Text>
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
          {isOverflowing && (
            <Box paddingLeft={2} marginTop={1}>
              <Text color="yellow" dimColor>
                Content truncated ({output.split("\n").length} lines total,
                showing last {MAX_LINES} lines)
              </Text>
            </Box>
          )}
        </Box>
      )}
    </Box>
  );
};
