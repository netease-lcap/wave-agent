import React, { useLayoutEffect, useRef } from "react";
import os from "os";
import { Box, Text, Static, measureElement } from "ink";
import type { Message } from "wave-agent-sdk";
import { MessageBlockItem } from "./MessageBlockItem.js";

export interface MessageListProps {
  messages: Message[];
  isExpanded?: boolean;
  forceStatic?: boolean;
  version?: string;
  workdir?: string;
  model?: string;
  onDynamicBlocksHeightMeasured?: (height: number) => void;
}

export const MessageList = React.memo(
  ({
    messages,
    isExpanded = false,
    forceStatic = false,
    version,
    workdir,
    model,
    onDynamicBlocksHeightMeasured,
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

    // Limit messages to prevent long rendering times
    const maxMessages = 10;

    // Flatten messages into blocks with metadata
    const allBlocks = messages.flatMap((message, messageIndex) => {
      return message.blocks.map((block, blockIndex) => ({
        block,
        message,
        messageIndex,
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

    const dynamicBlocksRef = useRef(null);

    useLayoutEffect(() => {
      if (dynamicBlocksRef.current) {
        const { height } = measureElement(dynamicBlocksRef.current);
        onDynamicBlocksHeightMeasured?.(height);
      } else {
        onDynamicBlocksHeightMeasured?.(0);
      }
    }, [dynamicBlocks, isExpanded, onDynamicBlocksHeightMeasured]);

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
                messages.length > maxMessages &&
                item.messageIndex < messages.length - maxMessages
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
          <Box ref={dynamicBlocksRef} flexDirection="column">
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
