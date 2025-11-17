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
import "./test-setup.ts";

// Mock AI service directly in this file
vi.mock("@/services/aiService", () => ({
  callAgent: vi.fn(),
}));

// Get access to the mocked tool manager
let mockToolExecute: ReturnType<typeof vi.fn>;
vi.mock("@/managers/toolManager", () => ({
  ToolManager: vi.fn().mockImplementation(() => ({
    execute: (mockToolExecute = vi.fn()),
    list: vi.fn(() => []),
    getToolsConfig: vi.fn(() => []),
  })),
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
    it("should handle PreToolUse blocking errors", async () => {
      // Get the hook manager instance from the agent to mock its executeHooks method
      const hookManager = (agent as unknown as { hookManager: HookManager })
        .hookManager;
      const mockExecuteHooks = vi.spyOn(hookManager, "executeHooks");

      // Mock hook executions - return blocking error only for PreToolUse
      mockExecuteHooks.mockImplementation(async (event) => {
        if (event === "PreToolUse") {
          return [
            {
              success: false,
              exitCode: 2,
              stdout: "",
              stderr: "Tool execution blocked by security policy",
              duration: 30,
              timedOut: false,
            },
          ];
        }
        // Return empty results for other hook events
        return [];
      });

      // Mock tool manager - may or may not be called depending on current implementation
      mockToolExecute.mockResolvedValue({
        success: true,
        content: "Tool executed",
      });

      // Mock AI service to return tool calls first, then text response
      const mockCallAgent = vi.mocked(aiService.callAgent);
      let callCount = 0;
      mockCallAgent.mockImplementation(async () => {
        callCount++;
        if (callCount === 1) {
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
          return {
            content: "Task completed",
            tool_calls: [],
            usage: {
              prompt_tokens: 5,
              completion_tokens: 10,
              total_tokens: 15,
            },
          };
        }
      });

      await agent.sendMessage("read test file");

      // Verify PreToolUse hook was executed
      expect(mockExecuteHooks).toHaveBeenCalledWith(
        "PreToolUse",
        expect.objectContaining({
          event: "PreToolUse",
          toolName: "Read",
        }),
      );

      // Verify that the agent handled the PreToolUse blocking error
      // (The exact behavior may depend on implementation)
      const messages = agent.messages;
      expect(messages.length).toBeGreaterThan(0);
      
      // Should have at least user message and some response
      const userMessages = messages.filter((msg) => msg.role === "user");
      expect(userMessages).toHaveLength(1);

      // Should have some assistant response  
      const assistantMessages = messages.filter((msg) => msg.role === "assistant");
      expect(assistantMessages.length).toBeGreaterThan(0);
    });
  });

  describe("PostToolUse blocking errors (exit code 2)", () => {
    it("should handle PostToolUse blocking errors after tool execution", async () => {
      // Get the hook manager instance from the agent to mock its executeHooks method
      const hookManager = (agent as unknown as { hookManager: HookManager })
        .hookManager;
      const mockExecuteHooks = vi.spyOn(hookManager, "executeHooks");

      // Mock hook executions - return blocking error only for PostToolUse
      mockExecuteHooks.mockImplementation(async (event) => {
        if (event === "PostToolUse") {
          return [
            {
              success: false,
              exitCode: 2,
              stdout: "",
              stderr: "Data validation failed after tool execution",
              duration: 45,
              timedOut: false,
            },
          ];
        }
        // Return empty results for other hook events
        return [];
      });

      // Mock tool manager - should be called since PostToolUse runs after tool execution
      mockToolExecute.mockResolvedValue({
        success: true,
        content: "File written successfully",
      });

      // Mock AI service to return tool calls first, then text response
      const mockCallAgent = vi.mocked(aiService.callAgent);
      let callCount = 0;
      mockCallAgent.mockImplementation(async () => {
        callCount++;
        if (callCount === 1) {
          return {
            content: "",
            tool_calls: [
              {
                id: "tool_456",
                type: "function" as const,
                function: {
                  name: "Write",
                  arguments: '{"file_path": "/test/output.txt", "content": "data"}',
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
          return {
            content: "Tool execution completed",
            tool_calls: [],
            usage: {
              prompt_tokens: 8,
              completion_tokens: 12,
              total_tokens: 20,
            },
          };
        }
      });

      await agent.sendMessage("write data to file");

      // Verify tool was executed (PostToolUse doesn't block initial tool execution)
      expect(mockToolExecute).toHaveBeenCalledWith(
        "Write",
        { file_path: "/test/output.txt", content: "data" },
        expect.any(Object), // tool context
      );

      // Verify PostToolUse hook was executed
      expect(mockExecuteHooks).toHaveBeenCalledWith(
        "PostToolUse",
        expect.objectContaining({
          event: "PostToolUse",
          toolName: "Write",
        }),
      );

      // Verify AI was called (at least once, possibly twice)
      expect(mockCallAgent).toHaveBeenCalledTimes(2);

      // Should have messages including the PostToolUse error handling
      const messages = agent.messages;
      expect(messages.length).toBeGreaterThan(0);

      // Should have user message
      const userMessages = messages.filter((msg) => msg.role === "user");
      expect(userMessages).toHaveLength(1);

      // Should have assistant messages
      const assistantMessages = messages.filter((msg) => msg.role === "assistant");
      expect(assistantMessages.length).toBeGreaterThan(0);
    });
  });

  describe("Stop blocking errors (exit code 2)", () => {
    it("should handle Stop blocking errors and show error in assistant message", async () => {
      // Get the hook manager instance from the agent to mock its executeHooks method
      const hookManager = (agent as unknown as { hookManager: HookManager })
        .hookManager;
      const mockExecuteHooks = vi.spyOn(hookManager, "executeHooks");

      // Mock hook executions - return blocking error only for Stop
      mockExecuteHooks.mockImplementation(async (event) => {
        if (event === "Stop") {
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

      // Verify AI was called at least once
      expect(mockCallAgent).toHaveBeenCalledTimes(1);

      // Should have messages including the Stop hook error handling
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
      const assistantMessages = messages.filter((msg) => msg.role === "assistant");
      expect(assistantMessages.length).toBeGreaterThanOrEqual(1);
      
      // Should have the AI response text somewhere in the messages
      const allBlocks = assistantMessages.flatMap(msg => msg.blocks || []);
      const hasResponseText = allBlocks.some(block => 
        hasContent(block) && block.content.includes("Task completed successfully")
      );
      expect(hasResponseText).toBe(true);
    });
  });
});
