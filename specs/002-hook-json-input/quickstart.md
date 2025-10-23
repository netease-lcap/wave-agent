# Quickstart: Hook JSON Input Support

**Phase 1** | **Date**: 2024-12-19 | **Feature**: Hook JSON Input Support

## Overview

This quickstart demonstrates how to use the new JSON input feature for Wave Agent SDK hooks. After implementation, hooks will receive structured JSON data via stdin containing session information and event-specific data.

## JSON Input Format

### Universal Fields
All hook events receive these base fields:
```bash
echo '{}' | jq -r '.session_id'      # Session identifier
echo '{}' | jq -r '.transcript_path' # Path to session file  
echo '{}' | jq -r '.cwd'             # Current working directory
echo '{}' | jq -r '.hook_event_name' # Event type
```

### Event-Specific Fields

**PreToolUse/PostToolUse Events:**
```bash
echo '{}' | jq -r '.tool_name'    # Tool being executed
echo '{}' | jq -r '.tool_input'   # Tool input parameters
echo '{}' | jq -r '.tool_response' # Tool response (PostToolUse only)
```

**UserPromptSubmit Event:**
```bash
echo '{}' | jq -r '.prompt'       # User's submitted prompt
```

## Complete Example (TypeScript)

### All-in-One Demo File

**File:** `packages/agent-sdk/examples/hook-json-input.ts`
```typescript
#!/usr/bin/env tsx
/**
 * Hook JSON Input Demo
 * 
 * Demonstrates how hooks receive and process JSON data via stdin.
 * Run with: pnpm tsx examples/hook-json-input.ts
 */

import { spawn } from 'child_process';
import { writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

// Sample JSON inputs for each hook event type
const sampleInputs = {
  PreToolUse: {
    session_id: "wave_session_abc123_def456",
    transcript_path: "/home/user/.wave/sessions/session_def456.json",
    cwd: "/home/user/project",
    hook_event_name: "PreToolUse",
    tool_name: "Write",
    tool_input: {
      file_path: "/home/user/project/src/index.ts",
      content: "console.log('Hello World');"
    }
  },
  
  PostToolUse: {
    session_id: "wave_session_abc123_def456",
    transcript_path: "/home/user/.wave/sessions/session_def456.json",
    cwd: "/home/user/project",
    hook_event_name: "PostToolUse",
    tool_name: "Write",
    tool_input: {
      file_path: "/home/user/project/src/index.ts",
      content: "console.log('Hello World');"
    },
    tool_response: {
      success: true,
      message: "File written successfully"
    }
  },
  
  UserPromptSubmit: {
    session_id: "wave_session_abc123_def456",
    transcript_path: "/home/user/.wave/sessions/session_def456.json",
    cwd: "/home/user/project",
    hook_event_name: "UserPromptSubmit",
    prompt: "Please create a TypeScript file with hello world"
  },
  
  Stop: {
    session_id: "wave_session_abc123_def456",
    transcript_path: "/home/user/.wave/sessions/session_def456.json",
    cwd: "/home/user/project",
    hook_event_name: "Stop"
  }
};

// Hook script templates
const hookScripts = {
  preToolUse: `#!/bin/bash
stdin_json=$(cat)
tool_name=$(echo "$stdin_json" | jq -r '.tool_name')
session_id=$(echo "$stdin_json" | jq -r '.session_id')
echo "PreToolUse: Tool $tool_name executing in session $session_id"
exit 0`,

  postToolUse: `#!/bin/bash
stdin_json=$(cat)
tool_name=$(echo "$stdin_json" | jq -r '.tool_name')
success=$(echo "$stdin_json" | jq -r '.tool_response.success // false')
echo "PostToolUse: Tool $tool_name completed with success=$success"
exit 0`,

  userPromptSubmit: `#!/bin/bash
stdin_json=$(cat)
prompt=$(echo "$stdin_json" | jq -r '.prompt')
echo "UserPromptSubmit: Received prompt: $prompt"
exit 0`,

  stop: `#!/bin/bash
