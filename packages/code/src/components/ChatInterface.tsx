import React, { useState, useCallback, useLayoutEffect, useRef } from "react";
import { Box, useStdout, measureElement } from "ink";
import { MessageList } from "./MessageList.js";
import { BtwDisplay } from "./BtwDisplay.js";
import { InputBox } from "./InputBox.js";
import { LoadingIndicator } from "./LoadingIndicator.js";
import { TaskList } from "./TaskList.js";
import { QueuedMessageList } from "./QueuedMessageList.js";
import { ConfirmationDetails } from "./ConfirmationDetails.js";
import { ConfirmationSelector } from "./ConfirmationSelector.js";

import { useChat } from "../contexts/useChat.js";
import type { PermissionDecision } from "wave-agent-sdk";

export const ChatInterface: React.FC = () => {
  const { stdout } = useStdout();
  const [isConfirmationTooTall, setIsConfirmationTooTall] = useState(false);

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
    version,
    workdir,
    btwState,
  } = useChat();

  const interfaceRef = useRef(null);

  useLayoutEffect(() => {
    if (!isConfirmationVisible) {
      setIsConfirmationTooTall(false);
      return;
    }

    if (isConfirmationTooTall) {
      return;
    }

    if (interfaceRef.current) {
      const { height } = measureElement(interfaceRef.current);
      const terminalHeight = stdout?.rows || 24;
      if (height > terminalHeight - 3) {
        setIsConfirmationTooTall(true);
      }
    }
  }, [
    messages,
    isLoading,
    isCommandRunning,
    isCompressing,
    isExpanded,
    isConfirmationVisible,
    isConfirmationTooTall,
    stdout?.rows,
  ]);

  const displayMessages = messages;

  const handleConfirmationCancel = useCallback(() => {
    if (isConfirmationTooTall) {
      setWasLastDetailsTooTall((prev) => prev + 1);
      setIsConfirmationTooTall(false);
    }
    originalHandleConfirmationCancel();
  }, [
    isConfirmationTooTall,
    originalHandleConfirmationCancel,
    setWasLastDetailsTooTall,
  ]);

  const wrappedHandleConfirmationDecision = useCallback(
    (decision: PermissionDecision) => {
      if (isConfirmationTooTall) {
        setWasLastDetailsTooTall((prev) => prev + 1);
        setIsConfirmationTooTall(false);
      }
      handleConfirmationDecision(decision);
    },
    [
      isConfirmationTooTall,
      handleConfirmationDecision,
      setWasLastDetailsTooTall,
    ],
  );

  if (!sessionId) return null;

  return (
    <Box ref={interfaceRef} flexDirection="column">
      <MessageList
        messages={displayMessages}
        isExpanded={isExpanded}
        forceStatic={isConfirmationVisible && isConfirmationTooTall}
        version={version}
        workdir={workdir}
      />

      {!isConfirmationVisible && !isExpanded && (
        <>
          <BtwDisplay btwState={btwState} />
          {(isLoading || isCommandRunning || isCompressing) && (
            <LoadingIndicator
              isLoading={isLoading}
              isCommandRunning={isCommandRunning}
              isCompressing={isCompressing}
              latestTotalTokens={latestTotalTokens}
            />
          )}
          <TaskList />
          <QueuedMessageList />
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
        </>
      )}

      {isConfirmationVisible && (
        <>
          <ConfirmationDetails
            toolName={confirmingTool!.name}
            toolInput={confirmingTool!.input}
            planContent={confirmingTool!.planContent}
            isExpanded={isExpanded}
            isStatic={isConfirmationTooTall}
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
    </Box>
  );
};
