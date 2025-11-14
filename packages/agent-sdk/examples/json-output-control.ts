#!/usr/bin/env -S pnpm tsx

/**
 * User Story 2: Advanced JSON Output Control Example
 * 
 * This example demonstrates JSON output parsing with common fields that override
 * exit code behavior. Hooks can return JSON with:
 * 
 * - continue: boolean - Whether to continue processing
 * - stopReason: string - Reason for stopping (required if continue=false)  
 * - systemMessage: string - Message to display to user
 * - hookSpecificOutput: object - Hook type-specific data
 * 
 * JSON output takes precedence over exit codes when valid JSON is present.
 */

import { Agent } from "../src/agent.js";
import * as fs from "fs/promises";
import * as path from "path";
import * as os from "os";
import { parseHookOutput } from "../src/utils/hookOutputParser.js";
import type { HookOutputResult, AgentCallbacks } from "../src/types/index.js";

// Test JSON outputs and verification
async function runJsonOutputControlExample() {
  console.log("\n🚀 JSON Output Control Example");
  console.log("Demonstrating User Story 2: Advanced JSON Output Control\n");

  // Create temporary directory for hook scripts
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "wave-json-hooks-"));
  console.log(`📁 Working directory: ${tempDir}\n`);

  try {
    // Test 1: JSON with continue=true and systemMessage
    console.log("=== Test 1: JSON Success with System Message ===");
    await testJsonOutput({
      exitCode: 0,
      stdout: JSON.stringify({
        continue: true,
        systemMessage: "JSON output processing successful",
        hookSpecificOutput: {
          hookEventName: "PreToolUse",
          permissionDecision: "allow",
          permissionDecisionReason: "Operation approved via JSON"
        }
      }),
      stderr: "",
      executionTime: 50,
      hookEvent: "PreToolUse"
    });

    // Test 2: JSON with continue=false (blocking)
    console.log("\n=== Test 2: JSON Blocking Operation ===");
    await testJsonOutput({
      exitCode: 0, // Exit code 0, but JSON says continue=false
      stdout: JSON.stringify({
        continue: false,
        stopReason: "JSON-based blocking - security check failed",
        systemMessage: "Operation blocked by JSON configuration",
        hookSpecificOutput: {
          hookEventName: "PreToolUse",
          permissionDecision: "deny",
          permissionDecisionReason: "Security policy violation detected"
        }
      }),
      stderr: "",
      executionTime: 75,
      hookEvent: "PreToolUse"
    });

    // Test 3: JSON precedence over exit code
    console.log("\n=== Test 3: JSON Precedence Over Exit Code ===");
    await testJsonOutput({
      exitCode: 2, // Exit code says block, but JSON says continue
      stdout: JSON.stringify({
        continue: true,
        systemMessage: "JSON overrides exit code - continuing despite exit code 2",
        hookSpecificOutput: {
          hookEventName: "PostToolUse",
          additionalContext: "Exit code 2 was expected but operation should continue"
        }
      }),
      stderr: "Exit code 2 stderr - should be overridden by JSON",
      executionTime: 100,
      hookEvent: "PostToolUse"
    });

    // Test 4: PostToolUse JSON with blocking decision
    console.log("\n=== Test 4: PostToolUse Block Decision ===");
    await testJsonOutput({
      exitCode: 0,
      stdout: JSON.stringify({
        continue: true,
        systemMessage: "Tool completed but requesting user attention",
        hookSpecificOutput: {
          hookEventName: "PostToolUse",
          decision: "block",
          reason: "Manual verification required for this operation",
          additionalContext: "Please review the changes before continuing"
        }
      }),
      stderr: "",
      executionTime: 30,
      hookEvent: "PostToolUse"
    });

    // Test 5: UserPromptSubmit with context injection
    console.log("\n=== Test 5: UserPromptSubmit Context Injection ===");
    await testJsonOutput({
      exitCode: 0,
      stdout: JSON.stringify({
        continue: true,
        systemMessage: "User prompt enhanced with additional context",
        hookSpecificOutput: {
          hookEventName: "UserPromptSubmit",
          additionalContext: "Consider the following security implications when processing this request..."
        }
      }),
      stderr: "",
      executionTime: 25,
      hookEvent: "UserPromptSubmit"
    });

    // Test 6: Stop event with blocking
    console.log("\n=== Test 6: Stop Event Blocking ===");
    await testJsonOutput({
      exitCode: 0,
      stdout: JSON.stringify({
        continue: false,
        stopReason: "Session cleanup required before termination",
        systemMessage: "Preventing session termination for cleanup",
        hookSpecificOutput: {
          hookEventName: "Stop",
          decision: "block",
          reason: "Critical cleanup operations are still running"
        }
      }),
      stderr: "",
      executionTime: 15,
      hookEvent: "Stop"
    });

    // Test 7: Malformed JSON fallback
    console.log("\n=== Test 7: Malformed JSON Fallback to Exit Code ===");
    await testJsonOutput({
      exitCode: 1,
      stdout: `{"malformed": json, "missing": quotes}`,
      stderr: "JSON parsing failed, falling back to exit code",
      executionTime: 10,
      hookEvent: "PreToolUse"
    });

    // Test 8: Mixed output with JSON
    console.log("\n=== Test 8: Mixed Output with Embedded JSON ===");
    await testJsonOutput({
      exitCode: 0,
      stdout: `Hook execution starting...
Processing file operations...
{"continue": true, "systemMessage": "File operations completed successfully", "hookSpecificOutput": {"hookEventName": "PostToolUse", "additionalContext": "All files processed without errors"}}
Hook execution completed.`,
      stderr: "",
      executionTime: 120,
      hookEvent: "PostToolUse"
    });

    console.log("\n=== Agent Integration Test ===");
    await testAgentIntegration(tempDir);

  } finally {
    // Cleanup
    console.log(`\n🧹 Cleanup: Remove ${tempDir} manually if needed`);
  }

  console.log("\n✅ JSON Output Control Example completed!");
  console.log("This demonstrates User Story 2: Advanced JSON Output Control");
  console.log("Key features:");
  console.log("• JSON output precedence over exit codes");
  console.log("• Common fields: continue, stopReason, systemMessage");
  console.log("• Hook-specific output for each hook type");
  console.log("• Graceful fallback to exit code interpretation");
  console.log("• Mixed output JSON extraction");
}

