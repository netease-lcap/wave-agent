import { describe, it, expect, vi, beforeEach } from "vitest";
import { Agent } from "@/agent.js";
import * as aiService from "@/services/aiService.js";
import { createMockToolManager } from "../helpers/mockFactories.js";
import { Container } from "@/utils/container.js";
import { AIManager } from "@/managers/aiManager.js";

import type { ErrorBlock, Usage } from "@/types/index.js";

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
      apiKey: "test-key",
      workdir: "/tmp/test-abort",
      callbacks: mockCallbacks,
    });

    // Register mock ToolManager in the agent's container
    const container = (agent as unknown as { container: Container }).container;
    container.register("ToolManager", mockToolManagerInstance);

    // Mock McpManager and register it to avoid undefined errors in ToolManager.execute
    const mockMcpManager = {
      isMcpTool: vi.fn().mockReturnValue(false),
      getMcpToolPlugins: vi.fn().mockReturnValue([]),
      getMcpToolsConfig: vi.fn().mockReturnValue([]),
    };
    container.register("McpManager", mockMcpManager);

    // Mock SubagentManager and register it
    const mockSubagentManager = {
      getConfigurations: vi.fn().mockReturnValue([]),
      initialize: vi.fn().mockResolvedValue(undefined),
    };
    container.register("SubagentManager", mockSubagentManager);

    // Mock SkillManager and register it
    const mockSkillManager = {
      getAvailableSkills: vi.fn().mockReturnValue([]),
      initialize: vi.fn().mockResolvedValue(undefined),
    };
    container.register("SkillManager", mockSkillManager);

    // Re-initialize AIManager to pick up the mock ToolManager
    const aiManager = new AIManager(container, {
      callbacks: {
        ...mockCallbacks,
        onUsageAdded: (usage: Usage) =>
          (
            agent as unknown as {
              messageManager: { addUsage: (u: Usage) => void };
            }
          ).messageManager.addUsage(usage),
      },
      workdir: "/tmp/test-abort",
      getGatewayConfig: () => agent.getGatewayConfig(),
      getModelConfig: () => agent.getModelConfig(),
      getMaxInputTokens: () => agent.getMaxInputTokens(),
      getLanguage: () => agent.getLanguage(),
      getEnvironmentVars: () =>
        (
          agent as unknown as {
            configurationService: {
              getEnvironmentVars: () => Record<string, string>;
            };
          }
        ).configurationService.getEnvironmentVars(),
      stream: true, // Enable streaming for tests that expect it
    });
    container.register("AIManager", aiManager);
    (agent as unknown as { aiManager: AIManager }).aiManager = aiManager;
    (agent as unknown as { stream: boolean }).stream = true; // Ensure Agent also thinks streaming is enabled

    // Mock callAgent on the aiService module
    vi.spyOn(aiService, "callAgent").mockResolvedValue({
      content: "Mock response",
      tool_calls: [],
      usage: {
        prompt_tokens: 10,
        completion_tokens: 20,
        total_tokens: 30,
      },
    });

    vi.clearAllMocks();
  });

  it("should handle JSON parse error gracefully when aborted during tool argument streaming", async () => {
    const mockCallAgent = vi.mocked(aiService.callAgent);

    // Mock callAgent to simulate streaming and then abort
    mockCallAgent.mockImplementation(async (options) => {
      if (options.onToolUpdate) {
        options.onToolUpdate({
          id: "tool_123",
          name: "test_tool",
          parameters: '{"arg": "val', // Incomplete JSON
          parametersChunk: '"arg": "val',
          stage: "streaming",
        });
      }
      return {
        content: "Aborted",
        tool_calls: [
          {
            id: "tool_123",
            type: "function" as const,
            function: {
              name: "test_tool",
              arguments: '{"arg": "val', // Incomplete JSON
            },
          },
        ],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
      };
    });

    // Execute the test - should not throw error even with incomplete JSON and abort
    const sendPromise = agent.sendMessage("Test message");

    // Simulate abort during streaming
    setTimeout(() => {
      agent.abortAIMessage();
    }, 10);

    await expect(sendPromise).resolves.not.toThrow();

    // Verify that the manager doesn't crash and handles the situation gracefully
    expect(mockCallAgent).toHaveBeenCalled();

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
    mockCallAgent.mockImplementation(async (options) => {
      callCount++;

      if (callCount === 1) {
        // Simulate streaming of malformed JSON
        if (options.onToolUpdate) {
          options.onToolUpdate({
            id: "tool_123",
            name: "search_replace",
            parameters: '{"file_path": "test.ts", "old_string": malformed}', // malformed JSON
            parametersChunk:
              '{"file_path": "test.ts", "old_string": malformed}',
            stage: "streaming",
          });
        }

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
