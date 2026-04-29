import { describe, it, expect } from "vitest";
import {
  inputReducer,
  initialState,
  InputState,
} from "../../src/managers/inputReducer.js";
import { FileItem, PromptEntry } from "wave-agent-sdk";

describe("inputReducer", () => {
  it("should return initial state", () => {
    expect(initialState).toEqual({
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
      showPluginManager: false,
      showRewindManager: false,
      showHelp: false,
      showStatusCommand: false,
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
    });
  });

  it("should handle SET_INPUT_TEXT", () => {
    const state = inputReducer(initialState, {
      type: "SET_INPUT_TEXT",
      payload: "hello",
    });
    expect(state.inputText).toBe("hello");
    expect(state).not.toBe(initialState);
  });

  it("should handle SET_CURSOR_POSITION", () => {
    const stateWithText: InputState = { ...initialState, inputText: "hello" };

    let state = inputReducer(stateWithText, {
      type: "SET_CURSOR_POSITION",
      payload: 2,
    });
    expect(state.cursorPosition).toBe(2);

    // Boundary checks
    state = inputReducer(stateWithText, {
      type: "SET_CURSOR_POSITION",
      payload: -1,
    });
    expect(state.cursorPosition).toBe(0);

    state = inputReducer(stateWithText, {
      type: "SET_CURSOR_POSITION",
      payload: 10,
    });
    expect(state.cursorPosition).toBe(5);
  });

  it("should handle INSERT_TEXT", () => {
    // Insert at start
    let state = inputReducer(initialState, {
      type: "INSERT_TEXT",
      payload: "world",
    });
    expect(state.inputText).toBe("world");
    expect(state.cursorPosition).toBe(5);

    // Insert in middle
    state = { ...state, cursorPosition: 0 };
    state = inputReducer(state, { type: "INSERT_TEXT", payload: "hello " });
    expect(state.inputText).toBe("hello world");
    expect(state.cursorPosition).toBe(6);

    // Insert at end
    state = { ...state, cursorPosition: 11 };
    state = inputReducer(state, { type: "INSERT_TEXT", payload: "!" });
    expect(state.inputText).toBe("hello world!");
    expect(state.cursorPosition).toBe(12);
  });

  it("should handle DELETE_CHAR", () => {
    const stateWithText: InputState = {
      ...initialState,
      inputText: "hello",
      cursorPosition: 5,
    };

    // Delete at end
    let state = inputReducer(stateWithText, { type: "DELETE_CHAR" });
    expect(state.inputText).toBe("hell");
    expect(state.cursorPosition).toBe(4);

    // Delete in middle
    state = { ...stateWithText, cursorPosition: 3 };
    state = inputReducer(state, { type: "DELETE_CHAR" });
    expect(state.inputText).toBe("helo");
    expect(state.cursorPosition).toBe(2);

    // Delete at start (should do nothing)
    state = { ...stateWithText, cursorPosition: 0 };
    state = inputReducer(state, { type: "DELETE_CHAR" });
    expect(state.inputText).toBe("hello");
    expect(state.cursorPosition).toBe(0);
  });

  it("should handle MOVE_CURSOR", () => {
    const stateWithText: InputState = {
      ...initialState,
      inputText: "hello",
      cursorPosition: 2,
    };

    // Move right
    let state = inputReducer(stateWithText, {
      type: "MOVE_CURSOR",
      payload: 1,
    });
    expect(state.cursorPosition).toBe(3);

    // Move left
    state = inputReducer(stateWithText, { type: "MOVE_CURSOR", payload: -1 });
    expect(state.cursorPosition).toBe(1);

    // Boundary checks
    state = inputReducer(stateWithText, { type: "MOVE_CURSOR", payload: 10 });
    expect(state.cursorPosition).toBe(5);

    state = inputReducer(stateWithText, { type: "MOVE_CURSOR", payload: -10 });
    expect(state.cursorPosition).toBe(0);
  });

  it("should handle ACTIVATE_FILE_SELECTOR", () => {
    const state = inputReducer(initialState, {
      type: "ACTIVATE_FILE_SELECTOR",
      payload: 5,
    });
    expect(state.showFileSelector).toBe(true);
    expect(state.atPosition).toBe(5);
    expect(state.fileSearchQuery).toBe("");
    expect(state.filteredFiles).toEqual([]);
    expect(state.isFileSearching).toBe(true);
  });

  it("should handle SET_FILE_SEARCH_QUERY", () => {
    const state = inputReducer(initialState, {
      type: "SET_FILE_SEARCH_QUERY",
      payload: "test",
    });
    expect(state.fileSearchQuery).toBe("test");
    expect(state.isFileSearching).toBe(true);
  });

  it("should handle SET_FILTERED_FILES", () => {
    const files: FileItem[] = [{ path: "test.ts", type: "file" }];
    const state = inputReducer(
      { ...initialState, isFileSearching: true },
      {
        type: "SET_FILTERED_FILES",
        payload: files,
      },
    );
    expect(state.filteredFiles).toEqual(files);
    expect(state.isFileSearching).toBe(false);
  });

  it("should handle CANCEL_FILE_SELECTOR", () => {
    const stateWithSelector: InputState = {
      ...initialState,
      showFileSelector: true,
      atPosition: 5,
      fileSearchQuery: "test",
      filteredFiles: [{ path: "test.ts", type: "file" }],
      isFileSearching: true,
    };
    const state = inputReducer(stateWithSelector, {
      type: "CANCEL_FILE_SELECTOR",
    });
    expect(state.showFileSelector).toBe(false);
    expect(state.atPosition).toBe(-1);
    expect(state.fileSearchQuery).toBe("");
    expect(state.filteredFiles).toEqual([]);
    expect(state.selectorJustUsed).toBe(true);
    expect(state.isFileSearching).toBe(false);
  });

  it("should handle ACTIVATE_COMMAND_SELECTOR", () => {
    const state = inputReducer(initialState, {
      type: "ACTIVATE_COMMAND_SELECTOR",
      payload: 5,
    });
    expect(state.showCommandSelector).toBe(true);
    expect(state.slashPosition).toBe(5);
    expect(state.commandSearchQuery).toBe("");
  });

  it("should handle SET_COMMAND_SEARCH_QUERY", () => {
    const state = inputReducer(initialState, {
      type: "SET_COMMAND_SEARCH_QUERY",
      payload: "test",
    });
    expect(state.commandSearchQuery).toBe("test");
  });

  it("should handle CANCEL_COMMAND_SELECTOR", () => {
    const stateWithSelector: InputState = {
      ...initialState,
      showCommandSelector: true,
      slashPosition: 5,
      commandSearchQuery: "test",
    };
    const state = inputReducer(stateWithSelector, {
      type: "CANCEL_COMMAND_SELECTOR",
    });
    expect(state.showCommandSelector).toBe(false);
    expect(state.slashPosition).toBe(-1);
    expect(state.commandSearchQuery).toBe("");
    expect(state.selectorJustUsed).toBe(true);
  });

  it("should handle ACTIVATE_HISTORY_SEARCH", () => {
    const state = inputReducer(initialState, {
      type: "ACTIVATE_HISTORY_SEARCH",
    });
    expect(state.showHistorySearch).toBe(true);
    expect(state.historySearchQuery).toBe("");
  });

  it("should handle SET_HISTORY_SEARCH_QUERY", () => {
    const state = inputReducer(initialState, {
      type: "SET_HISTORY_SEARCH_QUERY",
      payload: "test",
    });
    expect(state.historySearchQuery).toBe("test");
  });

  it("should handle CANCEL_HISTORY_SEARCH", () => {
    const stateWithSelector: InputState = {
      ...initialState,
      showHistorySearch: true,
      historySearchQuery: "test",
    };
    const state = inputReducer(stateWithSelector, {
      type: "CANCEL_HISTORY_SEARCH",
    });
    expect(state.showHistorySearch).toBe(false);
    expect(state.historySearchQuery).toBe("");
    expect(state.selectorJustUsed).toBe(true);
  });

  it("should handle ADD_IMAGE", () => {
    const state = inputReducer(initialState, {
      type: "ADD_IMAGE",
      payload: { path: "test.png", mimeType: "image/png" },
    });
    expect(state.attachedImages).toHaveLength(1);
    expect(state.attachedImages[0]).toEqual({
      id: 1,
      path: "test.png",
      mimeType: "image/png",
    });
    expect(state.imageIdCounter).toBe(2);
  });

  it("should handle REMOVE_IMAGE", () => {
    const stateWithImage: InputState = {
      ...initialState,
      attachedImages: [{ id: 1, path: "test.png", mimeType: "image/png" }],
      imageIdCounter: 2,
    };
    const state = inputReducer(stateWithImage, {
      type: "REMOVE_IMAGE",
      payload: 1,
    });
    expect(state.attachedImages).toHaveLength(0);
  });

  it("should handle CLEAR_IMAGES", () => {
    const stateWithImages: InputState = {
      ...initialState,
      attachedImages: [
        { id: 1, path: "test1.png", mimeType: "image/png" },
        { id: 2, path: "test2.png", mimeType: "image/png" },
      ],
    };
    const state = inputReducer(stateWithImages, { type: "CLEAR_IMAGES" });
    expect(state.attachedImages).toHaveLength(0);
  });

  it("should handle SET_SHOW_BACKGROUND_TASK_MANAGER", () => {
    let state = inputReducer(initialState, {
      type: "SET_SHOW_BACKGROUND_TASK_MANAGER",
      payload: true,
    });
    expect(state.showBackgroundTaskManager).toBe(true);
    expect(state.selectorJustUsed).toBe(false);

    state = inputReducer(state, {
      type: "SET_SHOW_BACKGROUND_TASK_MANAGER",
      payload: false,
    });
    expect(state.showBackgroundTaskManager).toBe(false);
    expect(state.selectorJustUsed).toBe(true);
  });

  it("should handle SET_SHOW_MCP_MANAGER", () => {
    let state = inputReducer(initialState, {
      type: "SET_SHOW_MCP_MANAGER",
      payload: true,
    });
    expect(state.showMcpManager).toBe(true);
    expect(state.selectorJustUsed).toBe(false);

    state = inputReducer(state, {
      type: "SET_SHOW_MCP_MANAGER",
      payload: false,
    });
    expect(state.showMcpManager).toBe(false);
    expect(state.selectorJustUsed).toBe(true);
  });

  it("should handle SET_SHOW_REWIND_MANAGER", () => {
    let state = inputReducer(initialState, {
      type: "SET_SHOW_REWIND_MANAGER",
      payload: true,
    });
    expect(state.showRewindManager).toBe(true);
    expect(state.selectorJustUsed).toBe(false);

    state = inputReducer(state, {
      type: "SET_SHOW_REWIND_MANAGER",
      payload: false,
    });
    expect(state.showRewindManager).toBe(false);
    expect(state.selectorJustUsed).toBe(true);
  });

  it("should handle SET_SHOW_HELP", () => {
    let state = inputReducer(initialState, {
      type: "SET_SHOW_HELP",
      payload: true,
    });
    expect(state.showHelp).toBe(true);
    expect(state.selectorJustUsed).toBe(false);

    state = inputReducer(state, { type: "SET_SHOW_HELP", payload: false });
    expect(state.showHelp).toBe(false);
    expect(state.selectorJustUsed).toBe(true);
  });

  it("should handle SET_SHOW_STATUS_COMMAND", () => {
    let state = inputReducer(initialState, {
      type: "SET_SHOW_STATUS_COMMAND",
      payload: true,
    });
    expect(state.showStatusCommand).toBe(true);
    expect(state.selectorJustUsed).toBe(false);

    state = inputReducer(state, {
      type: "SET_SHOW_STATUS_COMMAND",
      payload: false,
    });
    expect(state.showStatusCommand).toBe(false);
    expect(state.selectorJustUsed).toBe(true);
  });

  it("should handle SET_SHOW_PLUGIN_MANAGER", () => {
    let state = inputReducer(initialState, {
      type: "SET_SHOW_PLUGIN_MANAGER",
      payload: true,
    });
    expect(state.showPluginManager).toBe(true);
    expect(state.selectorJustUsed).toBe(false);

    state = inputReducer(state, {
      type: "SET_SHOW_PLUGIN_MANAGER",
      payload: false,
    });
    expect(state.showPluginManager).toBe(false);
    expect(state.selectorJustUsed).toBe(true);
  });

  it("should handle SET_SHOW_MODEL_SELECTOR", () => {
    let state = inputReducer(initialState, {
      type: "SET_SHOW_MODEL_SELECTOR",
      payload: true,
    });
    expect(state.showModelSelector).toBe(true);
    expect(state.selectorJustUsed).toBe(false);

    state = inputReducer(state, {
      type: "SET_SHOW_MODEL_SELECTOR",
      payload: false,
    });
    expect(state.showModelSelector).toBe(false);
    expect(state.selectorJustUsed).toBe(true);
  });

  it("should handle SET_PERMISSION_MODE", () => {
    const state = inputReducer(initialState, {
      type: "SET_PERMISSION_MODE",
      payload: "plan",
    });
    expect(state.permissionMode).toBe("plan");
  });

  it("should handle SET_SELECTOR_JUST_USED", () => {
    const state = inputReducer(initialState, {
      type: "SET_SELECTOR_JUST_USED",
      payload: true,
    });
    expect(state.selectorJustUsed).toBe(true);
  });

  it("should handle INSERT_TEXT_WITH_PLACEHOLDER", () => {
    // Short text
    let state = inputReducer(initialState, {
      type: "INSERT_TEXT_WITH_PLACEHOLDER",
      payload: "short text",
    });
    expect(state.inputText).toBe("short text");
    expect(state.longTextCounter).toBe(0);
    expect(state.longTextMap).toEqual({});

    // Long text
    const longText = "a".repeat(201);
    state = inputReducer(initialState, {
      type: "INSERT_TEXT_WITH_PLACEHOLDER",
      payload: longText,
    });
    expect(state.inputText).toBe("[LongText#1]");
    expect(state.longTextCounter).toBe(1);
    expect(state.longTextMap["[LongText#1]"]).toBe(longText);
    expect(state.cursorPosition).toBe("[LongText#1]".length);
  });

  it("should handle CLEAR_LONG_TEXT_MAP", () => {
    const stateWithLongText: InputState = {
      ...initialState,
      longTextMap: { "[LongText#1]": "some long text" },
    };
    const state = inputReducer(stateWithLongText, {
      type: "CLEAR_LONG_TEXT_MAP",
    });
    expect(state.longTextMap).toEqual({});
  });

  it("should handle CLEAR_INPUT", () => {
    const stateWithInput: InputState = {
      ...initialState,
      inputText: "hello",
      cursorPosition: 5,
    };
    const state = inputReducer(stateWithInput, { type: "CLEAR_INPUT" });
    expect(state.inputText).toBe("");
    expect(state.cursorPosition).toBe(0);
  });

  it("should handle START_PASTE, APPEND_PASTE_BUFFER, END_PASTE", () => {
    let state = inputReducer(initialState, {
      type: "START_PASTE",
      payload: { buffer: "start", cursorPosition: 0 },
    });
    expect(state.isPasting).toBe(true);
    expect(state.pasteBuffer).toBe("start");
    expect(state.initialPasteCursorPosition).toBe(0);

    state = inputReducer(state, {
      type: "APPEND_PASTE_BUFFER",
      payload: " more",
    });
    expect(state.pasteBuffer).toBe("start more");

    state = inputReducer(state, { type: "END_PASTE" });
    expect(state.isPasting).toBe(false);
    expect(state.pasteBuffer).toBe("");
  });

  it("should handle APPEND_PASTE_CHUNK as new paste when buffer is empty", () => {
    const state = inputReducer(initialState, {
      type: "APPEND_PASTE_CHUNK",
      payload: { chunk: "first chunk", cursorPosition: 3 },
    });
    expect(state.isPasting).toBe(true);
    expect(state.pasteBuffer).toBe("first chunk");
    expect(state.initialPasteCursorPosition).toBe(3);
  });

  it("should handle APPEND_PASTE_CHUNK as append when buffer is already set", () => {
    let state = inputReducer(initialState, {
      type: "APPEND_PASTE_CHUNK",
      payload: { chunk: "first", cursorPosition: 0 },
    });
    state = inputReducer(state, {
      type: "APPEND_PASTE_CHUNK",
      payload: { chunk: "second", cursorPosition: 0 },
    });
    state = inputReducer(state, {
      type: "APPEND_PASTE_CHUNK",
      payload: { chunk: "third", cursorPosition: 5 },
    });

    expect(state.pasteBuffer).toBe("firstsecondthird");
    expect(state.initialPasteCursorPosition).toBe(0); // preserved from first chunk
  });

  it("should accumulate paste chunks through rapid sequential dispatches", () => {
    let state = inputReducer(initialState, {
      type: "APPEND_PASTE_CHUNK",
      payload: { chunk: "chunk1", cursorPosition: 0 },
    });
    state = inputReducer(state, {
      type: "APPEND_PASTE_CHUNK",
      payload: { chunk: "chunk2", cursorPosition: 0 },
    });
    state = inputReducer(state, {
      type: "APPEND_PASTE_CHUNK",
      payload: { chunk: "chunk3", cursorPosition: 0 },
    });

    expect(state.pasteBuffer).toBe("chunk1chunk2chunk3");
    expect(state.isPasting).toBe(true);
  });

  it("should handle END_PASTE after APPEND_PASTE_CHUNK", () => {
    let state = inputReducer(initialState, {
      type: "APPEND_PASTE_CHUNK",
      payload: { chunk: "pasted text", cursorPosition: 0 },
    });
    state = inputReducer(state, { type: "END_PASTE" });
    expect(state.isPasting).toBe(false);
    expect(state.pasteBuffer).toBe("");
  });

  it("should handle ADD_IMAGE_AND_INSERT_PLACEHOLDER", () => {
    const state = inputReducer(initialState, {
      type: "ADD_IMAGE_AND_INSERT_PLACEHOLDER",
      payload: { path: "test.png", mimeType: "image/png" },
    });
    expect(state.attachedImages).toHaveLength(1);
    expect(state.attachedImages[0].id).toBe(1);
    expect(state.inputText).toBe("[Image #1]");
    expect(state.cursorPosition).toBe("[Image #1]".length);
    expect(state.imageIdCounter).toBe(2);
  });

  describe("history navigation", () => {
    const mockHistory = [
      { prompt: "first", timestamp: 1000 },
      { prompt: "second", timestamp: 2000 },
    ];

    it("should handle SET_HISTORY_ENTRIES", () => {
      const state = inputReducer(initialState, {
        type: "SET_HISTORY_ENTRIES",
        payload: mockHistory,
      });
      expect(state.history).toEqual(mockHistory);
    });

    it("should navigate up and down through history", () => {
      let state = {
        ...initialState,
        history: mockHistory,
        inputText: "current",
      };

      // Navigate up to "first" (index 0)
      state = inputReducer(state, { type: "NAVIGATE_HISTORY", payload: "up" });
      expect(state.historyIndex).toBe(0);
      expect(state.inputText).toBe("first");
      expect(state.originalInputText).toBe("current");

      // Navigate up to "second" (index 1)
      state = inputReducer(state, { type: "NAVIGATE_HISTORY", payload: "up" });
      expect(state.historyIndex).toBe(1);
      expect(state.inputText).toBe("second");

      // Navigate up again (should stay at index 1)
      state = inputReducer(state, { type: "NAVIGATE_HISTORY", payload: "up" });
      expect(state.historyIndex).toBe(1);

      // Navigate down to "first" (index 0)
      state = inputReducer(state, {
        type: "NAVIGATE_HISTORY",
        payload: "down",
      });
      expect(state.historyIndex).toBe(0);
      expect(state.inputText).toBe("first");

      // Navigate down to original (index -1)
      state = inputReducer(state, {
        type: "NAVIGATE_HISTORY",
        payload: "down",
      });
      expect(state.historyIndex).toBe(-1);
      expect(state.inputText).toBe("current");
    });

    it("should handle long text in history navigation", () => {
      const historyWithLongText: PromptEntry[] = [
        {
          prompt: "[LongText#1]",
          timestamp: 1000,
          longTextMap: { "[LongText#1]": "long content" },
        },
      ];
      let state: InputState = {
        ...initialState,
        history: historyWithLongText,
        inputText: "current",
        longTextMap: { "[LongText#2]": "current long" },
      };

      // Navigate up
      state = inputReducer(state, { type: "NAVIGATE_HISTORY", payload: "up" });
      expect(state.inputText).toBe("[LongText#1]");
      expect(state.longTextMap).toEqual({ "[LongText#1]": "long content" });
      expect(state.originalInputText).toBe("current");
      expect(state.originalLongTextMap).toEqual({
        "[LongText#2]": "current long",
      });

      // Navigate down
      state = inputReducer(state, {
        type: "NAVIGATE_HISTORY",
        payload: "down",
      });
      expect(state.inputText).toBe("current");
      expect(state.longTextMap).toEqual({ "[LongText#2]": "current long" });
    });

    it("should reset history navigation on text input", () => {
      let state = {
        ...initialState,
        history: mockHistory,
        historyIndex: 0,
        inputText: "first",
        cursorPosition: 5,
        originalInputText: "current",
      };

      state = inputReducer(state, { type: "INSERT_TEXT", payload: "!" });
      expect(state.historyIndex).toBe(-1);
      expect(state.inputText).toBe("first!");
    });

    it("should handle SELECT_HISTORY_ENTRY", () => {
      const entry = {
        prompt: "selected",
        timestamp: 3000,
        longTextMap: { "[LongText#1]": "selected long" },
      };
      const state = inputReducer(initialState, {
        type: "SELECT_HISTORY_ENTRY",
        payload: entry,
      });
      expect(state.inputText).toBe("selected");
      expect(state.longTextMap).toEqual({ "[LongText#1]": "selected long" });
      expect(state.historyIndex).toBe(-1);
      expect(state.history).toEqual([]);
      expect(state.showHistorySearch).toBe(false);
      expect(state.historySearchQuery).toBe("");
      expect(state.selectorJustUsed).toBe(true);
    });

    it("should handle RESET_HISTORY_NAVIGATION", () => {
      const stateWithNav = {
        ...initialState,
        historyIndex: 0,
        history: mockHistory,
        originalInputText: "current",
      };
      const state = inputReducer(stateWithNav, {
        type: "RESET_HISTORY_NAVIGATION",
      });
      expect(state.historyIndex).toBe(-1);
      expect(state.history).toEqual([]);
      expect(state.originalInputText).toBe("");
    });

    it("should not clear input when pressing down at original prompt", () => {
      const state = {
        ...initialState,
        inputText: "hi",
        historyIndex: -1,
      };
      const newState = inputReducer(state, {
        type: "NAVIGATE_HISTORY",
        payload: "down",
      });
      expect(newState.inputText).toBe("hi");
      expect(newState.historyIndex).toBe(-1);
    });

    it("should restore original input when navigating back to index -1", () => {
      const state = {
        ...initialState,
        history: mockHistory,
        inputText: "hi",
        historyIndex: -1,
      };

      // Navigate up to "first"
      let newState = inputReducer(state, {
        type: "NAVIGATE_HISTORY",
        payload: "up",
      });
      expect(newState.inputText).toBe("first");
      expect(newState.originalInputText).toBe("hi");

      // Navigate down back to original
      newState = inputReducer(newState, {
        type: "NAVIGATE_HISTORY",
        payload: "down",
      });
      expect(newState.inputText).toBe("hi");
      expect(newState.historyIndex).toBe(-1);
      expect(newState.originalInputText).toBe("");
    });

    it("should save edited original input when navigating up again", () => {
      const state = {
        ...initialState,
        history: mockHistory,
        inputText: "hi",
        historyIndex: -1,
      };

      // Navigate up then down
      let newState = inputReducer(state, {
        type: "NAVIGATE_HISTORY",
        payload: "up",
      });
      newState = inputReducer(newState, {
        type: "NAVIGATE_HISTORY",
        payload: "down",
      });
      expect(newState.inputText).toBe("hi");

      // Edit original input
      newState = inputReducer(newState, {
        type: "INSERT_TEXT",
        payload: " there",
      });
      expect(newState.inputText).toBe("hi there");
      expect(newState.historyIndex).toBe(-1);

      // Navigate up again
      newState = inputReducer(newState, {
        type: "NAVIGATE_HISTORY",
        payload: "up",
      });
      expect(newState.inputText).toBe("first");
      expect(newState.originalInputText).toBe("hi there");
    });
  });
});
