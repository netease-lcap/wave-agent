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

describe("Hook Success Behavior (User Story 1)", () => {
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

  describe("UserPromptSubmit success with stdout injection", () => {
    it("should inject hook stdout as user context when exit code is 0", async () => {
      // Get the hook manager instance from the agent to mock its executeHooks method
      const hookManager = (agent as unknown as { hookManager: HookManager })
        .hookManager;
      const mockExecuteHooks = vi.spyOn(hookManager, "executeHooks");

      // Mock hook execution returning exit code 0 with stdout
      mockExecuteHooks.mockResolvedValue([
        {
          success: true,
          exitCode: 0,
          stdout: "Additional context from hook",
          stderr: "",
          duration: 100,
          timedOut: false,
        },
      ]);

      // Mock AI service to return simple response
      const mockCallAgent = vi.mocked(aiService.callAgent);
      mockCallAgent.mockResolvedValue({
        content: "Response with injected context",
        usage: {
          prompt_tokens: 10,
          completion_tokens: 20,
          total_tokens: 30,
        },
      });

      await agent.sendMessage("test prompt");

      // Verify UserPromptSubmit hooks were called
      expect(mockExecuteHooks).toHaveBeenCalledWith(
        "UserPromptSubmit",
        expect.objectContaining({
          userPrompt: "test prompt",
          cwd: "/tmp/test-workdir",
        }),
      );

      // FR-016: System MUST validate UserPromptSubmit success by checking that
      // agent.sendMessage() results in agent.messages containing two user role messages,
      // where the second message contains the hook stdout content
      const messages = agent.messages;
      // user message + injected context + assistant response. `Exec` is off by
      // default, so the host appends no on-demand-tool notice on the first turn.
      expect(messages).toHaveLength(3);

      // Find user messages - should have original prompt and injected context.
      // The injected one carries `isMeta: true` (hook feedback is hidden from the
      // UI, visible to the model), which is asserted below.
      const userMessages = messages.filter((msg) => msg.role === "user");
      expect(userMessages).toHaveLength(2);

      // First user message should be original prompt
      const firstUserBlock = userMessages[0].blocks?.[0];
      expect(
        firstUserBlock && hasContent(firstUserBlock)
          ? firstUserBlock.content
          : undefined,
      ).toBe("test prompt");
      expect(userMessages[0].isMeta).toBeUndefined();

      // FR-016: Second user message should contain the hook stdout content
      const secondUserBlock = userMessages[1].blocks?.[0];
      expect(
        secondUserBlock && hasContent(secondUserBlock)
          ? secondUserBlock.content
          : undefined,
      ).toBe("Additional context from hook");
      expect(userMessages[1].isMeta).toBe(true);
    });

    it("should not inject empty stdout from successful hooks", async () => {
      // Get the hook manager instance from the agent to mock its executeHooks method
      const hookManager = (agent as unknown as { hookManager: HookManager })
        .hookManager;
      const mockExecuteHooks = vi.spyOn(hookManager, "executeHooks");

      // Mock hook execution returning exit code 0 with empty stdout
      mockExecuteHooks.mockResolvedValue([
        {
          success: true,
          exitCode: 0,
          stdout: "",
          stderr: "",
          duration: 100,
          timedOut: false,
        },
      ]);

      // Mock AI service
      const mockCallAgent = vi.mocked(aiService.callAgent);
      mockCallAgent.mockResolvedValue({
        content: "Response without context",
        usage: {
          prompt_tokens: 10,
          completion_tokens: 20,
          total_tokens: 30,
        },
      });

      await agent.sendMessage("test prompt");

      // Verify no context injection
      const messages = agent.messages;
      const userMessages = messages.filter(
        (msg) => msg.role === "user" && msg.isMeta !== true,
      );

      // Should only have the original user message
      expect(userMessages).toHaveLength(1);
      const firstUserBlock = userMessages[0].blocks?.[0];
      expect(
        firstUserBlock && hasContent(firstUserBlock)
          ? firstUserBlock.content
          : undefined,
      ).toBe("test prompt");

      // Total messages should be user + assistant: no injected context, and no
      // on-demand-tool notice while `Exec` is off by default.
      expect(messages).toHaveLength(2);
    });
  });

  describe("Other hook types ignore stdout", () => {
    // This test validates that Stop hooks do not inject stdout into messages even
    // with exit code 0. PreToolUse/PostToolUse are not driven from here any more:
    // they run on the tool execution funnels, so their stdout behaviour is
    // asserted in tests/managers/hookManager.exitCodes.test.ts.
    it("should ignore stdout for Stop hooks", async () => {
      // Get the hook manager instance from the agent to mock its executeHooks method
      const hookManager = (agent as unknown as { hookManager: HookManager })
        .hookManager;
      const mockExecuteHooks = vi.spyOn(hookManager, "executeHooks");

      // Mock hook executions based on event type
      mockExecuteHooks.mockImplementation(async (event) => {
        if (event === "Stop") {
          // Stop hooks return success but stdout should NOT be injected as user message
          return [
            {
              success: true,
              exitCode: 0,
              stdout: "Stop hook executed - cleanup completed",
              stderr: "",
              duration: 25,
              timedOut: false,
            },
          ];
        }
        // Return empty results for other hook events
        return [];
      });

      // Mock AI service for simple text response (no tools)
      const mockCallAgent = vi.mocked(aiService.callAgent);
      mockCallAgent.mockResolvedValue({
        content: "This is a simple response that will trigger Stop hooks",
        tool_calls: [], // No tools = triggers Stop hooks
        usage: {
          prompt_tokens: 10,
          completion_tokens: 15,
          total_tokens: 25,
        },
      });

      await agent.sendMessage("simple request");

      // Verify Stop hook was executed
      expect(mockExecuteHooks).toHaveBeenCalledWith(
        "Stop",
        expect.objectContaining({
          event: "Stop",
          // Stop hooks don't have toolName, userPrompt etc.
        }),
      );

      // Verify that NO additional user messages were injected from Stop stdout
      const messages = agent.messages;
      const userMessages = messages.filter(
        (msg) => msg.role === "user" && msg.isMeta !== true,
      );

      // Should only have original user message
      expect(userMessages).toHaveLength(1);
      const firstUserBlock = userMessages[0].blocks?.[0];
      expect(
        firstUserBlock && hasContent(firstUserBlock)
          ? firstUserBlock.content
          : undefined,
      ).toBe("simple request");

      // Should have assistant response
      const assistantMessages = messages.filter(
        (msg) => msg.role === "assistant",
      );
      expect(assistantMessages).toHaveLength(1);
      const responseBlock = assistantMessages[0].blocks?.[0];
      expect(
        responseBlock && hasContent(responseBlock)
          ? responseBlock.content
          : undefined,
      ).toBe("This is a simple response that will trigger Stop hooks");
    });
  });
});
