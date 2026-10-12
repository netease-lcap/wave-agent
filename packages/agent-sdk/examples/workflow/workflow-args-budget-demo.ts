#!/usr/bin/env tsx

import fs from "fs/promises";
import os from "os";
import path from "path";
import { Agent } from "../../src/agent.js";
import type { WorkflowRun } from "../../src/workflow/types.js";

/**
 * Workflow args + budget + pipeline-seed demo.
 *
 * The script is handed to the model verbatim, so this tests the RUNTIME (and the
 * tool's input plumbing) rather than the authoring surface:
 *   - `args` reaches the script as a real array (`args.files`), passed through the
 *     tool's `args` input instead of being inlined into the script;
 *   - a `+30k` budget target in the user message becomes `budget.total === 30000`;
 *   - the FIRST pipeline stage is seeded with the item itself (a regression here
 *     made every single-stage pipeline a no-op);
 *   - later stages receive the previous stage's return value, with no barrier.
 *
 * Uses WAVE_FAST_MODEL for cheaper/faster testing if set.
 */

/** The script under test — plain JavaScript, exactly as the model would send it. */
const SCRIPT = `export const meta = {
  name: 'line-count',
  description: 'Count the lines of each file in args.files, two stages',
  phases: [
    { title: 'Count', detail: 'one agent per file' },
    { title: 'Check', detail: 'numeric guard, no barrier' },
  ],
}

log('args=' + JSON.stringify(args) + ' budget.total=' + budget.total)

phase('Count')
const rows = await pipeline(
  args.files,
  async (prev, file, index) => {
    // First stage must be seeded with the item itself, not undefined.
    if (prev !== file) throw new Error('first-stage seed broken: ' + String(prev))
    const raw = await agent('Read ' + file + ' and reply with ONLY its line count, as digits.', {
      label: 'count:' + file,
      phase: 'Count',
    })
    return { file: file, index: index, raw: String(raw).trim() }
  },
  async (prev, file) => {
    return { file: prev.file, index: prev.index, numeric: Number.isFinite(Number(prev.raw)) }
  }
)

phase('Check')
log('rows=' + rows.length + ' budget.spent=' + budget.spent() + ' remaining=' + budget.remaining())
return {
  total: rows.length,
  budgetTotal: budget.total,
  firstFile: rows[0] ? rows[0].file : null,
  allNumeric: rows.every((row) => row && row.numeric === true),
  stage2RanForEveryItem: rows.every((row) => row && typeof row.index === 'number'),
}
`;

/** What the script returns; asserted field by field below. */
interface LineCountResult {
  total: number;
  budgetTotal: number | null;
  firstFile: string | null;
  allNumeric: boolean;
  stage2RanForEveryItem: boolean;
}

async function createSampleProject(dir: string): Promise<string[]> {
  await fs.mkdir(path.join(dir, "src"), { recursive: true });
  const files = ["src/one.js", "src/two.js", "src/three.js"];
  for (const [index, file] of files.entries()) {
    await fs.writeFile(
      path.join(dir, file),
      `// file ${index + 1}\nexport const id = ${index + 1};\n`,
    );
  }
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
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "wave-args-budget-"));
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
        "",
        "Budget: +30k for this turn.",
      ].join("\n"),
    );

    console.log("\n--- Waiting for the workflow to finish ---\n");
    const run = await waitForRun(agent, known);
    if (!run) {
      check("workflow run finished", false, "timed out");
      return;
    }

    const result = run.result as LineCountResult | undefined;

    console.log("\n=== Checks ===");
    check(
      "run completed",
      run.status === "completed",
      `status=${run.status}${run.error ? ` error=${run.error}` : ""}`,
    );
    check(
      "no failures recorded",
      (run.failures ?? []).length === 0,
      (run.failures ?? []).join("; "),
    );
    check(
      "args.files reached the script (3 items)",
      result?.total === files.length,
      `total=${String(result?.total)}`,
    );
    check(
      "args.files[0] is the first item",
      result?.firstFile === files[0],
      `firstFile=${String(result?.firstFile)}`,
    );
    check(
      "`+30k` became budget.total === 30000",
      result?.budgetTotal === 30000,
      `budgetTotal=${String(result?.budgetTotal)} (null = the target was not parsed)`,
    );
    check(
      "first-stage seed worked (script would have thrown otherwise)",
      result?.stage2RanForEveryItem === true,
    );
    check(
      "every second-stage callback received a previous result",
      result?.allNumeric === true,
    );

    console.log("\n=== Run summary ===");
    console.log(`runId:  ${run.runId}`);
    console.log(`agents: ${run.totalAgents}`);
    console.log(`tokens: ${(run.totalTokens / 1000).toFixed(1)}k`);
    console.log("result:", JSON.stringify(result, null, 2));
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
