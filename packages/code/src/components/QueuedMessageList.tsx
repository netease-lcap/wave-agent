import React from "react";
import { useChat } from "../contexts/useChat.js";
import { Box, Text } from "ink";

export const QueuedMessageList: React.FC = () => {
  const { queuedMessages = [], isTaskListVisible } = useChat();

  if (queuedMessages.length === 0 || !isTaskListVisible) {
    return null;
  }

  return (
    <Box flexDirection="column">
      {queuedMessages.map((msg, index) => {
        const content = msg.content.trim();
        const hasImages = msg.images && msg.images.length > 0;
        const displayText = content || (hasImages ? "[Images]" : "");

        return (
          <Box key={index}>
            <Text color="gray" italic>
              {displayText.length > 60
                ? `${displayText.substring(0, 57)}...`
                : displayText}
            </Text>
          </Box>
        );
      })}
    </Box>
  );
};
