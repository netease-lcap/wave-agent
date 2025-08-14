import React, { useState } from "react";
import { Box, Text, useInput } from "ink";
import type { Message } from "../types";
import { DiffViewer } from "./DiffViewer";
import { CommandOutputDisplay } from "./CommandOutputDisplay";
import { ToolResultDisplay } from "./ToolResultDisplay";
import { usePagination } from "../hooks/usePagination";

export interface MessageListProps {
  messages: Message[];
  isLoading?: boolean;
}

export const MessageList: React.FC<MessageListProps> = ({
  messages,
  isLoading,
}) => {
  const { displayInfo } = usePagination(messages);
  const [isExpanded, setIsExpanded] = useState(false);

  // 监听 Ctrl+R 快捷键切换折叠/展开状态
  useInput((input, key) => {
    if (key.ctrl && input === "r") {
      setIsExpanded((prev) => !prev);
    }
  });

  // 空消息状态
  if (messages.length === 0) {
    return (
      <Box flexDirection="column" paddingY={1}>
        <Text color="gray">Welcome to LCAP Code Assistant!</Text>
      </Box>
    );
  }

  // 获取当前页的消息
  const currentMessages = messages.slice(
    displayInfo.startIndex,
    displayInfo.endIndex,
  );

  return (
    <Box flexDirection="column">
      {/* 消息列表 */}
      <Box flexDirection="column">
        {currentMessages.map((message, index) => {
          const messageIndex = displayInfo.startIndex + index;
          return (
            <Box key={messageIndex} flexDirection="column" marginTop={1}>
              <Box>
                <Text color={message.role === "user" ? "cyan" : "green"} bold>
                  {message.role === "user" ? "👤 You" : "🤖 Assistant"}
                  <Text color="gray" dimColor>
                    {" "}
                    #{messageIndex + 1}
                  </Text>
                </Text>
              </Box>

              <Box marginLeft={2} flexDirection="column" gap={1} marginTop={1}>
                {message.blocks.map((block, blockIndex) => (
                  <Box key={blockIndex}>
                    {block.type === "text" && (
                      <Box>
                        <Text>{block.content}</Text>
                      </Box>
                    )}

                    {block.type === "file" && (
                      <Box
                        flexDirection="column"
                        borderStyle="single"
                        borderColor="blue"
                        padding={1}
                      >
                        <Text color="blue" bold>
                          📄{" "}
                          {block.action === "create"
                            ? "Create"
                            : block.action === "update"
                              ? "Update"
                              : "Delete"}
                          : {block.path}
                        </Text>
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
                      <ToolResultDisplay
                        block={block}
                        isExpanded={isExpanded}
                      />
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
                  </Box>
                ))}
              </Box>
            </Box>
          );
        })}
      </Box>

      {/* 加载状态显示 */}
      {isLoading && (
        <Box>
          <Text color="yellow">🤔 AI is thinking...</Text>
        </Box>
      )}

      {/* 底部信息和快捷键提示 */}
      {messages.length > 0 && (
        <Box marginTop={1} paddingX={1}>
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
              <Text color="cyan">Ctrl+R</Text> Toggle{" "}
              {isExpanded ? "Collapse" : "Expand"}
            </Text>
          </Box>
        </Box>
      )}
    </Box>
  );
};