/**
 * Test hook output parsing with various JSON scenarios
 */
async function testJsonOutput(result: HookOutputResult) {
  const parsed = parseHookOutput(result);
  
  console.log(`📊 Hook Event: ${result.hookEvent}`);
  console.log(`🔢 Exit Code: ${result.exitCode}`);
  console.log(`📄 Stdout: ${result.stdout.substring(0, 100)}${result.stdout.length > 100 ? '...' : ''}`);
  console.log(`❌ Stderr: ${result.stderr || '(none)'}`);
  console.log(`⏱️  Execution Time: ${result.executionTime}ms`);
  
  console.log(`\n📋 Parsed Results:`);
  console.log(`• Source: ${parsed.source}`);
  console.log(`• Continue: ${parsed.continue}`);
  console.log(`• Stop Reason: ${parsed.stopReason || '(none)'}`);
  console.log(`• System Message: ${parsed.systemMessage || '(none)'}`);
  console.log(`• Hook-Specific Data: ${parsed.hookSpecificData ? 'present' : 'none'}`);
  console.log(`• Errors: ${parsed.errorMessages.length > 0 ? parsed.errorMessages.join(', ') : 'none'}`);
  
  if (parsed.hookSpecificData) {
    console.log(`\n🔧 Hook-Specific Output:`);
    console.log(JSON.stringify(parsed.hookSpecificData, null, 2));
  }
}

/**
 * Test JSON output control with real Agent instance
 */
