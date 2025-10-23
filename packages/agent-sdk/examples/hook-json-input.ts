#!/usr/bin/env tsx
/**
 * Hook JSON Input Support - Integration Example
 *
 * This example demonstrates the JSON input feature for Wave Agent hooks.
 * It creates a real Agent instance and sends messages to trigger hooks.
 *
 * Run with: pnpm tsx examples/hook-json-input.ts
 */

import { Agent } from "../src/agent.js";
import { promises as fs } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { randomUUID } from "crypto";

/**
 * Create a temporary hook configuration and script
 */
async function setupTestHooks(): Promise<{
  hookDir: string;
  cleanup: () => Promise<void>;
}> {
  const hookDir = join(tmpdir(), `wave-hook-test-${randomUUID()}`);
  await fs.mkdir(hookDir, { recursive: true });

  // Create .wave subdirectory
  const waveDir = join(hookDir, ".wave");
  await fs.mkdir(waveDir, { recursive: true });

  // Create hook configuration
  const hookConfig = {
    hooks: {
      UserPromptSubmit: [
        {
          hooks: [
            {
              type: "command",
              command: "jq .",
            },
          ],
        },
      ],
      PreToolUse: [
        {
          matcher: "bash",
          hooks: [
            {
              type: "command",
              command: "jq .",
            },
          ],
        },
      ],
      PostToolUse: [
        {
          matcher: "bash",
          hooks: [
            {
              type: "command",
              command: "jq .",
            },
          ],
        },
      ],
    },
  };

  const configPath = join(waveDir, "hooks.json");
  await fs.writeFile(configPath, JSON.stringify(hookConfig, null, 2));

  console.log(`Created hook configuration: ${configPath}`);

  const cleanup = async () => {
    try {
      await fs.rm(hookDir, { recursive: true, force: true });
      console.log(`Cleaned up: ${hookDir}`);
    } catch (error) {
      console.warn(`Failed to cleanup: ${error}`);
    }
  };

  return { hookDir, cleanup };
}

/**
 * Main demonstration function
 */
async function demonstrateHookJsonInput(): Promise<void> {
  console.log("Wave Agent Hook JSON Input - Real Integration Demo");
  console.log("==================================================\n");

  const { hookDir, cleanup } = await setupTestHooks();

  try {
    // Create Agent instance with hook configuration
    const agent = await Agent.create({
      workdir: hookDir,
      logger: {
        info: (...args: unknown[]) => console.log(`[INFO]`, ...args),
        warn: (...args: unknown[]) => console.log(`[WARN]`, ...args),
        error: (...args: unknown[]) => console.log(`[ERROR]`, ...args),
        debug: (...args: unknown[]) => console.log(`[DEBUG]`, ...args),
      },
    });

    console.log(`Agent created with session ID: ${agent.sessionId}`);
    console.log(`Working directory: ${hookDir}\n`);

    // Test 1: UserPromptSubmit hook
    console.log("--- Test 1: UserPromptSubmit Hook ---");
    console.log("Sending user message to trigger UserPromptSubmit hook...\n");

    await agent.sendMessage(
      "Hello! Please help me test the hook JSON input feature.",
    );

    console.log("\n--- Test 1 Complete ---\n");

    // Test 2: PreToolUse and PostToolUse hooks
    console.log("--- Test 2: Tool Usage Hooks ---");
    console.log("Sending message that will trigger bash tool usage...\n");

    await agent.sendMessage(
      "Please run: echo 'Testing hook JSON input with bash tool'",
    );

    console.log("\n--- Test 2 Complete ---\n");

    console.log("✅ All hook integration tests completed successfully!\n");
    console.log("Key Features Demonstrated:");
    console.log("- Real Agent instance with hook configuration");
    console.log("- UserPromptSubmit hooks triggered by user messages");
    console.log("- PreToolUse/PostToolUse hooks triggered by tool execution");
    console.log("- JSON data passed to hooks via stdin");
    console.log("- Session context (session_id, transcript_path, cwd)");
    console.log("- Event-specific data (tool details, prompts)");
  } catch (error) {
    console.error("❌ Hook integration test failed:", error);
    process.exit(1);
  } finally {
    await cleanup();
  }
}

// Run the demonstration
demonstrateHookJsonInput().catch(console.error);
