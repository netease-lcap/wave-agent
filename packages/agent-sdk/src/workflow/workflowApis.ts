import type {
  SubagentInstance,
  SubagentManager,
} from "../managers/subagentManager.js";
import * as fs from "fs";
import * as path from "path";
import { ConcurrencyLimiter } from "./concurrencyLimiter.js";
import type { TurnBudgetLedger } from "../managers/turnBudgetLedger.js";
import { ProgressReporter } from "./progressReporter.js";
import { Journal } from "./journal.js";
import type { BudgetInfo, AgentMeta } from "./types.js";
import {
  WORKFLOW_AGENT_CALL_CAP,
  WorkflowAgentCapError,
  WorkflowBudgetExceededError,
  describeWorkflowError,
  isWorkflowBudgetExceeded,
} from "./workflowErrors.js";
import {
  MAX_STRUCTURED_OUTPUT_RETRIES,
  createStructuredOutputNudge,
  createStructuredOutputPrompt,
  createStructuredOutputTool,
  extractStructuredResult,
  prepareStructuredOutputSchema,
} from "./structuredOutput.js";
import { AGENT_TOOL_NAME, WORKFLOW_TOOL_NAME } from "../constants/tools.js";
import { logger } from "../utils/globalLogger.js";

/**
 * Attempt to parse args if it was passed as a JSON string.
 * LLMs may serialize array/object args as a string (e.g. "[3,8,15,42,7]")
 * which would cause `for...of` to iterate character-by-character.
 */
function parseArgsIfNeeded(args: unknown): unknown {
  if (typeof args === "string") {
    try {
      const parsed = JSON.parse(args);
      // Only accept parsed arrays/objects, not primitives like "42" → 42
      if (typeof parsed === "object" && parsed !== null) {
        return parsed;
      }
    } catch {
      // Not valid JSON — use as-is (string)
    }
  }
  return args;
}

const MAX_ITEMS_PER_CALL = 4096;

interface WorkflowApiContext {
  subagentManager: SubagentManager;
  concurrencyLimiter: ConcurrencyLimiter;
  /**
   * The TURN's output-token ledger, shared with the main agent loop and with
   * every other workflow of the same turn — `budget.spent()` is the turn's
   * spend, not this run's (spec 场景 5).
   */
  ledger: TurnBudgetLedger;
  progressReporter: ProgressReporter;
  journal: Journal;
  abortSignal: AbortSignal;
  args: unknown;
  onLog?: (message: string) => void;
  /** When resuming, offset the agent counter by this many existing entries */
  initialAgentCount?: number;
  /** Per-run directory for writing agent metadata sidecars */
  runDir: string;
  /** Per-agent abort controllers for kill/skip support */
  agentControllers: Map<number, AbortController>;
}

interface AgentOpts {
  label?: string;
  phase?: string;
  schema?: object;
  model?: string;
  isolation?: string;
  agentType?: string;
}

/**
 * Per-outcome `agent()` tallies for the run's completion notification
 * (spec:「停止运行并如实上报失败」场景 4 — completed / failed / skipped / empty).
 */
export interface WorkflowApiStats {
  /** agent() calls that returned a result. */
  completed: number;
  /** agent() calls that threw — surfaced to the script, or recorded as a failure. */
  failed: number;
  /** agent() calls the user skipped (the only null-returning path). */
  skipped: number;
  /** agent() calls that returned an empty result (null/undefined, not a skip). */
  empty: number;
  /**
   * Tool calls made by this run's subagents, summed over all of them — the
   * `<tool_uses>` number of the completion notification. Claude Code reports the
   * same counter in its `<usage>` block, next to the agent counts.
   */
  toolUses: number;
}

