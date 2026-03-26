import { Agent } from "../src/agent.js";
import { tmpdir } from "os";
import { join } from "path";
import { mkdir, rm } from "fs/promises";

/**
 * This example demonstrates how to use the /loop slash command
 * to schedule recurring tasks.
 *
 * To run this example:
 * 1. Ensure you have a valid WAVE_API_KEY environment variable set.
 * 2. Run: cd packages/agent-sdk && pnpm exec tsx examples/loop-command-demo.ts
 */
async function main() {
  const tempDir = join(tmpdir(), `loop-demo-${Date.now()}`);
  await mkdir(tempDir, { recursive: true });

  // 1. Create Agent instance
  const agent = await Agent.create({
    workdir: tempDir,
    model: "gemini-2.5-flash", // Use a supported model
    callbacks: {
      onAssistantContentUpdated: (chunk) => {
        process.stdout.write(chunk);
      },
      onToolBlockUpdated: (params) => {
        if (params.stage === "start") {
          console.log(`\n[Tool: ${params.name}]`);
        }
        if (params.result) {
          console.log(`\n[Result: ${params.result.slice(0, 100)}...]`);
        }
      },
    },
  });

  try {
    console.log("--- /loop Slash Command Demo ---\n");
    console.log(`📁 Using temporary directory: ${tempDir}\n`);

    // 2. Send a /loop command
    // The AI will parse this using the instructions in SKILL.md and call CronCreate
    console.log("Step 1: Scheduling a recurring task using /loop...");
    await agent.sendMessage("/loop 1m check the build status");
    console.log("\n");

    // 3. List active cron jobs
    console.log("Step 2: Asking agent to list all active cron jobs...");
    await agent.sendMessage("List all active cron jobs.");
    console.log("\n");

    // 4. Cancel the job
    console.log("Step 3: Asking agent to cancel the job...");
    await agent.sendMessage("Stop the loop job we just created.");
    console.log("\n");
  } catch (error) {
    console.error("❌ Error occurred:", error);
  } finally {
    // 5. Always destroy the agent to ensure the process exits
    await agent.destroy();
    await rm(tempDir, { recursive: true, force: true });
    console.log("🧹 Demo complete and temporary directory cleaned up");
  }
}

main().catch(console.error);
