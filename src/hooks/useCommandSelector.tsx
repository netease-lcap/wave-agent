import { useState, useCallback } from 'react';
import { useChat } from '../contexts/useChat';

export const useCommandSelector = () => {
  const [showCommandSelector, setShowCommandSelector] = useState(false);
  const [slashPosition, setSlashPosition] = useState(-1);
  const [commandSearchQuery, setCommandSearchQuery] = useState('');

  const { clearMessages } = useChat();

  const activateCommandSelector = useCallback((position: number) => {
    setShowCommandSelector(true);
    setSlashPosition(position);
    setCommandSearchQuery('');
  }, []);

  const handleCommandSelect = useCallback(
    (command: string, inputText: string, cursorPosition: number) => {
      if (slashPosition >= 0) {
        // 替换 / 和搜索查询为选中的命令并执行
        const beforeSlash = inputText.substring(0, slashPosition);
        const afterQuery = inputText.substring(cursorPosition);
        const newInput = beforeSlash + afterQuery;
        const newCursorPosition = beforeSlash.length;

        // 执行命令
        if (command === 'clean') {
          clearMessages();
        }

        setShowCommandSelector(false);
        setSlashPosition(-1);
        setCommandSearchQuery('');

        return { newInput, newCursorPosition };
      }
      return { newInput: inputText, newCursorPosition: cursorPosition };
    },
    [slashPosition, clearMessages],
  );

  const handleCommandGenerated = useCallback((generatedCommand: string) => {
    // 将生成的命令放入输入框
    setShowCommandSelector(false);
    setSlashPosition(-1);
    setCommandSearchQuery('');

    return {
      newInput: generatedCommand,
      newCursorPosition: generatedCommand.length,
    };
  }, []);

  const handleCancelCommandSelect = useCallback(() => {
    setShowCommandSelector(false);
    setSlashPosition(-1);
    setCommandSearchQuery('');
  }, []);

  const updateCommandSearchQuery = useCallback((query: string) => {
    setCommandSearchQuery(query);
  }, []);

  const checkForSlashDeletion = useCallback(
    (cursorPosition: number) => {
      if (showCommandSelector && cursorPosition <= slashPosition) {
        handleCancelCommandSelect();
        return true;
      }
      return false;
    },
    [showCommandSelector, slashPosition, handleCancelCommandSelect],
  );

  return {
    showCommandSelector,
    commandSearchQuery,
    activateCommandSelector,
    handleCommandSelect,
    handleCommandGenerated,
    handleCancelCommandSelect,
    updateCommandSearchQuery,
    checkForSlashDeletion,
    slashPosition,
  };
};
