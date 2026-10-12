import { describe, it, expect, vi } from "vitest";
import { createWorkflowApis } from "../../src/workflow/workflowApis.js";
import { ConcurrencyLimiter } from "../../src/workflow/concurrencyLimiter.js";
import { TurnBudgetLedger } from "../../src/managers/turnBudgetLedger.js";
import {
  WorkflowAgentCapError,
  WorkflowBudgetExceededError,
} from "../../src/workflow/workflowErrors.js";
import { ProgressReporter } from "../../src/workflow/progressReporter.js";
import { Journal } from "../../src/workflow/journal.js";
import type { SubagentManager } from "../../src/managers/subagentManager.js";
import {
  MAX_STRUCTURED_OUTPUT_RETRIES,
  STRUCTURED_OUTPUT_TOOL_NAME,
  createStructuredOutputNudge,
} from "../../src/workflow/structuredOutput.js";
import type {
  Message,
  MessageBlock,
  ToolBlock,
} from "../../src/types/messaging.js";
import * as fs from "fs/promises";
import * as path from "path";
import * as os from "os";

const validSchema = {
  type: "object",
  properties: { answer: { type: "string" } },
  required: ["answer"],
};

let messageSeq = 0;

/** One assistant message of the subagent's own conversation. */
function subagentMessage(blocks: MessageBlock[]): Message {
  messageSeq += 1;
  return {
    id: `msg-${messageSeq}`,
    role: "assistant",
    blocks,
    timestamp: new Date().toISOString(),
    usage: { prompt_tokens: 10, completion_tokens: 40, total_tokens: 50 },
  };
}

/** A finished `StructuredOutput` tool block, as the AIManager records it. */
function structuredOutputBlock(
  parameters: string,
  overrides: Partial<ToolBlock> = {},
): ToolBlock {
  return {
    type: "tool",
    name: STRUCTURED_OUTPUT_TOOL_NAME,
    stage: "end",
    parameters,
    success: true,
    ...overrides,
  };
}

