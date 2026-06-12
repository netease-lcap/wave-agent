import React from "react";
import { useChat } from "../contexts/useChat.js";
import { Box, Text } from "ink";

export const QueuedMessageList: React.FC = () => {
  const { queuedMessages = [] } = useChat();

  if (queuedMessages.length === 0) {
    return null;
  }

  return (
    <Box flexDirection="column">
      {queuedMessages.map((msg, index) => {
        const content = msg.content.trim();
        const hasImages = msg.images && msg.images.length > 0;
        const prefix = msg.type === "bang" ? "! " : "";
        const displayText = prefix + (content || (hasImages ? "[Images]" : ""));

        return (
          <Box key={msg.id ?? index}>
            <Text color="gray">[{index + 1}] </Text>
            <Text color="gray" italic>
              {displayText.length > 55
                ? `${displayText.substring(0, 52)}...`
                : displayText}
            </Text>
          </Box>
        );
      })}
      <Text color="gray" dimColor>
        {"  "}↑ recall
      </Text>
    </Box>
  );
};
