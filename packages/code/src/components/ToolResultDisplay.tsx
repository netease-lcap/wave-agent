import React from "react";
import { Box, Text } from "ink";
import type { ToolBlock } from "wave-agent-sdk";

interface ToolResultDisplayProps {
  block: ToolBlock;
  isExpanded?: boolean;
}

export const ToolResultDisplay: React.FC<ToolResultDisplayProps> = ({
  block,
  isExpanded = false,
}) => {
  const { parameters, result, attributes } = block;

  // 直接从 attributes 获取 compactParams
  const compactParams = attributes?.compactParams;

  const getStatusColor = () => {
    if (attributes?.isRunning) return "yellow";
    if (attributes?.success) return "green";
    if (attributes?.error || attributes?.success === false) return "red";
    return "gray"; // 未知状态或无状态信息
  };

  const getStatusText = () => {
    if (attributes?.isRunning) return "🔄";
    if (attributes?.success) return "";
    if (attributes?.error || attributes?.success === false) return "❌ Failed";
    return ""; // 未知状态时不显示文本
  };

  const hasImages = () => {
    return block.images && block.images.length > 0;
  };

  const getImageIndicator = () => {
    if (!hasImages()) return "";
    const imageCount = block.images!.length;
    return imageCount === 1 ? "🖼️" : `🖼️×${imageCount}`;
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
        {!isExpanded && compactParams && (
          <Text color="gray"> ({compactParams})</Text>
        )}
        <Text color={getStatusColor()}> {getStatusText()}</Text>
        {/* 显示图片指示器 */}
        {hasImages() && <Text color="blue"> {getImageIndicator()}</Text>}
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
