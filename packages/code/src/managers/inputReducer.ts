import {
  FileItem,
  PermissionMode,
  Logger,
  PromptEntry,
  Message,
} from "wave-agent-sdk";
import { Key } from "ink";
import {
  getAtSelectorPosition,
  getSlashSelectorPosition,
  getWordEnd,
  SELECTOR_TRIGGERS,
  getProjectedState,
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

export type PendingEffect =
  | {
      type: "SEND_MESSAGE";
      content: string;
      images?: Array<{ path: string; mimeType: string }>;
      longTextMap: Record<string, string>;
    }
  | { type: "ABORT_MESSAGE" }
  | { type: "BACKGROUND_CURRENT_TASK" }
  | { type: "ASK_BTW"; question: string }
  | { type: "PERMISSION_MODE_CHANGE"; mode: PermissionMode }
  | { type: "FETCH_HISTORY" }
  | { type: "PASTE_IMAGE" }
  | { type: "EXECUTE_COMMAND"; command: string };

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
  pendingEffect: PendingEffect | null;
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
  pendingEffect: null,
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
  | { type: "SELECT_COMMAND"; payload: string }
  | { type: "INSERT_COMMAND"; payload: string }
  | { type: "SELECT_FILE"; payload: string }
  | { type: "SET_BTW_STATE"; payload: Partial<BtwState> }
  | { type: "CLEAR_PENDING_EFFECT" }
  | {
      type: "HANDLE_KEY";
      payload: {
        input: string;
        key: Key;
        hasSlashCommand: (cmd: string) => boolean;
      };
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

      const newState: InputState = {
        ...state,
        inputText: newText,
        cursorPosition: newCursorPosition,
        longTextCounter: newLongTextCounter,
        longTextMap: newLongTextMap,
        historyIndex: -1,
      };

      // Sync selectors
      const atPos = getAtSelectorPosition(newText, newCursorPosition);
      if (atPos !== -1 && !newState.showFileSelector) {
        newState.showFileSelector = true;
        newState.atPosition = atPos;
        newState.isFileSearching = true;
      }

      const slashPos = getSlashSelectorPosition(newText, newCursorPosition);
      if (slashPos !== -1 && !newState.showCommandSelector) {
        newState.showCommandSelector = true;
        newState.slashPosition = slashPos;
      }

      if (newState.showFileSelector && newState.atPosition >= 0) {
        newState.fileSearchQuery = newText.substring(
          newState.atPosition + 1,
          newCursorPosition,
        );
      } else if (newState.showCommandSelector && newState.slashPosition >= 0) {
        newState.commandSearchQuery = newText.substring(
          newState.slashPosition + 1,
          newCursorPosition,
        );
      }

      return newState;
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
      // The reducer determines if this is a new paste or a continuation
      // by checking if pasteBuffer is already set. This avoids the
      // handler needing to track isPasting state, which can be stale
      // when multiple dispatches fire before React state updates.
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
    case "SELECT_COMMAND": {
      const command = action.payload;
      if (state.slashPosition >= 0) {
        const wordEnd = getWordEnd(state.inputText, state.slashPosition);
        const beforeSlash = state.inputText.substring(0, state.slashPosition);
        const afterWord = state.inputText.substring(wordEnd);
        const newInput = beforeSlash + afterWord;
        const newCursorPosition = beforeSlash.length;

        return {
          ...state,
          inputText: newInput,
          cursorPosition: newCursorPosition,
          showCommandSelector: false,
          slashPosition: -1,
          commandSearchQuery: "",
          selectorJustUsed: true,
          pendingEffect: { type: "EXECUTE_COMMAND", command },
        };
      }
      return state;
    }
    case "INSERT_COMMAND": {
      const command = action.payload;
      if (state.slashPosition >= 0) {
        const wordEnd = getWordEnd(state.inputText, state.slashPosition);
        const beforeSlash = state.inputText.substring(0, state.slashPosition);
        const afterWord = state.inputText.substring(wordEnd);
        const newInput = beforeSlash + `/${command} ` + afterWord;
        const newCursorPosition = beforeSlash.length + command.length + 2;

        return {
          ...state,
          inputText: newInput,
          cursorPosition: newCursorPosition,
          showCommandSelector: false,
          slashPosition: -1,
          commandSearchQuery: "",
          selectorJustUsed: true,
        };
      }
      return state;
    }
    case "SELECT_FILE": {
      const filePath = action.payload;
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
    case "RESET_HISTORY_NAVIGATION":
      return {
        ...state,
        historyIndex: -1,
        history: [],
        originalInputText: "",
        originalLongTextMap: {},
      };
    case "CLEAR_PENDING_EFFECT":
      return { ...state, pendingEffect: null };
    case "HANDLE_KEY": {
      const { input, key } = action.payload;

      if (state.selectorJustUsed) {
        return state;
      }

      // 1. BTW State Handling
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
          const question = state.inputText.trim();
          if (question && !state.btwState.isLoading) {
            return {
              ...state,
              inputText: "",
              cursorPosition: 0,
              btwState: {
                ...state.btwState,
                question,
                isLoading: true,
                answer: undefined,
              },
              pendingEffect: { type: "ASK_BTW", question },
            };
          }
          return state;
        }
      }

      // 2. Escape Handling
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
        }
        if (state.showCommandSelector) {
          return {
            ...state,
            showCommandSelector: false,
            slashPosition: -1,
            commandSearchQuery: "",
            selectorJustUsed: true,
          };
        }
        if (state.showHistorySearch) {
          return {
            ...state,
            showHistorySearch: false,
            historySearchQuery: "",
            selectorJustUsed: true,
          };
        }
        if (state.historyIndex !== -1) {
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
        if (
          !(
            state.showBackgroundTaskManager ||
            state.showMcpManager ||
            state.showRewindManager ||
            state.showHelp ||
            state.showStatusCommand ||
            state.showPluginManager ||
            state.showModelSelector
          )
        ) {
          return { ...state, pendingEffect: { type: "ABORT_MESSAGE" } };
        }
        return state;
      }

      // 3. Special Shortcuts
      if (key.tab && key.shift) {
        const modes: PermissionMode[] = [
          "default",
          "acceptEdits",
          "bypassPermissions",
          "plan",
        ];
        const currentIndex = modes.indexOf(state.permissionMode);
        const nextIndex =
          currentIndex === -1 ? 0 : (currentIndex + 1) % modes.length;
        const nextMode = modes[nextIndex];
        return {
          ...state,
          permissionMode: nextMode,
          pendingEffect: { type: "PERMISSION_MODE_CHANGE", mode: nextMode },
        };
      }

      if (key.ctrl && input === "v") {
        return { ...state, pendingEffect: { type: "PASTE_IMAGE" } };
      }

      if (key.ctrl && input === "r") {
        return {
          ...state,
          showHistorySearch: true,
          historySearchQuery: "",
        };
      }

      if (key.ctrl && input === "b") {
        return {
          ...state,
          pendingEffect: { type: "BACKGROUND_CURRENT_TASK" },
        };
      }

      // 4. History Navigation
      if (
        key.upArrow &&
        !state.showFileSelector &&
        !state.showCommandSelector
      ) {
        if (state.history.length === 0) {
          return { ...state, pendingEffect: { type: "FETCH_HISTORY" } };
        }
        // If history is already loaded, NAVIGATE_HISTORY logic follows
        let newIndex = state.historyIndex;
        let newOriginalInputText = state.originalInputText;
        let newOriginalLongTextMap = state.originalLongTextMap;

        if (newIndex === -1) {
          newOriginalInputText = state.inputText;
          newOriginalLongTextMap = state.longTextMap;
        }
        newIndex = Math.min(state.history.length - 1, newIndex + 1);
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

      if (
        key.downArrow &&
        !state.showFileSelector &&
        !state.showCommandSelector
      ) {
        if (state.historyIndex === -1) return state;
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
        } else {
          const entry = state.history[newIndex];
          return {
            ...state,
            historyIndex: newIndex,
            inputText: entry.prompt,
            longTextMap: entry.longTextMap || {},
            cursorPosition: entry.prompt.length,
          };
        }
      }

      // 5. Active Selector Handling (History Search, File, Command)
      if (state.showHistorySearch) {
        if (key.backspace || key.delete) {
          return {
            ...state,
            historySearchQuery: state.historySearchQuery.slice(0, -1),
          };
        }
        if (input && !key.ctrl && !key.meta && !key.return && !key.tab) {
          return {
            ...state,
            historySearchQuery: state.historySearchQuery + input,
          };
        }
        return state;
      }

      if (state.showFileSelector || state.showCommandSelector) {
        if (key.backspace || key.delete) {
          if (state.cursorPosition > 0) {
            const newCursorPosition = state.cursorPosition - 1;
            const beforeCursor = state.inputText.substring(
              0,
              state.cursorPosition - 1,
            );
            const afterCursor = state.inputText.substring(state.cursorPosition);
            const newInputText = beforeCursor + afterCursor;

            const newState = {
              ...state,
              inputText: newInputText,
              cursorPosition: newCursorPosition,
              historyIndex: -1,
            };

            // checkForAtDeletion
            if (
              newState.showFileSelector &&
              newCursorPosition <= newState.atPosition
            ) {
              newState.showFileSelector = false;
              newState.atPosition = -1;
              newState.fileSearchQuery = "";
            }
            // checkForSlashDeletion
            if (
              newState.showCommandSelector &&
              newCursorPosition <= newState.slashPosition
            ) {
              newState.showCommandSelector = false;
              newState.slashPosition = -1;
              newState.commandSearchQuery = "";
            }

            // Update queries
            if (newState.showFileSelector && newState.atPosition >= 0) {
              newState.fileSearchQuery = newInputText.substring(
                newState.atPosition + 1,
                newCursorPosition,
              );
            }
            if (newState.showCommandSelector && newState.slashPosition >= 0) {
              newState.commandSearchQuery = newInputText.substring(
                newState.slashPosition + 1,
                newCursorPosition,
              );
            }
            return newState;
          }
        }
        if (key.leftArrow || key.rightArrow) {
          const delta = key.leftArrow ? -1 : 1;
          const newCursorPosition = Math.max(
            0,
            Math.min(state.inputText.length, state.cursorPosition + delta),
          );
          const newState = { ...state, cursorPosition: newCursorPosition };
          if (
            newState.showFileSelector &&
            newCursorPosition <= newState.atPosition
          ) {
            newState.showFileSelector = false;
            newState.atPosition = -1;
          }
          if (
            newState.showCommandSelector &&
            newCursorPosition <= newState.slashPosition
          ) {
            newState.showCommandSelector = false;
            newState.slashPosition = -1;
          }
          return newState;
        }
        if (input === " ") {
          return {
            ...state,
            showFileSelector: false,
            atPosition: -1,
            showCommandSelector: false,
            slashPosition: -1,
            inputText:
              state.inputText.substring(0, state.cursorPosition) +
              " " +
              state.inputText.substring(state.cursorPosition),
            cursorPosition: state.cursorPosition + 1,
          };
        }

        if (key.return || key.tab || key.upArrow || key.downArrow) {
          return state;
        }
      }

      // 6. Return / Submit
      if (key.return) {
        if (state.inputText.trim()) {
          const imageRegex = /\[Image #(\d+)\]/g;
          const matches = [...state.inputText.matchAll(imageRegex)];
          const referencedImages = matches
            .map((match) => {
              const imageId = parseInt(match[1], 10);
              return state.attachedImages.find((img) => img.id === imageId);
            })
            .filter((img): img is AttachedImage => img !== undefined)
            .map((img) => ({ path: img.path, mimeType: img.mimeType }));

          const contentWithPlaceholders = state.inputText
            .replace(imageRegex, "")
            .trim();

          if (
            contentWithPlaceholders === "/btw" ||
            contentWithPlaceholders.startsWith("/btw ")
          ) {
            const question = contentWithPlaceholders.startsWith("/btw ")
              ? contentWithPlaceholders.substring(5).trim()
              : "";

            return {
              ...state,
              inputText: "",
              cursorPosition: 0,
              historyIndex: -1,
              longTextMap: {},
              btwState: {
                isActive: true,
                question,
                isLoading: question !== "",
                answer: undefined,
              },
              pendingEffect: question ? { type: "ASK_BTW", question } : null,
            };
          }

          return {
            ...state,
            inputText: "",
            cursorPosition: 0,
            historyIndex: -1,
            longTextMap: {},
            pendingEffect: {
              type: "SEND_MESSAGE",
              content: contentWithPlaceholders,
              images:
                referencedImages.length > 0 ? referencedImages : undefined,
              longTextMap: state.longTextMap,
            },
          };
        }
        return state;
      }

      // 7. Regular Input
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
        } else {
          let char = input;
          if (char === "！" && state.cursorPosition === 0) {
            char = "!";
          }

          const { newInputText, newCursorPosition } = getProjectedState(
            state.inputText,
            state.cursorPosition,
            char,
          );

          const newState = {
            ...state,
            inputText: newInputText,
            cursorPosition: newCursorPosition,
            historyIndex: -1,
          };

          // Selector Activation
          const trigger = SELECTOR_TRIGGERS.find((t) =>
            t.shouldActivate(
              char,
              newCursorPosition,
              newInputText,
              state.showFileSelector,
            ),
          );

          if (trigger) {
            if (trigger.type === "ACTIVATE_FILE_SELECTOR") {
              newState.showFileSelector = true;
              newState.atPosition = newCursorPosition - 1;
              newState.fileSearchQuery = "";
              newState.isFileSearching = true;
            } else if (trigger.type === "ACTIVATE_COMMAND_SELECTOR") {
              newState.showCommandSelector = true;
              newState.slashPosition = newCursorPosition - 1;
              newState.commandSearchQuery = "";
            }
          } else {
            const atPos = getAtSelectorPosition(
              newInputText,
              newCursorPosition,
            );
            if (atPos !== -1 && !state.showFileSelector) {
              newState.showFileSelector = true;
              newState.atPosition = atPos;
              newState.fileSearchQuery = "";
              newState.isFileSearching = true;
            }

            const slashPos = getSlashSelectorPosition(
              newInputText,
              newCursorPosition,
            );
            if (slashPos !== -1 && !state.showCommandSelector) {
              newState.showCommandSelector = true;
              newState.slashPosition = slashPos;
              newState.commandSearchQuery = "";
            }
          }

          // Update queries
          if (newState.showFileSelector && newState.atPosition >= 0) {
            newState.fileSearchQuery = newInputText.substring(
              newState.atPosition + 1,
              newCursorPosition,
            );
          }
          if (newState.showCommandSelector && newState.slashPosition >= 0) {
            newState.commandSearchQuery = newInputText.substring(
              newState.slashPosition + 1,
              newCursorPosition,
            );
          }

          return newState;
        }
      }

      // 8. Backspace / Delete (Normal Mode)
      if (key.backspace || key.delete) {
        if (state.cursorPosition > 0) {
          const newCursorPosition = state.cursorPosition - 1;
          const beforeCursor = state.inputText.substring(
            0,
            state.cursorPosition - 1,
          );
          const afterCursor = state.inputText.substring(state.cursorPosition);
          const newInputText = beforeCursor + afterCursor;

          const newState = {
            ...state,
            inputText: newInputText,
            cursorPosition: newCursorPosition,
            historyIndex: -1,
          };

          // Reactivate selectors if cursor is within word
          const atPos = getAtSelectorPosition(newInputText, newCursorPosition);
          if (atPos !== -1 && !state.showFileSelector) {
            newState.showFileSelector = true;
            newState.atPosition = atPos;
            newState.isFileSearching = true;
          }

          const slashPos = getSlashSelectorPosition(
            newInputText,
            newCursorPosition,
          );
          if (slashPos !== -1 && !state.showCommandSelector) {
            newState.showCommandSelector = true;
            newState.slashPosition = slashPos;
          }

          // Update queries
          if (newState.showFileSelector && newState.atPosition >= 0) {
            newState.fileSearchQuery = newInputText.substring(
              newState.atPosition + 1,
              newCursorPosition,
            );
          }
          if (newState.showCommandSelector && newState.slashPosition >= 0) {
            newState.commandSearchQuery = newInputText.substring(
              newState.slashPosition + 1,
              newCursorPosition,
            );
          }
          return newState;
        }
      }

      // 9. Cursor Movement (Normal Mode)
      if (key.leftArrow || key.rightArrow) {
        const delta = key.leftArrow ? -1 : 1;
        const newCursorPosition = Math.max(
          0,
          Math.min(state.inputText.length, state.cursorPosition + delta),
        );
        return { ...state, cursorPosition: newCursorPosition };
      }

      return state;
    }
    case "SET_BTW_STATE":
      return {
        ...state,
        btwState: {
          ...state.btwState,
          ...action.payload,
        },
      };
    default:
      return state;
  }
}
