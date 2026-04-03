# Hooks System Quickstart Guide

**Feature**: Hooks Support  
**Audience**: Developers implementing the hooks system  
**Prerequisites**: Familiarity with Wave Agent monorepo structure

## Implementation Overview

The hooks system integrates into Wave Code's existing agent-sdk and CLI structure to provide automated command execution at key points in the AI workflow.

### Key Components

1. **HookManager** (agent-sdk): Core orchestration and execution
2. **HookMatcher** (agent-sdk): Pattern matching for tool events  
3. **Settings Integration** (agent-sdk): Configuration loading and merging
4. **Agent Integration** (agent-sdk): Lifecycle hook points

## Development Setup

### 1. Create Core Hook Types

```typescript
// packages/agent-sdk/src/hooks/types.ts
export type HookEvent = 'PreToolUse' | 'PostToolUse' | 'UserPromptSubmit' | 'Stop';

export interface HookCommand {
  type: 'command';
  command: string;
  async?: boolean;
  timeout?: number; // seconds
}

export interface HookEventConfig {
  matcher?: string;
  hooks: HookCommand[];
}

export interface HookConfiguration {
  hooks: Record<HookEvent, HookEventConfig[]>;
}
```

### 2. Implement Hook Manager

```typescript
// packages/agent-sdk/src/hooks/manager.ts
import { HookEvent, HookExecutionContext, HookExecutionResult } from './types';

export class HookManager {
  private config: HookConfiguration = { hooks: {} };
  
  loadConfiguration(userSettings?: any, projectSettings?: any): void {
    // Merge user and project hook configurations
    // Priority: project settings override user settings
  }
  
  async executeHooks(event: HookEvent, context: HookExecutionContext): Promise<HookExecutionResult[]> {
    // 1. Find matching hook configurations for event
    // 2. Filter by matcher pattern (for tool events)
    // 3. Execute commands in parallel with timeout
    // 4. Return results without throwing on failures
  }
}
```

### 3. Integrate with Agent Class

```typescript
// packages/agent-sdk/src/agent.ts
import { HookManager } from './hooks/manager';

export class Agent {
  private hookManager = new HookManager();
  
  // Add hook execution at lifecycle points:
  // - Before tool processing (PreToolUse)
  // - After tool completion (PostToolUse)  
  // - On prompt submission (UserPromptSubmit)
  // - When response cycle completes (Stop)
}
```

### 4. Settings Integration

```typescript  
// packages/agent-sdk/src/services/settings.ts
// Extend existing settings utilities to handle hook configuration
// Load from ~/.wave/settings.json and .wave/settings.json
// Merge configurations with project taking precedence
```

---

## Hook Exit Code Output Support (2025-11-15)

### Overview

Hooks can now communicate status and provide feedback through exit codes, stdout, and stderr, with different behaviors based on the hook event type.

### Exit Code Communication Pattern

```bash
#!/bin/bash
# Hook script example

# Success - stdout handling varies by hook type
echo "Hook executed successfully"
exit 0

# Blocking error - stderr shown to appropriate recipient  
echo "Critical error occurred" >&2
exit 2

# Non-blocking error - stderr shown to user, execution continues
echo "Warning: minor issue detected" >&2  
exit 1
```

### Hook Event Behaviors

| Hook Event | Exit 0 | Exit 2 | Other Exits |
|------------|--------|--------|-------------|
| **UserPromptSubmit** | stdout → agent context | stderr → user error, block prompt | stderr → user error |
| **PreToolUse** | continue execution | stderr → agent, block tool | stderr → user |  
| **PostToolUse** | continue execution | stderr → agent (tool ran) | stderr → user |
| **Stop** | allow stop | stderr → agent, block stop | stderr → user |

### Implementation Integration

#### 1. Hook Manager Enhancement

The existing `HookManager` is enhanced to process exit codes:

```typescript
// Enhanced hook execution with exit code processing
const results = await hookManager.executeHooks(event, context);

// Process results for message creation
for (const result of results) {
  if (result.exitCode === 2) {
    // Handle blocking error based on event type
    await handleBlockingError(event, result.stderr);
  } else if (result.exitCode === 0 && event === 'UserPromptSubmit') {
    // Inject stdout into agent context
    await injectHookContext(result.stdout);
  }
}
```

