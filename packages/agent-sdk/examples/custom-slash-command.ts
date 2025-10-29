#!/usr/bin/env tsx

/**
 * Custom Slash Command Example
 *
 * Demonstrates creating and using a custom slash command with the agent.
 */

import { Agent } from "../src/agent.js";
import { tmpdir } from "os";
import { join } from "path";
import { mkdir, writeFile, rm } from "fs/promises";

const tempDir = join(tmpdir(), `custom-command-demo-${Date.now()}`);

console.log("🚀 Custom Slash Command Example");

// Setup temp project with custom command
await mkdir(join(tempDir, ".wave", "commands"), { recursive: true });

// Create a simple custom command
await writeFile(
  join(tempDir, ".wave", "commands", "project-info.md"),
  `---
name: project-info  
description: Show project info quickly
---

# Project Info Command

Read package.json and show: "Project: [name] - [description]"
`,
);

// Create sample project
await writeFile(
  join(tempDir, "package.json"),
  JSON.stringify({ name: "demo-app", description: "Sample project" }, null, 2),
);

// Change to temp directory and create agent
process.chdir(tempDir);

const agent = await Agent.create({
  callbacks: {
    onCustomCommandAdded: (commandName, content, originalInput) => {
      console.log(`⚡ Custom command triggered: ${commandName}`);
      console.log(`📝 Content: ${content}`);
      if (originalInput) console.log(`🔤 Original input: ${originalInput}`);
    },
    onAssistantMessageAdded: (content) => {
      if (content) console.log("🤖", content);
    },
    onToolBlockUpdated: (params) => {
      if (params.result) console.log(`🔧 ${params.name}:`, params.result);
    },
  },
});

async function main() {
  try {
    console.log("\n💬 Using slash command /project-info...");
    await agent.sendMessage("/project-info");

    console.log(`\n✅ Done! Messages: ${agent.messages.length}`);
  } catch (error) {
    console.error("❌ Error:", error);
  } finally {
    await agent.destroy();
    await rm(tempDir, { recursive: true, force: true });
    console.log("🧹 Cleaned up");
  }
}

// Handle cleanup on exit
process.on("SIGINT", async () => {
  await agent.destroy();
  await rm(tempDir, { recursive: true, force: true });
  process.exit(0);
});

main().catch(console.error);
