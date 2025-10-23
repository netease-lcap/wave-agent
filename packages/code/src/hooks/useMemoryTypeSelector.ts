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
    // Type parameter is passed by external component, here only responsible for closing selector
    // Actual type handling is completed in useInputKeyboardHandler
    void type; // Explicitly mark parameter as known but unused
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
