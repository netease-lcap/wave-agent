import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Agent } from "@/agent.js";
import * as aiService from "@/services/aiService.js";
import { HookManager } from "@/managers/hookManager.js";
import type { MessageBlock } from "@/types/messaging.js";
import { ToolManager } from "@/managers/toolManager.js";

// Type guard helper function
function hasContent(
  block: MessageBlock,
): block is MessageBlock & { content: string } {
  return "content" in block;
}

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
      // Get the hook manager instance from the agent to mock its executeHooks method
      const hookManager = (agent as unknown as { hookManager: HookManager })
        .hookManager;
      const mockExecuteHooks = vi.spyOn(hookManager, "executeHooks");

      // Mock hook executions based on event type
      mockExecuteHooks.mockImplementation(async (event) => {
        if (event === "PreToolUse") {
          // PreToolUse hooks return success but stdout should NOT be injected as user message
          return [
            {
              success: true,
              exitCode: 0,
              stdout: "PreToolUse context that should NOT be injected",
              stderr: "",
              duration: 50,
              timedOut: false,
            },
          ];
        }
        // Return empty results for other hook events
        return [];
      });

      // Mock tool manager to simulate tool execution
      const toolManager = (agent as unknown as { toolManager: ToolManager })
        .toolManager;
      const mockToolExecute = vi.spyOn(toolManager, "execute");
      mockToolExecute.mockResolvedValue({
        success: true,
        content: "Tool executed successfully",
      });

      // Mock AI service to return tool calls
      const mockCallAgent = vi.mocked(aiService.callAgent);
      let callCount = 0;
      mockCallAgent.mockImplementation(async () => {
        callCount++;
        if (callCount === 1) {
          // First call: return tool call
          return {
            content: "",
            tool_calls: [
              {
                id: "tool_123",
                type: "function" as const,
                function: {
                  name: "Read",
                  arguments: '{"file_path": "/test/file.txt"}',
                },
              },
            ],
            usage: {
              prompt_tokens: 10,
              completion_tokens: 20,
              total_tokens: 30,
            },
          };
        } else {
          // Second call: return text response without tools
          return {
            content: "Tool execution completed",
            tool_calls: [],
            usage: {
              prompt_tokens: 5,
              completion_tokens: 10,
              total_tokens: 15,
            },
          };
        }
      });

      await agent.sendMessage("test prompt");

      // Verify PreToolUse hook was executed
      expect(mockExecuteHooks).toHaveBeenCalledWith(
        "PreToolUse",
        expect.objectContaining({
          event: "PreToolUse",
          toolName: "Read",
        }),
      );

      // Verify that NO additional user messages were injected from PreToolUse stdout
      const messages = agent.messages;
      const userMessages = messages.filter((msg) => msg.role === "user");

      // Should only have original user message
      expect(userMessages).toHaveLength(1);
      const firstUserBlock = userMessages[0].blocks?.[0];
      expect(
        firstUserBlock && hasContent(firstUserBlock)
          ? firstUserBlock.content
          : undefined,
      ).toBe("test prompt");

      // Verify tool was executed (PreToolUse hook didn't block it)
      expect(mockToolExecute).toHaveBeenCalledWith(
        "Read",
        { file_path: "/test/file.txt" },
        expect.any(Object), // tool context
      );
    });

    it("should ignore stdout for PostToolUse hooks", async () => {
      // Get the hook manager instance from the agent to mock its executeHooks method
      const hookManager = (agent as unknown as { hookManager: HookManager })
        .hookManager;
      const mockExecuteHooks = vi.spyOn(hookManager, "executeHooks");

      // Mock hook executions based on event type
      mockExecuteHooks.mockImplementation(async (event) => {
        if (event === "PostToolUse") {
          // PostToolUse hooks return success but stdout should NOT be injected as user message
          return [
            {
              success: true,
              exitCode: 0,
              stdout: "PostToolUse context that should NOT be injected",
              stderr: "",
              duration: 75,
              timedOut: false,
            },
          ];
        }
        // Return empty results for other hook events
        return [];
      });

      // Mock tool manager to simulate tool execution
      const toolManager = (agent as unknown as { toolManager: ToolManager })
        .toolManager;
      const mockToolExecute = vi.spyOn(toolManager, "execute");
      mockToolExecute.mockResolvedValue({
        success: true,
        content: "Tool executed successfully",
      });

      // Mock AI service to return tool calls
      const mockCallAgent = vi.mocked(aiService.callAgent);
      let callCount = 0;
      mockCallAgent.mockImplementation(async () => {
        callCount++;
        if (callCount === 1) {
          // First call: return tool call
          return {
            content: "",
            tool_calls: [
              {
                id: "tool_456",
                type: "function" as const,
                function: {
                  name: "Write",
                  arguments:
                    '{"file_path": "/test/output.txt", "content": "hello"}',
                },
              },
            ],
            usage: {
              prompt_tokens: 15,
              completion_tokens: 25,
              total_tokens: 40,
            },
          };
        } else {
          // Second call: return text response without tools
          return {
            content: "File written successfully",
            tool_calls: [],
            usage: {
              prompt_tokens: 8,
              completion_tokens: 12,
              total_tokens: 20,
            },
          };
        }
      });

      await agent.sendMessage("write a file");

      // Verify PostToolUse hook was executed
      expect(mockExecuteHooks).toHaveBeenCalledWith(
        "PostToolUse",
        expect.objectContaining({
          event: "PostToolUse",
          toolName: "Write",
        }),
      );

      // Verify that NO additional user messages were injected from PostToolUse stdout
      const messages = agent.messages;
      const userMessages = messages.filter((msg) => msg.role === "user");

      // Should only have original user message
      expect(userMessages).toHaveLength(1);
      const firstUserBlock = userMessages[0].blocks?.[0];
      expect(
        firstUserBlock && hasContent(firstUserBlock)
          ? firstUserBlock.content
          : undefined,
      ).toBe("write a file");

      // Verify tool was executed and PostToolUse hook ran after
      expect(mockToolExecute).toHaveBeenCalledWith(
        "Write",
        { file_path: "/test/output.txt", content: "hello" },
        expect.any(Object), // tool context
      );
    });

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
      const userMessages = messages.filter((msg) => msg.role === "user");

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
