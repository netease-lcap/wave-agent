# API Contracts: Hook JSON Input Support

**Phase 1** | **Date**: 2024-12-19 | **Feature**: Hook JSON Input Support

## Core Interface Contracts

### HookJsonInput Interface

**Contract**: Standard JSON structure passed to all hooks via stdin

```typescript
interface HookJsonInput {
  // Required fields for all events
  session_id: string;           // Format: "wave_session_{uuid}_{shortId}"
  transcript_path: string;      // Format: "~/.wave/sessions/session_{shortId}.json"  
  cwd: string;                 // Absolute path to current working directory
  hook_event_name: HookEvent;  // "PreToolUse" | "PostToolUse" | "UserPromptSubmit" | "Stop"
  
  // Optional fields based on event type
  tool_name?: string;          // Present for PreToolUse, PostToolUse
  tool_input?: unknown;        // Present for PreToolUse, PostToolUse
  tool_response?: unknown;     // Present for PostToolUse only
  prompt?: string;             // Present for UserPromptSubmit only
}
```

**Guarantees:**
- All required fields always present and non-empty
- Optional fields present only for relevant events
- JSON is valid and well-formed
- Delivered within 100ms of hook process startup

**Breaking Changes:**
- None - this is a new feature with backward compatibility

---

### ExtendedHookExecutionContext Interface

**Contract**: Internal interface for passing extended context data

```typescript
interface ExtendedHookExecutionContext extends HookExecutionContext {
  sessionId?: string;          // Session identifier for JSON construction
  toolInput?: unknown;         // Tool input parameters (PreToolUse/PostToolUse)
  toolResponse?: unknown;      // Tool execution result (PostToolUse only)
  userPrompt?: string;         // User prompt text (UserPromptSubmit only)
}
```

**Guarantees:**
- Extends existing `HookExecutionContext` without breaking changes
- Additional fields populated only when available
- sessionId derived from existing session management
- Backward compatible with existing code

---

### HookExecutor.executeCommand Contract

**Contract**: Enhanced command execution with JSON stdin support

```typescript
interface IHookExecutor {
  executeCommand(
    command: string,
    context: HookExecutionContext,
    options?: HookExecutionOptions,
  ): Promise<HookExecutionResult>;
}
```

**Enhanced Behavior:**
- Constructs JSON input from context data  
- Writes JSON to child process stdin before command execution
- Handles stdin write failures gracefully (non-blocking)
- Maintains existing return value contract
- Preserves all existing functionality

**Error Handling:**
- JSON construction failures: Log warning, continue execution
- Stdin write failures: Log warning, continue execution  
- Process spawn failures: Existing error handling unchanged
- Never fails hook execution due to JSON input issues

---

## Event-Specific Contracts

### PreToolUse Event Contract

**Trigger Point**: Before tool execution in `aiManager.ts`

**JSON Input Guarantee:**
```json
{
  "session_id": "wave_session_abc123_def456",
  "transcript_path": "/home/user/.wave/sessions/session_def456.json",
  "cwd": "/home/user/project", 
  "hook_event_name": "PreToolUse",
  "tool_name": "Write",
  "tool_input": {
    "file_path": "/home/user/project/src/index.ts",
    "content": "console.log('Hello');"
  }
}
```

**Field Contracts:**
- `tool_name`: Exact tool name being executed (e.g., "Write", "Read", "Bash")
- `tool_input`: Complete tool parameters as passed to tool execution
- Session data available via `transcript_path` for context analysis

---

### PostToolUse Event Contract

**Trigger Point**: After tool execution completion in `aiManager.ts`

**JSON Input Guarantee:**
```json
{
  "session_id": "wave_session_abc123_def456",
  "transcript_path": "/home/user/.wave/sessions/session_def456.json", 
  "cwd": "/home/user/project",
  "hook_event_name": "PostToolUse",
  "tool_name": "Write",
  "tool_input": {
    "file_path": "/home/user/project/src/index.ts",
    "content": "console.log('Hello');"
  },
  "tool_response": {
    "success": true,
    "message": "File written successfully",
    "file_path": "/home/user/project/src/index.ts"
  }
}
```

