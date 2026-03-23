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

describe("ChatInterface BTW Side Question", () => {
  const mockChatContext = {
    sessionId: "test-session",
    messages: [
      { role: "user", blocks: [{ type: "text", content: "main message" }] },
    ],
    isLoading: false,
    isCommandRunning: false,
    isCompressing: false,
    isExpanded: false,
    isConfirmationVisible: false,
    rewindId: 0,
    latestTotalTokens: 0,
    mcpServers: [],
    slashCommands: [],
    hasSlashCommand: vi.fn(),
    isTaskListVisible: true,
    getModelConfig: vi.fn().mockReturnValue({
      model: "test-model",
      fastModel: "test-fast-model",
    }),
    sideMessages: null,
  } as unknown as ChatContextType;

  const mockInputManager = {
    isManagerReady: true,
    showRewindManager: false,
    setPermissionMode: vi.fn(),
  };

  it("should show side agent messages when sideMessages is set", () => {
    const sideMessages = [
      {
        role: "user",
        blocks: [{ type: "text", content: "/btw how are you?" }],
      },
      {
        role: "assistant",
        blocks: [{ type: "text", content: "I am a side agent." }],
      },
    ];

    vi.mocked(useChat).mockReturnValue({
      ...mockChatContext,
      sideMessages,
    } as unknown as ChatContextType);
    vi.mocked(useInputManager).mockReturnValue(
      mockInputManager as unknown as ReturnType<typeof useInputManager>,
    );
    vi.mocked(useTasks).mockReturnValue(
      [] as unknown as ReturnType<typeof useTasks>,
    );

    const { lastFrame } = render(<ChatInterface />);
    const output = lastFrame();

    expect(output).toContain("/btw how are you?");
    expect(output).toContain("I am a side agent.");
    expect(output).not.toContain("main message");
  });

  it("should show main messages when sideMessages is null", () => {
    vi.mocked(useChat).mockReturnValue({
      ...mockChatContext,
      sideMessages: null,
    } as unknown as ChatContextType);
    vi.mocked(useInputManager).mockReturnValue(
      mockInputManager as unknown as ReturnType<typeof useInputManager>,
    );
    vi.mocked(useTasks).mockReturnValue(
      [] as unknown as ReturnType<typeof useTasks>,
    );

    const { lastFrame } = render(<ChatInterface />);
    const output = lastFrame();

    expect(output).toContain("main message");
  });

  it("should show multi-turn side agent messages", () => {
    const sideMessages = [
      {
        role: "user",
        blocks: [{ type: "text", content: "/btw how are you?" }],
      },
      {
        role: "assistant",
        blocks: [{ type: "text", content: "I am a side agent." }],
      },
      { role: "user", blocks: [{ type: "text", content: "What can you do?" }] },
      {
        role: "assistant",
        blocks: [{ type: "text", content: "I can answer side questions." }],
      },
    ];

    vi.mocked(useChat).mockReturnValue({
      ...mockChatContext,
      sideMessages,
    } as unknown as ChatContextType);
    vi.mocked(useInputManager).mockReturnValue(
      mockInputManager as unknown as ReturnType<typeof useInputManager>,
    );
    vi.mocked(useTasks).mockReturnValue(
      [] as unknown as ReturnType<typeof useTasks>,
    );

    const { lastFrame } = render(<ChatInterface />);
    const output = lastFrame();

    expect(output).toContain("/btw how are you?");
    expect(output).toContain("I am a side agent.");
    expect(output).toContain("What can you do?");
    expect(output).toContain("I can answer side questions.");
    expect(output).not.toContain("main message");
  });
});