stdin_json=$(cat)
session_id=$(echo "$stdin_json" | jq -r '.session_id')
echo "Stop: Session $session_id ending"
exit 0`
};

async function createTempHookScripts(): Promise<string> {
  const tempDir = join(tmpdir(), 'wave-hook-demo');
  mkdirSync(tempDir, { recursive: true });
  
  // Create hook scripts
  Object.entries(hookScripts).forEach(([name, script]) => {
    const scriptPath = join(tempDir, `${name}.sh`);
    writeFileSync(scriptPath, script, { mode: 0o755 });
  });
  
  return tempDir;
}

async function testHookScript(scriptPath: string, jsonInput: object): Promise<void> {
  return new Promise((resolve, reject) => {
    const process = spawn('/bin/bash', [scriptPath], {
      stdio: ['pipe', 'pipe', 'pipe']
    });
    
    let stdout = '';
    let stderr = '';
    
    process.stdout.on('data', (data) => stdout += data);
    process.stderr.on('data', (data) => stderr += data);
    
    process.on('close', (code) => {
      console.log(`Output: ${stdout.trim()}`);
      if (stderr) console.log(`Stderr: ${stderr.trim()}`);
      if (code === 0) resolve();
      else reject(new Error(`Hook exited with code ${code}`));
    });
    
    // Send JSON to stdin
    process.stdin.write(JSON.stringify(jsonInput, null, 2));
    process.stdin.end();
  });
}

async function main() {
  console.log('🎯 Hook JSON Input Demo');
  console.log('='.repeat(50));
  
  try {
    // Create temporary hook scripts
    const tempDir = await createTempHookScripts();
    console.log(`📁 Created temp hooks in: ${tempDir}`);
    
    // Test each hook type
    for (const [eventType, jsonInput] of Object.entries(sampleInputs)) {
      console.log(`\\n🔧 Testing ${eventType} hook:`);
      console.log(`📝 JSON Input:`, JSON.stringify(jsonInput, null, 2));
      
      const scriptName = eventType.charAt(0).toLowerCase() + eventType.slice(1);
      const scriptPath = join(tempDir, `${scriptName}.sh`);
      
      try {
        await testHookScript(scriptPath, jsonInput);
      } catch (error) {
        console.error(`❌ Hook failed:`, error);
      }
    }
    
    console.log('\\n✅ Demo completed!');
    console.log(`\\n🧹 Cleanup: rm -rf ${tempDir}`);
    
  } catch (error) {
    console.error('❌ Demo failed:', error);
    process.exit(1);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
```

## Hook Examples

### 1. Basic Tool Monitoring Hook

**File:** `preToolUse.sh`
```bash
#!/bin/bash
# Read JSON input from stdin
stdin_json=$(cat)

# Extract tool information
tool_name=$(echo "$stdin_json" | jq -r '.tool_name')
session_id=$(echo "$stdin_json" | jq -r '.session_id')

# Log tool execution
echo "Tool $tool_name executing in session $session_id" >> /tmp/tool-log.txt

# Allow tool to proceed (exit 0)
exit 0
```

### 2. File Write Protection Hook

**File:** `preToolUse.sh`  
```bash
#!/bin/bash
stdin_json=$(cat)

tool_name=$(echo "$stdin_json" | jq -r '.tool_name')
file_path=$(echo "$stdin_json" | jq -r '.tool_input.file_path // empty')

# Block writes to sensitive directories
if [[ "$tool_name" == "Write" && "$file_path" == /etc/* ]]; then
    echo "ERROR: Write to /etc/ blocked by security policy" >&2
    exit 1
fi

exit 0
```

### 3. Session Analysis Hook

**File:** `userPromptSubmit.sh`
```bash
#!/bin/bash
stdin_json=$(cat)

prompt=$(echo "$stdin_json" | jq -r '.prompt')
transcript_path=$(echo "$stdin_json" | jq -r '.transcript_path')

# Analyze conversation history  
message_count=$(cat "$transcript_path" | jq '.state.messages | length')
echo "Processing prompt (conversation has $message_count messages)" >&2

# Log user prompt for analytics
echo "$(date): $prompt" >> /tmp/prompt-log.txt

exit 0
```

### 4. Post-Tool Audit Hook

**File:** `postToolUse.sh`
```bash
#!/bin/bash
stdin_json=$(cat)

tool_name=$(echo "$stdin_json" | jq -r '.tool_name')
success=$(echo "$stdin_json" | jq -r '.tool_response.success // false')
cwd=$(echo "$stdin_json" | jq -r '.cwd')

# Create audit entry
audit_entry=$(echo "$stdin_json" | jq -c '{
    timestamp: now | todate,
    tool: .tool_name,
    success: .tool_response.success,
    project: .cwd,
    session: .session_id
}')

echo "$audit_entry" >> "$cwd/.wave-audit.jsonl"

exit 0
```

### 5. Session Cleanup Hook

**File:** `stop.sh`
```bash
#!/bin/bash
stdin_json=$(cat)

session_id=$(echo "$stdin_json" | jq -r '.session_id')
transcript_path=$(echo "$stdin_json" | jq -r '.transcript_path')

# Generate session summary
if [[ -f "$transcript_path" ]]; then
    message_count=$(cat "$transcript_path" | jq '.state.messages | length')
    echo "Session $session_id ended with $message_count messages" >&2
    
    # Optional: Clean up temporary files
    # rm -f "/tmp/session-${session_id}-*"
fi

exit 0
```

## Hook Configuration

### Wave Agent Configuration File

