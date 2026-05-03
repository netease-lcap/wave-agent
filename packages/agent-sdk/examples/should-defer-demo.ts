#!/usr/bin/env tsx

import { Agent } from "../src/agent.js";

// Demonstrate shouldDefer tool loading feature.
// Deferred tools are excluded from the API call until discovered via ToolSearch.

const agent = await Agent.create({
  permissionMode: "bypassPermissions",
  model: "gemini-2.5-flash",
  fastModel: "gemini-2.5-flash",
});

async function main() {
  try {
    // Ask the agent to schedule a reminder — it must discover CronCreate via ToolSearch first
    await agent.sendMessage("Remind me to check the build in 1 minute");

    console.log("\n📊 Final state:");
    console.log(`   Session ID: ${agent.sessionId}`);
    console.log(`   Messages: ${agent.messages.length}`);
  } catch (error) {
    console.error("❌ Error occurred:", error);
  } finally {
    console.log("\n🧹 Cleaning up...");
    await agent.destroy();
    process.exit(0);
  }
}

process.on("SIGINT", async () => {
  await agent.destroy();
  process.exit(0);
});

process.on("SIGTERM", async () => {
  await agent.destroy();
  process.exit(0);
});

main().catch((error) => {
  console.error("💥 Unhandled error:", error);
  process.exit(1);
});
