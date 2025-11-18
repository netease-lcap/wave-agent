#!/usr/bin/env tsx
/**
 * Hook Non-Blocking Error Example
 *
 * This example demonstrates non-blocking error behavior with exit codes other than 0 or 2.
 * Shows how these errors are displayed to the user while allowing execution to continue.
 *
 * Key behaviors tested:
 * - Exit codes other than 0 or 2 = non-blocking errors
 * - stderr is displayed to the user
 * - stdout is ignored (regardless of hook type)
 * - Execution continues normally after displaying the error
 *
 * Run with: pnpm tsx examples/hook-exitcode-nonblocking.ts
 */

import { Agent } from "../src/agent.js";
import { promises as fs } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { randomUUID } from "crypto";

/**
 * Create hooks that return various non-blocking exit codes
 */
async function setupNonBlockingErrorHooks(): Promise<{
  hookDir: string;
  cleanup: () => Promise<void>;
}> {
  const hookDir = join(tmpdir(), `wave-hook-nonblocking-${randomUUID()}`);
  await fs.mkdir(hookDir, { recursive: true });

  // Create .wave subdirectory
  const waveDir = join(hookDir, ".wave");
  await fs.mkdir(waveDir, { recursive: true });

  // Create hook configuration with non-blocking error hooks
  const hookConfig = {
    hooks: {
      // UserPromptSubmit hook that gives warnings but doesn't block
      UserPromptSubmit: [
        {
          hooks: [
            {
              type: "command",
              command: `
                user_message=$(jq -r '.user_prompt // ""')
                
                # Check for potentially suboptimal requests
                if echo "$user_message" | grep -i "quick\\|fast\\|hurry"; then
                  echo "WARNING: You seem to be in a hurry. Take time to review outputs carefully." >&2
                  echo "This stdout should be ignored" # This should not appear anywhere
                  exit 1
                elif echo "$user_message" | grep -i "complex\\|difficult\\|hard"; then
                  echo "INFO: Complex requests may take longer. Consider breaking them down." >&2
                  exit 3
                else
                  # Success case - no warnings needed
                  exit 0
                fi
              `,
            },
          ],
        },
      ],
      // PreToolUse hook that warns about certain commands but allows them
      PreToolUse: [
        {
          matcher: "bash",
          hooks: [
            {
              type: "command",
              command: `
                command_text=$(jq -r '.tool_input.parameters.command // ""')
                
                if echo "$command_text" | grep -i "curl\\|wget"; then
                  echo "SECURITY WARNING: Network commands detected. Ensure you trust the source." >&2
                  exit 4
                elif echo "$command_text" | grep -i "find.*-delete\\|rm"; then
                  echo "CAUTION: File deletion command detected. Double-check your paths." >&2
                  exit 5
                else
                  exit 0
                fi
              `,
            },
          ],
        },
      ],
      // PostToolUse hook that provides performance warnings
      PostToolUse: [
        {
          matcher: "bash",
          hooks: [
            {
              type: "command",
              command: `
                # Simulate checking tool execution time (in real scenario, this would be calculated)
                command_text=$(jq -r '.tool_input.parameters.command // ""')
                
                if echo "$command_text" | grep -i "find\\|locate\\|grep -r"; then
                  echo "PERFORMANCE NOTE: Search commands can be slow on large directories." >&2
                  exit 6
                elif echo "$command_text" | grep -i "sleep\\|ping.*-c.*[1-9][0-9]"; then
                  echo "TIMING WARNING: Command may have caused delays." >&2
                  exit 7
                else
                  exit 0
                fi
              `,
            },
          ],
        },
      ],
    },
  };

  const configPath = join(waveDir, "settings.json");
  await fs.writeFile(configPath, JSON.stringify(hookConfig, null, 2));

  console.log(`Created non-blocking error hook configuration: ${configPath}`);

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
 * Analyze messages to verify non-blocking behavior
 */
function analyzeNonBlockingBehavior(agent: Agent, testName: string): void {
  console.log(`--- Analyzing Non-Blocking Behavior for: ${testName} ---`);

  const messages = agent.messages;
  console.log(`Total messages: ${messages.length}`);

  // Count different message types
  const userMessages = messages.filter((msg) => msg.role === "user");
  const assistantMessages = messages.filter((msg) => msg.role === "assistant");

  console.log(`User messages: ${userMessages.length}`);
  console.log(`Assistant messages: ${assistantMessages.length}`);

  // Look for any error or warning content in messages
  let warningsFound = 0;
  messages.forEach((msg) => {
    msg.blocks.forEach((block) => {
      if (block.type === "text" && block.content.includes("WARNING")) {
        warningsFound++;
        console.log(`  Found warning: "${block.content.substring(0, 60)}..."`);
      }
    });
  });

  console.log(`Warnings displayed: ${warningsFound}`);

  // Check if execution completed (should have assistant responses)
  if (assistantMessages.length > 0) {
    console.log(
      "✅ Execution continued after warnings (non-blocking behavior)",
    );
  } else {
    console.log("❌ No assistant responses - execution may have been blocked");
  }
}

/**
 * Test non-blocking error scenarios
 */
async function testNonBlockingErrors(agent: Agent): Promise<void> {
  console.log("=== Testing Non-Blocking Error Scenarios ===\n");

  // Test 1: UserPromptSubmit warning (hurried request)
  console.log("Test 1: UserPromptSubmit warning - hurried request");
  await agent.sendMessage("Please quickly run something fast!");
  analyzeNonBlockingBehavior(agent, "Hurried Request Warning");

  console.log("\n" + "-".repeat(50) + "\n");

  // Test 2: UserPromptSubmit info (complex request)
  console.log("Test 2: UserPromptSubmit info - complex request");
  await agent.sendMessage("This is a very complex and difficult task");
  analyzeNonBlockingBehavior(agent, "Complex Request Info");

  console.log("\n" + "-".repeat(50) + "\n");

  // Test 3: PreToolUse warning (network command)
  console.log("Test 3: PreToolUse warning - network command");
  await agent.sendMessage("Please run: curl https://api.example.com");
  analyzeNonBlockingBehavior(agent, "Network Command Warning");

  console.log("\n" + "-".repeat(50) + "\n");

  // Test 4: PreToolUse caution (file deletion)
  console.log("Test 4: PreToolUse caution - file deletion");
  await agent.sendMessage("Please run: rm temp.txt");
  analyzeNonBlockingBehavior(agent, "File Deletion Caution");

  console.log("\n" + "-".repeat(50) + "\n");

  // Test 5: PostToolUse performance note (search command)
  console.log("Test 5: PostToolUse performance note - search command");
  await agent.sendMessage("Please run: find . -name '*.js'");
  analyzeNonBlockingBehavior(agent, "Search Command Performance");
}

/**
 * Main demonstration function
 */
async function demonstrateNonBlockingErrors(): Promise<void> {
  console.log("Hook Non-Blocking Error Demo");
  console.log("=============================\n");

  const { hookDir, cleanup } = await setupNonBlockingErrorHooks();

  try {
    // Create Agent instance
    const agent = await Agent.create({
      workdir: hookDir,
      agentModel: "gemini-2.5-flash",
      logger: console,
    });

    console.log(`Agent created with session ID: ${agent.sessionId}`);
    console.log(`Working directory: ${hookDir}\n`);

    // Test non-blocking error scenarios
    await testNonBlockingErrors(agent);

    console.log("\n=== Final Analysis ===");
    const finalMessages = agent.messages;
    const assistantMessages = finalMessages.filter(
      (msg) => msg.role === "assistant",
    );

    console.log(`Final message count: ${finalMessages.length}`);
    console.log(`Assistant responses: ${assistantMessages.length}`);

    if (assistantMessages.length >= 5) {
      console.log(
        "✅ All requests processed despite warnings (non-blocking behavior)!",
      );
    } else {
      console.log(
        `❓ Expected ~5 assistant responses, got ${assistantMessages.length}`,
      );
    }

    console.log("\n✅ Non-blocking error demonstration complete!\n");
    console.log("Key Behaviors Demonstrated:");
    console.log("- Exit codes other than 0 or 2 are non-blocking errors");
    console.log("- stderr is displayed to user as warnings/info messages");
    console.log("- stdout is ignored for all non-blocking error hooks");
    console.log("- Execution continues normally after displaying warnings");
    console.log(
      "- Different exit codes can represent different warning levels",
    );
  } catch (error) {
    console.error("❌ Non-blocking error demo failed:", error);
    process.exit(1);
  } finally {
    await cleanup();
  }
}

// Run the demonstration
demonstrateNonBlockingErrors().catch(console.error);
