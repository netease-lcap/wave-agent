#!/usr/bin/env tsx

import { Agent } from "../src/agent.js";

// Demonstrate shouldDefer tool loading feature.
// Deferred tools are excluded from the API call until discovered via ToolSearch.

const agent = await Agent.create({
  permissionMode: "bypassPermissions",
  model: process.env.WAVE_FAST_MODEL,
  fastModel: process.env.WAVE_FAST_MODEL,
  callbacks: {
    onToolBlockUpdated: (params) => {
      if (params.stage === "start") {
        console.log(`[TOOL] ${params.name}`);
      }
      if (params.stage === "end") {
        const status = params.success ? "✅" : "❌";
        const short = (params.result || "").slice(0, 200);
        console.log(`${status} ${params.name}: ${short}`);
      }
    },
    onAssistantContentUpdated: (chunk: string) => {
      process.stdout.write(chunk);
    },
  },
});

async function main() {
  try {
    console.log("🚀 Asking agent to schedule a reminder...\n");
    await agent.sendMessage(
      "Remind me to check the build in 1 minute using the cron tool",
    );

    console.log("\n\n📊 Final state:");
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
