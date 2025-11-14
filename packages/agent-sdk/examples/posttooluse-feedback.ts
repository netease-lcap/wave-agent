#!/usr/bin/env tsx

/**
 * PostToolUse Feedback Integration Example
 *
 * Demonstrates User Story 4: PostToolUse Feedback Integration
 *
 * This example shows how PostToolUse hooks can provide automated feedback
 * to Wave after tools complete execution, including:
 * - Blocking decisions to prevent further execution
 * - Additional context injection for better AI understanding
 * - Validation and error handling
 *
 * The PostToolUse hook receives tool execution details and can:
 * 1. Allow normal execution to continue (default/no output)
 * 2. Block further execution with blocking decision and reason
 * 3. Add contextual information for the AI to consider
 *
 * Usage: pnpm tsx examples/posttooluse-feedback.ts
 */

import { Agent } from "../src/agent.js";
import { join } from "path";
import { mkdtemp, writeFile, chmod, rm } from "fs/promises";
import { tmpdir } from "os";

async function runPostToolUseFeedbackExample() {
  console.log("🔄 PostToolUse Feedback Integration Example");
  console.log("============================================");

  // Create temporary directory for this example
  const tempDir = await mkdtemp(join(tmpdir(), "wave-posttooluse-"));
  const hookScript = join(tempDir, "posttooluse-feedback.sh");

  try {
    console.log(`📁 Created temporary directory: ${tempDir}`);

    // Create a PostToolUse hook script that demonstrates different feedback scenarios
    const hookContent = `#!/bin/bash

# PostToolUse Hook for Automated Feedback
# Receives tool execution context and provides feedback

# Parse input from stdin (JSON format)
input=$(cat)

# Extract tool information using jq if available, otherwise use basic parsing
if command -v jq >/dev/null 2>&1; then
  tool_name=$(echo "$input" | jq -r '.toolName // "unknown"')
  tool_input=$(echo "$input" | jq -r '.toolInput // "{}"')
  tool_response=$(echo "$input" | jq -r '.toolResponse // "{}"')
else
  # Fallback parsing for systems without jq
  tool_name=$(echo "$input" | grep -o '"toolName":"[^"]*"' | cut -d'"' -f4)
  tool_input=$(echo "$input" | grep -o '"toolInput":"[^"]*"' | cut -d'"' -f4)
  tool_response=$(echo "$input" | grep -o '"toolResponse":"[^"]*"' | cut -d'"' -f4)
fi

echo "PostToolUse Hook triggered for tool: $tool_name" >&2
echo "Tool input: $tool_input" >&2
echo "Tool response preview: $(echo "$tool_response" | head -c 100)..." >&2

# Demonstrate different PostToolUse feedback scenarios based on tool name
case "$tool_name" in
  "Bash")
    # For Bash tool, check if dangerous commands were executed
    if echo "$tool_input" | grep -q "rm -rf\\|sudo\\|chmod 777"; then
      # Block execution with detailed reason
      cat << 'EOF'
{
  "continue": false,
  "stopReason": "Dangerous bash command detected",
  "systemMessage": "PostToolUse hook blocked execution due to potentially dangerous bash command",
  "hookSpecificOutput": {
    "hookEventName": "PostToolUse",
    "decision": "block",
    "reason": "Detected potentially dangerous bash commands (rm -rf, sudo, chmod 777) that could compromise system security",
    "additionalContext": "Consider using safer alternatives or explicit user confirmation for system-level operations"
  }
}
EOF
    else
      # Allow execution but add context about bash safety
      cat << 'EOF'
{
  "continue": true,
  "systemMessage": "Bash command executed safely",
  "hookSpecificOutput": {
    "hookEventName": "PostToolUse",
    "additionalContext": "Bash command completed. Consider reviewing output for any unexpected results or errors."
  }
}
EOF
    fi
    ;;
  
  "Edit"|"Write")
    # For file operations, check if critical system files were modified
    if echo "$tool_input" | grep -q "/etc/\\|/sys/\\|/proc/"; then
      # Block with warning about system files
      cat << 'EOF'
{
  "continue": false,
  "stopReason": "System file modification attempt",
  "systemMessage": "PostToolUse hook prevented modification of system files",
  "hookSpecificOutput": {
    "hookEventName": "PostToolUse",
    "decision": "block",
    "reason": "Attempted to modify critical system files (/etc/, /sys/, /proc/) which could destabilize the system",
    "additionalContext": "If system configuration changes are necessary, they should be performed with explicit user oversight and proper backup procedures"
  }
}
EOF
    else
      # Provide context about file changes
      cat << 'EOF'
{
  "continue": true,
  "systemMessage": "File operation completed with safety checks",
  "hookSpecificOutput": {
    "hookEventName": "PostToolUse",
    "additionalContext": "File modification completed. Remember to test changes and consider version control for important files."
  }
}
EOF
    fi
    ;;
  
  "Delete")
    # For delete operations, always add a warning context
    cat << 'EOF'
{
  "continue": true,
  "systemMessage": "File deletion operation completed",
  "hookSpecificOutput": {
    "hookEventName": "PostToolUse",
    "additionalContext": "File deletion completed. Note that deleted files cannot be easily recovered. Consider implementing a backup strategy for important data."
  }
}
EOF
    ;;

  *)
    # For unknown tools, provide general feedback
    cat << 'EOF'
{
  "continue": true,
  "systemMessage": "Tool execution monitored by PostToolUse hook",
  "hookSpecificOutput": {
    "hookEventName": "PostToolUse",
    "additionalContext": "Tool execution completed. PostToolUse hook is monitoring all tool usage for safety and providing contextual feedback."
  }
}
EOF
    ;;
esac
`;

    // Write and make executable
    await writeFile(hookScript, hookContent);
    await chmod(hookScript, 0o755);

    console.log("📝 Created PostToolUse hook script with feedback scenarios");

    // Create agent with hook configuration
    const agent = await Agent.create({
      workdir: tempDir,
    });

    console.log("\\n🚀 Testing PostToolUse feedback scenarios...");

    // Test 1: Safe bash command (should continue with context)
    console.log("\\n=== Test 1: Safe Bash Command ===");
    try {
      await agent.sendMessage("Run 'echo Hello World' using bash");
      console.log("✅ Safe bash command completed with PostToolUse feedback");
    } catch (error) {
      console.log("❌ Safe bash test failed:", error);
    }

    // Test 2: Dangerous bash command (should be blocked)
    console.log("\\n=== Test 2: Dangerous Bash Command ===");
    try {
      await agent.sendMessage("Run 'sudo rm -rf /tmp/test' using bash");
      console.log("⚠️  Dangerous bash command was not blocked (unexpected)");
    } catch (error) {
      console.log(
        "✅ Dangerous bash command blocked by PostToolUse hook:",
        error,
      );
    }

    // Test 3: File edit operation (should continue with context)
    console.log("\\n=== Test 3: Safe File Edit ===");
    try {
      const testFile = join(tempDir, "test.txt");
      await agent.sendMessage(`Write 'Hello PostToolUse' to ${testFile}`);
      console.log("✅ File edit completed with PostToolUse feedback");
    } catch (error) {
      console.log("❌ File edit test failed:", error);
    }

    // Test 4: System file edit (should be blocked)
    console.log("\\n=== Test 4: System File Edit ===");
    try {
      await agent.sendMessage("Write 'test' to /etc/hosts");
      console.log("⚠️  System file edit was not blocked (unexpected)");
    } catch (error) {
      console.log("✅ System file edit blocked by PostToolUse hook:", error);
    }

    // Test 5: File deletion (should continue with warning context)
    console.log("\\n=== Test 5: File Deletion ===");
    try {
      const deleteFile = join(tempDir, "delete-me.txt");
      await writeFile(deleteFile, "temporary file");
      await agent.sendMessage(`Delete the file ${deleteFile}`);
      console.log("✅ File deletion completed with PostToolUse warning");
    } catch (error) {
      console.log("❌ File deletion test failed:", error);
    }

    console.log("\\n🎯 PostToolUse Feedback Integration Example Complete!");
    console.log("\\nKey Features Demonstrated:");
    console.log("- ✅ Automated safety checking after tool execution");
    console.log("- ✅ Blocking dangerous operations with detailed reasons");
    console.log("- ✅ Context injection for better AI decision making");
    console.log("- ✅ Tool-specific feedback logic");
    console.log("- ✅ JSON-based hook communication with validation");
  } catch (error) {
    console.error("❌ Example failed:", error);
    throw error;
  } finally {
    // Clean up temporary directory
    try {
      await rm(tempDir, { recursive: true, force: true });
      console.log(`🧹 Cleaned up temporary directory: ${tempDir}`);
    } catch (error) {
      console.warn(`⚠️  Failed to clean up ${tempDir}:`, error);
    }
  }
}

// Run example if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  runPostToolUseFeedbackExample().catch((error) => {
    console.error("PostToolUse Feedback Example failed:", error);
    process.exit(1);
  });
}

export { runPostToolUseFeedbackExample };
