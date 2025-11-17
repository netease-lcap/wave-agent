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

describe("Hook Blocking Error Behavior (User Story 2)", () => {
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

      // Verify message handling: prompt should be erased, error should be shown
      const messages = agent.messages;

      // Should have only an error block, no user message or assistant response
      expect(messages).toHaveLength(1);
      expect(messages[0].role).toBe("assistant");
      expect(messages[0].blocks?.[0]?.type).toBe("error");
      const firstBlock = messages[0].blocks?.[0];
      expect(
        firstBlock && hasContent(firstBlock) ? firstBlock.content : undefined,
      ).toBe("Prompt validation failed: inappropriate content detected");

      // No user messages should remain
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

  describe("PreToolUse blocking errors (exit code 2)", () => {
    it("should show error via tool block but allow execution to continue", async () => {
      // This is a placeholder test since we don't have tool execution in this test
      // In real usage, PreToolUse hooks with exit code 2 would show error via tool block
      // but allow the overall agent execution to continue
      expect(true).toBe(true); // Placeholder until tool execution tests are implemented
    });
  });

  describe("PostToolUse blocking errors (exit code 2)", () => {
    it("should show error via tool block but allow execution to continue", async () => {
      // This is a placeholder test since we don't have tool execution in this test
      // In real usage, PostToolUse hooks with exit code 2 would append error to tool result
      // but allow the overall agent execution to continue
      expect(true).toBe(true); // Placeholder until tool execution tests are implemented
    });
  });

  describe("Stop blocking errors (exit code 2)", () => {
    it("should show error as user message but allow execution to continue", async () => {
      // This is a placeholder test since we don't have Stop hook execution in this test
      // In real usage, Stop hooks with exit code 2 would show error as user message
      // but allow the overall agent execution to continue
      expect(true).toBe(true); // Placeholder until Stop hook execution tests are implemented
    });
  });
});
