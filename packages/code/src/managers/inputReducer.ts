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
import { AVAILABLE_COMMANDS } from "../constants/commands.js";

export interface AttachedImage {
  id: number;
  path: string;
  mimeType: string;
}

export interface BtwState {
  question: string;
  answer?: string;
  isLoading: boolean;
}

/**
 * True while the /btw overlay is up (a question is on display, loading or
 * answered). App's Ctrl+C exit handler checks this so Ctrl+C does not quit
 * the app while the overlay owns the keys. Synced from useInputManager via
 * an effect.
 */
export const btwOverlayActiveRef: { current: boolean } = { current: false };

export const ESC_DOUBLE_PRESS_TIMEOUT_MS = 1000;

export type PendingEffect =
  | {
      type: "SEND_MESSAGE";
      content: string;
      images?: Array<{ path: string; mimeType: string }>;
      longTextMap: Record<string, string>;
    }
  | {
      type: "SAVE_PROMPT_HISTORY";
      content: string;
      longTextMap: Record<string, string>;
    }
  | { type: "ABORT_MESSAGE" }
  | { type: "BACKGROUND_CURRENT_TASK" }
  | { type: "ASK_BTW"; question: string }
  | { type: "ABORT_BTW" }
  | { type: "PERMISSION_MODE_CHANGE"; mode: PermissionMode }
  | { type: "FETCH_HISTORY" }
  | { type: "PASTE_IMAGE" }
  | { type: "EXECUTE_COMMAND"; command: string; args?: string }
  | { type: "RECALL_QUEUED_MESSAGE" };

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
  onWorkflowManagerStateChange?: (show: boolean) => void;
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
  onAskBtw?: (
    question: string,
    abortSignal?: AbortSignal,
    onContent?: (content: string) => void,
  ) => Promise<string>;
  onClearMessages?: () => Promise<void>;
  onCompact?: (instructions?: string) => Promise<void>;
  onAddDir?: (args?: string) => Promise<void>;
  sessionId?: string;
  workdir?: string;
  getFullMessageThread?: () => Promise<{
    messages: Message[];
    sessionIds: string[];
  }>;
  logger?: Logger;
  hasQueuedMessages?: boolean;
  isIdle?: boolean;
  onRecallQueuedMessage?: () => void;
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
  showAgentsManager: boolean;
  showRewindManager: boolean;
  showHelp: boolean;
  showStatusCommand: boolean;
  showLoginCommand: boolean;
  showPluginManager: boolean;
  showModelSelector: boolean;
  showWorkflowManager: boolean;
  permissionMode: PermissionMode;
  selectorJustUsed: boolean;
  history: PromptEntry[];
  historyIndex: number;
  originalInputText: string;
  originalLongTextMap: Record<string, string>;
  isFileSearching: boolean;
  btwState: BtwState;
  pendingEffect: PendingEffect | null;
  escClearPending: boolean;
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
  showAgentsManager: false,
  showRewindManager: false,
  showHelp: false,
  showStatusCommand: false,
  showLoginCommand: false,
  showPluginManager: false,
  showModelSelector: false,
  showWorkflowManager: false,
  permissionMode: "default",
  selectorJustUsed: false,
  history: [],
  historyIndex: -1,
  originalInputText: "",
  originalLongTextMap: {},
  isFileSearching: false,
  btwState: {
    question: "",
    isLoading: false,
  },
  pendingEffect: null,
  escClearPending: false,
};

/**
 * Insert text at the cursor position, folding text longer than 200 chars
 * into a [LongText#N] placeholder. Shared by the INSERT_TEXT_WITH_PLACEHOLDER
 * action and multi-char chunk inserts (typed bursts, terminal paste, tmux
 * send-keys).
 */
