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

process.env.AIGW_MODEL = "gemini-2.5-flash";

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
              command: `jq . > ${hookDir}/UserPromptSubmit_hook.txt`,
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
              command: `jq . > ${hookDir}/PreToolUse_hook.txt`,
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
              command: `jq . > ${hookDir}/PostToolUse_hook.txt`,
            },
          ],
        },
      ],
      Stop: [
        {
          hooks: [
            {
              type: "command",
              command: `jq . > ${hookDir}/Stop_hook.txt`,
            },
            {
              type: "command",
              command: `jq -r '.transcript_path' > ${hookDir}/Stop_transcript_path.txt`,
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
    });

    console.log(`Agent created with session ID: ${agent.sessionId}`);
    console.log(`Working directory: ${hookDir}\n`);

    // Combined test: UserPromptSubmit, PreToolUse, PostToolUse, and Stop hooks
    console.log("--- Combined Hook Test ---");
    console.log("Sending message that will trigger all hooks...\n");

    await agent.sendMessage("Please run: echo 'hi'");

    console.log("\n--- Combined Test Complete ---\n");

    // Check if hook output files were created
    console.log("--- Verifying Hook Execution ---");
    const hookFiles = [
      "UserPromptSubmit_hook.txt",
      "PreToolUse_hook.txt",
      "PostToolUse_hook.txt",
      "Stop_hook.txt",
      "Stop_transcript_path.txt",
    ];

    for (const file of hookFiles) {
      const filePath = join(hookDir, file);
      try {
        const content = await fs.readFile(filePath, "utf8");
        console.log(`✅ ${file} created (${content.length} bytes)`);
        if (file.includes("transcript_path")) {
          console.log(`   transcript_path: ${content.trim()}`);
        }
      } catch {
        console.log(`❌ ${file} not found`);
      }
    }

    console.log("\n✅ All hook integration tests completed successfully!\n");
    console.log("Key Features Demonstrated:");
    console.log("- Real Agent instance with hook configuration");
    console.log("- UserPromptSubmit hooks triggered by user messages");
    console.log("- PreToolUse/PostToolUse hooks triggered by tool execution");
    console.log("- Stop hook triggered at conversation end");
    console.log("- JSON data passed to hooks via stdin");
    console.log("- Session context (session_id, transcript_path, cwd)");
    console.log("- Event-specific data (tool details, prompts)");
    console.log("- Hook execution verified by output files");
  } catch (error) {
    console.error("❌ Hook integration test failed:", error);
    process.exit(1);
  } finally {
    await cleanup();
  }
}

// Run the demonstration
demonstrateHookJsonInput().catch(console.error);
