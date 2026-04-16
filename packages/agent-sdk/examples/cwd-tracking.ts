#!/usr/bin/env tsx

/**
 * Dynamic CWD Tracking Example
 *
 * Demonstrates that the agent's working directory is automatically updated
 * after a `cd` command via the bash tool, and that subsequent file operations
 * resolve relative paths against the new directory.
 */

import fs from "fs/promises";
import path from "path";
import os from "os";
import { Agent } from "../src/agent.js";

console.log("📁 Testing Dynamic CWD Tracking...\n");

let tempDir: string;
let agent: Agent;

async function setupTest() {
  // Create temporary directory with a subdirectory
  tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "wave-cwd-test-"));
  const subDir = path.join(tempDir, "src");
  await fs.mkdir(subDir);
  await fs.writeFile(
    path.join(tempDir, "root.txt"),
    "I am in the root directory.",
  );
  await fs.writeFile(path.join(subDir, "index.txt"), "I am in src/index.txt.");

  console.log(`📁 Created temp directory: ${tempDir}`);
  console.log(`📁 Created subdirectory: ${subDir}`);
  console.log(`📄 root.txt: "I am in the root directory."`);
  console.log(`📄 src/index.txt: "I am in src/index.txt."\n`);

  // Track workdir changes
  const workdirChanges: string[] = [];

  agent = await Agent.create({
    workdir: tempDir,
    permissionMode: "bypassPermissions",
    callbacks: {
      onWorkdirChange: (newCwd: string) => {
        console.log(`🔄 workdir changed to: ${newCwd}`);
        workdirChanges.push(newCwd);
      },
      onToolBlockUpdated: (params) => {
        if (params.stage === "running") {
          console.log(`🔧 Running: ${params.name}`);
        } else if (params.stage === "end") {
          console.log(
            `✅ ${params.name} completed (success: ${params.success})`,
          );
          if (params.result) {
            const preview =
              params.result.length > 100
                ? params.result.substring(0, 100) + "..."
                : params.result;
            console.log(`   Result: ${preview}`);
          }
          if (params.error) {
            console.log(`   Error: ${params.error}`);
          }
        }
      },
      onAssistantContentUpdated: (chunk: string) => {
        process.stdout.write(chunk);
      },
    },
    logger: {
      debug: () => {},
      info: () => {},
      warn: () => {},
      error: (msg) => console.error(`❌ ${msg}`),
    },
  });

  console.log(
    `\n🤖 Agent created, initial workdir: ${agent.workingDirectory}\n`,
  );
}

async function runTests() {
  console.log(`\n=== Test 1: cd command changes workdir ===`);
  console.log(`Current workdir: ${agent.workingDirectory}`);

  await agent.sendMessage(
    "Run the command: cd src. Just execute it, no other commands.",
  );

  console.log(`After cd src, workdir: ${agent.workingDirectory}`);
  const endsWithSrc = agent.workingDirectory.endsWith("src");
  console.log(
    `✅ Test 1 ${endsWithSrc ? "PASSED" : "FAILED"}: workdir ${endsWithSrc ? "changed to src" : "did NOT change to src"}\n`,
  );

  console.log(`\n=== Test 2: Read resolves relative to new workdir ===`);
  await agent.sendMessage('Read the file "index.txt" using the Read tool.');

  // Search ALL assistant messages for a successful Read tool block
  const messages = agent.messages;
  const allAssistantMsgs = messages.filter((m) => m.role === "assistant");
  let readSuccess = false;
  for (const msg of allAssistantMsgs) {
    const toolBlocks = msg.blocks.filter((b) => b.type === "tool");
    for (const block of toolBlocks) {
      if (block.name === "Read" && block.success === true) {
        readSuccess = true;
        break;
      }
    }
    if (readSuccess) break;
  }
  console.log(
    `✅ Test 2 ${readSuccess ? "PASSED" : "FAILED"}: Read tool ${readSuccess ? "found index.txt in src/" : "failed to find index.txt"}\n`,
  );

  console.log(`\n=== Test 3: Failed cd does NOT change workdir ===`);
  const prevWorkdir = agent.workingDirectory;
  await agent.sendMessage(
    "Run the command: cd nonexistent-directory-that-does-not-exist. Just execute it.",
  );
  const stillSame = agent.workingDirectory === prevWorkdir;
  console.log(`After failed cd, workdir: ${agent.workingDirectory}`);
  console.log(
    `✅ Test 3 ${stillSame ? "PASSED" : "FAILED"}: workdir ${stillSame ? "did NOT change" : "changed unexpectedly"}\n`,
  );

  console.log(`\n=== Test 4: Background cd does NOT change workdir ===`);
  const bgWorkdirBefore = agent.workingDirectory;
  await agent.sendMessage(
    'Run "cd src" in the background using run_in_background=true.',
  );
  const bgWorkdirAfter = agent.workingDirectory;
  const bgUnchanged = bgWorkdirBefore === bgWorkdirAfter;
  console.log(
    `✅ Test 4 ${bgUnchanged ? "PASSED" : "FAILED"}: background cd ${bgUnchanged ? "did NOT change workdir" : "changed workdir unexpectedly"}\n`,
  );
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
      console.log(`🗑️ Cleaned up temp directory`);
    }
  } catch (cleanupError) {
    console.error("❌ Cleanup failed:", cleanupError);
  }
}

async function main() {
  try {
    await setupTest();
    await runTests();

    console.log("\n🎉 CWD TRACKING TEST SUMMARY:");
  } catch (error) {
    console.error("❌ Test failed:", error);
  } finally {
    await cleanup();
    console.log("👋 Done!");
    process.exit(0);
  }
}

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

// Timeout guard
setTimeout(async () => {
  console.log("\n⏰ Test timeout, cleaning up...");
  await cleanup();
  process.exit(0);
}, 60000);

main();
