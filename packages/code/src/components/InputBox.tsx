import React, { useState, useCallback } from "react";
import { Box, Text } from "ink";
import { FileSelector } from "./FileSelector.js";
import { CommandSelector } from "./CommandSelector.js";
import { BashHistorySelector } from "./BashHistorySelector.js";
import { MemoryTypeSelector } from "./MemoryTypeSelector.js";
import { BashShellManager } from "./BashShellManager.js";
import { McpManager } from "./McpManager.js";
import { useInputState } from "../hooks/useInputState.js";
import { useFileSelector } from "../hooks/useFileSelector.js";
import { useCommandSelector } from "../hooks/useCommandSelector.js";
import { useBashHistorySelector } from "../hooks/useBashHistorySelector.js";
import { useMemoryTypeSelector } from "../hooks/useMemoryTypeSelector.js";
import { useInputHistory } from "../hooks/useInputHistory.js";
import { useInputKeyboardHandler } from "../hooks/useInputKeyboardHandler.js";
import { useImageManager } from "../hooks/useImageManager.js";
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
  // Get current working directory
  const currentWorkdir = workdir || process.cwd();
  // Bash shell manager state
  const [showBashManager, setShowBashManager] = useState(false);
  // MCP manager state
  const [showMcpManager, setShowMcpManager] = useState(false);
  // Basic input state
  const {
    inputText,
    setInputText,
    cursorPosition,
    setCursorPosition,
    insertTextAtCursor,
    deleteCharAtCursor,
    clearInput,
    moveCursorLeft,
    moveCursorRight,
    moveCursorToStart,
    moveCursorToEnd,
  } = useInputState();

  // File selector functionality
  const {
    showFileSelector,
    filteredFiles,
    searchQuery,
    activateFileSelector,
    handleFileSelect: handleFileSelectorSelect,
    handleCancelFileSelect,
    updateSearchQuery,
    checkForAtDeletion,
    atPosition,
  } = useFileSelector();

  // Command selector functionality
  const {
    showCommandSelector,
    commandSearchQuery,
    activateCommandSelector,
    handleCommandSelect: handleCommandSelectorSelect,
    handleCommandInsert: handleCommandSelectorInsert,
    handleCancelCommandSelect,
    updateCommandSearchQuery,
    checkForSlashDeletion,
    slashPosition,
  } = useCommandSelector({
    onShowBashManager: () => setShowBashManager(true),
    onShowMcpManager: () => setShowMcpManager(true),
    sendMessage: async (content: string) => {
      await sendMessage(content);
    },
    hasSlashCommand,
  });

  // Bash history selector functionality
  const {
    showBashHistorySelector,
    bashHistorySearchQuery,
    activateBashHistorySelector,
    handleBashHistorySelect: handleBashHistorySelectorSelect,
    handleBashHistoryExecute,
    handleCancelBashHistorySelect,
    updateBashHistorySearchQuery,
    checkForExclamationDeletion,
    exclamationPosition,
  } = useBashHistorySelector();

  // Memory type selector functionality
  const {
    showMemoryTypeSelector,
    memoryMessage,
    activateMemoryTypeSelector,
    handleMemoryTypeSelect: handleMemoryTypeSelectorSelect,
    handleCancelMemoryTypeSelect,
  } = useMemoryTypeSelector();

  // Input history functionality
  const { resetHistoryNavigation, navigateHistory } = useInputHistory({
    userInputHistory,
  });

  // Image management functionality (includes clipboard paste)
  const { attachedImages, clearImages, handlePasteImage } =
    useImageManager(insertTextAtCursor);

  // Keyboard handling
  const {
    handleFileSelect,
    handleCommandSelect,
    handleBashHistorySelect,
    handleBashHistoryExecute: keyboardHandleBashHistoryExecute,
    handleMemoryTypeSelect,
  } = useInputKeyboardHandler({
    inputText,
    setInputText,
    cursorPosition,
    setCursorPosition,
    moveCursorLeft,
    moveCursorRight,
    moveCursorToStart,
    moveCursorToEnd,
    deleteCharAtCursor,
    insertTextAtCursor,
    clearInput,
    resetHistoryNavigation,
    navigateHistory,
    handlePasteImage,
    attachedImages,
    clearImages,
    showFileSelector,
    activateFileSelector,
    handleFileSelect: handleFileSelectorSelect,
    handleCancelFileSelect,
    updateSearchQuery,
    checkForAtDeletion,
    atPosition,
    showCommandSelector,
    activateCommandSelector,
    handleCommandSelect: handleCommandSelectorSelect,
    handleCommandInsert: handleCommandSelectorInsert,
    handleCancelCommandSelect,
    updateCommandSearchQuery,
    checkForSlashDeletion,
    slashPosition,
    showBashHistorySelector,
    activateBashHistorySelector,
    handleBashHistorySelect: handleBashHistorySelectorSelect,
    handleBashHistoryExecute,
    handleCancelBashHistorySelect,
    updateBashHistorySearchQuery,
    checkForExclamationDeletion,
    exclamationPosition,
    showMemoryTypeSelector,
    activateMemoryTypeSelector,
    handleMemoryTypeSelect: handleMemoryTypeSelectorSelect,
    showBashManager,
    showMcpManager,
    isCommandRunning,
    isLoading,
    sendMessage,
    abortMessage,
    saveMemory,
  });

  const isPlaceholder = !inputText;
  const placeholderText = INPUT_PLACEHOLDER_TEXT;

  // Create adapter function for CommandSelector
  const handleCommandInsert = useCallback(
    (command: string) => {
      const result = handleCommandSelectorInsert(
        command,
        inputText,
        cursorPosition,
      );
      setInputText(result.newInput);
      setCursorPosition(result.newCursorPosition);
    },
    [
      handleCommandSelectorInsert,
      inputText,
      cursorPosition,
      setInputText,
      setCursorPosition,
    ],
  );

  // Split text into three parts: before cursor, cursor position, after cursor
  const displayText = isPlaceholder ? placeholderText : inputText;
  const beforeCursor = displayText.substring(0, cursorPosition);
  const atCursor =
    cursorPosition < displayText.length ? displayText[cursorPosition] : " ";
  const afterCursor = displayText.substring(cursorPosition + 1);

  // Always show cursor, allow user to continue input during loading
  const shouldShowCursor = true;

  return (
    <Box flexDirection="column" width={"100%"}>
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
          onExecute={keyboardHandleBashHistoryExecute}
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
        <Box borderStyle="single" borderColor="gray" paddingX={1}>
          <Box width="100%" flexDirection="row" justifyContent="space-between">
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
        </Box>
      )}
    </Box>
  );
};
