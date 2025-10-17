import React, { useMemo } from "react";
import { Box, Text } from "ink";
import type { Message } from "wave-agent-sdk";
import { DiffViewer } from "./DiffViewer.js";
import { CommandOutputDisplay } from "./CommandOutputDisplay.js";
import { ToolResultDisplay } from "./ToolResultDisplay.js";
import { MemoryDisplay } from "./MemoryDisplay.js";
import { usePagination } from "../hooks/usePagination.js";

// 渲染单个消息的函数
const renderMessageItem = (
  message: Message,
  originalIndex: number,
  isExpanded: boolean,
  previousMessage?: Message,
) => {
  const shouldShowHeader = previousMessage?.role !== message.role;

  return (
    <Box key={`message-${originalIndex}`} flexDirection="column" marginTop={1}>
      {shouldShowHeader && (
        <Box>
          <Text
            color={
              message.role === "user"
                ? "cyan"
                : message.role === "subAgent"
                  ? "magenta"
                  : "green"
            }
            bold
          >
            {message.role === "user"
              ? "👤 You"
              : message.role === "subAgent"
                ? "⚡ Sub-Agent"
                : "🤖 Assistant"}
            <Text color="gray" dimColor>
              {" "}
              #{originalIndex + 1}
            </Text>
          </Text>
        </Box>
      )}

      <Box
        marginLeft={2}
        flexDirection="column"
        gap={1}
        marginTop={shouldShowHeader ? 1 : 0}
      >
        {message.blocks.map((block, blockIndex) => (
          <Box key={blockIndex}>
            {block.type === "text" && block.content.trim() && (
              <Box>
                <Text>{block.content}</Text>
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
              <CommandOutputDisplay block={block} isExpanded={isExpanded} />
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
              <Box>
                <Text color="yellow" bold>
                  📦 Compressed Messages
                </Text>
                <Box marginTop={1} marginLeft={2}>
                  <Text color="gray" dimColor>
                    {block.content}
                  </Text>
                </Box>
              </Box>
            )}

            {block.type === "custom_command" && (
              <Box>
                <Text>/{block.commandName}</Text>
                <Text color="gray" dimColor>
                  {" "}
                  (Custom Command)
                </Text>
              </Box>
            )}
          </Box>
        ))}
      </Box>

      {/* 子对话 - 使用递归的 MessageList */}
      {message.messages && message.messages.length > 0 && (
        <Box
          paddingLeft={2}
          paddingBottom={1}
          flexDirection="column"
          borderLeft={true}
          borderRight={false}
          borderBottom={false}
          borderTop={false}
          borderStyle="classic"
          borderColor="magenta"
        >
          <Box flexDirection="column">
            {/* 显示省略信息（如果有超过10条消息） */}
            {message.messages.length > 10 && (
              <Box marginBottom={1}>
                <Text color="gray" dimColor>
                  ... {message.messages.length - 10} earlier messages
                </Text>
              </Box>
            )}
            {/* 只显示最后10条子消息 */}
            {message.messages.slice(-10).map((subMessage, index) => {
              const originalIndex =
                Math.max(0, message.messages!.length - 10) + index;
              const previousSubMessage =
                index > 0
                  ? message.messages!.slice(-10)[index - 1]
                  : message.messages!.length > 10
                    ? message.messages![message.messages!.length - 11]
                    : undefined;

              return renderMessageItem(
                subMessage,
                originalIndex,
                isExpanded,
                previousSubMessage,
              );
            })}
          </Box>
        </Box>
      )}
    </Box>
  );
};

export interface MessageListProps {
  messages: Message[];
  isLoading?: boolean;
  isCommandRunning?: boolean;
  isCompressing?: boolean;
  latestTotalTokens?: number;
  isExpanded?: boolean;
}

export const MessageList: React.FC<MessageListProps> = ({
  messages,
  isLoading = false,
  isCommandRunning = false,
  isCompressing = false,
  latestTotalTokens = 0,
  isExpanded = false,
}) => {
  // 使用原始消息进行分页计算
  const { displayInfo } = usePagination(messages);

  // 获取当前页的消息，同时保留原始索引信息
  const currentMessagesWithIndex = useMemo(() => {
    return messages
      .slice(displayInfo.startIndex, displayInfo.endIndex)
      .map((message, index) => ({
        message,
        originalIndex: displayInfo.startIndex + index,
      }));
  }, [messages, displayInfo.startIndex, displayInfo.endIndex]);

  // 空消息状态
  if (messages.length === 0) {
    return (
      <Box flexDirection="column" paddingY={1}>
        <Text color="gray">Welcome to WAVE Code Assistant!</Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column">
      {/* 消息列表 */}
      <Box flexDirection="column">
        {currentMessagesWithIndex.map(({ message, originalIndex }) => {
          // 获取前一个消息
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

      {/* Loading 状态显示 - 仅在非展开状态下显示 */}
      {!isExpanded && (isLoading || isCommandRunning || isCompressing) && (
        <Box marginTop={1} flexDirection="column" gap={1}>
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

      {/* 底部信息和快捷键提示 */}
      {messages.length > 0 && (
        <Box marginTop={1}>
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
};
