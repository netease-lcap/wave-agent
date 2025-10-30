import React from "react";
import { Box, Text } from "ink";
import type {
  SubagentBlock as SubagentBlockType,
  Message,
  MessageBlock,
} from "../../../agent-sdk/src/types.js";

interface SubagentBlockProps {
  block: SubagentBlockType;
  isExpanded?: boolean;
}

export const SubagentBlock: React.FC<SubagentBlockProps> = ({
  block,
  isExpanded = false,
}) => {
  // Status indicator mapping
  const getStatusIndicator = (status: SubagentBlockType["status"]) => {
    switch (status) {
      case "active":
        return { icon: "🔄", color: "yellow" as const };
      case "completed":
        return { icon: "✅", color: "green" as const };
      case "error":
        return { icon: "❌", color: "red" as const };
      default:
        return { icon: "⏳", color: "gray" as const };
    }
  };

  const statusInfo = getStatusIndicator(block.status);

  // Determine how many messages to show
  const messagesToShow = isExpanded
    ? block.messages.slice(-10) // Up to 10 most recent when expanded
    : block.messages.slice(-2); // Up to 2 most recent when collapsed

  return (
    <Box
      borderStyle="round"
      borderColor="magenta"
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
          <Text color="cyan">🤖 {block.subagentName}</Text>
          <Text color={statusInfo.color} dimColor={false}>
            {" "}
            {statusInfo.icon}
          </Text>
        </Box>

        {!isExpanded && (
          <Text color="gray" dimColor>
            ▶ {block.messages.length} messages
          </Text>
        )}
      </Box>

      {/* Messages Section */}
      {messagesToShow.length > 0 && (
        <Box flexDirection="column" marginTop={1}>
          {messagesToShow.map((message: Message, index: number) => (
            <Box key={index} flexDirection="column" marginBottom={0}>
              {message.blocks.map(
                (messageBlock: MessageBlock, blockIndex: number) => (
                  <Box key={blockIndex} flexDirection="column">
                    {messageBlock.type === "text" && (
                      <Text color="white">
                        {isExpanded
                          ? messageBlock.content
                          : (messageBlock.content || "").slice(0, 100) +
                            ((messageBlock.content || "").length > 100
                              ? "..."
                              : "")}
                      </Text>
                    )}

                    {messageBlock.type === "error" && (
                      <Text color="red">
                        Error:{" "}
                        {isExpanded
                          ? messageBlock.content
                          : (messageBlock.content || "").slice(0, 100) +
                            ((messageBlock.content || "").length > 100
                              ? "..."
                              : "")}
                      </Text>
                    )}

                    {messageBlock.type === "tool" && (
                      <Box flexDirection="column">
                        <Text color="gray" dimColor>
                          🔧 {messageBlock.name || "Tool"}:{" "}
                          {(messageBlock.parameters || "").slice(0, 50)}
                          {(messageBlock.parameters || "").length > 50
                            ? "..."
                            : ""}
                        </Text>
                        {messageBlock.result && (
                          <Text color="white">
                            {isExpanded
                              ? messageBlock.result
                              : messageBlock.shortResult ||
                                messageBlock.result.slice(0, 100) + "..."}
                          </Text>
                        )}
                      </Box>
                    )}
                  </Box>
                ),
              )}
            </Box>
          ))}
        </Box>
      )}

      {/* Show truncation indicator if there are more messages */}
      {!isExpanded && block.messages.length > 2 && (
        <Box marginTop={1}>
          <Text color="gray" dimColor>
            ... and {block.messages.length - 2} more messages (Ctrl+O to expand)
          </Text>
        </Box>
      )}
    </Box>
  );
};
