import {
  FileItem,
  PermissionMode,
  Logger,
  PromptEntry,
  Message,
} from "wave-agent-sdk";
import {
  getWordEnd,
  getAtSelectorPosition,
  getSlashSelectorPosition,
} from "../utils/inputUtils.js";

export interface AttachedImage {
  id: number;
  path: string;
  mimeType: string;
}

export interface BtwState {
  isActive: boolean;
  question: string;
  answer?: string;
  isLoading: boolean;
}

export interface InputManagerCallbacks {
  onInputTextChange?: (text: string) => void;
  onCursorPositionChange?: (position: number) => void;
  onFileSelectorStateChange?: (
    show: boolean,
    files: FileItem[],
    query: string,
    position: number,
  ) => void;
  onCommandSelectorStateChange?: (
    show: boolean,
    query: string,
    position: number,
  ) => void;
  onHistorySearchStateChange?: (show: boolean, query: string) => void;
  onBackgroundTaskManagerStateChange?: (show: boolean) => void;
  onMcpManagerStateChange?: (show: boolean) => void;
  onRewindManagerStateChange?: (show: boolean) => void;
  onHelpStateChange?: (show: boolean) => void;
  onStatusCommandStateChange?: (show: boolean) => void;
  onPluginManagerStateChange?: (show: boolean) => void;
  onModelSelectorStateChange?: (show: boolean) => void;
  onImagesStateChange?: (images: AttachedImage[]) => void;
  onSendMessage?: (
    content: string,
    images?: Array<{ path: string; mimeType: string }>,
    longTextMap?: Record<string, string>,
  ) => void | Promise<void>;
  onHasSlashCommand?: (commandId: string) => boolean;
  onAbortMessage?: () => void;
  onBackgroundCurrentTask?: () => void;
  onPermissionModeChange?: (mode: PermissionMode) => void;
  onAskBtw?: (question: string) => Promise<string>;
  sessionId?: string;
  workdir?: string;
  getFullMessageThread?: () => Promise<{
    messages: Message[];
    sessionIds: string[];
  }>;
  logger?: Logger;
}

export interface InputState {
  inputText: string;
  cursorPosition: number;
  showFileSelector: boolean;
  atPosition: number;
  fileSearchQuery: string;
  filteredFiles: FileItem[];
  showCommandSelector: boolean;
  slashPosition: number;
  commandSearchQuery: string;
  showHistorySearch: boolean;
  historySearchQuery: string;
  longTextCounter: number;
  longTextMap: Record<string, string>;
  attachedImages: AttachedImage[];
  imageIdCounter: number;
  showBackgroundTaskManager: boolean;
  showMcpManager: boolean;
  showRewindManager: boolean;
  showHelp: boolean;
  showStatusCommand: boolean;
  showPluginManager: boolean;
  showModelSelector: boolean;
  permissionMode: PermissionMode;
  selectorJustUsed: boolean;
  isPasting: boolean;
  pasteBuffer: string;
  initialPasteCursorPosition: number;
  history: PromptEntry[];
  historyIndex: number;
  originalInputText: string;
  originalLongTextMap: Record<string, string>;
  isFileSearching: boolean;
  btwState: BtwState;
  // Pending effect fields - trigger useEffect side effects
  pendingSubmit: {
    content: string;
    images?: Array<{ path: string; mimeType: string }>;
    longTextMap: Record<string, string>;
  } | null;
  pendingCommand: {
    command: string;
    newInput: string;
    newCursorPosition: number;
  } | null;
  pendingAbort: boolean;
  pendingBackgroundTask: boolean;
  pendingPasteImage: boolean;
  pendingHistoryFetch: boolean;
  pendingSelectorInsert: string | null;
  pendingCyclePermission: boolean;
}

export const initialState: InputState = {
  inputText: "",
  cursorPosition: 0,
  showFileSelector: false,
  atPosition: -1,
  fileSearchQuery: "",
  filteredFiles: [],
  showCommandSelector: false,
  slashPosition: -1,
  commandSearchQuery: "",
  showHistorySearch: false,
  historySearchQuery: "",
  longTextCounter: 0,
  longTextMap: {},
  attachedImages: [],
  imageIdCounter: 1,
  showBackgroundTaskManager: false,
  showMcpManager: false,
  showRewindManager: false,
  showHelp: false,
  showStatusCommand: false,
  showPluginManager: false,
  showModelSelector: false,
  permissionMode: "default",
  selectorJustUsed: false,
  isPasting: false,
  pasteBuffer: "",
  initialPasteCursorPosition: 0,
  history: [],
  historyIndex: -1,
  originalInputText: "",
  originalLongTextMap: {},
  isFileSearching: false,
  btwState: {
    isActive: false,
    question: "",
    isLoading: false,
  },
  pendingSubmit: null,
  pendingCommand: null,
  pendingAbort: false,
  pendingBackgroundTask: false,
  pendingPasteImage: false,
  pendingHistoryFetch: false,
  pendingSelectorInsert: null,
  pendingCyclePermission: false,
};

// Key type from ink - we use the subset we need
export interface Key {
  return?: boolean;
  escape?: boolean;
  upArrow?: boolean;
  downArrow?: boolean;
  leftArrow?: boolean;
  rightArrow?: boolean;
  backspace?: boolean;
  delete?: boolean;
  tab?: boolean;
  shift?: boolean;
  ctrl?: boolean;
  meta?: boolean;
  home?: boolean;
  end?: boolean;
  alt?: boolean;
}

