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

/**
 * Interactive example for testing exit codes manually
 */
async function runInteractiveExitCodeTest() {
  console.log("\n🎮 Interactive Exit Code Test");
  console.log(
    "This function demonstrates how to create and test hooks with different exit codes.\n",
  );

  const testDir = join(tmpdir(), `wave-exit-code-test-${Date.now()}`);
  mkdirSync(testDir, { recursive: true });

  // Create simple test hooks
  const hooks = {
    success: `#!/bin/bash
echo "Operation successful"
exit 0`,
    block: `#!/bin/bash  
echo "Security check failed" >&2
echo "Operation blocked for safety"
exit 2`,
    warning: `#!/bin/bash
echo "Non-critical issue detected"
echo "Proceeding with caution" >&2
exit 1`,
    custom: `#!/bin/bash
echo "Custom error condition"
echo "This should be treated as non-blocking" >&2
exit 42`,
  };

  // Write hook files
  Object.entries(hooks).forEach(([name, script]) => {
    const hookPath = join(testDir, `${name}-hook.sh`);
    writeFileSync(hookPath, script, { mode: 0o755 });
    console.log(`📝 Created ${name} hook: ${hookPath}`);
  });

  console.log(`\n📁 Test directory: ${testDir}`);
  console.log("\nTo test these hooks:");
  console.log("1. Create a hooks.json configuration file");
  console.log("2. Reference these hook scripts in your configuration");
  console.log("3. Run Wave with hooks enabled");
  console.log("4. Observe the different behaviors based on exit codes");

  console.log("\nExpected behaviors:");
  console.log("• Exit 0: Continue normally (success)");
  console.log("• Exit 2: Block execution (security/critical error)");
  console.log(
    "• Exit 1 or other: Show warning but continue (non-blocking error)",
  );
}

/**
 * Utility function to test hook output parsing directly
 */
async function testHookOutputParsing() {
  console.log("\n🔍 Hook Output Parsing Test");

  const { parseHookOutput } = await import("../src/utils/hookOutputParser.js");

  const testCases = [
    {
      name: "Success Case",
      result: {
        exitCode: 0,
        stdout: "Operation completed successfully",
        stderr: "",
        executionTime: 150,
        hookEvent: "PreToolUse" as const,
      },
    },
    {
      name: "Blocking Case",
      result: {
        exitCode: 2,
        stdout: "",
        stderr: "Critical security violation",
        executionTime: 75,
        hookEvent: "PreToolUse" as const,
      },
    },
    {
      name: "Warning Case",
      result: {
        exitCode: 1,
        stdout: "Proceeding with warning",
        stderr: "Non-critical issue detected",
        executionTime: 200,
        hookEvent: "PostToolUse" as const,
      },
    },
    {
      name: "Custom Exit Code",
      result: {
        exitCode: 42,
        stdout: "",
        stderr: "Custom error condition",
        executionTime: 100,
        hookEvent: "UserPromptSubmit" as const,
      },
    },
  ];

  testCases.forEach((testCase) => {
    console.log(`\n--- ${testCase.name} ---`);
    const parsed = parseHookOutput(testCase.result);
    console.log(`Source: ${parsed.source}`);
    console.log(`Continue: ${parsed.continue}`);
    console.log(`Stop Reason: ${parsed.stopReason || "None"}`);
    console.log(`System Message: ${parsed.systemMessage || "None"}`);
    console.log(
      `Error Messages: ${parsed.errorMessages.length > 0 ? parsed.errorMessages.join(", ") : "None"}`,
    );
  });
}

// Run the example if this file is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  console.log("Exit Code Communication Example\n");

  runExitCodeCommunicationExample()
    .then(() => runInteractiveExitCodeTest())
    .then(() => testHookOutputParsing())
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

export {
  runExitCodeCommunicationExample,
  runInteractiveExitCodeTest,
  testHookOutputParsing,
};
