import React from "react";
import { render } from "ink-testing-library";
import { describe, it, expect, vi } from "vitest";
import { InputBox } from "@/components/InputBox";

// Mock useChat hook
vi.mock("@/contexts/useChat", () => ({
  useChat: vi.fn(() => ({
    isCommandRunning: false,
    isLoading: false,
    insertToInput: vi.fn(),
    sendMessage: vi.fn(),
    abortMessage: vi.fn(),
    clearMessages: vi.fn(),
    messages: [],
    setMessages: vi.fn(),
    setIsLoading: vi.fn(),
    executeCommand: vi.fn(),
    abortCommand: vi.fn(),
    userInputHistory: [],
    addToInputHistory: vi.fn(),
    inputInsertHandler: null,
    setInputInsertHandler: vi.fn(),
    sessionId: "test-session",
    sendAIMessage: vi.fn(),
    abortAIMessage: vi.fn(),
    resetSession: vi.fn(),
    saveMemory: vi.fn(),
    totalTokens: 0,
  })),
}));

// Mock other hooks
vi.mock("@/hooks/useInputState", () => ({
  useInputState: () => ({
    inputText: "",
    setInputText: vi.fn(),
    cursorPosition: 0,
    setCursorPosition: vi.fn(),
    insertTextAtCursor: vi.fn(),
    deleteCharAtCursor: vi.fn(),
    clearInput: vi.fn(),
    moveCursorLeft: vi.fn(),
    moveCursorRight: vi.fn(),
    moveCursorToStart: vi.fn(),
    moveCursorToEnd: vi.fn(),
  }),
}));

vi.mock("@/hooks/useFileSelector", () => ({
  useFileSelector: () => ({
    showFileSelector: false,
    filteredFiles: [],
    searchQuery: "",
    activateFileSelector: vi.fn(),
    handleFileSelect: vi.fn(),
    handleCancelFileSelect: vi.fn(),
    updateSearchQuery: vi.fn(),
    checkForAtDeletion: vi.fn(),
    atPosition: -1,
  }),
}));

vi.mock("@/hooks/useCommandSelector", () => ({
  useCommandSelector: () => ({
    showCommandSelector: false,
    commandSearchQuery: "",
    activateCommandSelector: vi.fn(),
    handleCommandSelect: vi.fn(),
    handleCommandGenerated: vi.fn(),
    handleCancelCommandSelect: vi.fn(),
    updateCommandSearchQuery: vi.fn(),
    checkForSlashDeletion: vi.fn(),
    slashPosition: -1,
  }),
}));

vi.mock("@/hooks/useBashHistorySelector", () => ({
  useBashHistorySelector: () => ({
    showBashHistorySelector: false,
    bashHistorySearchQuery: "",
    activateBashHistorySelector: vi.fn(),
    handleBashHistorySelect: vi.fn(),
    handleCancelBashHistorySelect: vi.fn(),
    updateBashHistorySearchQuery: vi.fn(),
    checkForExclamationDeletion: vi.fn(),
    exclamationPosition: -1,
  }),
}));

vi.mock("@/hooks/useInputHistory", () => ({
  useInputHistory: () => ({
    resetHistoryNavigation: vi.fn(),
    navigateHistory: vi.fn(),
  }),
}));

vi.mock("@/hooks/useImageManager", () => ({
  useImageManager: () => ({
    attachedImages: [],
    addImage: vi.fn(),
    clearImages: vi.fn(),
    handlePasteImage: vi.fn(),
  }),
}));

vi.mock("@/hooks/useTextInsertion", () => ({
  useTextInsertion: vi.fn(),
}));

