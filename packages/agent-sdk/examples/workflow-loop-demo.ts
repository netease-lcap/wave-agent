#!/usr/bin/env tsx

import fs from "fs/promises";
import path from "path";
import os from "os";
import { Agent } from "../src/agent.js";

/**
 * Workflow loop + conditional demo — test-driven fix loop.
 *
 * Scenario: We provide a "buggy" function, ask the agent to:
 *   1. Read the spec and generate test cases
 *   2. Check completeness (loop until complete)
 *   3. Fix the code until all tests pass (loop until passing)
 *
 * This demonstrates:
 *   - for loop (generate tests per scenario)
 *   - while loop (converge on completeness and correctness)
 *   - if/else conditional (branch based on structured agent output)
 *   - schema (force agent to return JSON for programmatic branching)
 *
 * Uses WAVE_FAST_MODEL for cheaper/faster testing if set.
 */

// Create a temp project with a buggy implementation
async function createProject(dir: string) {
  await fs.mkdir(path.join(dir, "src"), { recursive: true });
  await fs.mkdir(path.join(dir, "tests"), { recursive: true });

  // The spec: what the function SHOULD do
  await fs.writeFile(
    path.join(dir, "SPEC.md"),
    [
      "# String Utils Spec",
      "",
      "## capitalize(s: string): string",
      "- Capitalize the first letter of the string",
      "- Return empty string for empty input",
      "- Handle null/undefined by returning empty string",
      "",
      "## truncate(s: string, maxLen: number): string",
      "- Truncate string to maxLen characters, appending '...' if truncated",
      "- If maxLen < 3, throw Error('maxLen must be >= 3')",
      "- If string length <= maxLen, return as-is",
      "- If null/undefined input, return empty string",
    ].join("\n"),
  );

  // Buggy implementation (has several bugs)
  await fs.writeFile(
    path.join(dir, "src", "stringUtils.js"),
    [
      "export function capitalize(s) {",
      "  // Bug: no null check, no empty string check",
      "  return s.charAt(0).toUpperCase() + s.slice(1);",
      "}",
      "",
      "export function truncate(s, maxLen) {",
      "  // Bug: no null check, wrong ellipsis length, no maxLen validation",
      "  if (s.length > maxLen) {",
      "    return s.slice(0, maxLen) + '...';",
      "  }",
      "  return s;",
      "}",
    ].join("\n"),
  );
}

