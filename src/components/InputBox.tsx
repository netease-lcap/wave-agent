import React from "react";
import { Box, Text } from "ink";
import { FileSelector } from "./FileSelector";
import { CommandSelector } from "./CommandSelector";
import { BashHistorySelector } from "./BashHistorySelector";
import { MemoryTypeSelector } from "./MemoryTypeSelector";
import { useChat } from "../contexts/useChat";
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

export const InputBox: React.FC = () => {
  const { isLoading } = useChat();

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
  } = useFileSelector();

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
  } = useCommandSelector();

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
  const { resetHistoryNavigation, navigateHistory } = useInputHistory();

  // 图片管理功能（包含剪贴板粘贴）
  const { attachedImages, clearImages, handlePasteImage } =
    useImageManager(insertTextAtCursor);

  // 文本插入功能
  useTextInsertion(setInputText, setCursorPosition, resetHistoryNavigation);

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
    <Box borderStyle="single" borderColor="gray" paddingX={1}>
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
            onCancel={handleCancelCommandSelect}
            onCommandGenerated={handleCommandGenerated}
          />
        )}

        {showBashHistorySelector && (
          <BashHistorySelector
            searchQuery={bashHistorySearchQuery}
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
          {isLoading && (
            <Text color="yellow" bold>
              {"[Press Esc to abort]"}
            </Text>
          )}
        </Box>
      </Box>
    </Box>
  );
};
