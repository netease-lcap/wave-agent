import { useCallback, useEffect } from "react";

export interface UseTextInsertionParams {
  setInputInsertHandler: (handler: (text: string) => void) => void;
}

export const useTextInsertion = (
  setInputText: (text: string) => void,
  setCursorPosition: (position: number) => void,
  resetHistoryNavigation: () => void,
  { setInputInsertHandler }: UseTextInsertionParams,
) => {
  // 处理文本插入到输入框
  const handleTextInsert = useCallback(
    (text: string) => {
      const prefix = "命令输出：\n\n```\n";
      const suffix = "\n```";
      const fullText = prefix + text + suffix;

      setInputText(fullText);
      setCursorPosition(fullText.length);
      resetHistoryNavigation();
    },
    [setInputText, setCursorPosition, resetHistoryNavigation],
  );

  // 注册输入插入处理器
  useEffect(() => {
    setInputInsertHandler(() => handleTextInsert);
    return () => {
      setInputInsertHandler(() => {});
    };
  }, [setInputInsertHandler, handleTextInsert]);

  return {
    handleTextInsert,
  };
};
