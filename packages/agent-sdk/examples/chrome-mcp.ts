#!/usr/bin/env tsx

import fs from "fs/promises";
import path from "path";
import os from "os";
import { Agent } from "../src/agent.js";

console.log("🌐 Testing Chrome MCP screenshot functionality...\n");

let tempDir: string;
let agent: Agent;

process.env.AIGW_MODEL = "gemini-2.5-flash";

async function setupTest() {
  // Create temporary directory
  tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "chrome-mcp-test-"));
  console.log(`📁 Created temporary directory: ${tempDir}`);

  // Chrome MCP configuration
  const mcpConfig = {
    mcpServers: {
      "chrome-devtools": {
        command: "npx",
        args: ["chrome-devtools-mcp@latest"],
      },
    },
  };

  // Create .mcp.json config file
  const configPath = path.join(tempDir, ".mcp.json");
  await fs.writeFile(configPath, JSON.stringify(mcpConfig, null, 2));
  console.log(`⚙️ Created MCP config: ${configPath}`);

  // Create AI Manager with comprehensive callbacks and workdir
  agent = await Agent.create({
    workdir: tempDir, // Use workdir parameter instead of process.chdir
    callbacks: {
      // Incremental callback
      onUserMessageAdded: (params) => {
        console.log(`👤 User message: "${params.content}"`);
      },
      onAssistantMessageAdded: () => {
        console.log("🤖 Assistant message started");
      },
      onToolBlockUpdated: (params) => {
        const status = params.isRunning
          ? "running"
          : params.success
            ? "success"
            : "failed";
        console.log(`🔧 Tool ${params.name || params.id}: ${status}`);
        if (params.result && !params.isRunning) {
          const preview = (params.shortResult || params.result)
            .slice(0, 200)
            .replace(/\n/g, "\\n");
          console.log(
            `   Result: "${preview}${params.result.length > 200 ? "..." : ""}"`,
          );
        }
        if (params.error) {
          console.log(`   ❌ Error: ${params.error}`);
        }
      },
      onErrorBlockAdded: (error: string) => {
        console.log(`❌ Error block: ${error}`);
      },
    },
  });

  console.log("🔗 MCP servers initialization completed");
}

async function runTest() {
  // Send message: let AI visit example.com and summarize
  const userMessage =
    "Please visit the example.com website, get the page content and summarize the information on this page. No screenshot needed.";
  console.log(`\n💬 Sending message: ${userMessage}\n`);

  // Use sendMessage method, avoid manual message operations
  await agent.sendMessage(userMessage);

  // Get final state and results
  console.log("\n📊 Final state:");
  console.log(`   Session ID: ${agent.sessionId}`);
  console.log(`   Messages: ${agent.messages.length}`);
  console.log(`   Total tokens: ${agent.latestTotalTokens}`);
  console.log(`   Is loading: ${agent.isLoading}`);
  console.log(`   Input history: ${agent.userInputHistory.length} entries`);
}

async function cleanup() {
  console.log("\n🧹 Cleaning up...");
  try {
    // Destroy AI Manager (includes MCP cleanup)
    if (agent) {
      await agent.destroy();
      console.log("✅ AI Manager and MCP connections cleaned up");
    }

    // Delete temporary directory
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

process.on("SIGTERM", async () => {
  console.log("\n\n🛑 Received SIGTERM, cleaning up...");
  await cleanup();
  process.exit(0);
});

// Run main function
main().catch((error) => {
  console.error("💥 Unhandled error:", error);
  process.exit(1);
});
