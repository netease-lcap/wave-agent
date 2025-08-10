import { useState, useCallback } from 'react';
import { useChat } from '../contexts/useChat';

export const useInputHistory = () => {
  const [historyIndex, setHistoryIndex] = useState(-1);
  const [currentDraftText, setCurrentDraftText] = useState('');

  const { userInputHistory } = useChat();

  // 重置历史导航状态
  const resetHistoryNavigation = useCallback(() => {
    setHistoryIndex(-1);
    setCurrentDraftText('');
  }, []);

  // 处理历史导航
  const navigateHistory = useCallback(
    (direction: 'up' | 'down', inputText: string) => {
      if (userInputHistory.length === 0) return { newInput: inputText, newCursorPosition: inputText.length };

      if (direction === 'up') {
        // 向上导航到更早的历史记录
        if (historyIndex === -1) {
          // 第一次按上键，保存当前输入作为草稿
          setCurrentDraftText(inputText);
          const newIndex = userInputHistory.length - 1;
          setHistoryIndex(newIndex);
          const newInput = userInputHistory[newIndex];
          return { newInput, newCursorPosition: newInput.length };
        } else if (historyIndex > 0) {
          const newIndex = historyIndex - 1;
          setHistoryIndex(newIndex);
          const newInput = userInputHistory[newIndex];
          return { newInput, newCursorPosition: newInput.length };
        }
      } else {
        // 向下导航到更新的历史记录
        if (historyIndex >= 0) {
          if (historyIndex < userInputHistory.length - 1) {
            const newIndex = historyIndex + 1;
            setHistoryIndex(newIndex);
            const newInput = userInputHistory[newIndex];
            return { newInput, newCursorPosition: newInput.length };
          } else {
            // 回到草稿文本
            setHistoryIndex(-1);
            const newInput = currentDraftText;
            return { newInput, newCursorPosition: newInput.length };
          }
        } else {
          // 已经在草稿状态，再次按下键清空输入框
          if (inputText.trim() !== '') {
            setCurrentDraftText('');
            return { newInput: '', newCursorPosition: 0 };
          }
        }
      }

      return { newInput: inputText, newCursorPosition: inputText.length };
    },
    [userInputHistory, historyIndex, currentDraftText],
  );

  return {
    resetHistoryNavigation,
    navigateHistory,
  };
};
