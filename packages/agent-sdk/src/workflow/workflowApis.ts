import type { SubagentManager } from "../managers/subagentManager.js";
import { ConcurrencyLimiter } from "./concurrencyLimiter.js";
import { BudgetTracker } from "./budgetTracker.js";
import { ProgressReporter } from "./progressReporter.js";
import { Journal } from "./journal.js";
import type { BudgetInfo } from "./types.js";
import {
  createStructuredOutputPrompt,
  createStructuredOutputTool,
  extractStructuredResult,
} from "./structuredOutput.js";
import { AGENT_TOOL_NAME, WORKFLOW_TOOL_NAME } from "../constants/tools.js";
import { logger } from "../utils/globalLogger.js";

const MAX_TOTAL_AGENTS = 1000;
const MAX_ITEMS_PER_CALL = 4096;

interface WorkflowApiContext {
  subagentManager: SubagentManager;
  concurrencyLimiter: ConcurrencyLimiter;
  budgetTracker: BudgetTracker;
  progressReporter: ProgressReporter;
  journal: Journal;
  abortSignal: AbortSignal;
  args: unknown;
  onLog?: (message: string) => void;
  // For nested workflow support
  executeWorkflowScript?: (script: string, args: unknown) => Promise<unknown>;
}

interface AgentOpts {
  label?: string;
  phase?: string;
  schema?: object;
  model?: string;
  isolation?: string;
  agentType?: string;
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
  workflow: (nameOrRef: unknown, args?: unknown) => Promise<unknown>;
}

export function createWorkflowApis(ctx: WorkflowApiContext): WorkflowApis {
  let agentCounter = 0;

  const agent = async (prompt: string, opts?: AgentOpts): Promise<unknown> => {
    const index = agentCounter++;

    // Check agent limit
    if (index >= MAX_TOTAL_AGENTS) {
      throw new Error(
        `Workflow exceeded maximum agent count of ${MAX_TOTAL_AGENTS}`,
      );
    }

    // Check abort
    if (ctx.abortSignal.aborted) {
      return null;
    }

    // Check budget
    if (ctx.budgetTracker.isExceeded()) {
      throw new Error("Workflow token budget exceeded");
    }

    // Check journal for cached result (resume)
    const cached = ctx.journal.getCachedResult(index);
    if (cached !== undefined) {
      logger.debug(`[Workflow] agent(${index}): using cached result`);
      return cached;
    }

    // Acquire concurrency slot
    await ctx.concurrencyLimiter.acquire();

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

      // If schema provided, register StructuredOutput tool on the subagent's tool manager
      if (opts?.schema) {
        const structuredTool = createStructuredOutputTool(opts.schema);
        instance.toolManager.register(structuredTool);
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
        ctx.abortSignal,
        false,
      );

      // Track token usage — sum from assistant messages' usage field
      // (getUsages() is empty because onUsageAdded targets the parent agent)
      const messages = instance.messageManager.getMessages();
      const tokens = messages.reduce((sum, msg) => {
        if (msg.role !== "assistant" || !msg.usage) return sum;
        const u = msg.usage;
        return (
          sum +
          (u.total_tokens || 0) +
          (u.cache_read_input_tokens || 0) +
          (u.cache_creation_input_tokens || 0)
        );
      }, 0);
      ctx.budgetTracker.addUsage(tokens);
      ctx.progressReporter.agentCompleted(tokens);

      // Extract structured result if schema was provided
      let finalResult: unknown;
      if (opts?.schema) {
        const messages = instance.messageManager.getMessages();
        finalResult = extractStructuredResult(
          messages.map((m) => {
            const textBlock = m.blocks.find(
              (b): b is import("../types/messaging.js").TextBlock =>
                b.type === "text",
            );
            return {
              role: m.role,
              content: textBlock?.content,
              tool_calls: (
                m as unknown as {
                  tool_calls?: Array<{
                    function: { name: string; arguments: string };
                  }>;
                }
              ).tool_calls,
            };
          }),
          opts.schema,
        );
        if (finalResult === null) {
          // Schema enforcement failed — return the raw text
          finalResult = result;
        }
      } else {
        finalResult = result;
      }

      // Append to journal
      ctx.journal.append({
        agentIndex: index,
        prompt,
        opts: { ...opts } as Record<string, unknown>,
        result: finalResult,
        tokens,
      });

      // Cleanup
      ctx.subagentManager.cleanupInstance(instance.subagentId);

      return finalResult;
    } catch (error) {
      // Agent errors are logged but don't crash the workflow
      // Return null so the caller can filter with .filter(Boolean)
      logger.warn(
        `[Workflow] agent(${index}) failed: ${error instanceof Error ? error.message : String(error)}`,
      );
      return null;
    } finally {
      ctx.concurrencyLimiter.release();
    }
  };

  const parallel = async (
    thunks: Array<() => Promise<unknown>>,
  ): Promise<unknown[]> => {
    if (thunks.length > MAX_ITEMS_PER_CALL) {
      throw new Error(
        `parallel() accepts at most ${MAX_ITEMS_PER_CALL} items, got ${thunks.length}`,
      );
    }

    // Note: thunks typically call agent() which acquires its own slot,
    // so parallel does NOT acquire a slot per thunk to avoid deadlock.
    const results = await Promise.allSettled(
      thunks.map(async (thunk) => {
        try {
          return await thunk();
        } catch {
          return null;
        }
      }),
    );

    // Convert rejected promises to null
    return results.map((r) => (r.status === "fulfilled" ? r.value : null));
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

    // Run each item through all stages, items are independent.
    // Note: agent() inside stages acquires its own concurrency slot,
    // so pipeline does NOT acquire a slot per item to avoid deadlock.
    const results = await Promise.allSettled(
      items.map(async (item, index) => {
        try {
          let result: unknown = undefined;
          for (const stage of stages) {
            result = await stage(result, item, index);
          }
          return result;
        } catch (error) {
          logger.warn(
            `[Workflow] pipeline item ${index} failed: ${error instanceof Error ? error.message : String(error)}`,
          );
          return null;
        }
      }),
    );

    return results.map((r) => (r.status === "fulfilled" ? r.value : null));
  };

  const phase = (title: string): void => {
    ctx.progressReporter.setPhase(title);
  };

  const log = (message: string): void => {
    ctx.onLog?.(message);
  };

  const workflow = async (): Promise<unknown> => {
    if (!ctx.executeWorkflowScript) {
      throw new Error("Nested workflows are not supported in this context");
    }
    // The name resolution and script loading will be handled by the workflowManager
    // For now, this is a placeholder that delegates to the manager
    throw new Error("Nested workflow execution is not yet implemented");
  };

  return {
    agent,
    parallel,
    pipeline,
    phase,
    log,
    args: ctx.args,
    budget: ctx.budgetTracker.toBudgetInfo(),
    workflow,
  };
}