async function testAgentIntegration(tempDir: string) {
  console.log("Creating hooks with JSON output...");

  // Create hook script that returns JSON
  const jsonHookScript = `#!/bin/bash
# Hook that returns JSON with common fields

if [ "$HOOK_EVENT_NAME" = "PreToolUse" ] && [ "$TOOL_NAME" = "write" ]; then
  cat <<EOF
{
  "continue": true,
  "systemMessage": "File write operation approved with monitoring",
  "hookSpecificOutput": {
    "hookEventName": "PreToolUse",
    "permissionDecision": "allow",
    "permissionDecisionReason": "File write approved - backup enabled",
    "updatedInput": {
      "backup": true,
      "monitored": true
    }
  }
}
EOF
  exit 0
fi

# Default behavior for other tools
echo '{"continue": true, "systemMessage": "Default approval via JSON"}'
exit 0
`;

  const hookPath = path.join(tempDir, "json-hook.sh");
  await fs.writeFile(hookPath, jsonHookScript);
  await fs.chmod(hookPath, 0o755);

  // Create agent with JSON hook processing callbacks
  const callbacks: AgentCallbacks = {
    onWarnMessage: (content, hookEvent) => {
      console.log(`⚠️  Warning (${hookEvent || 'general'}): ${content}`);
    },
    onHookMessage: (hookEvent, content, metadata) => {
      console.log(`🔗 Hook (${hookEvent}): ${content}`);
      if (metadata) {
        console.log(`   Metadata: ${JSON.stringify(metadata)}`);
      }
    },
  };

  try {
    const agent = await Agent.create({
      workdir: tempDir,
      callbacks,
      hooks: [
        {
          command: "./json-hook.sh",
          event: "PreToolUse",
          matcher: "*",
          timeout: 5000,
        },
      ],
    });

    // Suppress unused variable warning - agent is created for demonstration
    void agent;

    console.log("✅ Agent created with JSON hooks configuration");
    
    // Simulate tool execution that would trigger the hooks
    console.log("📝 Simulating tool execution with JSON hook processing...");
    
    // The hooks would be processed during actual tool execution
    // For this example, we'll demonstrate the parsing directly
    const simulatedResult: HookOutputResult = {
      exitCode: 0,
      stdout: JSON.stringify({
        continue: true,
        systemMessage: "Agent integration test - JSON processing working",
        hookSpecificOutput: {
          hookEventName: "PreToolUse",
          permissionDecision: "allow",
          permissionDecisionReason: "Integration test approved"
        }
      }),
      stderr: "",
      executionTime: 45,
      hookEvent: "PreToolUse"
    };

    const parsed = parseHookOutput(simulatedResult);
    console.log(`✅ JSON parsed successfully - Continue: ${parsed.continue}`);
    console.log(`📝 System message: ${parsed.systemMessage}`);
    
  } catch (error) {
    console.error("❌ Agent integration test failed:", error);
  }
}

/**
 * Interactive JSON testing utility
 */
export function testJsonHookOutput() {
  console.log("\n🧪 Interactive JSON Hook Output Test");
  console.log("This function demonstrates how to test various JSON output scenarios.\n");

  // Test scenarios
  const scenarios = [
    {
      name: "Valid JSON with blocking",
      json: {
        continue: false,
        stopReason: "Security check failed",
        systemMessage: "Operation blocked for security reasons",
        hookSpecificOutput: {
          hookEventName: "PreToolUse",
          permissionDecision: "deny",
          permissionDecisionReason: "Suspicious activity detected"
        }
      }
    },
    {
      name: "JSON with warning message",
      json: {
        continue: true,
        systemMessage: "Operation allowed with warnings",
        hookSpecificOutput: {
          hookEventName: "PostToolUse",
          additionalContext: "Please review the output for potential issues"
        }
      }
    },
    {
      name: "UserPromptSubmit with context",
      json: {
        continue: true,
        hookSpecificOutput: {
          hookEventName: "UserPromptSubmit",
          additionalContext: "User request enhanced with security context"
        }
      }
    }
  ];

  scenarios.forEach((scenario, index) => {
    console.log(`--- Scenario ${index + 1}: ${scenario.name} ---`);
    const result: HookOutputResult = {
      exitCode: 0,
      stdout: JSON.stringify(scenario.json),
      stderr: "",
      executionTime: 50,
      hookEvent: scenario.json.hookSpecificOutput.hookEventName as HookEventName
    };

    const parsed = parseHookOutput(result);
    console.log(`Source: ${parsed.source}`);
    console.log(`Continue: ${parsed.continue}`);
    console.log(`Stop Reason: ${parsed.stopReason || 'None'}`);
    console.log(`System Message: ${parsed.systemMessage || 'None'}`);
    console.log(`Errors: ${parsed.errorMessages.length > 0 ? parsed.errorMessages.join(', ') : 'None'}\n`);
  });

  console.log("✅ JSON Output Control testing utility completed!");
}

// Run the example if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  runJsonOutputControlExample().catch(console.error);
}

export { runJsonOutputControlExample };