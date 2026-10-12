#!/usr/bin/env tsx

import fs from "fs/promises";
import os from "os";
import path from "path";
import { Agent } from "../../src/agent.js";
import type { WorkflowRun } from "../../src/workflow/types.js";

/**
 * Workflow structured-output demo (`agent(prompt, { schema })`).
 *
 * The schema is never forced through `tool_choice` — the subagent is asked to call
 * a `StructuredOutput` tool carrying the schema, and a round that skips it gets a
 * nudge in its own conversation (up to 5, then `agent()` throws instead of scraping
 * JSON out of the text). This example checks the everyday path:
 *   - every `agent({ schema })` call resolves to a validated OBJECT (not text);
 *   - `additionalProperties: false` bounces a wrong-shaped call in-turn, so the
 *     subagent can fix it without spending a nudge;
 *   - the run finishes with no retry-cap failure.
 *
 * Uses WAVE_FAST_MODEL for cheaper/faster testing if set.
 */

/** The script under test — plain JavaScript, exactly as the model would send it. */
const SCRIPT = `export const meta = {
  name: 'structured-review',
  description: 'Schema-validated review of each file in args.files',
  phases: [{ title: 'Review', detail: 'one schema-validated agent per file' }],
}

const fileSchema = {
  type: 'object',
  properties: {
    file: { type: 'string' },
    summary: { type: 'string' },
    issues: { type: 'array', items: { type: 'string' } },
    risky: { type: 'boolean' },
  },
  required: ['file', 'summary', 'issues', 'risky'],
  additionalProperties: false,
}

phase('Review')
const records = await pipeline(args.files, async (prev, file) => {
  return await agent(
    'Review ' + file + ' and report the issues you can see in it.',
    { label: 'review:' + file, phase: 'Review', schema: fileSchema }
  )
})

const clean = records.filter(Boolean)
return {
  count: clean.length,
  riskyCount: clean.filter((record) => record.risky === true).length,
  shapes: clean.map((record) => ({
    file: typeof record.file,
    summary: typeof record.summary,
    issuesIsArray: Array.isArray(record.issues),
    risky: typeof record.risky,
  })),
  sample: clean[0] || null,
}
`;

/** Shape of one schema-validated record, as seen by the script. */
interface ReviewShape {
  file: string;
  summary: string;
  issuesIsArray: boolean;
  risky: string;
}

/** What the script returns; asserted field by field below. */
interface StructuredReviewResult {
  count: number;
  riskyCount: number;
  shapes: ReviewShape[];
  sample: {
    file: string;
    summary: string;
    issues: string[];
    risky: boolean;
  } | null;
}

async function createSampleProject(dir: string): Promise<string[]> {
  await fs.mkdir(path.join(dir, "src"), { recursive: true });
  const files = ["src/retry.js", "src/parse.js"];
  await fs.writeFile(
    path.join(dir, "src", "retry.js"),
    [
      "export async function retry(fn) {",
      "  for (;;) {",
      "    try { return await fn(); } catch {} ",
      "  }",
      "}",
      "",
    ].join("\n"),
  );
  await fs.writeFile(
    path.join(dir, "src", "parse.js"),
    [
      "export function parseConfig(text) {",
      "  if (!text) throw new Error('bad input');",
      "  return JSON.parse(text);",
      "}",
      "",
    ].join("\n"),
  );
  return files;
}

/** The run id the Workflow tool reported, captured from its own receipt. */
let startedRunId: string | undefined;

/** Records the run id from the Workflow tool's result block, if this is one. */
function captureRunId(
  name: string | undefined,
  shortResult: string | undefined,
): void {
  if (name !== "Workflow" || !shortResult) return;
  const match = /\b(wf_[0-9a-f]+)\b/.exec(shortResult);
  if (match) startedRunId = match[1];
}

/** Run ids that exist before we start — the run-state store is NOT scoped to this run. */
async function knownRunIds(agent: Agent): Promise<Set<string>> {
  const runs = await agent.getWorkflowRuns();
  return new Set(runs.map((run) => run.runId));
}

/**
 * Waits for the run this example started.
 *
 * The run id comes from the Workflow tool's receipt (`Workflow started: <name>
 * (<runId>)`); the pre-run snapshot is only the fallback. Runs are scoped to this
 * session's directory now, so the store only holds this session's own runs — but a
 * second run in the same session (a re-run, a sibling example) is still
 * ambiguous, and the run id is exact.
 */
