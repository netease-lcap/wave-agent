import React, { useEffect } from "react";
import { Box, Text, useStdin } from "ink";
import { useChat } from "../contexts/useChat.js";
import { logger } from "wave-agent-sdk";

export const NonRawInput: React.FC = () => {
  const { sendMessage, isLoading, isCommandRunning } = useChat();
  const { stdin } = useStdin();

  useEffect(() => {
    const handleData = (data: string) => {
      const input = data.toString().trim();

      if (input && !isLoading && !isCommandRunning) {
        logger.info(`Sending message: ${input}`);
        sendMessage(input);
      }
    };

    stdin?.on("data", handleData);

    return () => {
      stdin?.off("data", handleData);
    };
  }, [stdin, sendMessage, isLoading, isCommandRunning]);

  return (
    <Box marginTop={1}>
      {!isLoading && !isCommandRunning && (
        <Text color="gray">
          Type your message and press Enter to send (Ctrl+C to exit)
        </Text>
      )}
    </Box>
  );
};
