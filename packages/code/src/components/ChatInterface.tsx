import React, { useState, useCallback, useLayoutEffect } from "react";
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
  const [detailsHeight, setDetailsHeight] = useState(0);
  const [selectorHeight, setSelectorHeight] = useState(0);
  const [dynamicBlocksHeight, setDynamicBlocksHeight] = useState(0);
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
    getModelConfig,
  } = useChat();

  const model = getModelConfig().model;

  const handleDetailsHeightMeasured = useCallback((height: number) => {
    setDetailsHeight(height);
  }, []);

  const handleSelectorHeightMeasured = useCallback((height: number) => {
    setSelectorHeight(height);
  }, []);

  const handleDynamicBlocksHeightMeasured = useCallback((height: number) => {
    setDynamicBlocksHeight(height);
  }, []);

  useLayoutEffect(() => {
    if (!isConfirmationVisible) {
      setIsConfirmationTooTall(false);
      setDetailsHeight(0);
      setSelectorHeight(0);
      setDynamicBlocksHeight(0);
      return;
    }

    if (isConfirmationTooTall) {
      return;
    }

    const terminalHeight = stdout?.rows || 24;
    const totalHeight = detailsHeight + selectorHeight + dynamicBlocksHeight;
    if (totalHeight > terminalHeight) {
      setIsConfirmationTooTall(true);
    }
  }, [
    detailsHeight,
    selectorHeight,
    dynamicBlocksHeight,
    stdout?.rows,
    isConfirmationVisible,
    isConfirmationTooTall,
  ]);

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
    <Box flexDirection="column">
      <MessageList
        messages={messages}
        isExpanded={isExpanded}
        forceStatic={isConfirmationVisible && isConfirmationTooTall}
        version={version}
        workdir={workdir}
        model={model}
        onDynamicBlocksHeightMeasured={handleDynamicBlocksHeightMeasured}
      />

      {(isLoading || isCommandRunning || isCompressing) &&
        !isConfirmationVisible &&
        !isExpanded && (
          <LoadingIndicator
            isLoading={isLoading}
            isCommandRunning={isCommandRunning}
            isCompressing={isCompressing}
            latestTotalTokens={latestTotalTokens}
          />
        )}
      {!isConfirmationVisible && !isExpanded && <TaskList />}

      {isConfirmationVisible && (
        <>
          <ConfirmationDetails
            toolName={confirmingTool!.name}
            toolInput={confirmingTool!.input}
            isExpanded={isExpanded}
            onHeightMeasured={handleDetailsHeightMeasured}
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
            onHeightMeasured={handleSelectorHeightMeasured}
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
