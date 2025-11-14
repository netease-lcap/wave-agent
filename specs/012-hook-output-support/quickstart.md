# Hook Output Support - Quickstart

**Target Audience**: SDK developers using hooks  
**Time to Complete**: 5-10 minutes  
**Prerequisites**: Basic understanding of Wave hooks

## Overview

Hook Output Support let your hooks control Wave's behavior through JSON output or exit codes. You can:
- Block or allow tool execution
- Request user confirmation 
- Modify tool inputs
- Display warnings and info messages

## Basic Usage

### Exit Codes (Simple)
```bash
#!/bin/bash
# .wave/hooks/pre-tool-use/simple-check.sh

if [[ "$TOOL_NAME" == "bash" ]] && echo "$TOOL_INPUT" | grep -q "rm"; then
  echo "Dangerous command detected" >&2
  exit 2  # Block execution
fi

exit 0  # Allow execution
```

### JSON Output (Advanced)
```bash
#!/bin/bash
# .wave/hooks/pre-tool-use/advanced-check.sh

if [[ "$TOOL_NAME" == "write" ]]; then
  echo '{
    "permissionDecision": "ask",
    "reason": "About to write to file. Continue?",
    "warnings": ["This will modify the filesystem"]
  }'
fi
```

## Common Patterns

### 1. Block Dangerous Operations
```bash
#!/bin/bash
# Block network access
if echo "$TOOL_INPUT" | grep -qE "(curl|wget|ssh)"; then
  echo '{"permissionDecision": "deny", "reason": "Network access blocked"}'
  exit 1
fi
```

### 2. Request User Confirmation
```bash
#!/bin/bash  
# Ask before file deletion
if [[ "$TOOL_NAME" == "bash" ]] && echo "$TOOL_INPUT" | grep -q "rm.*-rf"; then
  echo '{
    "permissionDecision": "ask",
    "reason": "This will permanently delete files. Are you sure?"
  }'
fi
```

### 3. Modify Tool Inputs
```bash
#!/bin/bash
# Add safety flags to commands
if [[ "$TOOL_NAME" == "bash" ]] && echo "$TOOL_INPUT" | grep -q "^rm "; then
  echo '{
    "permissionDecision": "allow",
    "toolInputModifications": {
      "command": "'$TOOL_INPUT' --interactive"
    },
    "info": ["Added --interactive flag for safety"]
  }'
fi
```

### 4. PostToolUse Feedback
```bash
#!/bin/bash
# Provide success feedback
if [[ "$TOOL_SUCCESS" == "true" && "$TOOL_NAME" == "write" ]]; then
  file_count=$(find . -name "*.js" | wc -l)
  echo '{
    "info": ["File written. Total JS files: '$file_count'"]
  }'
fi
```

## JSON Output Reference

### PreToolUse Hook Output
```json
{
  "permissionDecision": "ask|allow|deny",
  "reason": "Human readable explanation",
  "warnings": ["Warning message 1", "Warning 2"],
  "info": ["Info message 1"],
  "toolInputModifications": {
    "param1": "new_value"
  }
}
```

### PostToolUse Hook Output  
```json
{
  "decision": "block|continue", 
  "reason": "Why blocked/continued",
  "info": ["Success messages"],
  "additionalContext": "Extra info for Wave AI"
}
```

## Exit Code Reference

- `0`: Allow/continue (success)
- `2`: Block operation (shows stderr to user)
- `1, 3-255`: Show error, but continue

## Integration with SDK

### Agent Callbacks
```typescript
const agent = await Agent.create({
  callbacks: {
    onPermissionRequired: (request) => {
      // Show permission dialog to user
      showConfirmDialog(request);
    }
  }
});
```

### Chat Context
```typescript
const { pendingPermissions, resolvePermission } = useChat();

// Resolve permission when user decides
resolvePermission(requestId, userAllowed);
```

### Message Blocks
Hooks automatically create message blocks:
- `warnings` → WarnBlock (yellow warning UI)
- `info` → WarnBlock (info styling) 
- Hook execution → HookBlock (shows hook details)

## Best Practices

1. **Keep JSON simple** - Only include necessary fields
2. **Provide clear reasons** - Help users understand why permission is needed
3. **Use exit codes for simple cases** - JSON for complex control flow
4. **Test with invalid JSON** - Hooks should fall back to exit codes gracefully
5. **Handle timeouts** - Permission requests timeout after 30 seconds

## Testing

```typescript
// Test hook output parsing
const result = {
  exitCode: 0,
  stdout: '{"permissionDecision": "ask", "reason": "Test"}',
  stderr: '',
  hookEvent: 'PreToolUse'
};

const parsed = parseHookOutput(result);
expect(parsed.permissionDecision).toBe('ask');
```

## Troubleshooting

### Common Issues

1. **Hook returns JSON but falls back to exit code**
   - Check JSON syntax: `echo '{"permissionDecision": "ask"}' | jq .`
   - Ensure required fields are present for hook type

2. **Permission dialog not showing**
   - Verify `permissionDecision` is set to `"ask"`
   - Check that callbacks are properly configured in Agent

3. **Message blocks not rendering**
   - Ensure hook outputs valid `warnings` or `info` arrays
   - Check that UI components handle new block types

### Debug Commands

```bash
# Test hook JSON output
echo '{"permissionDecision": "ask", "reason": "Test"}' | jq .

# Test hook execution manually
cd /path/to/project && TOOL_NAME="bash" TOOL_INPUT="ls" ./hooks/pre-tool-use/test-hook.sh
```