import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  initialState,
  InputState,
  InputAction,
  inputReducer,
} from "../../src/managers/inputReducer.js";
import {
  expandLongTextPlaceholders,
  getAtSelectorPosition,
  getSlashSelectorPosition,
  updateSearchQueriesForActiveSelectors,
  processSelectorInput,
} from "../../src/utils/inputUtils.js";
import { handlePasteImage } from "../../src/managers/inputHandlers.js";
import { PermissionMode } from "wave-agent-sdk";
import { readClipboardImage } from "../../src/utils/clipboard.js";
import { Key } from "ink";

vi.mock("wave-agent-sdk", () => ({
  PromptHistoryManager: {
    addEntry: vi.fn().mockResolvedValue(undefined),
    getHistory: vi.fn().mockResolvedValue([]),
  },
}));

vi.mock("../../src/utils/clipboard.js", () => ({
  readClipboardImage: vi.fn(),
}));

describe("inputHandlers", () => {
  let dispatch: React.Dispatch<InputAction>;

  beforeEach(() => {
    dispatch = vi.fn() as unknown as React.Dispatch<InputAction>;
    vi.clearAllMocks();
  });

  describe("expandLongTextPlaceholders", () => {
    it("should expand placeholders correctly", () => {
      const text = "Check this: [LongText#1] and [LongText#2]";
      const longTextMap = {
        "[LongText#1]": "First long text",
        "[LongText#2]": "Second long text",
      };
      const result = expandLongTextPlaceholders(text, longTextMap);
      expect(result).toBe("Check this: First long text and Second long text");
    });

    it("should return original text if no placeholders match", () => {
      const text = "No placeholders here";
      const result = expandLongTextPlaceholders(text, {});
      expect(result).toBe(text);
    });
  });

  describe("getAtSelectorPosition", () => {
    it("should return @ position if cursor is at start of @word", () => {
      expect(getAtSelectorPosition("@file", 1)).toBe(0);
    });

    it("should return @ position if cursor is in middle of @word", () => {
      expect(getAtSelectorPosition("@file", 3)).toBe(0);
    });

    it("should return @ position if cursor is at end of @word", () => {
      expect(getAtSelectorPosition("@file", 5)).toBe(0);
    });

    it("should return @ position if @ is preceded by space", () => {
      expect(getAtSelectorPosition("test @file", 10)).toBe(5);
    });

    it("should return -1 if @ is not at start of word (email-like)", () => {
      expect(getAtSelectorPosition("user@domain", 5)).toBe(-1);
    });

    it("should return -1 if cursor is before @", () => {
      expect(getAtSelectorPosition("test @file", 4)).toBe(-1);
    });

    it("should return -1 if cursor is after a space following @word", () => {
      expect(getAtSelectorPosition("@file ", 6)).toBe(-1);
    });
  });

  describe("getSlashSelectorPosition", () => {
    it("should return 0 if cursor is at start of /command", () => {
      expect(getSlashSelectorPosition("/help", 1)).toBe(0);
    });

    it("should return 0 if cursor is in middle of /command", () => {
      expect(getSlashSelectorPosition("/help", 3)).toBe(0);
    });

    it("should return 0 if cursor is at end of /command", () => {
      expect(getSlashSelectorPosition("/help", 5)).toBe(0);
    });

    it("should return -1 if cursor is after a space following /command", () => {
      expect(getSlashSelectorPosition("/help ", 6)).toBe(-1);
    });

    it("should return position if / is preceded by space", () => {
      expect(getSlashSelectorPosition("test /help", 10)).toBe(5);
    });

    it("should return -1 if / is not at start of word", () => {
      expect(getSlashSelectorPosition("test/help", 7)).toBe(-1);
    });
  });

  describe("handlePasteImage", () => {
    it("should dispatch ADD_IMAGE_AND_INSERT_PLACEHOLDER on success", async () => {
      vi.mocked(readClipboardImage).mockResolvedValue({
        success: true,
        imagePath: "/tmp/img.png",
        mimeType: "image/png",
      });

      const result = await handlePasteImage(dispatch);

      expect(result).toBe(true);
      expect(dispatch).toHaveBeenCalledWith({
        type: "ADD_IMAGE_AND_INSERT_PLACEHOLDER",
        payload: { path: "/tmp/img.png", mimeType: "image/png" },
      });
    });

    it("should return false on failure", async () => {
      vi.mocked(readClipboardImage).mockResolvedValue({ success: false });

      const result = await handlePasteImage(dispatch);

      expect(result).toBe(false);
      expect(dispatch).not.toHaveBeenCalled();
    });
  });

  describe("updateSearchQueriesForActiveSelectors", () => {
    it("should update file search query", () => {
      const state: InputState = {
        ...initialState,
        showFileSelector: true,
        atPosition: 0,
      };
      updateSearchQueriesForActiveSelectors(state, dispatch, "@test", 5);
      expect(dispatch).toHaveBeenCalledWith({
        type: "SET_FILE_SEARCH_QUERY",
        payload: "test",
      });
    });

    it("should update command search query", () => {
      const state: InputState = {
        ...initialState,
        showCommandSelector: true,
        slashPosition: 0,
      };
      updateSearchQueriesForActiveSelectors(state, dispatch, "/help", 5);
      expect(dispatch).toHaveBeenCalledWith({
        type: "SET_COMMAND_SEARCH_QUERY",
        payload: "help",
      });
    });
  });

  describe("processSelectorInput", () => {
    it("should activate file selector on @ at start", () => {
      processSelectorInput(initialState, dispatch, "@");
      expect(dispatch).toHaveBeenCalledWith({
        type: "ACTIVATE_FILE_SELECTOR",
        payload: 0,
      });
    });

    it("should activate file selector on @ after space", () => {
      const state = { ...initialState, inputText: "test ", cursorPosition: 5 };
      processSelectorInput(state, dispatch, "@");
      expect(dispatch).toHaveBeenCalledWith({
        type: "ACTIVATE_FILE_SELECTOR",
        payload: 5,
      });
    });

    it("should activate file selector on @ after newline", () => {
      const state = { ...initialState, inputText: "test\n", cursorPosition: 5 };
      processSelectorInput(state, dispatch, "@");
      expect(dispatch).toHaveBeenCalledWith({
        type: "ACTIVATE_FILE_SELECTOR",
        payload: 5,
      });
    });

    it("should not activate file selector on @ after non-whitespace char", () => {
      const state = { ...initialState, inputText: "test", cursorPosition: 4 };
      processSelectorInput(state, dispatch, "@");
      expect(dispatch).not.toHaveBeenCalledWith({
        type: "ACTIVATE_FILE_SELECTOR",
        payload: 4,
      });
    });

    it("should update search query if @ is typed while selector is already active", () => {
      const state = {
        ...initialState,
        showFileSelector: true,
        atPosition: 0,
        inputText: "@test",
        cursorPosition: 5,
      };
      processSelectorInput(state, dispatch, "@");
      expect(dispatch).toHaveBeenCalledWith({
        type: "SET_FILE_SEARCH_QUERY",
        payload: "test@",
      });
    });

    it("should activate command selector on / at start", () => {
      processSelectorInput(initialState, dispatch, "/");
      expect(dispatch).toHaveBeenCalledWith({
        type: "ACTIVATE_COMMAND_SELECTOR",
        payload: 0,
      });
    });

    it("should activate command selector on / after space", () => {
      const state = { ...initialState, inputText: "test ", cursorPosition: 5 };
      processSelectorInput(state, dispatch, "/");
      expect(dispatch).toHaveBeenCalledWith({
        type: "ACTIVATE_COMMAND_SELECTOR",
        payload: 5,
      });
    });

    it("should not activate command selector on / after non-whitespace char", () => {
      const state = { ...initialState, inputText: "test", cursorPosition: 4 };
      processSelectorInput(state, dispatch, "/");
      expect(dispatch).not.toHaveBeenCalledWith({
        type: "ACTIVATE_COMMAND_SELECTOR",
        payload: 4,
      });
    });
    it("should reactivate file selector when typing inside an existing @word", () => {
      const state = {
        ...initialState,
        inputText: "@fi",
        cursorPosition: 3,
        showFileSelector: false,
      };
      processSelectorInput(state, dispatch, "l");
      expect(dispatch).toHaveBeenCalledWith({
        type: "ACTIVATE_FILE_SELECTOR",
        payload: 0,
      });
    });

    it("should update search query when typing inside an existing @word", () => {
      const state = {
        ...initialState,
        inputText: "@fi",
        cursorPosition: 3,
        showFileSelector: true,
        atPosition: 0,
      };
      processSelectorInput(state, dispatch, "l");
      expect(dispatch).toHaveBeenCalledWith({
        type: "SET_FILE_SEARCH_QUERY",
        payload: "fil",
      });
    });
    it("should reactivate command selector when typing inside an existing /command", () => {
      const state = {
        ...initialState,
        inputText: "/hel",
        cursorPosition: 4,
        showCommandSelector: false,
      };
      processSelectorInput(state, dispatch, "p");
      expect(dispatch).toHaveBeenCalledWith({
        type: "ACTIVATE_COMMAND_SELECTOR",
        payload: 0,
      });
    });

    it("should update search query when typing inside an existing /command", () => {
      const state = {
        ...initialState,
        inputText: "/hel",
        cursorPosition: 4,
        showCommandSelector: true,
        slashPosition: 0,
      };
      processSelectorInput(state, dispatch, "p");
      expect(dispatch).toHaveBeenCalledWith({
        type: "SET_COMMAND_SEARCH_QUERY",
        payload: "help",
      });
    });
  });

  // --- Reducer tests for handler logic moved to reducer ---

  describe("reducer: HANDLE_FILE_SELECT", () => {
    it("should insert file path and close selector, keeping @", () => {
      const state: InputState = {
        ...initialState,
        atPosition: 0,
        inputText: "@",
        cursorPosition: 1,
        showFileSelector: true,
      };
      const newState = inputReducer(state, {
        type: "HANDLE_FILE_SELECT",
        payload: { filePath: "file.txt" },
      });

      expect(newState.inputText).toBe("@file.txt ");
      expect(newState.cursorPosition).toBe(10);
      expect(newState.showFileSelector).toBe(false);
      expect(newState.atPosition).toBe(-1);
    });

    it("should replace the entire @word even if cursor is in the middle", () => {
      const state: InputState = {
        ...initialState,
        atPosition: 0,
        inputText: "@file",
        cursorPosition: 3,
        showFileSelector: true,
      };
      const newState = inputReducer(state, {
        type: "HANDLE_FILE_SELECT",
        payload: { filePath: "newfile.txt" },
      });

      expect(newState.inputText).toBe("@newfile.txt ");
    });
  });

  describe("reducer: HANDLE_COMMAND_SELECT", () => {
    it("should clear input and set pendingCommand", () => {
      const state: InputState = {
        ...initialState,
        slashPosition: 0,
        inputText: "/test",
        cursorPosition: 5,
        showCommandSelector: true,
      };
      const newState = inputReducer(state, {
        type: "HANDLE_COMMAND_SELECT",
        payload: { command: "test" },
      });

      expect(newState.inputText).toBe("");
      expect(newState.cursorPosition).toBe(0);
      expect(newState.showCommandSelector).toBe(false);
      expect(newState.pendingCommand).toEqual({
        command: "test",
        newInput: "",
        newCursorPosition: 0,
      });
    });

    it("should handle btw command by setting btwState", () => {
      const state: InputState = {
        ...initialState,
        slashPosition: 0,
        inputText: "/btw",
        cursorPosition: 4,
        showCommandSelector: true,
      };
      const newState = inputReducer(state, {
        type: "HANDLE_COMMAND_SELECT",
        payload: { command: "btw" },
      });

      expect(newState.pendingCommand).toEqual({
        command: "btw",
        newInput: "",
        newCursorPosition: 0,
      });
    });
  });

  describe("reducer: SUBMIT", () => {
    it("should set pendingSubmit with content and clear input", () => {
      const state: InputState = {
        ...initialState,
        inputText: "hello [LongText#1]",
        longTextMap: { "[LongText#1]": "world" },
      };
      const newState = inputReducer(state, {
        type: "SUBMIT",
        payload: { attachedImages: [] },
      });

      expect(newState.pendingSubmit).toEqual({
        content: "hello [LongText#1]",
        images: undefined,
        longTextMap: { "[LongText#1]": "world" },
      });
      expect(newState.inputText).toBe("");
      expect(newState.longTextMap).toEqual({});
    });

    it("should handle images in text", () => {
      const state: InputState = {
        ...initialState,
        inputText: "Look at this [Image #1]",
        attachedImages: [
          { id: 1, path: "/path/to/img.png", mimeType: "image/png" },
        ],
      };
      const newState = inputReducer(state, {
        type: "SUBMIT",
        payload: {
          attachedImages: [
            { id: 1, path: "/path/to/img.png", mimeType: "image/png" },
          ],
        },
      });

      expect(newState.pendingSubmit?.content).toBe("Look at this");
      expect(newState.pendingSubmit?.images).toEqual([
        { path: "/path/to/img.png", mimeType: "image/png" },
      ]);
    });

    it("should handle /btw command", () => {
      const state: InputState = {
        ...initialState,
        inputText: "/btw hello",
      };
      const newState = inputReducer(state, {
        type: "SUBMIT",
        payload: { attachedImages: [] },
      });

      expect(newState.btwState.isActive).toBe(true);
      expect(newState.btwState.question).toBe("hello");
      expect(newState.inputText).toBe("");
    });
  });

  describe("reducer: PASTE_INPUT", () => {
    it("should dispatch APPEND_PASTE_CHUNK for multi-char input", () => {
      const state: InputState = { ...initialState, cursorPosition: 0 };
      const newState = inputReducer(state, {
        type: "PASTE_INPUT",
        payload: { input: "pasted text" },
      });

      expect(newState.isPasting).toBe(true);
      expect(newState.pasteBuffer).toBe("pasted text");
      expect(newState.initialPasteCursorPosition).toBe(0);
    });

    it("should insert single char for normal input", () => {
      const state: InputState = {
        ...initialState,
        cursorPosition: 0,
        inputText: "",
      };
      const newState = inputReducer(state, {
        type: "PASTE_INPUT",
        payload: { input: "a" },
      });

      expect(newState.inputText).toBe("a");
      expect(newState.cursorPosition).toBe(1);
      expect(newState.pendingSelectorInsert).toBe("a");
    });

    it("should convert fullwidth ！ to ! at position 0", () => {
      const state: InputState = {
        ...initialState,
        cursorPosition: 0,
        inputText: "",
      };
      const newState = inputReducer(state, {
        type: "PASTE_INPUT",
        payload: { input: "！" },
      });

      expect(newState.inputText).toBe("!");
      expect(newState.pendingSelectorInsert).toBe("!");
    });
  });

  describe("reducer: CYCLE_PERMISSION", () => {
    it("should set pendingCyclePermission flag (handled by useEffect)", () => {
      const newState = inputReducer(initialState, {
        type: "HANDLE_KEY",
        payload: {
          input: "",
          key: { tab: true, shift: true } as Key,
          attachedImages: [],
        },
      });
      expect(newState.pendingCyclePermission).toBe(true);
    });

    it("should cycle permission mode when CYCLE_PERMISSION action is dispatched", () => {
      // This action is effectively unused in the useEffect approach,
      // but the reducer handles it for completeness
      const state = {
        ...initialState,
        permissionMode: "default" as PermissionMode,
      };
      const newState = inputReducer(state, { type: "CYCLE_PERMISSION" });
      expect(newState.permissionMode).toBe("acceptEdits");
    });
  });

  describe("reducer: REQUEST_PASTE_IMAGE / IMAGE_PASTED", () => {
    it("should set pendingPasteImage on request", () => {
      const newState = inputReducer(initialState, {
        type: "REQUEST_PASTE_IMAGE",
      });
      expect(newState.pendingPasteImage).toBe(true);
    });

    it("should add image on pasted success", () => {
      const state = inputReducer(initialState, { type: "REQUEST_PASTE_IMAGE" });
      const newState = inputReducer(state, {
        type: "IMAGE_PASTED",
        payload: { path: "/tmp/img.png", mimeType: "image/png" },
      });

      expect(newState.attachedImages).toHaveLength(1);
      expect(newState.attachedImages[0].path).toBe("/tmp/img.png");
      expect(newState.inputText).toBe("[Image #1]");
      expect(newState.pendingPasteImage).toBe(false);
    });

    it("should clear flag on paste failure", () => {
      const state = inputReducer(initialState, { type: "REQUEST_PASTE_IMAGE" });
      const newState = inputReducer(state, {
        type: "IMAGE_PASTED",
        payload: null,
      });

      expect(newState.pendingPasteImage).toBe(false);
    });
  });

  describe("reducer: REQUEST_ABORT", () => {
    it("should set pendingAbort", () => {
      const newState = inputReducer(initialState, { type: "REQUEST_ABORT" });
      expect(newState.pendingAbort).toBe(true);
    });
  });

  describe("reducer: REQUEST_BACKGROUND_TASK", () => {
    it("should set pendingBackgroundTask", () => {
      const newState = inputReducer(initialState, {
        type: "REQUEST_BACKGROUND_TASK",
      });
      expect(newState.pendingBackgroundTask).toBe(true);
    });
  });

  describe("reducer: HANDLE_KEY - selector input", () => {
    it("should return true (no state change) if selectorJustUsed is true", () => {
      const state = {
        ...initialState,
        selectorJustUsed: true,
        inputText: "test",
      };
      const newState = inputReducer(state, {
        type: "HANDLE_KEY",
        payload: {
          input: "",
          key: { return: true } as Key,
          attachedImages: [],
        },
      });
      expect(newState).toBe(state);
    });

    it("should handle escape to close file selector", () => {
      const state: InputState = {
        ...initialState,
        showFileSelector: true,
        atPosition: 0,
      };
      const newState = inputReducer(state, {
        type: "HANDLE_KEY",
        payload: {
          input: "",
          key: { escape: true } as Key,
          attachedImages: [],
        },
      });
      expect(newState.showFileSelector).toBe(false);
      expect(newState.pendingAbort).toBe(false);
    });

    it("should handle escape to close command selector", () => {
      const state: InputState = {
        ...initialState,
        showCommandSelector: true,
        slashPosition: 0,
      };
      const newState = inputReducer(state, {
        type: "HANDLE_KEY",
        payload: {
          input: "",
          key: { escape: true } as Key,
          attachedImages: [],
        },
      });
      expect(newState.showCommandSelector).toBe(false);
      expect(newState.pendingAbort).toBe(false);
    });

    it("should handle shift+tab to cycle permission", () => {
      const newState = inputReducer(initialState, {
        type: "HANDLE_KEY",
        payload: {
          input: "",
          key: { tab: true, shift: true } as Key,
          attachedImages: [],
        },
      });
      expect(newState.pendingCyclePermission).toBe(true);
    });

    it("should handle history search escape", () => {
      const state = { ...initialState, showHistorySearch: true };
      const newState = inputReducer(state, {
        type: "HANDLE_KEY",
        payload: {
          input: "",
          key: { escape: true } as Key,
          attachedImages: [],
        },
      });
      expect(newState.showHistorySearch).toBe(false);
    });

    it("should handle history search backspace", () => {
      const state = {
        ...initialState,
        showHistorySearch: true,
        historySearchQuery: "abc",
      };
      const newState = inputReducer(state, {
        type: "HANDLE_KEY",
        payload: {
          input: "",
          key: { backspace: true } as Key,
          attachedImages: [],
        },
      });
      expect(newState.historySearchQuery).toBe("ab");
    });

    it("should handle history search input", () => {
      const state = {
        ...initialState,
        showHistorySearch: true,
        historySearchQuery: "abc",
      };
      const newState = inputReducer(state, {
        type: "HANDLE_KEY",
        payload: { input: "d", key: {} as Key, attachedImages: [] },
      });
      expect(newState.historySearchQuery).toBe("abcd");
    });
  });

  describe("reducer: HANDLE_KEY - btw state", () => {
    it("should handle escape to dismiss btwState", () => {
      const state = {
        ...initialState,
        btwState: { isActive: true, question: "", isLoading: false },
      };
      const newState = inputReducer(state, {
        type: "HANDLE_KEY",
        payload: {
          input: "",
          key: { escape: true } as Key,
          attachedImages: [],
        },
      });
      expect(newState.btwState.isActive).toBe(false);
    });

    it("should handle return to submit btw question", () => {
      const state = {
        ...initialState,
        btwState: { isActive: true, question: "", isLoading: false },
        inputText: "What is the time?",
      };
      const newState = inputReducer(state, {
        type: "HANDLE_KEY",
        payload: {
          input: "",
          key: { return: true } as Key,
          attachedImages: [],
        },
      });
      expect(newState.btwState.question).toBe("What is the time?");
      expect(newState.btwState.isLoading).toBe(true);
      expect(newState.inputText).toBe("");
    });
  });

  describe("reducer: HANDLE_KEY - normal input", () => {
    it("should handle return key (submit)", () => {
      const state = { ...initialState, inputText: "test" };
      const newState = inputReducer(state, {
        type: "HANDLE_KEY",
        payload: {
          input: "",
          key: { return: true } as Key,
          attachedImages: [],
        },
      });
      expect(newState.pendingSubmit?.content).toBe("test");
    });

    it("should handle escape with file selector", () => {
      const state: InputState = {
        ...initialState,
        showFileSelector: true,
        atPosition: 0,
      };
      const newState = inputReducer(state, {
        type: "HANDLE_KEY",
        payload: {
          input: "",
          key: { escape: true } as Key,
          attachedImages: [],
        },
      });
      expect(newState.showFileSelector).toBe(false);
    });

    it("should handle left/right arrow", () => {
      const state = { ...initialState, cursorPosition: 3, inputText: "hello" };
      const newState = inputReducer(state, {
        type: "HANDLE_KEY",
        payload: {
          input: "",
          key: { leftArrow: true } as Key,
          attachedImages: [],
        },
      });
      expect(newState.cursorPosition).toBe(2);

      const newState2 = inputReducer(newState, {
        type: "HANDLE_KEY",
        payload: {
          input: "",
          key: { rightArrow: true } as Key,
          attachedImages: [],
        },
      });
      expect(newState2.cursorPosition).toBe(3);
    });

    it("should handle ctrl+v for paste image", () => {
      const newState = inputReducer(initialState, {
        type: "HANDLE_KEY",
        payload: {
          input: "v",
          key: { ctrl: true } as Key,
          attachedImages: [],
        },
      });
      expect(newState.pendingPasteImage).toBe(true);
    });

    it("should handle ctrl+r for history search", () => {
      const newState = inputReducer(initialState, {
        type: "HANDLE_KEY",
        payload: {
          input: "r",
          key: { ctrl: true } as Key,
          attachedImages: [],
        },
      });
      expect(newState.showHistorySearch).toBe(true);
    });

    it("should handle ctrl+b for background task", () => {
      const newState = inputReducer(initialState, {
        type: "HANDLE_KEY",
        payload: {
          input: "b",
          key: { ctrl: true } as Key,
          attachedImages: [],
        },
      });
      expect(newState.pendingBackgroundTask).toBe(true);
    });

    it("should insert character input", () => {
      const newState = inputReducer(initialState, {
        type: "HANDLE_KEY",
        payload: { input: "a", key: {} as Key, attachedImages: [] },
      });
      expect(newState.inputText).toBe("a");
      expect(newState.cursorPosition).toBe(1);
      expect(newState.pendingSelectorInsert).toBe("a");
    });
  });

  describe("reducer: HANDLE_KEY - escape abort", () => {
    it("should set pendingAbort when no managers active", () => {
      const newState = inputReducer(initialState, {
        type: "HANDLE_KEY",
        payload: {
          input: "",
          key: { escape: true } as Key,
          attachedImages: [],
        },
      });
      expect(newState.pendingAbort).toBe(true);
    });

    it("should NOT set pendingAbort when file selector is active", () => {
      const state: InputState = {
        ...initialState,
        showFileSelector: true,
        atPosition: 0,
      };
      const newState = inputReducer(state, {
        type: "HANDLE_KEY",
        payload: {
          input: "",
          key: { escape: true } as Key,
          attachedImages: [],
        },
      });
      expect(newState.pendingAbort).toBe(false);
      expect(newState.showFileSelector).toBe(false);
    });
  });

  describe("reducer: REQUEST_HISTORY_FETCH / HISTORY_FETCHED", () => {
    it("should set pendingHistoryFetch on up arrow with empty history", () => {
      const newState = inputReducer(initialState, {
        type: "HANDLE_KEY",
        payload: {
          input: "",
          key: { upArrow: true } as Key,
          attachedImages: [],
        },
      });
      expect(newState.pendingHistoryFetch).toBe(true);
    });

    it("should set history on HISTORY_FETCHED", () => {
      const state = { ...initialState, pendingHistoryFetch: true };
      const newState = inputReducer(state, {
        type: "HISTORY_FETCHED",
        payload: [{ prompt: "prev", timestamp: 1000 }],
      });
      expect(newState.history).toEqual([{ prompt: "prev", timestamp: 1000 }]);
      expect(newState.pendingHistoryFetch).toBe(false);
    });
  });

  describe("reducer: HANDLE_KEY - history navigation", () => {
    it("should navigate up in history", () => {
      const state: InputState = {
        ...initialState,
        history: [{ prompt: "prev", timestamp: 1000 }],
      };
      const newState = inputReducer(state, {
        type: "HANDLE_KEY",
        payload: {
          input: "",
          key: { upArrow: true } as Key,
          attachedImages: [],
        },
      });
      expect(newState.historyIndex).toBe(0);
      expect(newState.inputText).toBe("prev");
      expect(newState.originalInputText).toBe("");
    });

    it("should navigate down in history", () => {
      const state: InputState = {
        ...initialState,
        history: [{ prompt: "prev", timestamp: 1000 }],
        historyIndex: 0,
        originalInputText: "current",
      };
      const newState = inputReducer(state, {
        type: "HANDLE_KEY",
        payload: {
          input: "",
          key: { downArrow: true } as Key,
          attachedImages: [],
        },
      });
      expect(newState.historyIndex).toBe(-1);
      expect(newState.inputText).toBe("current");
    });
  });

  describe("reducer: backspace with selector reactivation", () => {
    it("should reactivate file selector on backspace inside @word", () => {
      const state: InputState = {
        ...initialState,
        inputText: "@file",
        cursorPosition: 5,
        showFileSelector: false,
      };
      const newState = inputReducer(state, {
        type: "HANDLE_KEY",
        payload: {
          input: "",
          key: { backspace: true } as Key,
          attachedImages: [],
        },
      });
      expect(newState.showFileSelector).toBe(true);
      expect(newState.atPosition).toBe(0);
    });

    it("should reactivate command selector on backspace inside /command", () => {
      const state: InputState = {
        ...initialState,
        inputText: "/help",
        cursorPosition: 5,
        showCommandSelector: false,
      };
      const newState = inputReducer(state, {
        type: "HANDLE_KEY",
        payload: {
          input: "",
          key: { backspace: true } as Key,
          attachedImages: [],
        },
      });
      expect(newState.showCommandSelector).toBe(true);
      expect(newState.slashPosition).toBe(0);
    });
  });

  describe("reducer: non-selector manager absorbs input", () => {
    it("should not change state when background task manager is active", () => {
      const state: InputState = {
        ...initialState,
        showBackgroundTaskManager: true,
      };
      const newState = inputReducer(state, {
        type: "HANDLE_KEY",
        payload: { input: "a", key: {} as Key, attachedImages: [] },
      });
      expect(newState).toBe(state);
    });

    it("should not change state when help is active", () => {
      const state: InputState = { ...initialState, showHelp: true };
      const newState = inputReducer(state, {
        type: "HANDLE_KEY",
        payload: { input: "a", key: {} as Key, attachedImages: [] },
      });
      expect(newState).toBe(state);
    });
  });
});
