import { useEffect, useReducer, useCallback } from "react";
import { Key } from "ink";
import {
  inputReducer,
  initialState,
  InputManagerCallbacks,
} from "../managers/inputReducer.js";
import {
  searchFiles,
  PermissionMode,
  PromptEntry,
  PromptHistoryManager,
} from "wave-agent-sdk";
import {
  processSelectorAfterInsert,
  expandLongTextPlaceholders as expandLongTextUtil,
} from "../utils/inputUtils.js";
import { handlePasteImage as handlePasteImageUtil } from "../managers/inputHandlers.js";

export const useInputManager = (
  callbacks: Partial<InputManagerCallbacks> = {},
) => {
  const [state, dispatch] = useReducer(inputReducer, initialState);

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
          const fileItems = await searchFiles(state.fileSearchQuery);
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

  // Handle selector insert (processSelectorInput needs to be called after text insertion)
  useEffect(() => {
    if (state.pendingSelectorInsert) {
      processSelectorAfterInsert(state, dispatch, state.pendingSelectorInsert);
      dispatch({ type: "CLEAR_PENDING_SELECTOR_INSERT" });
    }
  }, [state.pendingSelectorInsert, state.inputText, state.cursorPosition]);

  // Handle permission cycling
  useEffect(() => {
    if (state.pendingCyclePermission) {
      const modes: PermissionMode[] = [
        "default",
        "acceptEdits",
        "plan",
        "bypassPermissions",
      ];
      const currentIndex = modes.indexOf(state.permissionMode);
      const nextIndex =
        currentIndex === -1 ? 0 : (currentIndex + 1) % modes.length;
      const nextMode = modes[nextIndex];

      callbacks.logger?.debug("Cycling permission mode", {
        from: state.permissionMode,
        to: nextMode,
      });

      callbacks.onPermissionModeChange?.(nextMode);
      dispatch({ type: "CLEAR_PENDING_CYCLE_PERMISSION" });
    }
  }, [state.pendingCyclePermission, state.permissionMode, callbacks]);

  // Handle pending submit
  useEffect(() => {
    if (state.pendingSubmit) {
      const { content, images, longTextMap } = state.pendingSubmit;

      PromptHistoryManager.addEntry(
        content,
        callbacks.sessionId,
        longTextMap,
        callbacks.workdir,
      ).catch((err: unknown) => {
        callbacks.logger?.error("Failed to save prompt history", err);
      });

      callbacks.onSendMessage?.(content, images, longTextMap);
      dispatch({ type: "CLEAR_IMAGES" });
      dispatch({ type: "CLEAR_PENDING_SUBMIT" });
    }
  }, [state.pendingSubmit, callbacks]);

  // Handle pending command
  useEffect(() => {
    if (state.pendingCommand) {
      const { command, newInput, newCursorPosition } = state.pendingCommand;

      (async () => {
        let commandExecuted = false;
        if (callbacks.onSendMessage && callbacks.onHasSlashCommand?.(command)) {
          const fullCommand = `/${command}`;
          try {
            await callbacks.onSendMessage(fullCommand, undefined, {});
            commandExecuted = true;
          } catch (error) {
            console.error("Failed to execute slash command:", error);
          }
        }

        if (!commandExecuted) {
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
        dispatch({ type: "CLEAR_PENDING_COMMAND" });
      })();

      callbacks.onInputTextChange?.(newInput);
      callbacks.onCursorPositionChange?.(newCursorPosition);
    }
  }, [state.pendingCommand, callbacks]);

  // Handle pending abort
  useEffect(() => {
    if (state.pendingAbort) {
      callbacks.onAbortMessage?.();
      dispatch({ type: "CLEAR_PENDING_ABORT" });
    }
  }, [state.pendingAbort, callbacks]);

  // Handle pending background task
  useEffect(() => {
    if (state.pendingBackgroundTask) {
      callbacks.onBackgroundCurrentTask?.();
      dispatch({ type: "CLEAR_PENDING_BACKGROUND_TASK" });
    }
  }, [state.pendingBackgroundTask, callbacks]);

  // Handle pending paste image
  useEffect(() => {
    if (state.pendingPasteImage) {
      handlePasteImageUtil(dispatch).catch((error) => {
        console.warn("Failed to handle paste image:", error);
        dispatch({ type: "IMAGE_PASTED", payload: null });
      });
    }
  }, [state.pendingPasteImage]);

  // Handle pending history fetch
  useEffect(() => {
    if (state.pendingHistoryFetch) {
      (async () => {
        let sessionIds: string[] | undefined = callbacks.sessionId
          ? [callbacks.sessionId]
          : undefined;

        if (callbacks.getFullMessageThread) {
          try {
            const thread = await callbacks.getFullMessageThread();
            sessionIds = thread.sessionIds;
          } catch (error) {
            callbacks.logger?.error(
              "Failed to fetch ancestor session IDs",
              error,
            );
          }
        }

        const history = await PromptHistoryManager.getHistory({
          sessionId: sessionIds,
          workdir: callbacks.workdir,
        });
        dispatch({ type: "HISTORY_FETCHED", payload: history });
        dispatch({ type: "NAVIGATE_HISTORY", payload: "up" });
      })();
    }
  }, [state.pendingHistoryFetch, callbacks]);

  // Handle btw side question
  useEffect(() => {
    if (
      state.btwState.isActive &&
      state.btwState.isLoading &&
      state.btwState.question
    ) {
      const askBtw = async () => {
        try {
          const answer = await callbacks.onAskBtw?.(state.btwState.question);
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
    callbacks,
  ]);

  // Sync state changes with callbacks
  useEffect(() => {
    callbacks.onInputTextChange?.(state.inputText);
  }, [state.inputText, callbacks]);

  useEffect(() => {
    callbacks.onCursorPositionChange?.(state.cursorPosition);
  }, [state.cursorPosition, callbacks]);

  useEffect(() => {
    callbacks.onFileSelectorStateChange?.(
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
    callbacks,
  ]);

  useEffect(() => {
    callbacks.onCommandSelectorStateChange?.(
      state.showCommandSelector,
      state.commandSearchQuery,
      state.slashPosition,
    );
  }, [
    state.showCommandSelector,
    state.commandSearchQuery,
    state.slashPosition,
    callbacks,
  ]);

  useEffect(() => {
    callbacks.onHistorySearchStateChange?.(
      state.showHistorySearch,
      state.historySearchQuery,
    );
  }, [state.showHistorySearch, state.historySearchQuery, callbacks]);

  useEffect(() => {
    callbacks.onBackgroundTaskManagerStateChange?.(
      state.showBackgroundTaskManager,
    );
  }, [state.showBackgroundTaskManager, callbacks]);

  useEffect(() => {
    callbacks.onMcpManagerStateChange?.(state.showMcpManager);
  }, [state.showMcpManager, callbacks]);

  useEffect(() => {
    callbacks.onRewindManagerStateChange?.(state.showRewindManager);
  }, [state.showRewindManager, callbacks]);

  useEffect(() => {
    callbacks.onHelpStateChange?.(state.showHelp);
  }, [state.showHelp, callbacks]);

  useEffect(() => {
    callbacks.onStatusCommandStateChange?.(state.showStatusCommand);
  }, [state.showStatusCommand, callbacks]);

  useEffect(() => {
    callbacks.onPluginManagerStateChange?.(state.showPluginManager);
  }, [state.showPluginManager, callbacks]);

  useEffect(() => {
    callbacks.onModelSelectorStateChange?.(state.showModelSelector);
  }, [state.showModelSelector, callbacks]);

  useEffect(() => {
    callbacks.onImagesStateChange?.(state.attachedImages);
  }, [state.attachedImages, callbacks]);

  // Handle file select
  useEffect(() => {
    // This is triggered by HANDLE_FILE_SELECT reducer case
    // The callbacks are called after state update via pending effects
    if (
      state.showFileSelector === false &&
      state.atPosition === -1 &&
      state.selectorJustUsed
    ) {
      // File selector was just closed - callbacks already notified via useEffect watchers above
    }
  }, [state.showFileSelector, state.atPosition, state.selectorJustUsed]);

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
    dispatch({ type: "HANDLE_FILE_SELECT", payload: { filePath } });
  }, []);

  const handleCancelFileSelect = useCallback(() => {
    dispatch({ type: "CANCEL_FILE_SELECTOR" });
  }, []);

  const updateFileSearchQuery = useCallback((query: string) => {
    dispatch({ type: "SET_FILE_SEARCH_QUERY", payload: query });
  }, []);

  const checkForAtDeletion = useCallback(
    (cursorPos: number) => {
      // This is now handled in the reducer via HANDLE_KEY
      if (state.showFileSelector && cursorPos <= state.atPosition) {
        dispatch({ type: "CANCEL_FILE_SELECTOR" });
      }
    },
    [state.showFileSelector, state.atPosition],
  );

  const activateCommandSelector = useCallback((position: number) => {
    dispatch({ type: "ACTIVATE_COMMAND_SELECTOR", payload: position });
  }, []);

  const handleCommandSelect = useCallback((command: string) => {
    dispatch({ type: "HANDLE_COMMAND_SELECT", payload: { command } });
  }, []);

  const handleCommandInsert = useCallback(
    (command: string) => {
      if (state.slashPosition >= 0) {
        const beforeSlash = state.inputText.substring(0, state.slashPosition);
        const wordEnd = (() => {
          let i = state.slashPosition;
          while (i < state.inputText.length && !/\s/.test(state.inputText[i])) {
            i++;
          }
          return i;
        })();
        const afterWord = state.inputText.substring(wordEnd);
        const newInput = beforeSlash + `/${command} ` + afterWord;
        const newCursorPosition = beforeSlash.length + command.length + 2;

        dispatch({ type: "SET_INPUT_TEXT", payload: newInput });
        dispatch({ type: "SET_CURSOR_POSITION", payload: newCursorPosition });
        dispatch({ type: "CANCEL_COMMAND_SELECTOR" });

        callbacks.onInputTextChange?.(newInput);
        callbacks.onCursorPositionChange?.(newCursorPosition);

        return { newInput, newCursorPosition };
      }
      return {
        newInput: state.inputText,
        newCursorPosition: state.cursorPosition,
      };
    },
    [state.slashPosition, state.inputText, state.cursorPosition, callbacks],
  );

  const handleCancelCommandSelect = useCallback(() => {
    dispatch({ type: "CANCEL_COMMAND_SELECTOR" });
  }, []);

  const updateCommandSearchQuery = useCallback((query: string) => {
    dispatch({ type: "SET_COMMAND_SEARCH_QUERY", payload: query });
  }, []);

  const checkForSlashDeletion = useCallback(
    (cursorPos: number) => {
      if (state.showCommandSelector && cursorPos <= state.slashPosition) {
        dispatch({ type: "CANCEL_COMMAND_SELECTOR" });
      }
    },
    [state.showCommandSelector, state.slashPosition],
  );

  const handleHistorySearchSelect = useCallback((entry: PromptEntry) => {
    dispatch({ type: "SELECT_HISTORY_ENTRY", payload: entry });
  }, []);

  const handleCancelHistorySearch = useCallback(() => {
    dispatch({ type: "CANCEL_HISTORY_SEARCH" });
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

  const setPermissionMode = useCallback(
    (mode: PermissionMode) => {
      dispatch({ type: "SET_PERMISSION_MODE", payload: mode });
      callbacks.onPermissionModeChange?.(mode);
    },
    [callbacks],
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
    dispatch({ type: "REQUEST_PASTE_IMAGE" });
  }, []);

  const handlePasteInput = useCallback((input: string) => {
    dispatch({ type: "PASTE_INPUT", payload: { input } });
  }, []);

  const handleSubmit = useCallback(
    (attachedImages: Array<{ id: number; path: string; mimeType: string }>) => {
      dispatch({ type: "SUBMIT", payload: { attachedImages } });
    },
    [],
  );

  const expandLongTextPlaceholders = useCallback(
    (text: string) => {
      return expandLongTextUtil(text, state.longTextMap);
    },
    [state.longTextMap],
  );

  const clearLongTextMap = useCallback(() => {
    dispatch({ type: "CLEAR_LONG_TEXT_MAP" });
  }, []);

  const handleInput = useCallback(
    (
      input: string,
      key: Key,
      attachedImages: Array<{ id: number; path: string; mimeType: string }>,
    ) => {
      dispatch({
        type: "HANDLE_KEY",
        payload: { input, key, attachedImages },
      });
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
