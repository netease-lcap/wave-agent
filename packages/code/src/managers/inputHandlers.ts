import { Key } from "ink";
import { PromptHistoryManager, PermissionMode } from "wave-agent-sdk";
import { readClipboardImage } from "../utils/clipboard.js";
import {
  InputState,
  InputAction,
  InputManagerCallbacks,
} from "./inputReducer.js";

export const expandLongTextPlaceholders = (
  text: string,
  longTextMap: Record<string, string>,
): string => {
  let expandedText = text;
  const longTextRegex = /\[LongText#(\d+)\]/g;
  const matches = [...text.matchAll(longTextRegex)];

  for (const match of matches) {
    const placeholder = match[0];
    const originalText = longTextMap[placeholder];
    if (originalText) {
      expandedText = expandedText.replace(placeholder, originalText);
    }
  }

  return expandedText;
};

export const handleSubmit = async (
  state: InputState,
  dispatch: React.Dispatch<InputAction>,
  callbacks: Partial<InputManagerCallbacks>,
  attachedImagesOverride?: Array<{
    id: number;
    path: string;
    mimeType: string;
  }>,
): Promise<void> => {
  if (state.inputText.trim()) {
    const imageRegex = /\[Image #(\d+)\]/g;
    const matches = [...state.inputText.matchAll(imageRegex)];
    const attachedImages = attachedImagesOverride || state.attachedImages;
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

    const contentWithPlaceholders = state.inputText
      .replace(imageRegex, "")
      .trim();
    const cleanContent = expandLongTextPlaceholders(
      contentWithPlaceholders,
      state.longTextMap,
    );

    PromptHistoryManager.addEntry(
      contentWithPlaceholders,
      callbacks.sessionId,
      state.longTextMap,
      callbacks.workdir,
    ).catch((err: unknown) => {
      callbacks.logger?.error("Failed to save prompt history", err);
    });

    callbacks.onSendMessage?.(
      cleanContent,
      referencedImages.length > 0 ? referencedImages : undefined,
    );
    dispatch({ type: "CLEAR_INPUT" });
    dispatch({ type: "RESET_HISTORY_NAVIGATION" });
    dispatch({ type: "CLEAR_LONG_TEXT_MAP" });
  }
};

export const handlePasteImage = async (
  dispatch: React.Dispatch<InputAction>,
): Promise<boolean> => {
  try {
    const result = await readClipboardImage();

    if (result.success && result.imagePath && result.mimeType) {
      dispatch({
        type: "ADD_IMAGE_AND_INSERT_PLACEHOLDER",
        payload: { path: result.imagePath, mimeType: result.mimeType },
      });
      return true;
    }

    return false;
  } catch (error) {
    console.warn("Failed to paste image from clipboard:", error);
    return false;
  }
};

export const cyclePermissionMode = (
  currentMode: PermissionMode,
  dispatch: React.Dispatch<InputAction>,
  callbacks: Partial<InputManagerCallbacks>,
) => {
  const modes: PermissionMode[] = ["default", "acceptEdits", "plan"];
  const currentIndex = modes.indexOf(currentMode);
  const nextIndex = currentIndex === -1 ? 0 : (currentIndex + 1) % modes.length;
  const nextMode = modes[nextIndex];

  callbacks.logger?.debug("Cycling permission mode", {
    from: currentMode,
    to: nextMode,
  });

  dispatch({ type: "SET_PERMISSION_MODE", payload: nextMode });
  callbacks.onPermissionModeChange?.(nextMode);
};

const SELECTOR_TRIGGERS = [
  {
    char: "@",
    type: "ACTIVATE_FILE_SELECTOR",
    shouldActivate: (char: string, pos: number, text: string) =>
      char === "@" && (pos === 1 || /\s/.test(text[pos - 2])),
  },
  {
    char: "/",
    type: "ACTIVATE_COMMAND_SELECTOR",
    shouldActivate: (
      char: string,
      pos: number,
      text: string,
      state: InputState,
    ) =>
      char === "/" &&
      !state.showFileSelector &&
      (pos === 1 || /\s/.test(text[pos - 2])),
  },
] as const;

const getProjectedState = (state: InputState, char: string) => {
  const beforeCursor = state.inputText.substring(0, state.cursorPosition);
  const afterCursor = state.inputText.substring(state.cursorPosition);
  const newInputText = beforeCursor + char + afterCursor;
  const newCursorPosition = state.cursorPosition + char.length;
  return { newInputText, newCursorPosition };
};

export const getAtSelectorPosition = (
  text: string,
  cursorPosition: number,
): number => {
  let i = cursorPosition - 1;
  while (i >= 0 && !/\s/.test(text[i])) {
    if (text[i] === "@") {
      // Check if this @ is at the start or preceded by whitespace
      if (i === 0 || /\s/.test(text[i - 1])) {
        return i;
      }
      break;
    }
    i--;
  }
  return -1;
};

export const getSlashSelectorPosition = (
  text: string,
  cursorPosition: number,
): number => {
  let i = cursorPosition - 1;
  while (i >= 0 && !/\s/.test(text[i])) {
    if (text[i] === "/") {
      // Check if this / is at the start or preceded by whitespace
      if (i === 0 || /\s/.test(text[i - 1])) {
        return i;
      }
      break;
    }
    i--;
  }
  return -1;
};

export const updateSearchQueriesForActiveSelectors = (
  state: InputState,
  dispatch: React.Dispatch<InputAction>,
  inputText: string,
  cursorPosition: number,
): void => {
  if (state.showFileSelector && state.atPosition >= 0) {
    const queryStart = state.atPosition + 1;
    const queryEnd = cursorPosition;
    const newQuery = inputText.substring(queryStart, queryEnd);
    dispatch({ type: "SET_FILE_SEARCH_QUERY", payload: newQuery });
  } else if (state.showCommandSelector && state.slashPosition >= 0) {
    const queryStart = state.slashPosition + 1;
    const queryEnd = cursorPosition;
    const newQuery = inputText.substring(queryStart, queryEnd);
    dispatch({ type: "SET_COMMAND_SEARCH_QUERY", payload: newQuery });
  }
};

export const processSelectorInput = (
  state: InputState,
  dispatch: React.Dispatch<InputAction>,
  char: string,
): void => {
  const { newInputText, newCursorPosition } = getProjectedState(state, char);

  const trigger = SELECTOR_TRIGGERS.find((t) =>
    t.shouldActivate(char, newCursorPosition, newInputText, state),
  );

  if (trigger) {
    dispatch({
      type: trigger.type,
      payload: newCursorPosition - 1,
    } as InputAction);
  } else {
    const atPos = getAtSelectorPosition(newInputText, newCursorPosition);
    let showFileSelector = state.showFileSelector;
    let atPosition = state.atPosition;
    if (atPos !== -1 && !state.showFileSelector) {
      dispatch({
        type: "ACTIVATE_FILE_SELECTOR",
        payload: atPos,
      });
      showFileSelector = true;
      atPosition = atPos;
    }

    const slashPos = getSlashSelectorPosition(newInputText, newCursorPosition);
    let showCommandSelector = state.showCommandSelector;
    let slashPosition = state.slashPosition;
    if (slashPos !== -1 && !state.showCommandSelector) {
      dispatch({
        type: "ACTIVATE_COMMAND_SELECTOR",
        payload: slashPos,
      });
      showCommandSelector = true;
      slashPosition = slashPos;
    }

    updateSearchQueriesForActiveSelectors(
      {
        ...state,
        showFileSelector,
        atPosition,
        showCommandSelector,
        slashPosition,
      },
      dispatch,
      newInputText,
      newCursorPosition,
    );
  }
};

export const handlePasteInput = (
  state: InputState,
  dispatch: React.Dispatch<InputAction>,
  callbacks: Partial<InputManagerCallbacks>,
  input: string,
): void => {
  const inputString = input;
  const isPasteOperation =
    inputString.length > 1 ||
    inputString.includes("\n") ||
    inputString.includes("\r");

  if (isPasteOperation) {
    if (!state.isPasting) {
      dispatch({
        type: "START_PASTE",
        payload: { buffer: inputString, cursorPosition: state.cursorPosition },
      });
    } else {
      dispatch({ type: "APPEND_PASTE_BUFFER", payload: inputString });
    }
  } else {
    let char = inputString;
    if (char === "！" && state.cursorPosition === 0) {
      char = "!";
    }

    dispatch({ type: "INSERT_TEXT", payload: char });

    processSelectorInput(state, dispatch, char);
  }
};

export const getWordEnd = (text: string, startPos: number): number => {
  let i = startPos;
  while (i < text.length && !/\s/.test(text[i])) {
    i++;
  }
  return i;
};

export const handleCommandSelect = (
  state: InputState,
  dispatch: React.Dispatch<InputAction>,
  callbacks: Partial<InputManagerCallbacks>,
  command: string,
) => {
  if (state.slashPosition >= 0) {
    const wordEnd = getWordEnd(state.inputText, state.slashPosition);
    const beforeSlash = state.inputText.substring(0, state.slashPosition);
    const afterWord = state.inputText.substring(wordEnd);
    const newInput = beforeSlash + afterWord;
    const newCursorPosition = beforeSlash.length;

    dispatch({ type: "SET_INPUT_TEXT", payload: newInput });
    dispatch({ type: "SET_CURSOR_POSITION", payload: newCursorPosition });

    // Execute command asynchronously
    (async () => {
      let commandExecuted = false;
      if (callbacks.onSendMessage && callbacks.onHasSlashCommand?.(command)) {
        const fullCommand = `/${command}`;
        try {
          await callbacks.onSendMessage(fullCommand);
          commandExecuted = true;
        } catch (error) {
          console.error("Failed to execute slash command:", error);
        }
      }

      if (!commandExecuted) {
        if (command === "clear") {
          callbacks.onClearMessages?.();
        } else if (command === "tasks") {
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
        }
      }
    })();

    dispatch({ type: "CANCEL_COMMAND_SELECTOR" });
    callbacks.onInputTextChange?.(newInput);
    callbacks.onCursorPositionChange?.(newCursorPosition);

    return { newInput, newCursorPosition };
  }
  return { newInput: state.inputText, newCursorPosition: state.cursorPosition };
};

export const handleFileSelect = (
  state: InputState,
  dispatch: React.Dispatch<InputAction>,
  callbacks: Partial<InputManagerCallbacks>,
  filePath: string,
) => {
  if (state.atPosition >= 0) {
    const wordEnd = getWordEnd(state.inputText, state.atPosition);
    const beforeAt = state.inputText.substring(0, state.atPosition);
    const afterWord = state.inputText.substring(wordEnd);
    const newInput = beforeAt + `@${filePath} ` + afterWord;
    const newCursorPosition = beforeAt.length + filePath.length + 2;

    dispatch({ type: "SET_INPUT_TEXT", payload: newInput });
    dispatch({ type: "SET_CURSOR_POSITION", payload: newCursorPosition });
    dispatch({ type: "CANCEL_FILE_SELECTOR" });

    callbacks.onInputTextChange?.(newInput);
    callbacks.onCursorPositionChange?.(newCursorPosition);

    return { newInput, newCursorPosition };
  }
  return { newInput: state.inputText, newCursorPosition: state.cursorPosition };
};

export const checkForAtDeletion = (
  state: InputState,
  dispatch: React.Dispatch<InputAction>,
  cursorPosition: number,
): boolean => {
  if (state.showFileSelector && cursorPosition <= state.atPosition) {
    dispatch({ type: "CANCEL_FILE_SELECTOR" });
    return true;
  }
  return false;
};

export const checkForSlashDeletion = (
  state: InputState,
  dispatch: React.Dispatch<InputAction>,
  cursorPosition: number,
): boolean => {
  if (state.showCommandSelector && cursorPosition <= state.slashPosition) {
    dispatch({ type: "CANCEL_COMMAND_SELECTOR" });
    return true;
  }
  return false;
};

export const handleSelectorInput = (
  state: InputState,
  dispatch: React.Dispatch<InputAction>,
  callbacks: Partial<InputManagerCallbacks>,
  input: string,
  key: Key,
): boolean => {
  if (key.backspace || key.delete) {
    if (state.cursorPosition > 0) {
      const newCursorPosition = state.cursorPosition - 1;
      const beforeCursor = state.inputText.substring(
        0,
        state.cursorPosition - 1,
      );
      const afterCursor = state.inputText.substring(state.cursorPosition);
      const newInputText = beforeCursor + afterCursor;

      dispatch({ type: "DELETE_CHAR" });

      // Check for special character deletion
      checkForAtDeletion(state, dispatch, newCursorPosition);
      checkForSlashDeletion(state, dispatch, newCursorPosition);

      // Update search queries
      updateSearchQueriesForActiveSelectors(
        state,
        dispatch,
        newInputText,
        newCursorPosition,
      );
    }
    return true;
  }

  if (key.upArrow || key.downArrow || key.return || key.tab) {
    return true;
  }

  if (key.leftArrow) {
    const newCursorPosition = state.cursorPosition - 1;
    dispatch({ type: "MOVE_CURSOR", payload: -1 });
    checkForAtDeletion(state, dispatch, newCursorPosition);
    checkForSlashDeletion(state, dispatch, newCursorPosition);
    return true;
  }

  if (key.rightArrow) {
    const newCursorPosition = state.cursorPosition + 1;
    dispatch({ type: "MOVE_CURSOR", payload: 1 });
    checkForAtDeletion(state, dispatch, newCursorPosition);
    checkForSlashDeletion(state, dispatch, newCursorPosition);
    return true;
  }

  if (input === " ") {
    if (state.showFileSelector) {
      dispatch({ type: "CANCEL_FILE_SELECTOR" });
    } else if (state.showCommandSelector) {
      dispatch({ type: "CANCEL_COMMAND_SELECTOR" });
    }
  }

  if (
    input &&
    !key.ctrl &&
    !("alt" in key && key.alt) &&
    !key.meta &&
    !key.return &&
    !key.tab &&
    !key.escape &&
    !key.leftArrow &&
    !key.rightArrow &&
    !("home" in key && key.home) &&
    !("end" in key && key.end)
  ) {
    dispatch({ type: "INSERT_TEXT", payload: input });

    processSelectorInput(state, dispatch, input);
    return true;
  }

  return false;
};

export const handleNormalInput = async (
  state: InputState,
  dispatch: React.Dispatch<InputAction>,
  callbacks: Partial<InputManagerCallbacks>,
  input: string,
  key: Key,
  clearImages?: () => void,
): Promise<boolean> => {
  if (key.return) {
    await handleSubmit(state, dispatch, callbacks);
    clearImages?.();
    return true;
  }

  if (key.escape) {
    if (state.showFileSelector) {
      dispatch({ type: "CANCEL_FILE_SELECTOR" });
    } else if (state.showCommandSelector) {
      dispatch({ type: "CANCEL_COMMAND_SELECTOR" });
    } else if (state.historyIndex !== -1) {
      dispatch({ type: "RESET_HISTORY_NAVIGATION" });
    }
    return true;
  }

  if (key.upArrow) {
    if (state.history.length === 0) {
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
      dispatch({ type: "SET_HISTORY_ENTRIES", payload: history });
    }
    dispatch({ type: "NAVIGATE_HISTORY", payload: "up" });
    return true;
  }

  if (key.downArrow) {
    dispatch({ type: "NAVIGATE_HISTORY", payload: "down" });
    return true;
  }

  if (key.backspace || key.delete) {
    if (state.cursorPosition > 0) {
      const newCursorPosition = state.cursorPosition - 1;
      const beforeCursor = state.inputText.substring(
        0,
        state.cursorPosition - 1,
      );
      const afterCursor = state.inputText.substring(state.cursorPosition);
      const newInputText = beforeCursor + afterCursor;

      dispatch({ type: "DELETE_CHAR" });

      checkForAtDeletion(state, dispatch, newCursorPosition);
      checkForSlashDeletion(state, dispatch, newCursorPosition);

      // Reactivate file selector if cursor is now within an @word
      const atPos = getAtSelectorPosition(newInputText, newCursorPosition);
      let showFileSelector = state.showFileSelector;
      let atPosition = state.atPosition;
      if (atPos !== -1 && !state.showFileSelector) {
        dispatch({
          type: "ACTIVATE_FILE_SELECTOR",
          payload: atPos,
        });
        showFileSelector = true;
        atPosition = atPos;
      }

      const slashPos = getSlashSelectorPosition(
        newInputText,
        newCursorPosition,
      );
      let showCommandSelector = state.showCommandSelector;
      let slashPosition = state.slashPosition;
      if (slashPos !== -1 && !state.showCommandSelector) {
        dispatch({
          type: "ACTIVATE_COMMAND_SELECTOR",
          payload: slashPos,
        });
        showCommandSelector = true;
        slashPosition = slashPos;
      }

      updateSearchQueriesForActiveSelectors(
        {
          ...state,
          inputText: newInputText,
          cursorPosition: newCursorPosition,
          showFileSelector,
          atPosition,
          showCommandSelector,
          slashPosition,
        },
        dispatch,
        newInputText,
        newCursorPosition,
      );
    }
    return true;
  }

  if (key.leftArrow) {
    dispatch({ type: "MOVE_CURSOR", payload: -1 });
    return true;
  }

  if (key.rightArrow) {
    dispatch({ type: "MOVE_CURSOR", payload: 1 });
    return true;
  }

  if (key.ctrl && input === "v") {
    handlePasteImage(dispatch).catch((error) => {
      console.warn("Failed to handle paste image:", error);
    });
    return true;
  }

  if (key.ctrl && input === "r") {
    dispatch({ type: "ACTIVATE_HISTORY_SEARCH" });
    return true;
  }

  if (key.ctrl && input === "b") {
    callbacks.onBackgroundCurrentTask?.();
    return true;
  }

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
    handlePasteInput(state, dispatch, callbacks, input);
    return true;
  }

  return false;
};

export const handleInput = async (
  state: InputState,
  dispatch: React.Dispatch<InputAction>,
  callbacks: Partial<InputManagerCallbacks>,
  input: string,
  key: Key,
  clearImages?: () => void,
): Promise<boolean> => {
  if (state.selectorJustUsed) {
    return true;
  }

  if (key.escape) {
    if (
      !(
        state.showFileSelector ||
        state.showCommandSelector ||
        state.showHistorySearch ||
        state.showBackgroundTaskManager ||
        state.showMcpManager ||
        state.showRewindManager ||
        state.showHelp ||
        state.showStatusCommand ||
        state.showPluginManager
      )
    ) {
      callbacks.onAbortMessage?.();
      return true;
    }
  }

  if (key.tab && key.shift) {
    cyclePermissionMode(state.permissionMode, dispatch, callbacks);
    return true;
  }

  if (
    state.showFileSelector ||
    state.showCommandSelector ||
    state.showHistorySearch ||
    state.showBackgroundTaskManager ||
    state.showMcpManager ||
    state.showRewindManager ||
    state.showHelp ||
    state.showStatusCommand ||
    state.showPluginManager
  ) {
    if (
      state.showBackgroundTaskManager ||
      state.showMcpManager ||
      state.showRewindManager ||
      state.showHelp ||
      state.showStatusCommand ||
      state.showPluginManager
    ) {
      return true;
    }

    if (state.showHistorySearch) {
      if (key.escape) {
        dispatch({ type: "CANCEL_HISTORY_SEARCH" });
        return true;
      }
      if (key.backspace || key.delete) {
        if (state.historySearchQuery.length > 0) {
          dispatch({
            type: "SET_HISTORY_SEARCH_QUERY",
            payload: state.historySearchQuery.slice(0, -1),
          });
        }
        return true;
      }
      if (input && !key.ctrl && !key.meta && !key.return && !key.tab) {
        dispatch({
          type: "SET_HISTORY_SEARCH_QUERY",
          payload: state.historySearchQuery + input,
        });
        return true;
      }
      return true;
    }

    return handleSelectorInput(state, dispatch, callbacks, input, key);
  } else {
    return await handleNormalInput(
      state,
      dispatch,
      callbacks,
      input,
      key,
      clearImages,
    );
  }
};