async function main() {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "wave-loop-demo-"));
  console.log(`Project dir: ${tempDir}`);
  await createProject(tempDir);

  const agent = await Agent.create({
    model: process.env.WAVE_FAST_MODEL,
    workdir: tempDir,
  });

  try {
    // Send the workflow script to the agent
    // The script uses loop + conditional + schema to implement
    // a test-driven fix loop
    console.log("\n--- Running test-driven fix loop workflow ---\n");

    await agent.sendMessage(
      "Use the Workflow tool to run this exact script:\n\n" +
        "export const meta = {\n" +
        "  name: 'test-driven-fix',\n" +
        "  description: 'Generate tests, check completeness, fix code until passing',\n" +
        "  phases: [\n" +
        "    { title: 'Generate', detail: 'generate test cases from spec' },\n" +
        "    { title: 'Complete', detail: 'loop until test coverage is complete' },\n" +
        "    { title: 'Fix', detail: 'loop until all tests pass' },\n" +
        "  ],\n" +
        "}\n\n" +
        // Phase 1: Generate
        "phase('Generate')\n" +
        "const spec = await agent('Read the file SPEC.md and return its content')\n" +
        "await agent('Based on this spec, write test cases in tests/stringUtils.test.js using vitest syntax. Cover all edge cases mentioned in the spec.\\n\\nSpec:\\n' + spec, { label: 'generate-tests' })\n" +
        "log('Tests generated')\n\n" +
        // Phase 2: Completeness loop (while + if/else + schema)
        "phase('Complete')\n" +
        "let complete = false\n" +
        "let round = 0\n" +
        "const MAX_ROUNDS = 3\n" +
        "while (!complete && round < MAX_ROUNDS) {\n" +
        "  round++\n" +
        "  const review = await agent(\n" +
        '    \'Read tests/stringUtils.test.js and SPEC.md. Are all scenarios from the spec covered? Reply ONLY with JSON: {\\"complete\\": boolean, \\"missing\\": [string]}\',\n' +
        "    {\n" +
        "      label: 'check-complete-' + round,\n" +
        "      schema: { type: 'object', properties: { complete: { type: 'boolean' }, missing: { type: 'array', items: { type: 'string' } } }, required: ['complete', 'missing'] }\n" +
        "    }\n" +
        "  )\n" +
        "  if (review && review.complete) {\n" +
        "    complete = true\n" +
        "    log('Tests complete after round ' + round)\n" +
        "  } else if (review && review.missing && review.missing.length > 0) {\n" +
        "    log('Round ' + round + ': missing ' + review.missing.length + ' scenarios')\n" +
        "    await agent('Add test cases for these missing scenarios to tests/stringUtils.test.js: ' + JSON.stringify(review.missing), { label: 'supplement-' + round })\n" +
        "  } else {\n" +
        "    log('Round ' + round + ': review returned unexpected format, assuming complete')\n" +
        "    complete = true\n" +
        "  }\n" +
        "}\n\n" +
        // Phase 3: Fix loop (while + if/else + schema)
        "phase('Fix')\n" +
        "let allPass = false\n" +
        "let fixRound = 0\n" +
        "const MAX_FIX = 4\n" +
        "while (!allPass && fixRound < MAX_FIX) {\n" +
        "  fixRound++\n" +
        "  const result = await agent(\n" +
        '    \'Run the tests with: npx vitest run tests/stringUtils.test.js --reporter=verbose. Report the results as JSON: {\\"passed\\": boolean, \\"failures\\": [string]}\',\n' +
        "    {\n" +
        "      label: 'run-tests-' + fixRound,\n" +
        "      schema: { type: 'object', properties: { passed: { type: 'boolean' }, failures: { type: 'array', items: { type: 'string' } } }, required: ['passed', 'failures'] }\n" +
        "    }\n" +
        "  )\n" +
        "  if (result && result.passed) {\n" +
        "    allPass = true\n" +
        "    log('All tests pass after ' + fixRound + ' round(s)!')\n" +
        "  } else if (result && result.failures && result.failures.length > 0) {\n" +
        "    log('Round ' + fixRound + ': ' + result.failures.length + ' test(s) failing')\n" +
        "    await agent('Fix the code in src/stringUtils.js to make these tests pass. Do NOT modify tests. Failures:\\n' + JSON.stringify(result.failures), { label: 'fix-' + fixRound })\n" +
        "  } else {\n" +
        "    log('Round ' + fixRound + ': unexpected format, attempting fix')\n" +
        "    await agent('Read tests/stringUtils.test.js and src/stringUtils.js, fix the implementation so all tests pass. Do NOT modify tests.', { label: 'fix-fallback-' + fixRound })\n" +
        "  }\n" +
        "}\n\n" +
        "if (!allPass) { log('WARNING: not all tests pass after ' + MAX_FIX + ' rounds') }\n" +
        "return { allPass, complete }",
    );

    // Poll for workflow completion
    console.log("\n--- Waiting for workflow to complete ---\n");
    let run: import("../src/workflow/types.js").WorkflowRun | undefined;
    for (let i = 0; i < 30; i++) {
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

    // Print results
    if (run) {
      console.log("\n--- Workflow Result ---");
      console.log(`  Status: ${run.status}`);
      console.log(`  Agents: ${run.totalAgents}`);
      console.log(`  Tokens: ${(run.totalTokens / 1000).toFixed(1)}k`);
      for (const p of run.phases) {
        console.log(
          `  Phase "${p.title}": ${p.agentCount} agents, ${p.tokens} tokens`,
        );
      }
      if (run.error) console.log(`  Error: ${run.error}`);

      // Verify final state
      console.log("\n--- Final Code ---");
      const code = await fs.readFile(
        path.join(tempDir, "src", "stringUtils.js"),
        "utf-8",
      );
      console.log(code);
    } else {
      console.log("Workflow did not complete within 150s");
    }
  } catch (error) {
    console.error("Error:", error);
  } finally {
    await agent.destroy();
    await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
    process.exit(0);
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
