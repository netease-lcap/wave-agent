# Data Model: Hooks System

**Date**: 2024-12-19  
**Feature**: Hooks Support  
**Source**: Extracted from functional requirements FR-001 through FR-010

## Core Entities

### HookConfiguration
**Purpose**: Root configuration structure for all hook definitions  
**Location**: ~/.wave/settings.json and .wave/settings.json
**Service**: `src/services/hook.ts` (Settings functions)

**Fields**:
- `hooks`: Record<HookEvent, HookEventConfig[]> - Maps hook events to their configurations

**Validation Rules**:
- Must contain valid HookEvent keys only
- Each event can have multiple configurations for different matchers

**State Transitions**: Static configuration, loaded at runtime

---

### HookEventConfig  
**Purpose**: Configuration for hooks responding to a specific event  

**Fields**:
- `matcher?: string` - Optional pattern for tool-based events (PreToolUse, PostToolUse)
- `hooks: HookCommand[]` - Array of commands to execute

**Validation Rules**:
- matcher is required for PreToolUse and PostToolUse events
- matcher should be omitted for UserPromptSubmit and Stop events
- hooks array must contain at least one HookCommand

**Relationships**: 
- Contains multiple HookCommand instances
- Belongs to a specific HookEvent

---

### HookCommand
**Purpose**: Individual command definition for execution

**Fields**:
- `type: "command"` - Command type (currently only "command" supported)  
- `command: string` - Bash command to execute

**Validation Rules**:
- type must be "command"
- command must be non-empty string
- command can reference $WAVE_PROJECT_DIR environment variable

**State Transitions**: Immutable once loaded

---

### HookEvent  
**Purpose**: Enumeration of supported hook trigger points

**Values**:
- `PreToolUse` - Triggered before tool parameter processing
- `PostToolUse` - Triggered after successful tool completion
- `UserPromptSubmit` - Triggered when user submits a prompt  
- `Stop` - Triggered when AI response cycle completes

**Validation Rules**: Must be one of the four defined values

---

### HookExecutionContext
**Purpose**: Runtime context provided to hook during execution
**Location**: `src/types/hooks.ts`

**Fields**:
- `event: HookEvent` - The triggering event
- `toolName?: string` - Name of tool for tool-based events
- `projectDir: string` - Absolute path to project directory
- `timestamp: Date` - Execution timestamp

**Validation Rules**:
- toolName required for PreToolUse and PostToolUse events
- projectDir must be absolute path
- timestamp must be valid Date

**State Transitions**: Created per execution, immutable during hook execution

---

### HookExecutionResult
**Purpose**: Result of hook command execution

**Fields**:
- `success: boolean` - Whether command executed successfully
- `exitCode?: number` - Process exit code  
- `stdout?: string` - Standard output from command
- `stderr?: string` - Standard error from command
- `duration: number` - Execution time in milliseconds
- `timedOut: boolean` - Whether execution was terminated due to timeout

**Validation Rules**:
- duration must be positive number
- exitCode should be provided if process completed
- success should correlate with exitCode (0 = success)

**State Transitions**: Created once per hook execution, immutable after creation

---

### HookJsonInput
**Purpose**: Structured data provided to hook via stdin
**Location**: `src/types/hooks.ts`

**Fields**:
- `session_id: string` - Unique session identifier
- `transcript_path: string` - Absolute path to session file
- `cwd: string` - Current working directory
- `hook_event_name: HookEvent` - The triggering event
- `tool_name?: string` - Name of tool (Pre/PostToolUse)
- `tool_input?: unknown` - Tool input parameters (Pre/PostToolUse)
- `tool_response?: unknown` - Tool execution result (PostToolUse)
- `prompt?: string` - User prompt text (UserPromptSubmit)

**Validation Rules**:
- session_id must be non-empty
- transcript_path must be absolute path
- hook_event_name must match the actual event

**State Transitions**: Created per execution, serialized to JSON and written to stdin

---

## JSON Input Schema

### Base JSON Structure

All hook events receive a consistent base structure via stdin:

```typescript
interface HookJsonInput {
  session_id: string;           // Unique session identifier
  transcript_path: string;      // Absolute path to session file
  cwd: string;                 // Current working directory  
  hook_event_name: HookEvent;  // "PreToolUse" | "PostToolUse" | "UserPromptSubmit" | "Stop"
  
  // Event-specific fields (optional, based on event type)
  tool_name?: string;
  tool_input?: unknown;
  tool_response?: unknown;
  prompt?: string;
}
```

