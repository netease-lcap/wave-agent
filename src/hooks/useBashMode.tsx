import { useState, useCallback } from "react";

export const useBashMode = () => {
  const [isBashMode, setIsBashMode] = useState(false);

  const activateBashMode = useCallback(() => {
    setIsBashMode(true);
  }, []);

  const deactivateBashMode = useCallback(() => {
    setIsBashMode(false);
  }, []);

  const checkBashMode = useCallback(
    (inputText: string) => {
      let shouldBeBashMode;

      if (isBashMode) {
        // 如果已经在 bash 模式中，只要文本以 ! 开头就保持 bash 模式
        shouldBeBashMode = inputText.startsWith("!");
      } else {
        // 如果不在 bash 模式中，只有输入单个 ! 字符才进入 bash 模式
        shouldBeBashMode = inputText === "!";
      }

      if (shouldBeBashMode !== isBashMode) {
        setIsBashMode(shouldBeBashMode);
      }
      return shouldBeBashMode;
    },
    [isBashMode],
  );

  return {
    isBashMode,
    activateBashMode,
    deactivateBashMode,
    checkBashMode,
  };
};