**File:** `.wave/config.json`
```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Write",
        "hooks": [
          {"type": "command", "command": "./hooks/preToolUse.sh"}
        ]
      }
    ],
    "PostToolUse": [
      {
        "hooks": [
          {"type": "command", "command": "./hooks/postToolUse.sh"}
        ]
      }
    ],
    "UserPromptSubmit": [
      {
        "hooks": [
          {"type": "command", "command": "./hooks/userPromptSubmit.sh"}
        ]
      }
    ],
    "Stop": [
      {
        "hooks": [
          {"type": "command", "command": "./hooks/stop.sh"}
        ]
      }
    ]
  }
}
```

## Testing Your Hooks

### 1. Run the Complete Example
```bash
cd packages/agent-sdk
pnpm tsx examples/hook-json-input.ts
```

### 2. Test Individual Hook Scripts
```bash
# Test with sample JSON input
echo '{
  "session_id": "test_session_123",
  "transcript_path": "/tmp/test_session.json",
  "cwd": "/home/user/project",
  "hook_event_name": "PreToolUse",
  "tool_name": "Write",
  "tool_input": {"file_path": "test.txt", "content": "hello"}
}' | ./hooks/preToolUse.sh
```

### 3. Check Field Extraction
```bash
# Verify each field is extracted correctly
test_json='{"session_id":"abc","tool_name":"Write","cwd":"/tmp"}'

echo "$test_json" | jq -r '.session_id'  # Should output: abc
echo "$test_json" | jq -r '.tool_name'   # Should output: Write
echo "$test_json" | jq -r '.cwd'         # Should output: /tmp
```

## Common Patterns

### Conditional Logic by Event Type
```bash
#!/bin/bash
stdin_json=$(cat)
event_type=$(echo "$stdin_json" | jq -r '.hook_event_name')

case "$event_type" in
    "PreToolUse")
        tool_name=$(echo "$stdin_json" | jq -r '.tool_name')
        echo "About to execute: $tool_name"
        ;;
    "PostToolUse")
        success=$(echo "$stdin_json" | jq -r '.tool_response.success')
        echo "Tool execution result: $success"
        ;;
    "UserPromptSubmit")
        prompt=$(echo "$stdin_json" | jq -r '.prompt')
        echo "User asked: $prompt"
        ;;
    "Stop")
        echo "Session ending"
        ;;
esac
```

### Session Data Access
```bash
#!/bin/bash
stdin_json=$(cat)
transcript_path=$(echo "$stdin_json" | jq -r '.transcript_path')

# Access full conversation history
if [[ -f "$transcript_path" ]]; then
    # Get latest user message
    latest_user_msg=$(cat "$transcript_path" | jq -r '
        .state.messages[] | 
        select(.role == "user") | 
        .content[-1].text' | tail -1)
    
    echo "Latest user message: $latest_user_msg"
fi
```

### Error Handling
```bash
#!/bin/bash
set -euo pipefail

# Safely read and parse JSON
if ! stdin_json=$(cat); then
    echo "ERROR: Failed to read stdin" >&2
    exit 1
fi

if ! session_id=$(echo "$stdin_json" | jq -r '.session_id' 2>/dev/null); then
    echo "ERROR: Invalid JSON or missing session_id" >&2
    exit 1
fi

# Continue with hook logic...
```

## Migration from Environment Variables

### Before (Environment Variables Only)
```bash
#!/bin/bash
echo "Project: $WAVE_PROJECT_DIR"
# Limited context available
```

### After (JSON Input + Environment Variables)  
```bash
#!/bin/bash
stdin_json=$(cat)

# Rich context from JSON
session_id=$(echo "$stdin_json" | jq -r '.session_id')
tool_name=$(echo "$stdin_json" | jq -r '.tool_name // "N/A"')
cwd=$(echo "$stdin_json" | jq -r '.cwd')

# Environment variable still available
echo "Project: $WAVE_PROJECT_DIR (same as $cwd)"
echo "Session: $session_id"
echo "Tool: $tool_name"
```

## Performance Tips

1. **Parse JSON once:** Store `stdin_json=$(cat)` at the beginning
2. **Extract needed fields only:** Use specific `jq` queries
3. **Cache session data:** If accessing transcript multiple times
4. **Use jq efficiently:** Combine multiple field extractions

```bash
# Efficient: Extract multiple fields in one jq call
eval $(echo "$stdin_json" | jq -r '
    "session_id=" + (.session_id | @sh) + 
    " tool_name=" + (.tool_name // "N/A" | @sh) + 
    " cwd=" + (.cwd | @sh)')
```

## Next Steps

1. **Create hooks directory:** `mkdir -p hooks && chmod +x hooks/*.sh`
2. **Start with simple examples:** Basic logging and monitoring hooks
3. **Test incrementally:** Validate each hook individually  
4. **Add error handling:** Ensure hooks fail gracefully
5. **Monitor performance:** Check hook execution times don't impact workflow