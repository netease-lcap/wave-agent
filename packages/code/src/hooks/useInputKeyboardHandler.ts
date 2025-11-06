import { useCallback, useRef, useEffect } from "react";
import { useInput, Key } from "ink";
import { logger } from "../utils/logger.js";

interface KeyboardHandlerProps {
  inputText: string;
  setInputText: (text: string) => void;
  cursorPosition: number;
  setCursorPosition: (position: number) => void;
  moveCursorLeft: () => void;
  moveCursorRight: () => void;
  moveCursorToStart: () => void;
  moveCursorToEnd: () => void;
  deleteCharAtCursor: () => void;
  insertTextAtCursor: (text: string) => void;
  clearInput: () => void;
  resetHistoryNavigation: () => void;
  navigateHistory: (
    direction: "up" | "down",
    inputText: string,
    activateBashMode?: () => void,
  ) => { newInput: string; newCursorPosition: number };
  handlePasteImage: () => Promise<boolean>;
  attachedImages: Array<{ id: number; path: string; mimeType: string }>;
  clearImages: () => void;

  // File selector
  showFileSelector: boolean;
  activateFileSelector: (position: number) => void;
  handleFileSelect: (
    filePath: string,
    inputText: string,
    cursorPosition: number,
  ) => { newInput: string; newCursorPosition: number };
  handleCancelFileSelect: () => void;
  updateSearchQuery: (query: string) => void;
  checkForAtDeletion: (cursorPosition: number) => boolean;
  atPosition: number;

  // Command selector
  showCommandSelector: boolean;
  activateCommandSelector: (position: number) => void;
  handleCommandSelect: (
    command: string,
    inputText: string,
    cursorPosition: number,
  ) => { newInput: string; newCursorPosition: number };
  handleCommandInsert: (
    command: string,
    inputText: string,
    cursorPosition: number,
  ) => { newInput: string; newCursorPosition: number };
  handleCancelCommandSelect: () => void;
  updateCommandSearchQuery: (query: string) => void;
  checkForSlashDeletion: (cursorPosition: number) => boolean;
  slashPosition: number;

  // Bash history selector
  showBashHistorySelector: boolean;
  activateBashHistorySelector: (position: number) => void;
  handleBashHistorySelect: (
    command: string,
    inputText: string,
    cursorPosition: number,
  ) => { newInput: string; newCursorPosition: number };
  handleBashHistoryExecute: (command: string) => string;
  handleCancelBashHistorySelect: () => void;
  updateBashHistorySearchQuery: (query: string) => void;
  checkForExclamationDeletion: (cursorPosition: number) => boolean;
  exclamationPosition: number;

  // Memory type selector
  showMemoryTypeSelector: boolean;
  activateMemoryTypeSelector: (message: string) => void;
  handleMemoryTypeSelect: (type: "project" | "user") => void;

  // Bash shell manager
  showBashManager: boolean;

  // MCP manager
  showMcpManager: boolean;

  // Chat actions
  isCommandRunning: boolean;
  isLoading: boolean;
  sendMessage: (
    message: string,
    images?: Array<{ path: string; mimeType: string }>,
  ) => void;
  abortMessage: () => void;
  saveMemory: (message: string, type: "project" | "user") => Promise<void>;
}

