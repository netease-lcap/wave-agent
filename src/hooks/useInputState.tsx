import { useState, useCallback } from 'react';

export const useInputState = () => {
  const [inputText, setInputText] = useState('');
  const [cursorPosition, setCursorPosition] = useState(0);

  const insertTextAtCursor = useCallback((text: string) => {
    setCursorPosition((currentCursor) => {
      setInputText((currentText) => {
        const beforeCursor = currentText.substring(0, currentCursor);
        const afterCursor = currentText.substring(currentCursor);
        return beforeCursor + text + afterCursor;
      });
      return currentCursor + text.length;
    });
  }, []);

  const deleteCharAtCursor = useCallback(() => {
    setCursorPosition((currentCursor) => {
      if (currentCursor > 0) {
        setInputText((currentText) => {
          const beforeCursor = currentText.substring(0, currentCursor - 1);
          const afterCursor = currentText.substring(currentCursor);
          return beforeCursor + afterCursor;
        });
        return currentCursor - 1;
      }
      return currentCursor;
    });
  }, []);

  const clearInput = useCallback(() => {
    setInputText('');
    setCursorPosition(0);
  }, []);

  const moveCursorLeft = useCallback(() => {
    setCursorPosition((current) => Math.max(0, current - 1));
  }, []);

  const moveCursorRight = useCallback(() => {
    setCursorPosition((current) => Math.min(inputText.length, current + 1));
  }, [inputText.length]);

  const moveCursorToStart = useCallback(() => {
    setCursorPosition(0);
  }, []);

  const moveCursorToEnd = useCallback(() => {
    setCursorPosition(inputText.length);
  }, [inputText.length]);

  return {
    inputText,
    setInputText,
    cursorPosition,
    setCursorPosition,
    insertTextAtCursor,
    deleteCharAtCursor,
    clearInput,
    moveCursorLeft,
    moveCursorRight,
    moveCursorToStart,
    moveCursorToEnd,
  };
};
