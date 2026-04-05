import React from "react";
import { Box } from "ink";
import { MessageList } from "./MessageList.js";
import { BtwDisplay } from "./BtwDisplay.js";
import { InputBox } from "./InputBox.js";
import { LoadingIndicator } from "./LoadingIndicator.js";
import { TaskList } from "./TaskList.js";
import { QueuedMessageList } from "./QueuedMessageList.js";
import { ConfirmationDetails } from "./ConfirmationDetails.js";
import { ConfirmationSelector } from "./ConfirmationSelector.js";

import { useChat } from "../contexts/useChat.js";

export const ChatInterface: React.FC<{ remountKey: string }> = ({
  remountKey,
}) => {
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
    handleConfirmationCancel,
    version,
    workdir,
    btwState,
  } = useChat();

  const displayMessages = messages;

  if (!sessionId) return null;

  return (
    <Box flexDirection="column">
      <MessageList
        key={remountKey}
        messages={displayMessages}
        isExpanded={isExpanded}
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
          />
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
