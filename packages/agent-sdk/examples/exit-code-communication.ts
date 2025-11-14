/**
 * Exit Code Communication Example
 *
 * Demonstrates User Story 1: Simple Exit Code Communication
 * Shows how hooks can communicate through exit codes to control Wave's behavior:
 * - 0: Success (continue processing)
 * - 2: Blocking error (stop processing)
 * - Other: Non-blocking error (continue with warning)
 */

import { Agent } from "../src/agent.js";
import { writeFileSync, mkdirSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

process.env.AIGW_MODEL = "gemini-2.5-flash";

async function runExitCodeCommunicationExample() {
  console.log("🚀 Exit Code Communication Example");
  console.log("Demonstrating User Story 1: Simple Exit Code Communication\n");

  // Create temporary directory for the example
  const tempDir = join(tmpdir(), `wave-hooks-example-${Date.now()}`);
  mkdirSync(tempDir, { recursive: true });

  // Create test hooks with different exit codes
  const successHook = join(tempDir, "success-hook.sh");
  const blockingHook = join(tempDir, "blocking-hook.sh");
  const warningHook = join(tempDir, "warning-hook.sh");

  // Success hook (exit code 0)
  writeFileSync(
    successHook,
    `#!/bin/bash
echo "Hook executed successfully"
echo "Tool execution should continue normally"
exit 0
`,
    { mode: 0o755 },
  );

  // Blocking hook (exit code 2)
  writeFileSync(
    blockingHook,
    `#!/bin/bash
echo "Critical security violation detected" >&2
echo "Tool execution must be blocked"
exit 2
`,
    { mode: 0o755 },
  );

  // Warning hook (exit code 1 - non-blocking)
  writeFileSync(
    warningHook,
    `#!/bin/bash
echo "Potential issue detected, but not critical"
echo "Tool can continue with this warning" >&2
exit 1
`,
    { mode: 0o755 },
  );

  // Create hooks configuration
  const hooksConfig = {
    hooks: {
      PreToolUse: [
        {
          command: successHook,
          description: "Success hook - allows tool execution",
        },
        {
          command: blockingHook,
          description: "Blocking hook - prevents tool execution",
        },
        {
          command: warningHook,
          description: "Warning hook - shows warning but allows execution",
        },
      ],
    },
  };

  const configPath = join(tempDir, ".wave", "hooks.json");
  mkdirSync(join(tempDir, ".wave"), { recursive: true });
  writeFileSync(configPath, JSON.stringify(hooksConfig, null, 2));

  try {
    // Create agent instance
    const agent = await Agent.create({
      workdir: tempDir,
      callbacks: {
        onWarnMessageAdded: (content: string, hookEvent?: string) => {
          console.log(`⚠️  Warning from ${hookEvent}: ${content}`);
        },
        onHookMessageAdded: (
          hookEvent: string,
          content: string,
          metadata?: Record<string, unknown>,
        ) => {
          console.log(`🔗 Hook ${hookEvent}: ${content}`);
          if (metadata) {
            console.log(`   Metadata:`, metadata);
          }
        },
      },
    });

    console.log("✅ Agent created with hooks configuration");
    console.log(`📁 Working directory: ${tempDir}\n`);

    // Test scenarios

    console.log("=== Test 1: Success Hook (Exit Code 0) ===");
    try {
      // This should execute the success hook and continue
      await agent.sendMessage(
        "Please use the Bash tool to list files in the current directory.",
      );
      console.log("✅ Tool executed successfully - hook allowed execution\n");
    } catch (error) {
      console.log(`❌ Unexpected error: ${error}\n`);
    }

    console.log("=== Results Analysis ===");
    console.log("Expected behavior for each hook type:");
    console.log("• Success Hook (exit 0): Tool execution continues normally");
    console.log("• Blocking Hook (exit 2): Tool execution is blocked");
    console.log(
      "• Warning Hook (exit 1): Tool executes with warning displayed",
    );
    console.log("\nActual results should show:");
    console.log("• Warning messages for stderr output");
    console.log("• Hook messages for hook-specific information");
    console.log("• Different behavior based on exit codes");
  } catch (error) {
    console.error("❌ Example failed:", error);
  } finally {
    // Cleanup
    console.log(`\n🧹 Cleanup: Remove ${tempDir} manually if needed`);
  }
}

// Run the example if this file is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  console.log("Exit Code Communication Example\n");

  runExitCodeCommunicationExample()
    .then(() => {
      console.log("\n✅ Exit Code Communication Example completed!");
      console.log(
        "This demonstrates User Story 1: Simple Exit Code Communication",
      );
      console.log("Hooks can now control Wave's behavior through exit codes:");
      console.log("• 0 = Continue (success)");
      console.log("• 2 = Block (critical error)");
      console.log("• Other = Warning (non-blocking error)");
    })
    .catch((error) => {
      console.error("❌ Example failed:", error);
      process.exit(1);
    });
}

export { runExitCodeCommunicationExample };
