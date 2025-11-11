import { describe, it, expect, vi, beforeEach, Mock } from "vitest";
import { Agent } from "../../src/agent.js";
import { MessageManager } from "../../src/managers/messageManager.js";
import { AIManager } from "../../src/managers/aiManager.js";
import { ToolManager } from "../../src/managers/toolManager.js";
import { HookManager } from "../../src/hooks/index.js";
import type { Usage } from "../../src/types.js";

// Type definitions for mock objects
type MockMessageManager = Partial<MessageManager>;
type MockAIManager = Partial<AIManager>;
type MockToolManager = Partial<ToolManager> & {
  tools?: Map<string, unknown>;
  mcpManager?: Partial<ToolManager["mcpManager"]>;
};
type MockHookManager = Partial<HookManager> & {
  configuration?: HookManager["configuration"];
  matcher?: Partial<HookManager["matcher"]>;
  executor?: Partial<HookManager["executor"]>;
  workdir?: string;
};
type AIManagerConstructor = Mock;
type AIManagerOptions = {
  callbacks?: {
    onUsageAdded?: (usage: Usage) => void;
  };
};

// Mock all dependencies
vi.mock("../../src/managers/messageManager.js");
vi.mock("../../src/managers/aiManager.js");
vi.mock("../../src/managers/toolManager.js");
vi.mock("../../src/hooks/index.js");