#### 2. Message Manager Integration

Hook results are integrated into the conversation flow using existing methods:

```typescript
// UserPromptSubmit success - inject context
if (result.exitCode === 0 && event === 'UserPromptSubmit') {
  messageManager.addUserMessage(result.stdout);
}

// PreToolUse blocking error - update tool block with error
if (result.exitCode === 2 && event === 'PreToolUse') {
  messageManager.updateToolBlock({
    toolId: context.toolId,
    result: result.stderr,
    success: false,
    error: "Hook blocked tool execution"
  });
}

// PostToolUse error feedback - append stderr to original result
if (result.exitCode === 2 && event === 'PostToolUse') {
  messageManager.updateToolBlock({
    toolId: context.toolId,
    result: `${originalResult}\n\nHook feedback: ${result.stderr}`,
    success: false
  });
}

// UserPromptSubmit blocking error - show user error only
if (result.exitCode === 2 && event === 'UserPromptSubmit') {
  messageManager.addErrorBlock(result.stderr);
}

// Stop blocking error - provide agent feedback  
if (result.exitCode === 2 && event === 'Stop') {
  messageManager.addUserMessage(`Stop blocked: ${result.stderr}`);
}

// Non-blocking errors - show user error
if (result.exitCode !== 0 && result.exitCode !== 2) {
  messageManager.addErrorBlock(result.stderr);
}
```

---

## Testing Strategy

### Unit Tests (packages/agent-sdk/tests/hooks/)
- HookManager configuration loading and validation
- Pattern matching logic for different matcher types
- Hook execution with mocked child processes
- Error handling and timeout scenarios

### Integration Tests (packages/agent-sdk/examples/hooks/)
- Create temporary directories for isolated test environments
- Change working directory to temp dir for realistic project simulation
- Real hook execution with sample scripts in temp project structure
- Cross-platform command execution testing
- Settings file loading and merging with temp .wave/settings.json files
- End-to-end workflow with actual tools and WAVE_PROJECT_DIR validation

---

## JSON Input Support

Hooks receive structured JSON data via stdin containing session information and event-specific data.

### JSON Input Format

#### Universal Fields
All hook events receive these base fields:
```bash
echo '{}' | jq -r '.session_id'      # Session identifier
echo '{}' | jq -r '.transcript_path' # Path to session file  
echo '{}' | jq -r '.cwd'             # Current working directory
echo '{}' | jq -r '.hook_event_name' # Event type
```

#### Event-Specific Fields
- **PreToolUse/PostToolUse**: `tool_name`, `tool_input`, `tool_response` (Post only)
- **UserPromptSubmit**: `prompt`

### Hook Examples (JSON Processing)

#### 1. File Write Protection Hook
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

#### 2. Session Analysis Hook
```bash
#!/bin/bash
stdin_json=$(cat)
transcript_path=$(echo "$stdin_json" | jq -r '.transcript_path')

# Analyze conversation history  
message_count=$(cat "$transcript_path" | jq '.state.messages | length')
echo "Processing prompt (conversation has $message_count messages)" >&2
exit 0
```

### Migration from Environment Variables

#### Before (Environment Variables Only)
```bash
#!/bin/bash
echo "Project: $WAVE_PROJECT_DIR"
```

#### After (JSON Input + Environment Variables)  
```bash
#!/bin/bash
stdin_json=$(cat)
session_id=$(echo "$stdin_json" | jq -r '.session_id')
cwd=$(echo "$stdin_json" | jq -r '.cwd')

echo "Project: $WAVE_PROJECT_DIR (same as $cwd)"
echo "Session: $session_id"
```

## Key Implementation Considerations

### Non-Blocking Execution
- Hook failures must never interrupt main Wave workflow
- Use asynchronous execution with proper timeout handling
- Log all hook activity for debugging without impacting performance

### Cross-Platform Compatibility  
- Use Node.js child_process.spawn() for maximum compatibility
- Handle shell command differences between platforms
- Test on Windows, macOS, and Linux environments

### Security & Isolation
- Execute hooks in isolated child processes
- Provide minimal environment variable injection
- Validate hook configurations to prevent malicious commands

### Performance Optimization
- Minimize memory footprint of hook execution
- Use parallel execution for multiple hooks
- Implement timeout mechanisms to prevent hanging processes
