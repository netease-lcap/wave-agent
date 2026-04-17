import React from "react";
import os from "os";
import { Box, Text, Static } from "ink";
import type { Message, MessageBlock } from "wave-agent-sdk";
import { MessageBlockItem } from "./MessageBlockItem.js";

export interface MessageListProps {
  messages: Message[];
  isExpanded?: boolean;
  forceStatic?: boolean;
  version?: string;
  workdir?: string;
}

export const MessageList = React.memo(
  ({
    messages,
    isExpanded = false,
    forceStatic = false,
    version,
    workdir,
  }: MessageListProps) => {
    const welcomeMessage = (
      <Box flexDirection="column" paddingTop={1}>
        <Text color="gray">WAVE{version ? ` v${version}` : ""}</Text>
        {workdir && (
          <Text color="gray" wrap="truncate-middle">
            {workdir.replace(os.homedir(), "~")}
          </Text>
        )}
      </Box>
    );

    // Limit messages to prevent long rendering times
    const maxMessages = 10;

    // Filter out meta messages
    const visibleMessages = messages.filter((m) => !m.isMeta);

    const isRunning = (b: MessageBlock) =>
      (b.type === "tool" &&
        (b.stage === "running" ||
          b.stage === "streaming" ||
          b.stage === "start")) ||
      (b.type === "bang" && b.stage === "running") ||
      (b.type === "reasoning" && b.stage === "streaming") ||
      (b.type === "text" && b.stage === "streaming");

    // Flatten messages into blocks with metadata
    // Include streaming text blocks (rendered as truncated gray text)
    const allBlocks = visibleMessages.flatMap((message, messageIndex) => {
      return message.blocks.map((block, blockIndex) => ({
        block,
        message,
        messageIndex,
        // Unique key for each block to help Static component
        key: `${message.id}-${blockIndex}`,
      }));
    });

    // Find message indices that have any running/streaming block
    const runningMessageIndices = new Set<number>();
    for (const item of allBlocks) {
      if (isRunning(item.block)) {
        runningMessageIndices.add(item.messageIndex);
      }
    }

    // Determine which blocks are static vs dynamic
    // Blocks not in the last message are always static.
    // For the last message: if any block is running/streaming, blocks in that message are dynamic,
    // except text/reasoning blocks that have already completed (stage === "end")
    const lastMessageIndex = visibleMessages.length - 1;
    const blocksWithStatus = allBlocks.map((item) => {
      const isInLastMessage = item.messageIndex === lastMessageIndex;
      const isBlockCompleted =
        (item.block.type === "text" || item.block.type === "reasoning") &&
        item.block.stage === "end";
      const isDynamic =
        !forceStatic &&
        !isExpanded &&
        isInLastMessage &&
        !isBlockCompleted &&
        runningMessageIndices.has(item.messageIndex);
      return { ...item, isDynamic };
    });

    const staticBlocks = blocksWithStatus.filter((b) => !b.isDynamic);
    const dynamicBlocks = blocksWithStatus.filter((b) => b.isDynamic);

    const staticItems = [
      {
        isWelcome: true,
        key: "welcome",
        block: undefined,
        message: undefined,
        messageIndex: -1,
      },
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
              if (
                visibleMessages.length > maxMessages &&
                item.messageIndex < visibleMessages.length - maxMessages
              ) {
                return null;
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
