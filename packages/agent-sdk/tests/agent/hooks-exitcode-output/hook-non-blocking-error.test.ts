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

describe("Hook Non-Blocking Error Behavior (User Story 3)", () => {
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

  describe("Non-blocking errors for all hook types", () => {
    it("should show error block but continue processing for UserPromptSubmit hooks", async () => {
      // Get the hook manager instance from the agent to mock its executeHooks method
      const hookManager = (agent as unknown as { hookManager: HookManager })
        .hookManager;
      const mockExecuteHooks = vi.spyOn(hookManager, "executeHooks");

      // Mock hook execution returning non-blocking exit code (not 0 or 2)
      mockExecuteHooks.mockResolvedValue([
        {
          success: false,
          exitCode: 1,
          stdout: "",
          stderr: "Non-critical hook failure: network timeout",
          duration: 100,
          timedOut: false,
        },
      ]);

      // Mock AI service - should be called since it's non-blocking
      const mockCallAgent = vi.mocked(aiService.callAgent);
      mockCallAgent.mockResolvedValue({
        content: "Response despite hook error",
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

      // Verify AI service was called since error was non-blocking
      expect(mockCallAgent).toHaveBeenCalled();

      // Verify message handling: should have user message, error block, and assistant response
      const messages = agent.messages;
      expect(messages).toHaveLength(3);

      // First message: user prompt
      expect(messages[0].role).toBe("user");
      const firstUserBlock = messages[0].blocks?.[0];
      expect(
        firstUserBlock && hasContent(firstUserBlock)
          ? firstUserBlock.content
          : undefined,
      ).toBe("test prompt");

      // Second message: error block
      expect(messages[1].role).toBe("assistant");
      expect(messages[1].blocks?.[0]?.type).toBe("error");
      const errorBlock = messages[1].blocks?.[0];
      expect(
        errorBlock && hasContent(errorBlock) ? errorBlock.content : undefined,
      ).toBe("Non-critical hook failure: network timeout");

      // Third message: assistant response
      expect(messages[2].role).toBe("assistant");
      const responseBlock = messages[2].blocks?.[0];
      expect(
        responseBlock && hasContent(responseBlock)
          ? responseBlock.content
          : undefined,
      ).toBe("Response despite hook error");
    });

    it("should handle multiple hook results with mixed success and non-blocking errors", async () => {
      // Get the hook manager instance from the agent to mock its executeHooks method
      const hookManager = (agent as unknown as { hookManager: HookManager })
        .hookManager;
      const mockExecuteHooks = vi.spyOn(hookManager, "executeHooks");

      // Mock hook executions based on event type
      mockExecuteHooks.mockImplementation(async (event) => {
        if (event === "UserPromptSubmit") {
          // Return mixed results only for UserPromptSubmit hooks
          return [
            {
              success: true,
              exitCode: 0,
              stdout: "Context from successful hook",
              stderr: "",
              duration: 50,
              timedOut: false,
            },
            {
              success: false,
              exitCode: 1,
              stdout: "",
              stderr: "First non-blocking error",
              duration: 100,
              timedOut: false,
            },
            {
              success: false,
              exitCode: 3,
              stdout: "",
              stderr: "Second non-blocking error",
              duration: 75,
              timedOut: false,
            },
          ];
        }
        // Return empty results for other hook events to avoid duplication
        return [];
      });

      // Mock AI service - should be called since errors are non-blocking
      const mockCallAgent = vi.mocked(aiService.callAgent);
      mockCallAgent.mockResolvedValue({
        content: "Response with mixed hook results",
        usage: {
          prompt_tokens: 10,
          completion_tokens: 20,
          total_tokens: 30,
        },
      });

      await agent.sendMessage("test prompt");

      // Verify AI service was called since errors were non-blocking
      expect(mockCallAgent).toHaveBeenCalled();

      // Should have: user message, injected context, assistant message with error blocks, and assistant response
      const messages = agent.messages;
      expect(messages).toHaveLength(4);

      // User messages: original + injected context
      const userMessages = messages.filter((msg) => msg.role === "user");
      expect(userMessages).toHaveLength(2);
      const firstUserBlock = userMessages[0].blocks?.[0];
      expect(
        firstUserBlock && hasContent(firstUserBlock)
          ? firstUserBlock.content
          : undefined,
      ).toBe("test prompt");
      const secondUserBlock = userMessages[1].blocks?.[0];
      expect(
        secondUserBlock && hasContent(secondUserBlock)
          ? secondUserBlock.content
          : undefined,
      ).toBe("Context from successful hook");

      // Assistant messages
      const assistantMessages = messages.filter(
        (msg) => msg.role === "assistant",
      );
      expect(assistantMessages).toHaveLength(2);

      // First assistant message should contain the error blocks
      const errorMessage = assistantMessages[0];
      expect(errorMessage.blocks).toHaveLength(2);
      expect(errorMessage.blocks?.[0]?.type).toBe("error");
      const firstErrorBlock = errorMessage.blocks?.[0];
      expect(
        firstErrorBlock && hasContent(firstErrorBlock)
          ? firstErrorBlock.content
          : undefined,
      ).toBe("First non-blocking error");
      expect(errorMessage.blocks?.[1]?.type).toBe("error");
      const secondErrorBlock = errorMessage.blocks?.[1];
      expect(
        secondErrorBlock && hasContent(secondErrorBlock)
          ? secondErrorBlock.content
          : undefined,
      ).toBe("Second non-blocking error");

      // Second assistant message should contain the AI response
      const responseMessage = assistantMessages[1];
      expect(responseMessage.blocks).toHaveLength(1);
      expect(responseMessage.blocks?.[0]?.type).toBe("text");
      const responseBlock = responseMessage.blocks?.[0];
      expect(
        responseBlock && hasContent(responseBlock)
          ? responseBlock.content
          : undefined,
      ).toBe("Response with mixed hook results");
    });

    it("should handle empty stderr in non-blocking errors with fallback message", async () => {
      // Get the hook manager instance from the agent to mock its executeHooks method
      const hookManager = (agent as unknown as { hookManager: HookManager })
        .hookManager;
      const mockExecuteHooks = vi.spyOn(hookManager, "executeHooks");

      // Mock hook execution with non-blocking error but empty stderr
      mockExecuteHooks.mockResolvedValue([
        {
          success: false,
          exitCode: 1,
          stdout: "",
          stderr: "", // Empty stderr should use fallback message
          duration: 100,
          timedOut: false,
        },
      ]);

      // Mock AI service
      const mockCallAgent = vi.mocked(aiService.callAgent);
      mockCallAgent.mockResolvedValue({
        content: "Response with fallback error",
        usage: {
          prompt_tokens: 10,
          completion_tokens: 20,
          total_tokens: 30,
        },
      });

      await agent.sendMessage("test prompt");

      // Verify fallback error message is used
      const messages = agent.messages;
      const errorMessage = messages.find(
        (msg) => msg.role === "assistant" && msg.blocks?.[0]?.type === "error",
      );

      expect(errorMessage).toBeTruthy();
      const errorBlock = errorMessage?.blocks?.[0];
      expect(
        errorBlock && hasContent(errorBlock) ? errorBlock.content : undefined,
      ).toBe("Hook execution failed");
    });
  });

  describe("Stop non-blocking errors", () => {
    it("should handle non-blocking errors in Stop hooks and continue execution", async () => {
      // Get the hook manager instance from the agent to mock its executeHooks method
      const hookManager = (agent as unknown as { hookManager: HookManager })
        .hookManager;
      const mockExecuteHooks = vi.spyOn(hookManager, "executeHooks");

      // Mock hook executions - return non-blocking error for Stop
      mockExecuteHooks.mockImplementation(async (event) => {
        if (event === "Stop") {
          return [
            {
              success: false,
              exitCode: 4, // Non-blocking error
              stdout: "",
              stderr: "Stop warning: session metrics upload failed",
              duration: 60,
              timedOut: false,
            },
          ];
        }
        // Return empty results for other hook events
        return [];
      });

      // Mock AI service for simple text response (no tools = triggers Stop hooks)
      const mockCallAgent = vi.mocked(aiService.callAgent);
      mockCallAgent.mockResolvedValue({
        content: "Task completed successfully",
        tool_calls: [], // No tools = triggers Stop hooks
        usage: {
          prompt_tokens: 10,
          completion_tokens: 15,
          total_tokens: 25,
        },
      });

      await agent.sendMessage("complete task");

      // Verify Stop hook was executed
      expect(mockExecuteHooks).toHaveBeenCalledWith(
        "Stop",
        expect.objectContaining({
          event: "Stop",
        }),
      );

      // Verify AI was called
      expect(mockCallAgent).toHaveBeenCalledTimes(1);

      // Should have messages and error block from non-blocking error
      const messages = agent.messages;
      expect(messages.length).toBeGreaterThanOrEqual(2);

      // Should have user message
      const userMessages = messages.filter((msg) => msg.role === "user");
      expect(userMessages.length).toBeGreaterThanOrEqual(1);

      // First user message should be the original prompt
      const firstUserBlock = userMessages[0].blocks?.[0];
      expect(
        firstUserBlock && hasContent(firstUserBlock)
          ? firstUserBlock.content
          : undefined,
      ).toBe("complete task");

      // Should have assistant message with response
      const assistantMessages = messages.filter(
        (msg) => msg.role === "assistant",
      );
      expect(assistantMessages.length).toBeGreaterThanOrEqual(1);

      // Should have the AI response text
      const allBlocks = assistantMessages.flatMap((msg) => msg.blocks || []);
      const hasResponseText = allBlocks.some(
        (block) =>
          hasContent(block) &&
          block.content.includes("Task completed successfully"),
      );
      expect(hasResponseText).toBe(true);

      // Should have error block from non-blocking error
      const errorBlocks = allBlocks.filter((block) => block.type === "error");
      expect(errorBlocks.length).toBeGreaterThanOrEqual(1);
      const errorBlock = errorBlocks.find(
        (block) => hasContent(block) && block.content.includes("Stop warning"),
      );
      expect(errorBlock).toBeDefined();
    });
  });
});
