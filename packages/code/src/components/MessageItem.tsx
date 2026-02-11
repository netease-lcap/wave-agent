import React from "react";
import { Box, Text } from "ink";
import type { Message, MessageBlock } from "wave-agent-sdk";
import { MessageSource } from "wave-agent-sdk";
import { CommandOutputDisplay } from "./CommandOutputDisplay.js";
import { ToolResultDisplay } from "./ToolResultDisplay.js";
import { CompressDisplay } from "./CompressDisplay.js";
import { SubagentBlock } from "./SubagentBlock.js";
import { ReasoningDisplay } from "./ReasoningDisplay.js";
import { Markdown } from "./Markdown.js";

export interface MessageItemProps {
  message: Message;
  isExpanded: boolean;
  shouldShowHeader: boolean;
}

export const MessageItem = ({
  message,
  isExpanded,
  shouldShowHeader,
}: MessageItemProps) => {
  if (message.blocks.length === 0) return null;
  const renderBlock = (block: MessageBlock, blockIndex: number) => (
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

      {block.type === "compress" && (
        <CompressDisplay block={block} isExpanded={isExpanded} />
      )}

      {block.type === "subagent" && <SubagentBlock block={block} />}

      {block.type === "reasoning" && <ReasoningDisplay block={block} />}
    </Box>
  );

  const renderedBlocks: React.ReactNode[] = [];
  let currentToolGroup: React.ReactNode[] = [];

  message.blocks.forEach((block, index) => {
    if (
      block.type === "tool" &&
      message.blocks.filter((b) => b.type === "tool").length > 1
    ) {
      currentToolGroup.push(renderBlock(block, index));
    } else {
      if (currentToolGroup.length > 0) {
        renderedBlocks.push(
          <Box
            key={`tool-group-${index}`}
            flexDirection="column"
            gap={1}
            borderRight={false}
            borderTop={false}
            borderBottom={false}
            borderStyle="classic"
            borderColor="gray"
            paddingLeft={1}
          >
            {currentToolGroup}
          </Box>,
        );
        currentToolGroup = [];
      }
      renderedBlocks.push(renderBlock(block, index));
    }
  });

  if (currentToolGroup.length > 0) {
    renderedBlocks.push(
      <Box
        key="tool-group-final"
        flexDirection="column"
        gap={1}
        borderRight={false}
        borderTop={false}
        borderBottom={false}
        borderStyle="classic"
        borderColor="gray"
        paddingLeft={1}
      >
        {currentToolGroup}
      </Box>,
    );
  }

  return (
    <Box flexDirection="column" gap={1} marginTop={1}>
      {shouldShowHeader && (
        <Box>
          <Text color={message.role === "user" ? "cyan" : "green"} bold>
            {message.role === "user" ? "👤 You" : "🤖 Assistant"}
          </Text>
        </Box>
      )}

      <Box flexDirection="column" gap={1}>
        {renderedBlocks}
      </Box>
    </Box>
  );
};
