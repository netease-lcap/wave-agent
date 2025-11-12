import React, { useState, useCallback, useRef, useEffect } from "react";
import { Box, Text } from "ink";
import { useInput, Key } from "ink";
import { FileSelector } from "./FileSelector.js";
import { CommandSelector } from "./CommandSelector.js";
import { BashHistorySelector } from "./BashHistorySelector.js";
import { MemoryTypeSelector } from "./MemoryTypeSelector.js";
import { BashShellManager } from "./BashShellManager.js";
import { McpManager } from "./McpManager.js";
import { useInputState } from "../hooks/useInputState.js";
import { useFileSelector } from "../hooks/useFileSelector.js";
import { useCommandSelector } from "../hooks/useCommandSelector.js";
import { useBashHistorySelector } from "../hooks/useBashHistorySelector.js";
import { useMemoryTypeSelector } from "../hooks/useMemoryTypeSelector.js";
import { useInputHistory } from "../hooks/useInputHistory.js";
import { useImageManager } from "../hooks/useImageManager.js";
import { logger } from "../utils/logger.js";
import type { McpServerStatus, SlashCommand } from "wave-agent-sdk";

export const INPUT_PLACEHOLDER_TEXT =
  "Type your message (use @ to reference files, / for commands, ! for bash history, # to add memory)...";

export const INPUT_PLACEHOLDER_TEXT_PREFIX = INPUT_PLACEHOLDER_TEXT.substring(
  0,
  10,
);

export interface InputBoxProps {
  isLoading?: boolean;
  isCommandRunning?: boolean;
  workdir?: string;
  userInputHistory?: string[];
  sendMessage?: (
    message: string,
    images?: Array<{ path: string; mimeType: string }>,
  ) => void;
  abortMessage?: () => void;
  saveMemory?: (message: string, type: "project" | "user") => Promise<void>;
  // MCP related properties
  mcpServers?: McpServerStatus[];
  connectMcpServer?: (serverName: string) => Promise<boolean>;
  disconnectMcpServer?: (serverName: string) => Promise<boolean>;
  // Slash Command related properties
  slashCommands?: SlashCommand[];
  hasSlashCommand?: (commandId: string) => boolean;
}

