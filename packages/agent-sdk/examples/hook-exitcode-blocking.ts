#!/usr/bin/env tsx
/**
 * Hook Exit Code Blocking Error Example
 *
 * This example demonstrates blocking error behavior with exit code 2.
 * Shows how different hook types handle blocking errors differently.
 *
 * Key behaviors tested:
 * - Exit code 2 = blocking error
 * - PreToolUse: blocks tool execution, stderr goes to Wave Agent
 * - PostToolUse: stderr goes to Wave Agent, execution continues (tool already ran)
 * - UserPromptSubmit: blocks prompt, erases it, stderr shown to user only
 * - Stop: blocks stopping, stderr goes to Wave Agent
 *
 * Run with: pnpm tsx examples/hook-exitcode-blocking.ts
 */

import { Agent } from "../src/agent.js";
import { promises as fs } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { randomUUID } from "crypto";

/**
 * Create hooks that return exit code 2 with error messages
 */
async function setupBlockingErrorHooks(): Promise<{
  hookDir: string;
  cleanup: () => Promise<void>;
}> {
  const hookDir = join(tmpdir(), `wave-hook-blocking-${randomUUID()}`);
  await fs.mkdir(hookDir, { recursive: true });

  // Create .wave subdirectory
  const waveDir = join(hookDir, ".wave");
  await fs.mkdir(waveDir, { recursive: true });

  // Create hook configuration with blocking error hooks
  const hookConfig = {
    hooks: {
      // UserPromptSubmit hook that blocks dangerous commands
      UserPromptSubmit: [
        {
          hooks: [
            {
              type: "command",
              command: `
                user_message=$(jq -r '.user_prompt // ""')
                if echo "$user_message" | grep -i "rm -rf\\|delete\\|format"; then
                  echo "BLOCKED: Potentially dangerous command detected. Please review your request." >&2
                  exit 2
                else
                  exit 0
                fi
              `,
            },
          ],
        },
      ],
      // PreToolUse hook that blocks certain bash commands
      PreToolUse: [
        {
          matcher: "bash",
          hooks: [
            {
              type: "command",
              command: `
                command_text=$(jq -r '.tool_input.parameters.command // ""')
                if echo "$command_text" | grep -i "sudo\\|su\\|passwd"; then
                  echo "BLOCKED: Administrative commands are not allowed in this environment." >&2
                  exit 2
                else
                  exit 0
                fi
              `,
            },
          ],
        },
      ],
      // PostToolUse hook that reports errors but doesn't block (tool already ran)
      PostToolUse: [
        {
          matcher: "bash",
          hooks: [
            {
              type: "command",
              command: `
                exit_code=$(jq -r '.tool_response.exit_code // 0')
                if [ "$exit_code" -ne 0 ]; then
                  echo "WARNING: Tool execution failed with exit code $exit_code. Please review the output." >&2
                  exit 2
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

  console.log(`Created blocking error hook configuration: ${configPath}`);

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
 * Analyze messages to verify blocking behavior
 */
function analyzeBlockingBehavior(agent: Agent, testName: string): void {
  console.log(`--- Analyzing Blocking Behavior for: ${testName} ---`);

  const messages = agent.messages;
  console.log(`Total messages: ${messages.length}`);

  // Look for error blocks
  const errorBlocks = messages.flatMap((msg) =>
    msg.blocks.filter((block) => block.type === "error"),
  );

  // Look for tool blocks
  const toolBlocks = messages.flatMap((msg) =>
    msg.blocks.filter((block) => block.type === "tool"),
  );

  console.log(`Error blocks found: ${errorBlocks.length}`);
  console.log(`Tool blocks found: ${toolBlocks.length}`);

  errorBlocks.forEach((block, index) => {
    if (block.type === "error") {
      console.log(`  Error ${index + 1}: "${block.content}"`);
    }
  });

  toolBlocks.forEach((block, index) => {
    if (block.type === "tool") {
      console.log(
        `  Tool ${index + 1}: ${block.name}, success: ${block.success}`,
      );
      if (block.result) {
        console.log(
          `    Result preview: "${block.result.substring(0, 100)}..."`,
        );
      }
    }
  });
}

/**
 * Test blocking error scenarios
 */
async function testBlockingErrors(agent: Agent): Promise<void> {
  console.log("=== Testing Blocking Error Scenarios ===\n");

  // Test 1: UserPromptSubmit blocking (dangerous command)
  console.log("Test 1: UserPromptSubmit blocking - dangerous command");
  try {
    await agent.sendMessage("Please run: rm -rf /important/data");
    console.log("❌ Dangerous command was not blocked!");
  } catch {
    console.log("✅ Dangerous command was blocked as expected");
  }
  analyzeBlockingBehavior(agent, "Dangerous Command Block");

  console.log("\n" + "-".repeat(50) + "\n");

  // Test 2: Safe command should work
  console.log("Test 2: Safe command should proceed normally");
  await agent.sendMessage("Please run: echo 'This is safe'");
  analyzeBlockingBehavior(agent, "Safe Command");

  console.log("\n" + "-".repeat(50) + "\n");

  // Test 3: PreToolUse blocking (administrative command)
  console.log("Test 3: PreToolUse blocking - administrative command");
  await agent.sendMessage("Please run: sudo whoami");
  analyzeBlockingBehavior(agent, "Administrative Command Block");

  console.log("\n" + "-".repeat(50) + "\n");

  // Test 4: Command that will fail (for PostToolUse hook demonstration)
  console.log("Test 4: PostToolUse error reporting");
  await agent.sendMessage("Please run: ls /nonexistent/directory");
  analyzeBlockingBehavior(agent, "Failed Command Reporting");
}

/**
 * Main demonstration function
 */
async function demonstrateBlockingErrors(): Promise<void> {
  console.log("Hook Exit Code Blocking Error Demo");
  console.log("===================================\n");

  const { hookDir, cleanup } = await setupBlockingErrorHooks();

  try {
    // Create Agent instance
    const agent = await Agent.create({
      workdir: hookDir,
      agentModel: "gemini-2.5-flash",
      logger: console,
    });

    console.log(`Agent created with session ID: ${agent.sessionId}`);
    console.log(`Working directory: ${hookDir}\n`);

    // Test blocking error scenarios
    await testBlockingErrors(agent);

    console.log("\n=== Final Analysis ===");
    const finalMessages = agent.messages;
    const errorBlocks = finalMessages.flatMap((msg) =>
      msg.blocks.filter((block) => block.type === "error"),
    );

    console.log(`Final message count: ${finalMessages.length}`);
    console.log(`Total error blocks: ${errorBlocks.length}`);

    if (errorBlocks.length > 0) {
      console.log("✅ Blocking errors were properly captured!");
    } else {
      console.log("❓ No error blocks found - check if hooks are executing");
    }

    console.log("\n✅ Blocking error demonstration complete!\n");
    console.log("Key Behaviors Demonstrated:");
    console.log("- Exit code 2 triggers blocking error behavior");
    console.log(
      "- UserPromptSubmit blocks: prevents processing, shows user error",
    );
    console.log(
      "- PreToolUse blocks: prevents tool execution, shows agent error",
    );
    console.log(
      "- PostToolUse reports: shows agent error, allows continuation",
    );
    console.log("- Error messages appear in appropriate message blocks");
  } catch (error) {
    console.error("❌ Blocking error demo failed:", error);
    process.exit(1);
  } finally {
    await cleanup();
  }
}

// Run the demonstration
demonstrateBlockingErrors().catch(console.error);
