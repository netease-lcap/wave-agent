import React, { useEffect } from "react";
import { Box, Text } from "ink";
import { useInput } from "ink";
import { FileSelector } from "./FileSelector.js";
import { CommandSelector } from "./CommandSelector.js";
import { HistorySearch } from "./HistorySearch.js";
import { BackgroundTaskManager } from "./BackgroundTaskManager.js";
import { McpManager } from "./McpManager.js";
import { RewindCommand } from "./RewindCommand.js";
import { useInputManager } from "../hooks/useInputManager.js";
import { useChat } from "../contexts/useChat.js";

import type { McpServerStatus, SlashCommand } from "wave-agent-sdk";

export const INPUT_PLACEHOLDER_TEXT =
  "Type your message (use @ to reference files, / for commands, Ctrl+R to search history, Ctrl+O to expand messages)...";

export const INPUT_PLACEHOLDER_TEXT_PREFIX = INPUT_PLACEHOLDER_TEXT.substring(
  0,
  10,
);

export interface InputBoxProps {
  isLoading?: boolean;
  isCommandRunning?: boolean;
  workdir?: string;
  userInputHistory?: string[];
  sendMessage?: (
    message: string,
    images?: Array<{ path: string; mimeType: string }>,
  ) => void;
  abortMessage?: () => void;
  // MCP related properties
  mcpServers?: McpServerStatus[];
  connectMcpServer?: (serverName: string) => Promise<boolean>;
  disconnectMcpServer?: (serverName: string) => Promise<boolean>;
  // Slash Command related properties
  slashCommands?: SlashCommand[];
  hasSlashCommand?: (commandId: string) => boolean;
}

export const InputBox: React.FC<InputBoxProps> = ({
  isLoading = false,
  isCommandRunning = false,
  userInputHistory = [],
  sendMessage = () => {},
  abortMessage = () => {},
  mcpServers = [],
  connectMcpServer = async () => false,
  disconnectMcpServer = async () => false,
  slashCommands = [],
  hasSlashCommand = () => false,
}) => {
  const {
    permissionMode: chatPermissionMode,
    setPermissionMode: setChatPermissionMode,
    handleRewindSelect,
    backgroundCurrentTask,
    messages,
  } = useChat();

  // Input manager with all input state and functionality (including images)
  const {
    inputText,
    cursorPosition,
    // Image management
    attachedImages,
    clearImages,
    // File selector
    showFileSelector,
    filteredFiles,
    fileSearchQuery: searchQuery,
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
    showRewindManager,
    setShowBackgroundTaskManager,
    setShowMcpManager,
    setShowRewindManager,
    // Permission mode
    permissionMode,
    setPermissionMode,
    // Input history
    setUserInputHistory,
    // Main handler
    handleInput,
    // Manager ready state
    isManagerReady,
  } = useInputManager({
    onSendMessage: sendMessage,
    onHasSlashCommand: hasSlashCommand,
    onAbortMessage: abortMessage,
    onBackgroundCurrentTask: backgroundCurrentTask,
    onPermissionModeChange: setChatPermissionMode,
  });

  // Sync permission mode from useChat to InputManager
  useEffect(() => {
    setPermissionMode(chatPermissionMode);
  }, [chatPermissionMode, setPermissionMode]);

  // Set user input history when it changes
  useEffect(() => {
    setUserInputHistory(userInputHistory);
  }, [userInputHistory, setUserInputHistory]);

  // Use the InputManager's unified input handler
  useInput(async (input, key) => {
    await handleInput(
      input,
      key,
      attachedImages,
      isLoading,
      isCommandRunning,
      clearImages,
    );
  });

  const handleRewindCancel = () => {
    if (setShowRewindManager) {
      setShowRewindManager(false);
    }
  };

  const isPlaceholder = !inputText;
  const placeholderText = INPUT_PLACEHOLDER_TEXT;

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

  if (showRewindManager) {
    return (
      <RewindCommand
        messages={messages}
        onSelect={handleRewindSelectWithClose}
        onCancel={handleRewindCancel}
      />
    );
  }

  return (
    <Box flexDirection="column">
      {showFileSelector && (
        <FileSelector
          files={filteredFiles}
          searchQuery={searchQuery}
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

      {showBackgroundTaskManager || showMcpManager || showRewindManager || (
        <Box flexDirection="column">
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
          <Box paddingRight={1} justifyContent="space-between" width="100%">
            <Text color="gray">
              Mode:{" "}
              <Text color={permissionMode === "plan" ? "yellow" : "cyan"}>
                {permissionMode}
              </Text>{" "}
              (Shift+Tab to cycle)
            </Text>
          </Box>
        </Box>
      )}
    </Box>
  );
};
