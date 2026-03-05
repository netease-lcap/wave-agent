import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  initialState,
  InputState,
  InputAction,
  InputManagerCallbacks,
} from "../../src/managers/inputReducer.js";
import {
  expandLongTextPlaceholders,
  handleSubmit,
  handlePasteImage,
  cyclePermissionMode,
  updateSearchQueriesForActiveSelectors,
  processSelectorInput,
  handlePasteInput,
  handleCommandSelect,
  handleFileSelect,
  checkForAtDeletion,
  checkForSlashDeletion,
  handleSelectorInput,
  handleNormalInput,
  handleInput,
} from "../../src/managers/inputHandlers.js";
import { PromptHistoryManager } from "wave-agent-sdk";
import { readClipboardImage } from "../../src/utils/clipboard.js";
import { Key } from "ink";

vi.mock("wave-agent-sdk", () => ({
  PromptHistoryManager: {
    addEntry: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock("../../src/utils/clipboard.js", () => ({
  readClipboardImage: vi.fn(),
}));

describe("inputHandlers", () => {
  let dispatch: React.Dispatch<InputAction>;
  let callbacks: Partial<InputManagerCallbacks>;

  beforeEach(() => {
    dispatch = vi.fn() as unknown as React.Dispatch<InputAction>;
    callbacks = {
      onSendMessage: vi.fn(),
      onResetHistoryNavigation: vi.fn(),
      onPermissionModeChange: vi.fn(),
      onInputTextChange: vi.fn(),
      onCursorPositionChange: vi.fn(),
      onHasSlashCommand: vi.fn(),
      onClearMessages: vi.fn(),
      onAbortMessage: vi.fn(),
      onBackgroundCurrentTask: vi.fn(),
      logger: {
        debug: vi.fn(),
        error: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
      } as unknown as InputManagerCallbacks["logger"],
    };
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

  describe("handleSubmit", () => {
    it("should not submit if loading or command is running", async () => {
      await handleSubmit(initialState, dispatch, callbacks, true, false);
      expect(callbacks.onSendMessage).not.toHaveBeenCalled();

      await handleSubmit(initialState, dispatch, callbacks, false, true);
      expect(callbacks.onSendMessage).not.toHaveBeenCalled();
    });

    it("should submit text and clear input", async () => {
      const state: InputState = { ...initialState, inputText: "hello world" };
      await handleSubmit(state, dispatch, callbacks);

      expect(callbacks.onSendMessage).toHaveBeenCalledWith(
        "hello world",
        undefined,
      );
      expect(dispatch).toHaveBeenCalledWith({ type: "CLEAR_INPUT" });
      expect(dispatch).toHaveBeenCalledWith({ type: "CLEAR_LONG_TEXT_MAP" });
      expect(callbacks.onResetHistoryNavigation).toHaveBeenCalled();
      expect(PromptHistoryManager.addEntry).toHaveBeenCalledWith("hello world");
    });

    it("should handle images in text", async () => {
      const state: InputState = {
        ...initialState,
        inputText: "Look at this [Image #1]",
        attachedImages: [
          { id: 1, path: "/path/to/img.png", mimeType: "image/png" },
        ],
      };
      await handleSubmit(state, dispatch, callbacks);

      expect(callbacks.onSendMessage).toHaveBeenCalledWith("Look at this", [
        { path: "/path/to/img.png", mimeType: "image/png" },
      ]);
    });

    it("should expand long text placeholders during submit", async () => {
      const state: InputState = {
        ...initialState,
        inputText: "Check this: [LongText#1]",
        longTextMap: { "[LongText#1]": "Expanded content" },
      };
      await handleSubmit(state, dispatch, callbacks);

      expect(callbacks.onSendMessage).toHaveBeenCalledWith(
        "Check this: Expanded content",
        undefined,
      );
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

  describe("cyclePermissionMode", () => {
    it("should cycle through modes", () => {
      cyclePermissionMode("default", dispatch, callbacks);
      expect(dispatch).toHaveBeenCalledWith({
        type: "SET_PERMISSION_MODE",
        payload: "acceptEdits",
      });
      expect(callbacks.onPermissionModeChange).toHaveBeenCalledWith(
        "acceptEdits",
      );

      cyclePermissionMode("acceptEdits", dispatch, callbacks);
      expect(dispatch).toHaveBeenCalledWith({
        type: "SET_PERMISSION_MODE",
        payload: "plan",
      });

      cyclePermissionMode("plan", dispatch, callbacks);
      expect(dispatch).toHaveBeenCalledWith({
        type: "SET_PERMISSION_MODE",
        payload: "default",
      });
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

    it("should not activate command selector on / if not at start", () => {
      const state = { ...initialState, inputText: "test ", cursorPosition: 5 };
      processSelectorInput(state, dispatch, "/");
      expect(dispatch).not.toHaveBeenCalledWith({
        type: "ACTIVATE_COMMAND_SELECTOR",
        payload: 4,
      });
    });
  });

  describe("handlePasteInput", () => {
    it("should start paste for multi-char input", () => {
      const state = { ...initialState, cursorPosition: 0 };
      handlePasteInput(state, dispatch, callbacks, "pasted text");
      expect(dispatch).toHaveBeenCalledWith({
        type: "START_PASTE",
        payload: { buffer: "pasted text", cursorPosition: 0 },
      });
    });

    it("should append to paste buffer if already pasting", () => {
      const state = { ...initialState, isPasting: true };
      handlePasteInput(state, dispatch, callbacks, "more text");
      expect(dispatch).toHaveBeenCalledWith({
        type: "APPEND_PASTE_BUFFER",
        payload: "more text",
      });
    });

    it("should insert single char and check special chars", () => {
      const state = { ...initialState, cursorPosition: 0, inputText: "" };
      handlePasteInput(state, dispatch, callbacks, "@");
      expect(dispatch).toHaveBeenCalledWith({
        type: "INSERT_TEXT",
        payload: "@",
      });
      expect(dispatch).toHaveBeenCalledWith({
        type: "ACTIVATE_FILE_SELECTOR",
        payload: 0,
      });
    });
  });

  describe("handleCommandSelect", () => {
    it("should execute agent command", async () => {
      const state: InputState = {
        ...initialState,
        slashPosition: 0,
        inputText: "/test",
        cursorPosition: 5,
      };
      vi.mocked(callbacks.onHasSlashCommand!).mockReturnValue(true);

      handleCommandSelect(state, dispatch, callbacks, "test");

      expect(dispatch).toHaveBeenCalledWith({
        type: "SET_INPUT_TEXT",
        payload: "",
      });
      expect(dispatch).toHaveBeenCalledWith({
        type: "CANCEL_COMMAND_SELECTOR",
      });

      // Wait for async command execution
      await vi.waitFor(() => {
        expect(callbacks.onSendMessage).toHaveBeenCalledWith("/test");
      });
    });

    it("should handle local commands like clear", () => {
      const state: InputState = {
        ...initialState,
        slashPosition: 0,
        inputText: "/clear",
        cursorPosition: 6,
      };
      vi.mocked(callbacks.onHasSlashCommand!).mockReturnValue(false);

      handleCommandSelect(state, dispatch, callbacks, "clear");

      expect(callbacks.onClearMessages).toHaveBeenCalled();
    });
  });

  describe("handleFileSelect", () => {
    it("should insert file path and close selector, keeping @", () => {
      const state: InputState = {
        ...initialState,
        atPosition: 0,
        inputText: "@",
        cursorPosition: 1,
      };
      handleFileSelect(state, dispatch, callbacks, "file.txt");

      expect(dispatch).toHaveBeenCalledWith({
        type: "SET_INPUT_TEXT",
        payload: "@file.txt ",
      });
      expect(dispatch).toHaveBeenCalledWith({ type: "CANCEL_FILE_SELECTOR" });
    });
  });

  describe("checkForAtDeletion", () => {
    it("should cancel file selector if cursor moves before @", () => {
      const state: InputState = {
        ...initialState,
        showFileSelector: true,
        atPosition: 5,
      };
      const result = checkForAtDeletion(state, dispatch, 4);
      expect(result).toBe(true);
      expect(dispatch).toHaveBeenCalledWith({ type: "CANCEL_FILE_SELECTOR" });
    });
  });

  describe("checkForSlashDeletion", () => {
    it("should cancel command selector if cursor moves before /", () => {
      const state: InputState = {
        ...initialState,
        showCommandSelector: true,
        slashPosition: 0,
      };
      const result = checkForSlashDeletion(state, dispatch, 0);
      expect(result).toBe(true);
      expect(dispatch).toHaveBeenCalledWith({
        type: "CANCEL_COMMAND_SELECTOR",
      });
    });
  });

  describe("handleSelectorInput", () => {
    it("should handle backspace in selector", () => {
      const state: InputState = {
        ...initialState,
        showFileSelector: true,
        atPosition: 0,
        inputText: "@a",
        cursorPosition: 2,
      };
      const key = { backspace: true } as Key;
      const result = handleSelectorInput(state, dispatch, callbacks, "", key);

      expect(result).toBe(true);
      expect(dispatch).toHaveBeenCalledWith({ type: "DELETE_CHAR" });
    });

    it("should handle character input in selector", () => {
      const state: InputState = {
        ...initialState,
        showFileSelector: true,
        atPosition: 0,
        inputText: "@",
        cursorPosition: 1,
      };
      const key = {} as Key;
      const result = handleSelectorInput(state, dispatch, callbacks, "a", key);

      expect(result).toBe(true);
      expect(dispatch).toHaveBeenCalledWith({
        type: "INSERT_TEXT",
        payload: "a",
      });
    });

    it("should cancel file selector on space input", () => {
      const state: InputState = {
        ...initialState,
        showFileSelector: true,
        atPosition: 0,
        inputText: "@",
        cursorPosition: 1,
      };
      const key = {} as Key;
      const result = handleSelectorInput(state, dispatch, callbacks, " ", key);

      expect(result).toBe(true);
      expect(dispatch).toHaveBeenCalledWith({ type: "CANCEL_FILE_SELECTOR" });
    });
  });

  describe("handleNormalInput", () => {
    it("should handle return key", async () => {
      const state: InputState = { ...initialState, inputText: "test" };
      const key = { return: true } as Key;
      const clearImages = vi.fn();
      const result = await handleNormalInput(
        state,
        dispatch,
        callbacks,
        "",
        key,
        false,
        false,
        clearImages,
      );

      expect(result).toBe(true);
      expect(callbacks.onSendMessage).toHaveBeenCalledWith("test", undefined);
      expect(clearImages).toHaveBeenCalled();
    });

    it("should handle escape key", async () => {
      const state: InputState = { ...initialState, showFileSelector: true };
      const key = { escape: true } as Key;
      const result = await handleNormalInput(
        state,
        dispatch,
        callbacks,
        "",
        key,
      );

      expect(result).toBe(true);
      expect(dispatch).toHaveBeenCalledWith({ type: "CANCEL_FILE_SELECTOR" });
    });

    it("should handle navigation keys", async () => {
      const keyLeft = { leftArrow: true } as Key;
      await handleNormalInput(initialState, dispatch, callbacks, "", keyLeft);
      expect(dispatch).toHaveBeenCalledWith({
        type: "MOVE_CURSOR",
        payload: -1,
      });

      const keyRight = { rightArrow: true } as Key;
      await handleNormalInput(initialState, dispatch, callbacks, "", keyRight);
      expect(dispatch).toHaveBeenCalledWith({
        type: "MOVE_CURSOR",
        payload: 1,
      });
    });

    it("should handle ctrl+v for image paste", async () => {
      const key = { ctrl: true } as Key;
      vi.mocked(readClipboardImage).mockResolvedValue({
        success: true,
        imagePath: "p.png",
        mimeType: "i/p",
      });
      await handleNormalInput(initialState, dispatch, callbacks, "v", key);

      await vi.waitFor(() => {
        expect(dispatch).toHaveBeenCalledWith({
          type: "ADD_IMAGE_AND_INSERT_PLACEHOLDER",
          payload: { path: "p.png", mimeType: "i/p" },
        });
      });
    });

    it("should handle ctrl+r for history search", async () => {
      const key = { ctrl: true } as Key;
      await handleNormalInput(initialState, dispatch, callbacks, "r", key);
      expect(dispatch).toHaveBeenCalledWith({
        type: "ACTIVATE_HISTORY_SEARCH",
      });
    });

    it("should handle ctrl+b for background task", async () => {
      const key = { ctrl: true } as Key;
      await handleNormalInput(initialState, dispatch, callbacks, "b", key);
      expect(callbacks.onBackgroundCurrentTask).toHaveBeenCalled();
    });
  });

  describe("handleInput", () => {
    it("should return true if selectorJustUsed is true and not call other handlers", async () => {
      const state = {
        ...initialState,
        selectorJustUsed: true,
        inputText: "test",
      };
      const key = { return: true } as Key;
      const result = await handleInput(state, dispatch, callbacks, "", key);
      expect(result).toBe(true);
      expect(callbacks.onSendMessage).not.toHaveBeenCalled();
    });

    it("should handle escape to abort message when loading", async () => {
      const state = { ...initialState };
      const key = { escape: true } as Key;
      const result = await handleInput(
        state,
        dispatch,
        callbacks,
        "",
        key,
        true,
      );
      expect(result).toBe(true);
      expect(callbacks.onAbortMessage).toHaveBeenCalled();
    });

    it("should handle shift+tab to cycle permission mode", async () => {
      const key = { tab: true, shift: true } as Key;
      const result = await handleInput(
        initialState,
        dispatch,
        callbacks,
        "",
        key,
      );
      expect(result).toBe(true);
      expect(dispatch).toHaveBeenCalledWith({
        type: "SET_PERMISSION_MODE",
        payload: "acceptEdits",
      });
    });

    it("should delegate to handleSelectorInput if selector is active", async () => {
      const state = {
        ...initialState,
        showFileSelector: true,
        cursorPosition: 1,
      };
      const key = { backspace: true } as Key;
      const result = await handleInput(state, dispatch, callbacks, "", key);
      expect(result).toBe(true);
      expect(dispatch).toHaveBeenCalledWith({ type: "DELETE_CHAR" });
    });

    it("should handle history search input", async () => {
      const state = {
        ...initialState,
        showHistorySearch: true,
        historySearchQuery: "abc",
      };
      const key = {} as Key;
      const result = await handleInput(state, dispatch, callbacks, "d", key);
      expect(result).toBe(true);
      expect(dispatch).toHaveBeenCalledWith({
        type: "SET_HISTORY_SEARCH_QUERY",
        payload: "abcd",
      });
    });

    it("should handle history search backspace", async () => {
      const state = {
        ...initialState,
        showHistorySearch: true,
        historySearchQuery: "abc",
      };
      const key = { backspace: true } as Key;
      const result = await handleInput(state, dispatch, callbacks, "", key);
      expect(result).toBe(true);
      expect(dispatch).toHaveBeenCalledWith({
        type: "SET_HISTORY_SEARCH_QUERY",
        payload: "ab",
      });
    });

    it("should handle history search escape", async () => {
      const state = { ...initialState, showHistorySearch: true };
      const key = { escape: true } as Key;
      const result = await handleInput(state, dispatch, callbacks, "", key);
      expect(result).toBe(true);
      expect(dispatch).toHaveBeenCalledWith({ type: "CANCEL_HISTORY_SEARCH" });
    });
  });
});
