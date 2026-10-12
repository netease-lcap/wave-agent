import * as path from "node:path";
import type {
  ToolPlugin,
  ToolResult,
  ToolContext,
  ToolPromptArgs,
} from "./types.js";
import { WORKFLOW_TOOL_NAME, TASK_STOP_TOOL_NAME } from "../constants/tools.js";
import { parseScript } from "../workflow/scriptRuntime.js";
import { logger } from "../utils/globalLogger.js";
// Single source of truth for the authoring reference: the same string is the body of
// the built-in skill, so the on-demand copy and the inlined fallback cannot drift.
import { WORKFLOW_AUTHORING_REFERENCE } from "../builtin/skills/workflow-authoring.js";

/** Characters that would corrupt a single-line summary (ANSI-adjacent controls, separators, invisibles). */
const SUMMARY_UNSAFE_CHARS =
  /[\p{Cc}\p{Cf}\p{Cs}\p{Default_Ignorable_Code_Point}\u2028\u2029]/gu;

/** Max characters of the script head shown when `meta` cannot be parsed. */
const FALLBACK_SUMMARY_MAX_CHARS = 80;

function sanitizeForSummary(text: string): string {
  return text.replace(SUMMARY_UNSAFE_CHARS, "");
}

/**
 * Summary for a script whose `meta` could not be parsed: its first non-empty
 * line, truncated if needed, plus a hint that more lines follow.
 */
function summarizeUnparsedScript(script: string): string {
  const lines = script.split("\n");
  const head = sanitizeForSummary(lines.find((line) => line.trim()) ?? "");
  if (!head) {
    return "";
  }

  const preview =
    head.length > FALLBACK_SUMMARY_MAX_CHARS
      ? `${head.slice(0, FALLBACK_SUMMARY_MAX_CHARS - 1)}…`
      : head;

  const extraLines = lines.length - 1;
  if (extraLines <= 0) {
    return preview;
  }
  return `${preview} … +${extraLines} line${extraLines === 1 ? "" : "s"}`;
}

/** Name of the built-in skill that carries the complete authoring reference. */
const WORKFLOW_AUTHORING_SKILL_NAME = "workflow-authoring";

/** Opt-in policy, lean tier. Verbatim external contract — do not reword. */
const OPT_IN_POLICY_LEAN = `ONLY call this tool when the user has explicitly opted into multi-agent orchestration — they asked for a workflow, fan-out, or subagent orchestration in their own words, invoked a skill or slash command that says to call it, or named a specific workflow. A task that would merely benefit from parallelism does not count: use Agent for individual subagents, or ask the user whether to run it and what it would roughly cost.`;

/** Opt-in policy, full tier. Verbatim external contract — do not reword. */
const OPT_IN_POLICY_FULL = `ONLY call this tool when the user has explicitly opted into multi-agent orchestration. Workflows can spawn dozens of agents and consume a large amount of tokens; the user must request that scale, not have it inferred. Explicit opt-in means one of:
- The user directly asked you to run a workflow or use multi-agent orchestration in their own words ("use a workflow", "run a workflow", "fan out agents", "orchestrate this with subagents"). The ask must be in the user's words — a task that would merely benefit from a workflow does not count.
- The user invoked a skill or slash command whose instructions tell you to call Workflow.
- The user asked you to run a specific named or saved workflow.

For any other task — even one that would clearly benefit from parallelism — do NOT call this tool. Use the Agent tool for individual subagents, or briefly describe what a multi-agent workflow could do and how much it would roughly cost, and ask the user whether to run it.`;

/**
 * Shape-and-signature essentials of a workflow script. Both tiers send this
 * verbatim: lean mode condenses the surrounding guidance, never the API shape the
 * model has to write the script against.
 */
