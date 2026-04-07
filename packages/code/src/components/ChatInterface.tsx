import React, { useState, useRef, useEffect } from "react";
import { Box, useStdout, measureElement, Static } from "ink";
import type { DOMElement } from "ink";
import { MessageList } from "./MessageList.js";
import { InputBox } from "./InputBox.js";
import { LoadingIndicator } from "./LoadingIndicator.js";
import { TaskList } from "./TaskList.js";
import { QueuedMessageList } from "./QueuedMessageList.js";
import { ConfirmationDetails } from "./ConfirmationDetails.js";
import { ConfirmationSelector } from "./ConfirmationSelector.js";

import { useChat } from "../contexts/useChat.js";

export const ChatInterface: React.FC = () => {
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
    hasPendingConfirmations,
    confirmingTool,
    handleConfirmationDecision,
    handleConfirmationCancel,
    version,
    workdir,
    remountKey,
    requestRemount,
  } = useChat();

  const displayMessages = messages;

  const [forceStatic, setForceStatic] = useState(false);
  const { stdout } = useStdout();
  const terminalHeight = stdout?.rows ?? 24;
  const chatInterfaceRef = useRef<DOMElement>(null);

  // Handle forceStatic mode for overflow and request remount when exiting
  useEffect(() => {
    if (isConfirmationVisible && chatInterfaceRef.current) {
      const { height } = measureElement(chatInterfaceRef.current);
      if (height > terminalHeight) {
        setForceStatic(true);
      }
    } else if (forceStatic && !hasPendingConfirmations) {
      setForceStatic(false);
      requestRemount();
    }
  }, [
    isConfirmationVisible,
    terminalHeight,
    forceStatic,
    hasPendingConfirmations,
    requestRemount,
  ]);

  if (!sessionId) return null;

  return (
    <Box ref={chatInterfaceRef} flexDirection="column">
      <MessageList
        key={remountKey}
        messages={displayMessages}
        isExpanded={isExpanded}
        version={version}
        workdir={workdir}
        forceStatic={forceStatic}
      />

      {!isConfirmationVisible && !isExpanded && (
        <>
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
          {forceStatic ? (
            <Static items={[{ key: "confirmation-details" }]}>
              {() => (
                <ConfirmationDetails
                  toolName={confirmingTool!.name}
                  toolInput={confirmingTool!.input}
                  planContent={confirmingTool!.planContent}
                  isExpanded={isExpanded}
                />
              )}
            </Static>
          ) : (
            <ConfirmationDetails
              toolName={confirmingTool!.name}
              toolInput={confirmingTool!.input}
              planContent={confirmingTool!.planContent}
              isExpanded={isExpanded}
            />
          )}
          <ConfirmationSelector
            toolName={confirmingTool!.name}
            toolInput={confirmingTool!.input}
            suggestedPrefix={confirmingTool!.suggestedPrefix}
            hidePersistentOption={confirmingTool!.hidePersistentOption}
            isExpanded={isExpanded}
            onDecision={handleConfirmationDecision}
            onCancel={handleConfirmationCancel}
            onAbort={abortMessage}
          />
        </>
      )}
    </Box>
  );
};
