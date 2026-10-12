#!/usr/bin/env tsx

import fs from "fs/promises";
import os from "os";
import path from "path";
import { Agent } from "../../src/agent.js";
import type { WorkflowRun } from "../../src/workflow/types.js";

/**
 * Workflow authoring demo — can the model write a working script by itself?
 *
 * The other workflow examples hand the model a script verbatim, which tests the
 * RUNTIME. This one only states the goal, so it tests the AUTHORING surface: the
 * Workflow tool description plus the on-demand `workflow-authoring` skill.
 *
 * What it checks on the script the model actually wrote:
 *   - `export const meta = {...}` is the first statement and pure enough for the
 *     validator to parse (`run.meta.name` / `description` come back populated);
 *   - the file list arrives through the tool's `args`, not hardcoded;
 *   - it fans out with `pipeline()` (the documented default), not a barrier;
 *   - the run completes and returns a result.
 * It also prints every main-agent tool call, so you can see whether the model
 * loaded the authoring skill or wrote the script from the description alone.
 *
 * Uses WAVE_FAST_MODEL for cheaper/faster testing if set.
 */

/** The 3-file sample the workflow is asked to review. */
async function createSampleProject(dir: string): Promise<void> {
  await fs.mkdir(path.join(dir, "src"), { recursive: true });

  await fs.writeFile(
    path.join(dir, "src", "retry.js"),
    [
      "// Retries forever with no backoff and no jitter.",
      "export async function retry(fn) {",
      "  for (;;) {",
      "    try {",
      "      return await fn();",
      "    } catch {",
      "      continue;",
      "    }",
      "  }",
      "}",
      "",
    ].join("\n"),
  );

  await fs.writeFile(
    path.join(dir, "src", "parse.js"),
    [
      "// Throws a bare Error on empty input; callers cannot tell why.",
      "export function parseConfig(text) {",
      "  if (!text) throw new Error('bad input');",
      "  return JSON.parse(text);",
      "}",
      "",
    ].join("\n"),
  );

  await fs.writeFile(
    path.join(dir, "src", "cache.js"),
    [
      "// Entries never expire and the map grows without bound.",
      "const entries = new Map();",
      "",
      "export function get(key) {",
      "  return entries.get(key);",
      "}",
      "",
      "export function put(key, value) {",
      "  entries.set(key, value);",
      "}",
      "",
    ].join("\n"),
  );
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

/** `export const meta =` as the first statement, comments allowed before it. */
const META_FIRST_STATEMENT =
  /^\s*(?:(?:\/\/[^\n]*|\/\*[\s\S]*?\*\/)\s*)*export\s+const\s+meta\s*=/;

async function main(): Promise<void> {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "wave-authoring-"));
  await createSampleProject(tempDir);
  console.log(`Sample project: ${tempDir}`);

  const failed: string[] = [];
  const check = (label: string, ok: boolean, detail = ""): void => {
    console.log(`${ok ? "✅" : "❌"} ${label}${detail ? ` — ${detail}` : ""}`);
    if (!ok) failed.push(label);
  };

  const toolCalls: string[] = [];
  const notifications: string[] = [];

  const agent = await Agent.create({
    model: process.env.WAVE_FAST_MODEL,
    workdir: tempDir,
    callbacks: {
      onAssistantContentUpdated: (params) => {
        process.stdout.write(params.chunk);
      },
      onToolBlockUpdated: (params) => {
        if (params.stage === "start") {
          const name = params.name ?? "(unnamed)";
          toolCalls.push(name);
          console.log(`\n[tool] ${name}`);
        }
        if (params.stage === "end") {
          captureRunId(params.name, params.shortResult);
          if (params.shortResult) console.log(`  → ${params.shortResult}`);
        }
      },
      onNotificationMessageAdded: (params) => {
        if (params.taskType !== "workflow") return;
        notifications.push(params.summary);
        console.log(
          `\n[notification] status=${params.status}\n${params.summary}`,
        );
      },
    },
  });

  try {
    console.log("\n--- Asking the model to author a workflow ---\n");
    const known = await knownRunIds(agent);
    await agent.sendMessage(
      [
        "Use a workflow to review this project.",
        "Write the workflow script yourself — load the `workflow-authoring` skill first if you want the full reference.",
        "Requirements:",
        '- pass the file list to the tool\'s `args` input as {"files": [...path strings...]}; do not hardcode it in the script;',
        "- one phase fans out one agent per file, each returning a one-line purpose plus the single biggest risk in that file;",
        "- a second phase synthesizes a short project overview from those summaries;",
        "- at most 5 agents in total.",
      ].join("\n"),
    );

    console.log("\n--- Waiting for the workflow to finish ---\n");
    const run = await waitForRun(agent, known);

    if (!run) {
      check("workflow run finished", false, "timed out");
      return;
    }

    console.log("\n=== Checks ===");
    check(
      "run completed",
      run.status === "completed",
      `status=${run.status}${run.error ? ` error=${run.error}` : ""}`,
    );
    check(
      "meta parsed (pure literal, name + description)",
      Boolean(run.meta.name) && Boolean(run.meta.description),
      `name=${JSON.stringify(run.meta.name)} description=${JSON.stringify(run.meta.description)}`,
    );
    check(
      "run.totalAgents >= 2",
      run.totalAgents >= 2,
      `${run.totalAgents} agent(s)`,
    );
    check("run.result is set", run.result !== undefined);

    // Read back the script the model wrote — persisted at run.scriptPath.
    const script = await fs.readFile(run.scriptPath, "utf-8");
    check(
      "`export const meta =` is the first statement (comments allowed)",
      META_FIRST_STATEMENT.test(script),
    );
    check(
      "file list comes from `args`",
      /\bargs\b/.test(script),
      "the model was told to pass args.files",
    );
    check(
      "fans out with pipeline() (the documented default)",
      /\bpipeline\s*\(/.test(script),
      /\bparallel\s*\(/.test(script)
        ? "script uses parallel() instead — check whether it really needed a barrier"
        : "",
    );

    console.log("\n=== Tool calls the main agent made ===");
    console.log(toolCalls.join(" → ") || "(none)");
    console.log(
      `\n(authoring skill loaded: ${toolCalls.includes("Skill") ? "yes — via the Skill tool" : "no — wrote it from the tool description alone"})`,
    );

    console.log("\n=== Run summary ===");
    console.log(`runId:      ${run.runId}`);
    console.log(`agents:     ${run.totalAgents}`);
    console.log(`tokens:     ${(run.totalTokens / 1000).toFixed(1)}k`);
    console.log(
      `failures:   ${run.failures && run.failures.length > 0 ? run.failures.join("; ") : "(none)"}`,
    );
    for (const phase of run.phases) {
      console.log(
        `  phase "${phase.title}": ${phase.agentCount} agent(s), ${phase.tokens} tokens`,
      );
    }

    console.log("\n=== Script the model wrote ===\n");
    console.log(script);

    console.log("=== Result ===");
    console.log(JSON.stringify(run.result, null, 2));
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
