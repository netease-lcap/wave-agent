import React from "react";
import os from "os";
import { Box, Text, Static } from "ink";
import type { Message } from "wave-agent-sdk";
import { MessageBlockItem } from "./MessageBlockItem.js";

export interface MessageListProps {
  messages: Message[];
  isExpanded?: boolean;
  forceStatic?: boolean;
  version?: string;
  workdir?: string;
  model?: string;
}

export const MessageList = React.memo(
  ({
    messages,
    isExpanded = false,
    forceStatic = false,
    version,
    workdir,
    model,
  }: MessageListProps) => {
    const welcomeMessage = (
      <Box flexDirection="column" paddingTop={1}>
        <Text color="gray">
          WAVE{version ? ` v${version}` : ""}
          {model ? ` • ${model}` : ""}
        </Text>
        {workdir && (
          <Text color="gray" wrap="truncate-middle">
            {workdir.replace(os.homedir(), "~")}
          </Text>
        )}
      </Box>
    );

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
        key: `${message.id}-${blockIndex}`,
      }));
    });

    // Determine which blocks are static vs dynamic
    const blocksWithStatus = allBlocks.map((item) => {
      const { block, isLastMessage } = item;
      const isDynamic =
        !forceStatic &&
        isLastMessage &&
        ((block.type === "tool" && block.stage !== "end") ||
          (block.type === "bang" && block.isRunning));
      return { ...item, isDynamic };
    });

    const staticBlocks = blocksWithStatus.filter((b) => !b.isDynamic);
    const dynamicBlocks = blocksWithStatus.filter((b) => b.isDynamic);

    const staticItems = [
      { isWelcome: true, key: "welcome", block: undefined, message: undefined },
      ...staticBlocks.map((b) => ({ ...b, isWelcome: false })),
    ];

    return (
      <Box flexDirection="column" paddingBottom={1}>
        {/* Static items (Welcome message + Static blocks) */}
        {staticItems.length > 0 && (
          <Static items={staticItems}>
            {(item) => {
              if (item.isWelcome) {
                return (
                  <React.Fragment key={item.key}>
                    {welcomeMessage}
                  </React.Fragment>
                );
              }
              return (
                <MessageBlockItem
                  key={item.key}
                  block={item.block!}
                  message={item.message!}
                  isExpanded={isExpanded}
                  paddingTop={1}
                />
              );
            }}
          </Static>
        )}

        {/* Dynamic blocks */}
        {dynamicBlocks.length > 0 && (
          <Box flexDirection="column">
            {dynamicBlocks.map((item) => (
              <MessageBlockItem
                key={item.key}
                block={item.block}
                message={item.message}
                isExpanded={isExpanded}
                paddingTop={1}
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
