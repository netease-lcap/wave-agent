import { useState, useCallback } from "react";

export const useBashHistorySelector = () => {
  const [showBashHistorySelector, setShowBashHistorySelector] = useState(false);
  const [exclamationPosition, setExclamationPosition] = useState(-1);
  const [bashHistorySearchQuery, setBashHistorySearchQuery] = useState("");

  const activateBashHistorySelector = useCallback((position: number) => {
    setShowBashHistorySelector(true);
    setExclamationPosition(position);
    setBashHistorySearchQuery("");
  }, []);

  const handleBashHistorySelect = useCallback(
    (command: string, inputText: string, cursorPosition: number) => {
      if (exclamationPosition >= 0) {
        // 替换 ! 和搜索查询为选中的命令
        const beforeExclamation = inputText.substring(0, exclamationPosition);
        const afterQuery = inputText.substring(cursorPosition);
        const newInput = beforeExclamation + `!${command}` + afterQuery;
        const newCursorPosition = beforeExclamation.length + command.length + 1;

        setShowBashHistorySelector(false);
        setExclamationPosition(-1);
        setBashHistorySearchQuery("");

        return { newInput, newCursorPosition };
      }
      return { newInput: inputText, newCursorPosition: cursorPosition };
    },
    [exclamationPosition],
  );

  const handleCancelBashHistorySelect = useCallback(() => {
    setShowBashHistorySelector(false);
    setExclamationPosition(-1);
    setBashHistorySearchQuery("");
  }, []);

  const handleBashHistoryExecute = useCallback((command: string) => {
    setShowBashHistorySelector(false);
    setExclamationPosition(-1);
    setBashHistorySearchQuery("");
    return command; // 返回要执行的命令
  }, []);

  const updateBashHistorySearchQuery = useCallback((query: string) => {
    setBashHistorySearchQuery(query);
  }, []);

  const checkForExclamationDeletion = useCallback(
    (cursorPosition: number) => {
      if (showBashHistorySelector && cursorPosition <= exclamationPosition) {
        handleCancelBashHistorySelect();
        return true;
      }
      return false;
    },
    [
      showBashHistorySelector,
      exclamationPosition,
      handleCancelBashHistorySelect,
    ],
  );

  return {
    showBashHistorySelector,
    bashHistorySearchQuery,
    activateBashHistorySelector,
    handleBashHistorySelect,
    handleBashHistoryExecute,
    handleCancelBashHistorySelect,
    updateBashHistorySearchQuery,
    checkForExclamationDeletion,
    exclamationPosition,
  };
};
