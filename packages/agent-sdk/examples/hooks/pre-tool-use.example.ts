#!/usr/bin/env npx tsx

/**
 * PreToolUse Hooks Integration Example
 *
 * This example demonstrates how PreToolUse hooks work by creating a temporary
 * project structure, configuring hooks for pre-processing before tool execution,
 * and triggering tool usage through the Agent.
 */

import { Agent } from "../../src/agent.js";
import { mkdir, writeFile, readFile, rm } from "fs/promises";
import { join } from "path";
import { fileURLToPath } from "url";
import { dirname } from "path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

async function runPreToolUseExample() {
  console.log("🧪 Testing PreToolUse Hooks Integration\n");

  const tempDir = join(__dirname, "..", "..", "temp-pretool-test");
  const hookConfigDir = join(tempDir, ".wave");
  const configFile = join(hookConfigDir, "hooks.json");
  const logFile = join(tempDir, "pretool-hook-log.txt");

  try {
    // Setup temporary directory structure
    console.log(`📁 Created test project structure in: ${tempDir}`);
    await mkdir(tempDir, { recursive: true });
    await mkdir(hookConfigDir, { recursive: true });

    // Create source files for testing Read tool
    const srcDir = join(tempDir, "src");
    await mkdir(srcDir, { recursive: true });
    await writeFile(
      join(srcDir, "example.js"),
      'console.log("Hello, World!");\n// This file will be read by the Read tool',
    );
    await writeFile(
      join(tempDir, "package.json"),
      JSON.stringify({ name: "pretool-test", version: "1.0.0" }, null, 2),
    );

    // Create hook configuration for PreToolUse events
    const hookConfig = {
      hooks: {
        PreToolUse: [
          {
            matcher: "Read", // Match only Read tool operations
            hooks: [
              {
                type: "command",
                command: `echo "🔍 About to read a file at $(date)" >> "${logFile}"`,
              },
              {
                type: "command",
                command: `echo "📁 Working in: $WAVE_PROJECT_DIR" >> "${logFile}"`,
              },
              {
                type: "command",
                command: `echo "🛠️ Tool validation passed!" >> "${logFile}"`,
              },
            ],
          },
          {
            matcher: "Write|Edit", // Match Write and Edit operations
            hooks: [
              {
                type: "command",
                command: `echo "✏️ About to modify files - backup recommended!" >> "${logFile}"`,
              },
            ],
          },
        ],
      },
    };

    await writeFile(configFile, JSON.stringify(hookConfig, null, 2));

    console.log("📋 Hook configuration:");
    console.log("   - PreToolUse hooks for Read tool (file access validation)");
    console.log("   - PreToolUse hooks for Write/Edit tools (backup reminder)");
    console.log("   - Hooks log preparation steps before tool execution");

    // Change to test directory (important for settings loading)
    const originalCwd = process.cwd();
    process.chdir(tempDir);

    // Create Agent with custom logger to capture hook execution
    console.log("\n🤖 Creating Agent with custom logger...");
    const agent = await Agent.create({
      logger: {
        info: (message, ...args) => console.log(`[INFO] ${message}`, ...args),
        warn: (message, ...args) => console.log(`[WARN] ${message}`, ...args),
        error: (message, ...args) => console.log(`[ERROR] ${message}`, ...args),
        debug: (message, ...args) => console.log(`[DEBUG] ${message}`, ...args),
      },
    });

    console.log("\n📝 Simulating tool usage to trigger PreToolUse hooks...");

    // Send a message that will likely trigger the Read tool
    console.log(
      '\n⚡ Executing: agent.sendMessage("Read the example.js file")',
    );
    await agent.sendMessage(
      "Please read the contents of src/example.js and tell me what it does",
    );

    // Give hooks a moment to complete
    await new Promise((resolve) => setTimeout(resolve, 2000));

    // Check if PreToolUse hooks executed by reading log file
    console.log("\n📋 Checking PreToolUse hook execution results...");
    try {
      const hookLog = await readFile(logFile, "utf-8");
      console.log("\n✅ PreToolUse hooks executed successfully!");
      console.log("Hook execution log:");
      console.log("─".repeat(60));
      console.log(hookLog);
      console.log("─".repeat(60));
    } catch (error) {
      console.log(
        "\n❌ PreToolUse hook log file not found - hooks may not have executed",
      );
      console.log(
        "This could happen if no Read tool was triggered by the Agent",
      );
      console.log(
        "Error:",
        error instanceof Error ? error.message : String(error),
      );
    }

    // Cleanup agent
    await agent.destroy();
    console.log("\n🧹 Agent destroyed");

    // Restore original working directory
    process.chdir(originalCwd);
  } catch (error) {
    console.error("\n❌ PreToolUse hooks integration test failed:", error);
    throw error;
  } finally {
    // Cleanup test directory
    try {
      await rm(tempDir, { recursive: true, force: true });
      console.log("🧹 Test directory cleaned up");
    } catch (cleanupError) {
      console.warn("⚠️ Failed to cleanup test directory:", cleanupError);
    }
  }

  console.log("\n✅ PreToolUse hooks integration test completed");
}

// Run example if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  runPreToolUseExample().catch(console.error);
}

export { runPreToolUseExample };
