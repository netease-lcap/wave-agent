import { useState, useCallback } from "react";

export const useMemoryMode = () => {
  const [isMemoryMode, setIsMemoryMode] = useState(false);

  const deactivateMemoryMode = useCallback(() => {
    setIsMemoryMode(false);
  }, []);

  const checkMemoryMode = useCallback(
    (inputText: string) => {
      let shouldBeMemoryMode;

      if (isMemoryMode) {
        // 如果已经在记忆模式中，只要文本以 # 开头就保持记忆模式
        shouldBeMemoryMode = inputText.startsWith("#");
      } else {
        // 如果不在记忆模式中，只有输入单个 # 字符才进入记忆模式
        shouldBeMemoryMode = inputText === "#";
      }

      if (shouldBeMemoryMode !== isMemoryMode) {
        setIsMemoryMode(shouldBeMemoryMode);
      }
      return shouldBeMemoryMode;
    },
    [isMemoryMode],
  );

  return {
    isMemoryMode,
    deactivateMemoryMode,
    checkMemoryMode,
  };
};
