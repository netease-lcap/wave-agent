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
  }),
}));

vi.mock("@/hooks/useTextInsertion", () => ({
  useTextInsertion: vi.fn(),
}));

vi.mock("@/hooks/useClipboardPaste", () => ({
  useClipboardPaste: () => ({
    handlePasteImage: vi.fn(),
  }),
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

  it("should show AI thinking placeholder when loading", async () => {
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

    expect(output).toContain("AI is thinking...");
    expect(output).toContain("5s"); // Timer显示
    expect(output).not.toContain("Type your message");
    // Should not contain the emoji icon
    expect(output).not.toContain("🤔");
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

    expect(output).toContain("[Press Esc to abort]");
  });

  it("should show command running placeholder when command is running", async () => {
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

    expect(output).toContain("Command is running...");
    expect(output).not.toContain("Press Esc to abort");
    expect(output).not.toContain("Type your message");
    expect(output).not.toContain("AI is thinking");
  });

  it("should prioritize AI loading state over command running state", async () => {
    // Mock useChat to return both isLoading: true and isCommandRunning: true
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

    // Should show AI thinking state, not command running state
    expect(output).toContain("AI is thinking...");
    expect(output).toContain("5s"); // Timer显示
    expect(output).toContain("1,500");
    expect(output).not.toContain("Command is running");
  });

  describe("Loading Timer Display", () => {
    it("should display timer in seconds format", async () => {
      // Mock useLoadingTimer to return short time
      const { useLoadingTimer } = await import("@/hooks/useLoadingTimer");
      (useLoadingTimer as ReturnType<typeof vi.fn>).mockReturnValue({
        elapsedTime: 30,
        formattedTime: "30s",
      });

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

      expect(output).toContain("30s");
    });

    it("should display timer in minutes and seconds format", async () => {
      // Mock useLoadingTimer to return longer time
      const { useLoadingTimer } = await import("@/hooks/useLoadingTimer");
      (useLoadingTimer as ReturnType<typeof vi.fn>).mockReturnValue({
        elapsedTime: 125,
        formattedTime: "2m 5s",
      });

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

      expect(output).toContain("2m 5s");
    });

    it("should display exact minute timing", async () => {
      // Mock useLoadingTimer to return exact minute
      const { useLoadingTimer } = await import("@/hooks/useLoadingTimer");
      (useLoadingTimer as ReturnType<typeof vi.fn>).mockReturnValue({
        elapsedTime: 60,
        formattedTime: "1m 0s",
      });

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

      expect(output).toContain("1m 0s");
    });

    it("should not display timer when not loading", async () => {
      // Mock useLoadingTimer but not loading
      const { useLoadingTimer } = await import("@/hooks/useLoadingTimer");
      (useLoadingTimer as ReturnType<typeof vi.fn>).mockReturnValue({
        elapsedTime: 0,
        formattedTime: "0s",
      });

      // Mock useChat to return isLoading: false
      const { useChat } = await import("@/contexts/useChat");
      vi.mocked(useChat).mockReturnValue({
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
      });

      const { lastFrame } = render(<InputBox />);
      const output = lastFrame();

      expect(output).not.toContain("0s");
      expect(output).toContain("Type your message");
    });
  });
});
