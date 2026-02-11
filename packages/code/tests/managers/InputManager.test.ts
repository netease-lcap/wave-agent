import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  InputManager,
  InputManagerCallbacks,
} from "../../src/managers/InputManager.js";
import type { Key } from "ink";

// Mock clipboard utils
const mockReadClipboardImage = vi.hoisted(() => vi.fn());
vi.mock("../../src/utils/clipboard.js", () => ({
  readClipboardImage: mockReadClipboardImage,
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

describe("InputManager", () => {
  let manager: InputManager;
  let mockCallbacks: InputManagerCallbacks;

  beforeEach(() => {
    // Reset all mocks
    vi.clearAllMocks();

    // Setup mock callbacks
    mockCallbacks = {
      onInputTextChange: vi.fn(),
      onCursorPositionChange: vi.fn(),
      onFileSelectorStateChange: vi.fn(),
      onCommandSelectorStateChange: vi.fn(),
      onHistorySearchStateChange: vi.fn(),
      onBackgroundTaskManagerStateChange: vi.fn(),
      onMcpManagerStateChange: vi.fn(),
      onRewindManagerStateChange: vi.fn(),
      onImagesStateChange: vi.fn(),
      onSendMessage: vi.fn(),
      onHasSlashCommand: vi.fn(),
      onAbortMessage: vi.fn(),
      onResetHistoryNavigation: vi.fn(),
    };

    // Setup file search mock
    mockSearchFiles.mockResolvedValue([
      { path: "src/test1.ts", type: "file" },
      { path: "src/test2.ts", type: "file" },
      { path: "docs/readme.md", type: "file" },
    ]);

    manager = new InputManager(mockCallbacks);
  });

  afterEach(() => {
    manager.destroy();
  });

  describe("Basic Input Management", () => {
    it("should initialize with empty state", () => {
      expect(manager.getInputText()).toBe("");
      expect(manager.getCursorPosition()).toBe(0);
    });

    it("should insert text at cursor position", () => {
      manager.insertTextAtCursor("hello");

      expect(manager.getInputText()).toBe("hello");
      expect(manager.getCursorPosition()).toBe(5);
      expect(mockCallbacks.onInputTextChange).toHaveBeenCalledWith("hello");
      expect(mockCallbacks.onCursorPositionChange).toHaveBeenCalledWith(5);
    });

    it("should insert text in the middle", () => {
      manager.insertTextAtCursor("helo");
      manager.setCursorPosition(2); // Position after "he"
      manager.insertTextAtCursor("l");

      expect(manager.getInputText()).toBe("hello");
      expect(manager.getCursorPosition()).toBe(3);
    });

    it("should delete character before cursor", () => {
      manager.insertTextAtCursor("hello");
      manager.setCursorPosition(3); // Position after "hel"
      manager.deleteCharAtCursor();

      expect(manager.getInputText()).toBe("helo");
      expect(manager.getCursorPosition()).toBe(2);
    });

    it("should clear input", () => {
      manager.insertTextAtCursor("hello world");
      manager.clearInput();

      expect(manager.getInputText()).toBe("");
      expect(manager.getCursorPosition()).toBe(0);
    });
  });

  describe("Cursor Movement", () => {
    beforeEach(() => {
      manager.insertTextAtCursor("hello");
    });

    it("should move cursor left", () => {
      manager.moveCursorLeft();
      expect(manager.getCursorPosition()).toBe(4);

      manager.moveCursorLeft();
      expect(manager.getCursorPosition()).toBe(3);
    });

    it("should not move cursor left beyond start", () => {
      manager.setCursorPosition(0);
      manager.moveCursorLeft();
      expect(manager.getCursorPosition()).toBe(0);
    });

    it("should move cursor right", () => {
      manager.setCursorPosition(3);
      manager.moveCursorRight();
      expect(manager.getCursorPosition()).toBe(4);
    });

    it("should not move cursor right beyond end", () => {
      manager.moveCursorRight();
      expect(manager.getCursorPosition()).toBe(5);
    });

    it("should move cursor to start", () => {
      manager.moveCursorToStart();
      expect(manager.getCursorPosition()).toBe(0);
    });

    it("should move cursor to end", () => {
      manager.setCursorPosition(2);
      manager.moveCursorToEnd();
      expect(manager.getCursorPosition()).toBe(5);
    });
  });

  describe("File Selector", () => {
    it("should activate file selector", () => {
      manager.insertTextAtCursor("@");
      manager.activateFileSelector(0);

      expect(mockCallbacks.onFileSelectorStateChange).toHaveBeenCalledWith(
        true,
        [],
        "",
        0,
      );
    });

    it("should handle file selection", () => {
      manager.insertTextAtCursor("@test");
      manager.activateFileSelector(0);

      const result = manager.handleFileSelect("/path/to/file.ts");

      expect(result.newInput).toBe("/path/to/file.ts ");
      expect(result.newCursorPosition).toBe(17);
    });

    it("should cancel file selector", () => {
      manager.activateFileSelector(0);
      manager.handleCancelFileSelect();

      expect(mockCallbacks.onFileSelectorStateChange).toHaveBeenLastCalledWith(
        false,
        [],
        "",
        -1,
      );
    });

    it("should update file search query", async () => {
      manager.updateFileSearchQuery("test");

      // Wait for debounced search
      await new Promise((resolve) => setTimeout(resolve, 100));

      expect(mockSearchFiles).toHaveBeenCalledWith("test");
    });

    it("should detect @ deletion", () => {
      manager.insertTextAtCursor("@test");
      manager.activateFileSelector(0);

      // Delete the @
      manager.setCursorPosition(1);
      const shouldDeactivate = manager.checkForAtDeletion(0);

      expect(shouldDeactivate).toBe(true);
    });
  });

  describe("Command Selector", () => {
    beforeEach(() => {
      mockCallbacks.onHasSlashCommand = vi.fn().mockReturnValue(true);
    });

    it("should activate command selector", () => {
      manager.insertTextAtCursor("/");
      manager.activateCommandSelector(0);

      expect(mockCallbacks.onCommandSelectorStateChange).toHaveBeenCalledWith(
        true,
        "",
        0,
      );
    });

    it("should handle command selection", () => {
      manager.insertTextAtCursor("/test");
      manager.activateCommandSelector(0);

      const result = manager.handleCommandSelect("git-commit");

      expect(result.newInput).toBe("");
      expect(result.newCursorPosition).toBe(0);
    });

    it("should handle command insertion", () => {
      manager.insertTextAtCursor("/test");
      manager.activateCommandSelector(0);

      const result = manager.handleCommandInsert("git-commit");

      expect(result.newInput).toBe("/git-commit ");
      expect(result.newCursorPosition).toBe(12);
    });

    it("should detect slash deletion", () => {
      manager.insertTextAtCursor("/test");
      manager.activateCommandSelector(0);

      // Delete the /
      manager.setCursorPosition(1);
      const shouldDeactivate = manager.checkForSlashDeletion(0);

      expect(shouldDeactivate).toBe(true);
    });
  });

  describe("History Search", () => {
    it("should activate history search", () => {
      manager.activateHistorySearch();

      expect(mockCallbacks.onHistorySearchStateChange).toHaveBeenCalledWith(
        true,
        "",
      );
    });

    it("should handle history search selection", () => {
      manager.activateHistorySearch();
      manager.handleHistorySearchSelect("selected prompt");

      expect(manager.getInputText()).toBe("selected prompt");
      expect(manager.getCursorPosition()).toBe(15);
      expect(mockCallbacks.onHistorySearchStateChange).toHaveBeenLastCalledWith(
        false,
        "",
      );
    });

    it("should cancel history search", () => {
      manager.activateHistorySearch();
      manager.handleCancelHistorySearch();

      expect(mockCallbacks.onHistorySearchStateChange).toHaveBeenLastCalledWith(
        false,
        "",
      );
    });
  });

  describe("Image Management", () => {
    it("should add image", () => {
      const image = manager.addImage("/path/to/image.png", "image/png");

      expect(image).toEqual({
        id: 1,
        path: "/path/to/image.png",
        mimeType: "image/png",
      });
      expect(mockCallbacks.onImagesStateChange).toHaveBeenCalledWith([image]);
    });

    it("should remove image", () => {
      const image = manager.addImage("/path/to/image.png", "image/png");
      manager.removeImage(image.id);

      expect(mockCallbacks.onImagesStateChange).toHaveBeenLastCalledWith([]);
    });

    it("should clear all images", () => {
      manager.addImage("/path/to/image1.png", "image/png");
      manager.addImage("/path/to/image2.png", "image/png");
      manager.clearImages();

      expect(mockCallbacks.onImagesStateChange).toHaveBeenLastCalledWith([]);
    });

    it("should handle paste image success", async () => {
      mockReadClipboardImage.mockResolvedValue({
        success: true,
        imagePath: "/tmp/clipboard.png",
        mimeType: "image/png",
      });

      const result = await manager.handlePasteImage();

      expect(result).toBe(true);
      expect(manager.getInputText()).toBe("[Image #1]");
      expect(mockCallbacks.onImagesStateChange).toHaveBeenCalled();
    });

    it("should handle paste image failure", async () => {
      mockReadClipboardImage.mockResolvedValue({
        success: false,
        error: "No image in clipboard",
      });

      const result = await manager.handlePasteImage();

      expect(result).toBe(false);
      expect(manager.getInputText()).toBe("");
    });
  });

  describe("Input History", () => {
    beforeEach(() => {
      manager.setUserInputHistory(["first", "second", "third"]);
    });

    it("should navigate up in history", () => {
      const result = manager.navigateHistory("up", "current");

      expect(result.newInput).toBe("third");
      expect(result.newCursorPosition).toBe(5);
    });

    it("should navigate down in history", () => {
      manager.navigateHistory("up", "current");
      manager.navigateHistory("up", "third");

      const result = manager.navigateHistory("down", "second");

      expect(result.newInput).toBe("third");
      expect(result.newCursorPosition).toBe(5);
    });

    it("should restore current input when navigating down from start", () => {
      manager.navigateHistory("up", "current");

      const result = manager.navigateHistory("down", "third");

      expect(result.newInput).toBe("current");
      expect(result.newCursorPosition).toBe(7);
    });

    it("should reset history navigation", () => {
      manager.navigateHistory("up", "current");
      manager.resetHistoryNavigation();

      // Should start fresh
      const result = manager.navigateHistory("up", "new");
      expect(result.newInput).toBe("third");
    });
  });

  describe("Long Text Compression", () => {
    it("should compress long text", () => {
      const longText = "a".repeat(300);
      const compressed = manager.generateCompressedText(longText);

      expect(compressed).toBe("[LongText#1]");
    });

    it("should expand compressed text", () => {
      const longText = "a".repeat(300);
      const compressed = manager.generateCompressedText(longText);

      const expanded = manager.expandLongTextPlaceholders(compressed);

      expect(expanded).toBe(longText);
    });

    it("should clear long text map", () => {
      const longText = "a".repeat(300);
      const compressed = manager.generateCompressedText(longText);

      manager.clearLongTextMap();

      const expanded = manager.expandLongTextPlaceholders(compressed);
      expect(expanded).toBe(compressed); // Should not expand after clearing
    });
  });

  describe("Task/MCP Manager State", () => {
    it("should set background task manager state", () => {
      manager.setShowBackgroundTaskManager(true);

      expect(manager.getShowBackgroundTaskManager()).toBe(true);
      expect(
        mockCallbacks.onBackgroundTaskManagerStateChange,
      ).toHaveBeenCalledWith(true);
    });

    it("should set MCP manager state", () => {
      manager.setShowMcpManager(true);

      expect(manager.getShowMcpManager()).toBe(true);
      expect(mockCallbacks.onMcpManagerStateChange).toHaveBeenCalledWith(true);
    });

    it("should consume input when background task manager is active", async () => {
      manager.setShowBackgroundTaskManager(true);
      const mockKey: Key = {
        return: false,
        upArrow: false,
        downArrow: false,
        leftArrow: false,
        rightArrow: false,
        escape: false,
        ctrl: false,
        backspace: false,
        delete: false,
        pageDown: false,
        pageUp: false,
        shift: false,
        tab: false,
        meta: false,
      };

      const handled = await manager.handleInput("k", mockKey, [], false, false);

      expect(handled).toBe(true);
      expect(manager.getInputText()).toBe(""); // Should not have added 'k'
    });

    it("should update internal state when opening background task manager via command", async () => {
      manager.insertTextAtCursor("/tasks");
      manager.activateCommandSelector(0);

      // Mock onHasSlashCommand to return false so it falls through to local commands
      mockCallbacks.onHasSlashCommand = vi.fn().mockReturnValue(false);

      manager.handleCommandSelect("tasks");

      // Wait for async command execution
      await vi.waitFor(() =>
        expect(manager.getShowBackgroundTaskManager()).toBe(true),
      );

      const mockKey: Key = {
        return: false,
        upArrow: false,
        downArrow: false,
        leftArrow: false,
        rightArrow: false,
        escape: false,
        ctrl: false,
        backspace: false,
        delete: false,
        pageDown: false,
        pageUp: false,
        shift: false,
        tab: false,
        meta: false,
      };

      const handled = await manager.handleInput("k", mockKey, [], false, false);
      expect(handled).toBe(true);
      expect(manager.getInputText()).toBe("");
    });
  });

  describe("Handle Input Integration", () => {
    it("should handle normal character input", async () => {
      const mockKey: Key = {
        upArrow: false,
        downArrow: false,
        leftArrow: false,
        rightArrow: false,
        return: false,
        escape: false,
        ctrl: false,
        backspace: false,
        delete: false,
        pageDown: false,
        pageUp: false,
        shift: false,
        tab: false,
        meta: false,
      };

      await manager.handleInput("a", mockKey, [], false, false);

      expect(manager.getInputText()).toBe("a");
    });

    it("should handle Enter key for submission", async () => {
      manager.insertTextAtCursor("test message");

      const mockKey: Key = {
        return: true,
        upArrow: false,
        downArrow: false,
        leftArrow: false,
        rightArrow: false,
        escape: false,
        ctrl: false,
        backspace: false,
        delete: false,
        pageDown: false,
        pageUp: false,
        shift: false,
        tab: false,
        meta: false,
      };

      await manager.handleInput("", mockKey, [], false, false);

      expect(mockCallbacks.onSendMessage).toHaveBeenCalledWith(
        "test message",
        undefined,
      );
      expect(manager.getInputText()).toBe("");
    });

    it("should handle Ctrl+V for image paste", async () => {
      mockReadClipboardImage.mockResolvedValue({
        success: true,
        imagePath: "/tmp/test.png",
        mimeType: "image/png",
      });

      const mockKey: Key = {
        ctrl: true,
        return: false,
        upArrow: false,
        downArrow: false,
        leftArrow: false,
        rightArrow: false,
        escape: false,
        backspace: false,
        delete: false,
        pageDown: false,
        pageUp: false,
        shift: false,
        tab: false,
        meta: false,
      };

      await manager.handleInput("v", mockKey, [], false, false);

      expect(manager.getInputText()).toBe("[Image #1]");
    });

    it("should handle Ctrl+R for history search", async () => {
      const mockKey: Key = {
        ctrl: true,
        return: false,
        upArrow: false,
        downArrow: false,
        leftArrow: false,
        rightArrow: false,
        escape: false,
        backspace: false,
        delete: false,
        pageDown: false,
        pageUp: false,
        shift: false,
        tab: false,
        meta: false,
      };

      await manager.handleInput("r", mockKey, [], false, false);

      expect(mockCallbacks.onHistorySearchStateChange).toHaveBeenCalledWith(
        true,
        "",
      );
    });

    it("should handle escape to abort during loading", async () => {
      const mockKey: Key = {
        escape: true,
        return: false,
        upArrow: false,
        downArrow: false,
        leftArrow: false,
        rightArrow: false,
        ctrl: false,
        backspace: false,
        delete: false,
        pageDown: false,
        pageUp: false,
        shift: false,
        tab: false,
        meta: false,
      };

      await manager.handleInput("", mockKey, [], true, false); // isLoading = true

      expect(mockCallbacks.onAbortMessage).toHaveBeenCalled();
    });

    it("should NOT handle escape to abort during loading if background task manager is active", async () => {
      manager.setShowBackgroundTaskManager(true);
      const mockKey: Key = {
        escape: true,
        return: false,
        upArrow: false,
        downArrow: false,
        leftArrow: false,
        rightArrow: false,
        ctrl: false,
        backspace: false,
        delete: false,
        pageDown: false,
        pageUp: false,
        shift: false,
        tab: false,
        meta: false,
      };

      await manager.handleInput("", mockKey, [], true, false); // isLoading = true

      expect(mockCallbacks.onAbortMessage).not.toHaveBeenCalled();
    });

    it("should NOT handle escape to abort during loading if MCP manager is active", async () => {
      manager.setShowMcpManager(true);
      const mockKey: Key = {
        escape: true,
        return: false,
        upArrow: false,
        downArrow: false,
        leftArrow: false,
        rightArrow: false,
        ctrl: false,
        backspace: false,
        delete: false,
        pageDown: false,
        pageUp: false,
        shift: false,
        tab: false,
        meta: false,
      };

      await manager.handleInput("", mockKey, [], true, false); // isLoading = true

      expect(mockCallbacks.onAbortMessage).not.toHaveBeenCalled();
    });

    it("should NOT handle escape to abort during loading if Rewind manager is active", async () => {
      manager.setShowRewindManager(true);
      const mockKey: Key = {
        escape: true,
        return: false,
        upArrow: false,
        downArrow: false,
        leftArrow: false,
        rightArrow: false,
        ctrl: false,
        backspace: false,
        delete: false,
        pageDown: false,
        pageUp: false,
        shift: false,
        tab: false,
        meta: false,
      };

      await manager.handleInput("", mockKey, [], true, false); // isLoading = true

      expect(mockCallbacks.onAbortMessage).not.toHaveBeenCalled();
    });

    it("should prevent submission when loading", async () => {
      manager.insertTextAtCursor("test");

      const mockKey: Key = {
        return: true,
        upArrow: false,
        downArrow: false,
        leftArrow: false,
        rightArrow: false,
        escape: false,
        ctrl: false,
        backspace: false,
        delete: false,
        pageDown: false,
        pageUp: false,
        shift: false,
        tab: false,
        meta: false,
      };

      await manager.handleInput("", mockKey, [], true, false); // isLoading = true

      expect(mockCallbacks.onSendMessage).not.toHaveBeenCalled();
      expect(manager.getInputText()).toBe("test"); // Should not clear
    });
  });

  describe("Special Character Handling", () => {
    it("should activate file selector on @", () => {
      manager.insertTextAtCursor("@");
      manager.handleSpecialCharInput("@");

      expect(mockCallbacks.onFileSelectorStateChange).toHaveBeenCalledWith(
        true,
        [],
        "",
        0,
      );
    });

    it("should activate command selector on / at start", () => {
      manager.insertTextAtCursor("/");
      manager.handleSpecialCharInput("/");

      expect(mockCallbacks.onCommandSelectorStateChange).toHaveBeenCalledWith(
        true,
        "",
        0,
      );
    });

    it("should NOT activate command selector on / NOT at start", () => {
      manager.insertTextAtCursor("text /");
      manager.handleSpecialCharInput("/");

      expect(mockCallbacks.onCommandSelectorStateChange).not.toHaveBeenCalled();
    });
  });

  describe("Submit Logic", () => {
    it("should handle message with images", async () => {
      manager.insertTextAtCursor("Check this [Image #1] out");
      const images = [{ id: 1, path: "/test.png", mimeType: "image/png" }];

      await manager.handleSubmit(images, false, false);

      expect(mockCallbacks.onSendMessage).toHaveBeenCalledWith(
        "Check this  out",
        [{ path: "/test.png", mimeType: "image/png" }],
      );
    });

    it("should expand long text on submission", async () => {
      const longText = "a".repeat(300);
      const compressed = manager.generateCompressedText(longText);
      manager.insertTextAtCursor(compressed);

      await manager.handleSubmit([], false, false);

      expect(mockCallbacks.onSendMessage).toHaveBeenCalledWith(
        longText,
        undefined,
      );
    });
  });

  describe("Edge Cases and Branch Coverage", () => {
    it("should handle deleteCharAtCursor when cursor is at 0", () => {
      manager.insertTextAtCursor("test");
      manager.setCursorPosition(0);
      manager.deleteCharAtCursor();
      expect(manager.getInputText()).toBe("test");
      expect(manager.getCursorPosition()).toBe(0);
    });

    it("should handle navigateHistory down to -2", () => {
      manager.setUserInputHistory(["one"]);
      manager.navigateHistory("up", "current"); // index 0, text "one"
      manager.navigateHistory("down", "one"); // index -1, text "current"
      const result = manager.navigateHistory("down", "current"); // index -2, text ""
      expect(result.newInput).toBe("");
      expect(manager.getCursorPosition()).toBe(0);
    });

    it("should handle navigateHistory with empty history", () => {
      manager.setUserInputHistory([]);
      const result = manager.navigateHistory("up", "");
      expect(result.newInput).toBe("");
    });

    it("should handle handleFileSelect when atPosition is -1", () => {
      const result = manager.handleFileSelect("test.ts");
      expect(result.newInput).toBe("");
    });

    it("should handle handleCommandSelect when slashPosition is -1", () => {
      const result = manager.handleCommandSelect("test");
      expect(result.newInput).toBe("");
    });

    it("should handle handleCommandInsert when slashPosition is -1", () => {
      const result = manager.handleCommandInsert("test");
      expect(result.newInput).toBe("");
    });

    it("should handle handleCommandSelect for local commands", async () => {
      manager.insertTextAtCursor("/tasks");
      manager.activateCommandSelector(0);
      manager.handleCommandSelect("tasks");
      await vi.waitFor(() =>
        expect(
          mockCallbacks.onBackgroundTaskManagerStateChange,
        ).toHaveBeenCalledWith(true),
      );

      manager.clearInput();
      manager.insertTextAtCursor("/mcp");
      manager.activateCommandSelector(0);
      manager.handleCommandSelect("mcp");
      await vi.waitFor(() =>
        expect(mockCallbacks.onMcpManagerStateChange).toHaveBeenCalledWith(
          true,
        ),
      );

      manager.clearInput();
      manager.insertTextAtCursor("/rewind");
      manager.activateCommandSelector(0);
      manager.handleCommandSelect("rewind");
      await vi.waitFor(() =>
        expect(mockCallbacks.onRewindManagerStateChange).toHaveBeenCalledWith(
          true,
        ),
      );
    });

    it("should handle handlePasteInput with Chinese exclamation mark", () => {
      manager.handlePasteInput("！");
      expect(manager.getInputText()).toBe("!");
    });

    it("should handle handlePasteInput with multi-character string (not debounced yet)", () => {
      vi.useFakeTimers();
      manager.handlePasteInput("multi");
      expect(manager.getInputText()).toBe(""); // Still in buffer
      vi.runAllTimers();
      expect(manager.getInputText()).toBe("multi");
      vi.useRealTimers();
    });

    it("should handle handleInput with selectorJustUsed", async () => {
      // We need to access private property or trigger the timeout
      manager.insertTextAtCursor("@");
      manager.activateFileSelector(0);
      manager.handleFileSelect("file.ts");

      const mockKey: Key = { return: true } as unknown as Key;
      const handled = await manager.handleInput("", mockKey, []);
      expect(handled).toBe(true); // Should return true and do nothing
    });

    it("should handle handleInput with escape during loading", async () => {
      const mockKey: Key = { escape: true } as unknown as Key;
      const handled = await manager.handleInput("", mockKey, [], true, false);
      expect(handled).toBe(true);
      expect(mockCallbacks.onAbortMessage).toHaveBeenCalled();
    });

    it("should handle handleInput with Shift+Tab", async () => {
      const mockKey: Key = { tab: true, shift: true } as unknown as Key;
      const handled = await manager.handleInput("", mockKey, []);
      expect(handled).toBe(true);
      expect(manager.getPermissionMode()).toBe("acceptEdits");
    });

    it("should handle handleInput for history search backspace and input", async () => {
      manager.activateHistorySearch();
      const backspaceKey: Key = { backspace: true } as unknown as Key;
      await manager.handleInput("", backspaceKey, []); // Should do nothing as query is empty

      manager.updateHistorySearchQuery("a");
      await manager.handleInput("", backspaceKey, []);
      // We can't easily check historySearchQuery as it's private, but we can check if callback was called
      expect(mockCallbacks.onHistorySearchStateChange).toHaveBeenCalledWith(
        true,
        "",
      );

      await manager.handleInput("b", {} as unknown as Key, []);
      expect(mockCallbacks.onHistorySearchStateChange).toHaveBeenCalledWith(
        true,
        "b",
      );
    });

    it("should handle handleSelectorInput with backspace", () => {
      manager.insertTextAtCursor("@a");
      manager.activateFileSelector(0);
      const backspaceKey: Key = { backspace: true } as unknown as Key;
      manager.handleSelectorInput("", backspaceKey);
      expect(manager.getInputText()).toBe("@");
    });

    it("should handle handleSelectorInput with navigation keys", () => {
      manager.activateFileSelector(0);
      const upKey: Key = { upArrow: true } as unknown as Key;
      const handled = manager.handleSelectorInput("", upKey);
      expect(handled).toBe(true);
    });

    it("should handle handleSubmit with empty input", async () => {
      await manager.handleSubmit([], false, false);
      expect(mockCallbacks.onSendMessage).not.toHaveBeenCalled();
    });

    it("should handle updateCallbacks", () => {
      const newOnInputTextChange = vi.fn();
      manager.updateCallbacks({ onInputTextChange: newOnInputTextChange });
      manager.insertTextAtCursor("a");
      expect(newOnInputTextChange).toHaveBeenCalledWith("a");
    });

    it("should handle searchFiles error", async () => {
      const consoleSpy = vi
        .spyOn(console, "error")
        .mockImplementation(() => {});
      mockSearchFiles.mockRejectedValue(new Error("search failed"));
      (manager as unknown as { showFileSelector: boolean }).showFileSelector =
        true;
      (manager as unknown as { fileSearchQuery: string }).fileSearchQuery =
        "query";
      await (
        manager as unknown as { searchFiles: (query: string) => Promise<void> }
      ).searchFiles("query");
      expect(mockCallbacks.onFileSelectorStateChange).toHaveBeenCalledWith(
        true,
        [],
        "query",
        -1,
      );
      consoleSpy.mockRestore();
    });
  });
});
