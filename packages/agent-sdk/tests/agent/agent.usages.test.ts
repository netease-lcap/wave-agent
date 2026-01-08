import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Agent } from "@/agent.js";
import * as aiService from "@/services/aiService.js";
import type { Usage } from "@/types/index.js";
import { DEFAULT_WAVE_MAX_INPUT_TOKENS } from "@/utils/constants.js";

// Mock AI Service
vi.mock("@/services/aiService");

// Mock tool registry
vi.mock("@/managers/toolManager", () => ({
  ToolManager: vi.fn().mockImplementation(() => ({
    execute: vi.fn(),
    list: vi.fn(() => []),
    getToolsConfig: vi.fn(() => []),
  })),
}));

describe("Agent Usage Tracking", () => {
  let agent: Agent;
  let usagesHistory: Usage[];
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(async () => {
    // Save original environment
    originalEnv = process.env;
    // Clear environment variables that might affect model selection
    process.env = { ...originalEnv };
    delete process.env.AIGW_MODEL;
    delete process.env.AIGW_FAST_MODEL;

    // Create mock callbacks that track usage changes
    usagesHistory = [];
    const mockCallbacks = {
      onMessagesChange: vi.fn(),
      onLoadingChange: vi.fn(),
      onUsagesChange: vi.fn((usages: Usage[]) => {
        usagesHistory = [...usages];
      }),
    };

    // Create Agent instance with required parameters
    agent = await Agent.create({
      callbacks: mockCallbacks,
    });

    vi.clearAllMocks();
  });

  afterEach(async () => {
    if (agent) {
      await agent.destroy();
    }
    // Restore original environment
    process.env = originalEnv;
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

  describe("usage tracking through AI calls", () => {
    it("should track usage when AI service returns usage data", async () => {
      const mockCallAgent = vi.mocked(aiService.callAgent);

      const expectedUsage: Usage = {
        prompt_tokens: 100,
        completion_tokens: 50,
        total_tokens: 150,
        model: "claude-sonnet-4-20250514",
        operation_type: "agent",
      };

      mockCallAgent.mockResolvedValue({
        content: "Test response",
        usage: {
          prompt_tokens: expectedUsage.prompt_tokens,
          completion_tokens: expectedUsage.completion_tokens,
          total_tokens: expectedUsage.total_tokens,
        },
      });

      await agent.sendMessage("Test message");

      expect(agent.usages).toHaveLength(1);
      expect(agent.usages[0]).toMatchObject(expectedUsage);
      expect(usagesHistory).toHaveLength(1);
      expect(usagesHistory[0]).toMatchObject(expectedUsage);
    });

    it("should accumulate multiple usage entries from multiple AI calls", async () => {
      const mockCallAgent = vi.mocked(aiService.callAgent);

      const usage1 = {
        prompt_tokens: 100,
        completion_tokens: 50,
        total_tokens: 150,
      };

      const usage2 = {
        prompt_tokens: 200,
        completion_tokens: 100,
        total_tokens: 300,
      };

      mockCallAgent
        .mockResolvedValueOnce({
          content: "First response",
          usage: usage1,
        })
        .mockResolvedValueOnce({
          content: "Second response",
          usage: usage2,
        });

      await agent.sendMessage("First message");
      await agent.sendMessage("Second message");

      expect(agent.usages).toHaveLength(2);
      expect(agent.usages[0]).toMatchObject({
        ...usage1,
        operation_type: "agent",
      });
      expect(agent.usages[1]).toMatchObject({
        ...usage2,
        operation_type: "agent",
      });
      expect(usagesHistory).toHaveLength(2);
    });

    it("should maintain correct order of usage entries", async () => {
      const mockCallAgent = vi.mocked(aiService.callAgent);

      const usageData = [];
      for (let i = 1; i <= 3; i++) {
        usageData.push({
          prompt_tokens: i * 10,
          completion_tokens: i * 5,
          total_tokens: i * 15,
        });
      }

      // Mock multiple calls
      for (let i = 0; i < usageData.length; i++) {
        mockCallAgent.mockResolvedValueOnce({
          content: `Response ${i + 1}`,
          usage: usageData[i],
        });
      }

      // Send multiple messages
      for (let i = 1; i <= 3; i++) {
        await agent.sendMessage(`Message ${i}`);
      }

      expect(agent.usages).toHaveLength(3);
      for (let i = 0; i < 3; i++) {
        expect(agent.usages[i]).toMatchObject({
          ...usageData[i],
          operation_type: "agent",
        });
      }
    });
  });

  describe("integration with usage callbacks", () => {
    it("should trigger onUsageChange callback when usage is tracked", async () => {
      const mockCallAgent = vi.mocked(aiService.callAgent);

      mockCallAgent.mockResolvedValue({
        content: "Test response",
        usage: {
          prompt_tokens: 100,
          completion_tokens: 50,
          total_tokens: 150,
        },
      });

      await agent.sendMessage("Test message");

      // Verify callback was triggered with usage data
      expect(usagesHistory).toHaveLength(1);
      expect(usagesHistory[0]).toMatchObject({
        prompt_tokens: 100,
        completion_tokens: 50,
        total_tokens: 150,
        operation_type: "agent",
      });
    });

    it("should handle multiple usage updates correctly", async () => {
      const mockCallAgent = vi.mocked(aiService.callAgent);

      mockCallAgent
        .mockResolvedValueOnce({
          content: "First response",
          usage: {
            prompt_tokens: 50,
            completion_tokens: 25,
            total_tokens: 75,
          },
        })
        .mockResolvedValueOnce({
          content: "Second response",
          usage: {
            prompt_tokens: 80,
            completion_tokens: 40,
            total_tokens: 120,
          },
        });

      await agent.sendMessage("First message");
      await agent.sendMessage("Second message");

      // Verify accumulated usage data
      expect(usagesHistory).toHaveLength(2);
      expect(usagesHistory[0].total_tokens).toBe(75);
      expect(usagesHistory[1].total_tokens).toBe(120);
    });
  });

  describe("edge cases", () => {
    it("should handle usage with zero tokens", async () => {
      const mockCallAgent = vi.mocked(aiService.callAgent);

      mockCallAgent.mockResolvedValue({
        content: "Empty response",
        usage: {
          prompt_tokens: 0,
          completion_tokens: 0,
          total_tokens: 0,
        },
      });

      await agent.sendMessage("Test message");

      expect(agent.usages).toHaveLength(1);
      expect(agent.usages[0]).toMatchObject({
        prompt_tokens: 0,
        completion_tokens: 0,
        total_tokens: 0,
        operation_type: "agent",
      });
    });

    it("should handle AI calls without usage data", async () => {
      const mockCallAgent = vi.mocked(aiService.callAgent);

      mockCallAgent.mockResolvedValue({
        content: "Response without usage",
        // No usage field
      });

      await agent.sendMessage("Test message");

      // Should not add any usage when no usage data is provided
      expect(agent.usages).toHaveLength(0);
      expect(usagesHistory).toHaveLength(0);
    });

    it("should track compression usage when it occurs", async () => {
      const mockCallAgent = vi.mocked(aiService.callAgent);
      const mockCompressMessages = vi.mocked(aiService.compressMessages);

      // Set up an agent instance with initial messages to have enough content for compression
      const initialMessages = [
        {
          role: "user" as const,
          blocks: [{ type: "text" as const, content: "Message 1" }],
        },
        {
          role: "assistant" as const,
          blocks: [{ type: "text" as const, content: "Response 1" }],
        },
        {
          role: "user" as const,
          blocks: [{ type: "text" as const, content: "Message 2" }],
        },
        {
          role: "assistant" as const,
          blocks: [{ type: "text" as const, content: "Response 2" }],
        },
        {
          role: "user" as const,
          blocks: [{ type: "text" as const, content: "Message 3" }],
        },
        {
          role: "assistant" as const,
          blocks: [{ type: "text" as const, content: "Response 3" }],
        },
        {
          role: "user" as const,
          blocks: [{ type: "text" as const, content: "Message 4" }],
        },
        {
          role: "assistant" as const,
          blocks: [{ type: "text" as const, content: "Response 4" }],
        },
      ];

      // Create new agent instance with initial messages
      await agent.destroy();
      agent = await Agent.create({
        callbacks: {
          onMessagesChange: vi.fn(),
          onUsagesChange: vi.fn((usages: Usage[]) => {
            usagesHistory = [...usages];
          }),
        },
        messages: initialMessages,
      });

      vi.clearAllMocks();

      // Mock high token usage to trigger compression
      mockCallAgent.mockResolvedValue({
        content: "Response that triggers compression",
        usage: {
          prompt_tokens: DEFAULT_WAVE_MAX_INPUT_TOKENS - 20000,
          completion_tokens: 30000,
          total_tokens: DEFAULT_WAVE_MAX_INPUT_TOKENS + 10000, // Exceeds default token limit
        },
      });

      mockCompressMessages.mockResolvedValue({
        content: "Compressed summary",
        usage: {
          prompt_tokens: 1000,
          completion_tokens: 500,
          total_tokens: 1500,
        },
      });

      await agent.sendMessage("Message that triggers compression");

      // Should track both agent and compression usage
      expect(agent.usages).toHaveLength(2);
      expect(agent.usages[0].operation_type).toBe("agent");
      expect(agent.usages[1].operation_type).toBe("compress");
    });
  });
});
