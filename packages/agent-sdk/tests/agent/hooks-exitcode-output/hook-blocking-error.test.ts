import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Agent } from "@/agent.js";
import { withoutAnnouncements } from "../../helpers/announcements.js";
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
      // agent.messages does not contain the user role message and contains an error-level notice
      // in the assistant message with stderr as content
      const messages = agent.messages;

      // Should have only an error block, no user message or assistant response
      expect(messages).toHaveLength(1);
      expect(messages[0].role).toBe("assistant");
      expect(messages[0].blocks?.[0]?.type).toBe("notice");
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
      // agent.messages does not contain the user role message and contains an error-level notice
      // in the assistant message with stderr as content

      // Should block on the first blocking error (exit code 2)
      // Original prompt should be erased, no context should be injected
      const messages = agent.messages;
      expect(messages).toHaveLength(1);
      expect(messages[0].blocks?.[0]?.type).toBe("notice");
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
      // agent.messages contains a user role message with stderr content. The
      // host's per-turn announcements are stripped so the stderr message stays
      // the second *conversation* message.
      const messages = withoutAnnouncements(agent.messages);
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

    it("lets a queued user message preempt the hook's restart", async () => {
      // A hook that never lets the turn end (a loop hook) must not starve
      // the queue: the user's message — typically /cancel — has to run.
      const hookManager = (agent as unknown as { hookManager: HookManager })
        .hookManager;
      // Block only the first Stop (the "长任务" turn); otherwise the always-on
      // block would restart forever once the queued turn finishes.
      let stopHookCalls = 0;
      vi.spyOn(hookManager, "executeHooks").mockImplementation(async (event) =>
        event === "Stop" && stopHookCalls++ === 0
          ? [
              {
                success: false,
                exitCode: 2,
                stdout: "",
                stderr: "又一次循环",
                duration: 10,
                timedOut: false,
              },
            ]
          : [],
      );

      let releaseFirstTurn: () => void = () => {};
      const firstTurnGate = new Promise<void>((resolve) => {
        releaseFirstTurn = resolve;
      });
      const mockCallAgent = vi.mocked(aiService.callAgent);
      let callCount = 0;
      mockCallAgent.mockImplementation(async () => {
        callCount++;
        if (callCount === 1) await firstTurnGate;
        return {
          content: `reply-${callCount}`,
          tool_calls: [],
          usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
        };
      });

      const firstTurn = agent.sendMessage("长任务");
      await vi.waitFor(() => expect(agent.isLoading).toBe(true));

      const queuedTurn = agent.sendMessage("想取消");
      expect(agent.queuedMessages.map((m) => m.content)).toContain("想取消");

      releaseFirstTurn();
      await firstTurn;
      await queuedTurn;
      await vi.waitFor(() =>
        expect(
          mockCallAgent.mock.calls.some((call) =>
            JSON.stringify(call[0]?.messages).includes("想取消"),
          ),
        ).toBe(true),
      );

      // The hook did want to continue (its reason is in the history)…
      expect(
        agent.messages.some((message) =>
          message.blocks?.some(
            (block) => "content" in block && block.content === "又一次循环",
          ),
        ),
      ).toBe(true);

      // …but the queued message drove the next turn: the hook's continuation did
      // not get a model call of its own. A continuation call would be one whose
      // *last* message is the hook's stderr; the auto-memory extraction fork can
      // legitimately land between the two turns (it never sees the user's text
      // and appends its own prompt last), so an absolute call index is not the
      // invariant — "no call ends on the hook's reason" is.
      const continuationCalls = mockCallAgent.mock.calls.filter((call) => {
        const messages = call[0]?.messages ?? [];
        return JSON.stringify(messages[messages.length - 1]).includes(
          "又一次循环",
        );
      });
      expect(continuationCalls).toHaveLength(0);
      expect(
        mockCallAgent.mock.calls.some((call) =>
          JSON.stringify(call[0]?.messages).includes("想取消"),
        ),
      ).toBe(true);
    });
  });
});