export type InputAction =
  | { type: "SET_INPUT_TEXT"; payload: string }
  | { type: "SET_CURSOR_POSITION"; payload: number }
  | { type: "INSERT_TEXT"; payload: string }
  | { type: "DELETE_CHAR" }
  | { type: "MOVE_CURSOR"; payload: number }
  | { type: "ACTIVATE_FILE_SELECTOR"; payload: number }
  | { type: "SET_FILE_SEARCH_QUERY"; payload: string }
  | { type: "SET_FILTERED_FILES"; payload: FileItem[] }
  | { type: "CANCEL_FILE_SELECTOR" }
  | { type: "ACTIVATE_COMMAND_SELECTOR"; payload: number }
  | { type: "SET_COMMAND_SEARCH_QUERY"; payload: string }
  | { type: "CANCEL_COMMAND_SELECTOR" }
  | { type: "ACTIVATE_HISTORY_SEARCH" }
  | { type: "SET_HISTORY_SEARCH_QUERY"; payload: string }
  | { type: "CANCEL_HISTORY_SEARCH" }
  | { type: "ADD_IMAGE"; payload: { path: string; mimeType: string } }
  | { type: "REMOVE_IMAGE"; payload: number }
  | { type: "CLEAR_IMAGES" }
  | { type: "SET_SHOW_BACKGROUND_TASK_MANAGER"; payload: boolean }
  | { type: "SET_SHOW_MCP_MANAGER"; payload: boolean }
  | { type: "SET_SHOW_REWIND_MANAGER"; payload: boolean }
  | { type: "SET_SHOW_HELP"; payload: boolean }
  | { type: "SET_SHOW_STATUS_COMMAND"; payload: boolean }
  | { type: "SET_SHOW_PLUGIN_MANAGER"; payload: boolean }
  | { type: "SET_SHOW_MODEL_SELECTOR"; payload: boolean }
  | { type: "SET_PERMISSION_MODE"; payload: PermissionMode }
  | { type: "SET_SELECTOR_JUST_USED"; payload: boolean }
  | { type: "INSERT_TEXT_WITH_PLACEHOLDER"; payload: string }
  | { type: "CLEAR_LONG_TEXT_MAP" }
  | { type: "CLEAR_INPUT" }
  | { type: "START_PASTE"; payload: { buffer: string; cursorPosition: number } }
  | { type: "APPEND_PASTE_BUFFER"; payload: string }
  | {
      type: "APPEND_PASTE_CHUNK";
      payload: { chunk: string; cursorPosition: number };
    }
  | { type: "END_PASTE" }
  | {
      type: "ADD_IMAGE_AND_INSERT_PLACEHOLDER";
      payload: { path: string; mimeType: string };
    }
  | { type: "SET_HISTORY_ENTRIES"; payload: PromptEntry[] }
  | { type: "NAVIGATE_HISTORY"; payload: "up" | "down" }
  | { type: "RESET_HISTORY_NAVIGATION" }
  | { type: "SELECT_HISTORY_ENTRY"; payload: PromptEntry }
  | { type: "SET_BTW_STATE"; payload: Partial<BtwState> }
  // New action types for handler logic in reducer
  | { type: "HANDLE_FILE_SELECT"; payload: { filePath: string } }
  | { type: "HANDLE_COMMAND_SELECT"; payload: { command: string } }
  | {
      type: "SUBMIT";
      payload: {
        attachedImages: Array<{ id: number; path: string; mimeType: string }>;
      };
    }
  | { type: "PASTE_INPUT"; payload: { input: string } }
  | {
      type: "HANDLE_KEY";
      payload: {
        input: string;
        key: Key;
        attachedImages: Array<{ id: number; path: string; mimeType: string }>;
      };
    }
  | { type: "CYCLE_PERMISSION" }
  | { type: "REQUEST_HISTORY_FETCH" }
  | { type: "HISTORY_FETCHED"; payload: PromptEntry[] }
  | { type: "REQUEST_PASTE_IMAGE" }
  | { type: "IMAGE_PASTED"; payload: { path: string; mimeType: string } | null }
  | { type: "REQUEST_ABORT" }
  | { type: "REQUEST_BACKGROUND_TASK" }
  | { type: "CLEAR_PENDING_SUBMIT" }
  | { type: "CLEAR_PENDING_COMMAND" }
  | { type: "CLEAR_PENDING_ABORT" }
  | { type: "CLEAR_PENDING_BACKGROUND_TASK" }
  | { type: "CLEAR_PENDING_SELECTOR_INSERT" }
  | { type: "CLEAR_PENDING_CYCLE_PERMISSION" };

// Helper to check if any selector/manager is active
const isSelectorOrManagerActive = (state: InputState): boolean => {
  return (
    state.showFileSelector ||
    state.showCommandSelector ||
    state.showHistorySearch ||
    state.showBackgroundTaskManager ||
    state.showMcpManager ||
    state.showRewindManager ||
    state.showHelp ||
    state.showStatusCommand ||
    state.showPluginManager ||
    state.showModelSelector ||
    state.btwState.isActive
  );
};