**Field Contracts:**
- `tool_name`: Same as PreToolUse
- `tool_input`: Same parameters as passed to PreToolUse  
- `tool_response`: Complete tool execution result (success/failure + details)
- Tool response structure varies by tool type

---

### UserPromptSubmit Event Contract

**Trigger Point**: When user submits prompt in `agent.ts`

**JSON Input Guarantee:**
```json
{
  "session_id": "wave_session_abc123_def456",
  "transcript_path": "/home/user/.wave/sessions/session_def456.json",
  "cwd": "/home/user/project",
  "hook_event_name": "UserPromptSubmit", 
  "prompt": "Please create a TypeScript file with hello world"
}
```

**Field Contracts:**
- `prompt`: Complete user input text as submitted
- No tool-related fields present
- Session context available for conversation history analysis

---

### Stop Event Contract

**Trigger Point**: When session ends in `aiManager.ts`

**JSON Input Guarantee:**
```json
{
  "session_id": "wave_session_abc123_def456",
  "transcript_path": "/home/user/.wave/sessions/session_def456.json",
  "cwd": "/home/user/project",
  "hook_event_name": "Stop"
}
```

**Field Contracts:**
- Minimal required fields only
- No event-specific fields
- Session file contains final state for cleanup operations

---

## Integration Point Contracts

### AIManager Integration Contract

**Modified Methods:**
- `executeHooks()` calls enhanced with tool context data
- Context collection before/after tool execution
- Session ID propagation to hook manager

**Data Flow Contract:**
```typescript
// PreToolUse: Collect before tool execution
const preContext: ExtendedHookExecutionContext = {
  ...existingContext,
  sessionId: this.sessionId,
  toolInput: toolArguments
};

// PostToolUse: Collect after tool execution  
const postContext: ExtendedHookExecutionContext = {
  ...existingContext,
  sessionId: this.sessionId,
  toolInput: toolArguments,
  toolResponse: toolResult
};
```

---

### Agent Integration Contract

**Modified Methods:**
- `handleUserPrompt()` enhanced with prompt data collection
- Session ID propagation to hook manager

**Data Flow Contract:**
```typescript
// UserPromptSubmit: Collect during prompt processing
const promptContext: ExtendedHookExecutionContext = {
  ...existingContext,
  sessionId: this.sessionId,
  userPrompt: promptContent
};
```

---

## Backward Compatibility Contracts

### Existing Hook Process Contract

**Guarantee**: Hooks not reading stdin continue to work unchanged

**Implementation:**
- JSON written to stdin but doesn't block if not read
- Environment variables maintained (`WAVE_PROJECT_DIR`)
- Process execution flow unchanged
- Exit code handling unchanged

### Hook Configuration Contract

**Guarantee**: No changes to hook configuration format

**Implementation:**
- Existing `.wave/config.json` structure unchanged
- Hook command specifications unchanged  
- Matcher patterns unchanged
- Event configuration unchanged

---

## Performance Contracts

### JSON Input Delivery Contract

**Guarantee**: JSON data available to hook process within 100ms

**Implementation:**
- JSON construction: <10ms typical
- Stdin write operation: <5ms typical  
- Process startup unchanged
- Total overhead: <50ms additional per hook

### Memory Usage Contract

**Guarantee**: Minimal memory overhead for JSON operations

**Implementation:**
- JSON payload size: 500-2000 bytes typical
- No persistent JSON storage
- Garbage collection after stdin write
- No memory leaks from JSON operations

---

## Error Handling Contracts

### Graceful Degradation Contract

**Guarantee**: Hook execution never fails due to JSON input issues

**Implementation:**
- JSON construction errors: Log warning, use minimal JSON
- Stdin write errors: Log warning, continue without JSON
- Process spawn errors: Existing error handling unchanged
- Invalid session data: Use fallback values

### Logging Contract

**Guarantee**: JSON input issues logged for debugging

**Implementation:**
- JSON construction failures logged at WARN level
- Stdin write failures logged at WARN level
- Performance issues logged at DEBUG level
- No sensitive data in logs (session IDs only)