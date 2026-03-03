import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  InputManager,
  InputManagerCallbacks,
} from "../../src/managers/InputManager.js";
import type { Key } from "ink";

// Mock clipboard utils
vi.mock("../../src/utils/clipboard.js", () => ({
  readClipboardImage: vi.fn(),
}));

// Mock file search utils
const { mockSearchFiles, mockPromptHistoryManager } = vi.hoisted(() => ({
  mockSearchFiles: vi.fn(),
  mockPromptHistoryManager: {
    addEntry: vi.fn().mockResolvedValue(undefined),
    searchHistory: vi.fn().mockResolvedValue([]),
  },
}));

vi.mock("wave-agent-sdk", async (importOriginal) => {
  const actual = (await importOriginal()) as object;
  return {
    ...actual,
    searchFiles: mockSearchFiles,
    PromptHistoryManager: mockPromptHistoryManager,
  };
});

describe("InputManager selectorJustUsed", () => {
  let manager: InputManager;
  let mockCallbacks: InputManagerCallbacks;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();

    mockCallbacks = {
      onInputTextChange: vi.fn(),
      onCursorPositionChange: vi.fn(),
      onFileSelectorStateChange: vi.fn(),
      onCommandSelectorStateChange: vi.fn(),
      onHistorySearchStateChange: vi.fn(),
      onBackgroundTaskManagerStateChange: vi.fn(),
      onMcpManagerStateChange: vi.fn(),
      onRewindManagerStateChange: vi.fn(),
      onHelpStateChange: vi.fn(),
      onStatusCommandStateChange: vi.fn(),
      onImagesStateChange: vi.fn(),
      onSendMessage: vi.fn(),
      onHasSlashCommand: vi.fn(),
      onAbortMessage: vi.fn(),
    };

    manager = new InputManager(mockCallbacks);
  });

  afterEach(() => {
    manager.destroy();
    vi.useRealTimers();
  });

  const checkInputPrevented = async () => {
    const mockKey: Key = { return: true } as unknown as Key;
    const handled = await manager.handleInput("", mockKey, []);
    expect(handled).toBe(true);
    expect(vi.mocked(mockCallbacks.onSendMessage!)).not.toHaveBeenCalled();

    // After timeout, it should be processed
    vi.runAllTimers();
    await manager.handleInput("", mockKey, []);
    // If input is empty, it won't send message, but handled should be false or it should try to send if not empty
    // Let's put some text to be sure
    manager.insertTextAtCursor("test");
    const handledWithText = await manager.handleInput("", mockKey, []);
    expect(handledWithText).toBe(true);
    expect(vi.mocked(mockCallbacks.onSendMessage!)).toHaveBeenCalledWith(
      "test",
      undefined,
    );
  };

  it("should prevent input after canceling file selector", async () => {
    manager.activateFileSelector(0);
    manager.handleCancelFileSelect();
    await checkInputPrevented();
  });

  it("should prevent input after canceling command selector", async () => {
    manager.activateCommandSelector(0);
    manager.handleCancelCommandSelect();
    await checkInputPrevented();
  });

  it("should prevent input after closing background task manager", async () => {
    manager.setShowBackgroundTaskManager(true);
    manager.setShowBackgroundTaskManager(false);
    await checkInputPrevented();
  });

  it("should prevent input after closing MCP manager", async () => {
    manager.setShowMcpManager(true);
    manager.setShowMcpManager(false);
    await checkInputPrevented();
  });

  it("should prevent input after closing rewind manager", async () => {
    manager.setShowRewindManager(true);
    manager.setShowRewindManager(false);
    await checkInputPrevented();
  });

  it("should prevent input after closing help", async () => {
    manager.setShowHelp(true);
    manager.setShowHelp(false);
    await checkInputPrevented();
  });

  it("should prevent input after closing status command", async () => {
    manager.setShowStatusCommand(true);
    manager.setShowStatusCommand(false);
    await checkInputPrevented();
  });

  it("should prevent input after canceling history search", async () => {
    manager.activateHistorySearch();
    manager.handleCancelHistorySearch();
    await checkInputPrevented();
  });

  it("should prevent input after file selection", async () => {
    manager.insertTextAtCursor("@");
    manager.activateFileSelector(0);
    manager.handleFileSelect("file.ts");
    await checkInputPrevented();
  });

  it("should prevent input after command selection (local command)", async () => {
    manager.insertTextAtCursor("/");
    manager.activateCommandSelector(0);
    manager.handleCommandSelect("tasks");
    expect(manager.getShowBackgroundTaskManager()).toBe(true);
    manager.setShowBackgroundTaskManager(false);
    await checkInputPrevented();
  });

  it("should prevent input after command selection (non-local command)", async () => {
    mockCallbacks.onHasSlashCommand = vi.fn().mockReturnValue(true);
    manager.insertTextAtCursor("/");
    manager.activateCommandSelector(0);
    manager.handleCommandSelect("test-command");
    await vi.waitFor(() => {
      expect(vi.mocked(mockCallbacks.onSendMessage!)).toHaveBeenCalledWith(
        "/test-command",
      );
    });
    vi.mocked(mockCallbacks.onSendMessage!).mockClear();
    await checkInputPrevented();
  });

  it("should prevent input after command insertion", async () => {
    manager.insertTextAtCursor("/");
    manager.activateCommandSelector(0);
    manager.handleCommandInsert("tasks");
    await checkInputPrevented();
  });

  it("should prevent input after history search selection", async () => {
    manager.activateHistorySearch();
    manager.handleHistorySearchSelect("selected prompt");
    await checkInputPrevented();
  });
});
