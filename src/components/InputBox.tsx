import React from 'react';
import { Box, Text } from 'ink';
import { FileSelector } from './FileSelector';
import { CommandSelector } from './CommandSelector';
import { BashHistorySelector } from './BashHistorySelector';
import { useChat } from '../contexts/useChat';
import { useInputState } from '../hooks/useInputState';
import { useFileSelector } from '../hooks/useFileSelector';
import { useCommandSelector } from '../hooks/useCommandSelector';
import { useBashHistorySelector } from '../hooks/useBashHistorySelector';
import { useInputHistory } from '../hooks/useInputHistory';
import { useTextInsertion } from '../hooks/useTextInsertion';
import { useInputKeyboardHandler } from '../hooks/useInputKeyboardHandler';
import { useImageManager } from '../hooks/useImageManager';
import { useClipboardPaste } from '../hooks/useClipboardPaste';

export const INPUT_PLACEHOLDER_TEXT =
  'Type your message (use @ to reference files, / for commands, ! for bash history, Shift+Enter for new line)...';

export const INPUT_PLACEHOLDER_TEXT_PREFIX = INPUT_PLACEHOLDER_TEXT.substring(0, 10);

export const InputBox: React.FC = () => {
  const { isCommandRunning, isLoading } = useChat();

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

  // 输入历史功能
  const { resetHistoryNavigation, navigateHistory } = useInputHistory();

  // 图片管理功能
  const { attachedImages, addImage, clearImages } = useImageManager();

  // 文本插入功能
  useTextInsertion(setInputText, setCursorPosition, resetHistoryNavigation);

  // 剪贴板粘贴功能
  const { handlePasteImage } = useClipboardPaste(addImage, insertTextAtCursor);

  // 键盘处理
  const { handleFileSelect, handleCommandSelect, handleCommandGenerated, handleBashHistorySelect } =
    useInputKeyboardHandler({
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
    });

  const isPlaceholder = !inputText;
  const placeholderText = INPUT_PLACEHOLDER_TEXT;

  // 将文本拆分为光标前、光标位置、光标后三部分
  const displayText = isPlaceholder ? placeholderText : inputText;
  const beforeCursor = displayText.substring(0, cursorPosition);
  const atCursor = cursorPosition < displayText.length ? displayText[cursorPosition] : ' ';
  const afterCursor = displayText.substring(cursorPosition + 1);

  return (
    <Box borderStyle="single" borderColor="gray" paddingX={1} paddingY={1}>
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

        <Box>
          <Text color={isPlaceholder ? 'gray' : 'white'}>
            {beforeCursor}
            <Text backgroundColor="white" color="black">
              {atCursor}
            </Text>
            {afterCursor}
          </Text>
          {isLoading && (
            <Box marginLeft={2}>
              <Text color="red" bold>
                {isCommandRunning ? '[Tool execution in progress...]' : '[Press Esc to abort]'}
              </Text>
            </Box>
          )}
        </Box>
      </Box>
    </Box>
  );
};
