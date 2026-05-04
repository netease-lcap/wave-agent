#!/usr/bin/env tsx

import fs from "fs/promises";
import path from "path";
import os from "os";
import { Agent } from "../src/agent.js";

console.log("🌐 Testing WebFetch Tool - Example...\n");

let tempDir: string;
let agent: Agent;

// Use WAVE_FAST_MODEL for cheaper and faster testing
process.env.WAVE_MODEL = process.env.WAVE_FAST_MODEL;

async function setupTest() {
  // Create temporary directory
  tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "web-fetch-example-"));
  console.log(`📁 Created temporary directory: ${tempDir}`);

  // Create Agent
  agent = await Agent.create({
    workdir: tempDir,
    callbacks: {
      onUserMessageAdded: (params) => {
        console.log(`👤 User: "${params.content}"`);
      },
      onAssistantMessageAdded: () => {
        console.log("\n🤖 Assistant:");
      },
      onAssistantContentUpdated: (chunk: string) => {
        process.stdout.write(chunk);
      },
      onToolBlockUpdated: (params) => {
        if (params.stage === "start") {
          console.log(`\n🔧 Calling tool ${params.name}...`);
        } else if (params.stage === "end") {
          if (params.success) {
            console.log(`\n✅ Tool ${params.name} succeeded`);
          } else {
            console.log(`\n❌ Tool ${params.name} failed: ${params.error}`);
          }
        }
      },
    },
  });
}

async function runTest() {
  console.log(`\n💬 Fetching example.com and asking for a summary...`);

  try {
    // We use a real URL that is likely to be stable
    await agent.sendMessage(
      "Use the WebFetch tool to fetch https://example.com and tell me what the page is about.",
    );
  } catch (error) {
    console.error("❌ Error during message sending:", error);
  }

  console.log(`\n\n💬 Testing GitHub URL handling (should suggest gh CLI)...`);
  try {
    await agent.sendMessage(
      "Try to fetch https://github.com/netease-lcap/wave-agent using WebFetch.",
    );
  } catch (error) {
    console.error("❌ Error during message sending:", error);
  }
}

async function cleanup() {
  console.log("\n🧹 Cleaning up...");
  try {
    if (agent) {
      await agent.destroy();
      console.log("✅ Agent cleaned up");
    }

    if (tempDir) {
      await fs.rm(tempDir, { recursive: true, force: true });
      console.log(`🗑️ Cleaned up temporary directory: ${tempDir}`);
    }
  } catch (cleanupError) {
    console.error("❌ Cleanup failed:", cleanupError);
  }
}

async function main() {
  try {
    await setupTest();
    await runTest();
  } catch (error) {
    console.error("❌ Test failed:", error);
  } finally {
    await cleanup();
    console.log("👋 Done!");
    process.exit(0);
  }
}

// Handle process exit
process.on("SIGINT", async () => {
  console.log("\n\n🛑 Received SIGINT, cleaning up...");
  await cleanup();
  process.exit(0);
});

// Run main function
main()
  .then(() => {
    process.exit(0);
  })
  .catch((error) => {
    console.error("💥 Unhandled error:", error);
    process.exit(1);
  });