export const InputBox: React.FC<InputBoxProps> = ({
  isLoading = false,
  isCommandRunning = false,
  workdir,
  userInputHistory = [],
  sendMessage = () => {},
  abortMessage = () => {},
  saveMemory = async () => {},
  mcpServers = [],
  connectMcpServer = async () => false,
  disconnectMcpServer = async () => false,
  slashCommands = [],
  hasSlashCommand = () => false,
}) => {
  // Get current working directory
  const currentWorkdir = workdir || process.cwd();
  // Bash shell manager state
  const [showBashManager, setShowBashManager] = useState(false);
  // MCP manager state
  const [showMcpManager, setShowMcpManager] = useState(false);
  // Basic input state
  const {
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
  } = useInputState();

  // File selector functionality
  const {
    showFileSelector,
    filteredFiles,
    searchQuery,
    activateFileSelector,
    handleFileSelect: handleFileSelectorSelect,
    handleCancelFileSelect,
    updateSearchQuery,
    checkForAtDeletion,
    atPosition,
  } = useFileSelector();

  // Command selector functionality
  const {
    showCommandSelector,
    commandSearchQuery,
    activateCommandSelector,
    handleCommandSelect: handleCommandSelectorSelect,
    handleCommandInsert: handleCommandSelectorInsert,
    handleCancelCommandSelect,
    updateCommandSearchQuery,
    checkForSlashDeletion,
    slashPosition,
  } = useCommandSelector({
    onShowBashManager: () => setShowBashManager(true),
    onShowMcpManager: () => setShowMcpManager(true),
    sendMessage: async (content: string) => {
      await sendMessage(content);
    },
    hasSlashCommand,
  });

  // Bash history selector functionality
  const {
    showBashHistorySelector,
    bashHistorySearchQuery,
    activateBashHistorySelector,
    handleBashHistorySelect: handleBashHistorySelectorSelect,
    handleBashHistoryExecute,
    handleCancelBashHistorySelect,
    updateBashHistorySearchQuery,
    checkForExclamationDeletion,
    exclamationPosition,
  } = useBashHistorySelector();

  // Memory type selector functionality
  const {
    showMemoryTypeSelector,
    memoryMessage,
    activateMemoryTypeSelector,
    handleMemoryTypeSelect: handleMemoryTypeSelectorSelect,
    handleCancelMemoryTypeSelect,
  } = useMemoryTypeSelector();

  // Input history functionality
  const { resetHistoryNavigation, navigateHistory } = useInputHistory({
    userInputHistory,
  });

  // Image management functionality (includes clipboard paste)
  const { attachedImages, clearImages, handlePasteImage } =
    useImageManager(insertTextAtCursor);

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
          deleteCharAtCursor((newInput, newCursorPosition) => {
            // Update search query
            if (atPosition >= 0) {
              const queryStart = atPosition + 1;
              const queryEnd = newCursorPosition;
              if (queryEnd <= atPosition) {
                // Deleted @ symbol, close file selector
                handleCancelFileSelect();
              } else {
                const newQuery = newInput.substring(queryStart, queryEnd);
                updateSearchQuery(newQuery);
              }
            } else if (slashPosition >= 0) {
              const queryStart = slashPosition + 1;
              const queryEnd = newCursorPosition;
              if (queryEnd <= slashPosition) {
                // Deleted / symbol, close command selector
                handleCancelCommandSelect();
              } else {
                const newQuery = newInput.substring(queryStart, queryEnd);
                updateCommandSearchQuery(newQuery);
              }
            } else if (exclamationPosition >= 0) {
              const queryStart = exclamationPosition + 1;
              const queryEnd = newCursorPosition;
              if (queryEnd <= exclamationPosition) {
                // Deleted ! symbol, close bash history selector
                handleCancelBashHistorySelect();
              } else {
                const newQuery = newInput.substring(queryStart, queryEnd);
                updateBashHistorySearchQuery(newQuery);
              }
            }
          });
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
        insertTextAtCursor(input, (newInput, newCursorPosition) => {
          // Update search query
          if (atPosition >= 0) {
            const queryStart = atPosition + 1;
            const queryEnd = newCursorPosition;
            const newQuery = newInput.substring(queryStart, queryEnd);
            updateSearchQuery(newQuery);
          } else if (slashPosition >= 0) {
            const queryStart = slashPosition + 1;
            const queryEnd = newCursorPosition;
            const newQuery = newInput.substring(queryStart, queryEnd);
            updateCommandSearchQuery(newQuery);
          } else if (exclamationPosition >= 0) {
            const queryStart = exclamationPosition + 1;
            const queryEnd = newCursorPosition;
            const newQuery = newInput.substring(queryStart, queryEnd);
            updateBashHistorySearchQuery(newQuery);
          }
        });
      }
    },
    [
      cursorPosition,
      insertTextAtCursor,
      deleteCharAtCursor,
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

  // Handler functions for keyboard events
  const handleFileSelect = useCallback(
    (filePath: string) => {
      const { newInput, newCursorPosition } = handleFileSelectorSelect(
        filePath,
        inputText,
        cursorPosition,
      );
      setInputText(newInput);
      setCursorPosition(newCursorPosition);
    },
    [
      handleFileSelectorSelect,
      inputText,
      cursorPosition,
      setInputText,
      setCursorPosition,
    ],
  );

  const handleCommandSelect = useCallback(
    (command: string) => {
      const { newInput, newCursorPosition } = handleCommandSelectorSelect(
        command,
        inputText,
        cursorPosition,
      );
      setInputText(newInput);
      setCursorPosition(newCursorPosition);
    },
    [
      handleCommandSelectorSelect,
      inputText,
      cursorPosition,
      setInputText,
      setCursorPosition,
    ],
  );

  const handleBashHistorySelect = useCallback(
    (command: string) => {
      const { newInput, newCursorPosition } = handleBashHistorySelectorSelect(
        command,
        inputText,
        cursorPosition,
      );
      setInputText(newInput);
      setCursorPosition(newCursorPosition);
    },
    [
      handleBashHistorySelectorSelect,
      inputText,
      cursorPosition,
      setInputText,
      setCursorPosition,
    ],
  );

  const keyboardHandleBashHistoryExecute = useCallback(
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
  );

  const handleMemoryTypeSelect = useCallback(
    async (type: "project" | "user") => {
      const currentMessage = inputText.trim();
      if (currentMessage.startsWith("#")) {
        await saveMemory(currentMessage, type);
      }
      // Call the handler function from useMemoryTypeSelector to close the selector
      handleMemoryTypeSelectorSelect(type);
      // Clear input box
      clearInput();
    },
    [inputText, saveMemory, handleMemoryTypeSelectorSelect, clearInput],
  );

  const isPlaceholder = !inputText;
  const placeholderText = INPUT_PLACEHOLDER_TEXT;

  // Create adapter function for CommandSelector
  const handleCommandInsert = useCallback(
    (command: string) => {
      const result = handleCommandSelectorInsert(
        command,
        inputText,
        cursorPosition,
      );
      setInputText(result.newInput);
      setCursorPosition(result.newCursorPosition);
    },
    [
      handleCommandSelectorInsert,
      inputText,
      cursorPosition,
      setInputText,
      setCursorPosition,
    ],
  );

  // Split text into three parts: before cursor, cursor position, after cursor
  const displayText = isPlaceholder ? placeholderText : inputText;
  const beforeCursor = displayText.substring(0, cursorPosition);
  const atCursor =
    cursorPosition < displayText.length ? displayText[cursorPosition] : " ";
  const afterCursor = displayText.substring(cursorPosition + 1);

  // Always show cursor, allow user to continue input during loading
  const shouldShowCursor = true;

  return (
    <Box flexDirection="column" width={"100%"}>
      {showFileSelector && (
        <FileSelector
          files={filteredFiles}
          searchQuery={searchQuery}
          onSelect={handleFileSelect}
          onCancel={handleCancelFileSelect}
        />
      )}

      {showCommandSelector && (
        <CommandSelector
          searchQuery={commandSearchQuery}
          onSelect={handleCommandSelect}
          onInsert={handleCommandInsert}
          onCancel={handleCancelCommandSelect}
          commands={slashCommands}
        />
      )}

      {showBashHistorySelector && (
        <BashHistorySelector
          searchQuery={bashHistorySearchQuery}
          workdir={currentWorkdir}
          onSelect={handleBashHistorySelect}
          onExecute={keyboardHandleBashHistoryExecute}
          onCancel={handleCancelBashHistorySelect}
        />
      )}

      {showMemoryTypeSelector && (
        <MemoryTypeSelector
          message={memoryMessage}
          onSelect={handleMemoryTypeSelect}
          onCancel={handleCancelMemoryTypeSelect}
        />
      )}

      {showBashManager && (
        <BashShellManager onCancel={() => setShowBashManager(false)} />
      )}

      {showMcpManager && (
        <McpManager
          onCancel={() => setShowMcpManager(false)}
          servers={mcpServers}
          onConnectServer={connectMcpServer}
          onDisconnectServer={disconnectMcpServer}
        />
      )}
      {showBashManager || showMcpManager || (
        <Box borderStyle="single" borderColor="gray" paddingX={1}>
          <Box width="100%" flexDirection="row" justifyContent="space-between">
            <Text color={isPlaceholder ? "gray" : "white"}>
              {shouldShowCursor ? (
                <>
                  {beforeCursor}
                  <Text backgroundColor="white" color="black">
                    {atCursor}
                  </Text>
                  {afterCursor}
                </>
              ) : (
                displayText
              )}
            </Text>
          </Box>
        </Box>
      )}
    </Box>
  );
};
