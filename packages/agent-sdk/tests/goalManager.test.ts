import { describe, it, expect, vi, beforeEach } from "vitest";
import { GoalManager } from "../src/managers/goalManager.js";
import { Container } from "../src/utils/container.js";
import type { MessageManager } from "../src/managers/messageManager.js";
import type { AIManager } from "../src/managers/aiManager.js";
import type { Message } from "../src/types/index.js";

vi.mock("../src/utils/globalLogger.js", () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock("../src/services/aiService.js", () => ({
  evaluateGoal: vi.fn(),
}));

function createMockContainer() {
  const container = new Container();
  const mockMessageManager = {
    getLatestTotalTokens: vi.fn(() => 100),
    getMessages: vi.fn(() => []),
    addUsage: vi.fn(),
  } as unknown as MessageManager;
  const mockAIManager = {
    getGatewayConfig: vi.fn(() => ({
      apiKey: "test-key",
      baseURL: "http://localhost:4000",
    })),
    getModelConfig: vi.fn(() => ({
      model: "test-model",
      fastModel: "test-fast-model",
      maxTokens: 4096,
    })),
  } as unknown as AIManager;

  container.register("MessageManager", mockMessageManager);
  container.register("AIManager", mockAIManager);
  return { container, mockMessageManager, mockAIManager };
}

describe("GoalManager", () => {
  let goalManager: GoalManager;
  let container: Container;

  beforeEach(() => {
    const mocks = createMockContainer();
    container = mocks.container;
    goalManager = new GoalManager(container);
  });

  describe("setGoal", () => {
    it("should set a goal", () => {
      goalManager.setGoal("all tests pass");
      expect(goalManager.isGoalActive()).toBe(true);
      expect(goalManager.getGoal()?.condition).toBe("all tests pass");
    });

    it("should reject conditions exceeding 4000 characters", () => {
      expect(() => goalManager.setGoal("x".repeat(4001))).toThrow(
        "exceeds maximum length",
      );
    });

    it("should accept conditions at exactly 4000 characters", () => {
      goalManager.setGoal("x".repeat(4000));
      expect(goalManager.isGoalActive()).toBe(true);
    });

    it("should replace an existing goal", () => {
      goalManager.setGoal("first goal");
      goalManager.setGoal("second goal");
      expect(goalManager.getGoal()?.condition).toBe("second goal");
      expect(goalManager.getGoal()?.turnCount).toBe(0);
    });

    it("should fire onGoalStateChange callback", () => {
      const callback = vi.fn();
      goalManager.setOnGoalStateChange(callback);
      goalManager.setGoal("all tests pass");
      expect(callback).toHaveBeenCalledWith(true, "all tests pass", "0m");
    });
  });

  describe("clearGoal", () => {
    it("should clear an active goal", () => {
      goalManager.setGoal("all tests pass");
      goalManager.clearGoal();
      expect(goalManager.isGoalActive()).toBe(false);
      expect(goalManager.getGoal()).toBeNull();
    });

    it("should be a no-op when no goal is active", () => {
      goalManager.clearGoal(); // Should not throw
    });

    it("should fire onGoalStateChange callback", () => {
      const callback = vi.fn();
      goalManager.setOnGoalStateChange(callback);
      goalManager.setGoal("all tests pass");
      goalManager.clearGoal();
      expect(callback).toHaveBeenCalledWith(false);
    });
  });

  describe("incrementTurnCount", () => {
    it("should increment the turn count", () => {
      goalManager.setGoal("all tests pass");
      goalManager.incrementTurnCount();
      goalManager.incrementTurnCount();
      expect(goalManager.getGoal()?.turnCount).toBe(2);
    });

    it("should be a no-op when no goal is active", () => {
      goalManager.incrementTurnCount(); // Should not throw
    });
  });

  describe("checkCircuitBreakers", () => {
    it("should return null when goal is within limits", () => {
      goalManager.setGoal("all tests pass");
      expect(goalManager.checkCircuitBreakers()).toBeNull();
    });

    it("should return null when no goal is active", () => {
      expect(goalManager.checkCircuitBreakers()).toBeNull();
    });

    it("should fire circuit breaker at max turns (50)", () => {
      goalManager.setGoal("all tests pass");
      for (let i = 0; i < 50; i++) {
        goalManager.incrementTurnCount();
      }
      const result = goalManager.checkCircuitBreakers();
      expect(result).toContain("maximum turns");
    });

    it("should fire circuit breaker at max duration (30 min)", () => {
      goalManager.setGoal("all tests pass");
      // Manually set startedAt to 31 minutes ago
      const state = goalManager.getGoal()!;
      state.startedAt = Date.now() - 31 * 60 * 1000;
      const result = goalManager.checkCircuitBreakers();
      expect(result).toContain("time limit");
    });
  });

  describe("getStatusString", () => {
    it("should return no active goal when no goal is set", () => {
      expect(goalManager.getStatusString()).toBe("No active goal");
    });

    it("should include goal condition and turn count", () => {
      goalManager.setGoal("all tests pass");
      goalManager.incrementTurnCount();
      const status = goalManager.getStatusString();
      expect(status).toContain("all tests pass");
      expect(status).toContain("Turns: 1");
    });

    it("should include last reason when available", () => {
      goalManager.setGoal("all tests pass");
      goalManager.getGoal()!.lastReason = "Tests still failing";
      const status = goalManager.getStatusString();
      expect(status).toContain("Tests still failing");
    });
  });

  describe("condenseTranscript", () => {
    it("should produce condensed text from messages", () => {
      goalManager.setGoal("all tests pass");

      const messages: Message[] = [
        {
          id: "1",
          role: "user",
          blocks: [{ type: "text", content: "/goal all tests pass" }],
          timestamp: new Date().toISOString(),
        },
        {
          id: "2",
          role: "assistant",
          blocks: [
            { type: "text", content: "I'll work on making tests pass." },
          ],
          timestamp: new Date().toISOString(),
        },
        {
          id: "3",
          role: "user",
          blocks: [{ type: "text", content: "continue" }],
          timestamp: new Date().toISOString(),
        },
      ];

      const result = goalManager.condenseTranscript(messages);
      expect(result).toContain("/goal all tests pass");
      expect(result).toContain("I'll work on making tests pass.");
    });

    it("should truncate tool results longer than 500 chars", () => {
      goalManager.setGoal("all tests pass");

      const messages: Message[] = [
        {
          id: "1",
          role: "assistant",
          blocks: [
            {
              type: "tool",
              name: "bash",
              result: "x".repeat(600),
              stage: "end" as const,
            },
          ],
          timestamp: new Date().toISOString(),
        },
      ];

      const result = goalManager.condenseTranscript(messages);
      expect(result).toContain("[Tool: bash]");
      // Should be truncated
      expect(result.length).toBeLessThan(700);
    });

    it("should cap transcript at max length", () => {
      goalManager.setGoal("all tests pass");

      // Create a very long transcript
      const messages: Message[] = [];
      for (let i = 0; i < 100; i++) {
        messages.push({
          id: `msg-${i}`,
          role: i % 2 === 0 ? "user" : "assistant",
          blocks: [{ type: "text", content: "x".repeat(1000) }],
          timestamp: new Date().toISOString(),
        });
      }

      const result = goalManager.condenseTranscript(messages);
      expect(result.length).toBeLessThanOrEqual(32000);
    });
  });

  describe("evaluateGoal", () => {
    it("should return not met when no goal is active", async () => {
      const result = await goalManager.evaluateGoal();
      expect(result.isMet).toBe(false);
      expect(result.reason).toBe("No active goal");
    });

    it("should call the AI service and parse response", async () => {
      const { evaluateGoal: mockEvaluateGoal } = await import(
        "../src/services/aiService.js"
      );
      vi.mocked(mockEvaluateGoal).mockResolvedValueOnce({
        content: '{"met": true, "reason": "All tests passing"}',
        usage: {
          prompt_tokens: 100,
          completion_tokens: 20,
          total_tokens: 120,
        },
      });

      goalManager.setGoal("all tests pass");
      const result = await goalManager.evaluateGoal();
      expect(result.isMet).toBe(true);
      expect(result.reason).toBe("All tests passing");
    });

    it("should handle evaluation failures gracefully", async () => {
      const { evaluateGoal: mockEvaluateGoal } = await import(
        "../src/services/aiService.js"
      );
      vi.mocked(mockEvaluateGoal).mockRejectedValueOnce(new Error("API error"));

      goalManager.setGoal("all tests pass");
      const result = await goalManager.evaluateGoal();
      expect(result.isMet).toBe(false);
      expect(result.reason).toContain("Evaluation failed");
      expect(goalManager.getGoal()?.consecutiveEvalFailures).toBe(1);
    });

    it("should reset consecutiveEvalFailures on success", async () => {
      const { evaluateGoal: mockEvaluateGoal } = await import(
        "../src/services/aiService.js"
      );
      vi.mocked(mockEvaluateGoal).mockRejectedValueOnce(new Error("API error"));
      vi.mocked(mockEvaluateGoal).mockResolvedValueOnce({
        content: '{"met": false, "reason": "Still working"}',
      });

      goalManager.setGoal("all tests pass");
      await goalManager.evaluateGoal(); // Failure
      expect(goalManager.getGoal()?.consecutiveEvalFailures).toBe(1);

      await goalManager.evaluateGoal(); // Success
      expect(goalManager.getGoal()?.consecutiveEvalFailures).toBe(0);
    });

    it("should parse malformed JSON responses", async () => {
      const { evaluateGoal: mockEvaluateGoal } = await import(
        "../src/services/aiService.js"
      );
      vi.mocked(mockEvaluateGoal).mockResolvedValueOnce({
        content: 'Here is my evaluation: {"met": false, "reason": "Not done"}',
      });

      goalManager.setGoal("all tests pass");
      const result = await goalManager.evaluateGoal();
      expect(result.isMet).toBe(false);
      expect(result.reason).toBe("Not done");
    });

    it("should fallback to regex when JSON parse fails but contains met field", async () => {
      const { evaluateGoal: mockEvaluateGoal } = await import(
        "../src/services/aiService.js"
      );
      vi.mocked(mockEvaluateGoal).mockResolvedValueOnce({
        content: 'The answer is "met": true, "reason": "All done"',
      });

      goalManager.setGoal("all tests pass");
      const result = await goalManager.evaluateGoal();
      expect(result.isMet).toBe(true);
      expect(result.reason).toBe("All done");
    });

    it("should return default fallback when response is unparseable", async () => {
      const { evaluateGoal: mockEvaluateGoal } = await import(
        "../src/services/aiService.js"
      );
      vi.mocked(mockEvaluateGoal).mockResolvedValueOnce({
        content: "I cannot determine the answer right now.",
      });

      goalManager.setGoal("all tests pass");
      const result = await goalManager.evaluateGoal();
      expect(result.isMet).toBe(false);
      expect(result.reason).toBe("Could not parse evaluation response");
    });

    it("should return not met when no model is configured", async () => {
      const mockContainer = new Container();
      mockContainer.register("MessageManager", {
        getLatestTotalTokens: vi.fn(() => 0),
        getMessages: vi.fn(() => []),
        addUsage: vi.fn(),
      } as unknown as MessageManager);
      mockContainer.register("AIManager", {
        getGatewayConfig: vi.fn(() => ({
          apiKey: "key",
          baseURL: "http://localhost",
        })),
        getModelConfig: vi.fn(() => ({
          model: undefined,
          fastModel: undefined,
        })),
      } as unknown as AIManager);

      const gm = new GoalManager(mockContainer);
      gm.setGoal("all tests pass");
      const result = await gm.evaluateGoal();
      expect(result.isMet).toBe(false);
      expect(result.reason).toContain("No model configured");
    });

    it("should track evaluation usage with goal_evaluation operation type", async () => {
      const { evaluateGoal: mockEvaluateGoal } = await import(
        "../src/services/aiService.js"
      );
      const mockContainer = new Container();
      const addUsage = vi.fn();
      mockContainer.register("MessageManager", {
        getLatestTotalTokens: vi.fn(() => 0),
        getMessages: vi.fn(() => []),
        addUsage,
      } as unknown as MessageManager);
      mockContainer.register("AIManager", {
        getGatewayConfig: vi.fn(() => ({
          apiKey: "key",
          baseURL: "http://localhost",
        })),
        getModelConfig: vi.fn(() => ({
          model: "test-model",
          fastModel: "fast-model",
        })),
      } as unknown as AIManager);

      vi.mocked(mockEvaluateGoal).mockResolvedValueOnce({
        content: '{"met": true, "reason": "Done"}',
        usage: { prompt_tokens: 50, completion_tokens: 10, total_tokens: 60 },
      });

      const gm = new GoalManager(mockContainer);
      gm.setGoal("all tests pass");
      await gm.evaluateGoal();
      expect(addUsage).toHaveBeenCalledWith(
        expect.objectContaining({
          operation_type: "goal_evaluation",
          model: "fast-model",
        }),
      );
    });
  });

  describe("condenseTranscript - additional coverage", () => {
    it("should include goal-setting message when it falls outside the recent window", () => {
      goalManager.setGoal("all tests pass");

      const messages: Message[] = [];
      // Goal-setting message at index 0 (far outside window)
      messages.push({
        id: "0",
        role: "user",
        blocks: [{ type: "text", content: "/goal all tests pass" }],
        timestamp: new Date().toISOString(),
      });
      // Fill with enough messages to push goal outside window
      for (let i = 1; i <= 25; i++) {
        messages.push({
          id: `msg-${i}`,
          role: i % 2 === 0 ? "user" : "assistant",
          blocks: [{ type: "text", content: `Message ${i}` }],
          timestamp: new Date().toISOString(),
        });
      }

      const result = goalManager.condenseTranscript(messages);
      expect(result).toContain("/goal all tests pass");
    });

    it("should serialize bang blocks", () => {
      goalManager.setGoal("all tests pass");

      const messages: Message[] = [
        {
          id: "1",
          role: "assistant",
          blocks: [
            {
              type: "bang",
              command: "npm test",
              output: "2 tests passed",
              stage: "end" as const,
              exitCode: 0,
            },
          ],
          timestamp: new Date().toISOString(),
        },
      ];

      const result = goalManager.condenseTranscript(messages);
      expect(result).toContain("[Command: npm test]");
      expect(result).toContain("2 tests passed");
    });

    it("should serialize error blocks", () => {
      goalManager.setGoal("all tests pass");

      const messages: Message[] = [
        {
          id: "1",
          role: "assistant",
          blocks: [{ type: "error", content: "Something went wrong" }],
          timestamp: new Date().toISOString(),
        },
      ];

      const result = goalManager.condenseTranscript(messages);
      expect(result).toContain("[Error: Something went wrong]");
    });

    it("should serialize tool blocks without name", () => {
      goalManager.setGoal("all tests pass");

      const messages: Message[] = [
        {
          id: "1",
          role: "assistant",
          blocks: [
            {
              type: "tool",
              result: "short result",
              stage: "end" as const,
            },
          ],
          timestamp: new Date().toISOString(),
        },
      ];

      const result = goalManager.condenseTranscript(messages);
      expect(result).toContain("short result");
    });

    it("should handle messages with empty serialization", () => {
      goalManager.setGoal("all tests pass");

      const messages: Message[] = [
        {
          id: "1",
          role: "user",
          blocks: [{ type: "image", imageUrls: ["test.png"] }],
          timestamp: new Date().toISOString(),
        },
      ];

      const result = goalManager.condenseTranscript(messages);
      // Image-only message should produce empty serialization, not added to lines
      expect(result).toBe("");
    });
  });

  describe("formatElapsed", () => {
    it("should show <1m for less than a minute", () => {
      goalManager.setGoal("test");
      const status = goalManager.getStatusString();
      expect(status).toContain("<1m");
    });

    it("should show hours format for long durations", () => {
      goalManager.setGoal("test");
      const state = goalManager.getGoal()!;
      state.startedAt = Date.now() - 90 * 60 * 1000; // 90 minutes ago
      const status = goalManager.getStatusString();
      expect(status).toContain("1h30m");
    });
  });
});