export const useInputKeyboardHandler = (props: KeyboardHandlerProps) => {
  const {
    inputText,
    setInputText,
    cursorPosition,
    setCursorPosition,
    moveCursorLeft,
    moveCursorRight,
    moveCursorToStart,
    moveCursorToEnd,
    deleteCharAtCursor,
    insertTextAtCursor,
    clearInput,
    resetHistoryNavigation,
    navigateHistory,
    handlePasteImage,
    attachedImages,
    clearImages,
    showFileSelector,
    activateFileSelector,
    handleFileSelect,
    handleCancelFileSelect,
    updateSearchQuery,
    checkForAtDeletion,
    atPosition,
    showCommandSelector,
    activateCommandSelector,
    handleCommandSelect,
    handleCommandInsert,
    handleCancelCommandSelect,
    updateCommandSearchQuery,
    checkForSlashDeletion,
    slashPosition,
    showBashHistorySelector,
    activateBashHistorySelector,
    handleBashHistorySelect,
    handleBashHistoryExecute,
    handleCancelBashHistorySelect,
    updateBashHistorySearchQuery,
    checkForExclamationDeletion,
    exclamationPosition,
    showMemoryTypeSelector,
    activateMemoryTypeSelector,
    handleMemoryTypeSelect,
    showBashManager,
    showMcpManager,
    isCommandRunning,
    isLoading,
    sendMessage,
    abortMessage,
    saveMemory,
  } = props;

  // Debounce for paste operations
  const pasteDebounceRef = useRef<{
    timer: NodeJS.Timeout | null;
    buffer: string;
    initialCursorPosition: number;
    isPasting: boolean;
  }>({
    timer: null,
    buffer: "",
    initialCursorPosition: 0,
    isPasting: false,
  });

  // Long text compression management
  const longTextCounterRef = useRef<number>(0);
  const longTextMapRef = useRef<Map<string, string>>(new Map());

  const generateCompressedText = (originalText: string): string => {
    longTextCounterRef.current += 1;
    const compressedLabel = `[LongText#${longTextCounterRef.current}]`;
    longTextMapRef.current.set(compressedLabel, originalText);
    return compressedLabel;
  };

  const expandLongTextPlaceholders = (text: string): string => {
    let expandedText = text;
    const longTextRegex = /\[LongText#(\d+)\]/g;
    const matches = [...text.matchAll(longTextRegex)];

    for (const match of matches) {
      const placeholder = match[0];
      const originalText = longTextMapRef.current.get(placeholder);
      if (originalText) {
        expandedText = expandedText.replace(placeholder, originalText);
      }
    }

    return expandedText;
  };

  // Cleanup on unmount
  useEffect(() => {
    const currentDebounceRef = pasteDebounceRef.current;
    return () => {
      if (currentDebounceRef.timer) {
        clearTimeout(currentDebounceRef.timer);
      }
    };
  }, []);

  const handleSelectorInput = useCallback(
    (input: string, key: Key) => {
      if (key.backspace || key.delete) {
        if (cursorPosition > 0) {
          const newInput =
            inputText.substring(0, cursorPosition - 1) +
            inputText.substring(cursorPosition);
          setInputText(newInput);
          setCursorPosition(cursorPosition - 1);

          // Update search query
          if (atPosition >= 0) {
            const queryStart = atPosition + 1;
            const queryEnd = cursorPosition - 1;
            if (queryEnd <= atPosition) {
              // Deleted @ symbol, close file selector
              handleCancelFileSelect();
            } else {
              const newQuery = newInput.substring(queryStart, queryEnd);
              updateSearchQuery(newQuery);
            }
          } else if (slashPosition >= 0) {
            const queryStart = slashPosition + 1;
            const queryEnd = cursorPosition - 1;
            if (queryEnd <= slashPosition) {
              // Deleted / symbol, close command selector
              handleCancelCommandSelect();
            } else {
              const newQuery = newInput.substring(queryStart, queryEnd);
              updateCommandSearchQuery(newQuery);
            }
          } else if (exclamationPosition >= 0) {
            const queryStart = exclamationPosition + 1;
            const queryEnd = cursorPosition - 1;
            if (queryEnd <= exclamationPosition) {
              // Deleted ! symbol, close bash history selector
              handleCancelBashHistorySelect();
            } else {
              const newQuery = newInput.substring(queryStart, queryEnd);
              updateBashHistorySearchQuery(newQuery);
            }
          }
        }
        return;
      }

      // Arrow keys should be handled by selector components, no need to filter here
      if (key.upArrow || key.downArrow) {
        // Let selector component handle arrow key navigation
        return;
      }

      if (
        input &&
        !key.ctrl &&
        !("alt" in key && key.alt) &&
        !key.meta &&
        !key.return &&
        !key.escape &&
        !key.leftArrow &&
        !key.rightArrow &&
        !("home" in key && key.home) &&
        !("end" in key && key.end)
      ) {
        // Handle character input for search
        const char = input;
        const newInput =
          inputText.substring(0, cursorPosition) +
          char +
          inputText.substring(cursorPosition);
        setInputText(newInput);
        setCursorPosition(cursorPosition + input.length);

        // Update search query
        if (atPosition >= 0) {
          const queryStart = atPosition + 1;
          const queryEnd = cursorPosition + input.length;
          const newQuery = newInput.substring(queryStart, queryEnd);
          updateSearchQuery(newQuery);
        } else if (slashPosition >= 0) {
          const queryStart = slashPosition + 1;
          const queryEnd = cursorPosition + input.length;
          const newQuery = newInput.substring(queryStart, queryEnd);
          updateCommandSearchQuery(newQuery);
        } else if (exclamationPosition >= 0) {
          const queryStart = exclamationPosition + 1;
          const queryEnd = cursorPosition + input.length;
          const newQuery = newInput.substring(queryStart, queryEnd);
          updateBashHistorySearchQuery(newQuery);
        }
      }
    },
    [
      inputText,
      cursorPosition,
      setInputText,
      setCursorPosition,
      atPosition,
      slashPosition,
      exclamationPosition,
      handleCancelFileSelect,
      handleCancelCommandSelect,
      handleCancelBashHistorySelect,
      updateSearchQuery,
      updateCommandSearchQuery,
      updateBashHistorySearchQuery,
    ],
  );

  const handleNormalInput = useCallback(
    async (input: string, key: Key) => {
      if (key.return) {
        // Prevent submission during loading or command execution
        if (isLoading || isCommandRunning) {
          return;
        }

        if (inputText.trim()) {
          const trimmedInput = inputText.trim();

          // Check if it's a memory message (starts with # and only one line)
          if (trimmedInput.startsWith("#") && !trimmedInput.includes("\n")) {
            // Activate memory type selector
            activateMemoryTypeSelector(trimmedInput);
            return;
          }

          // Extract image information
          const imageRegex = /\[Image #(\d+)\]/g;
          const matches = [...inputText.matchAll(imageRegex)];
          const referencedImages = matches
            .map((match) => {
              const imageId = parseInt(match[1], 10);
              return attachedImages.find((img) => img.id === imageId);
            })
            .filter(
              (img): img is { id: number; path: string; mimeType: string } =>
                img !== undefined,
            )
            .map((img) => ({ path: img.path, mimeType: img.mimeType }));

          // Remove image placeholders, expand long text placeholders, send message
          let cleanContent = inputText.replace(imageRegex, "").trim();
          cleanContent = expandLongTextPlaceholders(cleanContent);

          sendMessage(
            cleanContent,
            referencedImages.length > 0 ? referencedImages : undefined,
          );
          clearInput();
          clearImages();
          resetHistoryNavigation();

          // Clear long text mapping
          longTextMapRef.current.clear();
        }
        return;
      }

      if (key.escape) {
        if (showFileSelector) {
          handleCancelFileSelect();
        } else if (showCommandSelector) {
          handleCancelCommandSelect();
        } else if (showBashHistorySelector) {
          handleCancelBashHistorySelect();
        }
        return;
      }

      if (key.backspace || key.delete) {
        if (cursorPosition > 0) {
          deleteCharAtCursor();
          resetHistoryNavigation();

          // Check if we deleted any special characters
          const newCursorPosition = cursorPosition - 1;
          checkForAtDeletion(newCursorPosition);
          checkForSlashDeletion(newCursorPosition);
          checkForExclamationDeletion(newCursorPosition);
        }
        return;
      }

      if (key.leftArrow) {
        moveCursorLeft();
        return;
      }

      if (key.rightArrow) {
        moveCursorRight();
        return;
      }

      if (("home" in key && key.home) || (key.ctrl && input === "a")) {
        moveCursorToStart();
        return;
      }

      if (("end" in key && key.end) || (key.ctrl && input === "e")) {
        moveCursorToEnd();
        return;
      }

      // Handle Ctrl+V for pasting images
      if (key.ctrl && input === "v") {
        handlePasteImage().catch((error) => {
          console.warn("Failed to handle paste image:", error);
        });
        return;
      }

      // Handle up/down keys for history navigation (only when no selector is active)
      if (
        key.upArrow &&
        !showFileSelector &&
        !showCommandSelector &&
        !showBashHistorySelector
      ) {
        const { newInput, newCursorPosition } = navigateHistory(
          "up",
          inputText,
        );
        setInputText(newInput);
        setCursorPosition(newCursorPosition);
        return;
      }

      if (
        key.downArrow &&
        !showFileSelector &&
        !showCommandSelector &&
        !showBashHistorySelector
      ) {
        const { newInput, newCursorPosition } = navigateHistory(
          "down",
          inputText,
        );
        setInputText(newInput);
        setCursorPosition(newCursorPosition);
        return;
      }

      // Handle typing input
      if (
        input &&
        !key.ctrl &&
        !("alt" in key && key.alt) &&
        !key.meta &&
        !key.return &&
        !key.escape &&
        !key.backspace &&
        !key.delete &&
        !key.leftArrow &&
        !key.rightArrow &&
        !("home" in key && key.home) &&
        !("end" in key && key.end)
      ) {
        const inputString = input;

        // Detect if it's a paste operation (input contains multiple characters or newlines)
        const isPasteOperation =
          inputString.length > 1 ||
          inputString.includes("\n") ||
          inputString.includes("\r");

        if (isPasteOperation) {
          logger.debug("[InputBox] 🔍 Detected paste operation:", {
            inputLength: inputString.length,
            input:
              inputString.substring(0, 50) +
              (inputString.length > 50 ? "..." : ""),
            hasNewlines:
              inputString.includes("\n") || inputString.includes("\r"),
          });

          // Start or continue the debounce handling for paste operation
          if (!pasteDebounceRef.current.isPasting) {
            // Start new paste operation
            logger.debug(
              "[InputBox] 🚀 Starting new paste operation - initializing debounce buffer",
            );
            pasteDebounceRef.current.isPasting = true;
            pasteDebounceRef.current.buffer = inputString;
            pasteDebounceRef.current.initialCursorPosition = cursorPosition;
          } else {
            // Continue paste operation, add new input to buffer
            logger.debug("[InputBox] 📝 Merging paste content to buffer:", {
              previousBufferLength: pasteDebounceRef.current.buffer.length,
              newInputLength: inputString.length,
              newTotalLength:
                pasteDebounceRef.current.buffer.length + inputString.length,
            });
            pasteDebounceRef.current.buffer += inputString;
          }

          // Clear previous timer
          if (pasteDebounceRef.current.timer) {
            logger.debug(
              "[InputBox] ⏰ Clearing previous debounce timer, resetting 30ms delay",
            );
            clearTimeout(pasteDebounceRef.current.timer);
          }

          // Set new 30ms timer
          pasteDebounceRef.current.timer = setTimeout(() => {
            logger.debug(
              "[InputBox] ✅ Debounce complete - processing merged paste content:",
              {
                finalBufferLength: pasteDebounceRef.current.buffer.length,
                content:
                  pasteDebounceRef.current.buffer.substring(0, 100) +
                  (pasteDebounceRef.current.buffer.length > 100 ? "..." : ""),
              },
            );

            // Process all paste content in buffer
            let processedInput = pasteDebounceRef.current.buffer.replace(
              /\r/g,
              "\n",
            );

            // Check if long text compression is needed (over 200 characters)
            if (processedInput.length > 200) {
              const originalText = processedInput;
              const compressedLabel = generateCompressedText(originalText);
              logger.debug(
                "[InputBox] 📦 Long text compression: originalLength:",
                originalText.length,
                "compressedLabel:",
                compressedLabel,
                "preview:",
                originalText.substring(0, 50) + "...",
              );
              processedInput = compressedLabel;
            }

            insertTextAtCursor(processedInput);
            resetHistoryNavigation();

            // Reset paste state
            pasteDebounceRef.current.isPasting = false;
            pasteDebounceRef.current.buffer = "";
            pasteDebounceRef.current.timer = null;

            logger.debug(
              "[InputBox] 🎯 Paste debounce processing complete, state reset",
            );
          }, 30);
        } else {
          // Handle single character input
          let char = inputString;

          // Check if it's Chinese exclamation mark, convert to English if at beginning
          if (char === "！" && cursorPosition === 0) {
            char = "!";
          }

          // First update input text and cursor position
          const newInputText =
            inputText.substring(0, cursorPosition) +
            char +
            inputText.substring(cursorPosition);
          const newCursorPosition = cursorPosition + char.length;

          insertTextAtCursor(char);
          resetHistoryNavigation();

          // Check special characters and set corresponding selectors
          if (char === "@") {
            activateFileSelector(cursorPosition);
          } else if (char === "/") {
            activateCommandSelector(cursorPosition);
          } else if (char === "!" && cursorPosition === 0) {
            // ! must be the first character to trigger bash selector
            activateBashHistorySelector(cursorPosition);
          } else if (char === "#" && cursorPosition === 0) {
            // # at beginning position, will be auto-detected as memory message when sent
            logger.debug(
              "[InputBox] 📝 Memory message detection, input starts with #",
            );
          } else if (showFileSelector && atPosition >= 0) {
            // Update search query
            const queryStart = atPosition + 1;
            const queryEnd = newCursorPosition;
            const newQuery = newInputText.substring(queryStart, queryEnd);
            updateSearchQuery(newQuery);
          } else if (showCommandSelector && slashPosition >= 0) {
            // Update command search query
            const queryStart = slashPosition + 1;
            const queryEnd = newCursorPosition;
            const newQuery = newInputText.substring(queryStart, queryEnd);
            updateCommandSearchQuery(newQuery);
          } else if (showBashHistorySelector && exclamationPosition >= 0) {
            // Update bash history search query
            const queryStart = exclamationPosition + 1;
            const queryEnd = newCursorPosition;
            const newQuery = newInputText.substring(queryStart, queryEnd);
            updateBashHistorySearchQuery(newQuery);
          }
        }
      }
    },
    [
      inputText,
      cursorPosition,
      sendMessage,
      clearInput,
      resetHistoryNavigation,
      showFileSelector,
      showCommandSelector,
      showBashHistorySelector,
      handleCancelFileSelect,
      handleCancelCommandSelect,
      handleCancelBashHistorySelect,
      deleteCharAtCursor,
      checkForAtDeletion,
      checkForSlashDeletion,
      checkForExclamationDeletion,
      moveCursorLeft,
      moveCursorRight,
      moveCursorToStart,
      moveCursorToEnd,
      navigateHistory,
      setInputText,
      setCursorPosition,
      insertTextAtCursor,
      activateFileSelector,
      activateCommandSelector,
      activateBashHistorySelector,
      atPosition,
      slashPosition,
      exclamationPosition,
      updateSearchQuery,
      updateCommandSearchQuery,
      updateBashHistorySearchQuery,
      attachedImages,
      clearImages,
      handlePasteImage,
      activateMemoryTypeSelector,
      isLoading,
      isCommandRunning,
    ],
  );

  useInput((input, key) => {
    // Handle interrupt request - use Esc key to interrupt AI request or command
    if (key.escape && (isLoading || isCommandRunning)) {
      // Unified interrupt for AI message generation and command execution
      if (typeof abortMessage === "function") {
        abortMessage();
      }
      return;
    }

    // During loading or command execution, except for Esc key, other input operations continue normally
    // but will prevent Enter submission in handleNormalInput

    if (
      showFileSelector ||
      showCommandSelector ||
      showBashHistorySelector ||
      showMemoryTypeSelector ||
      showBashManager ||
      showMcpManager
    ) {
      if (showMemoryTypeSelector || showBashManager || showMcpManager) {
        // Memory type selector, bash manager and MCP manager don't need to handle input, handled by component itself
        return;
      }
      handleSelectorInput(input, key);
    } else {
      handleNormalInput(input, key);
    }
  });

  return {
    handleFileSelect: useCallback(
      (filePath: string) => {
        const { newInput, newCursorPosition } = handleFileSelect(
          filePath,
          inputText,
          cursorPosition,
        );
        setInputText(newInput);
        setCursorPosition(newCursorPosition);
      },
      [
        handleFileSelect,
        inputText,
        cursorPosition,
        setInputText,
        setCursorPosition,
      ],
    ),

    handleCommandSelect: useCallback(
      (command: string) => {
        const { newInput, newCursorPosition } = handleCommandSelect(
          command,
          inputText,
          cursorPosition,
        );
        setInputText(newInput);
        setCursorPosition(newCursorPosition);
      },
      [
        handleCommandSelect,
        inputText,
        cursorPosition,
        setInputText,
        setCursorPosition,
      ],
    ),

    handleCommandInsert: useCallback(
      (command: string) => {
        const { newInput, newCursorPosition } = handleCommandInsert(
          command,
          inputText,
          cursorPosition,
        );
        setInputText(newInput);
        setCursorPosition(newCursorPosition);
      },
      [
        handleCommandInsert,
        inputText,
        cursorPosition,
        setInputText,
        setCursorPosition,
      ],
    ),

    handleBashHistorySelect: useCallback(
      (command: string) => {
        const { newInput, newCursorPosition } = handleBashHistorySelect(
          command,
          inputText,
          cursorPosition,
        );
        setInputText(newInput);
        setCursorPosition(newCursorPosition);
      },
      [
        handleBashHistorySelect,
        inputText,
        cursorPosition,
        setInputText,
        setCursorPosition,
      ],
    ),

    handleBashHistoryExecute: useCallback(
      (command: string) => {
        const commandToExecute = handleBashHistoryExecute(command);
        // Clear input box and execute command, ensure command starts with !
        const bashCommand = commandToExecute.startsWith("!")
          ? commandToExecute
          : `!${commandToExecute}`;
        setInputText("");
        setCursorPosition(0);
        sendMessage(bashCommand);
      },
      [handleBashHistoryExecute, setInputText, setCursorPosition, sendMessage],
    ),

    handleMemoryTypeSelect: useCallback(
      async (type: "project" | "user") => {
        const currentMessage = inputText.trim();
        if (currentMessage.startsWith("#")) {
          await saveMemory(currentMessage, type);
        }
        // Call the handler function from useMemoryTypeSelector to close the selector
        handleMemoryTypeSelect(type);
        // Clear input box
        clearInput();
      },
      [inputText, saveMemory, handleMemoryTypeSelect, clearInput],
    ),
  };
};
