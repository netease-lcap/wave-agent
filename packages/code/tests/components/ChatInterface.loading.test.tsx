import React from "react";
import { render } from "ink-testing-library";
import { describe, it, expect, vi } from "vitest";
import { ChatInterface } from "../../src/components/ChatInterface.js";
import {
  ChatContextType,
  useChat as useChatActual,
} from "../../src/contexts/useChat.js";
import { useInputManager } from "../../src/hooks/useInputManager.js";
import { useTasks } from "../../src/hooks/useTasks.js";

vi.mock("../../src/contexts/useChat.js", () => ({
  useChat: vi.fn(),
}));

const useChat = vi.mocked(useChatActual);

vi.mock("../../src/hooks/useInputManager.js", () => ({
  useInputManager: vi.fn(),
}));

vi.mock("../../src/hooks/useTasks.js", () => ({
  useTasks: vi.fn(),
}));

describe("ChatInterface Loading State", () => {
  const mockChatContext = {
    sessionId: "test-session",
    messages: [],
    isLoading: false,
    isCommandRunning: false,
    userInputHistory: [],
    isCompressing: false,
    isExpanded: false,
    isConfirmationVisible: false,
    rewindId: 0,
    latestTotalTokens: 0,
    mcpServers: [],
    slashCommands: [],
    hasSlashCommand: vi.fn(),
    isTaskListVisible: true,
  } as unknown as ChatContextType;

  const mockInputManager = {
    isManagerReady: true,
    showRewindManager: false,
    setPermissionMode: vi.fn(),
  };

  it("should show loading indicator when isLoading is true", () => {
    vi.mocked(useChat).mockReturnValue({
      ...mockChatContext,
      isLoading: true,
      latestTotalTokens: 1234,
    } as unknown as ChatContextType);
    vi.mocked(useInputManager).mockReturnValue(
      mockInputManager as unknown as ReturnType<typeof useInputManager>,
    );
    vi.mocked(useTasks).mockReturnValue(
      [] as unknown as ReturnType<typeof useTasks>,
    );

    const { lastFrame } = render(<ChatInterface />);
    const output = lastFrame();

    expect(output).toContain("✻ AI is thinking...");
    expect(output).toContain("1,234");
    expect(output).toContain("tokens");
    expect(output).toContain("Esc to abort");
  });

  it("should not show loading indicator when isLoading is false", () => {
    vi.mocked(useChat).mockReturnValue({
      ...mockChatContext,
      isLoading: false,
    } as unknown as ChatContextType);
    vi.mocked(useInputManager).mockReturnValue(
      mockInputManager as unknown as ReturnType<typeof useInputManager>,
    );
    vi.mocked(useTasks).mockReturnValue(
      [] as unknown as ReturnType<typeof useTasks>,
    );

    const { lastFrame } = render(<ChatInterface />);
    const output = lastFrame();

    expect(output).not.toContain("✻ AI is thinking...");
  });

  it("should not show loading indicator when confirmation is visible", () => {
    vi.mocked(useChat).mockReturnValue({
      ...mockChatContext,
      isLoading: true,
      isConfirmationVisible: true,
      confirmingTool: { name: "test_tool", input: {} },
    } as unknown as ChatContextType);
    vi.mocked(useInputManager).mockReturnValue(
      mockInputManager as unknown as ReturnType<typeof useInputManager>,
    );
    vi.mocked(useTasks).mockReturnValue(
      [] as unknown as ReturnType<typeof useTasks>,
    );

    const { lastFrame } = render(<ChatInterface />);
    const output = lastFrame();

    expect(output).not.toContain("✻ AI is thinking...");
    expect(output).toContain("Tool: test_tool");
  });

  it("should show command running message when isCommandRunning is true", () => {
    vi.mocked(useChat).mockReturnValue({
      ...mockChatContext,
      isCommandRunning: true,
    } as unknown as ChatContextType);
    vi.mocked(useInputManager).mockReturnValue(
      mockInputManager as unknown as ReturnType<typeof useInputManager>,
    );
    vi.mocked(useTasks).mockReturnValue(
      [] as unknown as ReturnType<typeof useTasks>,
    );

    const { lastFrame } = render(<ChatInterface />);
    const output = lastFrame();

    expect(output).toContain("🚀 Command is running...");
  });

  it("should show compressing message when isCompressing is true", () => {
    vi.mocked(useChat).mockReturnValue({
      ...mockChatContext,
      isCompressing: true,
    } as unknown as ChatContextType);
    vi.mocked(useInputManager).mockReturnValue(
      mockInputManager as unknown as ReturnType<typeof useInputManager>,
    );
    vi.mocked(useTasks).mockReturnValue(
      [] as unknown as ReturnType<typeof useTasks>,
    );

    const { lastFrame } = render(<ChatInterface />);
    const output = lastFrame();

    expect(output).toContain("🗜️ Compressing message history...");
  });
});
