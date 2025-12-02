#!/usr/bin/env tsx

import { Agent } from "../src/agent.js";

// Create Agent instance with Claude model to test cache control
const agent = await Agent.create({
  // Use Claude model to enable cache control features
  agentModel: "claude-sonnet-4-20250514",

  callbacks: {
    onUsagesChange: (usages) => {
      if (usages.length > 0) {
        const latestUsage = usages[usages.length - 1];
        console.log(`\n🔍 [USAGE] Latest usage received:`);
        console.log(`   Model: ${latestUsage.model}`);
        console.log(`   Tokens: ${latestUsage.total_tokens}`);
        console.log(
          `   Cache read tokens: ${latestUsage.cache_read_input_tokens || "N/A"}`,
        );
        console.log(
          `   Cache creation tokens: ${latestUsage.cache_creation_input_tokens || "N/A"}`,
        );
        if (latestUsage.cache_creation) {
          console.log(`   Cache creation details:`, latestUsage.cache_creation);
        }
      }
    },
  },
});

async function main() {
  try {
    console.log("🚀 Testing cache control with simple message...");

    // Just one simple message to avoid the streaming output issues
    await agent.sendMessage("Hello, just say hi back");

    console.log("\n🔍 Final usage check:");
    const usages = agent.usages;
    console.log(`Total operations: ${usages.length}`);

    usages.forEach((usage, index) => {
      console.log(`\nOperation ${index + 1}:`);
      console.log(`  Model: ${usage.model}`);
      console.log(`  Tokens: ${usage.total_tokens}`);
      console.log(`  Cache read: ${usage.cache_read_input_tokens || "None"}`);
      console.log(
        `  Cache creation: ${usage.cache_creation_input_tokens || "None"}`,
      );
      if (usage.cache_creation) {
        console.log(`  Cache creation details:`, usage.cache_creation);
      }
    });
  } catch (error) {
    console.error("❌ Error occurred:", error);
  } finally {
    await agent.destroy();
    console.log("👋 Done!");
  }
}

main().catch(console.error);
