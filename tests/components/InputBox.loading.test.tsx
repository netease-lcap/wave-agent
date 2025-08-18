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

vi.mock("@/hooks/useInputKeyboardHandler", () => ({
  useInputKeyboardHandler: () => ({
    handleFileSelect: vi.fn(),
    handleCommandSelect: vi.fn(),
    handleCommandGenerated: vi.fn(),
    handleBashHistorySelect: vi.fn(),
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
});
