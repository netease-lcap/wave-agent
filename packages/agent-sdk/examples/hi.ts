#!/usr/bin/env tsx

import { Agent } from "../src/agent.js";

let streamingToolId = "";
// Create Agent instance, listen to all available callbacks
const agent = await Agent.create({
  callbacks: {
    // Incremental callback
    onUserMessageAdded: (params) => {
      console.log(`👤 User message added: "${params.content}"`);
      if (params.images && params.images.length > 0) {
        console.log(`🖼️  With ${params.images.length} images`);
      }
    },
    onAssistantMessageAdded: () => {
      console.log("Assistant message started");
    },
    onAssistantContentUpdated: (chunk: string) => {
      process.stdout.write(chunk);
    },
    onToolBlockUpdated: (params) => {
      if (params.id !== streamingToolId) {
        streamingToolId = params.id;
        console.log("Tool started", {
          id: params.id,
          name: params.name,
        });
      }
      process.stdout.write(params.parametersChunk || "\n");
      if (params.error) {
        console.error("❌ Error:\n" + params.error);
      } else if (params.result) {
        console.log("Result:\n" + params.result);
      }
    },
    onDiffBlockAdded: (filePath: string) => {
      console.log(`📄 Diff block added for: ${filePath}`);
    },
    onErrorBlockAdded: (error: string) => {
      console.log(`❌ Error block added: ${error}`);
    },
    onCompressBlockAdded: (insertIndex: number, content: string) => {
      console.log(
        `🗜️  Compress block added at index ${insertIndex} (${content.length} chars)`,
      );
    },
    onMemoryBlockAdded: (
      content: string,
      success: boolean,
      type: "project" | "user",
      storagePath: string,
    ) => {
      console.log(
        `🧠 Memory ${type} ${success ? "saved" : "failed"} at ${storagePath}: ${content}`,
      );
    },

    // Messages change callback - triggered when message list changes
    // This callback can be used to update UI in real-time in frontend frameworks
    // Example: React: setMessages(messages)
    // onMessagesChange: (messages) => {
    //   console.log(`📋 Messages updated: ${messages.length} total messages`);
    // },
  },
});

async function main() {
  // agent is already created at the top level
  try {
    await agent.sendMessage("hi, demo LS tool");

    // Get current state
    console.log("\n📊 Final state:");
    console.log(`   Session ID: ${agent.sessionId}`);
    console.log(`   Messages: ${agent.messages.length}`);
    console.log(`   Total tokens: ${agent.latestTotalTokens}`);
    console.log(`   Is loading: ${agent.isLoading}`);
    console.log(`   Input history: ${agent.userInputHistory.length} entries`);
  } catch (error) {
    console.error("❌ Error occurred:", error);
  } finally {
    // Clean up resources
    console.log("\n🧹 Cleaning up...");
    await agent.destroy();
    console.log("👋 Done!");
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
