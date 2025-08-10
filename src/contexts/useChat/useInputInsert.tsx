import { useState, useCallback } from 'react';

export interface InputInsertContextType {
  insertToInput: (text: string) => void;
  inputInsertHandler: ((text: string) => void) | null;
  setInputInsertHandler: (handler: (text: string) => void) => void;
}

export const useInputInsert = (): InputInsertContextType => {
  const [inputInsertHandler, setInputInsertHandler] = useState<((text: string) => void) | null>(null);

  const insertToInput = useCallback(
    (text: string) => {
      if (inputInsertHandler) {
        inputInsertHandler(text);
      }
    },
    [inputInsertHandler],
  );

  const setInputInsertHandlerCallback = useCallback((handler: (text: string) => void) => {
    setInputInsertHandler(() => handler);
  }, []);

  return {
    insertToInput,
    inputInsertHandler,
    setInputInsertHandler: setInputInsertHandlerCallback,
  };
};
