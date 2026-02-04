import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render } from "ink-testing-library";
import { ChatInterface } from "../../src/components/ChatInterface.js";
import { useChat } from "../../src/contexts/useChat.js";
import { stripAnsiColors } from "wave-agent-sdk";

vi.mock("../../src/contexts/useChat.js", () => ({
  useChat: vi.fn(),
}));

// Mock InputManager to track handleInput calls
const mockHandleInput = vi.fn();
vi.mock("../../src/hooks/useInputManager.js", () => ({
  useInputManager: () => ({
    inputText: "",
    cursorPosition: 0,
    attachedImages: [],
    clearImages: vi.fn(),
    handleInput: mockHandleInput,
    setPermissionMode: vi.fn(),
    setUserInputHistory: vi.fn(),
    isManagerReady: true,
  }),
}));

describe("ChatInterface Rewind Visibility", () => {
  it("should hide InputBox when isRewindVisible is true", async () => {
    (useChat as any).mockReturnValue({
      sessionId: "test-session",
      messages: [],
      isLoading: false,
      isCommandRunning: false,
      userInputHistory: [],
      isCompressing: false,
      isExpanded: false,
      isConfirmationVisible: false,
      isRewindVisible: true, // Rewind is visible
      rewindId: 0,
      handleRewindSelect: vi.fn(),
      hideRewind: vi.fn(),
      sendMessage: vi.fn(),
      abortMessage: vi.fn(),
      saveMemory: vi.fn(),
      mcpServers: [],
      connectMcpServer: vi.fn(),
      disconnectMcpServer: vi.fn(),
      latestTotalTokens: 0,
      slashCommands: [],
      hasSlashCommand: vi.fn(),
    });

    const { lastFrame, stdin } = render(<ChatInterface />);

    // Wait for the component to render
    await vi.waitFor(() => {
      expect(stripAnsiColors(lastFrame() || "")).toContain("No user messages found");
    });
    
    // Should NOT contain InputBox placeholder
    expect(stripAnsiColors(lastFrame() || "")).not.toContain("Type your message");

    // Arrow keys should not affect inputbox (handleInput should not be called)
    mockHandleInput.mockClear();
    stdin.write("\u001B[A"); // Up arrow
    expect(mockHandleInput).not.toHaveBeenCalled();
  });

  it("should show InputBox when isRewindVisible is false", async () => {
    (useChat as any).mockReturnValue({
      sessionId: "test-session",
      messages: [],
      isLoading: false,
      isCommandRunning: false,
      userInputHistory: [],
      isCompressing: false,
      isExpanded: false,
      isConfirmationVisible: false,
      isRewindVisible: false, // Rewind is NOT visible
      rewindId: 0,
      handleRewindSelect: vi.fn(),
      hideRewind: vi.fn(),
      sendMessage: vi.fn(),
      abortMessage: vi.fn(),
      saveMemory: vi.fn(),
      mcpServers: [],
      connectMcpServer: vi.fn(),
      disconnectMcpServer: vi.fn(),
      latestTotalTokens: 0,
      slashCommands: [],
      hasSlashCommand: vi.fn(),
    });

    const { lastFrame, stdin } = render(<ChatInterface />);

    // Wait for the component to render
    await vi.waitFor(() => {
      expect(stripAnsiColors(lastFrame() || "")).toContain("Type your message");
    });
    
    // Should NOT contain Rewind Selector
    expect(stripAnsiColors(lastFrame() || "")).not.toContain("No user messages found");

    // Arrow keys should affect inputbox (handleInput should be called)
    mockHandleInput.mockClear();
    stdin.write("\u001B[A"); // Up arrow
    await vi.waitFor(() => {
      expect(mockHandleInput).toHaveBeenCalled();
    });
  });
});