### Event-Specific Schemas

#### PreToolUse Event
```json
{
  "session_id": "wave_session_abc123_xyz789",
  "transcript_path": "/home/user/.wave/sessions/session_xyz789.json",
  "cwd": "/home/user/project",
  "hook_event_name": "PreToolUse",
  "tool_name": "Write",
  "tool_input": {
    "file_path": "/home/user/project/src/index.ts",
    "content": "console.log('Hello World');"
  }
}
```

#### PostToolUse Event
```json
{
  "session_id": "wave_session_abc123_xyz789", 
  "transcript_path": "/home/user/.wave/sessions/session_xyz789.json",
  "cwd": "/home/user/project",
  "hook_event_name": "PostToolUse",
  "tool_name": "Write",
  "tool_input": {
    "file_path": "/home/user/project/src/index.ts",
    "content": "console.log('Hello World');"
  },
  "tool_response": {
    "success": true,
    "message": "File written successfully"
  }
}
```

#### UserPromptSubmit Event
```json
{
  "session_id": "wave_session_abc123_xyz789",
  "transcript_path": "/home/user/.wave/sessions/session_xyz789.json", 
  "cwd": "/home/user/project",
  "hook_event_name": "UserPromptSubmit",
  "prompt": "Please create a new TypeScript file with hello world"
}
```

#### Stop Event
```json
{
  "session_id": "wave_session_abc123_xyz789",
  "transcript_path": "/home/user/.wave/sessions/session_xyz789.json",
  "cwd": "/home/user/project", 
  "hook_event_name": "Stop"
}
```

## Type System Extensions

### Core Type Definitions

```typescript
// types/hooks.ts - New JSON input types
export interface HookJsonInput {
  session_id: string;
  transcript_path: string;
  cwd: string;
  hook_event_name: HookEvent;
  tool_name?: string;
  tool_input?: unknown;
  tool_response?: unknown;
  prompt?: string;
}

// Extended execution context for internal use
export interface ExtendedHookExecutionContext extends HookExecutionContext {
  sessionId?: string;
  toolInput?: unknown;
  toolResponse?: unknown;
  userPrompt?: string;
}

// JSON construction helper
export interface JsonInputBuilder {
  buildJsonInput(context: ExtendedHookExecutionContext): HookJsonInput;
}
```

## Data Flow Architecture

### Context Collection Points

```mermaid
graph TD
    A[Agent/AIManager] --> B[Collect Context Data]
    B --> C[Build Extended Context]
    C --> D[HookManager.executeHooks]
    D --> E[executeCommand (services/hook.ts)]
    E --> F[Build JSON Input]
    F --> G[Write to Process Stdin]
    G --> H[Hook Process Receives JSON]
```

## Error Handling Strategy

### JSON Construction Errors
```typescript
// Graceful fallback for malformed data
function safeJsonConstruction(context: ExtendedHookExecutionContext): HookJsonInput {
  try {
    return buildJsonInput(context);
  } catch (error) {
    // Return minimal valid JSON on construction failure
    return {
      session_id: context.sessionId || 'unknown',
      transcript_path: context.sessionId ? getSessionFilePath(context.sessionId) : '',
      cwd: context.projectDir,
      hook_event_name: context.event
    };
  }
}
```

### Stdin Operation Errors
```typescript
// Handle stdin write failures gracefully
async function writeJsonToStdin(process: ChildProcess, json: HookJsonInput): Promise<void> {
  return new Promise((resolve) => {
    if (!process.stdin) {
      resolve(); // No stdin available, continue
      return;
    }
    
    try {
      process.stdin.write(JSON.stringify(json, null, 2) + '\n');
      process.stdin.end();
      resolve();
    } catch (error) {
      // Log error but don't fail hook execution
      logger?.warn('Failed to write JSON to hook stdin:', error);
      resolve();
    }
  });
}
```

## Configuration Example

```json
{
  "hooks": {
    "PostToolUse": [
      {
        "matcher": "Edit|Write",
        "hooks": [
          {
            "type": "command", 
            "command": "eslint --fix \"$WAVE_PROJECT_DIR\"/src"
          },
          {
            "type": "command",
            "command": "prettier --write \"$WAVE_PROJECT_DIR\"/src"
          }
        ]
      }
    ],
    "UserPromptSubmit": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "\"$WAVE_PROJECT_DIR\"/.wave/validate-prompt.sh"
          }
        ]
      }
    ]
  }
}
```