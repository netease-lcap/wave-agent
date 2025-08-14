import { useState, useCallback } from "react";

export interface InputHistoryContextType {
  userInputHistory: string[];
  addToInputHistory: (input: string) => void;
  clearInputHistory: () => void;
}

export const useInputHistory = (
  initialHistory?: string[],
): InputHistoryContextType => {
  const [userInputHistory, setUserInputHistory] = useState<string[]>(
    initialHistory || [],
  );

  const addToInputHistory = useCallback((input: string) => {
    setUserInputHistory((prev) => {
      // 避免重复添加相同的输入
      if (prev.length > 0 && prev[prev.length - 1] === input) {
        return prev;
      }
      // 限制历史记录数量，保留最近的100条
      const newHistory = [...prev, input];
      return newHistory.slice(-100);
    });
  }, []);

  const clearInputHistory = useCallback(() => {
    setUserInputHistory([]);
  }, []);

  return {
    userInputHistory,
    addToInputHistory,
    clearInputHistory,
  };
};
