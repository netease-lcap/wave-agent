#!/usr/bin/env tsx

/**
 * Deep-research skill verification — tests the built-in deep-research
 * skill workflow script end-to-end with the new workflow architecture.
 *
 * Uses WAVE_FAST_MODEL for cheaper/faster testing if set.
 */

import fs from "fs/promises";
import fspath from "path";
import os from "os";
import { Agent } from "../src/agent.js";

async function main() {
  const tempDir = await fs.mkdtemp(
    fspath.join(os.tmpdir(), "wave-deep-research-"),
  );
  console.log(`Temp project: ${tempDir}`);

  await fs.mkdir(fspath.join(tempDir, "src"), { recursive: true });
  await fs.writeFile(
    fspath.join(tempDir, "README.md"),
    "# Test\nA project for deep-research testing.\n",
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

    // The deep-research skill script (from builtin/skills/deep-research/SKILL.md)
    // Simplified to 3 phases for faster testing
    const script = [
      "export const meta = {",
      "  name: 'deep-research',",
      "  description: 'Deep research harness — fan-out web searches, fetch sources, adversarially verify claims, synthesize a cited report',",
      "  phases: [",
      "    { title: 'Scope', detail: 'decompose question into 3 search angles' },",
      "    { title: 'Search', detail: '3 parallel web searches' },",
      "    { title: 'Synthesize', detail: 'merge and synthesize' },",
      "  ],",
      "}",
      "",
      "const question = args",
      "",
      "phase('Scope')",
      "const angles = await agent(",
      "  'Decompose this research question into exactly 3 distinct search angles: \"' + question + '\"\\n\\nReturn a JSON array of 3 short angle labels.',",
      "  { label: 'scope', phase: 'Scope' }",
      ")",
      "const angleList = (() => {",
      "  try {",
      "    const match = String(angles).match(/\\[[\\s\\S]*\\]/)",
      "    return match ? JSON.parse(match[0]) : ['overview', 'technical details', 'recent developments']",
      "  } catch { return ['overview', 'technical details', 'recent developments'] }",
      "})()",
      "",
      "phase('Search')",
      "const searches = await parallel(angleList.map(angle => () =>",
      "  agent('Search for information about: \"' + question + '\" — focus on ' + angle + '. Return key findings.', {",
      "    label: 'search:' + angle,",
      "    phase: 'Search'",
      "  })",
      "))",
      "",
      "phase('Synthesize')",
      "const report = await agent(",
      "  'Synthesize a brief report answering: \"' + question + '\".\\n\\nSearch results:\\n' + searches.filter(Boolean).join('\\n'),",
      "  { label: 'synthesize', phase: 'Synthesize' }",
      ")",
      "",
      "return report",
    ].join("\n");

    console.log("\n=== Running deep-research workflow ===\n");

    const run = await workflowManager.createRun(
      script,
      "What is WebAssembly and why does it matter?",
    );
    const runId = run.runId;
    console.log(`  Created run: ${runId}`);
    await workflowManager.startRun(runId);

    // Wait for completion
    for (let i = 0; i < 48; i++) {
      await new Promise((r) => setTimeout(r, 5000));
      const current = workflowManager.getRun(runId);
      if (current && current.status !== "running") {
        console.log(`\n  Completed: ${current.status}`);
        break;
      }
      if (i % 4 === 0) {
        console.log(
          `  polling: ${runId} status=${current?.status} agents=${current?.totalAgents} tokens=${current?.totalTokens}`,
        );
      }
    }

    const finalRun = workflowManager.getRun(runId);
    if (!finalRun) {
      console.log("  FAIL: Run not found");
      process.exit(1);
    }

    console.log("\n=== Results ===\n");
    console.log(`  Status: ${finalRun.status}`);
    console.log(`  Agents: ${finalRun.totalAgents}`);
    console.log(`  Tokens: ${(finalRun.totalTokens / 1000).toFixed(1)}k`);
    console.log(`  Phases:`);
    for (const p of finalRun.phases) {
      console.log(
        `    "${p.title}": ${p.agentCount} agents, ${p.tokens} tokens, ${Math.round(p.elapsed / 1000)}s`,
      );
    }
    if (finalRun.error) console.log(`  Error: ${finalRun.error}`);

    // Verify directory structure
    const scriptDir = fspath.dirname(finalRun.scriptPath);
    const journalPath = fspath.join(scriptDir, "journal.jsonl");
    const agentsDir = fspath.join(scriptDir, "agents");
    const runStatePath = fspath.join(scriptDir, "run-state.json");

    console.log("\n=== Verification ===\n");

    const journalExists = await fs
      .access(journalPath)
      .then(() => true)
      .catch(() => false);
    const agentsDirExists = await fs
      .access(agentsDir)
      .then(() => true)
      .catch(() => false);
    const runStateExists = await fs
      .access(runStatePath)
      .then(() => true)
      .catch(() => false);

    console.log(`  journal.jsonl exists: ${journalExists}`);
    console.log(`  agents/ directory exists: ${agentsDirExists}`);
    console.log(`  run-state.json exists: ${runStateExists}`);

    if (agentsDirExists) {
      const metaFiles = (await fs.readdir(agentsDir)).filter((f) =>
        f.endsWith(".meta.json"),
      );
      console.log(`  Agent sidecars: ${metaFiles.length} files`);
      for (const f of metaFiles) {
        const meta = JSON.parse(
          await fs.readFile(fspath.join(agentsDir, f), "utf-8"),
        );
        console.log(
          `    ${f}: agentType=${meta.agentType} label=${meta.label || "(none)"} subagentId=${meta.subagentId?.slice(0, 8)}...`,
        );
      }
    }

    if (journalExists) {
      const journalContent = await fs.readFile(journalPath, "utf-8");
      const entries = journalContent
        .split("\n")
        .filter((l) => l.trim())
        .map((l) => JSON.parse(l));
      const agentEntries = entries.filter(
        (e: Record<string, unknown>) => "agentIndex" in e && !("type" in e),
      );
      const hasSubagentId = agentEntries.every(
        (e: Record<string, unknown>) =>
          typeof e.subagentId === "string" &&
          (e.subagentId as string).length > 0,
      );
      const hasTranscriptPath = agentEntries.every(
        (e: Record<string, unknown>) => typeof e.transcriptPath === "string",
      );
      console.log(
        `  Journal entries: ${entries.length} (${agentEntries.length} agent)`,
      );
      console.log(`  All agent entries have subagentId: ${hasSubagentId}`);
      console.log(
        `  All agent entries have transcriptPath: ${hasTranscriptPath}`,
      );
    }

    // Check parallel() worked — Search phase should have 3 agents
    const searchPhase = finalRun.phases.find(
      (p: import("../src/workflow/types.js").WorkflowPhaseState) =>
        p.title === "Search",
    );
    if (searchPhase) {
      console.log(
        `  Search phase agents: ${searchPhase.agentCount} (expected 3 from parallel)`,
      );
    }

    const passed =
      finalRun.status === "completed" &&
      journalExists &&
      agentsDirExists &&
      runStateExists;

    console.log(`\n  Overall: ${passed ? "PASS" : "FAIL"}`);
  } catch (error) {
    console.error("Error:", error);
  } finally {
    await agent.destroy();
    await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
    process.exit(0);
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
