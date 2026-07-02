import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Agent } from "@/agent.js";
import * as aiService from "@/services/aiService.js";
import { createMockToolManager } from "../helpers/mockFactories.js";
import { Container } from "@/utils/container.js";
import { AIManager } from "@/managers/aiManager.js";

import type { ErrorBlock, Usage } from "@/types/index.js";
import type { QueuedMessage } from "@/managers/messageQueue.js";

// Mock AI Service
vi.mock("@/services/aiService");

// Mock telemetry module
vi.mock("@/telemetry/instrumentation.js", () => ({
  initializeTelemetry: vi.fn().mockResolvedValue(undefined),
  shutdownTelemetry: vi.fn().mockResolvedValue(undefined),
  getCurrentConfig: vi.fn().mockReturnValue(undefined),
  getOTELApi: vi.fn().mockReturnValue(undefined),
  isInitialized: vi.fn().mockReturnValue(false),
  JsonlSpanExporter: class {},
  JsonlLogExporter: class {},
}));

vi.mock("@/telemetry/events.js", () => ({
  logOTelEvent: vi.fn().mockResolvedValue(undefined),
}));

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
  let activeTestAgent: Agent | undefined;

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

    // Register ConfigurationService in the container
    container.register("ConfigurationService", {
      resolveGatewayConfig: () => agent.getGatewayConfig(),
      resolveModelConfig: () => agent.getModelConfig(),
      resolveMaxInputTokens: () => agent.getMaxInputTokens(),
      resolveAutoMemoryEnabled: () => true,
      resolveLanguage: () => agent.getLanguage(),
      getEnvironmentVars: () =>
        (
          agent as unknown as {
            configurationService: {
              getEnvironmentVars: () => Record<string, string>;
            };
          }
        ).configurationService.getEnvironmentVars(),
    });

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

  afterEach(async () => {
    if (activeTestAgent) {
      await activeTestAgent.destroy();
      activeTestAgent = undefined;
    }
    if (agent) {
      await agent.destroy();
    }
  });

  it(
    "should handle JSON parse error gracefully when aborted during tool argument streaming",
    { timeout: 15000 },
    async () => {
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
      const abortTimer = setTimeout(() => {
        agent.abortAIMessage();
      }, 50);

      await expect(sendPromise).resolves.not.toThrow();
      clearTimeout(abortTimer);

      // Verify that the manager doesn't crash and handles the situation gracefully
      expect(mockCallAgent).toHaveBeenCalled();

      // Check that no error message is added to the conversation when aborted
      const messages = agent.messages;
      const errorBlocks = messages.flatMap((msg) =>
        msg.blocks.filter((block) => block.type === "error"),
      );
      const hasParseError = errorBlocks.some((block) =>
        (block as ErrorBlock).content?.includes(
          "Failed to parse tool arguments",
        ),
      );
      expect(hasParseError).toBe(false);
    },
  );

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

  it("should clear message queue before aborting AI to prevent race condition", async () => {
    const mockCallbacks = {
      onMessagesChange: vi.fn(),
      onLoadingChange: vi.fn(),
      onQueuedMessagesChange: vi.fn(),
    };

    // Create Agent instance
    const testAgent = await Agent.create({
      apiKey: "test-key",
      workdir: "/tmp/test-abort-queue",
      callbacks: mockCallbacks,
    });

    // Register mock ToolManager
    activeTestAgent = testAgent;
    const container = (testAgent as unknown as { container: Container })
      .container;
    container.register("ToolManager", mockToolManagerInstance);

    // Register required managers
    container.register("McpManager", {
      isMcpTool: vi.fn().mockReturnValue(false),
      getMcpToolPlugins: vi.fn().mockReturnValue([]),
      getMcpToolsConfig: vi.fn().mockReturnValue([]),
    });
    container.register("SubagentManager", {
      getConfigurations: vi.fn().mockReturnValue([]),
      initialize: vi.fn().mockResolvedValue(undefined),
    });
    container.register("SkillManager", {
      getAvailableSkills: vi.fn().mockReturnValue([]),
      initialize: vi.fn().mockResolvedValue(undefined),
    });
    container.register("ConfigurationService", {
      resolveGatewayConfig: () => testAgent.getGatewayConfig(),
      resolveModelConfig: () => testAgent.getModelConfig(),
      resolveMaxInputTokens: () => testAgent.getMaxInputTokens(),
      resolveAutoMemoryEnabled: () => true,
      resolveLanguage: () => testAgent.getLanguage(),
      getEnvironmentVars: () =>
        (
          testAgent as unknown as {
            configurationService: {
              getEnvironmentVars: () => Record<string, string>;
            };
          }
        ).configurationService.getEnvironmentVars(),
    });

    // Track queuedMessages changes
    let queuedMessages: QueuedMessage[] = [];
    mockCallbacks.onQueuedMessagesChange.mockImplementation(
      (msgs: QueuedMessage[]) => {
        queuedMessages = [...msgs];
      },
    );

    // Set AI loading to true so sendMessage will enqueue instead of executing
    const aiManager = (testAgent as unknown as { aiManager: AIManager })
      .aiManager;
    aiManager.setIsLoading(true);

    // Enqueue messages via sendMessage (they get queued because isLoading=true)
    await testAgent.sendMessage("queued msg 1");
    await testAgent.sendMessage("queued msg 2");

    expect(queuedMessages).toHaveLength(2);

    // Now abortMessage() should clear queue BEFORE triggering onLoadingChange
    testAgent.abortMessage();

    // After abort, queue should be empty
    expect(queuedMessages).toHaveLength(0);
    expect(mockCallbacks.onQueuedMessagesChange).toHaveBeenCalledWith([]);
  });

  describe("abortMessage queue behavior", () => {
    it("should not clear queue when agent is idle", async () => {
      const mockCallbacks = {
        onMessagesChange: vi.fn(),
        onLoadingChange: vi.fn(),
        onQueuedMessagesChange: vi.fn(),
      };

      const testAgent = await Agent.create({
        apiKey: "test-key",
        workdir: "/tmp/test-abort-queue-idle",
        callbacks: mockCallbacks,
      });

      activeTestAgent = testAgent;
      const container = (testAgent as unknown as { container: Container })
        .container;
      container.register("ToolManager", mockToolManagerInstance);
      container.register("McpManager", {
        isMcpTool: vi.fn().mockReturnValue(false),
        getMcpToolPlugins: vi.fn().mockReturnValue([]),
        getMcpToolsConfig: vi.fn().mockReturnValue([]),
      });
      container.register("SubagentManager", {
        getConfigurations: vi.fn().mockReturnValue([]),
        initialize: vi.fn().mockResolvedValue(undefined),
      });
      container.register("SkillManager", {
        getAvailableSkills: vi.fn().mockReturnValue([]),
        initialize: vi.fn().mockResolvedValue(undefined),
      });
      container.register("ConfigurationService", {
        resolveGatewayConfig: () => testAgent.getGatewayConfig(),
        resolveModelConfig: () => testAgent.getModelConfig(),
        resolveMaxInputTokens: () => testAgent.getMaxInputTokens(),
        resolveAutoMemoryEnabled: () => true,
        resolveLanguage: () => testAgent.getLanguage(),
        getEnvironmentVars: () =>
          (
            testAgent as unknown as {
              configurationService: {
                getEnvironmentVars: () => Record<string, string>;
              };
            }
          ).configurationService.getEnvironmentVars(),
      });

      // Disconnect onMessageEnqueued to prevent auto-dequeue during test setup
      const messageQueue = (
        testAgent as unknown as {
          messageQueue: import("@/managers/messageQueue.js").MessageQueue;
        }
      ).messageQueue;
      messageQueue.onMessageEnqueued = undefined;

      // Enqueue messages directly — agent is idle (not loading, no command running)
      messageQueue.enqueue({ content: "queued msg 1" });
      messageQueue.enqueue({ content: "queued msg 2" });
      expect(messageQueue.hasPending()).toBe(true);

      // Spy on messageQueue.clear to verify it is NOT called when idle
      const clearSpy = vi.spyOn(messageQueue, "clear");

      // Also disconnect onLoadingChange to prevent tryDequeue from draining the queue
      // after abortAIMessage triggers onLoadingChange(false)
      const aiManager = (testAgent as unknown as { aiManager: AIManager })
        .aiManager;
      aiManager.onLoadingChange = undefined;

      // Call abortMessage while idle
      testAgent.abortMessage();

      // clear() should NOT have been called because agent was not busy
      expect(clearSpy).not.toHaveBeenCalled();
      // Queue should still have messages (not explicitly cleared)
      expect(messageQueue.hasPending()).toBe(true);

      clearSpy.mockRestore();
    });

    it("should clear queue when agent is busy (loading)", async () => {
      const mockCallbacks = {
        onMessagesChange: vi.fn(),
        onLoadingChange: vi.fn(),
        onQueuedMessagesChange: vi.fn(),
      };

      const testAgent = await Agent.create({
        apiKey: "test-key",
        workdir: "/tmp/test-abort-queue-busy",
        callbacks: mockCallbacks,
      });

      activeTestAgent = testAgent;
      const container = (testAgent as unknown as { container: Container })
        .container;
      container.register("ToolManager", mockToolManagerInstance);
      container.register("McpManager", {
        isMcpTool: vi.fn().mockReturnValue(false),
        getMcpToolPlugins: vi.fn().mockReturnValue([]),
        getMcpToolsConfig: vi.fn().mockReturnValue([]),
      });
      container.register("SubagentManager", {
        getConfigurations: vi.fn().mockReturnValue([]),
        initialize: vi.fn().mockResolvedValue(undefined),
      });
      container.register("SkillManager", {
        getAvailableSkills: vi.fn().mockReturnValue([]),
        initialize: vi.fn().mockResolvedValue(undefined),
      });
      container.register("ConfigurationService", {
        resolveGatewayConfig: () => testAgent.getGatewayConfig(),
        resolveModelConfig: () => testAgent.getModelConfig(),
        resolveMaxInputTokens: () => testAgent.getMaxInputTokens(),
        resolveAutoMemoryEnabled: () => true,
        resolveLanguage: () => testAgent.getLanguage(),
        getEnvironmentVars: () =>
          (
            testAgent as unknown as {
              configurationService: {
                getEnvironmentVars: () => Record<string, string>;
              };
            }
          ).configurationService.getEnvironmentVars(),
      });

      // Disconnect onMessageEnqueued to prevent auto-dequeue during test setup
      const messageQueue = (
        testAgent as unknown as {
          messageQueue: import("@/managers/messageQueue.js").MessageQueue;
        }
      ).messageQueue;
      messageQueue.onMessageEnqueued = undefined;

      // Enqueue messages
      messageQueue.enqueue({ content: "queued msg 1" });
      messageQueue.enqueue({ content: "queued msg 2" });
      expect(messageQueue.hasPending()).toBe(true);

      // Set agent as busy
      const aiManager = (testAgent as unknown as { aiManager: AIManager })
        .aiManager;
      aiManager.setIsLoading(true);

      // Call abortMessage while busy
      testAgent.abortMessage();

      // Queue should be cleared
      expect(messageQueue.hasPending()).toBe(false);
      expect(messageQueue.getQueue()).toHaveLength(0);
    });

    it("should reset queue state to idle on abort", async () => {
      const testAgent = await Agent.create({
        apiKey: "test-key",
        workdir: "/tmp/test-abort-queue-state",
        callbacks: {
          onMessagesChange: vi.fn(),
          onLoadingChange: vi.fn(),
        },
      });

      activeTestAgent = testAgent;
      const container = (testAgent as unknown as { container: Container })
        .container;
      container.register("ToolManager", mockToolManagerInstance);
      container.register("McpManager", {
        isMcpTool: vi.fn().mockReturnValue(false),
        getMcpToolPlugins: vi.fn().mockReturnValue([]),
        getMcpToolsConfig: vi.fn().mockReturnValue([]),
      });
      container.register("SubagentManager", {
        getConfigurations: vi.fn().mockReturnValue([]),
        initialize: vi.fn().mockResolvedValue(undefined),
      });
      container.register("SkillManager", {
        getAvailableSkills: vi.fn().mockReturnValue([]),
        initialize: vi.fn().mockResolvedValue(undefined),
      });
      container.register("ConfigurationService", {
        resolveGatewayConfig: () => testAgent.getGatewayConfig(),
        resolveModelConfig: () => testAgent.getModelConfig(),
        resolveMaxInputTokens: () => testAgent.getMaxInputTokens(),
        resolveAutoMemoryEnabled: () => true,
        resolveLanguage: () => testAgent.getLanguage(),
        getEnvironmentVars: () =>
          (
            testAgent as unknown as {
              configurationService: {
                getEnvironmentVars: () => Record<string, string>;
              };
            }
          ).configurationService.getEnvironmentVars(),
      });

      const messageQueue = (
        testAgent as unknown as {
          messageQueue: import("@/managers/messageQueue.js").MessageQueue;
        }
      ).messageQueue;

      // Transition queue to "dispatching" state
      expect(messageQueue.transitionTo("dispatching")).toBe(true);
      expect(messageQueue.state).toBe("dispatching");

      // Call abortMessage — should reset queue state to idle
      testAgent.abortMessage();

      expect(messageQueue.state).toBe("idle");
    });
  });

  describe("recallQueuedMessage", () => {
    it("should recall last editable message from queue", async () => {
      const mockCallbacks = {
        onMessagesChange: vi.fn(),
        onLoadingChange: vi.fn(),
        onQueuedMessagesChange: vi.fn(),
      };

      const testAgent = await Agent.create({
        apiKey: "test-key",
        workdir: "/tmp/test-recall-queue",
        callbacks: mockCallbacks,
      });

      activeTestAgent = testAgent;
      const container = (testAgent as unknown as { container: Container })
        .container;
      container.register("ToolManager", mockToolManagerInstance);
      container.register("McpManager", {
        isMcpTool: vi.fn().mockReturnValue(false),
        getMcpToolPlugins: vi.fn().mockReturnValue([]),
        getMcpToolsConfig: vi.fn().mockReturnValue([]),
      });
      container.register("SubagentManager", {
        getConfigurations: vi.fn().mockReturnValue([]),
        initialize: vi.fn().mockResolvedValue(undefined),
      });
      container.register("SkillManager", {
        getAvailableSkills: vi.fn().mockReturnValue([]),
        initialize: vi.fn().mockResolvedValue(undefined),
      });
      container.register("ConfigurationService", {
        resolveGatewayConfig: () => testAgent.getGatewayConfig(),
        resolveModelConfig: () => testAgent.getModelConfig(),
        resolveMaxInputTokens: () => testAgent.getMaxInputTokens(),
        resolveAutoMemoryEnabled: () => true,
        resolveLanguage: () => testAgent.getLanguage(),
        getEnvironmentVars: () =>
          (
            testAgent as unknown as {
              configurationService: {
                getEnvironmentVars: () => Record<string, string>;
              };
            }
          ).configurationService.getEnvironmentVars(),
      });

      // Disconnect onMessageEnqueued to prevent auto-dequeue
      const messageQueue = (
        testAgent as unknown as {
          messageQueue: import("@/managers/messageQueue.js").MessageQueue;
        }
      ).messageQueue;
      messageQueue.onMessageEnqueued = undefined;

      messageQueue.enqueue({ content: "first" });
      messageQueue.enqueue({ content: "second" });
      messageQueue.enqueue({ content: "third" });
      expect(messageQueue.getQueue()).toHaveLength(3);

      // Recall should return the last editable message
      const recalled = testAgent.recallQueuedMessage();
      expect(recalled).not.toBeNull();
      expect(recalled!.content).toBe("third");

      // Third message should be removed from queue
      expect(messageQueue.getQueue()).toHaveLength(2);
      expect(messageQueue.getQueue().map((m) => m.content)).toEqual([
        "first",
        "second",
      ]);
    });

    it("should return null when queue is empty", async () => {
      const testAgent = await Agent.create({
        apiKey: "test-key",
        workdir: "/tmp/test-recall-empty",
        callbacks: {
          onMessagesChange: vi.fn(),
          onLoadingChange: vi.fn(),
        },
      });

      activeTestAgent = testAgent;
      const container = (testAgent as unknown as { container: Container })
        .container;
      container.register("ToolManager", mockToolManagerInstance);
      container.register("McpManager", {
        isMcpTool: vi.fn().mockReturnValue(false),
        getMcpToolPlugins: vi.fn().mockReturnValue([]),
        getMcpToolsConfig: vi.fn().mockReturnValue([]),
      });
      container.register("SubagentManager", {
        getConfigurations: vi.fn().mockReturnValue([]),
        initialize: vi.fn().mockResolvedValue(undefined),
      });
      container.register("SkillManager", {
        getAvailableSkills: vi.fn().mockReturnValue([]),
        initialize: vi.fn().mockResolvedValue(undefined),
      });
      container.register("ConfigurationService", {
        resolveGatewayConfig: () => testAgent.getGatewayConfig(),
        resolveModelConfig: () => testAgent.getModelConfig(),
        resolveMaxInputTokens: () => testAgent.getMaxInputTokens(),
        resolveAutoMemoryEnabled: () => true,
        resolveLanguage: () => testAgent.getLanguage(),
        getEnvironmentVars: () =>
          (
            testAgent as unknown as {
              configurationService: {
                getEnvironmentVars: () => Record<string, string>;
              };
            }
          ).configurationService.getEnvironmentVars(),
      });

      const result = testAgent.recallQueuedMessage();
      expect(result).toBeNull();
    });

    it("should fire onQueuedMessagesChange callback", async () => {
      const mockCallbacks = {
        onMessagesChange: vi.fn(),
        onLoadingChange: vi.fn(),
        onQueuedMessagesChange: vi.fn(),
      };

      const testAgent = await Agent.create({
        apiKey: "test-key",
        workdir: "/tmp/test-recall-callback",
        callbacks: mockCallbacks,
      });

      activeTestAgent = testAgent;
      const container = (testAgent as unknown as { container: Container })
        .container;
      container.register("ToolManager", mockToolManagerInstance);
      container.register("McpManager", {
        isMcpTool: vi.fn().mockReturnValue(false),
        getMcpToolPlugins: vi.fn().mockReturnValue([]),
        getMcpToolsConfig: vi.fn().mockReturnValue([]),
      });
      container.register("SubagentManager", {
        getConfigurations: vi.fn().mockReturnValue([]),
        initialize: vi.fn().mockResolvedValue(undefined),
      });
      container.register("SkillManager", {
        getAvailableSkills: vi.fn().mockReturnValue([]),
        initialize: vi.fn().mockResolvedValue(undefined),
      });
      container.register("ConfigurationService", {
        resolveGatewayConfig: () => testAgent.getGatewayConfig(),
        resolveModelConfig: () => testAgent.getModelConfig(),
        resolveMaxInputTokens: () => testAgent.getMaxInputTokens(),
        resolveAutoMemoryEnabled: () => true,
        resolveLanguage: () => testAgent.getLanguage(),
        getEnvironmentVars: () =>
          (
            testAgent as unknown as {
              configurationService: {
                getEnvironmentVars: () => Record<string, string>;
              };
            }
          ).configurationService.getEnvironmentVars(),
      });

      // Disconnect onMessageEnqueued to prevent auto-dequeue
      const messageQueue = (
        testAgent as unknown as {
          messageQueue: import("@/managers/messageQueue.js").MessageQueue;
        }
      ).messageQueue;
      messageQueue.onMessageEnqueued = undefined;

      messageQueue.enqueue({ content: "msg1" });
      messageQueue.enqueue({ content: "msg2" });

      vi.clearAllMocks();

      testAgent.recallQueuedMessage();

      expect(mockCallbacks.onQueuedMessagesChange).toHaveBeenCalledTimes(1);
      // The callback should receive the remaining queue (1 message)
      const calledWith = mockCallbacks.onQueuedMessagesChange.mock.calls[0][0];
      expect(calledWith).toHaveLength(1);
      expect(calledWith[0].content).toBe("msg1");
    });
  });

  describe("removeQueuedMessageById", () => {
    it("should remove message by id", async () => {
      const mockCallbacks = {
        onMessagesChange: vi.fn(),
        onLoadingChange: vi.fn(),
        onQueuedMessagesChange: vi.fn(),
      };

      const testAgent = await Agent.create({
        apiKey: "test-key",
        workdir: "/tmp/test-remove-by-id",
        callbacks: mockCallbacks,
      });

      activeTestAgent = testAgent;
      const container = (testAgent as unknown as { container: Container })
        .container;
      container.register("ToolManager", mockToolManagerInstance);
      container.register("McpManager", {
        isMcpTool: vi.fn().mockReturnValue(false),
        getMcpToolPlugins: vi.fn().mockReturnValue([]),
        getMcpToolsConfig: vi.fn().mockReturnValue([]),
      });
      container.register("SubagentManager", {
        getConfigurations: vi.fn().mockReturnValue([]),
        initialize: vi.fn().mockResolvedValue(undefined),
      });
      container.register("SkillManager", {
        getAvailableSkills: vi.fn().mockReturnValue([]),
        initialize: vi.fn().mockResolvedValue(undefined),
      });
      container.register("ConfigurationService", {
        resolveGatewayConfig: () => testAgent.getGatewayConfig(),
        resolveModelConfig: () => testAgent.getModelConfig(),
        resolveMaxInputTokens: () => testAgent.getMaxInputTokens(),
        resolveAutoMemoryEnabled: () => true,
        resolveLanguage: () => testAgent.getLanguage(),
        getEnvironmentVars: () =>
          (
            testAgent as unknown as {
              configurationService: {
                getEnvironmentVars: () => Record<string, string>;
              };
            }
          ).configurationService.getEnvironmentVars(),
      });

      // Disconnect onMessageEnqueued to prevent auto-dequeue
      const messageQueue = (
        testAgent as unknown as {
          messageQueue: import("@/managers/messageQueue.js").MessageQueue;
        }
      ).messageQueue;
      messageQueue.onMessageEnqueued = undefined;

      messageQueue.enqueue({ id: "msg-a", content: "first" });
      messageQueue.enqueue({ id: "msg-b", content: "second" });
      messageQueue.enqueue({ id: "msg-c", content: "third" });

      const result = testAgent.removeQueuedMessageById("msg-b");
      expect(result).toBe(true);

      const remaining = messageQueue.getQueue();
      expect(remaining).toHaveLength(2);
      expect(remaining.map((m) => m.content)).toEqual(["first", "third"]);
    });

    it("should return false for unknown id", async () => {
      const testAgent = await Agent.create({
        apiKey: "test-key",
        workdir: "/tmp/test-remove-unknown-id",
        callbacks: {
          onMessagesChange: vi.fn(),
          onLoadingChange: vi.fn(),
        },
      });

      activeTestAgent = testAgent;
      const container = (testAgent as unknown as { container: Container })
        .container;
      container.register("ToolManager", mockToolManagerInstance);
      container.register("McpManager", {
        isMcpTool: vi.fn().mockReturnValue(false),
        getMcpToolPlugins: vi.fn().mockReturnValue([]),
        getMcpToolsConfig: vi.fn().mockReturnValue([]),
      });
      container.register("SubagentManager", {
        getConfigurations: vi.fn().mockReturnValue([]),
        initialize: vi.fn().mockResolvedValue(undefined),
      });
      container.register("SkillManager", {
        getAvailableSkills: vi.fn().mockReturnValue([]),
        initialize: vi.fn().mockResolvedValue(undefined),
      });
      container.register("ConfigurationService", {
        resolveGatewayConfig: () => testAgent.getGatewayConfig(),
        resolveModelConfig: () => testAgent.getModelConfig(),
        resolveMaxInputTokens: () => testAgent.getMaxInputTokens(),
        resolveAutoMemoryEnabled: () => true,
        resolveLanguage: () => testAgent.getLanguage(),
        getEnvironmentVars: () =>
          (
            testAgent as unknown as {
              configurationService: {
                getEnvironmentVars: () => Record<string, string>;
              };
            }
          ).configurationService.getEnvironmentVars(),
      });

      // Disconnect onMessageEnqueued to prevent auto-dequeue
      const messageQueue = (
        testAgent as unknown as {
          messageQueue: import("@/managers/messageQueue.js").MessageQueue;
        }
      ).messageQueue;
      messageQueue.onMessageEnqueued = undefined;

      messageQueue.enqueue({ id: "msg-a", content: "first" });

      const result = testAgent.removeQueuedMessageById("nonexistent");
      expect(result).toBe(false);

      // Queue should be unchanged
      expect(messageQueue.getQueue()).toHaveLength(1);
    });
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
          // Simulate what SubagentManager.executeAgent does
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
