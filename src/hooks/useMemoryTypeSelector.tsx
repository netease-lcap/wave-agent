import { useState } from "react";

export interface UseMemoryTypeSelectorReturn {
  showMemoryTypeSelector: boolean;
  memoryMessage: string;
  activateMemoryTypeSelector: (message: string) => void;
  handleMemoryTypeSelect: (type: "project" | "user") => void;
  handleCancelMemoryTypeSelect: () => void;
}

export const useMemoryTypeSelector = (): UseMemoryTypeSelectorReturn => {
  const [showMemoryTypeSelector, setShowMemoryTypeSelector] = useState(false);
  const [memoryMessage, setMemoryMessage] = useState("");

  const activateMemoryTypeSelector = (message: string) => {
    setMemoryMessage(message);
    setShowMemoryTypeSelector(true);
  };

  const handleMemoryTypeSelect = (type: "project" | "user"): void => {
    setShowMemoryTypeSelector(false);
    setMemoryMessage("");
    // type 参数由外部组件传入，这里只负责关闭选择器
    // 实际的类型处理在 useInputKeyboardHandler 中完成
    void type; // 明确标记参数已知但未使用
  };

  const handleCancelMemoryTypeSelect = () => {
    setShowMemoryTypeSelector(false);
    setMemoryMessage("");
  };

  return {
    showMemoryTypeSelector,
    memoryMessage,
    activateMemoryTypeSelector,
    handleMemoryTypeSelect,
    handleCancelMemoryTypeSelect,
  };
};
