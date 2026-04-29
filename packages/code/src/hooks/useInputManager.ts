import { useEffect, useReducer, useCallback } from "react";
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
  PromptHistoryManager,
} from "wave-agent-sdk";
import * as handlers from "../managers/inputHandlers.js";

export const useInputManager = (
  callbacks: Partial<InputManagerCallbacks> = {},
) => {
  const [state, dispatch] = useReducer(inputReducer, initialState);

  const {
    onInputTextChange,
    onCursorPositionChange,
    onFileSelectorStateChange,
    onCommandSelectorStateChange,
    onHistorySearchStateChange,
    onBackgroundTaskManagerStateChange,
    onMcpManagerStateChange,
    onRewindManagerStateChange,
    onHelpStateChange,
    onStatusCommandStateChange,
    onPluginManagerStateChange,
    onModelSelectorStateChange,
    onImagesStateChange,
    onSendMessage,
    onHasSlashCommand,
    onAbortMessage,
    onBackgroundCurrentTask,
    onPermissionModeChange,
    onAskBtw,
    sessionId,
    workdir,
    getFullMessageThread,
    logger,
  } = callbacks;

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
        const processedInput = state.pasteBuffer.replace(/\r/g, "\n");
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
    onInputTextChange?.(state.inputText);
  }, [state.inputText, onInputTextChange]);

  useEffect(() => {
    onCursorPositionChange?.(state.cursorPosition);
  }, [state.cursorPosition, onCursorPositionChange]);

  // Handle pending effects
  useEffect(() => {
    if (!state.pendingEffect) return;

    const effect = state.pendingEffect;
    dispatch({ type: "CLEAR_PENDING_EFFECT" });

    const runEffect = async () => {
      try {
        switch (effect.type) {
          case "SEND_MESSAGE":
            await onSendMessage?.(
              effect.content,
              effect.images,
              effect.longTextMap,
            );
            break;
          case "ABORT_MESSAGE":
            onAbortMessage?.();
            break;
          case "BACKGROUND_CURRENT_TASK":
            onBackgroundCurrentTask?.();
            break;
          case "ASK_BTW":
            try {
              const answer = await onAskBtw?.(effect.question);
              dispatch({
                type: "SET_BTW_STATE",
                payload: { answer, isLoading: false },
              });
            } catch (error) {
              console.error("Failed to ask side question:", error);
              dispatch({
                type: "SET_BTW_STATE",
                payload: {
                  answer:
                    "Error: Failed to get an answer for your side question.",
                  isLoading: false,
                },
              });
            }
            break;
          case "PERMISSION_MODE_CHANGE":
            onPermissionModeChange?.(effect.mode);
            break;
          case "SAVE_HISTORY":
            PromptHistoryManager.addEntry(
              effect.content,
              sessionId,
              effect.longTextMap,
              workdir,
            ).catch((err: unknown) => {
              logger?.error("Failed to save prompt history", err);
            });
            break;
          case "FETCH_HISTORY": {
            let sessionIds: string[] | undefined = sessionId
              ? [sessionId]
              : undefined;

            if (getFullMessageThread) {
              try {
                const thread = await getFullMessageThread();
                sessionIds = thread.sessionIds;
              } catch (error) {
                logger?.error("Failed to fetch ancestor session IDs", error);
              }
            }

            const history = await PromptHistoryManager.getHistory({
              sessionId: sessionIds,
              workdir: workdir,
            });
            dispatch({ type: "SET_HISTORY_ENTRIES", payload: history });
            dispatch({ type: "NAVIGATE_HISTORY", payload: "up" });
            break;
          }
          case "PASTE_IMAGE":
            try {
              await handlers.handlePasteImage(dispatch);
            } catch (error) {
              console.warn("Failed to handle paste image:", error);
            }
            break;
          case "EXECUTE_COMMAND":
            if (onSendMessage && onHasSlashCommand?.(effect.command)) {
              const fullCommand = `/${effect.command}`;
              try {
                await onSendMessage(fullCommand, undefined, {});
              } catch (error) {
                console.error("Failed to execute slash command:", error);
              }
            } else {
              // Internal command handling
              const command = effect.command;
              if (command === "tasks") {
                dispatch({
                  type: "SET_SHOW_BACKGROUND_TASK_MANAGER",
                  payload: true,
                });
              } else if (command === "mcp") {
                dispatch({ type: "SET_SHOW_MCP_MANAGER", payload: true });
              } else if (command === "rewind") {
                dispatch({ type: "SET_SHOW_REWIND_MANAGER", payload: true });
              } else if (command === "help") {
                dispatch({ type: "SET_SHOW_HELP", payload: true });
              } else if (command === "status") {
                dispatch({ type: "SET_SHOW_STATUS_COMMAND", payload: true });
              } else if (command === "plugin") {
                dispatch({ type: "SET_SHOW_PLUGIN_MANAGER", payload: true });
              } else if (command === "model") {
                dispatch({ type: "SET_SHOW_MODEL_SELECTOR", payload: true });
              } else if (command === "btw") {
                dispatch({
                  type: "SET_BTW_STATE",
                  payload: { isActive: true, question: "", isLoading: false },
                });
              }
            }
            break;
        }
      } catch (error) {
        console.error("Effect execution error:", error);
      }
    };

    runEffect();
  }, [
    state.pendingEffect,
    onSendMessage,
    onAbortMessage,
    onBackgroundCurrentTask,
    onAskBtw,
    onPermissionModeChange,
    sessionId,
    workdir,
    getFullMessageThread,
    logger,
    onHasSlashCommand,
  ]);

  useEffect(() => {
    onFileSelectorStateChange?.(
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
    onFileSelectorStateChange,
  ]);

  useEffect(() => {
    onCommandSelectorStateChange?.(
      state.showCommandSelector,
      state.commandSearchQuery,
      state.slashPosition,
    );
  }, [
    state.showCommandSelector,
    state.commandSearchQuery,
    state.slashPosition,
    onCommandSelectorStateChange,
  ]);

  useEffect(() => {
    onHistorySearchStateChange?.(
      state.showHistorySearch,
      state.historySearchQuery,
    );
  }, [
    state.showHistorySearch,
    state.historySearchQuery,
    onHistorySearchStateChange,
  ]);

  useEffect(() => {
    onBackgroundTaskManagerStateChange?.(state.showBackgroundTaskManager);
  }, [state.showBackgroundTaskManager, onBackgroundTaskManagerStateChange]);

  useEffect(() => {
    onMcpManagerStateChange?.(state.showMcpManager);
  }, [state.showMcpManager, onMcpManagerStateChange]);

  useEffect(() => {
    onRewindManagerStateChange?.(state.showRewindManager);
  }, [state.showRewindManager, onRewindManagerStateChange]);

  useEffect(() => {
    onHelpStateChange?.(state.showHelp);
  }, [state.showHelp, onHelpStateChange]);

  useEffect(() => {
    onStatusCommandStateChange?.(state.showStatusCommand);
  }, [state.showStatusCommand, onStatusCommandStateChange]);

  useEffect(() => {
    onPluginManagerStateChange?.(state.showPluginManager);
  }, [state.showPluginManager, onPluginManagerStateChange]);

  useEffect(() => {
    onModelSelectorStateChange?.(state.showModelSelector);
  }, [state.showModelSelector, onModelSelectorStateChange]);

  useEffect(() => {
    onImagesStateChange?.(state.attachedImages);
  }, [state.attachedImages, onImagesStateChange]);

  // Handle /btw side question
  useEffect(() => {
    if (
      state.btwState.isActive &&
      state.btwState.isLoading &&
      state.btwState.question
    ) {
      const askBtw = async () => {
        try {
          const answer = await onAskBtw?.(state.btwState.question);
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
    onAskBtw,
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
    dispatch({ type: "SELECT_FILE", payload: filePath });
  }, []);

  const handleCancelFileSelect = useCallback(() => {
    dispatch({ type: "CANCEL_FILE_SELECTOR" });
  }, []);

  const updateFileSearchQuery = useCallback((query: string) => {
    dispatch({ type: "SET_FILE_SEARCH_QUERY", payload: query });
  }, []);

  const checkForAtDeletion = useCallback(
    (cursorPos: number) => {
      // This is now largely handled inside HANDLE_KEY,
      // but kept for external calls if any.
      return handlers.checkForAtDeletion(state, dispatch, cursorPos);
    },
    [state],
  );

  const activateCommandSelector = useCallback((position: number) => {
    dispatch({ type: "ACTIVATE_COMMAND_SELECTOR", payload: position });
  }, []);

  const handleCommandSelect = useCallback((command: string) => {
    dispatch({ type: "SELECT_COMMAND", payload: command });
  }, []);

  const handleCommandInsert = useCallback((command: string) => {
    dispatch({ type: "INSERT_COMMAND", payload: command });
  }, []);

  const handleCancelCommandSelect = useCallback(() => {
    dispatch({ type: "CANCEL_COMMAND_SELECTOR" });
  }, []);

  const updateCommandSearchQuery = useCallback((query: string) => {
    dispatch({ type: "SET_COMMAND_SEARCH_QUERY", payload: query });
  }, []);

  const checkForSlashDeletion = useCallback(
    (cursorPos: number) => {
      return handlers.checkForSlashDeletion(state, dispatch, cursorPos);
    },
    [state],
  );

  const handleHistorySearchSelect = useCallback((entry: PromptEntry) => {
    dispatch({ type: "SELECT_HISTORY_ENTRY", payload: entry });
  }, []);

  const handleCancelHistorySearch = useCallback(() => {
    dispatch({ type: "CANCEL_HISTORY_SEARCH" });
  }, []);

  const processSelectorInput = useCallback(
    (char: string) => {
      handlers.processSelectorInput(state, dispatch, char);
    },
    [state],
  );

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

  const setPermissionMode = useCallback(
    (mode: PermissionMode) => {
      dispatch({ type: "SET_PERMISSION_MODE", payload: mode });
      onPermissionModeChange?.(mode);
    },
    [onPermissionModeChange],
  );

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

  const handlePasteInput = useCallback(
    (input: string) => {
      dispatch({
        type: "HANDLE_KEY",
        payload: {
          input,
          key: {} as Key,
          hasSlashCommand: (cmd) => !!onHasSlashCommand?.(cmd),
        },
      });
    },
    [onHasSlashCommand],
  );

  const handleSubmit = useCallback(async () => {
    dispatch({
      type: "HANDLE_KEY",
      payload: {
        input: "",
        key: { return: true } as Key,
        hasSlashCommand: (cmd) => !!onHasSlashCommand?.(cmd),
      },
    });
  }, [onHasSlashCommand]);

  const expandLongTextPlaceholders = useCallback(
    (text: string) => {
      return handlers.expandLongTextPlaceholders(text, state.longTextMap);
    },
    [state.longTextMap],
  );

  const clearLongTextMap = useCallback(() => {
    dispatch({ type: "CLEAR_LONG_TEXT_MAP" });
  }, []);

  const handleInput = useCallback(
    async (
      input: string,
      key: Key,
      _attachedImages: Array<{ id: number; path: string; mimeType: string }>,
      clearImages?: () => void,
    ) => {
      // Clear images side effect if return is pressed
      if (key.return) {
        clearImages?.();
      }

      dispatch({
        type: "HANDLE_KEY",
        payload: {
          input,
          key,
          hasSlashCommand: (cmd) => !!onHasSlashCommand?.(cmd),
        },
      });
      return true;
    },
    [onHasSlashCommand],
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
