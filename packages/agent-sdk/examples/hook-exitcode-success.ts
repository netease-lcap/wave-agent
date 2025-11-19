#!/usr/bin/env tsx
/**
 * Hook Exit Code Success Example
 *
 * This example demonstrates successful hook execution with exit code 0.
 * Shows the difference between UserPromptSubmit (stdout captured) and
 * other hooks (stdout ignored).
 *
 * Key behaviors tested:
 * - Exit code 0 = success
 * - UserPromptSubmit: stdout is injected into agent context
 * - Other hooks: stdout is ignored
 * - All hooks: stderr is ignored on success
 *
 * Run with: pnpm tsx examples/hook-exitcode-success.ts
 */

import { Agent } from "../src/agent.js";
import { promises as fs } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { randomUUID } from "crypto";

/**
 * Create hooks that return exit code 0 with different outputs
 */
async function setupSuccessHooks(): Promise<{
  hookDir: string;
  cleanup: () => Promise<void>;
}> {
  const hookDir = join(tmpdir(), `wave-hook-success-${randomUUID()}`);
  await fs.mkdir(hookDir, { recursive: true });

  // Create .wave subdirectory
  const waveDir = join(hookDir, ".wave");
  await fs.mkdir(waveDir, { recursive: true });

  // Create hook configuration with success hooks
  const hookConfig = {
    hooks: {
      // UserPromptSubmit hook that outputs to stdout (should be captured)
      UserPromptSubmit: [
        {
          hooks: [
            {
              type: "command",
              command: `echo "CONTEXT: Additional context from UserPromptSubmit hook" && exit 0`,
            },
          ],
        },
      ],
      // PreToolUse hook that outputs to stdout (should be ignored)
      PreToolUse: [
        {
          matcher: "bash",
          hooks: [
            {
              type: "command",
              command: `echo "This stdout should be ignored" && exit 0`,
            },
          ],
        },
      ],
      // PostToolUse hook that outputs to stdout and stderr (both should be ignored)
      PostToolUse: [
        {
          matcher: "bash",
          hooks: [
            {
              type: "command",
              command: `echo "Stdout from PostToolUse" && echo "Stderr from PostToolUse" >&2 && exit 0`,
            },
          ],
        },
      ],
    },
  };

  const configPath = join(waveDir, "settings.json");
  await fs.writeFile(configPath, JSON.stringify(hookConfig, null, 2));

  console.log(`Created success hook configuration: ${configPath}`);

  const cleanup = async () => {
    try {
      await fs.rm(hookDir, { recursive: true, force: true });
    } catch (error) {
      console.warn(`Failed to cleanup: ${error}`);
    }
  };

  return { hookDir, cleanup };
}

/**
 * Analyze agent messages to verify success behavior
 */
function analyzeSuccessBehavior(agent: Agent): void {
  console.log("--- Analyzing Agent Messages ---");

  const messages = agent.messages;
  console.log(`Total messages: ${messages.length}`);

  // Look for UserPromptSubmit stdout injection
  const userMessages = messages.filter((msg) => msg.role === "user");
  console.log(`User messages: ${userMessages.length}`);

  if (userMessages.length >= 2) {
    const originalPromptBlock = userMessages[0]?.blocks.find(
      (block) => block.type === "text",
    );
    const contextInjectionBlock = userMessages[1]?.blocks.find(
      (block) => block.type === "text",
    );

    const originalPrompt =
      originalPromptBlock?.type === "text" ? originalPromptBlock.content : "";
    const contextInjection =
      contextInjectionBlock?.type === "text"
        ? contextInjectionBlock.content
        : "";

    console.log(`Original prompt: "${originalPrompt}"`);
    console.log(`Context injection: "${contextInjection}"`);

    if (contextInjection?.includes("CONTEXT: Additional context")) {
      console.log(
        "✅ UserPromptSubmit stdout successfully injected into context",
      );
    } else {
      console.log("❌ UserPromptSubmit stdout not found in context");
    }
  }

  // Check for any error blocks (should not exist on success)
  const hasErrorBlocks = messages.some((msg) =>
    msg.blocks.some((block) => block.type === "error"),
  );

  if (hasErrorBlocks) {
    console.log("❌ Unexpected error blocks found");
  } else {
    console.log("✅ No error blocks (expected for success)");
  }
}

/**
 * Main demonstration function
 */
async function demonstrateSuccessExitCodes(): Promise<void> {
  console.log("Hook Exit Code Success Demo");
  console.log("============================\n");

  const { hookDir, cleanup } = await setupSuccessHooks();

  try {
    // Create Agent instance
    const agent = await Agent.create({
      workdir: hookDir,
      agentModel: "gemini-2.5-flash",
      logger: console,
      callbacks: {
        onAssistantContentUpdated: (chunk: string) => {
          process.stdout.write(chunk);
        },
      },
    });

    console.log(`Agent created with session ID: ${agent.sessionId}`);
    console.log(`Working directory: ${hookDir}\n`);

    // Send a message that will trigger hooks and execute a tool
    console.log("--- Testing Success Exit Codes ---");
    console.log("Sending message: 'Please run: echo hello'\n");

    await agent.sendMessage("Please run: echo hello");

    console.log("\n--- Success Test Complete ---\n");

    // Analyze the results
    analyzeSuccessBehavior(agent);

    console.log("\n✅ Success exit code demonstration complete!\n");
    console.log("Key Behaviors Demonstrated:");
    console.log("- Exit code 0 indicates success");
    console.log("- UserPromptSubmit hook stdout is captured and injected");
    console.log("- PreToolUse/PostToolUse hook stdout is ignored");
    console.log("- All hook stderr is ignored on success");
    console.log("- Normal execution continues without interruption");
  } catch (error) {
    console.error("❌ Success exit code demo failed:", error);
    process.exit(1);
  } finally {
    await cleanup();
  }
}

// Run the demonstration
demonstrateSuccessExitCodes().catch(console.error);
