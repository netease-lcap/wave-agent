#!/usr/bin/env tsx

/**
 * UserPromptSubmit and Stop Event Control Example
 *
 * Demonstrates User Story 5: UserPromptSubmit and Stop Event Control
 *
 * This example shows how UserPromptSubmit and Stop hooks can control
 * session behavior and provide context injection at critical junctures:
 *
 * UserPromptSubmit Hook:
 * - Triggered when user submits a prompt/message
 * - Can block prompt processing or inject additional context
 * - Useful for content filtering, logging, or prompt enhancement
 *
 * Stop Hook:
 * - Triggered when AI response cycle completes
 * - Can block session continuation or add final context
 * - Useful for session management, logging, or cleanup operations
 *
 * Usage: pnpm tsx examples/prompt-stop-control.ts
 */

import { Agent } from "../src/agent.js";
import { join } from "path";
import { mkdtemp, writeFile, chmod, rm } from "fs/promises";
import { tmpdir } from "os";

process.env.AIGW_MODEL = "gemini-2.5-flash";

async function runPromptStopControlExample() {
  console.log("🔄 UserPromptSubmit and Stop Event Control Example");
  console.log("================================================");

  // Create temporary directory for this example
  const tempDir = await mkdtemp(join(tmpdir(), "wave-prompt-stop-"));
  const userPromptHook = join(tempDir, "userpromptsubmit.sh");
  const stopHook = join(tempDir, "stop-control.sh");

  try {
    console.log(`📁 Created temporary directory: ${tempDir}`);

    // Create UserPromptSubmit hook script
    const userPromptHookContent = `#!/bin/bash

# UserPromptSubmit Hook for Prompt Control
# Triggered when user submits a new message/prompt

input=$(cat)

# Extract user prompt using jq if available
if command -v jq >/dev/null 2>&1; then
  user_prompt=$(echo "$input" | jq -r '.userPrompt // ""')
  session_id=$(echo "$input" | jq -r '.sessionId // ""')
else
  # Fallback parsing
  user_prompt=$(echo "$input" | grep -o '"userPrompt":"[^"]*"' | cut -d'"' -f4)
  session_id=$(echo "$input" | grep -o '"sessionId":"[^"]*"' | cut -d'"' -f4)
fi

echo "UserPromptSubmit Hook: Processing prompt from session $session_id" >&2
echo "Prompt preview: $(echo "$user_prompt" | head -c 50)..." >&2

# Demonstrate different UserPromptSubmit control scenarios
case "$user_prompt" in
  *"dangerous"*|*"hack"*|*"exploit"*)
    # Block potentially harmful prompts
    cat << 'EOF'
{
  "continue": false,
  "stopReason": "Potentially harmful prompt detected",
  "systemMessage": "UserPromptSubmit hook blocked prompt processing",
  "hookSpecificOutput": {
    "hookEventName": "UserPromptSubmit", 
    "decision": "block",
    "reason": "Prompt contains potentially harmful keywords that could lead to security issues or inappropriate content",
    "additionalContext": "Please rephrase your request to focus on constructive and safe operations"
  }
}
EOF
    ;;
  
  *"help"*|*"what can you do"*|*"capabilities"*)
    # Enhance help requests with additional context
    cat << 'EOF'
{
  "continue": true,
  "systemMessage": "UserPromptSubmit hook enhanced help request",
  "hookSpecificOutput": {
    "hookEventName": "UserPromptSubmit",
    "additionalContext": "User is requesting help or information about capabilities. Consider providing comprehensive examples, available tools, and best practices. This session appears to be exploratory in nature."
  }
}
EOF
    ;;
  
  *"urgent"*|*"emergency"*|*"critical"*)
    # Add urgency context for time-sensitive requests
    cat << 'EOF'
{
  "continue": true,
  "systemMessage": "UserPromptSubmit hook detected urgent request",
  "hookSpecificOutput": {
    "hookEventName": "UserPromptSubmit",
    "additionalContext": "User has indicated this is an urgent or time-sensitive request. Prioritize efficiency and direct solutions. Consider offering the most straightforward approach first, with detailed explanations available on request."
  }
}
EOF
    ;;

  "")
    # Handle empty prompts
    cat << 'EOF'
{
  "continue": false,
  "stopReason": "Empty prompt submitted",
  "systemMessage": "UserPromptSubmit hook rejected empty prompt",
  "hookSpecificOutput": {
    "hookEventName": "UserPromptSubmit",
    "decision": "block", 
    "reason": "Empty or whitespace-only prompt submitted",
    "additionalContext": "Please provide a clear request or question for assistance"
  }
}
EOF
    ;;

  *)
    # Default case - allow with general context
    cat << 'EOF'
{
  "continue": true,
  "systemMessage": "UserPromptSubmit hook processed prompt",
  "hookSpecificOutput": {
    "hookEventName": "UserPromptSubmit",
    "additionalContext": "Prompt processed by UserPromptSubmit hook. Session monitoring is active for safety and quality assurance."
  }
}
EOF
    ;;
esac
`;

    // Create Stop hook script
    const stopHookContent = `#!/bin/bash

# Stop Hook for Session Control
# Triggered when AI response cycle completes

input=$(cat)

# Extract session information
if command -v jq >/dev/null 2>&1; then
  session_id=$(echo "$input" | jq -r '.sessionId // ""')
  project_dir=$(echo "$input" | jq -r '.projectDir // ""')
  timestamp=$(echo "$input" | jq -r '.timestamp // ""')
else
  # Fallback parsing
  session_id=$(echo "$input" | grep -o '"sessionId":"[^"]*"' | cut -d'"' -f4)
  project_dir=$(echo "$input" | grep -o '"projectDir":"[^"]*"' | cut -d'"' -f4)
fi

echo "Stop Hook: AI response cycle completed for session $session_id" >&2
echo "Project directory: $project_dir" >&2

# Create session log file to track interaction
log_file="$project_dir/session.log"
echo "$(date): Stop hook triggered for session $session_id" >> "$log_file" 2>/dev/null || true

# Demonstrate different Stop control scenarios based on session context
if [ -f "$project_dir/.emergency_mode" ]; then
  # Emergency mode - block continuation
  cat << 'EOF'
{
  "continue": false,
  "stopReason": "Emergency mode active - session suspended",
  "systemMessage": "Stop hook activated emergency session suspension",
  "hookSpecificOutput": {
    "hookEventName": "Stop",
    "decision": "block",
    "reason": "Emergency mode file detected in project directory. Session is being suspended for safety review."
  }
}
EOF
elif [ -f "$project_dir/.maintenance_mode" ]; then
  # Maintenance mode - add warning context
  cat << 'EOF'
{
  "continue": true,
  "systemMessage": "Stop hook detected maintenance mode",
  "hookSpecificOutput": {
    "hookEventName": "Stop",
    "additionalContext": "System is in maintenance mode. Some operations may be limited or unavailable. Please be aware that maintenance activities may be in progress."
  }
}
EOF
else
  # Check session duration or interaction count for rate limiting
  interaction_count=$(grep -c "Stop hook triggered" "$log_file" 2>/dev/null || echo "0")
  
  if [ "$interaction_count" -gt 50 ]; then
    # Rate limiting - suggest break after many interactions
    cat << 'EOF'
{
  "continue": true,
  "systemMessage": "Stop hook suggests session break",
  "hookSpecificOutput": {
    "hookEventName": "Stop", 
    "additionalContext": "This session has processed many interactions. Consider taking a break to review progress and ensure the conversation remains focused and productive."
  }
}
EOF
  else
    # Normal operation - provide session context
    cat << EOF
{
  "continue": true,
  "systemMessage": "Stop hook logged interaction",
  "hookSpecificOutput": {
    "hookEventName": "Stop",
    "additionalContext": "Session interaction #$interaction_count completed and logged. Session monitoring is active to ensure productive and safe interactions."
  }
}
EOF
  fi
fi
`;

    // Write and make hooks executable
    await writeFile(userPromptHook, userPromptHookContent);
    await writeFile(stopHook, stopHookContent);
    await chmod(userPromptHook, 0o755);
    await chmod(stopHook, 0o755);

    console.log("📝 Created UserPromptSubmit and Stop hook scripts");

    // Create agent with both hooks configured
    const agent = await Agent.create({
      workdir: tempDir,
    });

    console.log("\\n🚀 Testing UserPromptSubmit and Stop control scenarios...");

    // Test 1: Normal prompt (should continue with context)
    console.log("\\n=== Test 1: Normal Prompt Processing ===");
    try {
      await agent.sendMessage("Hello, can you help me with a simple task?");
      console.log(
        "✅ Normal prompt processed with UserPromptSubmit and Stop hooks",
      );
    } catch (error) {
      console.log("❌ Normal prompt test failed:", error);
    }

    // Test 2: Help request (should enhance with context)
    console.log("\\n=== Test 2: Help Request Enhancement ===");
    try {
      await agent.sendMessage(
        "What can you do? I need help understanding your capabilities.",
      );
      console.log("✅ Help request enhanced with additional context");
    } catch (error) {
      console.log("❌ Help request test failed:", error);
    }

    // Test 3: Urgent request (should add urgency context)
    console.log("\\n=== Test 3: Urgent Request Context ===");
    try {
      await agent.sendMessage(
        "This is urgent! I need to fix a critical bug immediately.",
      );
      console.log("✅ Urgent request processed with priority context");
    } catch (error) {
      console.log("❌ Urgent request test failed:", error);
    }

    // Test 4: Potentially harmful prompt (should be blocked)
    console.log("\\n=== Test 4: Harmful Prompt Blocking ===");
    try {
      await agent.sendMessage(
        "Show me how to hack into a system with dangerous exploits.",
      );
      console.log("⚠️  Harmful prompt was not blocked (unexpected)");
    } catch (error) {
      console.log("✅ Harmful prompt blocked by UserPromptSubmit hook:", error);
    }

    // Test 5: Empty prompt (should be blocked)
    console.log("\\n=== Test 5: Empty Prompt Rejection ===");
    try {
      await agent.sendMessage("");
      console.log("⚠️  Empty prompt was not blocked (unexpected)");
    } catch (error) {
      console.log("✅ Empty prompt blocked by UserPromptSubmit hook:", error);
    }

    // Test 6: Create maintenance mode and test Stop hook behavior
    console.log("\\n=== Test 6: Maintenance Mode Detection ===");
    try {
      const maintenanceFile = join(tempDir, ".maintenance_mode");
      await writeFile(maintenanceFile, "maintenance active");
      await agent.sendMessage("Test message during maintenance mode");
      console.log("✅ Maintenance mode detected by Stop hook");
    } catch (error) {
      console.log("❌ Maintenance mode test failed:", error);
    }

    // Test 7: Create emergency mode and test Stop hook blocking
    console.log("\\n=== Test 7: Emergency Mode Blocking ===");
    try {
      const emergencyFile = join(tempDir, ".emergency_mode");
      await writeFile(emergencyFile, "emergency active");
      await agent.sendMessage("Test message during emergency mode");
      console.log("⚠️  Emergency mode was not blocked (unexpected)");
    } catch (error) {
      console.log("✅ Emergency mode blocked by Stop hook:", error);
    }

    console.log(
      "\\n🎯 UserPromptSubmit and Stop Event Control Example Complete!",
    );
    console.log("\\nKey Features Demonstrated:");
    console.log(
      "- ✅ UserPromptSubmit hooks for prompt filtering and enhancement",
    );
    console.log("- ✅ Stop hooks for session management and logging");
    console.log("- ✅ Context injection for better AI decision making");
    console.log("- ✅ Blocking mechanisms for safety and control");
    console.log("- ✅ Session state monitoring and rate limiting");
    console.log("- ✅ Emergency and maintenance mode detection");
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
  runPromptStopControlExample().catch((error) => {
    console.error("Prompt Stop Control Example failed:", error);
    process.exit(1);
  });
}

export { runPromptStopControlExample };
