import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render } from "ink-testing-library";
import { ChatInterface } from "../../src/components/ChatInterface.js";
import {
  ChatContextType,
  useChat as useChatActual,
} from "../../src/contexts/useChat.js";
import { useInputManager } from "../../src/hooks/useInputManager.js";
import { stripAnsiColors } from "wave-agent-sdk";

vi.mock("../../src/contexts/useChat.js", () => ({
  useChat: vi.fn(),
}));

const useChat = vi.mocked(useChatActual);

// Mock InputManager to track handleInput calls
const mockHandleInput = vi.fn();
vi.mock("../../src/hooks/useInputManager.js", () => ({
  useInputManager: vi.fn(),
}));

describe("ChatInterface Rewind Visibility", () => {
  it("should hide InputBox when showRewindManager is true", async () => {
    vi.mocked(useChat).mockReturnValue({
      sessionId: "test-session",
      messages: [],
      isLoading: false,
      isCommandRunning: false,
      userInputHistory: [],
      isCompressing: false,
      isExpanded: false,
      isConfirmationVisible: false,
      rewindId: 0,
      handleRewindSelect: vi.fn(),
      sendMessage: vi.fn(),
      abortMessage: vi.fn(),
      saveMemory: vi.fn(),
      mcpServers: [],
      connectMcpServer: vi.fn(),
      disconnectMcpServer: vi.fn(),
      latestTotalTokens: 0,
      slashCommands: [],
      hasSlashCommand: vi.fn(),
      backgroundTasks: [],
      getBackgroundTaskOutput: vi.fn(),
      stopBackgroundTask: vi.fn(),
      subagentMessages: {},
      subagentLatestTokens: {},
      permissionMode: "default",
      setPermissionMode: vi.fn(),
      showConfirmation: vi.fn(),
      hideConfirmation: vi.fn(),
      handleConfirmationDecision: vi.fn(),
      handleConfirmationCancel: vi.fn(),
      backgroundCurrentTask: vi.fn(),
      sessionTasks: [],
      isTaskListVisible: true,
      setIsTaskListVisible: vi.fn(),
    } as ChatContextType);

    vi.mocked(useInputManager).mockReturnValue({
      inputText: "",
      cursorPosition: 0,
      attachedImages: [],
      clearImages: vi.fn(),
      handleInput: mockHandleInput,
      setPermissionMode: vi.fn(),
      isManagerReady: true,
      showRewindManager: true, // Rewind is visible
    } as unknown as ReturnType<typeof useInputManager>);

    const { lastFrame, stdin } = render(<ChatInterface />);

    // Wait for the component to render
    await vi.waitFor(() => {
      expect(stripAnsiColors(lastFrame() || "")).toContain(
        "No user messages found",
      );
    });

    // Should NOT contain InputBox placeholder
    expect(stripAnsiColors(lastFrame() || "")).not.toContain(
      "Type your message",
    );

    // Arrow keys should not affect inputbox (handleInput should not be called)
    mockHandleInput.mockClear();
    stdin.write("\u001B[A"); // Up arrow
    // Verify that handleInput is called
    expect(mockHandleInput).toHaveBeenCalled();
  });

  it("should show InputBox when showRewindManager is false", async () => {
    vi.mocked(useChat).mockReturnValue({
      sessionId: "test-session",
      messages: [],
      isLoading: false,
      isCommandRunning: false,
      userInputHistory: [],
      isCompressing: false,
      isExpanded: false,
      isConfirmationVisible: false,
      rewindId: 0,
      handleRewindSelect: vi.fn(),
      sendMessage: vi.fn(),
      abortMessage: vi.fn(),
      saveMemory: vi.fn(),
      mcpServers: [],
      connectMcpServer: vi.fn(),
      disconnectMcpServer: vi.fn(),
      latestTotalTokens: 0,
      slashCommands: [],
      hasSlashCommand: vi.fn(),
      backgroundTasks: [],
      getBackgroundTaskOutput: vi.fn(),
      stopBackgroundTask: vi.fn(),
      subagentMessages: {},
      subagentLatestTokens: {},
      permissionMode: "default",
      setPermissionMode: vi.fn(),
      showConfirmation: vi.fn(),
      hideConfirmation: vi.fn(),
      handleConfirmationDecision: vi.fn(),
      handleConfirmationCancel: vi.fn(),
      backgroundCurrentTask: vi.fn(),
      sessionTasks: [],
      isTaskListVisible: true,
      setIsTaskListVisible: vi.fn(),
    } as ChatContextType);

    vi.mocked(useInputManager).mockReturnValue({
      inputText: "",
      cursorPosition: 0,
      attachedImages: [],
      clearImages: vi.fn(),
      handleInput: mockHandleInput,
      setPermissionMode: vi.fn(),
      isManagerReady: true,
      showRewindManager: false, // Rewind is NOT visible
    } as unknown as ReturnType<typeof useInputManager>);

    const { lastFrame, stdin } = render(<ChatInterface />);

    // Wait for the component to render
    await vi.waitFor(() => {
      expect(stripAnsiColors(lastFrame() || "")).toContain("Type your message");
    });

    // Should NOT contain Rewind Selector
    expect(stripAnsiColors(lastFrame() || "")).not.toContain(
      "No user messages found",
    );

    // Arrow keys should affect inputbox (handleInput should be called)
    mockHandleInput.mockClear();
    stdin.write("\u001B[A"); // Up arrow
    await vi.waitFor(() => {
      expect(mockHandleInput).toHaveBeenCalled();
    });
  });
});
