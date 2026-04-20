import { useEffect, useReducer, useCallback, useRef } from "react";
import { Key } from "ink";
import {
  inputReducer,
  initialState,
  InputManagerCallbacks,
} from "../managers/inputReducer.js";
import {
  searchFiles as searchFilesUtil,
  PermissionMode,
  PromptEntry,
} from "wave-agent-sdk";
import * as handlers from "../managers/inputHandlers.js";

export const useInputManager = (
  callbacks: Partial<InputManagerCallbacks> = {},
) => {
  const [state, dispatch] = useReducer(inputReducer, initialState);
  const callbacksRef = useRef(callbacks);
  const stateRef = useRef(state);

  // Update refs when they change
  useEffect(() => {
    callbacksRef.current = callbacks;
  }, [callbacks]);

  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  // Handle selectorJustUsed reset
  useEffect(() => {
    if (state.selectorJustUsed) {
      const timer = setTimeout(() => {
        dispatch({ type: "SET_SELECTOR_JUST_USED", payload: false });
      }, 0);
      return () => clearTimeout(timer);
    }
  }, [state.selectorJustUsed]);

  // Handle debounced file search
  useEffect(() => {
    if (state.showFileSelector) {
      const debounceDelay =
        state.fileSearchQuery === ""
          ? 0
          : parseInt(process.env.FILE_SELECTOR_DEBOUNCE_MS || "300", 10);
      const timer = setTimeout(async () => {
        try {
          const fileItems = await searchFilesUtil(state.fileSearchQuery);
          dispatch({ type: "SET_FILTERED_FILES", payload: fileItems });
        } catch (error) {
          console.error("File search error:", error);
          dispatch({ type: "SET_FILTERED_FILES", payload: [] });
        }
      }, debounceDelay);
      return () => clearTimeout(timer);
    }
  }, [state.showFileSelector, state.fileSearchQuery]);

  // Handle paste debouncing
  useEffect(() => {
    if (state.isPasting) {
      const pasteDebounceDelay = parseInt(
        process.env.PASTE_DEBOUNCE_MS || "30",
        10,
      );
      const timer = setTimeout(() => {
        const processedInput = stateRef.current.pasteBuffer.replace(
          /\r/g,
          "\n",
        );
        dispatch({
          type: "INSERT_TEXT_WITH_PLACEHOLDER",
          payload: processedInput,
        });
        dispatch({ type: "END_PASTE" });
        dispatch({ type: "RESET_HISTORY_NAVIGATION" });
      }, pasteDebounceDelay);
      return () => clearTimeout(timer);
    }
  }, [state.isPasting, state.pasteBuffer]);

  // Sync state changes with callbacks
  useEffect(() => {
    callbacksRef.current.onInputTextChange?.(state.inputText);
  }, [state.inputText]);

  useEffect(() => {
    callbacksRef.current.onCursorPositionChange?.(state.cursorPosition);
  }, [state.cursorPosition]);

  useEffect(() => {
    callbacksRef.current.onFileSelectorStateChange?.(
      state.showFileSelector,
      state.filteredFiles,
      state.fileSearchQuery,
      state.atPosition,
    );
  }, [
    state.showFileSelector,
    state.filteredFiles,
    state.fileSearchQuery,
    state.atPosition,
  ]);

  useEffect(() => {
    callbacksRef.current.onCommandSelectorStateChange?.(
      state.showCommandSelector,
      state.commandSearchQuery,
      state.slashPosition,
    );
  }, [
    state.showCommandSelector,
    state.commandSearchQuery,
    state.slashPosition,
  ]);

  useEffect(() => {
    callbacksRef.current.onHistorySearchStateChange?.(
      state.showHistorySearch,
      state.historySearchQuery,
    );
  }, [state.showHistorySearch, state.historySearchQuery]);

  useEffect(() => {
    callbacksRef.current.onBackgroundTaskManagerStateChange?.(
      state.showBackgroundTaskManager,
    );
  }, [state.showBackgroundTaskManager]);

  useEffect(() => {
    callbacksRef.current.onMcpManagerStateChange?.(state.showMcpManager);
  }, [state.showMcpManager]);

  useEffect(() => {
    callbacksRef.current.onRewindManagerStateChange?.(state.showRewindManager);
  }, [state.showRewindManager]);

  useEffect(() => {
    callbacksRef.current.onHelpStateChange?.(state.showHelp);
  }, [state.showHelp]);

  useEffect(() => {
    callbacksRef.current.onStatusCommandStateChange?.(state.showStatusCommand);
  }, [state.showStatusCommand]);

  useEffect(() => {
    callbacksRef.current.onPluginManagerStateChange?.(state.showPluginManager);
  }, [state.showPluginManager]);

  useEffect(() => {
    callbacksRef.current.onModelSelectorStateChange?.(state.showModelSelector);
  }, [state.showModelSelector]);

  useEffect(() => {
    callbacksRef.current.onImagesStateChange?.(state.attachedImages);
  }, [state.attachedImages]);

  // Handle /btw side question
  useEffect(() => {
    if (
      state.btwState.isActive &&
      state.btwState.isLoading &&
      state.btwState.question
    ) {
      const askBtw = async () => {
        try {
          const answer = await callbacksRef.current.onAskBtw?.(
            state.btwState.question,
          );
          dispatch({
            type: "SET_BTW_STATE",
            payload: { answer, isLoading: false },
          });
        } catch (error) {
          console.error("Failed to ask side question:", error);
          dispatch({
            type: "SET_BTW_STATE",
            payload: {
              answer: "Error: Failed to get an answer for your side question.",
              isLoading: false,
            },
          });
        }
      };
      askBtw();
    }
  }, [
    state.btwState.isActive,
    state.btwState.isLoading,
    state.btwState.question,
  ]);

  // Methods
  const insertTextAtCursor = useCallback((text: string) => {
    dispatch({ type: "INSERT_TEXT", payload: text });
  }, []);

  const deleteCharAtCursor = useCallback(() => {
    dispatch({ type: "DELETE_CHAR" });
  }, []);

  const clearInput = useCallback(() => {
    dispatch({ type: "CLEAR_INPUT" });
  }, []);

  const moveCursorLeft = useCallback(() => {
    dispatch({ type: "MOVE_CURSOR", payload: -1 });
  }, []);

  const moveCursorRight = useCallback(() => {
    dispatch({ type: "MOVE_CURSOR", payload: 1 });
  }, []);

  const activateFileSelector = useCallback((position: number) => {
    dispatch({ type: "ACTIVATE_FILE_SELECTOR", payload: position });
  }, []);

  const handleFileSelect = useCallback((filePath: string) => {
    return handlers.handleFileSelect(
      stateRef.current,
      dispatch,
      callbacksRef.current,
      filePath,
    );
  }, []);

  const handleCancelFileSelect = useCallback(() => {
    dispatch({ type: "CANCEL_FILE_SELECTOR" });
  }, []);

  const updateFileSearchQuery = useCallback((query: string) => {
    dispatch({ type: "SET_FILE_SEARCH_QUERY", payload: query });
  }, []);

  const checkForAtDeletion = useCallback((cursorPos: number) => {
    return handlers.checkForAtDeletion(stateRef.current, dispatch, cursorPos);
  }, []);

  const activateCommandSelector = useCallback((position: number) => {
    dispatch({ type: "ACTIVATE_COMMAND_SELECTOR", payload: position });
  }, []);

  const handleCommandSelect = useCallback((command: string) => {
    return handlers.handleCommandSelect(
      stateRef.current,
      dispatch,
      callbacksRef.current,
      command,
    );
  }, []);

  const handleCommandInsert = useCallback((command: string) => {
    const currentState = stateRef.current;
    if (currentState.slashPosition >= 0) {
      const wordEnd = handlers.getWordEnd(
        currentState.inputText,
        currentState.slashPosition,
      );
      const beforeSlash = currentState.inputText.substring(
        0,
        currentState.slashPosition,
      );
      const afterWord = currentState.inputText.substring(wordEnd);
      const newInput = beforeSlash + `/${command} ` + afterWord;
      const newCursorPosition = beforeSlash.length + command.length + 2;

      dispatch({ type: "SET_INPUT_TEXT", payload: newInput });
      dispatch({ type: "SET_CURSOR_POSITION", payload: newCursorPosition });
      dispatch({ type: "CANCEL_COMMAND_SELECTOR" });

      callbacksRef.current.onInputTextChange?.(newInput);
      callbacksRef.current.onCursorPositionChange?.(newCursorPosition);

      return { newInput, newCursorPosition };
    }
    return {
      newInput: currentState.inputText,
      newCursorPosition: currentState.cursorPosition,
    };
  }, []);

  const handleCancelCommandSelect = useCallback(() => {
    dispatch({ type: "CANCEL_COMMAND_SELECTOR" });
  }, []);

  const updateCommandSearchQuery = useCallback((query: string) => {
    dispatch({ type: "SET_COMMAND_SEARCH_QUERY", payload: query });
  }, []);

  const checkForSlashDeletion = useCallback((cursorPos: number) => {
    return handlers.checkForSlashDeletion(
      stateRef.current,
      dispatch,
      cursorPos,
    );
  }, []);

  const handleHistorySearchSelect = useCallback((entry: PromptEntry) => {
    dispatch({ type: "SELECT_HISTORY_ENTRY", payload: entry });
  }, []);

  const handleCancelHistorySearch = useCallback(() => {
    dispatch({ type: "CANCEL_HISTORY_SEARCH" });
  }, []);

  const processSelectorInput = useCallback((char: string) => {
    handlers.processSelectorInput(stateRef.current, dispatch, char);
  }, []);

  const setInputText = useCallback((text: string) => {
    dispatch({ type: "SET_INPUT_TEXT", payload: text });
  }, []);

  const setCursorPosition = useCallback((position: number) => {
    dispatch({ type: "SET_CURSOR_POSITION", payload: position });
  }, []);

  const setShowBackgroundTaskManager = useCallback((show: boolean) => {
    dispatch({ type: "SET_SHOW_BACKGROUND_TASK_MANAGER", payload: show });
  }, []);

  const setShowMcpManager = useCallback((show: boolean) => {
    dispatch({ type: "SET_SHOW_MCP_MANAGER", payload: show });
  }, []);

  const setShowRewindManager = useCallback((show: boolean) => {
    dispatch({ type: "SET_SHOW_REWIND_MANAGER", payload: show });
  }, []);

  const setShowHelp = useCallback((show: boolean) => {
    dispatch({ type: "SET_SHOW_HELP", payload: show });
  }, []);

  const setShowStatusCommand = useCallback((show: boolean) => {
    dispatch({ type: "SET_SHOW_STATUS_COMMAND", payload: show });
  }, []);

  const setShowPluginManager = useCallback((show: boolean) => {
    dispatch({ type: "SET_SHOW_PLUGIN_MANAGER", payload: show });
  }, []);

  const setShowModelSelector = useCallback((show: boolean) => {
    dispatch({ type: "SET_SHOW_MODEL_SELECTOR", payload: show });
  }, []);

  const setPermissionMode = useCallback((mode: PermissionMode) => {
    dispatch({ type: "SET_PERMISSION_MODE", payload: mode });
    callbacksRef.current.onPermissionModeChange?.(mode);
  }, []);

  const setAllowBypassInCycle = useCallback((allow: boolean) => {
    dispatch({ type: "SET_ALLOW_BYPASS_IN_CYCLE", payload: allow });
  }, []);

  const setBtwState = useCallback(
    (payload: Partial<import("../managers/inputReducer.js").BtwState>) => {
      dispatch({ type: "SET_BTW_STATE", payload });
    },
    [],
  );

  const addImage = useCallback((imagePath: string, mimeType: string) => {
    dispatch({ type: "ADD_IMAGE", payload: { path: imagePath, mimeType } });
  }, []);

  const removeImage = useCallback((imageId: number) => {
    dispatch({ type: "REMOVE_IMAGE", payload: imageId });
  }, []);

  const clearImages = useCallback(() => {
    dispatch({ type: "CLEAR_IMAGES" });
  }, []);

  const handlePasteImage = useCallback(async () => {
    return await handlers.handlePasteImage(dispatch);
  }, []);

  const handlePasteInput = useCallback((input: string) => {
    handlers.handlePasteInput(
      stateRef.current,
      dispatch,
      callbacksRef.current,
      input,
    );
  }, []);

  const handleSubmit = useCallback(
    async (
      attachedImages: Array<{ id: number; path: string; mimeType: string }>,
    ) => {
      await handlers.handleSubmit(
        stateRef.current,
        dispatch,
        callbacksRef.current,
        attachedImages,
      );
    },
    [],
  );

  const expandLongTextPlaceholders = useCallback((text: string) => {
    return handlers.expandLongTextPlaceholders(
      text,
      stateRef.current.longTextMap,
    );
  }, []);

  const clearLongTextMap = useCallback(() => {
    dispatch({ type: "CLEAR_LONG_TEXT_MAP" });
  }, []);

  const handleInput = useCallback(
    async (
      input: string,
      key: Key,
      attachedImages: Array<{ id: number; path: string; mimeType: string }>,
      clearImages?: () => void,
    ) => {
      return await handlers.handleInput(
        stateRef.current,
        dispatch,
        callbacksRef.current,
        input,
        key,
        clearImages,
      );
    },
    [],
  );

  return {
    // State
    inputText: state.inputText,
    cursorPosition: state.cursorPosition,
    showFileSelector: state.showFileSelector,
    filteredFiles: state.filteredFiles,
    fileSearchQuery: state.fileSearchQuery,
    isFileSearching: state.isFileSearching,
    atPosition: state.atPosition,
    showCommandSelector: state.showCommandSelector,
    commandSearchQuery: state.commandSearchQuery,
    slashPosition: state.slashPosition,
    showHistorySearch: state.showHistorySearch,
    historySearchQuery: state.historySearchQuery,
    showBackgroundTaskManager: state.showBackgroundTaskManager,
    showMcpManager: state.showMcpManager,
    showRewindManager: state.showRewindManager,
    showHelp: state.showHelp,
    showStatusCommand: state.showStatusCommand,
    showPluginManager: state.showPluginManager,
    showModelSelector: state.showModelSelector,
    permissionMode: state.permissionMode,
    attachedImages: state.attachedImages,
    btwState: state.btwState,
    isManagerReady: true,

    // Methods
    insertTextAtCursor,
    deleteCharAtCursor,
    clearInput,
    moveCursorLeft,
    moveCursorRight,

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

    // History search
    handleHistorySearchSelect,
    handleCancelHistorySearch,

    // Special handling
    processSelectorInput,

    // Bash/MCP Manager
    setShowBackgroundTaskManager,
    setShowMcpManager,
    setShowRewindManager,
    setShowHelp,
    setShowStatusCommand,
    setShowPluginManager,
    setShowModelSelector,
    setPermissionMode,
    setAllowBypassInCycle,
    setBtwState,

    // Image management
    addImage,
    removeImage,
    clearImages,
    handlePasteImage,

    // Paste and text handling
    handlePasteInput,
    handleSubmit,
    expandLongTextPlaceholders,
    clearLongTextMap,

    // Main input handler
    handleInput,

    // Direct state setters
    setInputText,
    setCursorPosition,

    // Manager reference (for compatibility, though it's null now)
    manager: null,
  };
};
