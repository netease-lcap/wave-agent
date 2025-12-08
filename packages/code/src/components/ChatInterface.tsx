import React from "react";
import { Box } from "ink";
import { MessageList } from "./MessageList.js";
import { InputBox } from "./InputBox.js";
import { Confirmation } from "./Confirmation.js";
import { useChat } from "../contexts/useChat.js";

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
    sessionId,
    latestTotalTokens,
    slashCommands,
    hasSlashCommand,
    isConfirmationVisible,
    confirmingTool,
    handleConfirmationDecision,
    handleConfirmationCancel,
  } = useChat();

  if (!sessionId) return null;

  return (
    <Box flexDirection="column" height="100%" paddingY={1}>
      <MessageList
        messages={messages}
        isLoading={isLoading}
        isCommandRunning={isCommandRunning}
        isCompressing={isCompressing}
        latestTotalTokens={latestTotalTokens}
        isExpanded={isExpanded}
        key={String(isExpanded) + sessionId}
      />

      {!isExpanded &&
        (isConfirmationVisible ? (
          <Confirmation
            toolName={confirmingTool!.name}
            toolInput={confirmingTool!.input}
            onDecision={handleConfirmationDecision}
            onCancel={handleConfirmationCancel}
            onAbort={abortMessage}
          />
        ) : (
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
        ))}
    </Box>
  );
};
