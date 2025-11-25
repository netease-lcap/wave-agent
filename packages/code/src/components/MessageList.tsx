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

    return (
      <Box flexDirection="column" paddingX={1} gap={1}>
        {/* Static messages (all except last) */}
        <Static items={messages.slice(0, -1)}>
          {(message, key) => {
            // Get previous message
            const previousMessage = key > 0 ? messages[key - 1] : undefined;
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

        {/* Last message (dynamic) */}
        <Box marginTop={-1}>
          <MessageItem
            key={messages.length - 1}
            message={messages[messages.length - 1]}
            shouldShowHeader={
              messages[messages.length - 2]?.role !==
              messages[messages.length - 1].role
            }
            isExpanded={isExpanded}
          />
        </Box>

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
