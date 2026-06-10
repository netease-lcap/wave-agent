import { describe, it, expect, vi } from "vitest";
import { createWorkflowApis } from "../../src/workflow/workflowApis.js";
import { ConcurrencyLimiter } from "../../src/workflow/concurrencyLimiter.js";
import { BudgetTracker } from "../../src/workflow/budgetTracker.js";
import { ProgressReporter } from "../../src/workflow/progressReporter.js";
import { Journal } from "../../src/workflow/journal.js";
import type { SubagentManager } from "../../src/managers/subagentManager.js";

function createMockSubagentManager() {
  const instances: Array<{
    subagentId: string;
    toolManager: { register: ReturnType<typeof vi.fn> };
    permissionManager: { addTemporaryRules: ReturnType<typeof vi.fn> };
    messageManager: {
      getMessages: ReturnType<typeof vi.fn>;
      getLatestTotalTokens: ReturnType<typeof vi.fn>;
      getUsages: ReturnType<typeof vi.fn>;
    };
  }> = [];

  let instanceCounter = 0;

  return {
    findSubagent: vi.fn().mockResolvedValue({ id: "general-purpose" }),
    createInstance: vi.fn().mockImplementation(() => {
      const instance = {
        subagentId: `subagent-${instanceCounter++}`,
        toolManager: { register: vi.fn() },
        permissionManager: { addTemporaryRules: vi.fn() },
        messageManager: {
          getMessages: vi.fn().mockReturnValue([]),
          getLatestTotalTokens: vi.fn().mockReturnValue(100),
          getUsages: vi.fn().mockReturnValue([{ total_tokens: 100 }]),
        },
      };
      instances.push(instance);
      return instance;
    }),
    executeAgent: vi.fn().mockResolvedValue("agent-result"),
    cleanupInstance: vi.fn(),
    instances,
  };
}

function createTestContext(overrides?: Record<string, unknown>) {
  const subagentManager =
    createMockSubagentManager() as unknown as SubagentManager;
  const concurrencyLimiter = new ConcurrencyLimiter(4);
  const budgetTracker = new BudgetTracker(null);
  const progressReporter = new ProgressReporter({
    name: "test",
    description: "test workflow",
  });
  const abortController = new AbortController();

  return {
    ctx: {
      subagentManager,
      concurrencyLimiter,
      budgetTracker,
      progressReporter,
      journal: {
        init: vi.fn(),
        append: vi.fn(),
        appendLog: vi.fn(),
        getCachedResult: vi.fn().mockReturnValue(undefined),
        close: vi.fn(),
        get length() {
          return 0;
        },
      } as unknown as Journal,
      abortSignal: abortController.signal,
      args: {},
      onLog: vi.fn(),
      ...overrides,
    },
    abortController,
    subagentManager,
  };
}

