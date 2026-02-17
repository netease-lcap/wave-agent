import React from "react";
import { Box, Text, Static } from "ink";
import type { Message } from "wave-agent-sdk";
import { MessageItem } from "./MessageItem.js";

export interface MessageListProps {
  messages: Message[];
  isLoading?: boolean;
  isCommandRunning?: boolean;
  isExpanded?: boolean;
  forceStaticLastMessage?: boolean;
}

export const MessageList = React.memo(
  ({
    messages,
    isLoading = false,
    isCommandRunning = false,
    isExpanded = false,
    forceStaticLastMessage = false,
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
    const omittedCount = shouldLimitMessages
      ? messages.length - maxExpandedMessages
      : 0;

    // Compute which messages to render statically vs dynamically
    const shouldRenderLastDynamic =
      !forceStaticLastMessage && (isLoading || isCommandRunning);
    const staticMessages = shouldRenderLastDynamic
      ? displayMessages.slice(0, -1)
      : displayMessages;
    const dynamicMessages =
      shouldRenderLastDynamic && displayMessages.length > 0
        ? [displayMessages[displayMessages.length - 1]]
        : [];

    return (
      <Box flexDirection="column" gap={1} paddingBottom={1}>
        {/* Show omitted message count when limiting */}
        {omittedCount > 0 && (
          <Box>
            <Text color="gray" dimColor>
              ... {omittedCount} earlier message{omittedCount !== 1 ? "s" : ""}{" "}
              omitted (showing latest {maxExpandedMessages})
            </Text>
          </Box>
        )}

        {/* Static messages */}
        <Static items={staticMessages}>
          {(message, key) => {
            // Get previous message
            const previousMessage =
              key > 0 ? staticMessages[key - 1] : undefined;
            return (
              <MessageItem
                key={key}
                message={message}
                shouldShowHeader={previousMessage?.role !== message.role}
                isExpanded={isExpanded}
              />
            );
          }}
        </Static>

        {/* Dynamic messages */}
        {dynamicMessages.map((message, index) => {
          const messageIndex = staticMessages.length + index;
          const previousMessage =
            messageIndex > 0 ? displayMessages[messageIndex - 1] : undefined;
          return (
            <Box key={`dynamic-${index}`}>
              <MessageItem
                message={message}
                shouldShowHeader={previousMessage?.role !== message.role}
                isExpanded={isExpanded}
              />
            </Box>
          );
        })}
      </Box>
    );
  },
);

// Add display name for debugging
MessageList.displayName = "MessageList";
