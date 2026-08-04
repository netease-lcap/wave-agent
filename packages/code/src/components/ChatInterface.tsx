import React, { useState, useRef, useEffect, useCallback } from "react";
import { Box, useStdout, measureElement, Static } from "ink";
import type { DOMElement } from "ink";
import { authService } from "wave-agent-sdk";
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
    isCompacting,
    sendMessage,
    abortMessage,
    mcpServers,
    connectMcpServer,
    disconnectMcpServer,
    isExpanded,
    sessionId,
    latestTotalTokens,
    maxInputTokens,
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
    isGoalActive,
    goalElapsed,
    isGoalEvaluating,
    getGatewayConfig,
  } = useChat();

  const displayMessages = messages;

  const [forceStatic, setForceStatic] = useState(false);
  const { stdout } = useStdout();
  const terminalHeight = stdout?.rows ?? 24;
  const chatInterfaceRef = useRef<DOMElement>(null);

  // Compute whether the user has any usable auth/direct-API config,
  // so the welcome page can prompt /login when neither is present.
  const computeAuthState = useCallback((): boolean => {
    if (authService.isSSOAuthenticated()) return true;
    const gateway = getGatewayConfig();
    return Boolean(gateway.apiKey || gateway.baseURL);
  }, [getGatewayConfig]);

  const [hasAuth, setHasAuth] = useState<boolean>(computeAuthState);

  // Keep the /login hint in sync with auth state changes (login/logout).
  useEffect(() => {
    const unsubscribe = authService.onAuthChange(() => {
      setHasAuth(computeAuthState());
    });
    return unsubscribe;
  }, [computeAuthState]);

  const showLoginHint = !hasAuth;

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
        showLoginHint={showLoginHint}
      />

      {!isConfirmationVisible && !isExpanded && (
        <>
          {(isLoading ||
            isCommandRunning ||
            isCompacting ||
            isGoalEvaluating) && (
            <LoadingIndicator
              isLoading={isLoading}
              isCommandRunning={isCommandRunning}
              isCompacting={isCompacting}
              isGoalEvaluating={isGoalEvaluating}
              latestTotalTokens={latestTotalTokens}
            />
          )}
          <TaskList />
          <QueuedMessageList />
          <InputBox
            isLoading={isLoading}
            isCommandRunning={isCommandRunning}
            isCompacting={isCompacting}
            isGoalEvaluating={isGoalEvaluating}
            sendMessage={sendMessage}
            abortMessage={abortMessage}
            mcpServers={mcpServers}
            connectMcpServer={connectMcpServer}
            disconnectMcpServer={disconnectMcpServer}
            slashCommands={slashCommands}
            hasSlashCommand={hasSlashCommand}
            latestTotalTokens={latestTotalTokens}
            maxInputTokens={maxInputTokens}
            isGoalActive={isGoalActive}
            goalElapsed={goalElapsed}
          />
        </>
      )}

      {isConfirmationVisible && (
        <>
          {forceStatic ? (
            <Static items={[{ key: "confirmation-details" }]}>
              {() => (
                <ConfirmationDetails
                  key="confirmation-details"
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
          />
        </>
      )}
    </Box>
  );
};