const WORKFLOW_SCRIPT_ESSENTIALS = `Writing the script — the essentials:
- Every script must begin with \`export const meta = {...}\` — a pure literal, and the script's first statement. \`name\` and \`description\` are required; \`phases\` is optional and every element is \`{ title, detail? }\`:
    export const meta = { name: 'find-flaky-tests', description: 'Find flaky tests and propose fixes', phases: [{ title: 'Scan' }, { title: 'Fix' }] }
- \`agent(prompt, opts?)\` — spawn a subagent. Without \`opts.schema\` it resolves to the subagent's final text, as a string; with \`opts.schema\` (a JSON Schema) it resolves to the validated object. It resolves to \`null\` only when the user skips that agent (drop nulls with \`.filter(Boolean)\`); a terminal failure rejects, so wrap it in try/catch when you want a fallback.
- \`pipeline(items, stage1, stage2, ...)\` — run each item through all stages independently, with no barrier between stages; the default for multi-stage work. Every stage callback receives \`(prevResult, originalItem, index)\` — in the first stage \`prevResult\` is the item itself, in later stages it is the previous stage's return value. A stage that returns \`null\` skips the remaining stages for that item.
- \`parallel(thunks)\` — run tasks concurrently; this one is a BARRIER that awaits all of them. Use it only when you genuinely need all results together; every entry must be a function (\`() => agent(...)\`).
- \`phase(title)\`, \`log(message)\`, the verbatim \`args\`, and \`budget\` — \`{ total, spent(), remaining() }\`: this turn's token target as a hard cap, shared with the main loop and with any other workflow of the turn (\`total\` is \`null\` when the user gave none). Reaching it stops new \`agent()\` calls, while in-flight agents finish and keep their results — so a "loop until the budget runs out" pattern needs its own hard iteration cap.
- \`getFailures()\` — this run's failure lines (\`pipeline[3] failed: …\`); \`recordFailure(message)\` adds one of your own. Call it from a \`catch\` you handle yourself, so the completion report says why the item is missing instead of silently dropping it.

Scripts are plain JavaScript — no type annotations, no filesystem, no network, no \`import\`. The right move is often hybrid: scout inline first (list the files, scope the diff) to discover the work-list, then pipeline over it.`;

/** Pointer to the on-demand copy of the reference. */
const WORKFLOW_AUTHORING_POINTER = `For the complete authoring reference — full hook signatures and \`opts\`, \`meta\` shape, \`args\`/\`budget\` semantics, resume rules, concurrency and scale caps, quality patterns and a runnable example — load the \`${WORKFLOW_AUTHORING_SKILL_NAME}\` skill before writing the script.`;

/**
 * Whether the model can load the authoring reference on demand this turn. A skill
 * that is not registered — or is registered with model invocation disabled — is
 * unreachable for the model, and then the reference has to be inlined instead.
 */
function canLoadAuthoringReference(args?: ToolPromptArgs): boolean {
  return Boolean(
    args?.availableSkills?.some(
      (skill) =>
        skill.name === WORKFLOW_AUTHORING_SKILL_NAME &&
        !skill.disableModelInvocation,
    ),
  );
}

/**
 * Progressive disclosure for the authoring reference: a pointer while the skill is
 * loadable, the full reference inlined when it is not, so the description never
 * degrades into a strictly smaller one.
 */
function authoringReferenceSection(args?: ToolPromptArgs): string {
  return canLoadAuthoringReference(args)
    ? WORKFLOW_AUTHORING_POINTER
    : WORKFLOW_AUTHORING_REFERENCE;
}

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
  searchHint: "run a multi-agent workflow script",
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
              "Run ID of a prior Workflow invocation in THIS session to resume from. Completed agent() calls with unchanged (prompt, opts) return their cached results instantly; only edited or new calls run live. Same-session only: a run started in another session or another working directory has no journal here and cannot be resumed. Stop the prior run first (TaskStop with that run id) before resuming.",
          },
        },
      },
    },
  },

  leanPrompt: (args?: ToolPromptArgs) =>
    [
      "Execute a workflow script that orchestrates multiple subagents deterministically. It runs in the background: the tool returns immediately with a task ID, and a <task-notification> arrives when the workflow completes.",
      OPT_IN_POLICY_LEAN,
      WORKFLOW_SCRIPT_ESSENTIALS,
      authoringReferenceSection(args),
    ].join("\n\n"),

  prompt: (args?: ToolPromptArgs) =>
    [
      "Execute a workflow script that orchestrates multiple subagents deterministically. Workflows run in the background — this tool returns immediately with a task ID, and a <task-notification> arrives when the workflow completes. Use /workflows to watch live progress.",
      "A workflow structures work across many agents — to be comprehensive (decompose and cover in parallel), to be confident (independent perspectives and adversarial checks before committing), or to take on scale one context can't hold (migrations, audits, broad sweeps). The script is where you encode that structure: what fans out, what verifies, what synthesizes. Use this tool for multi-step orchestration where control flow should be deterministic (loops, conditionals, fan-out) rather than model-driven.",
      OPT_IN_POLICY_FULL,
      WORKFLOW_SCRIPT_ESSENTIALS,
      authoringReferenceSection(args),
    ].join("\n\n"),

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
          `To stop it, use ${TASK_STOP_TOOL_NAME} with task_id "${run.runId}".`,
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
    const script = params.script;
    if (typeof script === "string" && script) {
      try {
        return sanitizeForSummary(parseScript(script).meta.description);
      } catch {
        return summarizeUnparsedScript(script);
      }
    }

    const scriptPath = params.scriptPath;
    if (typeof scriptPath === "string" && scriptPath) {
      return sanitizeForSummary(path.basename(scriptPath));
    }

    return "";
  },
};
