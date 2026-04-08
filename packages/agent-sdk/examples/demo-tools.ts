#!/usr/bin/env tsx

import { Agent } from "../src/agent.js";

// Create Agent instance, listen to all available callbacks
const agent = await Agent.create({
  permissionMode: "bypassPermissions",
  callbacks: {
    // Incremental callback
    onUserMessageAdded: (params) => {
      console.log(`👤 User message added: "${params.content}"`);
      if (params.images && params.images.length > 0) {
        console.log(`🖼️  With ${params.images.length} images`);
      }
    },
    onAssistantMessageAdded: () => {
      console.log("\nAssistant message started");
    },
    onAssistantContentUpdated: (chunk: string) => {
      process.stdout.write(chunk);
    },
    onToolBlockUpdated: (params) => {
      if (params.stage === "start") {
        console.log("\nTool started", {
          id: params.id,
          name: params.name,
        });
      }
      process.stdout.write(params.parametersChunk || "");
      if (params.error) {
        console.error("\n❌ Error:\n" + params.error);
      } else if (params.result) {
        console.log("\nResult:\n" + params.result.slice(-500));
      }
    },
    onErrorBlockAdded: (error: string) => {
      console.log(`\n❌ Error block added: ${error}`);
    },
    onCompressBlockAdded: (content: string) => {
      console.log(`\n🗜️  Compress block added (${content.length} chars)`);
    },
  },
});

async function main() {
  try {
    await agent.sendMessage("demo tools");

    // Get current state
    console.log("\n📊 Final state:");
    console.log(`   Session ID: ${agent.sessionId}`);
    console.log(`   Messages: ${agent.messages.length}`);
    console.log(`   Total tokens: ${agent.latestTotalTokens}`);
    console.log(`   Is loading: ${agent.isLoading}`);
  } catch (error) {
    console.error("❌ Error occurred:", error);
  } finally {
    // Clean up resources
    console.log("\n🧹 Cleaning up...");
    await agent.destroy();
    console.log("👋 Done!");
    process.exit(0);
  }
}

// Handle process exit
process.on("SIGINT", async () => {
  console.log("\n\n🛑 Received SIGINT, cleaning up...");
  await agent.destroy();
  process.exit(0);
});

process.on("SIGTERM", async () => {
  console.log("\n\n🛑 Received SIGTERM, cleaning up...");
  await agent.destroy();
  process.exit(0);
});

// Run main function
main().catch((error) => {
  console.error("💥 Unhandled error:", error);
  process.exit(1);
});
