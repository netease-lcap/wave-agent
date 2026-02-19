import React, { useState, useCallback } from "react";
import { Box, useStdout } from "ink";
import { MessageList } from "./MessageList.js";
import { InputBox } from "./InputBox.js";
import { LoadingIndicator } from "./LoadingIndicator.js";
import { TaskList } from "./TaskList.js";
import { ConfirmationDetails } from "./ConfirmationDetails.js";
import { ConfirmationSelector } from "./ConfirmationSelector.js";

import { useChat } from "../contexts/useChat.js";
import type { PermissionDecision } from "wave-agent-sdk";

export const ChatInterface: React.FC = () => {
  const { stdout } = useStdout();
  const [isDetailsTooTall, setIsDetailsTooTall] = useState(false);

  const {
    messages,
    isLoading,
    isCommandRunning,
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
    handleConfirmationCancel: originalHandleConfirmationCancel,
    setWasLastDetailsTooTall,
  } = useChat();

  const handleHeightMeasured = useCallback(
    (height: number) => {
      const terminalHeight = stdout?.rows || 24;
      if (height > terminalHeight - 10) {
        setIsDetailsTooTall(true);
      } else {
        setIsDetailsTooTall(false);
      }
    },
    [stdout?.rows],
  );

  const handleConfirmationCancel = useCallback(() => {
    if (isDetailsTooTall) {
      setWasLastDetailsTooTall((prev) => prev + 1);
      setIsDetailsTooTall(false);
    }
    originalHandleConfirmationCancel();
  }, [
    isDetailsTooTall,
    originalHandleConfirmationCancel,
    setWasLastDetailsTooTall,
  ]);

  const wrappedHandleConfirmationDecision = useCallback(
    (decision: PermissionDecision) => {
      if (isDetailsTooTall) {
        setWasLastDetailsTooTall((prev) => prev + 1);
        setIsDetailsTooTall(false);
      }
      handleConfirmationDecision(decision);
    },
    [isDetailsTooTall, handleConfirmationDecision, setWasLastDetailsTooTall],
  );

  if (!sessionId) return null;

  return (
    <Box flexDirection="column">
      <MessageList
        messages={messages}
        isLoading={isLoading}
        isCommandRunning={isCommandRunning}
        isExpanded={isExpanded}
      />

      {(isLoading || isCommandRunning || isCompressing) &&
        !isConfirmationVisible && (
          <LoadingIndicator
            isLoading={isLoading}
            isCommandRunning={isCommandRunning}
            isCompressing={isCompressing}
            latestTotalTokens={latestTotalTokens}
          />
        )}
      {!isConfirmationVisible && <TaskList />}

      {isConfirmationVisible && (
        <>
          <ConfirmationDetails
            toolName={confirmingTool!.name}
            toolInput={confirmingTool!.input}
            isExpanded={isExpanded}
            onHeightMeasured={handleHeightMeasured}
          />
          <ConfirmationSelector
            toolName={confirmingTool!.name}
            toolInput={confirmingTool!.input}
            suggestedPrefix={confirmingTool!.suggestedPrefix}
            hidePersistentOption={confirmingTool!.hidePersistentOption}
            isExpanded={isExpanded}
            onDecision={wrappedHandleConfirmationDecision}
            onCancel={handleConfirmationCancel}
            onAbort={abortMessage}
          />
        </>
      )}

      {!isConfirmationVisible && !isExpanded && (
        <InputBox
          isLoading={isLoading}
          isCommandRunning={isCommandRunning}
          sendMessage={sendMessage}
          abortMessage={abortMessage}
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