vi.mock("@/hooks/useLoadingTimer", () => ({
  useLoadingTimer: vi.fn(() => ({
    elapsedTime: 0,
    formattedTime: "5s",
  })),
}));
vi.mock("@/hooks/useInputKeyboardHandler", () => ({
  useInputKeyboardHandler: () => ({
    handleFileSelect: vi.fn(),
    handleCommandSelect: vi.fn(),
    handleCommandGenerated: vi.fn(),
    handleBashHistorySelect: vi.fn(),
    handleMemoryTypeSelect: vi.fn(),
  }),
}));

vi.mock("@/hooks/useMemoryMode", () => ({
  useMemoryMode: () => ({
    isMemoryMode: false,
    checkMemoryMode: vi.fn(),
  }),
}));

vi.mock("@/hooks/useMemoryTypeSelector", () => ({
  useMemoryTypeSelector: () => ({
    showMemoryTypeSelector: false,
    memoryMessage: "",
    activateMemoryTypeSelector: vi.fn(),
    handleMemoryTypeSelect: vi.fn(),
    handleCancelMemoryTypeSelect: vi.fn(),
  }),
}));

describe("InputBox Loading State", () => {
  it("should show normal placeholder when not loading", async () => {
    const { lastFrame } = render(<InputBox />);
    const output = lastFrame();

    expect(output).toContain("Type your message");
    expect(output).not.toContain("AI is thinking");
  });

  it("should show normal placeholder even when loading (loading message moved to MessageList)", async () => {
    // Mock useChat to return isLoading: true
    const { useChat } = await import("@/contexts/useChat");
    vi.mocked(useChat).mockReturnValue({
      isCommandRunning: false,
      isLoading: true,
      insertToInput: vi.fn(),
      sendMessage: vi.fn(),
      abortMessage: vi.fn(),
      clearMessages: vi.fn(),
      messages: [],
      setMessages: vi.fn(),
      setIsLoading: vi.fn(),
      executeCommand: vi.fn(),
      abortCommand: vi.fn(),
      userInputHistory: [],
      addToInputHistory: vi.fn(),
      inputInsertHandler: null,
      setInputInsertHandler: vi.fn(),
      sessionId: "test-session",
      sendAIMessage: vi.fn(),
      abortAIMessage: vi.fn(),
      resetSession: vi.fn(),
      saveMemory: vi.fn(),
      totalTokens: 0,
    });

    const { lastFrame } = render(<InputBox />);
    const output = lastFrame();

    // Should show normal placeholder, not loading message
    expect(output).toContain("Type your message");
    expect(output).not.toContain("AI is thinking...");
  });

  it("should show escape key hint when loading", async () => {
    // Mock useChat to return isLoading: true
    const { useChat } = await import("@/contexts/useChat");
    vi.mocked(useChat).mockReturnValue({
      isCommandRunning: false,
      isLoading: true,
      insertToInput: vi.fn(),
      sendMessage: vi.fn(),
      abortMessage: vi.fn(),
      clearMessages: vi.fn(),
      messages: [],
      setMessages: vi.fn(),
      setIsLoading: vi.fn(),
      executeCommand: vi.fn(),
      abortCommand: vi.fn(),
      userInputHistory: [],
      addToInputHistory: vi.fn(),
      inputInsertHandler: null,
      setInputInsertHandler: vi.fn(),
      sessionId: "test-session",
      sendAIMessage: vi.fn(),
      abortAIMessage: vi.fn(),
      resetSession: vi.fn(),
      saveMemory: vi.fn(),
      totalTokens: 0,
    });

    const { lastFrame } = render(<InputBox />);
    const output = lastFrame();

    // Check for escape hint text - it might be split across lines
    expect(output).toMatch(/Press Esc to[\s\S]*abort/);
  });

  it("should show normal placeholder when command is running (status message moved to MessageList)", async () => {
    // Mock useChat to return isCommandRunning: true
    const { useChat } = await import("@/contexts/useChat");
    vi.mocked(useChat).mockReturnValue({
      isCommandRunning: true,
      isLoading: false,
      insertToInput: vi.fn(),
      sendMessage: vi.fn(),
      abortMessage: vi.fn(),
      clearMessages: vi.fn(),
      messages: [],
      setMessages: vi.fn(),
      setIsLoading: vi.fn(),
      executeCommand: vi.fn(),
      abortCommand: vi.fn(),
      userInputHistory: [],
      addToInputHistory: vi.fn(),
      inputInsertHandler: null,
      setInputInsertHandler: vi.fn(),
      sessionId: "test-session",
      sendAIMessage: vi.fn(),
      abortAIMessage: vi.fn(),
      resetSession: vi.fn(),
      saveMemory: vi.fn(),
      totalTokens: 0,
    });

    const { lastFrame } = render(<InputBox />);
    const output = lastFrame();

    // Should show normal placeholder, not command running message
    expect(output).toContain("Type your message");
    expect(output).not.toContain("Command is running...");
    expect(output).not.toContain("Press Esc to abort");
  });

  it("should show normal placeholder even when both loading and command running", async () => {
    // Mock useChat to return both states true
    const { useChat } = await import("@/contexts/useChat");
    vi.mocked(useChat).mockReturnValue({
      isCommandRunning: true,
      isLoading: true,
      insertToInput: vi.fn(),
      sendMessage: vi.fn(),
      abortMessage: vi.fn(),
      clearMessages: vi.fn(),
      messages: [],
      setMessages: vi.fn(),
      setIsLoading: vi.fn(),
      executeCommand: vi.fn(),
      abortCommand: vi.fn(),
      userInputHistory: [],
      addToInputHistory: vi.fn(),
      inputInsertHandler: null,
      setInputInsertHandler: vi.fn(),
      sessionId: "test-session",
      sendAIMessage: vi.fn(),
      abortAIMessage: vi.fn(),
      resetSession: vi.fn(),
      saveMemory: vi.fn(),
      totalTokens: 1500,
    });

    const { lastFrame } = render(<InputBox />);
    const output = lastFrame();

    // Should show normal placeholder
    expect(output).toContain("Type your message");
    expect(output).not.toContain("AI is thinking...");
    expect(output).not.toContain("Command is running...");

    // But should show abort hint since loading is true (might be split across lines)
    expect(output).toMatch(/Press Esc to[\s\S]*abort/);
  });

  // Loading timer tests are no longer relevant since loading message moved to MessageList
  describe("Loading State - Cursor and Input Availability", () => {
    it("should show cursor and allow input when not loading", async () => {
      const { lastFrame } = render(<InputBox />);
      const output = lastFrame();

      // Should show normal placeholder
      expect(output).toContain("Type your message");
      // Cursor should be visible (indicated by the input area being active)
    });

    it("should show cursor and allow input even when loading", async () => {
      // Mock useChat to return isLoading: true
      const { useChat } = await import("@/contexts/useChat");
      vi.mocked(useChat).mockReturnValue({
        isCommandRunning: false,
        isLoading: true,
        insertToInput: vi.fn(),
        sendMessage: vi.fn(),
        abortMessage: vi.fn(),
        clearMessages: vi.fn(),
        messages: [],
        setMessages: vi.fn(),
        setIsLoading: vi.fn(),
        executeCommand: vi.fn(),
        abortCommand: vi.fn(),
        userInputHistory: [],
        addToInputHistory: vi.fn(),
        inputInsertHandler: null,
        setInputInsertHandler: vi.fn(),
        sessionId: "test-session",
        sendAIMessage: vi.fn(),
        abortAIMessage: vi.fn(),
        resetSession: vi.fn(),
        saveMemory: vi.fn(),
        totalTokens: 1000,
      });

      const { lastFrame } = render(<InputBox />);
      const output = lastFrame();

      // Should show normal placeholder, allowing user to continue typing
      expect(output).toContain("Type your message");
      expect(output).toMatch(/Press Esc to[\s\S]*abort/);
    });
  });
});