export interface WorkflowApis {
  agent: (prompt: string, opts?: AgentOpts) => Promise<unknown>;
  parallel: (thunks: Array<() => Promise<unknown>>) => Promise<unknown[]>;
  pipeline: (
    items: unknown[],
    ...stages: Array<
      (prev: unknown, item: unknown, index: number) => Promise<unknown>
    >
  ) => Promise<unknown[]>;
  phase: (title: string) => void;
  log: (message: string) => void;
  args: unknown;
  budget: BudgetInfo;
  /**
   * Failure details recorded by pipeline()/parallel() for this run, in
   * Claude Code's format (`pipeline[3] failed: …`). Token-budget drops are not
   * listed per slot — they add one aggregate `… slot(s) dropped` entry.
   *
   * Reachable from the script (Claude Code exposes the same key, evidence §3).
   */
  getFailures: () => string[];
  /**
   * Record a failure detail the script itself decided on — the script's own
   * `catch` blocks are the only place that knows why a hand-rolled fan-out gave
   * up. Claude Code's `recordFailure(message)` (`(R) => ot(R, { log: false })`):
   * it appends to the same list `getFailures()` reads and is deliberately NOT
   * logged, so a script that records ten failures does not also emit ten
   * progress lines (evidence §3).
   */
  recordFailure: (message: string) => void;
  /** agent() calls made so far, including cached entries offset by resume. */
  getAgentCount: () => number;
  /** Per-outcome agent() tallies, for the completion notification. */
  getStats: () => WorkflowApiStats;
}

