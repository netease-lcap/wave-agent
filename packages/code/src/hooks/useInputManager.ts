import { useEffect, useRef, useState, useCallback } from "react";
import { Key } from "ink";
import {
  InputManager,
  InputManagerCallbacks,
  AttachedImage,
} from "../managers/InputManager.js";
import { FileItem } from "../components/FileSelector.js";

export const useInputManager = (
  callbacks: Partial<InputManagerCallbacks> = {},
) => {
  const managerRef = useRef<InputManager | null>(null);

  // React state that mirrors InputManager state
  const [inputText, setInputText] = useState("");
  const [cursorPosition, setCursorPosition] = useState(0);
  const [fileSelectorState, setFileSelectorState] = useState({
    show: false,
    files: [] as FileItem[],
    query: "",
    position: -1,
  });
  const [commandSelectorState, setCommandSelectorState] = useState({
    show: false,
    query: "",
    position: -1,
  });
  const [bashHistorySelectorState, setBashHistorySelectorState] = useState({
    show: false,
    query: "",
    position: -1,
  });
  const [memoryTypeSelectorState, setMemoryTypeSelectorState] = useState({
    show: false,
    message: "",
  });
  const [showBashManager, setShowBashManager] = useState(false);
  const [showMcpManager, setShowMcpManager] = useState(false);
  const [attachedImages, setAttachedImages] = useState<AttachedImage[]>([]);

  // Create InputManager on mount and update callbacks when they change
  useEffect(() => {
    if (!managerRef.current) {
      // Create InputManager on first mount
      const manager = new InputManager({
        onInputTextChange: setInputText,
        onCursorPositionChange: setCursorPosition,
        onFileSelectorStateChange: (show, files, query, position) => {
          setFileSelectorState({ show, files, query, position });
        },
        onCommandSelectorStateChange: (show, query, position) => {
          setCommandSelectorState({ show, query, position });
        },
        onBashHistorySelectorStateChange: (show, query, position) => {
          setBashHistorySelectorState({ show, query, position });
        },
        onMemoryTypeSelectorStateChange: (show, message) => {
          setMemoryTypeSelectorState({ show, message });
        },
        onBashManagerStateChange: (show) => {
          setShowBashManager(show);
        },
        onMcpManagerStateChange: (show) => {
          setShowMcpManager(show);
        },
        onImagesStateChange: setAttachedImages,
        ...callbacks,
      });

      managerRef.current = manager;
    } else {
      // Update callbacks on existing manager
      managerRef.current.updateCallbacks({
        onInputTextChange: setInputText,
        onCursorPositionChange: setCursorPosition,
        onFileSelectorStateChange: (show, files, query, position) => {
          setFileSelectorState({ show, files, query, position });
        },
        onCommandSelectorStateChange: (show, query, position) => {
          setCommandSelectorState({ show, query, position });
        },
        onBashHistorySelectorStateChange: (show, query, position) => {
          setBashHistorySelectorState({ show, query, position });
        },
        onMemoryTypeSelectorStateChange: (show, message) => {
          setMemoryTypeSelectorState({ show, message });
        },
        onBashManagerStateChange: (show) => {
          setShowBashManager(show);
        },
        onMcpManagerStateChange: (show) => {
          setShowMcpManager(show);
        },
        onImagesStateChange: setAttachedImages,
        ...callbacks,
      });
    }
  }, [callbacks]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (managerRef.current) {
        managerRef.current.destroy();
      }
    };
  }, []);

  // Expose manager methods
  const insertTextAtCursor = useCallback(
    (
      text: string,
      callback?: (newText: string, newCursorPosition: number) => void,
    ) => {
      managerRef.current?.insertTextAtCursor(text, callback);
    },
    [],
  );

  const deleteCharAtCursor = useCallback(
    (callback?: (newText: string, newCursorPosition: number) => void) => {
      managerRef.current?.deleteCharAtCursor(callback);
    },
    [],
  );

  const clearInput = useCallback(() => {
    managerRef.current?.clearInput();
  }, []);

  const moveCursorLeft = useCallback(() => {
    managerRef.current?.moveCursorLeft();
  }, []);

  const moveCursorRight = useCallback(() => {
    managerRef.current?.moveCursorRight();
  }, []);

  const moveCursorToStart = useCallback(() => {
    managerRef.current?.moveCursorToStart();
  }, []);

  const moveCursorToEnd = useCallback(() => {
    managerRef.current?.moveCursorToEnd();
  }, []);

  // File selector methods
  const activateFileSelector = useCallback((position: number) => {
    managerRef.current?.activateFileSelector(position);
  }, []);

  const handleFileSelect = useCallback(
    (filePath: string) => {
      return (
        managerRef.current?.handleFileSelect(filePath) || {
          newInput: inputText,
          newCursorPosition: cursorPosition,
        }
      );
    },
    [inputText, cursorPosition],
  );

  const handleCancelFileSelect = useCallback(() => {
    managerRef.current?.handleCancelFileSelect();
  }, []);

  const updateFileSearchQuery = useCallback((query: string) => {
    managerRef.current?.updateFileSearchQuery(query);
  }, []);

  const checkForAtDeletion = useCallback((cursorPos: number) => {
    return managerRef.current?.checkForAtDeletion(cursorPos) || false;
  }, []);

  // Command selector methods
  const activateCommandSelector = useCallback((position: number) => {
    managerRef.current?.activateCommandSelector(position);
  }, []);

  const handleCommandSelect = useCallback(
    (command: string) => {
      return (
        managerRef.current?.handleCommandSelect(command) || {
          newInput: inputText,
          newCursorPosition: cursorPosition,
        }
      );
    },
    [inputText, cursorPosition],
  );

  const handleCommandInsert = useCallback(
    (command: string) => {
      return (
        managerRef.current?.handleCommandInsert(command) || {
          newInput: inputText,
          newCursorPosition: cursorPosition,
        }
      );
    },
    [inputText, cursorPosition],
  );

  const handleCancelCommandSelect = useCallback(() => {
    managerRef.current?.handleCancelCommandSelect();
  }, []);

  const updateCommandSearchQuery = useCallback((query: string) => {
    managerRef.current?.updateCommandSearchQuery(query);
  }, []);

  const checkForSlashDeletion = useCallback((cursorPos: number) => {
    return managerRef.current?.checkForSlashDeletion(cursorPos) || false;
  }, []);

  // Bash history selector methods
  const activateBashHistorySelector = useCallback((position: number) => {
    managerRef.current?.activateBashHistorySelector(position);
  }, []);

  const handleBashHistorySelect = useCallback(
    (command: string) => {
      return (
        managerRef.current?.handleBashHistorySelect(command) || {
          newInput: inputText,
          newCursorPosition: cursorPosition,
        }
      );
    },
    [inputText, cursorPosition],
  );

  const handleCancelBashHistorySelect = useCallback(() => {
    managerRef.current?.handleCancelBashHistorySelect();
  }, []);

  const updateBashHistorySearchQuery = useCallback((query: string) => {
    managerRef.current?.updateBashHistorySearchQuery(query);
  }, []);

  const handleBashHistoryExecute = useCallback((command: string) => {
    return managerRef.current?.handleBashHistoryExecute(command) || command;
  }, []);

  const checkForExclamationDeletion = useCallback((cursorPos: number) => {
    return managerRef.current?.checkForExclamationDeletion(cursorPos) || false;
  }, []);

  // Memory type selector methods
  const activateMemoryTypeSelector = useCallback((message: string) => {
    managerRef.current?.activateMemoryTypeSelector(message);
  }, []);

  const handleMemoryTypeSelect = useCallback((type: "project" | "user") => {
    managerRef.current?.handleMemoryTypeSelect(type);
  }, []);

  const handleCancelMemoryTypeSelect = useCallback(() => {
    managerRef.current?.handleCancelMemoryTypeSelect();
  }, []);

  // Input history methods
  const setUserInputHistory = useCallback((history: string[]) => {
    managerRef.current?.setUserInputHistory(history);
  }, []);

  const navigateHistory = useCallback(
    (direction: "up" | "down", currentInput: string) => {
      return (
        managerRef.current?.navigateHistory(direction, currentInput) || {
          newInput: currentInput,
          newCursorPosition: currentInput.length,
        }
      );
    },
    [],
  );

  const resetHistoryNavigation = useCallback(() => {
    managerRef.current?.resetHistoryNavigation();
  }, []);

  // Special character handling
  const handleSpecialCharInput = useCallback((char: string) => {
    managerRef.current?.handleSpecialCharInput(char);
  }, []);

  // Direct state access methods (for compatibility with existing code)
  const setInputTextDirect = useCallback((text: string) => {
    managerRef.current?.setInputText(text);
  }, []);

  const setCursorPositionDirect = useCallback((position: number) => {
    managerRef.current?.setCursorPosition(position);
  }, []);

  return {
    // State
    inputText,
    cursorPosition,
    showFileSelector: fileSelectorState.show,
    filteredFiles: fileSelectorState.files,
    fileSearchQuery: fileSelectorState.query,
    atPosition: fileSelectorState.position,
    showCommandSelector: commandSelectorState.show,
    commandSearchQuery: commandSelectorState.query,
    slashPosition: commandSelectorState.position,
    showBashHistorySelector: bashHistorySelectorState.show,
    bashHistorySearchQuery: bashHistorySelectorState.query,
    exclamationPosition: bashHistorySelectorState.position,
    showMemoryTypeSelector: memoryTypeSelectorState.show,
    memoryMessage: memoryTypeSelectorState.message,
    showBashManager,
    showMcpManager,
    attachedImages,

    // Methods
    insertTextAtCursor,
    deleteCharAtCursor,
    clearInput,
    moveCursorLeft,
    moveCursorRight,
    moveCursorToStart,
    moveCursorToEnd,

    // File selector
    activateFileSelector,
    handleFileSelect,
    handleCancelFileSelect,
    updateFileSearchQuery,
    checkForAtDeletion,

    // Command selector
    activateCommandSelector,
    handleCommandSelect,
    handleCommandInsert,
    handleCancelCommandSelect,
    updateCommandSearchQuery,
    checkForSlashDeletion,

    // Bash history selector
    activateBashHistorySelector,
    handleBashHistorySelect,
    handleCancelBashHistorySelect,
    updateBashHistorySearchQuery,

    handleBashHistoryExecute,
    checkForExclamationDeletion,

    // Memory type selector
    activateMemoryTypeSelector,
    handleMemoryTypeSelect,
    handleCancelMemoryTypeSelect,

    // Input history
    setUserInputHistory,
    navigateHistory,
    resetHistoryNavigation,

    // Special handling
    handleSpecialCharInput,

    // Bash/MCP Manager
    setShowBashManager: useCallback((show: boolean) => {
      managerRef.current?.setShowBashManager(show);
    }, []),
    setShowMcpManager: useCallback((show: boolean) => {
      managerRef.current?.setShowMcpManager(show);
    }, []),

    // Image management
    addImage: useCallback((imagePath: string, mimeType: string) => {
      return managerRef.current?.addImage(imagePath, mimeType);
    }, []),
    removeImage: useCallback((imageId: number) => {
      managerRef.current?.removeImage(imageId);
    }, []),
    clearImages: useCallback(() => {
      managerRef.current?.clearImages();
    }, []),
    handlePasteImage: useCallback(async () => {
      return (await managerRef.current?.handlePasteImage()) || false;
    }, []),

    // Paste and text handling
    handlePasteInput: useCallback((input: string) => {
      managerRef.current?.handlePasteInput(input);
    }, []),
    handleSubmit: useCallback(
      async (
        attachedImages: Array<{ id: number; path: string; mimeType: string }>,
        isLoading: boolean = false,
        isCommandRunning: boolean = false,
      ) => {
        await managerRef.current?.handleSubmit(
          attachedImages,
          isLoading,
          isCommandRunning,
        );
      },
      [],
    ),
    expandLongTextPlaceholders: useCallback((text: string) => {
      return managerRef.current?.expandLongTextPlaceholders(text) || text;
    }, []),
    clearLongTextMap: useCallback(() => {
      managerRef.current?.clearLongTextMap();
    }, []),

    // Main input handler
    handleInput: useCallback(
      async (
        input: string,
        key: Key,
        attachedImages: Array<{ id: number; path: string; mimeType: string }>,
        isLoading: boolean = false,
        isCommandRunning: boolean = false,
        clearImages?: () => void,
      ) => {
        return (
          (await managerRef.current?.handleInput(
            input,
            key,
            attachedImages,
            isLoading,
            isCommandRunning,
            clearImages,
          )) || false
        );
      },
      [],
    ),

    // Direct state setters (for React compatibility)
    setInputText: setInputTextDirect,
    setCursorPosition: setCursorPositionDirect,

    // Manager reference for advanced usage
    manager: managerRef.current,
  };
};
