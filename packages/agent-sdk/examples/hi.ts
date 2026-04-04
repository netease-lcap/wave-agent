#!/usr/bin/env tsx

import { Agent } from "../src/agent.js";

// Create Agent instance
const agent = await Agent.create({
  callbacks: {
    onAssistantContentUpdated: (chunk: string) => {
      process.stdout.write(chunk);
    },
  },
});

async function main() {
  try {
    await agent.sendMessage("hi");
  } catch (error) {
    console.error("\n❌ Error occurred:", error);
  } finally {
    // Clean up resources
    console.log("\nCleaning up...");
    await agent.destroy();
    console.log("Cleanup complete.");
  }
}

// Handle process exit
process.on("SIGINT", async () => {
  await agent.destroy();
  process.exit(0);
});

process.on("SIGTERM", async () => {
  await agent.destroy();
  process.exit(0);
});

// Run main function
main().catch((error) => {
  console.error("💥 Unhandled error:", error);
  process.exit(1);
});