// Helper: check if a non-selector manager is active (absorbs all input)
const isNonSelectorManagerActive = (state: InputState): boolean => {
  return (
    state.showBackgroundTaskManager ||
    state.showMcpManager ||
    state.showRewindManager ||
    state.showHelp ||
    state.showStatusCommand ||
    state.showPluginManager ||
    state.showModelSelector ||
    state.btwState.isActive
  );
};

export function inputReducer(
  state: InputState,
  action: InputAction,
): InputState {
  switch (action.type) {
    case "SET_INPUT_TEXT":
      return {
        ...state,
        inputText: action.payload,
        historyIndex: -1,
      };
    case "SET_CURSOR_POSITION":
      return {
        ...state,
        cursorPosition: Math.max(
          0,
          Math.min(state.inputText.length, action.payload),
        ),
      };
    case "INSERT_TEXT": {
      const beforeCursor = state.inputText.substring(0, state.cursorPosition);
      const afterCursor = state.inputText.substring(state.cursorPosition);
      const newText = beforeCursor + action.payload + afterCursor;
      const newCursorPosition = state.cursorPosition + action.payload.length;
      return {
        ...state,
        inputText: newText,
        cursorPosition: newCursorPosition,
        historyIndex: -1,
      };
    }
    case "DELETE_CHAR": {
      if (state.cursorPosition > 0) {
        const beforeCursor = state.inputText.substring(
          0,
          state.cursorPosition - 1,
        );
        const afterCursor = state.inputText.substring(state.cursorPosition);
        const newText = beforeCursor + afterCursor;
        const newCursorPosition = state.cursorPosition - 1;
        return {
          ...state,
          inputText: newText,
          cursorPosition: newCursorPosition,
          historyIndex: -1,
        };
      }
      return state;
    }
    case "MOVE_CURSOR": {
      const newCursorPosition = Math.max(
        0,
        Math.min(state.inputText.length, state.cursorPosition + action.payload),
      );
      return { ...state, cursorPosition: newCursorPosition };
    }
    case "ACTIVATE_FILE_SELECTOR":
      return {
        ...state,
        showFileSelector: true,
        atPosition: action.payload,
        fileSearchQuery: "",
        filteredFiles: [],
        isFileSearching: true,
      };
    case "SET_FILE_SEARCH_QUERY":
      return {
        ...state,
        fileSearchQuery: action.payload,
        isFileSearching: true,
      };
    case "SET_FILTERED_FILES":
      return {
        ...state,
        filteredFiles: action.payload,
        isFileSearching: false,
      };
    case "CANCEL_FILE_SELECTOR":
      return {
        ...state,
        showFileSelector: false,
        atPosition: -1,
        fileSearchQuery: "",
        filteredFiles: [],
        selectorJustUsed: true,
        isFileSearching: false,
      };
    case "ACTIVATE_COMMAND_SELECTOR":
      return {
        ...state,
        showCommandSelector: true,
        slashPosition: action.payload,
        commandSearchQuery: "",
      };
    case "SET_COMMAND_SEARCH_QUERY":
      return { ...state, commandSearchQuery: action.payload };
    case "CANCEL_COMMAND_SELECTOR":
      return {
        ...state,
        showCommandSelector: false,
        slashPosition: -1,
        commandSearchQuery: "",
        selectorJustUsed: true,
      };
    case "ACTIVATE_HISTORY_SEARCH":
      return {
        ...state,
        showHistorySearch: true,
        historySearchQuery: "",
      };
    case "SET_HISTORY_SEARCH_QUERY":
      return { ...state, historySearchQuery: action.payload };
    case "CANCEL_HISTORY_SEARCH":
      return {
        ...state,
        showHistorySearch: false,
        historySearchQuery: "",
        selectorJustUsed: true,
      };
    case "ADD_IMAGE": {
      const newImage: AttachedImage = {
        id: state.imageIdCounter,
        path: action.payload.path,
        mimeType: action.payload.mimeType,
      };
      return {
        ...state,
        attachedImages: [...state.attachedImages, newImage],
        imageIdCounter: state.imageIdCounter + 1,
      };
    }
    case "REMOVE_IMAGE":
      return {
        ...state,
        attachedImages: state.attachedImages.filter(
          (img) => img.id !== action.payload,
        ),
      };
    case "CLEAR_IMAGES":
      return { ...state, attachedImages: [] };
    case "SET_SHOW_BACKGROUND_TASK_MANAGER":
      return {
        ...state,
        showBackgroundTaskManager: action.payload,
        selectorJustUsed: !action.payload ? true : state.selectorJustUsed,
      };
    case "SET_SHOW_MCP_MANAGER":
      return {
        ...state,
        showMcpManager: action.payload,
        selectorJustUsed: !action.payload ? true : state.selectorJustUsed,
      };
    case "SET_SHOW_REWIND_MANAGER":
      return {
        ...state,
        showRewindManager: action.payload,
        selectorJustUsed: !action.payload ? true : state.selectorJustUsed,
      };
    case "SET_SHOW_HELP":
      return {
        ...state,
        showHelp: action.payload,
        selectorJustUsed: !action.payload ? true : state.selectorJustUsed,
      };
    case "SET_SHOW_STATUS_COMMAND":
      return {
        ...state,
        showStatusCommand: action.payload,
        selectorJustUsed: !action.payload ? true : state.selectorJustUsed,
      };
    case "SET_SHOW_PLUGIN_MANAGER":
      return {
        ...state,
        showPluginManager: action.payload,
        selectorJustUsed: !action.payload ? true : state.selectorJustUsed,
      };
    case "SET_SHOW_MODEL_SELECTOR":
      return {
        ...state,
        showModelSelector: action.payload,
        selectorJustUsed: !action.payload ? true : state.selectorJustUsed,
      };
    case "SET_PERMISSION_MODE":
      return { ...state, permissionMode: action.payload };
    case "SET_SELECTOR_JUST_USED":
      return { ...state, selectorJustUsed: action.payload };
    case "INSERT_TEXT_WITH_PLACEHOLDER": {
      let textToInsert = action.payload;
      let newLongTextCounter = state.longTextCounter;
      const newLongTextMap = { ...state.longTextMap };

      if (textToInsert.length > 200) {
        newLongTextCounter += 1;
        const placeholderLabel = `[LongText#${newLongTextCounter}]`;
        newLongTextMap[placeholderLabel] = textToInsert;
        textToInsert = placeholderLabel;
      }

      const beforeCursor = state.inputText.substring(0, state.cursorPosition);
      const afterCursor = state.inputText.substring(state.cursorPosition);
      const newText = beforeCursor + textToInsert + afterCursor;
      const newCursorPosition = state.cursorPosition + textToInsert.length;

      return {
        ...state,
        inputText: newText,
        cursorPosition: newCursorPosition,
        longTextCounter: newLongTextCounter,
        longTextMap: newLongTextMap,
        historyIndex: -1,
      };
    }
    case "CLEAR_LONG_TEXT_MAP":
      return { ...state, longTextMap: {} };
    case "CLEAR_INPUT":
      return {
        ...state,
        inputText: "",
        cursorPosition: 0,
        historyIndex: -1,
      };
    case "APPEND_PASTE_CHUNK": {
      const isNewPaste = !state.pasteBuffer;
      return {
        ...state,
        isPasting: true,
        pasteBuffer: state.pasteBuffer + action.payload.chunk,
        initialPasteCursorPosition: isNewPaste
          ? action.payload.cursorPosition
          : state.initialPasteCursorPosition,
      };
    }
    case "START_PASTE":
      return {
        ...state,
        isPasting: true,
        pasteBuffer: action.payload.buffer,
        initialPasteCursorPosition: action.payload.cursorPosition,
      };
    case "APPEND_PASTE_BUFFER":
      return {
        ...state,
        pasteBuffer: state.pasteBuffer + action.payload,
      };
    case "END_PASTE":
      return {
        ...state,
        isPasting: false,
        pasteBuffer: "",
      };
    case "ADD_IMAGE_AND_INSERT_PLACEHOLDER": {
      const newImage: AttachedImage = {
        id: state.imageIdCounter,
        path: action.payload.path,
        mimeType: action.payload.mimeType,
      };
      const placeholder = `[Image #${newImage.id}]`;
      const beforeCursor = state.inputText.substring(0, state.cursorPosition);
      const afterCursor = state.inputText.substring(state.cursorPosition);
      const newText = beforeCursor + placeholder + afterCursor;
      const newCursorPosition = state.cursorPosition + placeholder.length;
      return {
        ...state,
        attachedImages: [...state.attachedImages, newImage],
        imageIdCounter: state.imageIdCounter + 1,
        inputText: newText,
        cursorPosition: newCursorPosition,
        historyIndex: -1,
      };
    }
    case "SET_HISTORY_ENTRIES":
      return { ...state, history: action.payload };
    case "NAVIGATE_HISTORY": {
      const direction = action.payload;
      let newIndex = state.historyIndex;
      let newOriginalInputText = state.originalInputText;
      let newOriginalLongTextMap = state.originalLongTextMap;

      if (direction === "up") {
        if (newIndex === -1) {
          newOriginalInputText = state.inputText;
          newOriginalLongTextMap = state.longTextMap;
        }
        newIndex = Math.min(state.history.length - 1, newIndex + 1);
      } else {
        if (newIndex === -1) {
          return state;
        }
        newIndex = Math.max(-1, newIndex - 1);
      }

      if (newIndex === -1) {
        return {
          ...state,
          historyIndex: newIndex,
          inputText: newOriginalInputText,
          longTextMap: newOriginalLongTextMap,
          cursorPosition: newOriginalInputText.length,
          originalInputText: "",
          originalLongTextMap: {},
        };
      } else {
        const entry = state.history[newIndex];
        return {
          ...state,
          historyIndex: newIndex,
          inputText: entry.prompt,
          longTextMap: entry.longTextMap || {},
          cursorPosition: entry.prompt.length,
          originalInputText: newOriginalInputText,
          originalLongTextMap: newOriginalLongTextMap,
        };
      }
    }
    case "SELECT_HISTORY_ENTRY": {
      const entry = action.payload;
      return {
        ...state,
        inputText: entry.prompt,
        longTextMap: entry.longTextMap || {},
        cursorPosition: entry.prompt.length,
        historyIndex: -1,
        history: [],
        originalInputText: "",
        originalLongTextMap: {},
        showHistorySearch: false,
        historySearchQuery: "",
        selectorJustUsed: true,
      };
    }
    case "RESET_HISTORY_NAVIGATION":
      return {
        ...state,
        historyIndex: -1,
        history: [],
        originalInputText: "",
        originalLongTextMap: {},
      };
    case "SET_BTW_STATE":
      return {
        ...state,
        btwState: {
          ...state.btwState,
          ...action.payload,
        },
      };

    // --- New handler logic in reducer ---

    case "HANDLE_FILE_SELECT": {
      const filePath = action.payload.filePath;
      if (state.atPosition >= 0) {
        const wordEnd = getWordEnd(state.inputText, state.atPosition);
        const beforeAt = state.inputText.substring(0, state.atPosition);
        const afterWord = state.inputText.substring(wordEnd);
        const newInput = beforeAt + `@${filePath} ` + afterWord;
        const newCursorPosition = beforeAt.length + filePath.length + 2;
        return {
          ...state,
          inputText: newInput,
          cursorPosition: newCursorPosition,
          showFileSelector: false,
          atPosition: -1,
          fileSearchQuery: "",
          filteredFiles: [],
          selectorJustUsed: true,
          isFileSearching: false,
        };
      }
      return state;
    }

    case "HANDLE_COMMAND_SELECT": {
      const command = action.payload.command;
      if (state.slashPosition >= 0) {
        const wordEnd = getWordEnd(state.inputText, state.slashPosition);
        const beforeSlash = state.inputText.substring(0, state.slashPosition);
        const afterWord = state.inputText.substring(wordEnd);
        const newInput = beforeSlash + afterWord;
        const newCursorPosition = beforeSlash.length;

        // Set pendingCommand for async execution by useEffect
        return {
          ...state,
          inputText: newInput,
          cursorPosition: newCursorPosition,
          showCommandSelector: false,
          slashPosition: -1,
          commandSearchQuery: "",
          selectorJustUsed: true,
          pendingCommand: { command, newInput, newCursorPosition },
        };
      }
      return state;
    }

    case "SUBMIT": {
      const { attachedImages } = action.payload;
      const trimmedInput = state.inputText.trim();
      if (!trimmedInput) {
        return state;
      }

      // Handle /btw command
      if (trimmedInput === "/btw" || trimmedInput.startsWith("/btw ")) {
        const question = trimmedInput.startsWith("/btw ")
          ? trimmedInput.substring(5).trim()
          : "";
        return {
          ...state,
          btwState: {
            isActive: true,
            question,
            isLoading: question !== "",
          },
          inputText: "",
          cursorPosition: 0,
          historyIndex: -1,
          history: [],
          longTextMap: {},
        };
      }

      // Prepare images for submission
      const imageRegex = /\[Image #(\d+)\]/g;
      const matches = [...state.inputText.matchAll(imageRegex)];
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

      return {
        ...state,
        pendingSubmit: {
          content: contentWithPlaceholders,
          images: referencedImages.length > 0 ? referencedImages : undefined,
          longTextMap: state.longTextMap,
        },
        inputText: "",
        cursorPosition: 0,
        historyIndex: -1,
        history: [],
        longTextMap: {},
      };
    }

    case "PASTE_INPUT": {
      const inputString = action.payload.input;
      const isPasteOperation =
        inputString.length > 1 ||
        inputString.includes("\n") ||
        inputString.includes("\r");

      if (isPasteOperation) {
        return {
          ...state,
          isPasting: true,
          pasteBuffer: state.pasteBuffer + inputString,
          initialPasteCursorPosition: !state.pasteBuffer
            ? state.cursorPosition
            : state.initialPasteCursorPosition,
        };
      } else {
        let char = inputString;
        if (char === "！" && state.cursorPosition === 0) {
          char = "!";
        }

        const beforeCursor = state.inputText.substring(0, state.cursorPosition);
        const afterCursor = state.inputText.substring(state.cursorPosition);
        const newInputText = beforeCursor + char + afterCursor;
        const newCursorPosition = state.cursorPosition + char.length;

        return {
          ...state,
          inputText: newInputText,
          cursorPosition: newCursorPosition,
          historyIndex: -1,
          pendingSelectorInsert: char,
        };
      }
    }

    case "HANDLE_KEY": {
      const { input, key, attachedImages } = action.payload;

      if (state.selectorJustUsed) {
        return state;
      }

      // Handle btwState
      if (state.btwState.isActive) {
        if (key.escape) {
          return {
            ...state,
            btwState: {
              isActive: false,
              question: "",
              answer: undefined,
              isLoading: false,
            },
          };
        }
        if (key.return) {
          if (state.inputText.trim() && !state.btwState.isLoading) {
            return {
              ...state,
              btwState: {
                isActive: true,
                question: state.inputText.trim(),
                isLoading: true,
                answer: undefined,
              },
              inputText: "",
              cursorPosition: 0,
            };
          }
          return state;
        }
        // Fall through to normal input handling for btw question typing
        return handleNormalInputKey(state, input, key, attachedImages);
      }

      // ESC key - abort or close managers
      if (key.escape) {
        if (!isSelectorOrManagerActive(state)) {
          return { ...state, pendingAbort: true };
        }
      }

      // Shift+Tab - cycle permission
      if (key.tab && key.shift) {
        return { ...state, pendingCyclePermission: true };
      }

      // Non-selector managers absorb all input
      if (isNonSelectorManagerActive(state)) {
        return state;
      }

      // History search handling
      if (state.showHistorySearch) {
        if (key.escape) {
          return {
            ...state,
            showHistorySearch: false,
            historySearchQuery: "",
            selectorJustUsed: true,
          };
        }
        if (key.backspace || key.delete) {
          if (state.historySearchQuery.length > 0) {
            return {
              ...state,
              historySearchQuery: state.historySearchQuery.slice(0, -1),
            };
          }
          return state;
        }
        if (input && !key.ctrl && !key.meta && !key.return && !key.tab) {
          return {
            ...state,
            historySearchQuery: state.historySearchQuery + input,
          };
        }
        return state;
      }

      // Selector handling
      if (state.showFileSelector || state.showCommandSelector) {
        return handleSelectorInputKey(state, input, key);
      }

      // Normal input handling
      return handleNormalInputKey(state, input, key, attachedImages);
    }

    case "CYCLE_PERMISSION": {
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
      return {
        ...state,
        permissionMode: nextMode,
        pendingCyclePermission: false,
      };
    }

    case "REQUEST_HISTORY_FETCH":
      return { ...state, pendingHistoryFetch: true };

    case "HISTORY_FETCHED":
      return { ...state, history: action.payload, pendingHistoryFetch: false };

    case "REQUEST_PASTE_IMAGE":
      return { ...state, pendingPasteImage: true };

    case "IMAGE_PASTED": {
      const imageData = action.payload;
      if (imageData) {
        const newImage: AttachedImage = {
          id: state.imageIdCounter,
          path: imageData.path,
          mimeType: imageData.mimeType,
        };
        const placeholder = `[Image #${newImage.id}]`;
        const beforeCursor = state.inputText.substring(0, state.cursorPosition);
        const afterCursor = state.inputText.substring(state.cursorPosition);
        const newText = beforeCursor + placeholder + afterCursor;
        const newCursorPosition = state.cursorPosition + placeholder.length;
        return {
          ...state,
          attachedImages: [...state.attachedImages, newImage],
          imageIdCounter: state.imageIdCounter + 1,
          inputText: newText,
          cursorPosition: newCursorPosition,
          historyIndex: -1,
          pendingPasteImage: false,
        };
      }
      return { ...state, pendingPasteImage: false };
    }

    case "REQUEST_ABORT":
      return { ...state, pendingAbort: true };

    case "REQUEST_BACKGROUND_TASK":
      return { ...state, pendingBackgroundTask: true };

    case "CLEAR_PENDING_SUBMIT":
      return { ...state, pendingSubmit: null };

    case "CLEAR_PENDING_COMMAND":
      return { ...state, pendingCommand: null };

    case "CLEAR_PENDING_ABORT":
      return { ...state, pendingAbort: false };

    case "CLEAR_PENDING_BACKGROUND_TASK":
      return { ...state, pendingBackgroundTask: false };

    case "CLEAR_PENDING_SELECTOR_INSERT":
      return { ...state, pendingSelectorInsert: null };

    case "CLEAR_PENDING_CYCLE_PERMISSION":
      return { ...state, pendingCyclePermission: false };

    default:
      return state;
  }
}

// Helper: handle input when a selector (file/command) is active
function handleSelectorInputKey(
  state: InputState,
  input: string,
  key: Key,
): InputState {
  if (key.escape) {
    if (state.showFileSelector) {
      return {
        ...state,
        showFileSelector: false,
        atPosition: -1,
        fileSearchQuery: "",
        filteredFiles: [],
        selectorJustUsed: true,
        isFileSearching: false,
      };
    } else if (state.showCommandSelector) {
      return {
        ...state,
        showCommandSelector: false,
        slashPosition: -1,
        commandSearchQuery: "",
        selectorJustUsed: true,
      };
    }
    return state;
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

      let nextState = {
        ...state,
        inputText: newInputText,
        cursorPosition: newCursorPosition,
        historyIndex: -1,
      };

      // Check for special character deletion
      if (
        nextState.showFileSelector &&
        newCursorPosition <= nextState.atPosition
      ) {
        return {
          ...nextState,
          showFileSelector: false,
          atPosition: -1,
          fileSearchQuery: "",
          filteredFiles: [],
          selectorJustUsed: true,
          isFileSearching: false,
        };
      }
      if (
        nextState.showCommandSelector &&
        newCursorPosition <= nextState.slashPosition
      ) {
        return {
          ...nextState,
          showCommandSelector: false,
          slashPosition: -1,
          commandSearchQuery: "",
          selectorJustUsed: true,
        };
      }

      // Update search queries and potentially reactivate selectors
      const atPos = getAtSelectorPosition(newInputText, newCursorPosition);
      let showFileSelector = nextState.showFileSelector;
      let atPosition = nextState.atPosition;
      if (atPos !== -1 && !nextState.showFileSelector) {
        nextState = {
          ...nextState,
          showFileSelector: true,
          atPosition: atPos,
          fileSearchQuery: "",
          filteredFiles: [],
          isFileSearching: true,
        };
        showFileSelector = true;
        atPosition = atPos;
      }

      const slashPos = getSlashSelectorPosition(
        newInputText,
        newCursorPosition,
      );
      let showCommandSelector = nextState.showCommandSelector;
      let slashPosition = nextState.slashPosition;
      if (slashPos !== -1 && !nextState.showCommandSelector) {
        nextState = {
          ...nextState,
          showCommandSelector: true,
          slashPosition: slashPos,
          commandSearchQuery: "",
        };
        showCommandSelector = true;
        slashPosition = slashPos;
      }

      // Update search queries
      if (showFileSelector && atPosition >= 0) {
        const queryStart = atPosition + 1;
        const queryEnd = newCursorPosition;
        const newQuery = newInputText.substring(queryStart, queryEnd);
        nextState = {
          ...nextState,
          fileSearchQuery: newQuery,
          isFileSearching: true,
        };
      } else if (showCommandSelector && slashPosition >= 0) {
        const queryStart = slashPosition + 1;
        const queryEnd = newCursorPosition;
        const newQuery = newInputText.substring(queryStart, queryEnd);
        nextState = { ...nextState, commandSearchQuery: newQuery };
      }

      return nextState;
    }
    return state;
  }

  if (key.upArrow || key.downArrow || key.return || key.tab) {
    return state;
  }

  if (key.leftArrow) {
    const newCursorPosition = state.cursorPosition - 1;
    const nextState = { ...state, cursorPosition: newCursorPosition };
    if (
      nextState.showFileSelector &&
      newCursorPosition <= nextState.atPosition
    ) {
      return {
        ...nextState,
        showFileSelector: false,
        atPosition: -1,
        fileSearchQuery: "",
        filteredFiles: [],
        selectorJustUsed: true,
        isFileSearching: false,
      };
    }
    if (
      nextState.showCommandSelector &&
      newCursorPosition <= nextState.slashPosition
    ) {
      return {
        ...nextState,
        showCommandSelector: false,
        slashPosition: -1,
        commandSearchQuery: "",
        selectorJustUsed: true,
      };
    }
    return nextState;
  }

  if (key.rightArrow) {
    return { ...state, cursorPosition: state.cursorPosition + 1 };
  }

  if (input === " ") {
    if (state.showFileSelector) {
      return {
        ...state,
        showFileSelector: false,
        atPosition: -1,
        fileSearchQuery: "",
        filteredFiles: [],
        selectorJustUsed: true,
        isFileSearching: false,
      };
    } else if (state.showCommandSelector) {
      return {
        ...state,
        showCommandSelector: false,
        slashPosition: -1,
        commandSearchQuery: "",
        selectorJustUsed: true,
      };
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
    const beforeCursor = state.inputText.substring(0, state.cursorPosition);
    const afterCursor = state.inputText.substring(state.cursorPosition);
    const newInputText = beforeCursor + input + afterCursor;
    const newCursorPosition = state.cursorPosition + input.length;

    return {
      ...state,
      inputText: newInputText,
      cursorPosition: newCursorPosition,
      historyIndex: -1,
      pendingSelectorInsert: input,
    };
  }

  return state;
}

// Helper: handle normal input (no active selectors/managers)
function handleNormalInputKey(
  state: InputState,
  input: string,
  key: Key,
  attachedImages: Array<{ id: number; path: string; mimeType: string }>,
): InputState {
  if (key.return) {
    const trimmedInput = state.inputText.trim();
    if (!trimmedInput) {
      return state;
    }

    // Handle /btw
    if (trimmedInput === "/btw" || trimmedInput.startsWith("/btw ")) {
      const question = trimmedInput.startsWith("/btw ")
        ? trimmedInput.substring(5).trim()
        : "";
      return {
        ...state,
        btwState: {
          isActive: true,
          question,
          isLoading: question !== "",
        },
        inputText: "",
        cursorPosition: 0,
        historyIndex: -1,
        history: [],
        longTextMap: {},
      };
    }

    // Prepare submit
    const imageRegex = /\[Image #(\d+)\]/g;
    const matches = [...state.inputText.matchAll(imageRegex)];
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

    return {
      ...state,
      pendingSubmit: {
        content: contentWithPlaceholders,
        images: referencedImages.length > 0 ? referencedImages : undefined,
        longTextMap: state.longTextMap,
      },
      inputText: "",
      cursorPosition: 0,
      historyIndex: -1,
      history: [],
      longTextMap: {},
    };
  }

  if (key.escape) {
    if (state.showFileSelector) {
      return {
        ...state,
        showFileSelector: false,
        atPosition: -1,
        fileSearchQuery: "",
        filteredFiles: [],
        selectorJustUsed: true,
        isFileSearching: false,
      };
    } else if (state.showCommandSelector) {
      return {
        ...state,
        showCommandSelector: false,
        slashPosition: -1,
        commandSearchQuery: "",
        selectorJustUsed: true,
      };
    } else if (state.historyIndex !== -1) {
      return {
        ...state,
        historyIndex: -1,
        history: [],
        originalInputText: "",
        originalLongTextMap: {},
      };
    }
    return state;
  }

  if (key.upArrow) {
    if (state.history.length === 0) {
      // Need to fetch history - set pending flag
      return { ...state, pendingHistoryFetch: true };
    }
    // Navigate history (up)
    if (state.historyIndex === -1) {
      return {
        ...state,
        historyIndex: 0,
        originalInputText: state.inputText,
        originalLongTextMap: state.longTextMap,
        inputText: state.history[0].prompt,
        longTextMap: state.history[0].longTextMap || {},
        cursorPosition: state.history[0].prompt.length,
      };
    }
    const newIndex = Math.min(state.history.length - 1, state.historyIndex + 1);
    return {
      ...state,
      historyIndex: newIndex,
      inputText: state.history[newIndex].prompt,
      longTextMap: state.history[newIndex].longTextMap || {},
      cursorPosition: state.history[newIndex].prompt.length,
    };
  }

  if (key.downArrow) {
    if (state.historyIndex === -1) {
      return state;
    }
    const newIndex = state.historyIndex - 1;
    if (newIndex === -1) {
      return {
        ...state,
        historyIndex: -1,
        inputText: state.originalInputText,
        longTextMap: state.originalLongTextMap,
        cursorPosition: state.originalInputText.length,
        originalInputText: "",
        originalLongTextMap: {},
      };
    }
    return {
      ...state,
      historyIndex: newIndex,
      inputText: state.history[newIndex].prompt,
      longTextMap: state.history[newIndex].longTextMap || {},
      cursorPosition: state.history[newIndex].prompt.length,
    };
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

      let nextState: InputState = {
        ...state,
        inputText: newInputText,
        cursorPosition: newCursorPosition,
        historyIndex: -1,
      };

      // Check for special character deletion
      if (
        nextState.showFileSelector &&
        newCursorPosition <= nextState.atPosition
      ) {
        nextState = {
          ...nextState,
          showFileSelector: false,
          atPosition: -1,
          fileSearchQuery: "",
          filteredFiles: [],
          selectorJustUsed: true,
          isFileSearching: false,
        };
      }
      if (
        nextState.showCommandSelector &&
        newCursorPosition <= nextState.slashPosition
      ) {
        nextState = {
          ...nextState,
          showCommandSelector: false,
          slashPosition: -1,
          commandSearchQuery: "",
          selectorJustUsed: true,
        };
      }

      // Reactivate file selector if cursor is now within an @word
      const atPos = getAtSelectorPosition(newInputText, newCursorPosition);
      let showFileSelector = nextState.showFileSelector;
      let atPosition = nextState.atPosition;
      if (atPos !== -1 && !nextState.showFileSelector) {
        nextState = {
          ...nextState,
          showFileSelector: true,
          atPosition: atPos,
          fileSearchQuery: "",
          filteredFiles: [],
          isFileSearching: true,
        };
        showFileSelector = true;
        atPosition = atPos;
      }

      const slashPos = getSlashSelectorPosition(
        newInputText,
        newCursorPosition,
      );
      let showCommandSelector = nextState.showCommandSelector;
      let slashPosition = nextState.slashPosition;
      if (slashPos !== -1 && !nextState.showCommandSelector) {
        nextState = {
          ...nextState,
          showCommandSelector: true,
          slashPosition: slashPos,
          commandSearchQuery: "",
        };
        showCommandSelector = true;
        slashPosition = slashPos;
      }

      // Update search queries
      if (showFileSelector && atPosition >= 0) {
        const queryStart = atPosition + 1;
        const queryEnd = newCursorPosition;
        const newQuery = newInputText.substring(queryStart, queryEnd);
        nextState = {
          ...nextState,
          fileSearchQuery: newQuery,
          isFileSearching: true,
        };
      } else if (showCommandSelector && slashPosition >= 0) {
        const queryStart = slashPosition + 1;
        const queryEnd = newCursorPosition;
        const newQuery = newInputText.substring(queryStart, queryEnd);
        nextState = { ...nextState, commandSearchQuery: newQuery };
      }

      return nextState;
    }
    return state;
  }

  if (key.leftArrow) {
    return { ...state, cursorPosition: Math.max(0, state.cursorPosition - 1) };
  }

  if (key.rightArrow) {
    return {
      ...state,
      cursorPosition: Math.min(
        state.inputText.length,
        state.cursorPosition + 1,
      ),
    };
  }

  if (key.ctrl && input === "v") {
    return { ...state, pendingPasteImage: true };
  }

  if (key.ctrl && input === "r") {
    return { ...state, showHistorySearch: true, historySearchQuery: "" };
  }

  if (key.ctrl && input === "b") {
    return { ...state, pendingBackgroundTask: true };
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
    // Detect paste operation (multi-char or contains newlines)
    const isPasteOperation =
      input.length > 1 || input.includes("\n") || input.includes("\r");

    if (isPasteOperation) {
      const isNewPaste = !state.pasteBuffer;
      return {
        ...state,
        isPasting: true,
        pasteBuffer: state.pasteBuffer + input,
        initialPasteCursorPosition: isNewPaste
          ? state.cursorPosition
          : state.initialPasteCursorPosition,
      };
    }

    // Single character insertion
    const beforeCursor = state.inputText.substring(0, state.cursorPosition);
    const afterCursor = state.inputText.substring(state.cursorPosition);
    const newInputText = beforeCursor + input + afterCursor;
    const newCursorPosition = state.cursorPosition + input.length;

    return {
      ...state,
      inputText: newInputText,
      cursorPosition: newCursorPosition,
      historyIndex: -1,
      pendingSelectorInsert: input,
    };
  }

  return state;
}
