#!/usr/bin/env tsx

import fs from "fs/promises";
import os from "os";
import path from "path";
import { Agent } from "../../src/agent.js";
import type { WorkflowRun } from "../../src/workflow/types.js";

/**
 * Workflow failure-visibility demo.
 *
 * A run that "completed" is not necessarily a run that worked, so the completion
 * notification carries the per-agent tallies in a `<usage>` block
 * (`agent_count` / `agents_done` / `agents_error` / `agents_skipped` /
 * `agents_empty_result` / `subagent_tokens` / `tool_uses` / `duration_ms`), the
 * per-slot `pipeline[i] failed: …` lines, and the per-agent result files. This
 * example drives one pipeline through all three shapes and checks that the failure
 * and the short-circuit are reported instead of being folded into a silent null:
 *   - item "beta"  — the stage THROWS          → null + a `pipeline[1] failed:` line
 *   - item "gamma" — the stage returns NULL    → null, remaining stages skipped
 *   - item "alpha" — a real agent() call       → survives both stages
 * It also records a failure of its OWN through `recordFailure()`, the script-side
 * counterpart of the pipeline()/parallel() lines (Claude Code exposes the same API).
 *
 */

/** The script under test — plain JavaScript, exactly as the model would send it. */
const SCRIPT = `export const meta = {
  name: 'failure-visibility',
  description: 'A real failure, a null short-circuit and a success in one pipeline',
  phases: [{ title: 'Mix', detail: 'one agent for the healthy item' }],
}

phase('Mix')
const items = ['alpha', 'beta', 'gamma']
const results = await pipeline(
  items,
  async (prev, item) => {
    if (item === 'beta') throw new Error('boom on ' + item)
    if (item === 'gamma') return null
    return await agent('Reply with the single word: ok', { label: 'ok:' + item, phase: 'Mix' })
  },
  async (prev, item) => {
    // Probe: a null must never reach a second stage, so this branch has to stay dead.
    return prev === null ? 'second-stage-saw-null' : 'second-stage-ran'
  }
)

// A failure the script itself decided on: without recordFailure() the run would
// report only the pipeline line and silently drop this one.
try {
  throw new Error('coverage data missing')
} catch (err) {
  recordFailure('script-recorded: ' + err.message)
}

log('results=' + JSON.stringify(results))
log('failures=' + JSON.stringify(getFailures()))
return { results: results, failures: getFailures() }
`;

/** What the script returns; asserted field by field below. */
interface FailureVisibilityResult {
  results: Array<string | null>;
  failures: string[];
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

/** The completion notification is enqueued right after the status flips. */
async function waitForNotification(
  notifications: string[],
  timeoutMs = 20_000,
): Promise<string | undefined> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (notifications.length > 0) return notifications[0];
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  return undefined;
}

async function main(): Promise<void> {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "wave-failures-"));
  console.log(`Workdir: ${tempDir}`);

  const failed: string[] = [];
  const check = (label: string, ok: boolean, detail = ""): void => {
    console.log(`${ok ? "✅" : "❌"} ${label}${detail ? ` — ${detail}` : ""}`);
    if (!ok) failed.push(label);
  };

  const notifications: string[] = [];

  const agent = await Agent.create({
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
        notifications.push(params.summary);
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
      ].join("\n"),
    );

    console.log("\n--- Waiting for the workflow to finish ---\n");
    const run = await waitForRun(agent, known);
    if (!run) {
      check("workflow run finished", false, "timed out");
      return;
    }

    const result = run.result as FailureVisibilityResult | undefined;
    const failures = run.failures ?? [];
    const summary = await waitForNotification(notifications);

    console.log("\n=== Checks ===");
    check(
      "run completed (a failed slot does not fail the run)",
      run.status === "completed",
      `status=${run.status}${run.error ? ` error=${run.error}` : ""}`,
    );
    check(
      "the throwing slot is reported by index",
      failures.some((line) =>
        line.includes("pipeline[1] failed: boom on beta"),
      ),
      failures.join("; ") || "(no failures recorded)",
    );
    check(
      "a script-recorded failure reaches the run's list",
      failures.some((line) =>
        line.includes("script-recorded: coverage data missing"),
      ),
      `script saw: ${JSON.stringify(result?.failures ?? [])}`,
    );
    check(
      "the healthy item survived both stages",
      result?.results[0] === "second-stage-ran",
      `results[0]=${JSON.stringify(result?.results[0])} (the first stage must be seeded with the item)`,
    );
    check("the throwing item resolved to null", result?.results[1] === null);
    check(
      "the null-returning item skipped its remaining stages",
      result?.results[2] === null,
      `results[2]=${JSON.stringify(result?.results[2])}`,
    );
    check(
      "no slot reached a second stage with a null input",
      !(result?.results ?? []).includes("second-stage-saw-null"),
    );
    check("a workflow notification was emitted", summary !== undefined);
    check(
      "the notification body carries the failure line",
      summary !== undefined &&
        summary.includes("pipeline[1] failed: boom on beta"),
    );
    check(
      "the notification body carries the script-recorded failure",
      summary !== undefined &&
        summary.includes("script-recorded: coverage data missing"),
    );
    // The headline states the outcome only; the tallies are agent counts in a
    // `<usage>` block, and `agents_empty_result` counts AGENTS whose result was
    // empty — the two null pipeline results below never became agents, so 0 is
    // the correct number here (and "N failed" never appears next to a
    // `Failures:` line again).
    check(
      "the headline carries no counts",
      summary !== undefined && !/failed, \d+ skipped/.test(summary),
    );
    check(
      "the usage block reports agent counts, not run counts",
      summary !== undefined &&
        summary.includes("<agent_count>1</agent_count>") &&
        summary.includes("<agents_done>1</agents_done>") &&
        summary.includes("<agents_error>0</agents_error>") &&
        summary.includes("<agents_skipped>0</agents_skipped>") &&
        summary.includes("<agents_empty_result>0</agents_empty_result>"),
    );
    check(
      "the usage block reports tokens, tool uses and duration",
      summary !== undefined &&
        /<subagent_tokens>\d+<\/subagent_tokens>/.test(summary) &&
        /<tool_uses>\d+<\/tool_uses>/.test(summary) &&
        /<duration_ms>\d+<\/duration_ms>/.test(summary),
    );

    console.log("\n=== Notification body ===");
    console.log(summary ?? "(none)");

    console.log("\n=== Run summary ===");
    console.log(`runId:    ${run.runId}`);
    console.log(`agents:   ${run.totalAgents}`);
    console.log(`tokens:   ${(run.totalTokens / 1000).toFixed(1)}k`);
    console.log(`failures: ${failures.join("; ") || "(none)"}`);
    console.log(`result:   ${JSON.stringify(result)}`);
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