describe("Agent Usage Tracking", () => {
  let agent: Agent;
  let mockMessageManager: MockMessageManager;
  let mockAIManager: MockAIManager;
  let mockToolManager: MockToolManager;
  let mockHookManager: MockHookManager;

  beforeEach(() => {
    // Reset mocks
    vi.clearAllMocks();

    // Create mock instances
    mockMessageManager = {
      addUserMessage: vi.fn(),
      addAssistantMessage: vi.fn(),
      triggerUsageChange: vi.fn(),
      getMessages: vi.fn().mockReturnValue([]),
      clearMessages: vi.fn(),
      getSessionId: vi.fn().mockReturnValue("test-session"),
      getlatestTotalTokens: vi.fn().mockReturnValue(0),
      getUserInputHistory: vi.fn().mockReturnValue([]),
      getTranscriptPath: vi.fn().mockReturnValue("/path/to/transcript"),
      setSessionId: vi.fn(),
      setMessages: vi.fn(),
      saveSession: vi.fn(),
      handleSessionRestoration: vi.fn(),
      setlatestTotalTokens: vi.fn(),
      setUserInputHistory: vi.fn(),
      initializeFromSession: vi.fn(),
      addToInputHistory: vi.fn(),
      clearInputHistory: vi.fn(),
      addCustomCommandMessage: vi.fn(),
      updateToolBlock: vi.fn(),
      addDiffBlock: vi.fn(),
      addErrorBlock: vi.fn(),
      compressMessagesAndUpdateSession: vi.fn(),
      addMemoryBlock: vi.fn(),
      addCommandOutputMessage: vi.fn(),
      updateCommandOutputMessage: vi.fn(),
      completeCommandMessage: vi.fn(),
      addSubagentBlock: vi.fn(),
      updateSubagentBlock: vi.fn(),
    };

    mockAIManager = {
      sendAIMessage: vi.fn(),
      isLoading: false,
      setIsLoading: vi.fn(),
      abortAIMessage: vi.fn(),
      getIsCompressing: vi.fn().mockReturnValue(false),
      setIsCompressing: vi.fn(),
    };

    mockToolManager = {
      register: vi.fn(),
      getToolsConfig: vi.fn().mockReturnValue([]),
      list: vi.fn().mockReturnValue([]),
      initializeBuiltInTools: vi.fn(),
      execute: vi.fn(),
      tools: new Map(),
      mcpManager: {},
    };

    mockHookManager = {
      executeHooks: vi.fn(),
      hasHooks: vi.fn().mockReturnValue(false),
      loadConfiguration: vi.fn(),
      loadConfigurationFromSettings: vi.fn(),
      validateConfiguration: vi
        .fn()
        .mockReturnValue({ valid: true, errors: [] }),
      getConfiguration: vi.fn().mockReturnValue({}),
      configuration: undefined,
      matcher: {},
      executor: {},
      workdir: "/test/workdir",
    };

    // Mock constructors to return our mocks
    (MessageManager as unknown as Mock).mockImplementation(
      () => mockMessageManager as MessageManager,
    );
    (AIManager as unknown as Mock).mockImplementation(
      () => mockAIManager as AIManager,
    );
    (ToolManager as unknown as Mock).mockImplementation(
      () => mockToolManager as unknown as ToolManager,
    );
    (HookManager as unknown as Mock).mockImplementation(
      () => mockHookManager as unknown as HookManager,
    );

    // Create agent instance
    agent = new Agent({
      apiKey: "test-key",
      agentModel: "gpt-4",
      fastModel: "gpt-3.5-turbo",
    });
  });

  describe("usages getter", () => {
    it("should return empty array initially", () => {
      expect(agent.usages).toEqual([]);
      expect(Array.isArray(agent.usages)).toBe(true);
    });

    it("should return a copy of the internal _usages array", () => {
      const usages1 = agent.usages;
      const usages2 = agent.usages;

      // Should get different array instances (copies)
      expect(usages1).not.toBe(usages2);
      expect(usages1).toEqual(usages2);
    });

    it("should not allow external modification of internal state", () => {
      const usagesBefore = agent.usages;
      expect(usagesBefore).toEqual([]);

      // Try to modify the returned array
      usagesBefore.push({
        prompt_tokens: 100,
        completion_tokens: 50,
        total_tokens: 150,
        model: "gpt-4",
        operation_type: "agent",
      });

      // Internal state should remain unchanged
      const usagesAfter = agent.usages;
      expect(usagesAfter).toEqual([]);
    });
  });

  describe("addUsage private method", () => {
    it("should add usage to internal array when called through callback", () => {
      const mockUsage: Usage = {
        prompt_tokens: 100,
        completion_tokens: 50,
        total_tokens: 150,
        model: "gpt-4",
        operation_type: "agent",
      };

      // Simulate the AIManager callback being triggered
      const aiManagerOptions = (AIManager as unknown as AIManagerConstructor)
        .mock.calls[0]?.[0] as AIManagerOptions;
      const onUsageAdded = aiManagerOptions?.callbacks?.onUsageAdded;
      if (onUsageAdded) {
        onUsageAdded(mockUsage);
      }

      expect(agent.usages).toEqual([mockUsage]);
      expect(mockMessageManager.triggerUsageChange).toHaveBeenCalledTimes(1);
    });

    it("should accumulate multiple usage entries", () => {
      const usage1: Usage = {
        prompt_tokens: 100,
        completion_tokens: 50,
        total_tokens: 150,
        model: "gpt-4",
        operation_type: "agent",
      };

      const usage2: Usage = {
        prompt_tokens: 200,
        completion_tokens: 100,
        total_tokens: 300,
        model: "gpt-3.5-turbo",
        operation_type: "compress",
      };

      // Simulate multiple callbacks
      const aiManagerOptions = (AIManager as unknown as AIManagerConstructor)
        .mock.calls[0]?.[0] as AIManagerOptions;
      const onUsageAdded = aiManagerOptions?.callbacks?.onUsageAdded;
      if (onUsageAdded) {
        onUsageAdded(usage1);
        onUsageAdded(usage2);
      }

      expect(agent.usages).toEqual([usage1, usage2]);
      expect(mockMessageManager.triggerUsageChange).toHaveBeenCalledTimes(2);
    });

    it("should maintain correct order of usage entries", () => {
      const usages: Usage[] = [];

      for (let i = 1; i <= 5; i++) {
        usages.push({
          prompt_tokens: i * 10,
          completion_tokens: i * 5,
          total_tokens: i * 15,
          model: i % 2 === 0 ? "gpt-4" : "gpt-3.5-turbo",
          operation_type: i % 2 === 0 ? "agent" : "compress",
        });
      }

      const aiManagerOptions = (AIManager as unknown as AIManagerConstructor)
        .mock.calls[0]?.[0] as AIManagerOptions;
      const onUsageAdded = aiManagerOptions?.callbacks?.onUsageAdded;

      // Add usages in order
      usages.forEach((usage) => {
        if (onUsageAdded) {
          onUsageAdded(usage);
        }
      });

      expect(agent.usages).toEqual(usages);
    });
  });

  describe("integration with MessageManager callbacks", () => {
    it("should trigger MessageManager.triggerUsageChange when usage is added", () => {
      const mockUsage: Usage = {
        prompt_tokens: 100,
        completion_tokens: 50,
        total_tokens: 150,
        model: "gpt-4",
        operation_type: "agent",
      };

      const aiManagerOptions = (AIManager as unknown as AIManagerConstructor)
        .mock.calls[0]?.[0] as AIManagerOptions;
      const onUsageAdded = aiManagerOptions?.callbacks?.onUsageAdded;
      if (onUsageAdded) {
        onUsageAdded(mockUsage);
      }

      expect(mockMessageManager.triggerUsageChange).toHaveBeenCalledTimes(1);
    });

    it("should handle callback system properly", () => {
      // Verify that the Agent constructor passes the correct callback to AIManager
      expect(AIManager).toHaveBeenCalledWith(
        expect.objectContaining({
          callbacks: expect.objectContaining({
            onUsageAdded: expect.any(Function),
          }),
        }),
      );
    });
  });

  describe("edge cases", () => {
    it("should handle usage with zero tokens", () => {
      const zeroUsage: Usage = {
        prompt_tokens: 0,
        completion_tokens: 0,
        total_tokens: 0,
        model: "gpt-4",
        operation_type: "agent",
      };

      const aiManagerOptions = (AIManager as unknown as AIManagerConstructor)
        .mock.calls[0]?.[0] as AIManagerOptions;
      const onUsageAdded = aiManagerOptions?.callbacks?.onUsageAdded;
      if (onUsageAdded) {
        onUsageAdded(zeroUsage);
      }

      expect(agent.usages).toEqual([zeroUsage]);
    });

    it("should handle usage with different operation types", () => {
      const agentUsage: Usage = {
        prompt_tokens: 100,
        completion_tokens: 50,
        total_tokens: 150,
        model: "gpt-4",
        operation_type: "agent",
      };

      const compressUsage: Usage = {
        prompt_tokens: 200,
        completion_tokens: 100,
        total_tokens: 300,
        model: "gpt-3.5-turbo",
        operation_type: "compress",
      };

      const aiManagerOptions = (AIManager as unknown as AIManagerConstructor)
        .mock.calls[0]?.[0] as AIManagerOptions;
      const onUsageAdded = aiManagerOptions?.callbacks?.onUsageAdded;
      if (onUsageAdded) {
        onUsageAdded(agentUsage);
        onUsageAdded(compressUsage);
      }

      expect(agent.usages).toEqual([agentUsage, compressUsage]);
    });

    it("should handle usage with different models", () => {
      const gpt4Usage: Usage = {
        prompt_tokens: 100,
        completion_tokens: 50,
        total_tokens: 150,
        model: "gpt-4",
        operation_type: "agent",
      };

      const gpt35Usage: Usage = {
        prompt_tokens: 200,
        completion_tokens: 100,
        total_tokens: 300,
        model: "gpt-3.5-turbo",
        operation_type: "agent",
      };

      const aiManagerOptions = (AIManager as unknown as AIManagerConstructor)
        .mock.calls[0]?.[0] as AIManagerOptions;
      const onUsageAdded = aiManagerOptions?.callbacks?.onUsageAdded;
      if (onUsageAdded) {
        onUsageAdded(gpt4Usage);
        onUsageAdded(gpt35Usage);
      }

      expect(agent.usages).toEqual([gpt4Usage, gpt35Usage]);
    });
  });
});