export function createWorkflowApis(ctx: WorkflowApiContext): WorkflowApis {
  let agentCounter = ctx.initialAgentCount ?? 0;
  const failures: string[] = [];
  const stats: WorkflowApiStats = {
    completed: 0,
    failed: 0,
    skipped: 0,
    empty: 0,
    toolUses: 0,
  };

  /** Tally a resolved agent() result: empty results are counted, not hidden. */
  const countAgentResult = (result: unknown): void => {
    if (result === null || result === undefined) {
      stats.empty++;
    } else {
      stats.completed++;
    }
  };

  /**
   * Push one more turn into the subagent's OWN conversation: append the nudge
   * as a meta user message and re-run it (spec 「来自 agent 的结构化输出」场景 2).
   *
   * Deliberately not a second `executeAgent()` call: that would re-append the
   * WHOLE prompt (`internalExecute` does `addUserMessage({content: prompt})`)
   * plus the schema convention, i.e. a duplicated task, where the nudge is the
   * single message Claude Code adds. `isMeta` keeps it out of the transcript
   * views while still sending it to the model (`convertMessagesForAPI` does not
   * filter meta messages).
   */
  const nudgeStructuredOutput = async (
    instance: SubagentInstance,
    signal: AbortSignal,
  ): Promise<void> => {
    if (signal.aborted) {
      throw new Error("Agent was aborted");
    }
    instance.messageManager.addUserMessage({
      content: createStructuredOutputNudge(),
      isMeta: true,
    });
    // `internalExecute` aborts the subagent's in-flight turn through this same
    // listener; the nudge round has to keep that behavior for user skips.
    const onAbort = () => instance.aiManager.abortAIMessage();
    signal.addEventListener("abort", onAbort, { once: true });
    try {
      await instance.aiManager.sendAIMessage();
    } finally {
      signal.removeEventListener("abort", onAbort);
    }
  };

  /**
   * Resolve the structured answer of an `agent({ schema })` call.
   *
   * The constraint is carried by the registered tool, the prompt convention and
   * this nudge — never by `tool_choice` (场景 1). A round that ends without a
   * schema-valid StructuredOutput call gets one more turn after a nudge, up to
   * MAX_STRUCTURED_OUTPUT_RETRIES nudges (场景 2). Once the budget is spent the
   * call THROWS with the last validation summary: returning null would be
   * indistinguishable from a user skip, and scraping JSON out of the final text
   * is exactly the fragile path this feature exists to remove (场景 3).
   */
  const resolveStructuredOutput = async (
    instance: SubagentInstance,
    schema: object,
    signal: AbortSignal,
  ): Promise<unknown> => {
    let retries = 0;
    let failedAttempts = 0;
    let lastError: string | undefined;

    for (;;) {
      const scan = await extractStructuredResult(
        instance.messageManager.getMessages(),
        schema,
      );
      if (scan.value !== undefined) {
        return scan.value;
      }

      lastError = scan.error;
      failedAttempts++;
      if (retries >= MAX_STRUCTURED_OUTPUT_RETRIES) {
        const detail =
          lastError === undefined
            ? ""
            : ` — last StructuredOutput error: ${lastError}`;
        throw new Error(
          `agent({schema}): StructuredOutput retry cap (${MAX_STRUCTURED_OUTPUT_RETRIES}) exceeded — ` +
            `${failedAttempts} failed attempt(s) with no valid output${detail}`,
        );
      }

      retries++;
      await nudgeStructuredOutput(instance, signal);
      // A skip/stop (run abort or user skip) during the nudge round must stay
      // the null-returning path, not turn into a structured-output failure.
      if (signal.aborted) {
        throw new Error("Agent was aborted");
      }
    }
  };

  const agent = async (prompt: string, opts?: AgentOpts): Promise<unknown> => {
    // The cap is checked BEFORE the call, so calls 1..1000 are allowed and the
    // 1001st throws (Claude Code: `if (count < cap) return; throw`).
    if (agentCounter >= WORKFLOW_AGENT_CALL_CAP) {
      throw new WorkflowAgentCapError();
    }

    // Abort (run stop or the user skipping this agent) is the ONLY path that
    // resolves to null: the script sees "no result", never an error (spec
    // 「停止运行并如实上报失败」场景 3).
    if (ctx.abortSignal.aborted) {
      stats.skipped++;
      return null;
    }

    // Hard budget cap: once this turn's spend has reached the target, no new
    // agent() starts. In-flight agents finish and keep their results.
    const exceededTotal = ctx.ledger.exceededTotal();
    if (exceededTotal !== null) {
      throw new WorkflowBudgetExceededError(
        ctx.ledger.getTurnSpent(),
        exceededTotal,
      );
    }

    // Schema pre-flight (spec 「来自 agent 的结构化输出」场景 4): a schema that is
    // not valid JSON Schema — or that admits no satisfying value at all — fails
    // here, before a subagent is created and before any token is spent.
    if (opts?.schema) {
      const prepared = await prepareStructuredOutputSchema(opts.schema);
      if (!prepared.ok) {
        throw new Error(prepared.message);
      }
    }

    const index = agentCounter++;
    // Cache lookups are keyed by call order WITHIN this execution (0, 1, 2, …):
    // a resumed run numbers its agents past the replayed ones (`initialAgentCount`,
    // so `getAgentCount()`/the cap see the real total), while the previous
    // journal's entries sit at positions 0..N-1. Looking the cached result up by
    // the absolute index therefore missed every entry on every resume, and the
    // run silently paid for all of them again (spec「从日志恢复工作流」场景 1/2).
    const cacheIndex = index - (ctx.initialAgentCount ?? 0);

    // Check journal for cached result (resume)
    const cached = ctx.journal.getCachedResult(cacheIndex);
    if (cached !== undefined) {
      logger.debug(`[Workflow] agent(${index}): using cached result`);
      // Replayed agents are part of this run's `agent_count` even though no
      // subagent was started for them: the count has to stay consistent with
      // `agents_done` (which counts the cached result) and with the run's own
      // progress view, or a fully cached resume reports "0 agents, 2 done".
      // Their tokens are NOT re-added — that spend was the previous run's.
      ctx.progressReporter.agentStarted();
      countAgentResult(cached);
      // A cached agent does not run again, so its tool count can only come from
      // the journal — otherwise a resumed run would report 0 tool uses for work
      // it did pay for.
      stats.toolUses += ctx.journal.getCachedToolUses(cacheIndex);
      return cached;
    }

    // Acquire concurrency slot
    await ctx.concurrencyLimiter.acquire();

    // Create per-agent abort controller linked to the run's signal
    const agentController = new AbortController();
    ctx.agentControllers.set(index, agentController);
    // If the run is already aborted, abort this agent immediately
    if (ctx.abortSignal.aborted) {
      agentController.abort();
    }
    // Propagate run abort to agent abort
    const onRunAbort = () => agentController.abort();
    ctx.abortSignal.addEventListener("abort", onRunAbort);

    try {
      // Resolve subagent type
      const subagentType = opts?.agentType || "general-purpose";
      let configuration = await ctx.subagentManager.findSubagent(subagentType);

      if (!configuration) {
        logger.warn(
          `[Workflow] agent(${index}): subagent type "${subagentType}" not found, falling back to general-purpose`,
        );
        configuration =
          await ctx.subagentManager.findSubagent("general-purpose");
        if (!configuration) {
          throw new Error(`No subagent type available for agent call`);
        }
      }

      // Build the effective prompt
      let effectivePrompt = prompt;
      if (opts?.schema) {
        effectivePrompt += createStructuredOutputPrompt(opts.schema);
      }

      // Set phase if specified
      if (opts?.phase) {
        ctx.progressReporter.setPhase(opts.phase);
      }
      ctx.progressReporter.agentStarted();

      // Create subagent instance
      const instance = await ctx.subagentManager.createInstance(configuration, {
        description: opts?.label || `workflow-agent-${index}`,
        prompt: effectivePrompt,
        subagent_type: subagentType,
        model: opts?.model,
      });

      // Capture subagent linkage info
      const subagentId = instance.subagentId;
      const transcriptPath = instance.messageManager.getTranscriptPath();

      // If schema provided, register the StructuredOutput tool on the subagent's
      // tool manager. The model is asked — not forced — to call it: the tool
      // description carries the convention, `tool_choice` stays untouched (a
      // forced tool choice would fail on thinking models), and a round that
      // ignores it gets nudged below (spec 场景 1/2).
      if (opts?.schema) {
        instance.toolManager.register(createStructuredOutputTool(opts.schema));
      }

      // Deny Agent and Workflow tools in workflow subagents
      // (prevent infinite recursion)
      instance.permissionManager.addTemporaryRules([
        `${AGENT_TOOL_NAME}:deny`,
        `${WORKFLOW_TOOL_NAME}:deny`,
      ]);

      // Execute agent
      const result = await ctx.subagentManager.executeAgent(
        instance,
        effectivePrompt,
        agentController.signal,
        false,
      );

      // With `opts.schema` the answer must come back through the
      // StructuredOutput tool (nudging until it does, then throwing); without
      // one the subagent's final text IS the result (场景 5). Declared `const`
      // on purpose: no path may overwrite a schema-validated object with raw
      // text (场景 3).
      const finalResult: unknown = opts?.schema
        ? await resolveStructuredOutput(
            instance,
            opts.schema,
            agentController.signal,
          )
        : result;

      // Token bookkeeping for the PROGRESS view only (the run's own tally, what
      // /workflows shows). Counted after the structured-output rounds so a
      // nudged subagent's extra turns are included. The budget ledger is
      // deliberately not fed here: the turn's ledger counts completion_tokens at
      // the AIManager level, so every agent's spend is already in it — adding
      // total_tokens here would both double-count and charge the prompt side
      // against a budget defined as output tokens.
      const messages = instance.messageManager.getMessages();
      const tokens = messages.reduce((sum, msg) => {
        if (msg.role !== "assistant" || !msg.usage) return sum;
        // Only `total_tokens`: the provider usage shape already counts cache
        // reads/writes inside it (see utils/tokenCalculation.ts and
        // aiManager's onUsageAdded), so adding the cache fields double-counts.
        return sum + (msg.usage.total_tokens || 0);
      }, 0);
      // One `stage: "end"` tool block per completed call, so this is the agent's
      // tool-use count — the run's `<tool_uses>` total is the sum over agents.
      const toolUses = messages.reduce((sum, msg) => {
        if (msg.role !== "assistant") return sum;
        return (
          sum +
          msg.blocks.filter(
            (block) => block.type === "tool" && block.stage === "end",
          ).length
        );
      }, 0);
      stats.toolUses += toolUses;
      ctx.progressReporter.agentCompleted(tokens);

      // Append to journal
      ctx.journal.append({
        agentIndex: index,
        prompt,
        opts: { ...opts } as Record<string, unknown>,
        result: finalResult,
        tokens,
        toolUses,
        subagentId,
        transcriptPath,
      });

      // Write agent metadata sidecar
      try {
        const agentMeta: AgentMeta = {
          agentType: subagentType,
          subagentId,
          transcriptPath,
          label: opts?.label,
          phase: opts?.phase,
        };
        const metaPath = path.join(ctx.runDir, "agents", `${index}.meta.json`);
        await fs.promises.writeFile(
          metaPath,
          JSON.stringify(agentMeta, null, 2),
          "utf-8",
        );
      } catch (metaErr) {
        logger.warn(
          `[Workflow] Failed to write agent meta for ${index}: ${metaErr instanceof Error ? metaErr.message : String(metaErr)}`,
        );
      }

      // Cleanup
      ctx.subagentManager.cleanupInstance(instance.subagentId);

      countAgentResult(finalResult);
      return finalResult;
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      const skip = agentController.signal.aborted || ctx.abortSignal.aborted;

      // Write agent_failed entry to journal for skip/retry tracking
      ctx.journal.append({
        type: "agent_failed",
        agentIndex: index,
        error: errorMsg,
      });

      // Emit progress event for agent failure
      ctx.progressReporter.agentFailed(index);

      // A user skip (skipAgent aborts this agent's controller) and a run-level
      // stop are the ONLY failures that resolve to null: the script sees "no
      // result", never an error, so a stop is not mistaken for a crash (spec
      // 「停止运行并如实上报失败」场景 3).
      if (skip) {
        stats.skipped++;
        logger.info(`[Workflow] agent(${index}) skipped: ${errorMsg}`);
        return null;
      }

      // Everything else is a REAL failure: surface it so the script can catch
      // it (场景 2), and pipeline()/parallel() can turn it into a failure
      // detail instead of silently folding it into null.
      stats.failed++;
      logger.warn(`[Workflow] agent(${index}) failed: ${errorMsg}`);
      throw error;
    } finally {
      ctx.agentControllers.delete(index);
      ctx.abortSignal.removeEventListener("abort", onRunAbort);
      ctx.concurrencyLimiter.release();
    }
  };

  const parallel = async (
    thunks: Array<() => Promise<unknown>>,
  ): Promise<unknown[]> => {
    if (!Array.isArray(thunks)) {
      throw new TypeError("parallel() expects an array of functions");
    }
    if (thunks.length === 0) return [];
    if (thunks.length > MAX_ITEMS_PER_CALL) {
      throw new Error(
        `parallel() accepts at most ${MAX_ITEMS_PER_CALL} items, got ${thunks.length}`,
      );
    }
    // `parallel([agent('x')])` is the classic mistake: the calls run eagerly and
    // the array holds promises, so there is no concurrency to control and no
    // ordering guarantee. Refuse it with Claude Code's verbatim message.
    for (const thunk of thunks) {
      if (typeof thunk !== "function") {
        throw new TypeError(
          "parallel() expects an array of functions, not promises. Wrap each call: () => agent(...)",
        );
      }
    }

    // Note: thunks typically call agent() which acquires its own slot,
    // so parallel does NOT acquire a slot per thunk to avoid deadlock.
    const settled = await Promise.allSettled(thunks.map((thunk) => thunk()));

    let budgetDropped = 0;
    const results = settled.map((outcome, index) => {
      if (outcome.status === "fulfilled") return outcome.value;

      // A slot refused by the token budget is not a failure: it is counted
      // separately (Claude Code) and reported as one aggregate entry below, so
      // a run that merely ran out of budget does not report broken agents.
      if (isWorkflowBudgetExceeded(outcome.reason)) {
        budgetDropped++;
        return null;
      }

      const { message } = describeWorkflowError(outcome.reason);
      logger.warn(`[Workflow] parallel slot ${index} failed: ${message}`);
      failures.push(`parallel[${index}] failed: ${message}`);
      return null;
    });

    if (budgetDropped > 0) {
      failures.push(
        `parallel: ${budgetDropped} slot(s) dropped — token budget exceeded`,
      );
    }

    return results;
  };

  const pipeline = async (
    items: unknown[],
    ...stages: Array<
      (prev: unknown, item: unknown, index: number) => Promise<unknown>
    >
  ): Promise<unknown[]> => {
    if (items.length > MAX_ITEMS_PER_CALL) {
      throw new Error(
        `pipeline() accepts at most ${MAX_ITEMS_PER_CALL} items, got ${items.length}`,
      );
    }
    for (const stage of stages) {
      if (typeof stage !== "function") {
        throw new TypeError(
          "pipeline() stages must be functions: pipeline(items, item => ..., result => ...)",
        );
      }
    }

    // Run each item through all stages, items are independent.
    // Note: agent() inside stages acquires its own concurrency slot,
    // so pipeline does NOT acquire a slot per item to avoid deadlock.
    const settled = await Promise.allSettled(
      items.map(async (item, index) => {
        // Stage signature is (prevResult, originalItem, index) and the first
        // stage is seeded with the item itself, matching Claude Code's
        // pipeline(). Seeding with undefined made the very first stage of a
        // single-stage pipeline (e.g. the built-in deep-research skill) a
        // no-op: the callback received undefined and dropped the item.
        let acc: unknown = item;
        for (const stage of stages) {
          // A null from the previous stage skips the remaining stages for this
          // item (Claude Code: `if (acc.v === null) break`) — a stage that
          // filtered an item out must not be handed to the next stage.
          if (acc === null) break;
          acc = await stage(acc, item, index);
        }
        return acc;
      }),
    );

    let budgetDropped = 0;
    const results = settled.map((outcome, index) => {
      if (outcome.status === "fulfilled") return outcome.value;

      // Budget drops are counted separately: one aggregate entry (below), never
      // a per-item `pipeline[i] failed:` line.
      if (isWorkflowBudgetExceeded(outcome.reason)) {
        budgetDropped++;
        return null;
      }

      const { message } = describeWorkflowError(outcome.reason);
      logger.warn(`[Workflow] pipeline item ${index} failed: ${message}`);
      failures.push(`pipeline[${index}] failed: ${message}`);
      return null;
    });

    if (budgetDropped > 0) {
      failures.push(
        `pipeline: ${budgetDropped} slot(s) dropped — token budget exceeded`,
      );
    }

    return results;
  };

  const phase = (title: string): void => {
    ctx.progressReporter.setPhase(title);
  };

  const log = (message: string): void => {
    ctx.journal.appendLog(message);
    ctx.onLog?.(message);
  };

  return {
    agent,
    parallel,
    pipeline,
    phase,
    log,
    args: parseArgsIfNeeded(ctx.args),
    budget: ctx.ledger.toBudgetInfo(),
    getFailures: () => [...failures],
    recordFailure: (message: string) => {
      // No `logger`/`journal` line on purpose — see the interface comment.
      failures.push(String(message));
    },
    getAgentCount: () => agentCounter,
    getStats: () => ({ ...stats }),
  };
}
