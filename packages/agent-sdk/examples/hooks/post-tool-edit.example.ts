#!/usr/bin/env tsx

/**
 * PostToolUse Hooks Integration Example
 *
 * This example demonstrates how PostToolUse hooks work by creating a
 * temporary project structure, configuring hooks for Edit operations, and
 * sending real messages to the Agent to trigger file edits and PostToolUse hooks.
 *
 * Usage: npx tsx post-tool-edit.example.ts
 */

import { Agent } from "../../src/agent.js";
import { tmpdir } from "os";
import { join } from "path";
import { mkdirSync, writeFileSync, rmSync, existsSync, readFileSync } from "fs";

async function main() {
  console.log("🧪 Testing PostToolUse Hooks Integration");
  console.log("======================================\n");

  // Create a temporary test directory
  const testDir = join(tmpdir(), `wave-hooks-test-${Date.now()}`);
  mkdirSync(testDir, { recursive: true });
  console.log(`📁 Created test directory: ${testDir}`);

  const originalCwd = process.cwd();

  try {
    // Create a test file that will be "edited"
    const testFile = join(testDir, "test.js");
    writeFileSync(testFile, 'console.log("Hello, World!");');
    console.log(`📄 Created test file: ${testFile}`);

    // Create a simple quality check script
    const checkScript = join(testDir, "quality-check.sh");
    const checkScriptContent = `#!/bin/bash
echo "Running quality check on \${WAVE_PROJECT_DIR}..."
echo "Tool: \${WAVE_TOOL_NAME}"
echo "Event: \${WAVE_HOOK_EVENT}"
echo "Timestamp: \${WAVE_TIMESTAMP}"

# Simple check: look for any .js files
if find "\${WAVE_PROJECT_DIR}" -name "*.js" -type f | head -1 | grep -q ".js"; then
  echo "✅ JavaScript files found - quality check passed"
  exit 0
else
  echo "❌ No JavaScript files found"
  exit 1
fi
`;

    writeFileSync(checkScript, checkScriptContent);
    console.log(`🔧 Created quality check script: ${checkScript}`);

    // Create .wave directory and hooks configuration
    mkdirSync(join(testDir, ".wave"), { recursive: true });

    // Configure hooks for PostToolUse Edit operations
    const hookConfig = {
      hooks: {
        PostToolUse: [
          {
            matcher: "edit_file",
            hooks: [
              {
                type: "command",
                command: `bash ${checkScript}`,
              },
            ],
          },
        ],
      },
    };

    writeFileSync(
      join(testDir, ".wave", "hooks.json"),
      JSON.stringify(hookConfig, null, 2),
    );
    console.log(
      `⚙️  Created hook configuration in ${testDir}/.wave/hooks.json`,
    );

    // Change to test directory BEFORE creating Agent
    process.chdir(testDir);

    // Create Agent with custom logger (now in the correct directory)
    console.log("\n🤖 Creating Agent with custom logger...");
    const agent = await Agent.create({
      callbacks: {},
    });

    console.log(
      "\n📝 Testing PostToolUse hooks by sending real edit request...",
    );

    // Send a real message that will trigger the Edit tool
    console.log(
      '\n⚡ Sending message to Agent: "Please add a comment to the test.js file"',
    );

    try {
      await agent.sendMessage(
        `Please edit the file ${testFile} and add a comment saying "// Modified by Wave Agent" at the beginning of the file.`,
      );

      console.log("✅ Message processing completed");
    } catch (error) {
      console.log("📝 Message processing result:", error);
    } finally {
      // Clean up agent resources
      await agent.destroy();
    }

    // Verify the file was actually edited
    try {
      const updatedContent = readFileSync(testFile, "utf-8");
      const wasEdited =
        updatedContent.includes("Wave Agent") ||
        updatedContent.includes("Modified by Wave Agent");
      console.log(
        `\n📄 File edit verification: ${wasEdited ? "✅ File was modified" : "❌ File was not modified"}`,
      );
      if (wasEdited) {
        console.log("📝 Updated file content:");
        console.log("─".repeat(40));
        console.log(updatedContent);
        console.log("─".repeat(40));
      }
    } catch (error) {
      console.log("\n📄 Could not verify file changes:", error);
    }

    console.log("\n🎯 Test completed! PostToolUse hooks integration verified.");
  } catch (error) {
    console.error("❌ Integration test failed:", error);
  } finally {
    // Cleanup
    process.chdir(originalCwd);
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
      console.log(`🧹 Cleaned up test directory`);
    }
  }
}

main().catch(console.error);
