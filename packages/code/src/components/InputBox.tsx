import React, { useEffect, useMemo } from "react";
import { Box, Text } from "ink";
import { useInput } from "ink";
import { FileSelector } from "./FileSelector.js";
import { CommandSelector } from "./CommandSelector.js";
import { BashHistorySelector } from "./BashHistorySelector.js";
import { MemoryTypeSelector } from "./MemoryTypeSelector.js";
import { BashShellManager } from "./BashShellManager.js";
import { McpManager } from "./McpManager.js";
import { useInputManager } from "../hooks/useInputManager.js";
import { useChat } from "../contexts/useChat.js";

import type { McpServerStatus, SlashCommand } from "wave-agent-sdk";

export const INPUT_PLACEHOLDER_TEXT =
  "Type your message (use @ to reference files, / for commands, ! for bash history, # to add memory)...";

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
  saveMemory?: (message: string, type: "project" | "user") => Promise<void>;
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
  workdir,
  userInputHistory = [],
  sendMessage = () => {},
  abortMessage = () => {},
  saveMemory = async () => {},
  mcpServers = [],
  connectMcpServer = async () => false,
  disconnectMcpServer = async () => false,
  slashCommands = [],
  hasSlashCommand = () => false,
}) => {
  // Get current working directory - memoized to avoid repeated process.cwd() calls
  const currentWorkdir = useMemo(() => workdir || process.cwd(), [workdir]);

  const {
    permissionMode: chatPermissionMode,
    setPermissionMode: setChatPermissionMode,
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
    // Bash history selector
    showBashHistorySelector,
    bashHistorySearchQuery,
    handleBashHistorySelect,
    handleCancelBashHistorySelect,
    // Memory type selector
    showMemoryTypeSelector,
    memoryMessage,
    handleMemoryTypeSelect,
    handleCancelMemoryTypeSelect,
    // Bash/MCP Manager
    showBashManager,
    showMcpManager,
    setShowBashManager,
    setShowMcpManager,
    // Permission mode
    permissionMode,
    setPermissionMode,
    // Input history
    setUserInputHistory,
    // Complex handlers combining multiple operations
    handleBashHistoryExecuteAndSend,
    // Main handler
    handleInput,
    // Manager ready state
    isManagerReady,
  } = useInputManager({
    onSendMessage: sendMessage,
    onHasSlashCommand: hasSlashCommand,
    onSaveMemory: saveMemory,
    onAbortMessage: abortMessage,
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

  // These methods are already memoized in useInputManager, no need to wrap again

  // These methods are already memoized in useInputManager and combine multiple operations

  const isPlaceholder = !inputText;
  const placeholderText = INPUT_PLACEHOLDER_TEXT;

  // handleCommandSelectorInsert is already memoized in useInputManager, no need to wrap again

  // Split text into three parts: before cursor, cursor position, after cursor
  const displayText = isPlaceholder ? placeholderText : inputText;
  const beforeCursor = displayText.substring(0, cursorPosition);
  const atCursor =
    cursorPosition < displayText.length ? displayText[cursorPosition] : " ";
  const afterCursor = displayText.substring(cursorPosition + 1);

  // Always show cursor, allow user to continue input during loading
  const shouldShowCursor = true;

  // Only show the Box after InputManager is created on first mount
  if (!isManagerReady) {
    return null;
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

      {showBashHistorySelector && (
        <BashHistorySelector
          searchQuery={bashHistorySearchQuery}
          workdir={currentWorkdir}
          onSelect={handleBashHistorySelect}
          onExecute={handleBashHistoryExecuteAndSend}
          onCancel={handleCancelBashHistorySelect}
        />
      )}

      {showMemoryTypeSelector && (
        <MemoryTypeSelector
          message={memoryMessage}
          onSelect={handleMemoryTypeSelect}
          onCancel={handleCancelMemoryTypeSelect}
        />
      )}

      {showBashManager && (
        <BashShellManager onCancel={() => setShowBashManager(false)} />
      )}

      {showMcpManager && (
        <McpManager
          onCancel={() => setShowMcpManager(false)}
          servers={mcpServers}
          onConnectServer={connectMcpServer}
          onDisconnectServer={disconnectMcpServer}
        />
      )}
      {showBashManager || showMcpManager || (
        <Box flexDirection="column">
          <Box borderStyle="single" borderColor="gray" paddingX={1}>
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
          <Box paddingX={1}>
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
