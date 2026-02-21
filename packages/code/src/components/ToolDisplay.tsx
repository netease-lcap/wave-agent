import React from "react";
import { Box, Text } from "ink";
import type { ToolBlock } from "wave-agent-sdk";
import { DiffDisplay } from "./DiffDisplay.js";

interface ToolDisplayProps {
  block: ToolBlock;
  isExpanded?: boolean;
}

export const ToolDisplay: React.FC<ToolDisplayProps> = ({
  block,
  isExpanded = false,
}) => {
  const { parameters, result, compactParams, stage, success, error, name } =
    block;

  // Directly use compactParams
  // (no change needed as we destructured it above)

  const getStatusColor = () => {
    if (stage === "running") return "yellow";
    if (success) return "green";
    if (error || success === false) return "red";
    return "gray"; // Unknown state or no state information
  };

  const hasImages = () => {
    return block.images && block.images.length > 0;
  };

  const getImageIndicator = () => {
    if (!hasImages()) return "";
    const imageCount = block.images!.length;
    return imageCount === 1 ? "🖼️" : `🖼️×${imageCount}`;
  };

  const toolName = name ? String(name) : "Tool";

  // Get shortResult, if not available show last 5 lines of result
  const getShortResult = () => {
    if (block.shortResult) {
      return block.shortResult;
    }

    // If no shortResult but has result, return last 5 lines
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
    <Box flexDirection="column">
      <Box>
        <Box flexShrink={0}>
          <Text color={getStatusColor()}>● </Text>
          <Text color="white">{toolName}</Text>
        </Box>
        {/* Display compactParams in collapsed state */}
        {!isExpanded && compactParams && (
          <Text color="gray"> {compactParams}</Text>
        )}
        {/* Display image indicator */}
        {hasImages() && <Text color="blue"> {getImageIndicator()}</Text>}
      </Box>

      {/* Display shortResult in collapsed state */}
      {!isExpanded && shortResult && !error && (
        <Box
          paddingLeft={2}
          borderLeft
          borderColor="gray"
          flexDirection="column"
        >
          {shortResult.split("\n").map((line, index) => (
            <Text key={index} color="gray">
              {line}
            </Text>
          ))}
        </Box>
      )}

      {/* Display complete parameters in expanded state */}
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

      {/* Display complete result in expanded state */}
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

      {/* Error information always displayed */}
      {error && (
        <Box>
          <Text color="red">
            Error: {typeof error === "string" ? error : String(error)}
          </Text>
        </Box>
      )}

      {/* Diff display - only show after tool execution completes and was successful */}
      {stage === "end" && success && (
        <DiffDisplay toolName={name} parameters={parameters} />
      )}
    </Box>
  );
};
