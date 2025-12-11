import React from "react";
import { Box, Text } from "ink";
import type { Message } from "wave-agent-sdk";
import { MessageSource } from "wave-agent-sdk";
import { CommandOutputDisplay } from "./CommandOutputDisplay.js";
import { ToolResultDisplay } from "./ToolResultDisplay.js";
import { MemoryDisplay } from "./MemoryDisplay.js";
import { CompressDisplay } from "./CompressDisplay.js";
import { SubagentBlock } from "./SubagentBlock.js";
import { Markdown } from "./Markdown.js";

export interface MessageItemProps {
  message: Message;
  isExpanded: boolean;
  shouldShowHeader: boolean;
  isStatic?: boolean;
}

export const MessageItem = ({
  message,
  isExpanded,
  shouldShowHeader,
  isStatic = true,
}: MessageItemProps) => {
  if (message.blocks.length === 0) return null;
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
                {isStatic ? (
                  <Markdown>{block.content}</Markdown>
                ) : (
                  <Text>{block.content.split("\n").slice(-10).join("\n")}</Text>
                )}
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

            {block.type === "memory" && <MemoryDisplay block={block} />}

            {block.type === "compress" && (
              <CompressDisplay block={block} isExpanded={isExpanded} />
            )}

            {block.type === "subagent" && <SubagentBlock block={block} />}
          </Box>
        ))}
      </Box>
    </Box>
  );
};
