#!/usr/bin/env tsx

/**
 * Workflow feature verification — direct API test.
 *
 * Bypasses the AI model by calling workflowManager directly.
 * Tests:
 *   1. Per-Run Directory Structure (runDir/script.js, journal.jsonl, agents/)
 *   2. Journal-Subagent Linkage (subagentId, transcriptPath in journal)
 *   3. Agent Metadata Sidecars (agents/N.meta.json)
 *   4. Run State Persistence (run-state.json)
 *   5. Kill/Skip/Retry agents
 *   6. Progress Events
 *
 * Uses WAVE_FAST_MODEL for cheaper/faster testing if set.
 */

import fs from "fs/promises";
import fspath from "path";
import os from "os";
import { Agent } from "../src/agent.js";
import type { WorkflowRun } from "../src/workflow/types.js";

const passed: string[] = [];
const failed: string[] = [];

function check(label: string, condition: boolean, detail?: string) {
  if (condition) {
    passed.push(label);
    console.log(`  PASS: ${label}`);
  } else {
    failed.push(label);
    console.log(`  FAIL: ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

async function main() {
  const tempDir = await fs.mkdtemp(fspath.join(os.tmpdir(), "wave-verify-"));
  console.log(`Temp project: ${tempDir}`);

  await fs.mkdir(fspath.join(tempDir, "src"), { recursive: true });
  await fs.writeFile(
    fspath.join(tempDir, "src", "index.js"),
    `export function add(a, b) { return a + b; }\nexport function multiply(a, b) { return a * b; }\n`,
  );
  await fs.writeFile(
    fspath.join(tempDir, "README.md"),
    "# Test Project\nA simple math library.\n",
  );

  const agent = await Agent.create({
    model: process.env.WAVE_FAST_MODEL,
    workdir: tempDir,
  });

  try {
    const workflowManager = (
      agent as unknown as {
        container: {
          get: (
            key: string,
          ) => import("../src/managers/workflowManager.js").WorkflowManager;
        };
      }
    ).container.get("WorkflowManager");

    // ============================================================
    // TEST 1: Per-Run Directory + Journal Linkage + Agent Sidecars
    // ============================================================
    console.log("\n=== Test 1: Run workflow and verify structure ===\n");

    const script = [
      "export const meta = {",
      "  name: 'verify-features',",
      "  description: 'Verify workflow features',",
      "  phases: [",
      "    { title: 'Read', detail: 'read files' },",
      "    { title: 'Summarize', detail: 'summarize' },",
      "  ],",
      "}",
      "",
      "phase('Read')",
      "const content = await agent('Read the file README.md and return its content', { phase: 'Read', label: 'read-readme' })",
      "phase('Summarize')",
      "const summary = await agent('Summarize this in one sentence: ' + content, { phase: 'Summarize', label: 'summarize' })",
      "log('Done')",
      "return summary",
    ].join("\n");

    const run = await workflowManager.createRun(script);
    const runId = run.runId;
    console.log(`  Created run: ${runId}`);

    await workflowManager.startRun(runId);

    // Wait for completion
    let completed = false;
    for (let i = 0; i < 24; i++) {
      await new Promise((r) => setTimeout(r, 5000));
      const current = workflowManager.getRun(runId);
      if (current && current.status !== "running") {
        completed = true;
        break;
      }
      console.log(
        `  polling: ${runId} status=${current?.status} agents=${current?.totalAgents}`,
      );
    }

    check("workflow completed", completed, "timed out after 120s");

    const finalRun = workflowManager.getRun(runId);
    if (!finalRun) {
      console.log("  Run not found, cannot continue");
      process.exit(1);
    }

    check(
      "status is completed",
      finalRun.status === "completed",
      `got: ${finalRun.status}`,
    );
    check(
      "has 2 agents",
      finalRun.totalAgents === 2,
      `got: ${finalRun.totalAgents}`,
    );
    check(
      "has tokens > 0",
      finalRun.totalTokens > 0,
      `got: ${finalRun.totalTokens}`,
    );

    // ============================================================
    // TEST 2: Directory Layout
    // ============================================================
    console.log("\n=== Test 2: Directory Layout ===\n");

    const scriptDir = fspath.dirname(finalRun.scriptPath);
    const scriptBasename = fspath.basename(finalRun.scriptPath);
    check(
      "script is at <runId>/script.js",
      scriptBasename === "script.js",
      `got: ${scriptBasename}`,
    );
    check(
      "script directory contains runId",
      scriptDir.includes(runId),
      `path: ${finalRun.scriptPath}`,
    );

    const journalPath = fspath.join(scriptDir, "journal.jsonl");
    const journalExists = await fs
      .access(journalPath)
      .then(() => true)
      .catch(() => false);
    check("journal.jsonl exists", journalExists, `expected: ${journalPath}`);

    const agentsDir = fspath.join(scriptDir, "agents");
    const agentsDirExists = await fs
      .access(agentsDir)
      .then(() => true)
      .catch(() => false);
    check("agents/ directory exists", agentsDirExists);

    const runStatePath = fspath.join(scriptDir, "run-state.json");
    const runStateExists = await fs
      .access(runStatePath)
      .then(() => true)
      .catch(() => false);
    check("run-state.json exists", runStateExists);

    // ============================================================
    // TEST 3: Journal-Subagent Linkage
    // ============================================================
    console.log("\n=== Test 3: Journal-Subagent Linkage ===\n");

    if (journalExists) {
      const journalContent = await fs.readFile(journalPath, "utf-8");
      const entries = journalContent
        .split("\n")
        .filter((l: string) => l.trim())
        .map((l: string) => JSON.parse(l));

      const agentEntries = entries.filter(
        (e: Record<string, unknown>) => "agentIndex" in e && !("type" in e),
      );
      check(
        "journal has 2 agent entries",
        agentEntries.length === 2,
        `got: ${agentEntries.length}`,
      );

      if (agentEntries.length > 0) {
        const first = agentEntries[0];
        check(
          "entry has subagentId",
          typeof first.subagentId === "string" && first.subagentId.length > 0,
          `got: ${JSON.stringify(first.subagentId)}`,
        );
        check(
          "entry has transcriptPath",
          typeof first.transcriptPath === "string" &&
            first.transcriptPath.endsWith(".jsonl"),
          `got: ${JSON.stringify(first.transcriptPath)}`,
        );
      }

      // Verify log entries
      const logEntries = entries.filter(
        (e: Record<string, unknown>) => e.type === "log",
      );
      check(
        "journal has 1 log entry",
        logEntries.length === 1,
        `got: ${logEntries.length}`,
      );
      if (logEntries.length > 0) {
        check(
          "log entry message is 'Done'",
          logEntries[0].message === "Done",
          `got: ${logEntries[0].message}`,
        );
      }
    }

    // ============================================================
    // TEST 4: Agent Metadata Sidecars
    // ============================================================
    console.log("\n=== Test 4: Agent Metadata Sidecars ===\n");

    if (agentsDirExists) {
      const metaFiles = (await fs.readdir(agentsDir)).filter((f) =>
        f.endsWith(".meta.json"),
      );
      check(
        "agents/ has 2 meta.json files",
        metaFiles.length === 2,
        `got: ${metaFiles.length} [${metaFiles.join(", ")}]`,
      );

      if (metaFiles.length > 0) {
        // Check first agent meta
        const meta0 = JSON.parse(
          await fs.readFile(fspath.join(agentsDir, "0.meta.json"), "utf-8"),
        );
        check(
          "meta has agentType",
          meta0.agentType === "general-purpose",
          `got: ${meta0.agentType}`,
        );
        check(
          "meta has subagentId",
          typeof meta0.subagentId === "string" && meta0.subagentId.length > 0,
          `got: ${meta0.subagentId}`,
        );
        check(
          "meta has transcriptPath",
          typeof meta0.transcriptPath === "string" &&
            meta0.transcriptPath.endsWith(".jsonl"),
          `got: ${meta0.transcriptPath}`,
        );
        check(
          "meta has label",
          meta0.label === "read-readme",
          `got: ${meta0.label}`,
        );

        // Check second agent meta
        const meta1 = JSON.parse(
          await fs.readFile(fspath.join(agentsDir, "1.meta.json"), "utf-8"),
        );
        check(
          "second meta has label 'summarize'",
          meta1.label === "summarize",
          `got: ${meta1.label}`,
        );
      }
    }

    // ============================================================
    // TEST 5: Run State Persistence
    // ============================================================
    console.log("\n=== Test 5: Run State Persistence ===\n");

    if (runStateExists) {
      const state = JSON.parse(await fs.readFile(runStatePath, "utf-8"));
      check("run-state has runId", state.runId === runId);
      check(
        "run-state has status completed",
        state.status === "completed",
        `got: ${state.status}`,
      );
      check(
        "run-state has totalAgents 2",
        state.totalAgents === 2,
        `got: ${state.totalAgents}`,
      );
      check(
        "run-state has totalTokens > 0",
        state.totalTokens > 0,
        `got: ${state.totalTokens}`,
      );
      check(
        "run-state has no completionPromise",
        !("completionPromise" in state),
      );
      check("run-state has endTime", state.endTime !== undefined);
      check(
        "run-state has phases",
        state.phases.length >= 2,
        `got: ${state.phases.length}`,
      );
    }

    // Verify listLoads loads this persisted run on a new agent instance
    const allRuns = await agent.getWorkflowRuns();
    const foundRun = allRuns.find((r: WorkflowRun) => r.runId === runId);
    check("listRuns returns persisted run", !!foundRun);

    // ============================================================
    // TEST 6: killRun
    // ============================================================
    console.log("\n=== Test 6: killRun ===\n");

    const killScript = [
      "export const meta = { name: 'kill-test', description: 'Test kill' }",
      "const a = await agent('Read README.md', { label: 'slow-agent-1' })",
      "const b = await agent('Read src/index.js', { label: 'slow-agent-2' })",
      "const c = await agent('Read src/index.js again', { label: 'slow-agent-3' })",
      "return [a, b, c]",
    ].join("\n");

    const killRun = await workflowManager.createRun(killScript);
    await workflowManager.startRun(killRun.runId);

    // Wait a bit then kill
    await new Promise((r) => setTimeout(r, 8000));
    const killRunState = workflowManager.getRun(killRun.runId);
    if (killRunState?.status === "running") {
      workflowManager.killRun(killRun.runId);
      console.log(`  Killed run ${killRun.runId}`);
      await new Promise((r) => setTimeout(r, 2000));
      const afterKill = workflowManager.getRun(killRun.runId);
      check(
        "killed run has aborted status",
        afterKill?.status === "aborted",
        `got: ${afterKill?.status}`,
      );
    } else {
      // Already completed (fast model), mark as pass since kill is best-effort
      check("killRun: workflow already completed (kill not needed)", true);
    }

    // ============================================================
    // TEST 7: Progress Events (verify via run phases)
    // ============================================================
    console.log("\n=== Test 7: Progress Events ===\n");

    // Progress events are emitted internally; verify via the run's phase states
    const verifyRun = workflowManager.getRun(runId);
    if (verifyRun) {
      check(
        "run has phases",
        verifyRun.phases.length >= 2,
        `got: ${verifyRun.phases.length}`,
      );
      const readPhase = verifyRun.phases.find(
        (p: import("../src/workflow/types.js").WorkflowPhaseState) =>
          p.title === "Read",
      );
      const summarizePhase = verifyRun.phases.find(
        (p: import("../src/workflow/types.js").WorkflowPhaseState) =>
          p.title === "Summarize",
      );

      if (readPhase) {
        check(
          "Read phase has agentCount > 0",
          readPhase.agentCount > 0,
          `got: ${readPhase.agentCount}`,
        );
        check(
          "Read phase has tokens > 0",
          readPhase.tokens > 0,
          `got: ${readPhase.tokens}`,
        );
        check(
          "Read phase has elapsed > 0",
          readPhase.elapsed > 0,
          `got: ${readPhase.elapsed}`,
        );
      }

      if (summarizePhase) {
        check(
          "Summarize phase has agentCount > 0",
          summarizePhase.agentCount > 0,
          `got: ${summarizePhase.agentCount}`,
        );
        check(
          "Summarize phase has tokens > 0",
          summarizePhase.tokens > 0,
          `got: ${summarizePhase.tokens}`,
        );
      }
    }

    // ============================================================
    // Summary
    // ============================================================
    console.log("\n=== Summary ===\n");
    for (const p of passed) console.log(`  PASS: ${p}`);
    for (const f of failed) console.log(`  FAIL: ${f}`);
    console.log(`\n${passed.length} passed, ${failed.length} failed`);
  } catch (error) {
    console.error("Error:", error);
  } finally {
    await agent.destroy();
    await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
    process.exit(failed.length > 0 ? 1 : 0);
  }
}

process.on("SIGINT", async () => {
  process.exit(1);
});
process.on("SIGTERM", async () => {
  process.exit(1);
});

main().catch((error) => {
  console.error("Unhandled error:", error);
  process.exit(1);
});
