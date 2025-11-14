import React from "react";
import { Box, Text } from "ink";
import { HookBlock, HookEventName } from "wave-agent-sdk";

export interface HookBlockProps {
  block: HookBlock;
  onExpand?: () => void;
  isExpanded?: boolean;
}

// Helper function to get icon and color for hook event type
function getHookEventDisplay(hookEvent: HookEventName): {
  icon: string;
  color: 'blue' | 'green' | 'magenta' | 'red' | 'gray';
} {
  switch (hookEvent) {
    case "PreToolUse":
      return { icon: "🔧", color: "blue" };
    case "PostToolUse":
      return { icon: "✅", color: "green" };
    case "UserPromptSubmit":
      return { icon: "💬", color: "magenta" };
    case "Stop":
      return { icon: "🛑", color: "red" };
    default:
      return { icon: "🔗", color: "gray" };
  }
}

export function HookBlockComponent({ 
  block, 
  isExpanded = false
}: HookBlockProps) {
  const display = getHookEventDisplay(block.hookEvent);
  const hasMetadata = block.metadata && Object.keys(block.metadata).length > 0;
  const shouldTruncate = block.content.length > 100;
  const showExpanded = isExpanded;

  return (
    <Box
      borderStyle="round"
      borderColor={display.color}
      paddingX={1}
      paddingY={0}
      flexDirection="column"
      marginBottom={1}
    >
      {/* Header Section */}
      <Box
        flexDirection="row"
        justifyContent="space-between"
        alignItems="center"
      >
        <Box flexDirection="row" alignItems="center">
          <Text color={display.color}>
            {display.icon} Hook: {block.hookEvent}
          </Text>
        </Box>

        {(hasMetadata || shouldTruncate) && (
          <Text color="gray" dimColor>
            {showExpanded ? "Less" : "More"} (Press 'h' to toggle)
          </Text>
        )}
      </Box>

      {/* Content Section */}
      <Box marginTop={1} flexDirection="column">
        <Text color={display.color}>
          {showExpanded || !shouldTruncate ? (
            block.content
          ) : (
            `${block.content.slice(0, 100)}...`
          )}
        </Text>

        {/* Metadata Section */}
        {showExpanded && hasMetadata && (
          <Box marginTop={1} flexDirection="column">
            <Text color={display.color} bold>
              Metadata:
            </Text>
            <Text color="gray">
              {JSON.stringify(block.metadata, null, 2)}
            </Text>
          </Box>
        )}
      </Box>
    </Box>
  );
}

export default HookBlockComponent;