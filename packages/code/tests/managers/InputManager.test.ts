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
      onMemoryTypeSelectorStateChange: vi.fn(),
      onBashManagerStateChange: vi.fn(),
      onMcpManagerStateChange: vi.fn(),
      onPluginManagerStateChange: vi.fn(),
      onImagesStateChange: vi.fn(),
      onSendMessage: vi.fn(),
      onHasSlashCommand: vi.fn(),
      onSaveMemory: vi.fn(),
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

  describe("Memory Type Selector", () => {
    it("should activate memory type selector", () => {
      const message = "#test memory";
      manager.activateMemoryTypeSelector(message);

      expect(
        mockCallbacks.onMemoryTypeSelectorStateChange,
      ).toHaveBeenCalledWith(true, message);
    });

    it("should handle memory type selection", () => {
      manager.activateMemoryTypeSelector("#test");
      manager.handleMemoryTypeSelect("project");

      expect(
        mockCallbacks.onMemoryTypeSelectorStateChange,
      ).toHaveBeenLastCalledWith(false, "");
    });

    it("should cancel memory type selector", () => {
      manager.activateMemoryTypeSelector("#test");
      manager.handleCancelMemoryTypeSelect();

      expect(
        mockCallbacks.onMemoryTypeSelectorStateChange,
      ).toHaveBeenLastCalledWith(false, "");
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

  describe("Bash/MCP Manager State", () => {
    it("should set bash manager state", () => {
      manager.setShowBashManager(true);

      expect(manager.getShowBashManager()).toBe(true);
      expect(mockCallbacks.onBashManagerStateChange).toHaveBeenCalledWith(true);
    });

    it("should set MCP manager state", () => {
      manager.setShowMcpManager(true);

      expect(manager.getShowMcpManager()).toBe(true);
      expect(mockCallbacks.onMcpManagerStateChange).toHaveBeenCalledWith(true);
    });

    it("should set plugin manager state", () => {
      manager.setShowPluginManager(true);

      expect(manager.getShowPluginManager()).toBe(true);
      expect(mockCallbacks.onPluginManagerStateChange).toHaveBeenCalledWith(
        true,
      );
    });
  });

  describe("Plugin Manager Input Interception", () => {
    it("should not update input text when plugin manager is active", async () => {
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

      // Activate plugin manager
      manager.setShowPluginManager(true);

      // Try to input text
      await manager.handleInput("a", mockKey, [], false, false);

      // Input text should remain empty
      expect(manager.getInputText()).toBe("");
    });

    it("should not cycle permission mode when plugin manager is active", async () => {
      const shiftTabKey: Key = {
        tab: true,
        shift: true,
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
        meta: false,
      };

      // 1. Set initial permission mode
      manager.setPermissionMode("default");

      // 2. Activate plugin manager
      manager.setShowPluginManager(true);

      // 3. Press Shift+Tab
      await manager.handleInput("", shiftTabKey, [], false, false);

      // 4. Verify permission mode did NOT change
      expect(manager.getPermissionMode()).toBe("default");
    });

    it("should automatically intercept input after executing /plugin command", async () => {
      const enterKey: Key = {
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

      const charKey: Key = { ...enterKey, return: false };

      // 1. Type "/plugin"
      manager.insertTextAtCursor("/plugin");

      // 2. Activate command selector manually as it would be in real usage
      manager.activateCommandSelector(0);

      // 3. Select the command (this simulates pressing Enter on the selector)
      manager.handleCommandSelect("plugin");

      // 4. Verify Plugin Manager is now active in the manager's state
      expect(manager.getShowPluginManager()).toBe(true);

      // 5. Try to type something else (e.g., "hello")
      await manager.handleInput("h", charKey, [], false, false);
      await manager.handleInput("e", charKey, [], false, false);

      // 6. The input text should be empty (it was cleared on command execution and new input was intercepted)
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

    it("should activate command selector on /", () => {
      manager.insertTextAtCursor("/");
      manager.handleSpecialCharInput("/");

      expect(mockCallbacks.onCommandSelectorStateChange).toHaveBeenCalledWith(
        true,
        "",
        0,
      );
    });
  });

  describe("Submit Logic", () => {
    it("should handle memory message submission", async () => {
      manager.insertTextAtCursor("#test memory");

      await manager.handleSubmit([], false, false);

      expect(
        mockCallbacks.onMemoryTypeSelectorStateChange,
      ).toHaveBeenCalledWith(true, "#test memory");
    });

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
});
