#!/usr/bin/env npx tsx

/**
 * Stop Hooks Integration Example
 *
 * This example demonstrates how Stop hooks work by creating a temporary
 * project structure, configuring hooks for post-processing after AI response
 * completion, and simulating a complete AI response cycle through the Agent.
 */

import { Agent } from "../../src/agent.js";
import { mkdir, writeFile, readFile, rm } from "fs/promises";
import { join } from "path";
import { fileURLToPath } from "url";
import { dirname } from "path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

async function runStopHooksExample() {
  console.log("🧪 Testing Stop Hooks Integration\n");

  const tempDir = join(__dirname, "..", "..", "temp-stop-test");
  const hookConfigDir = join(tempDir, ".wave");
  const configFile = join(hookConfigDir, "hooks.json");
  const outputFile = join(tempDir, "stop-hook-output.txt");

  try {
    // Setup temporary directory structure
    console.log(`📁 Created test project structure in: ${tempDir}`);
    await mkdir(tempDir, { recursive: true });
    await mkdir(hookConfigDir, { recursive: true });

    // Create a simple test file for the agent to work with
    await writeFile(
      join(tempDir, "test.txt"),
      "This is a test file for Stop hook demonstration.",
    );
    await writeFile(
      join(tempDir, "README.md"),
      "# Stop Hook Test Project\n\nThis project tests Stop hooks execution after AI response completion.",
    );

    // Create hook configuration for Stop events
    const hookConfig = {
      hooks: {
        Stop: [
          {
            // Stop hooks don't use matchers - they always execute
            hooks: [
              {
                type: "command",
                command: `echo "✅ AI response cycle completed at $(date)" >> "${outputFile}"`,
              },
              {
                type: "command",
                command: `echo "📁 Project directory: $WAVE_PROJECT_DIR" >> "${outputFile}"`,
              },
              {
                type: "command",
                command: `echo "🔧 Post-processing tasks completed!" >> "${outputFile}"`,
              },
              {
                type: "command",
                command: `echo "📊 Project summary: $(find "$WAVE_PROJECT_DIR" -type f | wc -l) files found" >> "${outputFile}"`,
              },
            ],
          },
        ],
      },
    };

    await writeFile(configFile, JSON.stringify(hookConfig, null, 2));

    console.log("📋 Hook configuration:");
    console.log(
      "   - Stop hooks will execute after AI response cycle completes",
    );
    console.log("   - Hooks log completion status and project information");

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

    console.log("\n📝 Simulating AI response cycle completion...");

    // Simulate sending a message to trigger the full AI response cycle
    console.log('\n⚡ Executing: agent.sendMessage("Analyze this project")');
    await agent.sendMessage(
      "Analyze this project structure and tell me what files are present",
    );

    // Give hooks a moment to complete
    await new Promise((resolve) => setTimeout(resolve, 1000));

    // Check if Stop hooks executed by reading output file
    console.log("\n📋 Checking Stop hook execution results...");
    try {
      const hookOutput = await readFile(outputFile, "utf-8");
      console.log("\n✅ Stop hooks executed successfully!");
      console.log("Hook output:");
      console.log("─".repeat(60));
      console.log(hookOutput);
      console.log("─".repeat(60));
    } catch (error) {
      console.log(
        "\n❌ Stop hook output file not found - hooks may not have executed",
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
    console.error("\n❌ Stop hooks integration test failed:", error);
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

  console.log("\n✅ Stop hooks integration test completed");
}

// Run example if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  runStopHooksExample().catch(console.error);
}

export { runStopHooksExample };