function insertTextWithPlaceholder(
  textToInsert: string,
  state: InputState,
): InputState {
  let text = textToInsert;
  let newLongTextCounter = state.longTextCounter;
  const newLongTextMap = { ...state.longTextMap };

  if (text.length > 200) {
    newLongTextCounter += 1;
    const placeholderLabel = `[LongText#${newLongTextCounter}]`;
    newLongTextMap[placeholderLabel] = text;
    text = placeholderLabel;
  }

  const beforeCursor = state.inputText.substring(0, state.cursorPosition);
  const afterCursor = state.inputText.substring(state.cursorPosition);
  const newText = beforeCursor + text + afterCursor;
  const newCursorPosition = state.cursorPosition + text.length;

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

/**
 * Delete a placeholder token ([LongText#N] / [Image #N]) as a whole block
 * when the cursor sits at the token's end, aligned with Claude Code's
 * Cursor.deleteTokenBefore (Cursor.ts:937-969): the token must be preceded
 * by start-of-input or whitespace and followed by whitespace or EOL, so a
 * mid-token cursor or a token glued to following text falls back to
 * one-character deletion. Also drops the deleted token's longTextMap entry.
 * Returns null when no token is at the cursor position.
 */
function deleteTokenBefore(
  inputText: string,
  cursorPosition: number,
  longTextMap: Record<string, string>,
): {
  inputText: string;
  cursorPosition: number;
  longTextMap: Record<string, string>;
} | null {
  if (cursorPosition <= 0) {
    return null;
  }

  // Word-boundary guard (aligned with CC): only trigger when the char after
  // the cursor is whitespace or the end of the string.
  const charAfter = inputText[cursorPosition];
  if (charAfter !== undefined && !/\s/.test(charAfter)) {
    return null;
  }

  const textBefore = inputText.slice(0, cursorPosition);
  const tokenMatch = textBefore.match(/(^|\s)\[(LongText#\d+|Image #\d+)\]$/);
  if (!tokenMatch) {
    return null;
  }

  const tokenStart = tokenMatch.index! + tokenMatch[1]!.length;
  const token = tokenMatch[0].slice(tokenMatch[1]!.length);
  const newLongTextMap = { ...longTextMap };
  delete newLongTextMap[token];

  return {
    inputText: inputText.slice(0, tokenStart) + inputText.slice(cursorPosition),
    cursorPosition: tokenStart,
    longTextMap: newLongTextMap,
  };
}

/**
 * Submit the current input text: extract [Image #N] references, route /btw
 * and CLI-internal slash commands, otherwise send as a message. Returns null
 * when there is nothing to submit (empty text).
 */
function submitInput(state: InputState): InputState | null {
  if (!state.inputText.trim()) {
    return null;
  }
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

  if (contentWithPlaceholders.startsWith("/btw ")) {
    const question = contentWithPlaceholders.substring(5).trim();
    if (!question) {
      // "/btw " with no question text — show usage (aligned with Claude Code)
      return {
        ...state,
        inputText: "",
        cursorPosition: 0,
        historyIndex: -1,
        longTextMap: {},
        attachedImages: [],
        btwState: {
          question: "",
          isLoading: false,
          answer: "Usage: /btw <your question>",
        },
      };
    }

    return {
      ...state,
      inputText: "",
      cursorPosition: 0,
      historyIndex: -1,
      longTextMap: {},
      attachedImages: [],
      btwState: {
        question,
        isLoading: true,
        answer: undefined,
      },
      pendingEffect: { type: "ASK_BTW", question },
    };
  }

  if (contentWithPlaceholders === "/btw") {
    // Bare /btw — show usage (aligned with Claude Code)
    return {
      ...state,
      inputText: "",
      cursorPosition: 0,
      historyIndex: -1,
      longTextMap: {},
      attachedImages: [],
      btwState: {
        question: "",
        isLoading: false,
        answer: "Usage: /btw <your question>",
      },
    };
  }

  // Check if the content is a CLI-internal slash command (help, tasks,
  // etc.) that should be executed locally rather than sent as a message.
  // Agent slash commands and unknown /commands always go to SEND_MESSAGE.
  if (contentWithPlaceholders.startsWith("/")) {
    const spaceIndex = contentWithPlaceholders.indexOf(" ");
    const commandName =
      spaceIndex === -1
        ? contentWithPlaceholders.substring(1)
        : contentWithPlaceholders.substring(1, spaceIndex);

    const isInternalCommand = AVAILABLE_COMMANDS.some(
      (cmd) => cmd.id === commandName,
    );
    if (isInternalCommand) {
      const argsText =
        spaceIndex === -1
          ? undefined
          : contentWithPlaceholders.substring(spaceIndex + 1).trim() ||
            undefined;
      return {
        ...state,
        inputText: "",
        cursorPosition: 0,
        historyIndex: -1,
        longTextMap: {},
        attachedImages: [],
        pendingEffect: {
          type: "EXECUTE_COMMAND",
          command: commandName,
          args: argsText,
        },
      };
    }
  }

  return {
    ...state,
    inputText: "",
    cursorPosition: 0,
    historyIndex: -1,
    longTextMap: {},
    attachedImages: [],
    pendingEffect: {
      type: "SEND_MESSAGE",
      content: contentWithPlaceholders,
      images: referencedImages.length > 0 ? referencedImages : undefined,
      longTextMap: state.longTextMap,
    },
  };
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
  | { type: "SET_SHOW_AGENTS_MANAGER"; payload: boolean }
  | { type: "SET_SHOW_REWIND_MANAGER"; payload: boolean }
  | { type: "SET_SHOW_HELP"; payload: boolean }
  | { type: "SET_SHOW_STATUS_COMMAND"; payload: boolean }
  | { type: "SET_SHOW_LOGIN_COMMAND"; payload: boolean }
  | { type: "SET_SHOW_PLUGIN_MANAGER"; payload: boolean }
  | { type: "SET_SHOW_MODEL_SELECTOR"; payload: boolean }
  | { type: "SET_SHOW_WORKFLOW_MANAGER"; payload: boolean }
  | { type: "SET_PERMISSION_MODE"; payload: PermissionMode }
  | { type: "SET_SELECTOR_JUST_USED"; payload: boolean }
  | { type: "INSERT_TEXT_WITH_PLACEHOLDER"; payload: string }
  | { type: "CLEAR_LONG_TEXT_MAP" }
  | { type: "CLEAR_INPUT" }
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
  | { type: "RESET_ESC_CLEAR_PENDING" }
  | {
      type: "HANDLE_KEY";
      payload: {
        input: string;
        key: Key;
        hasSlashCommand: (cmd: string) => boolean;
        hasQueuedMessages?: boolean;
        isIdle?: boolean;
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
    case "SET_SHOW_AGENTS_MANAGER":
      return {
        ...state,
        showAgentsManager: action.payload,
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
    case "SET_SHOW_LOGIN_COMMAND":
      return {
        ...state,
        showLoginCommand: action.payload,
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
    case "SET_SHOW_WORKFLOW_MANAGER":
      return {
        ...state,
        showWorkflowManager: action.payload,
        selectorJustUsed: !action.payload ? true : state.selectorJustUsed,
      };
    case "SET_PERMISSION_MODE":
      return { ...state, permissionMode: action.payload };
    case "SET_SELECTOR_JUST_USED":
      return { ...state, selectorJustUsed: action.payload };
    case "INSERT_TEXT_WITH_PLACEHOLDER":
      return insertTextWithPlaceholder(action.payload, state);
    case "CLEAR_LONG_TEXT_MAP":
      return { ...state, longTextMap: {} };
    case "CLEAR_INPUT":
      return {
        ...state,
        inputText: "",
        cursorPosition: 0,
        historyIndex: -1,
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
    case "RESET_ESC_CLEAR_PENDING":
      return { ...state, escClearPending: false };
    case "HANDLE_KEY": {
      const { input, key } = action.payload;
      const hasQueuedMessages = action.payload.hasQueuedMessages ?? false;
      const isIdle = action.payload.isIdle ?? false;

      // 0. Raw DEL (\x7f) filtering.
      // SSH/tmux auto-repeat backspace coalesces multiple DEL bytes into one
      // chunk (e.g. "\x7f\x7f") that ink cannot parse into a key event, so it
      // arrives as raw input and would otherwise be treated as a paste and
      // inserted literally. Treat each DEL as a synchronous backspace instead
      // (aligned with Claude Code Issue #1853). Each DEL deletes a placeholder
      // token as a whole block first, falling back to one character (aligned
      // with Claude Code's useTextInput.ts:442-465).
      if (!key.backspace && !key.delete && input.includes("\x7f")) {
        const delCount = (input.match(/\x7f/g) || []).length;

        if (state.showHistorySearch) {
          return {
            ...state,
            historySearchQuery: state.historySearchQuery.slice(0, -delCount),
          };
        }

        let newInputText = state.inputText;
        let newCursorPosition = state.cursorPosition;
        let newLongTextMap = state.longTextMap;
        for (let i = 0; i < delCount; i++) {
          const tokenDeletion = deleteTokenBefore(
            newInputText,
            newCursorPosition,
            newLongTextMap,
          );
          if (tokenDeletion) {
            newInputText = tokenDeletion.inputText;
            newCursorPosition = tokenDeletion.cursorPosition;
            newLongTextMap = tokenDeletion.longTextMap;
          } else if (newCursorPosition > 0) {
            newInputText =
              newInputText.substring(0, newCursorPosition - 1) +
              newInputText.substring(newCursorPosition);
            newCursorPosition -= 1;
          }
        }

        if (
          newInputText === state.inputText &&
          newCursorPosition === state.cursorPosition
        ) {
          return state;
        }

        const newState = {
          ...state,
          inputText: newInputText,
          cursorPosition: newCursorPosition,
          longTextMap: newLongTextMap,
          historyIndex: -1,
        };

        // Deactivate selectors if their trigger character was deleted
        if (
          newState.showFileSelector &&
          newCursorPosition <= newState.atPosition
        ) {
          newState.showFileSelector = false;
          newState.atPosition = -1;
          newState.fileSearchQuery = "";
          newState.isFileSearching = false;
        }
        if (
          newState.showCommandSelector &&
          newCursorPosition <= newState.slashPosition
        ) {
          newState.showCommandSelector = false;
          newState.slashPosition = -1;
          newState.commandSearchQuery = "";
        }

        // Reactivate selectors if cursor is within a trigger word
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

      // 1. /btw overlay handling (active while a question is displayed, or
      // the bare-/btw usage message). Only Escape dismisses (or aborts the
      // in-flight side question while loading); every other key is ignored.
      if (state.btwState.question || state.btwState.answer) {
        if (key.escape) {
          if (state.btwState.isLoading) {
            return {
              ...state,
              btwState: {
                question: "",
                answer: undefined,
                isLoading: false,
              },
              pendingEffect: { type: "ABORT_BTW" },
            };
          }
          return {
            ...state,
            btwState: {
              question: "",
              answer: undefined,
              isLoading: false,
            },
          };
        }

        // Any other key while the overlay is up is ignored
        return state;
      }

      // 1. Escape Handling
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
            state.showAgentsManager ||
            state.showRewindManager ||
            state.showHelp ||
            state.showStatusCommand ||
            state.showLoginCommand ||
            state.showPluginManager ||
            state.showModelSelector ||
            state.showWorkflowManager
          )
        ) {
          // While AI is running (or any busy state) Esc keeps the abort
          // semantics. Only when idle does Esc fall through to the text-level
          // double-press clear (aligned with Claude Code's mutual-exclusion
          // design: Esc aborts only when a task is running).
          if (!isIdle) {
            return {
              ...state,
              escClearPending: false,
              pendingEffect: { type: "ABORT_MESSAGE" },
            };
          }
          // Idle: double-press Esc clears the input and saves to history.
          if (state.inputText) {
            if (state.escClearPending) {
              const originalText = state.inputText;
              const originalLongTextMap = state.longTextMap;
              return {
                ...state,
                inputText: "",
                cursorPosition: 0,
                historyIndex: -1,
                longTextMap: {},
                escClearPending: false,
                pendingEffect: {
                  type: "SAVE_PROMPT_HISTORY",
                  content: originalText,
                  longTextMap: originalLongTextMap,
                },
              };
            }
            return { ...state, escClearPending: true };
          }
          return state;
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

      // Emacs-style line editing (aligned with Claude Code): Ctrl+A/E move the
      // cursor to line start/end, Ctrl+U/K delete to line start/end, Ctrl+W
      // deletes the word before the cursor. Skipped while a selector is open.
      if (
        key.ctrl &&
        input &&
        !state.showFileSelector &&
        !state.showCommandSelector &&
        !state.showHistorySearch
      ) {
        const editKey = input.toLowerCase();
        if (editKey === "a") {
          return { ...state, cursorPosition: 0 };
        }
        if (editKey === "e") {
          return { ...state, cursorPosition: state.inputText.length };
        }
        if (editKey === "u") {
          return {
            ...state,
            inputText: state.inputText.substring(state.cursorPosition),
            cursorPosition: 0,
            historyIndex: -1,
          };
        }
        if (editKey === "k") {
          return {
            ...state,
            inputText: state.inputText.substring(0, state.cursorPosition),
            historyIndex: -1,
          };
        }
        if (editKey === "w") {
          // Find the start of the word before the cursor (skip trailing
          // whitespace, then the word itself).
          let start = state.cursorPosition - 1;
          while (start >= 0 && /\s/.test(state.inputText[start])) {
            start--;
          }
          while (start >= 0 && !/\s/.test(state.inputText[start])) {
            start--;
          }
          return {
            ...state,
            inputText:
              state.inputText.substring(0, start + 1) +
              state.inputText.substring(state.cursorPosition),
            cursorPosition: start + 1,
            historyIndex: -1,
          };
        }
      }

      // 4. History Navigation
      if (
        key.upArrow &&
        !state.showFileSelector &&
        !state.showCommandSelector
      ) {
        // If queue has messages, recall from queue first (before history)
        if (hasQueuedMessages) {
          return {
            ...state,
            pendingEffect: { type: "RECALL_QUEUED_MESSAGE" },
          };
        }
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
        return submitInput(state) ?? state;
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
        // SSH-coalesced Enter: on slow links, "text" + Enter arrive as one
        // chunk ("o\r"). ink's parseKeypress only matches a lone \r, so
        // key.return is false here. Text with exactly one trailing \r is a
        // coalesced Enter — strip the \r, insert, and submit immediately
        // (aligned with Claude Code's useTextInput).
        const isCoalescedEnter =
          input.length > 1 &&
          input.endsWith("\r") &&
          !input.slice(0, -1).includes("\r") &&
          // Backslash+CR is a stale VS Code Shift+Enter binding, not a
          // coalesced Enter — keep it as regular input.
          input[input.length - 2] !== "\\";

        if (isCoalescedEnter) {
          const insertedState = insertTextWithPlaceholder(
            input.slice(0, -1),
            state,
          );
          return submitInput(insertedState) ?? insertedState;
        }

        if (input.length > 1) {
          // Multi-char chunk (typed burst, terminal paste, tmux send-keys):
          // insert immediately — no debounce or paste buffer. \r → \n
          // normalizes carriage returns from CRLF terminals.
          return insertTextWithPlaceholder(input.replace(/\r/g, "\n"), state);
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
        // Placeholder token deletion first (aligned with Claude Code's
        // deleteTokenBefore, Cursor.ts:937-969): backspace at the end of a
        // [LongText#N] / [Image #N] token removes the whole token in one
        // press (and drops its longTextMap entry); otherwise delete one
        // character. Selector backspace (section 5) stays character-wise —
        // @mention and /command words are intentionally not tokenized.
        const tokenDeletion = deleteTokenBefore(
          state.inputText,
          state.cursorPosition,
          state.longTextMap,
        );
        if (!tokenDeletion && state.cursorPosition <= 0) {
          return state;
        }
        const newInputText = tokenDeletion
          ? tokenDeletion.inputText
          : state.inputText.substring(0, state.cursorPosition - 1) +
            state.inputText.substring(state.cursorPosition);
        const newCursorPosition = tokenDeletion
          ? tokenDeletion.cursorPosition
          : state.cursorPosition - 1;

        const newState = {
          ...state,
          inputText: newInputText,
          cursorPosition: newCursorPosition,
          longTextMap: tokenDeletion
            ? tokenDeletion.longTextMap
            : state.longTextMap,
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
