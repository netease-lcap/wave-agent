import {
  FileItem,
  PermissionMode,
  Logger,
  PromptEntry,
  Message,
} from "wave-agent-sdk";

export interface AttachedImage {
  id: number;
  path: string;
  mimeType: string;
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
};

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
  | { type: "SET_PERMISSION_MODE"; payload: PermissionMode }
  | { type: "SET_SELECTOR_JUST_USED"; payload: boolean }
  | { type: "INSERT_TEXT_WITH_PLACEHOLDER"; payload: string }
  | { type: "CLEAR_LONG_TEXT_MAP" }
  | { type: "CLEAR_INPUT" }
  | { type: "START_PASTE"; payload: { buffer: string; cursorPosition: number } }
  | { type: "APPEND_PASTE_BUFFER"; payload: string }
  | { type: "END_PASTE" }
  | {
      type: "ADD_IMAGE_AND_INSERT_PLACEHOLDER";
      payload: { path: string; mimeType: string };
    }
  | { type: "SET_HISTORY_ENTRIES"; payload: PromptEntry[] }
  | { type: "NAVIGATE_HISTORY"; payload: "up" | "down" }
  | { type: "RESET_HISTORY_NAVIGATION" }
  | { type: "SELECT_HISTORY_ENTRY"; payload: PromptEntry };

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
    default:
      return state;
  }
}
