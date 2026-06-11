#!/usr/bin/env tsx

import fs from "fs/promises";
import path from "path";
import os from "os";
import { Agent } from "../src/agent.js";

/**
 * Workflow integration test — verifies token tracking, phases, and structured output.
 *
 * Creates a temp project, then runs a two-phase pipeline workflow via the Workflow tool.
 * After completion, checks that:
 *   1. totalTokens > 0
 *   2. phases array has data (agentCount > 0, tokens > 0)
 *   3. status is "completed"
 *
 * Uses WAVE_FAST_MODEL for cheaper/faster testing if set.
 */

async function createSampleProject(dir: string) {
  await fs.mkdir(path.join(dir, "src"), { recursive: true });

  await fs.writeFile(
    path.join(dir, "src", "math.js"),
    `export function add(a, b) { return a + b; }\nexport function multiply(a, b) { return a * b; }\n`,
  );
  await fs.writeFile(
    path.join(dir, "src", "string.js"),
    `export function capitalize(s) { return s.charAt(0).toUpperCase() + s.slice(1); }\nexport function reverse(s) { return s.split('').reverse().join(''); }\n`,
  );
  await fs.writeFile(
    path.join(dir, "src", "array.js"),
    `export function unique(arr) { return [...new Set(arr)]; }\nexport function flatten(arr) { return arr.flat(Infinity); }\n`,
  );
}

async function main() {
  const tempDir = await fs.mkdtemp(
    path.join(os.tmpdir(), "wave-workflow-test-"),
  );
  console.log(`Temp project: ${tempDir}`);
  await createSampleProject(tempDir);

  const agent = await Agent.create({
    model: process.env.WAVE_FAST_MODEL,
    workdir: tempDir,
  });

  const results: string[] = [];
  let passed = 0;
  let failed = 0;

  function check(label: string, condition: boolean, detail?: string) {
    if (condition) {
      passed++;
      results.push(`  PASS: ${label}`);
    } else {
      failed++;
      results.push(`  FAIL: ${label}${detail ? ` — ${detail}` : ""}`);
    }
  }

  try {
    // Run a two-phase pipeline workflow
    console.log("\n--- Running workflow via Workflow tool ---\n");
    await agent.sendMessage(
      "Use the Workflow tool to run this exact script:\n\n" +
        "export const meta = {\n" +
        "  name: 'pipeline-test',\n" +
        "  description: 'Read 3 files then summarize each',\n" +
        "  phases: [\n" +
        "    { title: 'Read', detail: 'read source files' },\n" +
        "    { title: 'Summarize', detail: 'summarize each file' },\n" +
        "  ],\n" +
        "}\n\n" +
        "const files = ['src/math.js', 'src/string.js', 'src/array.js']\n\n" +
        "phase('Read')\n" +
        "const contents = await pipeline(files, (prev, file) => agent('Read the file ' + file + ' and return its full content', { phase: 'Read' }))\n\n" +
        "phase('Summarize')\n" +
        "const summaries = await pipeline(contents.filter(Boolean), (prev, content, i) => agent('Summarize this code in one sentence: ' + content, { phase: 'Summarize' }))\n\n" +
        "log('Done: ' + summaries.filter(Boolean).length + ' summaries')\n" +
        "return summaries",
    );

    // Wait for workflow to complete (poll up to 120s)
    console.log("\n--- Waiting for workflow to complete ---\n");
    let run: import("../src/workflow/types.js").WorkflowRun | undefined;
    for (let i = 0; i < 24; i++) {
      await new Promise((r) => setTimeout(r, 5000));
      const runs = await agent.getWorkflowRuns();
      const latest = runs[runs.length - 1];
      if (latest && latest.status !== "running") {
        run = latest;
        break;
      }
      if (latest) {
        console.log(
          `  ${latest.runId}: ${latest.status} | ${latest.totalAgents} agents | ${latest.totalTokens} tokens`,
        );
      }
    }

    // Check results
    console.log("\n--- Test Results ---\n");

    if (!run) {
      check(
        "workflow completed",
        false,
        "no completed workflow found after 120s",
      );
    } else {
      check(
        "status is completed",
        run.status === "completed",
        `got: ${run.status}`,
      );
      check("totalAgents > 0", run.totalAgents > 0, `got: ${run.totalAgents}`);
      check("totalTokens > 0", run.totalTokens > 0, `got: ${run.totalTokens}`);
      check(
        "phases array exists",
        run.phases.length > 0,
        `got: ${run.phases.length} phases`,
      );

      if (run.phases.length > 0) {
        const readPhase = run.phases.find((p) => p.title === "Read");
        const summarizePhase = run.phases.find((p) => p.title === "Summarize");

        if (readPhase) {
          check(
            "Read phase has agents",
            readPhase.agentCount > 0,
            `got: ${readPhase.agentCount}`,
          );
          check(
            "Read phase has tokens",
            readPhase.tokens > 0,
            `got: ${readPhase.tokens}`,
          );
        } else {
          check("Read phase exists", false);
        }

        if (summarizePhase) {
          check(
            "Summarize phase has agents",
            summarizePhase.agentCount > 0,
            `got: ${summarizePhase.agentCount}`,
          );
          check(
            "Summarize phase has tokens",
            summarizePhase.tokens > 0,
            `got: ${summarizePhase.tokens}`,
          );
        } else {
          check("Summarize phase exists", false);
        }
      }

      check("no error", !run.error, run.error || "ok");
      check("has endTime", run.endTime !== undefined, "endTime missing");
    }

    // Print all results
    for (const r of results) {
      console.log(r);
    }
    console.log(`\n${passed} passed, ${failed} failed`);

    if (run) {
      console.log(`\n--- Workflow Summary ---`);
      console.log(`  Run ID: ${run.runId}`);
      console.log(`  Status: ${run.status}`);
      console.log(`  Agents: ${run.totalAgents}`);
      console.log(`  Tokens: ${run.totalTokens}`);
      for (const p of run.phases) {
        console.log(
          `  Phase "${p.title}": ${p.agentCount} agents, ${p.tokens} tokens, ${Math.round(p.elapsed / 1000)}s`,
        );
      }
    }
  } catch (error) {
    console.error("Error:", error);
  } finally {
    await agent.destroy();
    await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
    process.exit(failed > 0 ? 1 : 0);
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
