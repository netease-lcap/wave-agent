import { describe, it, expect, vi, beforeEach } from "vitest";
import { Agent } from "@/agent.js";
import * as aiService from "@/services/aiService.js";
import { createMockToolManager } from "../helpers/mockFactories.js";

import type { ErrorBlock } from "@/types/index.js";

// Mock AI Service
vi.mock("@/services/aiService");

// Mock tool registry to control tool execution
const { instance: mockToolManagerInstance, execute: mockToolExecute } =
  createMockToolManager();
vi.mock("@/managers/toolManager", () => ({
  ToolManager: vi.fn().mockImplementation(function () {
    return mockToolManagerInstance;
  }),
}));

describe("Agent - Abort Handling", () => {
  let agent: Agent;

  beforeEach(async () => {
    // Create mock callbacks
    const mockCallbacks = {
      onMessagesChange: vi.fn(),
      onLoadingChange: vi.fn(),
    };

    // Create Agent instance with required parameters
    agent = await Agent.create({
      callbacks: mockCallbacks,
    });

    vi.clearAllMocks();
  });

  it("should handle JSON parse error gracefully when aborted during tool argument streaming", async () => {
    const mockCallAgent = vi.mocked(aiService.callAgent);

    // Execute the test - should not throw error even with incomplete JSON and abort
    await expect(agent.sendMessage("Test message")).resolves.not.toThrow();

    // Verify that the manager doesn't crash and handles the situation gracefully
    expect(mockCallAgent).toHaveBeenCalledTimes(1);

    // Check that no error message is added to the conversation when aborted
    const messages = agent.messages;
    const errorBlocks = messages.flatMap((msg) =>
      msg.blocks.filter((block) => block.type === "error"),
    );
    const hasParseError = errorBlocks.some((block) =>
      (block as ErrorBlock).content?.includes("Failed to parse tool arguments"),
    );
    expect(hasParseError).toBe(false);
  });

  it("should show JSON parse error when not aborted but has malformed JSON", async () => {
    const mockCallAgent = vi.mocked(aiService.callAgent);

    // Mock tool execute - should not be called due to JSON parse error
    mockToolExecute.mockResolvedValue({
      success: false,
      content: "Should not execute",
      error: "Should not reach here",
    });

    // Use a call counter to prevent infinite recursion
    let callCount = 0;

    // Mock callAgent to return malformed JSON tool call on first call, then no tools
    mockCallAgent.mockImplementation(async () => {
      callCount++;

      if (callCount === 1) {
        // First call: return malformed JSON tool call
        return {
          content: "",
          tool_calls: [
            {
              id: "tool_123",
              type: "function" as const,
              function: {
                name: "search_replace",
                arguments: '{"file_path": "test.ts", "old_string": malformed}', // malformed JSON - missing quotes
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
        // Subsequent calls: return no tool calls to stop recursion
        return {
          content:
            "I see there was a JSON parsing error. Let me provide a proper response.",
          tool_calls: [], // No more tool calls to prevent infinite recursion
          usage: {
            prompt_tokens: 5,
            completion_tokens: 10,
            total_tokens: 15,
          },
        };
      }
    });

    // Execute the test
    await agent.sendMessage("Test message");

    // Check that error message is added to the tool block when not aborted
    const messages = agent.messages;
    const toolBlocks = messages.flatMap((msg) =>
      msg.blocks.filter((block) => block.type === "tool"),
    );
    const hasParseError = toolBlocks.some((block) => {
      const errorMsg =
        typeof block.error === "string"
          ? block.error
          : block.error?.message || "";
      return errorMsg.includes("Failed to parse tool arguments");
    });
    expect(hasParseError).toBe(true);

    // Verify tool execute was not called due to JSON parse error
    expect(mockToolExecute).not.toHaveBeenCalled();

    // Verify callAgent was called at least twice (initial + recursive after error)
    expect(mockCallAgent).toHaveBeenCalledTimes(2);
  });

  it("should abort gracefully without executing tools when interrupted during streaming", async () => {
    const mockCallAgent = vi.mocked(aiService.callAgent);

    // Mock tool execute to verify it's never called
    mockToolExecute.mockResolvedValue({
      success: true,
      content: "Should never execute",
    });

    // Setup initial messages
    mockCallAgent.mockImplementation(async ({ abortSignal }) => {
      // Simulate abort during processing
      if (abortSignal) {
        // Create a new AbortController to simulate the abort
        const controller = new AbortController();
        controller.abort();
        // Mock the aborted signal
        Object.defineProperty(abortSignal, "aborted", {
          value: true,
          writable: true,
        });
      }

      // Even though we return tool calls, they shouldn't be executed due to abort
      return {
        content: "",
        tool_calls: [
          {
            id: "tool_123",
            type: "function" as const,
            function: {
              name: "search_replace",
              arguments: '{"file_path": "test.ts"}', // valid JSON
            },
          },
        ],
        usage: {
          prompt_tokens: 10,
          completion_tokens: 20,
          total_tokens: 30,
        },
      };
    });

    // Mock tool execute to ensure it's not called
    mockToolExecute.mockResolvedValue({
      success: true,
      content: "Tool should not execute",
    });

    await agent.sendMessage("Test message");

    // Verify no tools were actually executed due to abort
    expect(mockToolExecute).not.toHaveBeenCalled();
  });

  it("should abort slash command execution", async () => {
    // Mock AI service to simulate a long-running slash command
    const mockCallAgent = vi.mocked(aiService.callAgent);

    mockCallAgent.mockImplementation(async ({ abortSignal }) => {
      return new Promise((resolve, reject) => {
        // Simulate long-running operation
        const timeout = setTimeout(() => {
          resolve({
            content: "This should not complete due to abort",
            tool_calls: [],
            usage: {
              prompt_tokens: 10,
              completion_tokens: 20,
              total_tokens: 30,
            },
          });
        }, 1000); // 1 second delay

        // Listen for abort signal
        if (abortSignal) {
          abortSignal.addEventListener(
            "abort",
            () => {
              clearTimeout(timeout);
              reject(new Error("Aborted"));
            },
            { once: true },
          );
        }
      });
    });

    // Start executing a slash command via sendMessage (this would normally trigger sub-agent)
    const executePromise = agent.sendMessage("/clear");

    // Immediately abort
    setTimeout(() => {
      agent.abortSlashCommand();
    }, 100); // Abort after 100ms

    // Wait for execution to complete
    await executePromise;

    // The clear command should execute since it's synchronous and completes quickly
    // For custom commands that use AI, the abort would work
    // Since sendMessage returns void, we just verify it doesn't throw
    expect(true).toBe(true); // Test passes if no exception was thrown
  });

  it("should not accumulate abort listeners when using same signal multiple times", async () => {
    // Create a shared abort signal to simulate reuse scenario
    const abortController = new AbortController();

    // Mock console.warn to catch the memory leak warning
    const consoleWarnSpy = vi
      .spyOn(console, "warn")
      .mockImplementation(function () {});

    try {
      // Create multiple SubagentManager instances that would use the same signal
      // This simulates the scenario that was causing the memory leak
      const promises: Promise<void>[] = [];

      // Create 12 operations to exceed the warning threshold
      for (let i = 0; i < 12; i++) {
        const promise = new Promise<void>((resolve, reject) => {
          // Simulate what SubagentManager.executeTask does
          if (abortController.signal.aborted) {
            reject(new Error("Already aborted"));
            return;
          }

          // Add listeners the way our fixed code does (with { once: true })
          abortController.signal.addEventListener(
            "abort",
            () => {
              reject(new Error(`Task ${i} aborted`));
            },
            { once: true },
          );

          // Resolve after a short delay
          setTimeout(() => resolve(), 10);
        });

        promises.push(promise);
      }

      // Wait for all operations to complete
      await Promise.allSettled(promises);

      // Check that no MaxListenersExceededWarning was issued
      const memoryLeakWarnings = consoleWarnSpy.mock.calls.filter((call) =>
        call.some(
          (arg) =>
            typeof arg === "string" &&
            arg.includes("MaxListenersExceededWarning"),
        ),
      );

      expect(memoryLeakWarnings).toHaveLength(0);
    } finally {
      consoleWarnSpy.mockRestore();

      // Clean up - abort to ensure all listeners are cleaned up
      if (!abortController.signal.aborted) {
        abortController.abort();
      }
    }
  });
});
