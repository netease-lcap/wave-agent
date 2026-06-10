import type { ToolPlugin, ToolResult, ToolContext } from "./types.js";
import { WORKFLOW_TOOL_NAME } from "../constants/tools.js";
import { logger } from "../utils/globalLogger.js";

/**
 * Workflow tool plugin for executing deterministic multi-subagent orchestration scripts.
 *
 * The AI model calls this tool with a JavaScript script that orchestrates
 * multiple subagents via agent(), parallel(), pipeline(), phase(), log() APIs.
 * Workflows run in the background — the tool returns immediately with a run ID,
 * and a <task-notification> arrives when the workflow completes.
 */
export const workflowTool: ToolPlugin = {
  name: WORKFLOW_TOOL_NAME,
  config: {
    type: "function" as const,
    function: {
      name: WORKFLOW_TOOL_NAME,
      description:
        "Execute a workflow script that orchestrates multiple subagents deterministically. Workflows run in the background — this tool returns immediately with a run ID, and a <task-notification> arrives when the workflow completes. Use /workflows to watch live progress.",
      parameters: {
        type: "object",
        properties: {
          script: {
            type: "string",
            description:
              "Inline workflow script (JavaScript). Must start with 'export const meta = {name, description, phases}'. Pass the script inline — do not Write it to a file first. Every Workflow invocation automatically persists its script.",
          },
          scriptPath: {
            type: "string",
            description:
              "Path to a saved workflow script file. Use this to re-run or iterate on a previously saved script. One of 'script' or 'scriptPath' is required.",
          },
          args: {
            description:
              "Arguments passed to the workflow script as the `args` global. Pass arrays/objects as actual JSON values, NOT as a JSON-encoded string.",
          },
          resumeFromRunId: {
            type: "string",
            description:
              "Resume from a previous run's journal. Cached agent results are replayed instantly; the first edited/new call and everything after it runs live.",
          },
        },
      },
    },
  },

  prompt: () =>
    `Execute a workflow script that orchestrates multiple subagents deterministically. Workflows run in the background — this tool returns immediately with a task ID, and a <task-notification> arrives when the workflow completes. Use /workflows to watch live progress.

A workflow structures work across many agents — to be comprehensive (decompose and cover in parallel), to be confident (independent perspectives and adversarial checks before committing), or to take on scale one context can't hold (migrations, audits, broad sweeps). The script is where you encode that structure: what fans out, what verifies, what synthesizes.

ONLY call this tool when the user has explicitly opted into multi-agent orchestration. Workflows can spawn dozens of agents and consume a large amount of tokens; the user must request that scale, not have it inferred. Explicit opt-in means one of:
- The user directly asked you to run a workflow or use multi-agent orchestration in their own words ("use a workflow", "run a workflow", "fan out agents", "orchestrate this with subagents"). The ask must be in the user's words — a task that would merely benefit from a workflow does not count.
- The user invoked a skill or slash command whose instructions tell you to call Workflow.
- The user asked you to run a specific named or saved workflow.

For any other task — even one that would clearly benefit from parallelism — do NOT call this tool. Use the Agent tool for individual subagents, or briefly describe what a multi-agent workflow could do and how much it would roughly cost, and ask the user whether to run it.

When you do call it, the right move is often **hybrid**: scout inline first (list the files, find the channels, scope the diff) to discover the work-list, then call Workflow to pipeline over it.

Common single-phase workflows you can chain across turns:
- **Understand** — parallel readers over relevant subsystems → structured map
- **Design** — judge panel of N independent approaches → scored synthesis
- **Review** — dimensions → find → adversarially verify
- **Research** — multi-modal sweep → deep-read → synthesize
- **Migrate** — discover sites → transform each (worktree isolation) → verify

For larger work, run several in sequence — read each result before deciding the next phase.

Every script must begin with \`export const meta = {...}\`:
  export const meta = {
    name: 'find-flaky-tests',
    description: 'Find flaky tests and propose fixes',
    phases: [
      { title: 'Scan', detail: 'grep test logs for retries' },
      { title: 'Fix', detail: 'one agent per flaky test' },
    ],
  }
  // script body starts here — use agent()/parallel()/pipeline()/phase()/log()

Script body hooks:
- **agent(prompt, opts?)**: Promise<any> — spawn a subagent. Without schema, returns its final text as a string. With schema (a JSON Schema), the subagent is forced to call a StructuredOutput tool and agent() returns the validated object — no parsing needed. Returns null if the user skips the agent mid-run or the subagent dies on a terminal API error (filter with .filter(Boolean)). opts.label overrides the display label. opts.phase assigns this agent to a progress group. opts.model overrides the model for this agent call. opts.agentType uses a custom subagent type instead of the default.
- **pipeline(items, stage1, stage2, ...)**: Promise<any[]> — run each item through all stages independently, NO barrier between stages. Item A can be in stage 3 while item B is still in stage 1. This is the DEFAULT for multi-stage work. Every stage callback receives (prevResult, originalItem, index). In the first stage prevResult is undefined; in later stages it is the return value of the previous stage. A stage that throws drops that item to null. Example single-stage: \`pipeline(files, (prev, file) => agent('Read ' + file))\`. Example two-stage: \`pipeline(files, (prev, file) => agent('Read ' + file), (prev, file) => agent('Summarize: ' + prev))\`.
- **parallel(thunks: Array<() => Promise<any>>)**: Promise<any[]> — run tasks concurrently. This is a BARRIER: awaits all thunks before returning. A thunk that throws resolves to null in the result array. Use ONLY when you genuinely need all results together.
- **log(message: string)**: void — emit a progress message
- **phase(title: string)**: void — start a new phase; subsequent agent() calls are grouped under this title
- **args**: any — the value passed as Workflow's args input, verbatim
- **budget**: {total: number|null, spent(): number, remaining(): number} — the turn's token target

Scripts are plain JavaScript, NOT TypeScript — type annotations fail to parse. The script body runs in an async context — use await directly. Standard JS built-ins (JSON, Math, Array, etc.) are available — EXCEPT Date.now()/Math.random()/argless new Date(), which throw (they would break resume). No filesystem or Node.js API access.

DEFAULT TO pipeline(). Only reach for a barrier (parallel between stages) when you genuinely need ALL prior-stage results together.

Concurrent agent() calls are capped at min(16, cpu cores - 2) per workflow. Total agent count is capped at 1000 per run. A single parallel()/pipeline() call accepts at most 4096 items.

Quality patterns:
- **Adversarial verify**: spawn N independent skeptics per finding, each prompted to REFUTE. Kill if >=majority refute.
- **Judge panel**: generate N independent approaches, score with parallel judges, synthesize from the winner.
- **Loop-until-dry**: keep spawning finders until K consecutive rounds return nothing new.
- **Multi-modal sweep**: parallel agents each searching a different way (by-container, by-content, by-entity).
- **Completeness critic**: a final agent that asks "what's missing?" — findings become next round of work.
- **No silent caps**: if a workflow bounds coverage, log() what was dropped.

## Resume

The tool result includes a runId. To resume after a pause, kill, or script edit, relaunch with Workflow({scriptPath, resumeFromRunId}) — the longest unchanged prefix of agent() calls returns cached results instantly; the first edited/new call and everything after it runs live.

Use this tool for multi-step orchestration where control flow should be deterministic (loops, conditionals, fan-out) rather than model-driven.`,

  execute: async (
    args: Record<string, unknown>,
    context: ToolContext,
  ): Promise<ToolResult> => {
    const workflowManager = context.workflowManager;
    if (!workflowManager) {
      return {
        success: false,
        content: "",
        error: "Workflow manager not available in tool context",
        shortResult: "Workflow execution failed",
      };
    }

    const script = args.script as string | undefined;
    const scriptPath = args.scriptPath as string | undefined;
    const workflowArgs = args.args;
    const resumeFromRunId = args.resumeFromRunId as string | undefined;

    // Resolve script text
    let scriptText: string;
    if (script) {
      scriptText = script;
    } else if (scriptPath) {
      try {
        const fs = await import("fs/promises");
        scriptText = await fs.readFile(scriptPath, "utf-8");
      } catch (error) {
        return {
          success: false,
          content: "",
          error: `Failed to read script file: ${error instanceof Error ? error.message : String(error)}`,
          shortResult: "Workflow script read failed",
        };
      }
    } else {
      return {
        success: false,
        content: "",
        error: "Either 'script' or 'scriptPath' parameter is required",
        shortResult: "Workflow execution failed",
      };
    }

    try {
      // Create run
      const run = await workflowManager.createRun(scriptText, workflowArgs, {
        resumeFromRunId,
      });

      // Start execution in background
      await workflowManager.startRun(run.runId);

      return {
        success: true,
        content: [
          `Workflow started with run ID: ${run.runId}`,
          `Name: ${run.meta.name}`,
          `Description: ${run.meta.description}`,
          run.meta.phases?.length
            ? `Phases: ${run.meta.phases.map((p) => p.title).join(" → ")}`
            : "",
          `The workflow is running in the background. You will be notified automatically when it completes.`,
          `Use /workflows to watch live progress.`,
          `Script saved to: ${run.scriptPath}`,
        ]
          .filter(Boolean)
          .join("\n"),
        shortResult: `Workflow started: ${run.meta.name} (${run.runId})`,
      };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      logger.error(`[Workflow Tool] execution failed: ${msg}`);
      return {
        success: false,
        content: `Workflow failed: ${msg}. Fix the error and try again.`,
        error: `Workflow execution failed: ${msg}`,
        shortResult: "Workflow execution failed",
      };
    }
  },

  formatCompactParams: (params: Record<string, unknown>) => {
    if (params.scriptPath) {
      return `scriptPath: ${params.scriptPath}`;
    }
    const script = params.script as string;
    if (script) {
      // Extract meta.name from the script
      const nameMatch = script.match(/name:\s*['"]([^'"]+)['"]/);
      return nameMatch ? nameMatch[1] : script.slice(0, 50) + "...";
    }
    return "workflow";
  },
};
