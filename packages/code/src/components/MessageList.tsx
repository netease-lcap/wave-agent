import React from "react";
import { Box, Text, Static } from "ink";
import type { Message } from "wave-agent-sdk";
import { MessageItem } from "./MessageItem.js";

export interface MessageListProps {
  messages: Message[];
  isLoading?: boolean;
  isCommandRunning?: boolean;
  isCompressing?: boolean;
  latestTotalTokens?: number;
  isExpanded?: boolean;
}

export const MessageList = React.memo(
  ({
    messages,
    isLoading = false,
    isCommandRunning = false,
    isCompressing = false,
    latestTotalTokens = 0,
    isExpanded = false,
  }: MessageListProps) => {
    // Empty message state
    if (messages.length === 0) {
      return (
        <Box flexDirection="column" paddingY={1}>
          <Text color="gray">Welcome to WAVE Code Assistant!</Text>
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
    const shouldRenderLastDynamic = isLoading || isCommandRunning;
    const staticMessages = shouldRenderLastDynamic
      ? displayMessages.slice(0, -1)
      : displayMessages;
    const dynamicMessages =
      shouldRenderLastDynamic && displayMessages.length > 0
        ? [displayMessages[displayMessages.length - 1]]
        : [];

    return (
      <Box flexDirection="column" paddingX={1} gap={1}>
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
                isStatic={true}
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
            <Box key={`dynamic-${index}`} marginTop={-1}>
              <MessageItem
                message={message}
                shouldShowHeader={previousMessage?.role !== message.role}
                isExpanded={isExpanded}
                isStatic={false}
              />
            </Box>
          );
        })}

        {(isLoading || isCommandRunning || isCompressing) && (
          <Box flexDirection="column" gap={1}>
            {isLoading && (
              <Box>
                <Text color="yellow">💭 AI is thinking... </Text>
                <Text color="gray" dimColor>
                  |{" "}
                </Text>
                <Text color="red" bold>
                  Esc
                </Text>
                <Text color="gray" dimColor>
                  {" "}
                  to abort
                </Text>
              </Box>
            )}
            {isCommandRunning && (
              <Text color="blue">🚀 Command is running...</Text>
            )}
            {isCompressing && (
              <Text color="magenta">🗜️ Compressing message history...</Text>
            )}
          </Box>
        )}

        {/* Bottom info and shortcut key hints */}
        {messages.length > 0 && (
          <Box>
            <Box justifyContent="space-between" width="100%">
              <Box>
                <Text color="gray">
                  Messages {messages.length}
                  {latestTotalTokens > 0 && (
                    <>
                      <Text color="gray" dimColor>
                        {" "}
                        |{" "}
                      </Text>
                      <Text color="blue" bold>
                        {latestTotalTokens.toLocaleString()}
                      </Text>
                      <Text color="gray" dimColor>
                        {" "}
                        tokens
                      </Text>
                    </>
                  )}
                </Text>
              </Box>
              <Text color="gray" dimColor>
                <Text color="cyan">Ctrl+O</Text> Toggle{" "}
                {isExpanded ? "Collapse" : "Expand"}
              </Text>
            </Box>
          </Box>
        )}
      </Box>
    );
  },
);

// Add display name for debugging
MessageList.displayName = "MessageList";
