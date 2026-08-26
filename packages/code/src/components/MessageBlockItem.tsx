import React from "react";
import { Box, Text } from "ink";
import type { Message, MessageBlock } from "wave-agent-sdk";
import { MessageSource } from "wave-agent-sdk";
import { BangDisplay } from "./BangDisplay.js";
import { ToolDisplay } from "./ToolDisplay.js";
import { CompactDisplay } from "./CompactDisplay.js";
import { ReasoningDisplay } from "./ReasoningDisplay.js";
import { Markdown } from "./Markdown.js";
import { streamingTail } from "../utils/streamingText.js";

export interface MessageBlockItemProps {
  block: MessageBlock;
  message: Message;
  isExpanded: boolean;
  paddingTop?: number;
}

export const MessageBlockItem = ({
  block,
  message,
  isExpanded,
  paddingTop = 0,
}: MessageBlockItemProps) => {
  return (
    <Box flexDirection="column" paddingTop={paddingTop}>
      {block.type === "text" && block.content.trim() && (
        <Box>
          {block.source === MessageSource.HOOK && (
            <Text color="magenta" bold>
              ~{" "}
            </Text>
          )}
          {message.role === "user" || isExpanded ? (
            <Text
              backgroundColor={message.role === "user" ? "gray" : undefined}
              color="white"
            >
              {block.content}
            </Text>
          ) : block.stage === "streaming" ? (
            <Text color="gray" wrap="truncate-end">
              {streamingTail(block.content)}
            </Text>
          ) : (
            <Markdown>{block.content}</Markdown>
          )}
        </Box>
      )}

      {block.type === "error" && (
        <Box>
          <Text color="red">Error: {block.content}</Text>
        </Box>
      )}

      {block.type === "bang" && (
        <BangDisplay block={block} isExpanded={isExpanded} />
      )}

      {block.type === "tool" && message.role === "user" && (
        <Box flexDirection="column">
          {(block.result || block.shortResult) && (
            <Box>
              <Text dimColor>⎿ </Text>
              <Box flexShrink={1}>
                <Markdown>{block.result ?? block.shortResult ?? ""}</Markdown>
              </Box>
            </Box>
          )}
          {block.error && (
            <Text color="red">
              Error:{" "}
              {typeof block.error === "string"
                ? block.error
                : String(block.error)}
            </Text>
          )}
        </Box>
      )}

      {block.type === "tool" && message.role !== "user" && (
        <ToolDisplay block={block} isExpanded={isExpanded} />
      )}

      {block.type === "image" && (
        <Box>
          <Text color="magenta" bold>
            # Image
          </Text>
          {block.imageUrls && block.imageUrls.length > 0 && (
            <Text color="gray" dimColor>
              {" "}
              ({block.imageUrls.length})
            </Text>
          )}
        </Box>
      )}

      {block.type === "compact" && (
        <CompactDisplay block={block} isExpanded={isExpanded} />
      )}

      {block.type === "reasoning" && (
        <ReasoningDisplay block={block} isExpanded={isExpanded} />
      )}
    </Box>
  );
};
