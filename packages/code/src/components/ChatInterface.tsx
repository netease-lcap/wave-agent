import React, { useRef, useEffect } from "react";
import { Box } from "ink";
import { MessageList } from "./MessageList.js";
import { InputBox } from "./InputBox.js";
import { useChat } from "../contexts/useChat.js";
import type { Message } from "wave-agent-sdk";

export const ChatInterface: React.FC = () => {
  const {
    messages,
    isLoading,
    isCommandRunning,
    userInputHistory,
    isCompressing,
    sendMessage,
    abortMessage,
    saveMemory,
    mcpServers,
    connectMcpServer,
    disconnectMcpServer,
    isExpanded,
    latestTotalTokens,
    slashCommands,
    hasSlashCommand,
  } = useChat();

  // Create a ref to store messages in expanded mode
  const expandedMessagesRef = useRef<Message[]>([]);

  useEffect(() => {
    // Only sync when collapsed
    if (!isExpanded) {
      expandedMessagesRef.current = messages.map((message, index) => {
        // If it's the last message, deep copy its blocks
        if (index === messages.length - 1) {
          return {
            ...message,
            blocks: message.blocks.map((block) => ({ ...block })),
          };
        }
        return message;
      });
    }
  }, [isExpanded, messages]);

  return (
    <Box flexDirection="column" height="100%">
      <Box flexGrow={1} flexDirection="column" paddingX={1}>
        {isExpanded ? (
          // Expanded mode uses messages from ref, loading and tokens are hardcoded to false and 0
          <MessageList
            messages={expandedMessagesRef.current}
            isLoading={false}
            isCommandRunning={false}
            latestTotalTokens={0}
            isExpanded={true}
          />
        ) : (
          // Normal mode uses real-time state
          <MessageList
            messages={messages}
            isLoading={isLoading}
            isCommandRunning={isCommandRunning}
            isCompressing={isCompressing}
            latestTotalTokens={latestTotalTokens}
            isExpanded={false}
          />
        )}
      </Box>

      {!isExpanded && (
        <InputBox
          isLoading={isLoading}
          isCommandRunning={isCommandRunning}
          userInputHistory={userInputHistory}
          sendMessage={sendMessage}
          abortMessage={abortMessage}
          saveMemory={saveMemory}
          mcpServers={mcpServers}
          connectMcpServer={connectMcpServer}
          disconnectMcpServer={disconnectMcpServer}
          slashCommands={slashCommands}
          hasSlashCommand={hasSlashCommand}
        />
      )}
    </Box>
  );
};
