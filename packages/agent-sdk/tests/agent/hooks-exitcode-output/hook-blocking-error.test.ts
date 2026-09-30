import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Agent } from "@/agent.js";
import * as aiService from "@/services/aiService.js";
import { HookManager } from "@/managers/hookManager.js";
import type { MessageBlock } from "@/types/messaging.js";

// Type guard helper function
function hasContent(
  block: MessageBlock,
): block is MessageBlock & { content: string } {
  return "content" in block;
}

// Mock AI service directly in this file
vi.mock("@/services/aiService");

// Create mock functions at module scope for the factory pattern
const mockToolExecute = vi.fn();

vi.mock("@/managers/toolManager", () => ({
  ToolManager: vi.fn().mockImplementation(function () {
    return {
      execute: mockToolExecute,
      list: vi.fn(() => []),
      getTools: vi.fn(() => []),
      getToolsConfig: vi.fn(() => []),
      isConcurrencySafe: vi.fn().mockReturnValue(true),
      getPermissionMode: vi.fn(),
      setPermissionMode: vi.fn(),
      initializeBuiltInTools: vi.fn(),
      getPermissionManager: vi.fn(),
    };
  }),
}));

describe("Hook Blocking Error Behavior (User Story 2)", () => {
  let agent: Agent;
  const mockCallbacks = {
    onLoadingChange: vi.fn(),
  };

  beforeEach(async () => {
    // Create Agent instance with required parameters
    agent = await Agent.create({
      callbacks: mockCallbacks,
      workdir: "/tmp/test-workdir",
    });

    vi.clearAllMocks();
  });

  afterEach(async () => {
    if (agent) {
      await agent.destroy();
    }
    vi.clearAllMocks();
  });

  describe("UserPromptSubmit blocking errors (exit code 2)", () => {
    it("should block prompt processing, show error, and erase prompt when exit code is 2", async () => {
      // Get the hook manager instance from the agent to mock its executeHooks method
      const hookManager = (agent as unknown as { hookManager: HookManager })
        .hookManager;
      const mockExecuteHooks = vi.spyOn(hookManager, "executeHooks");

      // Mock hook execution returning exit code 2 with stderr
      mockExecuteHooks.mockResolvedValue([
        {
          success: false,
          exitCode: 2,
          stdout: "",
          stderr: "Prompt validation failed: inappropriate content detected",
          duration: 100,
          timedOut: false,
        },
      ]);

      // Mock AI service - should not be called due to blocking
      const mockCallAgent = vi.mocked(aiService.callAgent);
      mockCallAgent.mockResolvedValue({
        content: "This should not be called",
        usage: {
          prompt_tokens: 10,
          completion_tokens: 20,
          total_tokens: 30,
        },
      });

      await agent.sendMessage("inappropriate prompt content");

      // Verify UserPromptSubmit hooks were called
      expect(mockExecuteHooks).toHaveBeenCalledWith(
        "UserPromptSubmit",
        expect.objectContaining({
          userPrompt: "inappropriate prompt content",
          cwd: "/tmp/test-workdir",
        }),
      );

      // Verify AI service was NOT called due to blocking
      expect(mockCallAgent).not.toHaveBeenCalled();

      // FR-019: System MUST validate UserPromptSubmit blocking errors by checking that
      // agent.messages does not contain the user role message and contains an ErrorBlock
      // in the assistant message with stderr as content
      const messages = agent.messages;

      // Should have only an error block, no user message or assistant response
      expect(messages).toHaveLength(1);
      expect(messages[0].role).toBe("assistant");
      expect(messages[0].blocks?.[0]?.type).toBe("error");
      const firstBlock = messages[0].blocks?.[0];
      expect(
        firstBlock && hasContent(firstBlock) ? firstBlock.content : undefined,
      ).toBe("Prompt validation failed: inappropriate content detected");

      // FR-019: Verify agent.messages does not contain the user role message
      const userMessages = messages.filter((msg) => msg.role === "user");
      expect(userMessages).toHaveLength(0);
    });

    it("should handle multiple hook results with blocking error", async () => {
      // Get the hook manager instance from the agent to mock its executeHooks method
      const hookManager = (agent as unknown as { hookManager: HookManager })
        .hookManager;
      const mockExecuteHooks = vi.spyOn(hookManager, "executeHooks");

      // Mock multiple hook executions with first one blocking
      mockExecuteHooks.mockResolvedValue([
        {
          success: true,
          exitCode: 0,
          stdout: "First hook succeeded",
          stderr: "",
          duration: 50,
          timedOut: false,
        },
        {
          success: false,
          exitCode: 2,
          stdout: "",
          stderr: "Security policy violation",
          duration: 100,
          timedOut: false,
        },
        {
          success: true,
          exitCode: 0,
          stdout: "Third hook would run but blocked",
          stderr: "",
          duration: 25,
          timedOut: false,
        },
      ]);

      // Mock AI service - should not be called due to blocking
      const mockCallAgent = vi.mocked(aiService.callAgent);

      await agent.sendMessage("test prompt");

      // Verify AI service was NOT called due to blocking
      expect(mockCallAgent).not.toHaveBeenCalled();

      // FR-019: System MUST validate UserPromptSubmit blocking errors by checking that
      // agent.messages does not contain the user role message and contains an ErrorBlock
      // in the assistant message with stderr as content

      // Should block on the first blocking error (exit code 2)
      // Original prompt should be erased, no context should be injected
      const messages = agent.messages;
      expect(messages).toHaveLength(1);
      expect(messages[0].blocks?.[0]?.type).toBe("error");
      const firstBlock = messages[0].blocks?.[0];
      expect(
        firstBlock && hasContent(firstBlock) ? firstBlock.content : undefined,
      ).toBe("Security policy violation");
    });
  });

  describe("Stop blocking errors (exit code 2)", () => {
    it("should handle Stop blocking errors and show error in assistant message", async () => {
      // Get the hook manager instance from the agent to mock its executeHooks method
      const hookManager = (agent as unknown as { hookManager: HookManager })
        .hookManager;
      const mockExecuteHooks = vi.spyOn(hookManager, "executeHooks");

      // Mock hook executions - return blocking error only for first Stop call
      let stopHookCallCount = 0;
      mockExecuteHooks.mockImplementation(async (event) => {
        if (event === "Stop") {
          stopHookCallCount++;
          if (stopHookCallCount === 1) {
            // First Stop call: return blocking error
            return [
              {
                success: false,
                exitCode: 2,
                stdout: "",
                stderr: "Session cleanup failed - manual intervention required",
                duration: 60,
                timedOut: false,
              },
            ];
          } else {
            // Subsequent Stop calls: return successful result
            return [
              {
                success: true,
                exitCode: 0,
                stdout: "Session cleanup completed successfully",
                stderr: "",
                duration: 30,
                timedOut: false,
              },
            ];
          }
        }
        // Return empty results for other hook events
        return [];
      });

      // Mock AI service for simple text response (no tools = triggers Stop hooks)
      const mockCallAgent = vi.mocked(aiService.callAgent);
      let callCount = 0;
      mockCallAgent.mockImplementation(async () => {
        callCount++;
        if (callCount === 1) {
          // First call: normal completion that triggers Stop hooks
          return {
            content: "Task completed successfully",
            tool_calls: [], // No tools = triggers Stop hooks
            usage: {
              prompt_tokens: 10,
              completion_tokens: 15,
              total_tokens: 25,
            },
          };
        } else {
          // Second call: response to the Stop hook error (continuation)
          return {
            content:
              "I'll address the session cleanup issue that was detected.",
            tool_calls: [],
            usage: {
              prompt_tokens: 8,
              completion_tokens: 12,
              total_tokens: 20,
            },
          };
        }
      });

      await agent.sendMessage("complete task");

      // Verify Stop hook was executed
      expect(mockExecuteHooks).toHaveBeenCalledWith(
        "Stop",
        expect.objectContaining({
          event: "Stop",
        }),
      );

      // Verify AI was called 2 times (initial + continuation due to Stop hook blocking)
      expect(mockCallAgent).toHaveBeenCalledTimes(2);

      // FR-021: System MUST validate Stop hook blocking behavior by checking that
      // agent.messages contains a user role message with stderr content
      const messages = agent.messages;
      expect(messages.length).toBeGreaterThanOrEqual(2);

      // Should have user messages (original prompt + Stop hook error message)
      const userMessages = messages.filter((msg) => msg.role === "user");
      expect(userMessages.length).toBeGreaterThanOrEqual(2);

      // First user message should be the original prompt
      const firstUserBlock = userMessages[0].blocks?.[0];
      expect(
        firstUserBlock && hasContent(firstUserBlock)
          ? firstUserBlock.content
          : undefined,
      ).toBe("complete task");

      // FR-021: Second user message should contain the Stop hook stderr content
      const secondUserBlock = userMessages[1].blocks?.[0];
      expect(
        secondUserBlock && hasContent(secondUserBlock)
          ? secondUserBlock.content
          : undefined,
      ).toBe("Session cleanup failed - manual intervention required");

      // Should have assistant message with response
      const assistantMessages = messages.filter(
        (msg) => msg.role === "assistant",
      );
      expect(assistantMessages.length).toBeGreaterThanOrEqual(1);

      // Should have the AI response text somewhere in the messages
      const allBlocks = assistantMessages.flatMap((msg) => msg.blocks || []);
      const hasResponseText = allBlocks.some(
        (block) =>
          hasContent(block) &&
          block.content.includes("Task completed successfully"),
      );
      expect(hasResponseText).toBe(true);
    });
  });
});