async function waitForRun(
  agent: Agent,
  known: Set<string>,
  timeoutMs = 240_000,
): Promise<WorkflowRun | undefined> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 3000));
    const runs = await agent.getWorkflowRuns();
    const run = startedRunId
      ? runs.find((candidate) => candidate.runId === startedRunId)
      : runs.filter((candidate) => !known.has(candidate.runId)).pop();
    if (!run) continue;
    if (run.status !== "running") return run;
    console.log(
      `  … ${run.runId}: ${run.status} | ${run.totalAgents} agent(s) | ${run.totalTokens} tokens`,
    );
  }
  return undefined;
}

async function main(): Promise<void> {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "wave-schema-"));
  const files = await createSampleProject(tempDir);
  console.log(`Sample project: ${tempDir}`);

  const failed: string[] = [];
  const check = (label: string, ok: boolean, detail = ""): void => {
    console.log(`${ok ? "✅" : "❌"} ${label}${detail ? ` — ${detail}` : ""}`);
    if (!ok) failed.push(label);
  };

  const agent = await Agent.create({
    model: process.env.WAVE_FAST_MODEL,
    workdir: tempDir,
    callbacks: {
      onAssistantContentUpdated: (params) => {
        process.stdout.write(params.chunk);
      },
      onToolBlockUpdated: (params) => {
        if (params.stage === "end") {
          captureRunId(params.name, params.shortResult);
        }
      },
      onNotificationMessageAdded: (params) => {
        if (params.taskType !== "workflow") return;
        console.log(
          `\n[notification] status=${params.status}\n${params.summary}`,
        );
      },
    },
  });

  try {
    const known = await knownRunIds(agent);
    await agent.sendMessage(
      [
        "Use the Workflow tool to run this exact script, unmodified:",
        "",
        SCRIPT,
        "Pass the tool's `args` input as exactly this JSON (do not inline the list into the script):",
        JSON.stringify({ files }),
      ].join("\n"),
    );

    console.log("\n--- Waiting for the workflow to finish ---\n");
    const run = await waitForRun(agent, known);
    if (!run) {
      check("workflow run finished", false, "timed out");
      return;
    }

    const result = run.result as StructuredReviewResult | undefined;
    const shapes = result?.shapes ?? [];

    console.log("\n=== Checks ===");
    check(
      "run completed",
      run.status === "completed",
      `status=${run.status}${run.error ? ` error=${run.error}` : ""}`,
    );
    check(
      "no retry-cap failure (every schema was satisfied within its nudges)",
      (run.failures ?? []).length === 0,
      (run.failures ?? []).join("; "),
    );
    check(
      "one structured record per file",
      result?.count === files.length,
      `count=${String(result?.count)} (a short count means an agent({schema}) call fell through)`,
    );
    check(
      "records are objects, not text",
      shapes.length > 0 &&
        shapes.every(
          (shape) =>
            shape.file === "string" &&
            shape.summary === "string" &&
            shape.issuesIsArray &&
            shape.risky === "boolean",
        ),
      JSON.stringify(shapes),
    );
    check(
      "risky flag is a validated boolean (not a string)",
      shapes.every((shape) => shape.risky === "boolean"),
    );

    console.log("\n=== Run summary ===");
    console.log(`runId:  ${run.runId}`);
    console.log(`agents: ${run.totalAgents}`);
    console.log(`tokens: ${(run.totalTokens / 1000).toFixed(1)}k`);
    console.log("sample record:", JSON.stringify(result?.sample, null, 2));
  } catch (error) {
    console.error("Error:", error);
    failed.push("unhandled error");
  } finally {
    await agent.destroy();
    await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
    if (failed.length > 0) {
      console.log(`\n${failed.length} check(s) FAILED: ${failed.join("; ")}`);
    } else {
      console.log("\nAll checks passed.");
    }
    process.exit(failed.length > 0 ? 1 : 0);
  }
}

process.on("SIGINT", async () => {
  process.exit(0);
});
process.on("SIGTERM", async () => {
  process.exit(0);
});

main().catch((error) => {
  console.error("Unhandled error:", error);
  process.exit(1);
});