function createMockSubagentManager(
  options: { messages?: () => Message[] } = {},
) {
  const instances: Array<{
    subagentId: string;
    toolManager: { register: ReturnType<typeof vi.fn> };
    permissionManager: { addTemporaryRules: ReturnType<typeof vi.fn> };
    aiManager: {
      toolChoiceOverride: unknown;
      sendAIMessage: ReturnType<typeof vi.fn>;
      abortAIMessage: ReturnType<typeof vi.fn>;
    };
    messageManager: {
      getMessages: ReturnType<typeof vi.fn>;
      addUserMessage: ReturnType<typeof vi.fn>;
      getLatestTotalTokens: ReturnType<typeof vi.fn>;
      getUsages: ReturnType<typeof vi.fn>;
      getTranscriptPath: ReturnType<typeof vi.fn>;
    };
  }> = [];

  let instanceCounter = 0;

  return {
    findSubagent: vi.fn().mockResolvedValue({ id: "general-purpose" }),
    createInstance: vi.fn().mockImplementation(() => {
      const instance = {
        subagentId: `subagent-${instanceCounter++}`,
        toolManager: { register: vi.fn() },
        // `agent({ schema })` reuses the subagent's own conversation for a nudge
        // round (addUserMessage + sendAIMessage) and must NEVER force
        // `tool_choice`, so `toolChoiceOverride` stays untouched.
        aiManager: {
          toolChoiceOverride: undefined as unknown,
          sendAIMessage: vi.fn().mockResolvedValue(undefined),
          abortAIMessage: vi.fn(),
        },
        permissionManager: { addTemporaryRules: vi.fn() },
        messageManager: {
          getMessages: vi
            .fn()
            .mockImplementation(() => options.messages?.() ?? []),
          addUserMessage: vi.fn(),
          getLatestTotalTokens: vi.fn().mockReturnValue(100),
          getUsages: vi.fn().mockReturnValue([{ total_tokens: 100 }]),
          getTranscriptPath: vi
            .fn()
            .mockReturnValue(`/tmp/sessions/subagent-${instanceCounter}.jsonl`),
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

/** The mock behind the `SubagentManager` cast, for assertions. */
function mockOf(subagentManager: SubagentManager) {
  return subagentManager as unknown as ReturnType<
    typeof createMockSubagentManager
  >;
}

function createTestContext(
  overrides?: Record<string, unknown>,
  mockOptions?: { messages?: () => Message[] },
) {
  const subagentManager = createMockSubagentManager(
    mockOptions,
  ) as unknown as SubagentManager;
  const concurrencyLimiter = new ConcurrencyLimiter(4);
  const ledger = new TurnBudgetLedger();
  const progressReporter = new ProgressReporter({
    name: "test",
    description: "test workflow",
  });
  const abortController = new AbortController();

  return {
    ctx: {
      subagentManager,
      concurrencyLimiter,
      ledger,
      progressReporter,
      journal: {
        init: vi.fn(),
        append: vi.fn(),
        appendLog: vi.fn(),
        getCachedResult: vi.fn().mockReturnValue(undefined),
        getCachedToolUses: vi.fn().mockReturnValue(0),
        close: vi.fn(),
        get length() {
          return 0;
        },
      } as unknown as Journal,
      abortSignal: abortController.signal,
      args: {},
      onLog: vi.fn(),
      runDir: "/tmp/sessions/workflows/wf_test123",
      agentControllers: new Map<number, AbortController>(),
      ...overrides,
    },
    abortController,
    subagentManager,
    ledger,
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
      // A real failure is surfaced to the script, never folded into null
      await expect(apis.agent("test prompt")).rejects.toThrow(
        "No subagent type available",
      );
    });

    it("returns null when aborted", async () => {
      const { ctx, abortController } = createTestContext();
      abortController.abort();

      const apis = createWorkflowApis(ctx);
      const result = await apis.agent("test prompt");
      expect(result).toBeNull();
      expect(apis.getStats().skipped).toBe(1);
    });

    it("throws when budget is exceeded", async () => {
      const { ctx, ledger } = createTestContext();
      ledger.beginTurn(100);
      ledger.addOutputTokens(150);

      const apis = createWorkflowApis(ctx);
      // Budget exceeded throws before entering try/catch
      await expect(apis.agent("test prompt")).rejects.toThrow(
        WorkflowBudgetExceededError,
      );
    });

    it("reports the spend and the cap on the budget error", async () => {
      const { ctx, ledger } = createTestContext();
      ledger.beginTurn(100);
      ledger.addOutputTokens(150);

      const apis = createWorkflowApis(ctx);
      const error = await apis.agent("test prompt").catch((e: unknown) => e);
      expect(error).toBeInstanceOf(WorkflowBudgetExceededError);
      expect((error as WorkflowBudgetExceededError).spent).toBe(150);
      expect((error as WorkflowBudgetExceededError).total).toBe(100);
      expect((error as WorkflowBudgetExceededError).message).toContain(
        "In-flight agent() calls will still finish",
      );
    });

    it("lets in-flight agents finish (and keeps their results) once the cap trips", async () => {
      const { ctx, ledger, subagentManager } = createTestContext();
      let release: () => void = () => {};
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      (
        subagentManager as unknown as ReturnType<
          typeof createMockSubagentManager
        >
      ).executeAgent.mockImplementation(async () => {
        await gate;
        return "in-flight result";
      });

      ledger.beginTurn(1_000);
      const apis = createWorkflowApis(ctx);

      const inFlight = apis.agent("slow one");
      await vi.waitFor(() => expect(ctx.agentControllers.size).toBe(1));

      // The turn burns the rest of the budget while that agent is still running
      ledger.addOutputTokens(1_000);
      await expect(apis.agent("new one")).rejects.toThrow(
        WorkflowBudgetExceededError,
      );

      release();
      await expect(inFlight).resolves.toBe("in-flight result");
    });

    it("uses cached result from journal when available", async () => {
      const { ctx } = createTestContext({
        journal: {
          init: vi.fn(),
          append: vi.fn(),
          getCachedResult: vi.fn().mockReturnValue("cached-result"),
          // A resumed agent does not re-run, so its tool calls can only come
          // from the journal — they still belong in the run's `<tool_uses>`.
          getCachedToolUses: vi.fn().mockReturnValue(3),
          close: vi.fn(),
          get length() {
            return 1;
          },
        } as unknown as Journal,
      });

      const apis = createWorkflowApis(ctx);
      const result = await apis.agent("test prompt");
      expect(result).toBe("cached-result");
      expect(apis.getStats().toolUses).toBe(3);
    });

    it("throws on agent execution error", async () => {
      const { ctx, subagentManager } = createTestContext();
      (
        subagentManager as unknown as ReturnType<
          typeof createMockSubagentManager
        >
      ).executeAgent.mockRejectedValue(new Error("execution failed"));

      const apis = createWorkflowApis(ctx);
      await expect(apis.agent("test prompt")).rejects.toThrow(
        "execution failed",
      );
      expect(apis.getStats().failed).toBe(1);
    });

    it("returns null when the agent call was skipped by the user", async () => {
      const { ctx, subagentManager } = createTestContext();
      const apis = createWorkflowApis(ctx);

      // skipAgent aborts the per-agent controller while the run keeps going;
      // executeAgent then fails with an abort error.
      (
        subagentManager as unknown as ReturnType<
          typeof createMockSubagentManager
        >
      ).executeAgent.mockImplementation(async () => {
        for (const controller of ctx.agentControllers.values()) {
          controller.abort();
        }
        throw new Error("aborted");
      });

      await expect(apis.agent("test prompt")).resolves.toBeNull();
      expect(apis.getStats()).toMatchObject({ skipped: 1, failed: 0 });
    });

    it("throws WorkflowAgentCapError on the 1001st call", async () => {
      // Offset the counter like a resume does instead of mocking 1000 agents.
      const { ctx } = createTestContext({ initialAgentCount: 999 });
      const apis = createWorkflowApis(ctx);

      await expect(apis.agent("1st")).resolves.toBe("agent-result");
      expect(apis.getAgentCount()).toBe(1000);

      // The cap is checked before the call: 1000 calls are allowed, the next
      // one throws (Claude Code's `if (count < cap) return`).
      const error = await apis.agent("1001st").catch((e: unknown) => e);
      expect(error).toBeInstanceOf(WorkflowAgentCapError);
      expect((error as WorkflowAgentCapError).name).toBe(
        "WorkflowAgentCapError",
      );
      expect((error as WorkflowAgentCapError).message).toContain(
        "Workflow agent() call cap reached (1000)",
      );
      expect((error as WorkflowAgentCapError).message).toContain(
        "no token budget was set",
      );
    });

    it("appends structured output tool when schema is provided", async () => {
      const { ctx, subagentManager } = createTestContext(undefined, {
        messages: () => [
          subagentMessage([structuredOutputBlock('{"answer":"42"}')]),
        ],
      });

      const apis = createWorkflowApis(ctx);
      await apis.agent("test prompt", { schema: validSchema });

      const instance = mockOf(subagentManager).instances[0];
      expect(instance.toolManager.register).toHaveBeenCalledWith(
        expect.objectContaining({ name: STRUCTURED_OUTPUT_TOOL_NAME }),
      );
    });

    it("never forces tool_choice for a schema call (场景 1)", async () => {
      const { ctx, subagentManager } = createTestContext(undefined, {
        messages: () => [
          subagentMessage([structuredOutputBlock('{"answer":"42"}')]),
        ],
      });

      const apis = createWorkflowApis(ctx);
      await apis.agent("test prompt", { schema: validSchema });

      // The constraint rides on the tool description + prompt convention, never
      // on a forced tool choice (a forced `tool_choice` breaks thinking models).
      const instance = mockOf(subagentManager).instances[0];
      expect(instance.aiManager.toolChoiceOverride).toBeUndefined();
    });

    it("extracts structured result when schema is provided", async () => {
      const { ctx } = createTestContext(undefined, {
        messages: () => [
          subagentMessage([structuredOutputBlock('{"answer":"42"}')]),
        ],
      });

      const apis = createWorkflowApis(ctx);
      const result = await apis.agent("test prompt", { schema: validSchema });
      expect(result).toEqual({ answer: "42" });
    });

    it("ignores the subagent's final text even when it is valid JSON (场景 3)", async () => {
      // The text happens to contain valid JSON, but the subagent never called the
      // tool: scraping it would be exactly the fragile path this feature removes.
      const { ctx, subagentManager } = createTestContext(undefined, {
        messages: () => [
          subagentMessage([
            { type: "text", content: 'The answer is {"answer":"scraped"}' },
          ]),
        ],
      });

      const apis = createWorkflowApis(ctx);
      const error = await apis
        .agent("test prompt", { schema: validSchema })
        .catch((e: unknown) => e);

      expect(error).not.toEqual({ answer: "scraped" });
      expect((error as Error).message).toContain(
        `StructuredOutput retry cap (${MAX_STRUCTURED_OUTPUT_RETRIES}) exceeded`,
      );
      expect(
        mockOf(subagentManager).instances[0].messageManager.addUserMessage,
      ).toHaveBeenCalledTimes(MAX_STRUCTURED_OUTPUT_RETRIES);
    });

    it("nudges the subagent's own conversation when the tool was not called (场景 2)", async () => {
      const { ctx, subagentManager } = createTestContext();
      const apis = createWorkflowApis(ctx);

      await apis
        .agent("test prompt", { schema: validSchema })
        .catch(() => undefined);

      const instance = mockOf(subagentManager).instances[0];
      // 5 retries (the cap) means 5 nudges, each one a meta user message in the
      // subagent's OWN conversation followed by another model turn — never a
      // second executeAgent() (that would re-append the original prompt).
      expect(instance.messageManager.addUserMessage).toHaveBeenCalledTimes(
        MAX_STRUCTURED_OUTPUT_RETRIES,
      );
      for (const call of instance.messageManager.addUserMessage.mock.calls) {
        expect(call[0]).toEqual({
          content: createStructuredOutputNudge(),
          isMeta: true,
        });
      }
      expect(instance.aiManager.sendAIMessage).toHaveBeenCalledTimes(
        MAX_STRUCTURED_OUTPUT_RETRIES,
      );
      expect(mockOf(subagentManager).executeAgent).toHaveBeenCalledTimes(1);
    });

    it("throws with the last validation summary once the retries are spent (场景 3)", async () => {
      const { ctx, subagentManager } = createTestContext(undefined, {
        // Every round produces the same schema-invalid output.
        messages: () => [
          subagentMessage([structuredOutputBlock('{"confidence":0.5}')]),
        ],
      });

      const apis = createWorkflowApis(ctx);
      const error = await apis
        .agent("test prompt", { schema: validSchema })
        .catch((e: unknown) => e);

      expect(error).toBeInstanceOf(Error);
      const message = (error as Error).message;
      expect(message).toContain(
        `agent({schema}): StructuredOutput retry cap (${MAX_STRUCTURED_OUTPUT_RETRIES}) exceeded`,
      );
      expect(message).toContain("last StructuredOutput error:");
      // ...and the summary is the validator's, naming the offending property
      expect(message).toContain("Output does not match required schema");
      expect(message).toContain("answer");
      // Never null: a null would be indistinguishable from a user skip
      expect(
        mockOf(subagentManager).instances[0].messageManager.addUserMessage,
      ).toHaveBeenCalledTimes(MAX_STRUCTURED_OUTPUT_RETRIES);
    });

    it("fails before creating a subagent when the schema is not valid JSON Schema (场景 4)", async () => {
      const { ctx, subagentManager } = createTestContext();
      const apis = createWorkflowApis(ctx);

      const error = await apis
        .agent("test prompt", {
          schema: { type: "object", properties: { n: { type: "nope" } } },
        })
        .catch((e: unknown) => e);

      expect((error as Error).message).toContain(
        "agent({schema}) received an invalid JSON Schema:",
      );
      expect(mockOf(subagentManager).createInstance).not.toHaveBeenCalled();
      expect(mockOf(subagentManager).executeAgent).not.toHaveBeenCalled();
      // No token was spent, and the call counter was not consumed either
      expect(apis.getAgentCount()).toBe(0);
    });

    it("fails before creating a subagent when the schema is unsatisfiable (场景 4)", async () => {
      const { ctx, subagentManager } = createTestContext();
      const apis = createWorkflowApis(ctx);

      const error = await apis
        .agent("test prompt", { schema: { type: "array" } })
        .catch((e: unknown) => e);

      expect((error as Error).message).toContain("unusable JSON Schema");
      expect((error as Error).message).toContain(
        "The subagent was not started",
      );
      expect(mockOf(subagentManager).createInstance).not.toHaveBeenCalled();
      expect(mockOf(subagentManager).executeAgent).not.toHaveBeenCalled();
    });

    it("returns the subagent's final text when no schema is given (场景 5)", async () => {
      const { ctx, subagentManager } = createTestContext();
      const apis = createWorkflowApis(ctx);

      const result = await apis.agent("test prompt");

      expect(result).toBe("agent-result");
      const instance = mockOf(subagentManager).instances[0];
      expect(instance.toolManager.register).not.toHaveBeenCalled();
      expect(instance.messageManager.addUserMessage).not.toHaveBeenCalled();
      expect(instance.aiManager.sendAIMessage).not.toHaveBeenCalled();
      expect(instance.aiManager.toolChoiceOverride).toBeUndefined();
    });

    it("keeps a user skip during a nudge round as null, not a schema error (场景 3/停止运行场景 3)", async () => {
      const { ctx, abortController, subagentManager } = createTestContext();
      // Skipping the agent aborts its controller; the nudge round must stay the
      // null-returning path instead of turning into a structured-output throw.
      mockOf(subagentManager).executeAgent.mockImplementation(async () => {
        for (const controller of ctx.agentControllers.values()) {
          controller.abort();
        }
        return "agent-result";
      });

      const apis = createWorkflowApis(ctx);
      const result = await apis
        .agent("test prompt", { schema: validSchema })
        .catch((e: unknown) => e);

      expect(result).toBeNull();
      expect(abortController.signal.aborted).toBe(false);
      expect(apis.getStats()).toMatchObject({ skipped: 1, failed: 0 });
      expect(
        mockOf(subagentManager).instances[0].messageManager.addUserMessage,
      ).not.toHaveBeenCalled();
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

    it("returns null for rejected thunks and records the failure detail", async () => {
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
      expect(apis.getFailures()).toEqual(["parallel[1] failed: fail"]);
    });

    it("returns [] for an empty array", async () => {
      const { ctx } = createTestContext();
      const apis = createWorkflowApis(ctx);
      await expect(apis.parallel([])).resolves.toEqual([]);
    });

    it("throws when an element is a promise instead of a function", async () => {
      const { ctx } = createTestContext();
      const apis = createWorkflowApis(ctx);

      await expect(
        apis.parallel([apis.agent("eager")] as unknown as Array<
          () => Promise<unknown>
        >),
      ).rejects.toThrow(
        "parallel() expects an array of functions, not promises. Wrap each call: () => agent(...)",
      );
    });

    it("counts budget-exceeded slots separately from failures", async () => {
      const { ctx, ledger } = createTestContext();
      ledger.beginTurn(100);
      ledger.addOutputTokens(150);
      const apis = createWorkflowApis(ctx);

      const results = await apis.parallel([
        async () => apis.agent("blocked by budget"),
        async () => "ok",
      ]);
      expect(results).toEqual([null, "ok"]);
      expect(apis.getFailures()).toEqual([
        "parallel: 1 slot(s) dropped — token budget exceeded",
      ]);
      expect(apis.getFailures().some((f) => f.includes("failed"))).toBe(false);
    });

    it("formats a cross-realm rejection without an `Error: ` prefix", async () => {
      const { ctx } = createTestContext();
      const apis = createWorkflowApis(ctx);

      // Errors thrown inside the sandbox are not host Error instances; the
      // detail must read `boom`, not `Error: boom`.
      const foreign = Object.assign(Object.create(null), {
        name: "Error",
        message: "boom",
      });
      const results = await apis.pipeline([1], async () => {
        throw foreign;
      });

      expect(results).toEqual([null]);
      expect(apis.getFailures()).toEqual(["pipeline[0] failed: boom"]);
    });

    it("counts a cross-realm budget error as a dropped slot, not a failure", async () => {
      const { ctx } = createTestContext();
      const apis = createWorkflowApis(ctx);

      const foreign = Object.assign(Object.create(null), {
        name: "WorkflowBudgetExceededError",
        message: "over budget",
      });
      const results = await apis.parallel([
        async () => {
          throw foreign;
        },
      ]);

      expect(results).toEqual([null]);
      expect(apis.getFailures()).toEqual([
        "parallel: 1 slot(s) dropped — token budget exceeded",
      ]);
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
    it("seeds the first stage with the item itself", async () => {
      const { ctx } = createTestContext();
      const apis = createWorkflowApis(ctx);

      const results = await apis.pipeline(
        [1, 2, 3],
        async (prev, item, index) => {
          // Claude Code pipeline() semantics: the first stage's prevResult is
          // the original item, so a single-stage pipeline that only reads
          // prevResult still sees the item (deep-research relies on this).
          expect(prev).toBe(item);
          return (prev as number) * 10 + index;
        },
      );
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

    it("returns null for items that fail in a stage and records the detail", async () => {
      const { ctx } = createTestContext();
      const apis = createWorkflowApis(ctx);

      const results = await apis.pipeline([1, 2, 3], async (prev, item) => {
        if ((item as number) === 2) throw new Error("fail on 2");
        return (item as number) * 10;
      });
      expect(results).toEqual([10, null, 30]);
      expect(apis.getFailures()).toEqual(["pipeline[1] failed: fail on 2"]);
    });

    it("skips the remaining stages once a stage returns null", async () => {
      const { ctx } = createTestContext();
      const apis = createWorkflowApis(ctx);
      const secondStage = vi.fn(async (prev: unknown) => `second:${prev}`);

      const results = await apis.pipeline(
        [1, 2],
        async (_prev, item) => ((item as number) === 1 ? null : "kept"),
        secondStage,
      );

      expect(results).toEqual([null, "second:kept"]);
      // Item 1 was filtered out by the first stage: the second stage never saw it
      expect(secondStage).toHaveBeenCalledTimes(1);
      expect(secondStage).toHaveBeenCalledWith("kept", 2, 1);
    });

    it("throws when a stage is not a function", async () => {
      const { ctx } = createTestContext();
      const apis = createWorkflowApis(ctx);

      await expect(
        apis.pipeline(
          [1],
          "not-a-function" as unknown as () => Promise<unknown>,
        ),
      ).rejects.toThrow(
        "pipeline() stages must be functions: pipeline(items, item => ..., result => ...)",
      );
    });

    it("counts budget-exceeded items separately from failures", async () => {
      const { ctx, ledger } = createTestContext();
      ledger.beginTurn(100);
      ledger.addOutputTokens(150);
      const apis = createWorkflowApis(ctx);

      const results = await apis.pipeline([1, 2], async () =>
        apis.agent("blocked by budget"),
      );

      expect(results).toEqual([null, null]);
      expect(apis.getFailures()).toEqual([
        "pipeline: 2 slot(s) dropped — token budget exceeded",
      ]);
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

  describe("agent abort controllers", () => {
    it("creates per-agent abort controller and removes it on completion", async () => {
      const { ctx } = createTestContext();
      const apis = createWorkflowApis(ctx);

      expect(ctx.agentControllers.size).toBe(0);
      await apis.agent("test prompt");
      // Controller should be removed after completion
      expect(ctx.agentControllers.size).toBe(0);
    });

    it("creates per-agent abort controller and removes it on failure", async () => {
      const { ctx, subagentManager } = createTestContext();
      (
        subagentManager as unknown as ReturnType<
          typeof createMockSubagentManager
        >
      ).executeAgent.mockRejectedValue(new Error("execution failed"));

      const apis = createWorkflowApis(ctx);
      await expect(apis.agent("test prompt")).rejects.toThrow(
        "execution failed",
      );
      // Controller should be removed even on failure
      expect(ctx.agentControllers.size).toBe(0);
    });

    it("writes agent_failed journal entry on execution failure", async () => {
      const { ctx } = createTestContext();
      (
        ctx as unknown as {
          subagentManager: ReturnType<typeof createMockSubagentManager>;
        }
      ).subagentManager.executeAgent.mockRejectedValue(
        new Error("execution failed"),
      );

      const apis = createWorkflowApis(ctx);
      await expect(apis.agent("test prompt")).rejects.toThrow(
        "execution failed",
      );

      // Verify journal.append was called with agent_failed entry
      const appendCalls = (
        ctx.journal as unknown as { append: ReturnType<typeof vi.fn> }
      ).append.mock.calls;
      const failedEntry = appendCalls.find(
        (call: unknown[]) =>
          Array.isArray(call) &&
          (call[0] as Record<string, unknown>)?.type === "agent_failed",
      );
      expect(failedEntry).toBeDefined();
      expect(failedEntry![0]).toMatchObject({
        type: "agent_failed",
        agentIndex: 0,
        error: "execution failed",
      });
    });
  });

  describe("budget", () => {
    it("exposes total/spent/remaining from the turn ledger", () => {
      const ledger = new TurnBudgetLedger();
      ledger.beginTurn(500_000);
      ledger.addOutputTokens(1_000);
      const { ctx } = createTestContext({ ledger });
      const apis = createWorkflowApis(ctx);

      expect(apis.budget.total).toBe(500_000);
      expect(apis.budget.spent()).toBe(1_000);
      expect(apis.budget.remaining()).toBe(499_000);

      // Live: further spend (from any agent of the turn) keeps moving it
      ledger.addOutputTokens(499_000);
      expect(apis.budget.spent()).toBe(500_000);
      expect(apis.budget.remaining()).toBe(0);
    });

    it("reports total null / remaining Infinity when the user gave no target", () => {
      const { ctx } = createTestContext();
      const apis = createWorkflowApis(ctx);

      expect(apis.budget.total).toBeNull();
      expect(apis.budget.spent()).toBe(0);
      expect(apis.budget.remaining()).toBe(Infinity);
    });

    it("shares one ledger across two workflows of the same turn", () => {
      const ledger = new TurnBudgetLedger();
      ledger.beginTurn(1_000);
      const first = createWorkflowApis(createTestContext({ ledger }).ctx);
      const second = createWorkflowApis(createTestContext({ ledger }).ctx);

      // Spend produced elsewhere in the turn (main loop or another workflow) is
      // visible to both — `spent()` is the turn's, not this run's.
      ledger.addOutputTokens(700);

      expect(first.budget.spent()).toBe(700);
      expect(second.budget.spent()).toBe(700);
      expect(second.budget.remaining()).toBe(300);

      // ...and a spent-up ledger blocks BOTH of them
      ledger.addOutputTokens(500);
      return Promise.all([
        expect(first.agent("blocked")).rejects.toThrow(
          WorkflowBudgetExceededError,
        ),
        expect(second.agent("blocked")).rejects.toThrow(
          WorkflowBudgetExceededError,
        ),
      ]);
    });

    it("does not feed the workflow's own token tally into the ledger", async () => {
      // The ledger is charged by the AIManager's completion_tokens path; a
      // workflow must not add its (prompt-inclusive) tally a second time.
      const { ctx, ledger } = createTestContext();
      ledger.beginTurn(500_000);
      const apis = createWorkflowApis(ctx);

      await apis.agent("test prompt");

      expect(ledger.getTurnSpent()).toBe(0);
      expect(apis.budget.spent()).toBe(0);
    });
  });

  describe("agent metadata sidecar", () => {
    it("writes agent meta sidecar file on completion", async () => {
      const runDir = await fs.mkdtemp(
        path.join(os.tmpdir(), "wave-sidecar-test-"),
      );
      await fs.mkdir(path.join(runDir, "agents"), { recursive: true });

      const { ctx } = createTestContext({ runDir });
      const apis = createWorkflowApis(ctx);
      await apis.agent("test prompt", { label: "my-agent", phase: "analysis" });

      const metaPath = path.join(runDir, "agents", "0.meta.json");
      const content = await fs.readFile(metaPath, "utf-8");
      const meta = JSON.parse(content);
      expect(meta.agentType).toBe("general-purpose");
      expect(meta.subagentId).toBe("subagent-0");
      expect(meta.label).toBe("my-agent");
      expect(meta.phase).toBe("analysis");
      expect(meta.transcriptPath).toContain(".jsonl");

      await fs.rm(runDir, { recursive: true, force: true });
    });
  });

  describe("failures", () => {
    it("records a failure the script decided on, without logging it", async () => {
      const { ctx } = createTestContext();
      const apis = createWorkflowApis(ctx);

      apis.recordFailure("item 7 skipped: no coverage data");

      // `recordFailure` appends to the SAME list pipeline()/parallel() write and
      // getFailures() reads (Claude Code: `(R) => ot(R, { log: false })`).
      expect(apis.getFailures()).toEqual(["item 7 skipped: no coverage data"]);
      expect(ctx.journal.appendLog).not.toHaveBeenCalled();
    });

    it("hands back a copy, so a script cannot mutate the run's list", async () => {
      const { ctx } = createTestContext();
      const apis = createWorkflowApis(ctx);

      apis.recordFailure("boom");
      const read = apis.getFailures();
      read.push("injected by the caller");

      expect(apis.getFailures()).toEqual(["boom"]);
    });

    it("keeps script-recorded and pipeline-recorded failures in one list", async () => {
      const { ctx } = createTestContext();
      const apis = createWorkflowApis(ctx);

      const results = await apis.pipeline(
        [1, 2],
        async (_prev, item: unknown) => {
          if (item === 2) throw new Error("boom");
          return "ok";
        },
      );
      expect(results).toEqual(["ok", null]);
      apis.recordFailure("stage 2 gave up: boom");

      expect(apis.getFailures()).toEqual([
        "pipeline[1] failed: boom",
        "stage 2 gave up: boom",
      ]);
    });
  });

  describe("tool uses", () => {
    it("sums the subagents' finished tool calls into the run's tally", async () => {
      const { ctx } = createTestContext(undefined, {
        // Two completed calls (stage "end") and one still running ("start"):
        // only finished ones count — a start/end pair is ONE call, not two.
        messages: () => [
          subagentMessage([
            {
              type: "tool",
              name: "Read",
              stage: "end",
              parameters: "{}",
              success: true,
            },
            {
              type: "tool",
              name: "Bash",
              stage: "start",
              parameters: "{}",
            },
          ]),
          subagentMessage([
            {
              type: "tool",
              name: "Grep",
              stage: "end",
              parameters: "{}",
              success: true,
            },
          ]),
        ],
      });

      const apis = createWorkflowApis(ctx);
      await apis.agent("test prompt");

      expect(apis.getStats().toolUses).toBe(2);
    });
  });
});
