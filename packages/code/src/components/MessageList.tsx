import React, { useMemo } from "react";
import { Box, Text } from "ink";
import type { Message } from "wave-agent-sdk";
import { DiffViewer } from "./DiffViewer.js";
import { CommandOutputDisplay } from "./CommandOutputDisplay.js";
import { ToolResultDisplay } from "./ToolResultDisplay.js";
import { MemoryDisplay } from "./MemoryDisplay.js";
import { usePagination } from "../hooks/usePagination.js";
import { processMessageGroups } from "../utils/messageGrouping.js";

// 渲染单个消息的函数
const renderMessageItem = (
  message: Message,
  originalIndex: number,
  pageIndex: number,
  isExpanded: boolean,
) => {
  const isPageStart = pageIndex === 0;
  const shouldShowHeader =
    message.role === "user" ||
    !message.groupInfo ||
    message.groupInfo.isGroupStart ||
    isPageStart;

  return (
    <Box key={`message-${originalIndex}`} flexDirection="column" marginTop={1}>
      {shouldShowHeader && (
        <Box>
          <Text color={message.role === "user" ? "cyan" : "green"} bold>
            {message.role === "user" ? "👤 You" : "🤖 Assistant"}
            <Text color="gray" dimColor>
              {" "}
              #{message.groupInfo?.groupRange || originalIndex + 1}
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
                {block.attributes?.imageUrls &&
                  block.attributes.imageUrls.length > 0 && (
                    <Text color="gray" dimColor>
                      {" "}
                      ({block.attributes.imageUrls.length})
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
          </Box>
        ))}
      </Box>
    </Box>
  );
};

export interface MessageListProps {
  messages: Message[];
  isLoading?: boolean;
  isCommandRunning?: boolean;
  latestTotalTokens?: number;
  isExpanded?: boolean;
}

export const MessageList: React.FC<MessageListProps> = ({
  messages,
  isLoading = false,
  isCommandRunning = false,
  latestTotalTokens = 0,
  isExpanded = false,
}) => {
  // 预处理消息，添加分组信息（仅用于显示）
  const processedMessages = useMemo(
    () => processMessageGroups(messages),
    [messages],
  );

  // 使用原始消息进行分页计算
  const { displayInfo } = usePagination(messages);

  // 获取当前页的消息，同时保留原始索引信息
  const currentMessagesWithIndex = useMemo(() => {
    return processedMessages
      .slice(displayInfo.startIndex, displayInfo.endIndex)
      .map((message, index) => ({
        message,
        originalIndex: displayInfo.startIndex + index,
        pageIndex: index,
      }));
  }, [processedMessages, displayInfo.startIndex, displayInfo.endIndex]);

  // 空消息状态
  if (processedMessages.length === 0) {
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
        {currentMessagesWithIndex.map(({ message, originalIndex, pageIndex }) =>
          renderMessageItem(message, originalIndex, pageIndex, isExpanded),
        )}
      </Box>

      {/* Loading 状态显示 - 仅在非展开状态下显示 */}
      {!isExpanded && (isLoading || isCommandRunning) && (
        <Box marginTop={1}>
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
