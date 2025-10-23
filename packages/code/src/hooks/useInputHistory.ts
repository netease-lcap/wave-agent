import { useState, useCallback } from "react";

export interface UseInputHistoryParams {
  userInputHistory: string[];
}

export const useInputHistory = ({
  userInputHistory,
}: UseInputHistoryParams) => {
  const [historyIndex, setHistoryIndex] = useState(-1);
  const [currentDraftText, setCurrentDraftText] = useState("");

  // Reset history navigation state
  const resetHistoryNavigation = useCallback(() => {
    setHistoryIndex(-1);
    setCurrentDraftText("");
  }, []);

  // Handle history navigation
  const navigateHistory = useCallback(
    (direction: "up" | "down", inputText: string) => {
      if (userInputHistory.length === 0)
        return { newInput: inputText, newCursorPosition: inputText.length };

      let newInput: string;

      if (direction === "up") {
        // Navigate up to earlier history records
        if (historyIndex === -1) {
          // First time pressing up key, save current input as draft
          setCurrentDraftText(inputText);
          const newIndex = userInputHistory.length - 1;
          setHistoryIndex(newIndex);
          newInput = userInputHistory[newIndex];
        } else if (historyIndex > 0) {
          const newIndex = historyIndex - 1;
          setHistoryIndex(newIndex);
          newInput = userInputHistory[newIndex];
        } else {
          newInput = inputText;
        }
      } else {
        // Navigate down to newer history records
        if (historyIndex >= 0) {
          if (historyIndex < userInputHistory.length - 1) {
            const newIndex = historyIndex + 1;
            setHistoryIndex(newIndex);
            newInput = userInputHistory[newIndex];
          } else {
            // Return to draft text
            setHistoryIndex(-1);
            newInput = currentDraftText;
          }
        } else {
          // Already in draft state, pressing down key again clears input box
          if (inputText.trim() !== "") {
            setCurrentDraftText("");
            newInput = "";
          } else {
            newInput = inputText;
          }
        }
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
