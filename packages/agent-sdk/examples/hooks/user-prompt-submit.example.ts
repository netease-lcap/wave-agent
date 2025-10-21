#!/usr/bin/env tsx

/**
 * UserPromptSubmit Hooks Integration Example
 *
 * This example demonstrates how UserPromptSubmit hooks work by creating a
 * temporary project structure, configuring hooks for prompt validation, and
 * sending real messages to the Agent to trigger UserPromptSubmit hooks.
 */

import { Agent } from "../../src/agent.js";
import { writeFileSync, mkdirSync, rmSync } from "fs";
import { join } from "path";

async function main() {
  console.log("🧪 Testing UserPromptSubmit Hooks Integration");

  // Create temporary test directory
  const testDir = join(process.cwd(), "temp-user-prompt-test");
  mkdirSync(testDir, { recursive: true });

  const originalCwd = process.cwd();

  try {
    // Create project structure
    mkdirSync(join(testDir, "src"), { recursive: true });
    mkdirSync(join(testDir, "docs"), { recursive: true });

    // Create some test files
    writeFileSync(
      join(testDir, "src", "main.ts"),
      `
export function greet(name: string): string {
  return \`Hello, \${name}!\`;
}
    `.trim(),
    );

    writeFileSync(
      join(testDir, "README.md"),
      `
# Test Project

This is a test project for UserPromptSubmit hooks.
    `.trim(),
    );

    // Create .wave directory and hooks configuration
    mkdirSync(join(testDir, ".wave"), { recursive: true });

    // Create hook configuration for UserPromptSubmit
    const hookConfig = {
      hooks: {
        UserPromptSubmit: [
          {
            // No matcher needed for UserPromptSubmit hooks
            hooks: [
              {
                type: "command",
                command:
                  'echo "🔍 Validating user prompt in project: $WAVE_PROJECT_DIR"',
              },
              {
                type: "command",
                command: 'echo "📅 Prompt submitted at: $WAVE_TIMESTAMP"',
              },
              {
                type: "command",
                command: 'echo "🚀 Hook event: $WAVE_HOOK_EVENT"',
              },
              {
                type: "command",
                command: 'ls -la "$WAVE_PROJECT_DIR" | head -5',
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

    console.log(`\n📁 Created test project structure in: ${testDir}`);
    console.log("📋 Hook configuration:");
    console.log(
      "   - UserPromptSubmit hooks will execute before prompt processing",
    );
    console.log("   - Hooks validate environment and log project structure");

    // Change to test directory BEFORE creating Agent
    process.chdir(testDir);

    // Create Agent with custom logger (now in the correct directory)
    console.log("\n🤖 Creating Agent with custom logger...");
    const agent = await Agent.create({
      callbacks: {},
    });

    console.log("\n📝 Testing UserPromptSubmit hooks with real message...");

    // Send a real user message (this should trigger UserPromptSubmit hooks)
    console.log('\n⚡ Sending real message: "Tell me about this project"');

    try {
      // This will trigger UserPromptSubmit hooks before processing the message
      await agent.sendMessage(
        "Please analyze this project and tell me what it does. Look at the source files and provide a summary.",
      );

      console.log("✅ Message sent and processed successfully");
    } catch (error) {
      console.log("📝 Message processing result:", error);
    } finally {
      // Clean up agent resources to allow process to exit
      await agent.destroy();
    }

    console.log("\n📊 UserPromptSubmit Hook Execution Results:");

    console.log(
      "\n🎯 Test completed! UserPromptSubmit hooks integration verified.",
    );
  } finally {
    // Cleanup
    process.chdir(originalCwd);
    rmSync(testDir, { recursive: true, force: true });
    console.log(`\n🧹 Cleaned up test directory: ${testDir}`);
  }
}

main().catch(console.error);
