import React from "react";
import { Box, Text, Static } from "ink";
import type { Message } from "wave-agent-sdk";
import { MessageBlockItem } from "./MessageBlockItem.js";

export interface MessageListProps {
  messages: Message[];
  isExpanded?: boolean;
  hideDynamicBlocks?: boolean;
}

export const MessageList = React.memo(
  ({
    messages,
    isExpanded = false,
    hideDynamicBlocks = false,
  }: MessageListProps) => {
    // Empty message state
    if (messages.length === 0) {
      return (
        <Box flexDirection="column" gap={1}>
          <Box flexDirection="column" paddingY={1}>
            <Text color="gray">Welcome to WAVE Code Assistant!</Text>
          </Box>
        </Box>
      );
    }

    // Limit messages when expanded to prevent long rendering times
    const maxExpandedMessages = 20;
    const shouldLimitMessages =
      isExpanded && messages.length > maxExpandedMessages;
    const displayMessages = shouldLimitMessages
      ? messages.slice(-maxExpandedMessages)
      : messages;

    // Flatten messages into blocks with metadata
    const allBlocks = displayMessages.flatMap((message, index) => {
      const messageIndex = shouldLimitMessages
        ? messages.length - maxExpandedMessages + index
        : index;
      return message.blocks.map((block, blockIndex) => ({
        block,
        message,
        isLastMessage: messageIndex === messages.length - 1,
        // Unique key for each block to help Static component
        key: `${message.id || messageIndex}-${blockIndex}`,
      }));
    });

    // Determine which blocks are static vs dynamic
    const blocksWithStatus = allBlocks.map((item) => {
      const { block, isLastMessage } = item;
      const isDynamic =
        isLastMessage &&
        ((block.type === "tool" && block.stage !== "end") ||
          (block.type === "command_output" && block.isRunning));
      return { ...item, isDynamic };
    });

    const staticBlocks = blocksWithStatus.filter((b) => !b.isDynamic);
    const dynamicBlocks = hideDynamicBlocks
      ? []
      : blocksWithStatus.filter((b) => b.isDynamic);

    return (
      <Box flexDirection="column" paddingBottom={1}>
        {/* Static blocks */}
        {staticBlocks.length > 0 && (
          <Static items={staticBlocks}>
            {(item, index) => (
              <MessageBlockItem
                key={item.key}
                block={item.block}
                message={item.message}
                isExpanded={isExpanded}
                paddingTop={index > 0 ? 1 : 0}
              />
            )}
          </Static>
        )}

        {/* Dynamic blocks */}
        {dynamicBlocks.length > 0 && (
          <Box
            flexDirection="column"
            gap={1}
            paddingTop={staticBlocks.length > 0 ? 1 : 0}
          >
            {dynamicBlocks.map((item) => (
              <MessageBlockItem
                key={item.key}
                block={item.block}
                message={item.message}
                isExpanded={isExpanded}
              />
            ))}
          </Box>
        )}
      </Box>
    );
  },
);

// Add display name for debugging
MessageList.displayName = "MessageList";
