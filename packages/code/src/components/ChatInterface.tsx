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
    rewindId,
  } = useChat();

  if (!sessionId) return null;

  return (
    <Box flexDirection="column" height="100%" paddingY={1} paddingRight={1}>
      <MessageList
        messages={messages}
        isLoading={isLoading}
        isCommandRunning={isCommandRunning}
        isCompressing={isCompressing}
        isExpanded={isExpanded}
        key={String(isExpanded) + sessionId + rewindId}
      />

      {isConfirmationVisible && (
        <Confirmation
          toolName={confirmingTool!.name}
          toolInput={confirmingTool!.input}
          suggestedPrefix={confirmingTool!.suggestedPrefix}
          hidePersistentOption={confirmingTool!.hidePersistentOption}
          isExpanded={isExpanded}
          onDecision={handleConfirmationDecision}
          onCancel={handleConfirmationCancel}
          onAbort={abortMessage}
        />
      )}

      {!isConfirmationVisible && !isExpanded && (
        <InputBox
          isLoading={isLoading}
          isCommandRunning={isCommandRunning}
          userInputHistory={userInputHistory}
          sendMessage={sendMessage}
          abortMessage={abortMessage}
          mcpServers={mcpServers}
          connectMcpServer={connectMcpServer}
          disconnectMcpServer={disconnectMcpServer}
          latestTotalTokens={latestTotalTokens}
          slashCommands={slashCommands}
          hasSlashCommand={hasSlashCommand}
        />
      )}
    </Box>
  );
};
