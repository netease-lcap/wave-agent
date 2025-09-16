import { useState, useCallback } from "react";
import { useChat } from "../contexts/useChat";

export const useInputHistory = () => {
  const [historyIndex, setHistoryIndex] = useState(-1);
  const [currentDraftText, setCurrentDraftText] = useState("");

  const { userInputHistory } = useChat();

  // 重置历史导航状态
  const resetHistoryNavigation = useCallback(() => {
    setHistoryIndex(-1);
    setCurrentDraftText("");
  }, []);

  // 处理历史导航，支持叹号开头单行消息自动进入bash模式
  const navigateHistory = useCallback(
    (
      direction: "up" | "down",
      inputText: string,
      activateBashMode?: () => void,
    ) => {
      if (userInputHistory.length === 0)
        return { newInput: inputText, newCursorPosition: inputText.length };

      let newInput: string;
      let shouldCheckBashMode = false;

      if (direction === "up") {
        // 向上导航到更早的历史记录
        if (historyIndex === -1) {
          // 第一次按上键，保存当前输入作为草稿
          setCurrentDraftText(inputText);
          const newIndex = userInputHistory.length - 1;
          setHistoryIndex(newIndex);
          newInput = userInputHistory[newIndex];
          shouldCheckBashMode = true;
        } else if (historyIndex > 0) {
          const newIndex = historyIndex - 1;
          setHistoryIndex(newIndex);
          newInput = userInputHistory[newIndex];
          shouldCheckBashMode = true;
        } else {
          newInput = inputText;
        }
      } else {
        // 向下导航到更新的历史记录
        if (historyIndex >= 0) {
          if (historyIndex < userInputHistory.length - 1) {
            const newIndex = historyIndex + 1;
            setHistoryIndex(newIndex);
            newInput = userInputHistory[newIndex];
            shouldCheckBashMode = true;
          } else {
            // 回到草稿文本
            setHistoryIndex(-1);
            newInput = currentDraftText;
          }
        } else {
          // 已经在草稿状态，再次按下键清空输入框
          if (inputText.trim() !== "") {
            setCurrentDraftText("");
            newInput = "";
          } else {
            newInput = inputText;
          }
        }
      }

      // 检查是否需要激活bash模式：以叹号开头且只有一行
      if (
        shouldCheckBashMode &&
        activateBashMode &&
        newInput.startsWith("!") &&
        !newInput.includes("\n")
      ) {
        activateBashMode();
      }

      return { newInput, newCursorPosition: newInput.length };
    },
    [userInputHistory, historyIndex, currentDraftText],
  );

  return {
    resetHistoryNavigation,
    navigateHistory,
  };
};
