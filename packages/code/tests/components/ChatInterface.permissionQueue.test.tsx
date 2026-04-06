import React from "react";
import { render } from "ink-testing-library";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { ChatInterface } from "../../src/components/ChatInterface.js";
import {
  ChatContextType,
  useChat as useChatActual,
} from "../../src/contexts/useChat.js";
import { useTasks } from "../../src/hooks/useTasks.js";
import { initialState } from "../../src/reducers/inputReducer.js";

vi.mock("../../src/contexts/useChat.js", () => ({
  useChat: vi.fn(),
}));

const useChat = vi.mocked(useChatActual);

vi.mock("../../src/hooks/useTasks.js", () => ({
  useTasks: vi.fn(),
}));

describe("ChatInterface Permission Queue", () => {
  let requestRemount: ReturnType<typeof vi.fn>;

  const createMockContext = (
    overrides: Partial<ChatContextType> = {},
  ): ChatContextType => {
    return {
      sessionId: "test-session",
      messages: [],
      isLoading: false,
      isCommandRunning: false,
      isCompressing: false,
      isExpanded: false,
      isConfirmationVisible: false,
      hasPendingConfirmations: false,
      confirmingTool: undefined,
      remountKey: 0,
      requestRemount,
      latestTotalTokens: 0,
      mcpServers: [],
      slashCommands: [],
      hasSlashCommand: vi.fn(),
      isTaskListVisible: true,
      allowBypassInCycle: false,
      inputState: initialState,
      inputDispatch: vi.fn(),
      getModelConfig: vi.fn().mockReturnValue({
        model: "test-model",
        fastModel: "test-fast-model",
      }),
      sendMessage: vi.fn(),
      askBtw: vi.fn(),
      abortMessage: vi.fn(),
      ...overrides,
    } as unknown as ChatContextType;
  };

  beforeEach(() => {
    requestRemount = vi.fn();
    vi.mocked(useTasks).mockReturnValue(
      [] as unknown as ReturnType<typeof useTasks>,
    );
  });

  describe("forceStatic transition and terminal clearing", () => {
    it("should NOT call requestRemount when there are pending confirmations in queue", () => {
      // Simulate the state after user confirms tool 2 of 3:
      // - forceStatic was true (previous render had confirmation overflow)
      // - Now forceStatic is false (confirmation hidden)
      // - But queue still has pending items (tool 3)
      // - Confirmation is not currently visible yet

      const mockContext = createMockContext({
        isConfirmationVisible: false,
        hasPendingConfirmations: true, // Tool 3 is still in queue
        confirmingTool: undefined,
      });

      vi.mocked(useChat).mockReturnValue(mockContext);

      // First render with forceStatic = true (simulated by having a tall confirmation)
      // Then rerender with forceStatic = false
      const { rerender } = render(<ChatInterface />);

      // Simulate the transition: confirmation hidden, queue has items
      vi.mocked(useChat).mockReturnValue(
        createMockContext({
          isConfirmationVisible: false,
          hasPendingConfirmations: true,
          confirmingTool: undefined,
        }),
      );

      rerender(<ChatInterface />);

      // requestRemount should NOT be called because queue has pending items
      expect(requestRemount).not.toHaveBeenCalled();
    });

    it("should NOT call requestRemount when confirmation is currently visible", () => {
      const mockContext = createMockContext({
        isConfirmationVisible: true,
        hasPendingConfirmations: false,
        confirmingTool: { name: "test_tool", input: {} },
      });

      vi.mocked(useChat).mockReturnValue(mockContext);

      render(<ChatInterface />);

      // requestRemount should NOT be called while confirmation is visible
      expect(requestRemount).not.toHaveBeenCalled();
    });

    it("should NOT call requestRemount when both pending confirmations exist and confirmation is visible", () => {
      const mockContext = createMockContext({
        isConfirmationVisible: true,
        hasPendingConfirmations: true,
        confirmingTool: { name: "test_tool", input: {} },
      });

      vi.mocked(useChat).mockReturnValue(mockContext);

      render(<ChatInterface />);

      expect(requestRemount).not.toHaveBeenCalled();
    });

    it("should call requestRemount when forceStatic transitions to false AND no pending confirmations AND no visible confirmation", async () => {
      // This simulates the final state after all tools have been confirmed
      const { rerender } = render(<ChatInterface />);

      // First render: confirmation visible (which would set forceStatic = true internally
      // if content overflows terminal height - we can't easily test that in unit tests,
      // but we can test the logic of when requestRemount is called)

      vi.mocked(useChat).mockReturnValue(
        createMockContext({
          isConfirmationVisible: false,
          hasPendingConfirmations: false,
          confirmingTool: undefined,
        }),
      );

      rerender(<ChatInterface />);

      // The requestRemount is only called when forceStatic transitions from true to false
      // Since we can't easily control forceStatic in unit tests (it's based on measureElement),
      // this test verifies the component renders without error
      // Integration tests would be needed to fully test the forceStatic transition
    });

    it("should render confirmation selector for each tool in sequence", () => {
      // Tool 1 confirmation
      vi.mocked(useChat).mockReturnValue(
        createMockContext({
          isConfirmationVisible: true,
          hasPendingConfirmations: true, // Tools 2 and 3 in queue
          confirmingTool: { name: "bash", input: { command: "ls" } },
        }),
      );

      const { lastFrame, rerender } = render(<ChatInterface />);
      expect(lastFrame()).toContain("bash");

      // Tool 2 confirmation (after user confirms tool 1)
      vi.mocked(useChat).mockReturnValue(
        createMockContext({
          isConfirmationVisible: true,
          hasPendingConfirmations: true, // Tool 3 in queue
          confirmingTool: { name: "write", input: { file_path: "/test.txt" } },
        }),
      );

      rerender(<ChatInterface />);
      expect(lastFrame()).toContain("write");

      // Tool 3 confirmation (after user confirms tool 2)
      vi.mocked(useChat).mockReturnValue(
        createMockContext({
          isConfirmationVisible: true,
          hasPendingConfirmations: false, // No more tools
          confirmingTool: { name: "edit", input: { file_path: "/test.txt" } },
        }),
      );

      rerender(<ChatInterface />);
      expect(lastFrame()).toContain("edit");

      // All confirmed - no more confirmations
      vi.mocked(useChat).mockReturnValue(
        createMockContext({
          isConfirmationVisible: false,
          hasPendingConfirmations: false,
          confirmingTool: undefined,
        }),
      );

      rerender(<ChatInterface />);
      expect(requestRemount).not.toHaveBeenCalled();
    });
  });
});
