import React, { useMemo, useCallback } from "react";
import { Box, Text } from "ink";
import { parse, setOptions } from "marked";
import TerminalRenderer from "marked-terminal";
import type { Message } from "wave-agent-sdk";
import { MessageSource } from "wave-agent-sdk";
import { DiffViewer } from "./DiffViewer.js";
import { CommandOutputDisplay } from "./CommandOutputDisplay.js";
import { ToolResultDisplay } from "./ToolResultDisplay.js";
import { MemoryDisplay } from "./MemoryDisplay.js";
import { CompressDisplay } from "./CompressDisplay.js";
import { SubagentBlock } from "./SubagentBlock.js";
import { usePagination } from "../hooks/usePagination.js";

export interface MessageListProps {
  messages: Message[];
  isLoading?: boolean;
  isCommandRunning?: boolean;
  isCompressing?: boolean;
  latestTotalTokens?: number;
  isExpanded?: boolean;
}

// Markdown component using marked-terminal with syntax highlighting support
const Markdown = ({ children }: { children: string }) => {
  setOptions({
    renderer: new TerminalRenderer(
      {}, // Use default options
      {}, // Empty highlightOptions, let cli-highlight auto-detect language
    ) as unknown as Parameters<typeof setOptions>[0]["renderer"],
  });
  const result = parse(children);
  const output = typeof result === "string" ? result.trim() : "";
  return <Text>{output}</Text>;
};

export const MessageList = React.memo(
  ({
    messages,
    isLoading = false,
    isCommandRunning = false,
    isCompressing = false,
    latestTotalTokens = 0,
    isExpanded = false,
  }: MessageListProps) => {
    // Memoize the renderMessageItem function to prevent recreation on every render
    const renderMessageItem = useCallback(
      (
        message: Message,
        originalIndex: number,
        isExpanded: boolean,
        previousMessage?: Message,
      ) => {
        const shouldShowHeader = previousMessage?.role !== message.role;

        return (
          <Box key={`message-${originalIndex}`} flexDirection="column">
            {shouldShowHeader && (
              <Box>
                <Text color={message.role === "user" ? "cyan" : "green"} bold>
                  {message.role === "user" ? "👤 You" : "🤖 Assistant"}
                  <Text color="gray" dimColor>
                    {" "}
                    #{originalIndex + 1}
                  </Text>
                </Text>
              </Box>
            )}

            <Box
              flexDirection="column"
              gap={1}
              marginTop={shouldShowHeader ? 1 : 0}
            >
              {message.blocks.map((block, blockIndex) => (
                <Box key={blockIndex}>
                  {block.type === "text" && block.content.trim() && (
                    <Box>
                      {block.customCommandContent && (
                        <Text color="cyan" bold>
                          ⚡{" "}
                        </Text>
                      )}
                      {block.source === MessageSource.HOOK && (
                        <Text color="magenta" bold>
                          🔗{" "}
                        </Text>
                      )}
                      <Markdown>{block.content}</Markdown>
                    </Box>
                  )}

                  {block.type === "error" && (
                    <Box>
                      <Text color="red">❌ Error: {block.content}</Text>
                    </Box>
                  )}

                  {block.type === "diff" && (
                    <DiffViewer block={block} isExpanded={isExpanded} />
                  )}

                  {block.type === "command_output" && (
                    <CommandOutputDisplay
                      block={block}
                      isExpanded={isExpanded}
                    />
                  )}

                  {block.type === "tool" && (
                    <ToolResultDisplay block={block} isExpanded={isExpanded} />
                  )}

                  {block.type === "image" && (
                    <Box>
                      <Text color="magenta" bold>
                        📷 Image
                      </Text>
                      {block.imageUrls && block.imageUrls.length > 0 && (
                        <Text color="gray" dimColor>
                          {" "}
                          ({block.imageUrls.length})
                        </Text>
                      )}
                    </Box>
                  )}

                  {block.type === "memory" && <MemoryDisplay block={block} />}

                  {block.type === "compress" && (
                    <CompressDisplay block={block} isExpanded={isExpanded} />
                  )}

                  {block.type === "subagent" && (
                    <SubagentBlock block={block} isExpanded={isExpanded} />
                  )}
                </Box>
              ))}
            </Box>
          </Box>
        );
      },
      [],
    );
    // Use original messages for pagination calculation
    const { displayInfo } = usePagination(messages);

    // Get current page messages while preserving original index information
    const currentMessagesWithIndex = useMemo(() => {
      return messages
        .slice(displayInfo.startIndex, displayInfo.endIndex)
        .map((message, index) => ({
          message,
          originalIndex: displayInfo.startIndex + index,
        }));
    }, [messages, displayInfo.startIndex, displayInfo.endIndex]);

    // Empty message state
    if (messages.length === 0) {
      return (
        <Box flexDirection="column" paddingY={1}>
          <Text color="gray">Welcome to WAVE Code Assistant!</Text>
        </Box>
      );
    }

    return (
      <Box flexDirection="column" gap={1} paddingX={1}>
        {/* Message list */}
        <Box flexDirection="column" gap={1}>
          {currentMessagesWithIndex.map(({ message, originalIndex }) => {
            // Get previous message
            const previousMessage =
              originalIndex > 0 ? messages[originalIndex - 1] : undefined;
            return renderMessageItem(
              message,
              originalIndex,
              isExpanded,
              previousMessage,
            );
          })}
        </Box>

        {/* Loading state display - only show in non-expanded state */}
        {!isExpanded && (isLoading || isCommandRunning || isCompressing) && (
          <Box flexDirection="column" gap={1}>
            {isLoading && (
              <Box>
                <Text color="yellow">💭 AI is thinking... </Text>
                <Text color="gray" dimColor>
                  {" "}
                  |{" "}
                </Text>
                <Text color="blue" bold>
                  {latestTotalTokens.toLocaleString()}
                </Text>
                <Text color="gray" dimColor>
                  {" "}
                  tokens |{" "}
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
                  Messages {messages.length} Page {displayInfo.currentPage}/
                  {displayInfo.totalPages}
                </Text>
                <Text color="gray" dimColor>
                  {" "}
                  ← <Text color="cyan">Ctrl+U/D</Text> Navigate
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
