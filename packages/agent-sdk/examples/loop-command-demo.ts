import { Agent } from "../src/agent.js";

/**
 * This example demonstrates how to use the /loop slash command
 * to schedule recurring tasks.
 *
 * To run this example:
 * 1. Ensure you have a valid WAVE_API_KEY environment variable set.
 * 2. Run: cd packages/agent-sdk && pnpm exec tsx examples/loop-command-demo.ts
 */
async function main() {
  // 1. Create Agent instance
  const agent = await Agent.create({
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
  }
}

main().catch(console.error);
