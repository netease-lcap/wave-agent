import React, { useEffect, useRef, useCallback } from "react";
import { Box, Text } from "ink";
import { useInput } from "ink";
import { FileSelector } from "./FileSelector.js";
import { CommandSelector } from "./CommandSelector.js";
import { HistorySearch } from "./HistorySearch.js";
import { BackgroundTaskManager } from "./BackgroundTaskManager.js";
import { McpManager } from "./McpManager.js";
import { AgentsManager } from "./AgentsManager.js";
import { SkillsManager } from "./SkillsManager.js";
import { RewindCommand } from "./RewindCommand.js";
import { PlanView } from "./PlanView.js";
import { HelpView } from "./HelpView.js";
import { StatusCommand } from "./StatusCommand.js";
import { LoginCommand } from "./LoginCommand.js";
import { PluginManagerShell } from "./PluginManagerShell.js";
import { ModelSelector } from "./ModelSelector.js";
import { WorkflowManager } from "./WorkflowManager.js";
import { StatusLine } from "./StatusLine.js";
import { Notifications } from "./Notifications.js";
import { BtwDisplay } from "./BtwDisplay.js";
import { useInputManager } from "../hooks/useInputManager.js";
import { useChat } from "../contexts/useChat.js";

import type { McpServerStatus, SlashCommand } from "wave-agent-sdk";

export const INPUT_PLACEHOLDER_TEXT =
  "Type your message (use /help for more info)...";

export const INPUT_PLACEHOLDER_TEXT_PREFIX = INPUT_PLACEHOLDER_TEXT.substring(
  0,
  10,
);

export interface InputBoxProps {
  isLoading?: boolean;
  isCommandRunning?: boolean;
  isCompacting?: boolean;
  workdir?: string;
  sendMessage?: (
    message: string,
    images?: Array<{ path: string; mimeType: string }>,
    longTextMap?: Record<string, string>,
  ) => void;
  abortMessage?: () => void;
  // MCP related properties
  mcpServers?: McpServerStatus[];
  connectMcpServer?: (serverName: string) => Promise<boolean>;
  disconnectMcpServer?: (serverName: string) => Promise<boolean>;
  // Slash Command related properties
  slashCommands?: SlashCommand[];
  hasSlashCommand?: (commandId: string) => boolean;
  // Token usage
  latestTotalTokens?: number;
  maxInputTokens?: number;
  // Login hint
  showLoginHint?: boolean;
}

