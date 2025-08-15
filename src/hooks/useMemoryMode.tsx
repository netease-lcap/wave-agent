import { useState, useCallback } from "react";

export const useMemoryMode = () => {
  const [isMemoryMode, setIsMemoryMode] = useState(false);

  const deactivateMemoryMode = useCallback(() => {
    setIsMemoryMode(false);
  }, []);

  const checkMemoryMode = useCallback(
    (inputText: string) => {
      const shouldBeMemoryMode = inputText.startsWith("#");
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
