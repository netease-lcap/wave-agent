import React from "react";
import { Box, Text } from "ink";
import type { ToolBlock } from "../types";

interface ToolResultDisplayProps {
  block: ToolBlock;
  isExpanded?: boolean;
}

export const ToolResultDisplay: React.FC<ToolResultDisplayProps> = ({
  block,
  isExpanded = false,
}) => {
  const { parameters, result, attributes } = block;

  const getStatusColor = () => {
    if (attributes?.isStreaming) return "blue";
    if (attributes?.isRunning) return "yellow";
    if (attributes?.success) return "green";
    return "red";
  };

  const getStatusText = () => {
    if (attributes?.isStreaming) return "📡 Streaming parameters...";
    if (attributes?.isRunning) return "🔄 Running...";
    if (attributes?.success) return "✅";
    return "❌ Failed";
  };

  const toolName = attributes?.name ? String(attributes.name) : "Tool";

  // 获取shortResult，如果没有则显示result的后5行
  const getShortResult = () => {
    if (block.shortResult) {
      return block.shortResult;
    }

    // 如果没有shortResult，且有result，返回后5行
    if (block.result) {
      const lines = block.result.split("\n");
      if (lines.length > 5) {
        return lines.slice(-5).join("\n");
      }
      return block.result;
    }

    return null;
  };

  const shortResult = getShortResult();

  return (
    <Box flexDirection="column" gap={1}>
      <Box>
        <Text color="magenta">🔧 </Text>
        <Text color="white">{toolName}</Text>
        {/* 折叠状态下显示 compactParams */}
        {!isExpanded && block.compactParams && (
          <Text color="gray"> ({block.compactParams})</Text>
        )}
        <Text color={getStatusColor()}> {getStatusText()}</Text>
      </Box>

      {/* 折叠状态下显示shortResult */}
      {!isExpanded && shortResult && (
        <Box
          paddingLeft={2}
          borderLeft
          borderColor="gray"
          flexDirection="column"
        >
          {shortResult.split("\n").map((line, index) => (
            <Text key={index} color="white">
              {line}
            </Text>
          ))}
        </Box>
      )}

      {/* 展开状态下显示完整参数 */}
      {isExpanded && parameters && (
        <Box
          paddingLeft={2}
          borderLeft
          borderColor="gray"
          flexDirection="column"
        >
          <Text color="cyan" bold>
            Parameters:
          </Text>
          <Text color="gray">{parameters}</Text>
        </Box>
      )}

      {/* 展开状态下显示完整结果 */}
      {isExpanded && result && (
        <Box flexDirection="column">
          <Box
            paddingLeft={2}
            borderLeft
            borderColor="green"
            flexDirection="column"
          >
            <Text color="cyan" bold>
              Result:
            </Text>
            <Text color="white">{result}</Text>
          </Box>
        </Box>
      )}

      {/* 错误信息始终显示 */}
      {attributes?.error && (
        <Box>
          <Text color="red">
            Error:{" "}
            {typeof attributes.error === "string"
              ? attributes.error
              : String(attributes.error)}
          </Text>
        </Box>
      )}
    </Box>
  );
};
