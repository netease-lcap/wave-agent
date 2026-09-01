import React, { useState, useEffect, useCallback } from "react";
import { Box, useWindowSize } from "ink";
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
    compactionStream,
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
    hooks,
    isConfirmationVisible,
    confirmingTool,
    handleConfirmationDecision,
    handleConfirmationCancel,
    version,
    workdir,
    remountKey,
    getGatewayConfig,
  } = useChat();

  const displayMessages = messages;

  const { rows } = useWindowSize();

  // Reserve terminal rows for the pending tool block in the message list and
  // the ConfirmationSelector, so the confirmation details stay within Ink's
  // incremental-rendering height. When dynamic output >= terminal rows, Ink
  // falls back to a fullscreen clear + redraw on every frame, which makes the
  // confirmation options flicker while navigating.
  const CONFIRMATION_UI_RESERVE = 14;
  const detailsMaxHeight = Math.max(rows - CONFIRMATION_UI_RESERVE, 1);

  // Compute whether the user has any usable auth/direct-API config,
  // so the welcome page can prompt /login when neither is present.
  // An SSO token counts as authenticated even if the access token is stale —
  // it refreshes lazily on the next API call (matching the claude-code CLI).
  const computeAuthState = useCallback((): boolean => {
    if (authService.getSSOToken()) return true;
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
          {(isLoading || isCommandRunning || isCompacting) && (
            <LoadingIndicator
              isLoading={isLoading}
              isCommandRunning={isCommandRunning}
              isCompacting={isCompacting}
              latestTotalTokens={latestTotalTokens}
              compactionStream={compactionStream}
            />
          )}
          <TaskList />
          <QueuedMessageList />
          <InputBox
            isLoading={isLoading}
            isCommandRunning={isCommandRunning}
            isCompacting={isCompacting}
            sendMessage={sendMessage}
            abortMessage={abortMessage}
            mcpServers={mcpServers}
            connectMcpServer={connectMcpServer}
            disconnectMcpServer={disconnectMcpServer}
            slashCommands={slashCommands}
            hasSlashCommand={hasSlashCommand}
            hooks={hooks}
            latestTotalTokens={latestTotalTokens}
            maxInputTokens={maxInputTokens}
            showLoginHint={showLoginHint}
          />
        </>
      )}

      {isConfirmationVisible && (
        <>
          <ConfirmationDetails
            toolName={confirmingTool!.name}
            toolInput={confirmingTool!.input}
            planContent={confirmingTool!.planContent}
            warning={confirmingTool!.warning}
            maxHeight={detailsMaxHeight}
          />
          <ConfirmationSelector
            toolName={confirmingTool!.name}
            toolInput={confirmingTool!.input}
            suggestedPrefix={confirmingTool!.suggestedPrefix}
            hidePersistentOption={confirmingTool!.hidePersistentOption}
            permissionMode={confirmingTool!.permissionMode}
            isExpanded={isExpanded}
            onDecision={handleConfirmationDecision}
            onCancel={handleConfirmationCancel}
          />
        </>
      )}
    </Box>
  );
};