export const InputBox: React.FC<InputBoxProps> = ({
  isLoading,
  isCommandRunning,
  isCompacting,
  sendMessage = () => {},
  abortMessage = () => {},
  mcpServers = [],
  connectMcpServer = async () => false,
  disconnectMcpServer = async () => false,
  slashCommands = [],
  hasSlashCommand = () => false,
  latestTotalTokens = 0,
  maxInputTokens = 200000,
  showLoginHint = false,
}) => {
  const {
    permissionMode: chatPermissionMode,
    setPermissionMode: setChatPermissionMode,
    handleRewindSelect,
    handlePlanCommand,
    planView,
    setPlanView,
    backgroundCurrentTask,
    messages,
    getFullMessageThread,
    sessionId,
    workingDirectory,
    askBtw,
    clearMessages,
    compact,
    addDir,
    currentModel,
    configuredModels,
    setModel,
    recreateAgent,
    recallQueuedMessage,
    queuedMessages,
    setIsBtwActive,
    agentDefinitions,
    skills,
  } = useChat();

  // Ref to hold setInputText so queue callbacks can access it before useInputManager returns
  const setInputTextRef = useRef<(text: string) => void>(() => {});

  const hasQueuedMessages = (queuedMessages?.length ?? 0) > 0;

  // Idle means no AI work in flight. Esc double-press clear only applies when
  // idle; while busy, Esc keeps its abort semantics.
  const isIdle = !(isLoading || isCommandRunning || isCompacting);

  const onRecallQueuedMessage = useCallback(() => {
    const msg = recallQueuedMessage();
    if (msg) {
      const prefix = msg.type === "bang" ? "!" : "";
      setInputTextRef.current(prefix + msg.content);
    }
  }, [recallQueuedMessage]);

  // Input manager with all input state and functionality (including images)
  const {
    inputText,
    cursorPosition,
    // File selector
    showFileSelector,
    filteredFiles,
    fileSearchQuery: searchQuery,
    isFileSearching,
    handleFileSelect,
    handleCancelFileSelect,
    // Command selector
    showCommandSelector,
    commandSearchQuery,
    handleCommandSelect,
    handleCommandInsert,
    handleCancelCommandSelect,
    handleHistorySearchSelect,
    handleCancelHistorySearch,
    // History search
    showHistorySearch,
    historySearchQuery,
    // Task/MCP Manager
    showBackgroundTaskManager,
    showMcpManager,
    showAgentsManager,
    showRewindManager,
    showHelp,
    showStatusCommand,
    showLoginCommand,
    showPluginManager,
    showModelSelector,
    showWorkflowManager,
    showSkillsManager,
    setShowBackgroundTaskManager,
    setShowMcpManager,
    setShowAgentsManager,
    setShowRewindManager,
    setShowHelp,
    setShowStatusCommand,
    setShowLoginCommand,
    setShowPluginManager,
    setShowModelSelector,
    setShowWorkflowManager,
    setShowSkillsManager,
    // Permission mode
    permissionMode,
    setPermissionMode,
    // BTW state
    btwState,
    // Esc double-press clear pending
    escClearPending,
    // Main handler
    handleInput,
    // Manager ready state
    isManagerReady,
    // Direct state setters
    setInputText,
  } = useInputManager({
    onSendMessage: sendMessage,
    onAskBtw: askBtw,
    onClearMessages: clearMessages,
    onCompact: compact,
    onAddDir: addDir,
    onHasSlashCommand: hasSlashCommand,
    onAbortMessage: abortMessage,
    onBackgroundCurrentTask: backgroundCurrentTask,
    onPermissionModeChange: setChatPermissionMode,
    onPlanCommand: handlePlanCommand,
    sessionId,
    workdir: workingDirectory,
    getFullMessageThread,
    hasQueuedMessages,
    isIdle,
    onRecallQueuedMessage,
  });

  // Keep setInputText ref updated for queue callbacks
  useEffect(() => {
    setInputTextRef.current = setInputText;
  }, [setInputText]);

  // Sync the btw overlay's visibility to ChatContext so siblings (TaskList)
  // can hide while the side-question is on display (aligned with Claude Code,
  // which suppresses the expanded task list while a local-jsx command shows).
  useEffect(() => {
    setIsBtwActive(btwState.question !== "" || btwState.answer !== undefined);
  }, [btwState.question, btwState.answer, setIsBtwActive]);

  // Sync permission mode from useChat to InputManager
  useEffect(() => {
    setPermissionMode(chatPermissionMode);
  }, [chatPermissionMode, setPermissionMode]);

  // Use the InputManager's unified input handler
  useInput(async (input, key) => {
    // These views have their own useInput handlers that handle escape and navigation.
    // If they are active, we should skip InputBox's global input handling to avoid
    // duplicate dispatches or state update conflicts.
    if (
      showRewindManager ||
      !!planView ||
      showHelp ||
      showStatusCommand ||
      showLoginCommand ||
      showPluginManager ||
      showModelSelector ||
      showBackgroundTaskManager ||
      showMcpManager ||
      showAgentsManager ||
      showWorkflowManager ||
      showSkillsManager
    ) {
      return;
    }
    await handleInput(input, key);
  });

  const handleRewindCancel = () => {
    if (setShowRewindManager) {
      setShowRewindManager(false);
    }
  };

  const isPlaceholder = !inputText;
  const placeholderText = INPUT_PLACEHOLDER_TEXT;

  const isShellCommand =
    inputText?.startsWith("!") && !inputText.includes("\n");

  // handleCommandSelectorInsert is already memoized in useInputManager, no need to wrap again

  // Split text into three parts: before cursor, cursor position, after cursor
  const displayText = isPlaceholder ? placeholderText : inputText;
  const beforeCursor = displayText.substring(0, cursorPosition);
  const atCursor =
    cursorPosition < displayText.length ? displayText[cursorPosition] : " ";
  const afterCursor = displayText.substring(cursorPosition + 1);

  // Always show cursor, allow user to continue input during memory mode
  const shouldShowCursor = true;

  // Only show the Box after InputManager is created on first mount
  if (!isManagerReady) {
    return null;
  }

  const handleRewindSelectWithClose = async (index: number) => {
    if (setShowRewindManager) {
      setShowRewindManager(false);
    }
    await handleRewindSelect(index);
  };

  return (
    <Box flexDirection="column">
      <BtwDisplay btwState={btwState} />
      {showFileSelector && (
        <FileSelector
          files={filteredFiles}
          searchQuery={searchQuery}
          isLoading={isFileSearching}
          onSelect={handleFileSelect}
          onCancel={handleCancelFileSelect}
        />
      )}

      {showCommandSelector && (
        <CommandSelector
          searchQuery={commandSearchQuery}
          onSelect={handleCommandSelect}
          onInsert={handleCommandInsert}
          onCancel={handleCancelCommandSelect}
          commands={slashCommands}
        />
      )}

      {showHistorySearch && (
        <HistorySearch
          searchQuery={historySearchQuery}
          onSelect={handleHistorySearchSelect}
          onCancel={handleCancelHistorySearch}
        />
      )}

      {showBackgroundTaskManager && (
        <BackgroundTaskManager
          onCancel={() => setShowBackgroundTaskManager(false)}
        />
      )}

      {showMcpManager && (
        <McpManager
          onCancel={() => setShowMcpManager(false)}
          servers={mcpServers}
          onConnectServer={connectMcpServer}
          onDisconnectServer={disconnectMcpServer}
        />
      )}

      {showAgentsManager && (
        <AgentsManager
          onCancel={() => setShowAgentsManager(false)}
          agentDefinitions={agentDefinitions}
        />
      )}

      {showSkillsManager && (
        <SkillsManager
          onCancel={() => setShowSkillsManager(false)}
          skills={skills}
        />
      )}

      {showWorkflowManager && (
        <WorkflowManager onCancel={() => setShowWorkflowManager(false)} />
      )}

      {showRewindManager && (
        <RewindCommand
          messages={messages}
          onSelect={handleRewindSelectWithClose}
          onCancel={handleRewindCancel}
          getFullMessageThread={getFullMessageThread}
        />
      )}

      {planView && (
        <PlanView
          path={planView.path}
          content={planView.content}
          message={planView.message}
          onCancel={() => setPlanView(null)}
        />
      )}

      {showHelp && (
        <HelpView
          onCancel={() => setShowHelp(false)}
          commands={slashCommands}
        />
      )}

      {showStatusCommand && (
        <StatusCommand onCancel={() => setShowStatusCommand(false)} />
      )}

      {showLoginCommand && (
        <LoginCommand onCancel={() => setShowLoginCommand(false)} />
      )}

      {showPluginManager && (
        <PluginManagerShell
          onCancel={() => setShowPluginManager(false)}
          onPluginInstalled={recreateAgent}
        />
      )}

      {showModelSelector && (
        <ModelSelector
          onCancel={() => setShowModelSelector(false)}
          currentModel={currentModel}
          configuredModels={configuredModels}
          onSelectModel={setModel}
        />
      )}

      {btwState.question || btwState.answer || !!planView
        ? null
        : showBackgroundTaskManager ||
          showMcpManager ||
          showAgentsManager ||
          showSkillsManager ||
          showRewindManager ||
          showHelp ||
          showStatusCommand ||
          showLoginCommand ||
          showPluginManager ||
          showModelSelector ||
          showWorkflowManager || (
            <Box flexDirection="column">
              {escClearPending && (
                <Text color="gray">Press Esc again to clear input</Text>
              )}
              <Box
                borderStyle="single"
                borderColor="gray"
                borderLeft={false}
                borderRight={false}
              >
                <Text color={isPlaceholder ? "gray" : "white"}>
                  {shouldShowCursor ? (
                    <>
                      {beforeCursor}
                      <Text backgroundColor="white" color="black">
                        {atCursor}
                      </Text>
                      {afterCursor}
                    </>
                  ) : (
                    displayText
                  )}
                </Text>
              </Box>
              <Box justifyContent="space-between">
                <StatusLine
                  permissionMode={permissionMode}
                  isShellCommand={isShellCommand}
                />
                <Notifications
                  latestTotalTokens={latestTotalTokens}
                  maxInputTokens={maxInputTokens}
                  showLoginHint={showLoginHint}
                />
              </Box>
            </Box>
          )}
    </Box>
  );
};
