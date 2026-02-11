import React from "react";
import { Box } from "ink";
import { MessageList } from "./MessageList.js";
import { InputBox } from "./InputBox.js";
import { Confirmation } from "./Confirmation.js";
import { useChat } from "../contexts/useChat.js";
import { useInputManager } from "../hooks/useInputManager.js";

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
    rewindId,
    backgroundCurrentTask,
  } = useChat();

  // Input manager with all input state and functionality (including images)
  const inputManager = useInputManager({
    onSendMessage: sendMessage,
    onHasSlashCommand: hasSlashCommand,
    onSaveMemory: saveMemory,
    onAbortMessage: abortMessage,
    onBackgroundCurrentTask: backgroundCurrentTask,
    onPermissionModeChange: () => {
      // Sync back to chat context if needed
    },
  });

  const { showTaskManager, setShowTaskManager } = inputManager;

  if (!sessionId) return null;

  return (
    <Box flexDirection="column" height="100%" paddingY={1} paddingRight={1}>
      <MessageList
        messages={messages}
        isLoading={isLoading}
        isCommandRunning={isCommandRunning}
        isCompressing={isCompressing}
        latestTotalTokens={latestTotalTokens}
        isExpanded={isExpanded}
        showTaskManager={showTaskManager}
        setShowTaskManager={setShowTaskManager}
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
          saveMemory={saveMemory}
          mcpServers={mcpServers}
          connectMcpServer={connectMcpServer}
          disconnectMcpServer={disconnectMcpServer}
          slashCommands={slashCommands}
          hasSlashCommand={hasSlashCommand}
          // Pass input manager state and methods
          inputManagerState={inputManager}
        />
      )}
    </Box>
  );
};
