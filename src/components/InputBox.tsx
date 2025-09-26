import React, { useState } from "react";
import { Box, Text } from "ink";
import { FileSelector } from "./FileSelector";
import { CommandSelector } from "./CommandSelector";
import { BashHistorySelector } from "./BashHistorySelector";
import { MemoryTypeSelector } from "./MemoryTypeSelector";
import { BashShellManager } from "./BashShellManager";
import { McpManager } from "./McpManager";
import { useInputState } from "../hooks/useInputState";
import { useFileSelector } from "../hooks/useFileSelector";
import { useCommandSelector } from "../hooks/useCommandSelector";
import { useBashHistorySelector } from "../hooks/useBashHistorySelector";
import { useMemoryTypeSelector } from "../hooks/useMemoryTypeSelector";
import { useInputHistory } from "../hooks/useInputHistory";
import { useTextInsertion } from "../hooks/useTextInsertion";
import { useInputKeyboardHandler } from "../hooks/useInputKeyboardHandler";
import { useImageManager } from "../hooks/useImageManager";

export const INPUT_PLACEHOLDER_TEXT =
  "Type your message (use @ to reference files, / for commands, ! for bash history, # to add memory)...";

export const INPUT_PLACEHOLDER_TEXT_PREFIX = INPUT_PLACEHOLDER_TEXT.substring(
  0,
  10,
);

export interface InputBoxProps {
  isLoading?: boolean;
  isCommandRunning?: boolean;
  userInputHistory?: string[];
  workdir?: string;
  clearMessages?: () => void;
  sendMessage?: (
    message: string,
    images?: Array<{ path: string; mimeType: string }>,
    options?: { isBashCommand?: boolean },
  ) => void;
  abortMessage?: () => void;
  saveMemory?: (message: string, type: "project" | "user") => Promise<void>;
  setInputInsertHandler?: (handler: (text: string) => void) => void;
}

export const InputBox: React.FC<InputBoxProps> = ({
  isLoading = false,
  isCommandRunning = false,
  userInputHistory = [],
  workdir = process.cwd(),
  clearMessages = () => {},
  sendMessage = () => {},
  abortMessage = () => {},
  saveMemory = async () => {},
  setInputInsertHandler = () => {},
}) => {
  // Bash shell manager state
  const [showBashManager, setShowBashManager] = useState(false);
  // MCP manager state
  const [showMcpManager, setShowMcpManager] = useState(false);
  // 基础输入状态
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

  // 文件选择器功能
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
  } = useFileSelector(workdir);

  // 命令选择器功能
  const {
    showCommandSelector,
    commandSearchQuery,
    activateCommandSelector,
    handleCommandSelect: handleCommandSelectorSelect,
    handleCommandGenerated: handleCommandSelectorGenerated,
    handleCancelCommandSelect,
    updateCommandSearchQuery,
    checkForSlashDeletion,
    slashPosition,
  } = useCommandSelector({
    clearMessages,
    onShowBashManager: () => setShowBashManager(true),
    onShowMcpManager: () => setShowMcpManager(true),
  });

  // Bash历史选择器功能
  const {
    showBashHistorySelector,
    bashHistorySearchQuery,
    activateBashHistorySelector,
    handleBashHistorySelect: handleBashHistorySelectorSelect,
    handleCancelBashHistorySelect,
    updateBashHistorySearchQuery,
    checkForExclamationDeletion,
    exclamationPosition,
  } = useBashHistorySelector();

  // 记忆类型选择器功能
  const {
    showMemoryTypeSelector,
    memoryMessage,
    activateMemoryTypeSelector,
    handleMemoryTypeSelect: handleMemoryTypeSelectorSelect,
    handleCancelMemoryTypeSelect,
  } = useMemoryTypeSelector();

  // 输入历史功能
  const { resetHistoryNavigation, navigateHistory } = useInputHistory({
    userInputHistory,
  });

  // 图片管理功能（包含剪贴板粘贴）
  const { attachedImages, clearImages, handlePasteImage } =
    useImageManager(insertTextAtCursor);

  // 文本插入功能
  useTextInsertion(setInputText, setCursorPosition, resetHistoryNavigation, {
    setInputInsertHandler,
  });

  // 键盘处理
  const {
    handleFileSelect,
    handleCommandSelect,
    handleCommandGenerated,
    handleBashHistorySelect,
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
    handleCommandGenerated: handleCommandSelectorGenerated,
    handleCancelCommandSelect,
    updateCommandSearchQuery,
    checkForSlashDeletion,
    slashPosition,
    showBashHistorySelector,
    activateBashHistorySelector,
    handleBashHistorySelect: handleBashHistorySelectorSelect,
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

  // 将文本拆分为光标前、光标位置、光标后三部分
  const displayText = isPlaceholder ? placeholderText : inputText;
  const beforeCursor = displayText.substring(0, cursorPosition);
  const atCursor =
    cursorPosition < displayText.length ? displayText[cursorPosition] : " ";
  const afterCursor = displayText.substring(cursorPosition + 1);

  // 始终显示光标，允许用户在 loading 期间继续输入
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
          workdir={workdir}
          onSelect={handleCommandSelect}
          onCancel={handleCancelCommandSelect}
          onCommandGenerated={handleCommandGenerated}
        />
      )}

      {showBashHistorySelector && (
        <BashHistorySelector
          searchQuery={bashHistorySearchQuery}
          workdir={workdir}
          onSelect={handleBashHistorySelect}
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
        <McpManager onCancel={() => setShowMcpManager(false)} />
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
