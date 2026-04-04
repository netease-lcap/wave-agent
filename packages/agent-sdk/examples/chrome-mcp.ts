#!/usr/bin/env tsx

import fs from "fs/promises";
import path from "path";
import os from "os";
import { Agent } from "../src/agent.js";

console.log("🌐 Testing Chrome MCP screenshot functionality...\n");

let tempDir: string;
let agent: Agent;

process.env.WAVE_MODEL = "gemini-2.5-flash";

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
      onAssistantContentUpdated: (chunk: string) => {
        process.stdout.write(chunk);
      },
      onToolBlockUpdated: (params) => {
        if (params.stage === "start") {
          console.log("Tool started", {
            id: params.id,
            name: params.name,
          });
        }
        process.stdout.write(params.parametersChunk || "\n");
        if (params.error) {
          console.error("❌ Error:\n" + params.error);
        } else if (params.result) {
          console.log(
            "Result:\n" +
              params.result.slice(0, 200) +
              (params.result.length > 200 ? "..." : ""),
          );
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
main()
  .then(() => {
    process.exit(0);
  })
  .catch((error) => {
    console.error("💥 Unhandled error:", error);
    process.exit(1);
  });