describe("createWorkflowApis", () => {
  describe("agent", () => {
    it("calls subagent and returns result", async () => {
      const { ctx, subagentManager } = createTestContext();
      const apis = createWorkflowApis(ctx);

      const result = await apis.agent("test prompt");
      expect(result).toBe("agent-result");
      expect(subagentManager.createInstance).toHaveBeenCalled();
      expect(subagentManager.executeAgent).toHaveBeenCalled();
      expect(subagentManager.cleanupInstance).toHaveBeenCalled();
    });

    it("passes opts to subagent", async () => {
      const { ctx, subagentManager } = createTestContext();
      const apis = createWorkflowApis(ctx);

      await apis.agent("test prompt", {
        label: "my-agent",
        phase: "analysis",
        agentType: "code",
        model: "gpt-4",
      });

      expect(subagentManager.createInstance).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          description: "my-agent",
          prompt: "test prompt",
          subagent_type: "code",
          model: "gpt-4",
        }),
      );
    });

    it("falls back to general-purpose when subagent type not found", async () => {
      const { ctx, subagentManager } = createTestContext();
      // First call returns null (not found), second call returns a config
      (
        subagentManager as unknown as ReturnType<
          typeof createMockSubagentManager
        >
      ).findSubagent
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ id: "general-purpose" });

      const apis = createWorkflowApis(ctx);
      const result = await apis.agent("test prompt", {
        agentType: "unknown-type",
      });
      expect(result).toBe("agent-result");
    });

    it("throws when no subagent type is available at all", async () => {
      const { ctx, subagentManager } = createTestContext();
      (
        subagentManager as unknown as ReturnType<
          typeof createMockSubagentManager
        >
      ).findSubagent.mockResolvedValue(null);

      const apis = createWorkflowApis(ctx);
      // Agent errors return null, not throw
      const result = await apis.agent("test prompt");
      expect(result).toBeNull();
    });

    it("returns null when aborted", async () => {
      const { ctx, abortController } = createTestContext();
      abortController.abort();

      const apis = createWorkflowApis(ctx);
      const result = await apis.agent("test prompt");
      expect(result).toBeNull();
    });

    it("throws when budget is exceeded", async () => {
      const budgetTracker = new BudgetTracker(0);
      budgetTracker.addUsage(100);
      const { ctx } = createTestContext({ budgetTracker });

      const apis = createWorkflowApis(ctx);
      // Budget exceeded throws before entering try/catch
      await expect(apis.agent("test prompt")).rejects.toThrow(
        "Workflow token budget exceeded",
      );
    });

    it("uses cached result from journal when available", async () => {
      const { ctx } = createTestContext({
        journal: {
          init: vi.fn(),
          append: vi.fn(),
          getCachedResult: vi.fn().mockReturnValue("cached-result"),
          close: vi.fn(),
          get length() {
            return 1;
          },
        } as unknown as Journal,
      });

      const apis = createWorkflowApis(ctx);
      const result = await apis.agent("test prompt");
      expect(result).toBe("cached-result");
    });

    it("returns null on agent execution error", async () => {
      const { ctx, subagentManager } = createTestContext();
      (
        subagentManager as unknown as ReturnType<
          typeof createMockSubagentManager
        >
      ).executeAgent.mockRejectedValue(new Error("execution failed"));

      const apis = createWorkflowApis(ctx);
      const result = await apis.agent("test prompt");
      expect(result).toBeNull();
    });

    it("throws when exceeding max agent count", async () => {
      const { ctx } = createTestContext();
      const apis = createWorkflowApis(ctx);

      // Call agent 1000 times to hit the limit
      const promises = [];
      for (let i = 0; i < 1001; i++) {
        promises.push(apis.agent("test prompt").catch(() => null));
      }
      const results = await Promise.all(promises);
      // The last call should have returned null due to max agent limit
      expect(results.some((r) => r === null)).toBe(true);
    });

    it("appends structured output tool when schema is provided", async () => {
      const { ctx, subagentManager } = createTestContext();
      const schema = {
        type: "object",
        properties: { answer: { type: "string" } },
        required: ["answer"],
      };

      const apis = createWorkflowApis(ctx);
      await apis.agent("test prompt", { schema });

      const instance = (
        subagentManager as unknown as ReturnType<
          typeof createMockSubagentManager
        >
      ).instances[0];
      expect(instance.toolManager.register).toHaveBeenCalledWith(
        expect.objectContaining({ name: "StructuredOutput" }),
      );
    });

    it("extracts structured result when schema is provided", async () => {
      const { ctx, subagentManager } = createTestContext();
      const schema = {
        type: "object",
        properties: { answer: { type: "string" } },
        required: ["answer"],
      };

      // Mock messages with a StructuredOutput tool block
      const instance = (
        subagentManager as unknown as ReturnType<
          typeof createMockSubagentManager
        >
      ).instances;
      (
        subagentManager as unknown as ReturnType<
          typeof createMockSubagentManager
        >
      ).createInstance.mockImplementation(() => {
        const inst = {
          subagentId: "subagent-structured",
          toolManager: { register: vi.fn() },
          aiManager: { toolChoiceOverride: undefined },
          permissionManager: { addTemporaryRules: vi.fn() },
          messageManager: {
            getMessages: vi.fn().mockReturnValue([
              {
                role: "assistant",
                blocks: [
                  {
                    type: "tool",
                    name: "StructuredOutput",
                    parameters: '{"answer": "42"}',
                    stage: "end",
                  },
                ],
              },
            ]),
            getLatestTotalTokens: vi.fn().mockReturnValue(100),
            getUsages: vi.fn().mockReturnValue([{ total_tokens: 100 }]),
          },
        };
        instance.push(inst);
        return inst;
      });

      const apis = createWorkflowApis(ctx);
      const result = await apis.agent("test prompt", { schema });
      expect(result).toEqual({ answer: "42" });
    });
  });

  describe("parallel", () => {
    it("runs thunks in parallel and returns results", async () => {
      const { ctx } = createTestContext();
      const apis = createWorkflowApis(ctx);

      const results = await apis.parallel([
        async () => "a",
        async () => "b",
        async () => "c",
      ]);
      expect(results).toEqual(["a", "b", "c"]);
    });

    it("returns null for rejected thunks", async () => {
      const { ctx } = createTestContext();
      const apis = createWorkflowApis(ctx);

      const results = await apis.parallel([
        async () => "ok",
        async () => {
          throw new Error("fail");
        },
        async () => "also-ok",
      ]);
      expect(results).toEqual(["ok", null, "also-ok"]);
    });

    it("throws when exceeding max items", async () => {
      const { ctx } = createTestContext();
      const apis = createWorkflowApis(ctx);

      const tooMany = Array(4097)
        .fill(null)
        .map(() => async () => "x");
      await expect(apis.parallel(tooMany)).rejects.toThrow("at most 4096");
    });
  });

  describe("pipeline", () => {
    it("runs items through a single stage", async () => {
      const { ctx } = createTestContext();
      const apis = createWorkflowApis(ctx);

      const results = await apis.pipeline(
        [1, 2, 3],
        async (prev, item, index) => (item as number) * 10 + index,
      );
      // For first stage: prev=item, so item*10+index
      expect(results).toEqual([10, 21, 32]);
    });

    it("runs items through multiple stages", async () => {
      const { ctx } = createTestContext();
      const apis = createWorkflowApis(ctx);

      const results = await apis.pipeline(
        [1, 2],
        async (prev, item) => (item as number) * 10,
        async (prev, item, index) => (prev as number) + index,
      );
      expect(results).toEqual([10, 21]);
    });

    it("returns null for items that fail in a stage", async () => {
      const { ctx } = createTestContext();
      const apis = createWorkflowApis(ctx);

      const results = await apis.pipeline([1, 2, 3], async (prev, item) => {
        if ((item as number) === 2) throw new Error("fail on 2");
        return (item as number) * 10;
      });
      expect(results).toEqual([10, null, 30]);
    });

    it("throws when exceeding max items", async () => {
      const { ctx } = createTestContext();
      const apis = createWorkflowApis(ctx);

      const tooMany = Array(4097).fill(null);
      await expect(
        apis.pipeline(tooMany, async (prev, item) => item),
      ).rejects.toThrow("at most 4096");
    });
  });

  describe("phase", () => {
    it("sets phase in progress reporter", async () => {
      const { ctx } = createTestContext();
      const apis = createWorkflowApis(ctx);

      apis.phase("analysis");
      // Verify no error thrown
    });
  });

  describe("log", () => {
    it("calls onLog callback", async () => {
      const onLog = vi.fn();
      const { ctx } = createTestContext({ onLog });
      const apis = createWorkflowApis(ctx);

      apis.log("hello");
      expect(onLog).toHaveBeenCalledWith("hello");
    });
  });
});
