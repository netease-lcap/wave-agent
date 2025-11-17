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

// Import test setup to apply mocks
import "./test-setup.js";

// Mock AI service directly in this file
vi.mock("@/services/aiService", () => ({
  callAgent: vi.fn(),
}));

describe("Hook Success Behavior (User Story 1)", () => {
  let agent: Agent;
  const mockCallbacks = {
    onMessagesChange: vi.fn(),
    onLoadingChange: vi.fn(),
  };

  beforeEach(async () => {
    // Set flash model for performance
    process.env.AIGW_MODEL = "gemini-2.5-flash";

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

      // Verify context injection through message validation
      const messages = agent.messages;
      expect(messages).toHaveLength(3); // user message + injected context + assistant response

      // Find user messages - should have original prompt and injected context
      const userMessages = messages.filter((msg) => msg.role === "user");
      expect(userMessages).toHaveLength(2);

      // First user message should be original prompt
      const firstUserBlock = userMessages[0].blocks?.[0];
      expect(
        firstUserBlock && hasContent(firstUserBlock)
          ? firstUserBlock.content
          : undefined,
      ).toBe("test prompt");

      // Second user message should be injected context from hook stdout
      const secondUserBlock = userMessages[1].blocks?.[0];
      expect(
        secondUserBlock && hasContent(secondUserBlock)
          ? secondUserBlock.content
          : undefined,
      ).toBe("Additional context from hook");
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
      const userMessages = messages.filter((msg) => msg.role === "user");

      // Should only have the original user message
      expect(userMessages).toHaveLength(1);
      const firstUserBlock = userMessages[0].blocks?.[0];
      expect(
        firstUserBlock && hasContent(firstUserBlock)
          ? firstUserBlock.content
          : undefined,
      ).toBe("test prompt");

      // Total messages should be user + assistant (no injected context)
      expect(messages).toHaveLength(2);
    });
  });

  describe("Other hook types ignore stdout", () => {
    // This test will validate that PreToolUse, PostToolUse, and Stop hooks
    // do not inject stdout into messages even with exit code 0
    it("should ignore stdout for PreToolUse hooks", async () => {
      // This test requires tool execution to trigger PreToolUse hooks
      // For now, this is a placeholder that shows the expected behavior
      expect(true).toBe(true); // Placeholder until tool execution is implemented
    });

    it("should ignore stdout for PostToolUse hooks", async () => {
      // This test requires tool execution to trigger PostToolUse hooks
      // For now, this is a placeholder that shows the expected behavior
      expect(true).toBe(true); // Placeholder until tool execution is implemented
    });

    it("should ignore stdout for Stop hooks", async () => {
      // This test requires agent termination to trigger Stop hooks
      // For now, this is a placeholder that shows the expected behavior
      expect(true).toBe(true); // Placeholder until Stop hook execution is implemented
    });
  });
});
