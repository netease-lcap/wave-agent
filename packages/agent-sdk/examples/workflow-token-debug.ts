#!/usr/bin/env tsx

import fs from "fs/promises";
import path from "path";
import os from "os";
import { Agent } from "../src/agent.js";

/**
 * Minimal workflow token debug — runs a 1-agent workflow,
 * then inspects every step of token tracking.
 */

async function main() {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "wave-wf-debug-"));
  await fs.writeFile(
    path.join(tempDir, "README.md"),
    "# Hello\nThis is a test project.\n",
  );

  const agent = await Agent.create({
    model: process.env.WAVE_FAST_MODEL,
    workdir: tempDir,
  });

  try {
    // Run a 1-agent workflow
    console.log("=== Sending workflow request ===\n");
    await agent.sendMessage(
      "Use the Workflow tool with this exact script:\n\n" +
        'export const meta = { name: "token-debug", description: "Debug token tracking", phases: [{ title: "Read" }] }\n\n' +
        'phase("Read")\n' +
        'const result = await agent("Read the file README.md and return its content", { phase: "Read" })\n' +
        'log("agent result length: " + String(result).length)\n' +
        "return result",
    );

    // Wait for completion
    console.log("\n=== Polling for completion ===\n");
    let run: import("../src/workflow/types.js").WorkflowRun | undefined;
    for (let i = 0; i < 24; i++) {
      await new Promise((r) => setTimeout(r, 5000));
      const runs = await agent.getWorkflowRuns();
      const latest = runs[runs.length - 1];
      if (latest) {
        console.log(
          `  ${latest.runId}: ${latest.status} | agents=${latest.totalAgents} tokens=${latest.totalTokens} phases=${JSON.stringify(latest.phases.map((p) => ({ title: p.title, agents: p.agentCount, tokens: p.tokens })))}`,
        );
      }
      if (latest && latest.status !== "running") {
        run = latest;
        break;
      }
    }

    if (!run) {
      console.log("FAIL: No completed workflow after 120s");
    } else {
      console.log("\n=== Final Result ===");
      console.log(`  status:       ${run.status}`);
      console.log(`  totalAgents:  ${run.totalAgents}`);
      console.log(`  totalTokens:  ${run.totalTokens}`);
      console.log(`  phases:`);
      for (const p of run.phases) {
        console.log(
          `    "${p.title}": agents=${p.agentCount}, tokens=${p.tokens}, elapsed=${p.elapsed}ms`,
        );
      }

      // Also check what the notification would say
      const notificationTokenDisplay = (run.totalTokens / 1000).toFixed(1);
      console.log(
        `\n  Notification would say: "${run.totalAgents} agents, ${notificationTokenDisplay}k tokens"`,
      );

      // Verdict
      if (run.totalTokens > 0) {
        console.log("\n  ✅ PASS: totalTokens > 0");
      } else {
        console.log("\n  ❌ FAIL: totalTokens is 0!");
      }
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
  process.exit(1);
});
process.on("SIGTERM", async () => {
  process.exit(1);
});

main().catch((error) => {
  console.error("Unhandled error:", error);
  process.exit(1);
});
