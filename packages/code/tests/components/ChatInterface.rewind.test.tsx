import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render } from "ink-testing-library";
import { ChatInterface } from "../../src/components/ChatInterface.js";
import {
  ChatContextType,
  useChat as useChatActual,
} from "../../src/contexts/useChat.js";
import { stripAnsiColors } from "wave-agent-sdk";
import { initialState } from "../../src/reducers/inputReducer.js";

vi.mock("../../src/contexts/useChat.js", () => ({
  useChat: vi.fn(),
}));

const useChat = vi.mocked(useChatActual);

describe("ChatInterface Rewind Visibility", () => {
  it("should hide InputBox when showRewindManager is true", async () => {
    vi.mocked(useChat).mockReturnValue({
      sessionId: "test-session",
      messages: [],
      isLoading: false,
      isCommandRunning: false,
      isCompressing: false,
      isExpanded: false,
      isConfirmationVisible: false,
      remountKey: 0,
      requestRemount: vi.fn(),
      handleRewindSelect: vi.fn(),
      sendMessage: vi.fn(),
      abortMessage: vi.fn(),
      mcpServers: [],
      connectMcpServer: vi.fn(),
      disconnectMcpServer: vi.fn(),
      latestTotalTokens: 0,
      slashCommands: [],
      hasSlashCommand: vi.fn(),
      backgroundTasks: [],
      getBackgroundTaskOutput: vi.fn(),
      stopBackgroundTask: vi.fn(),
      permissionMode: "default",
      setPermissionMode: vi.fn(),
      showConfirmation: vi.fn(),
      hideConfirmation: vi.fn(),
      handleConfirmationDecision: vi.fn(),
      handleConfirmationCancel: vi.fn(),
      backgroundCurrentTask: vi.fn(),
      tasks: [],
      isTaskListVisible: true,
      setIsTaskListVisible: vi.fn(),
      allowBypassInCycle: false,
      inputState: {
        ...initialState,
        showRewindManager: true, // Rewind is visible
      },
      inputDispatch: vi.fn(),
      currentModel: "",
      configuredModels: [],
      setModel: vi.fn(),
      askBtw: vi.fn(),
      getModelConfig: vi.fn().mockReturnValue({
        model: "test-model",
        fastModel: "test-fast-model",
      }),
      getFullMessageThread: vi
        .fn()
        .mockResolvedValue({ messages: [], sessionIds: [] }),
      getGatewayConfig: vi.fn(),
      workingDirectory: "/test",
      version: "1.0.0",
      workdir: "/test",
      queuedMessages: [],
      hasPendingConfirmations: false,
      confirmingTool: null,
    } as unknown as ChatContextType);

    const { lastFrame } = render(<ChatInterface />);

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
  });

  it("should show InputBox when showRewindManager is false", async () => {
    vi.mocked(useChat).mockReturnValue({
      sessionId: "test-session",
      messages: [],
      isLoading: false,
      isCommandRunning: false,
      isCompressing: false,
      isExpanded: false,
      isConfirmationVisible: false,
      remountKey: 0,
      requestRemount: vi.fn(),
      handleRewindSelect: vi.fn(),
      sendMessage: vi.fn(),
      abortMessage: vi.fn(),
      mcpServers: [],
      connectMcpServer: vi.fn(),
      disconnectMcpServer: vi.fn(),
      latestTotalTokens: 0,
      slashCommands: [],
      hasSlashCommand: vi.fn(),
      backgroundTasks: [],
      getBackgroundTaskOutput: vi.fn(),
      stopBackgroundTask: vi.fn(),
      permissionMode: "default",
      setPermissionMode: vi.fn(),
      showConfirmation: vi.fn(),
      hideConfirmation: vi.fn(),
      handleConfirmationDecision: vi.fn(),
      handleConfirmationCancel: vi.fn(),
      backgroundCurrentTask: vi.fn(),
      tasks: [],
      isTaskListVisible: true,
      setIsTaskListVisible: vi.fn(),
      allowBypassInCycle: false,
      inputState: {
        ...initialState,
        showRewindManager: false, // Rewind is NOT visible
      },
      inputDispatch: vi.fn(),
      currentModel: "",
      configuredModels: [],
      setModel: vi.fn(),
      askBtw: vi.fn(),
      getModelConfig: vi.fn().mockReturnValue({
        model: "test-model",
        fastModel: "test-fast-model",
      }),
      getFullMessageThread: vi
        .fn()
        .mockResolvedValue({ messages: [], sessionIds: [] }),
      getGatewayConfig: vi.fn(),
      workingDirectory: "/test",
      version: "1.0.0",
      workdir: "/test",
      queuedMessages: [],
      hasPendingConfirmations: false,
      confirmingTool: null,
    } as unknown as ChatContextType);

    const { lastFrame } = render(<ChatInterface />);

    // Wait for the component to render
    await vi.waitFor(() => {
      expect(stripAnsiColors(lastFrame() || "")).toContain("Type your message");
    });

    // Should NOT contain Rewind Selector
    expect(stripAnsiColors(lastFrame() || "")).not.toContain(
      "No user messages found",
    );
  });
});
