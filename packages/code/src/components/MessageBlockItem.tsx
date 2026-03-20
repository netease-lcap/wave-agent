import React from "react";
import { Box, Text } from "ink";
import type { Message, MessageBlock } from "wave-agent-sdk";
import { MessageSource } from "wave-agent-sdk";
import { BangDisplay } from "./BangDisplay.js";
import { ToolDisplay } from "./ToolDisplay.js";
import { CompressDisplay } from "./CompressDisplay.js";
import { ReasoningDisplay } from "./ReasoningDisplay.js";
import { Markdown } from "./Markdown.js";

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
  const renderContent = (content: string) => {
    // Hide <system-reminder> XML block
    const reminderEnd = content.indexOf("</system-reminder>");
    const displayContent =
      reminderEnd !== -1
        ? content.substring(reminderEnd + "</system-reminder>".length).trim()
        : content;

    if (!displayContent) return null;

    return message.role === "user" || isExpanded ? (
      <Text
        backgroundColor={message.role === "user" ? "gray" : undefined}
        color="white"
      >
        {displayContent}
      </Text>
    ) : (
      <Markdown>{displayContent}</Markdown>
    );
  };

  return (
    <Box flexDirection="column" paddingTop={paddingTop}>
      {block.type === "text" && block.content.trim() && (
        <Box>
          {block.customCommandContent && (
            <Text color="cyan" bold>
              ${" "}
            </Text>
          )}
          {block.source === MessageSource.HOOK && (
            <Text color="magenta" bold>
              ~{" "}
            </Text>
          )}
          {renderContent(block.content)}
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

      {block.type === "tool" && (
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

      {block.type === "compress" && (
        <CompressDisplay block={block} isExpanded={isExpanded} />
      )}

      {block.type === "reasoning" && (
        <ReasoningDisplay block={block} isExpanded={isExpanded} />
      )}
    </Box>
  );
};
