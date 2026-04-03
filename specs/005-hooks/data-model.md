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
- `async?: boolean` - Whether to execute in background (default: false)
- `timeout?: number` - Custom timeout in seconds (default: 600)

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
- `PermissionRequest` - Triggered when Wave requests permission to use a tool
- `SubagentStop` - Triggered when a subagent finishes its response cycle
- `WorktreeCreate` - Triggered when a new worktree is created

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
- `tool_name?: string` - Name of tool (Pre/PostToolUse, PermissionRequest)
- `tool_input?: unknown` - Tool input parameters (Pre/PostToolUse, PermissionRequest)
- `tool_response?: unknown` - Tool execution result (PostToolUse)
- `prompt?: string` - User prompt text (UserPromptSubmit)
- `subagent_type?: string` - Subagent type when hook is executed by a subagent
- `name?: string` - Worktree name (WorktreeCreate)

**Validation Rules**:
- session_id must be non-empty
- transcript_path must be absolute path
- hook_event_name must match the actual event

**State Transitions**: Created per execution, serialized to JSON and written to stdin

---

## Hook Exit Code Output Support (2025-11-15)

### Hook Output Processing Context

Represents the processing context for interpreting hook execution results.

**Fields**:
- `event: HookEvent` - The hook event type (PreToolUse, PostToolUse, UserPromptSubmit, Stop)
- `exitCode: number` - The hook process exit code
- `stdout: string` - Hook standard output
- `stderr: string` - Hook standard error

**Validation Rules**:
- event must be valid HookEvent type
- exitCode interpretation: 0=success, 2=error (blocking only for UserPromptSubmit), other=non-blocking error

### Hook Behavior Mapping

#### Success Path (Exit Code 0)
**Entity Flow**:
1. HookExecutionResult with exitCode=0, success=true
2. Processing Context with normal execution flow
3. Message operations based on event type:
   - UserPromptSubmit: `addUserMessage(stdout)` to inject context
   - Other events: No message operations, normal execution continues

#### Blocking Error Path (Exit Code 2)  
**Entity Flow**:
1. HookExecutionResult with exitCode=2, success=false
2. Processing Context with event-specific behavior:
3. Message operations with error display:
   - PreToolUse: `updateToolBlock(toolId, {result: stderr, success: false})` - shows error to Wave Agent, execution continues
   - PostToolUse: `addUserMessage(stderr)` - shows error to Wave Agent, allows AI to continue processing
   - UserPromptSubmit: `addErrorBlock(stderr)` + `removeLastUserMessage()` - blocks prompt processing, shows error to user, erases prompt
   - Stop: `addUserMessage(stderr)` - shows error to Wave Agent, execution continues

#### Non-blocking Error Path (Other Exit Codes)
**Entity Flow**:
1. HookExecutionResult with exitCode≠0,2, success=false  
2. Processing Context with normal execution flow
3. User-visible error display: `addErrorBlock(stderr)` for all hook types
4. Execution continues normally

## Message Operation Strategy

```typescript
// UserPromptSubmit success (exit 0) - inject stdout as context
messageManager.addUserMessage(hookResult.stdout);

// PreToolUse blocking error (exit 2) - update tool block with error
messageManager.updateToolBlock({
  toolId: context.toolId,
  result: hookResult.stderr,
  success: false,
  error: "Hook blocked tool execution"
});

// PostToolUse error feedback (exit 2) - append stderr to tool result  
messageManager.updateToolBlock({
  toolId: context.toolId,
  result: `${originalToolResult}\n\nHook feedback: ${hookResult.stderr}`,
  success: false
});

// UserPromptSubmit blocking error (exit 2) - show user error and erase prompt
messageManager.addErrorBlock(hookResult.stderr);
messageManager.removeLastUserMessage();

// Stop blocking error (exit 2) - provide agent feedback
messageManager.addUserMessage(hookResult.stderr);

// Non-blocking errors - show user error
messageManager.addErrorBlock(hookResult.stderr);
```

## Testing Validation Patterns

### Agent-SDK Test Structure
All tests in `packages/agent-sdk/tests/agent/` use mocking to avoid real operations:

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import { Agent } from "@/agent.js";
import * as aiService from "@/services/aiService.js";
import * as hookService from "@/services/hook.js";
import { saveSession } from "@/services/session.js";

// Mock the session service
vi.mock("@/services/session", () => ({
  saveSession: vi.fn(),
  loadSession: vi.fn(() => Promise.resolve(null)),
  getLatestSession: vi.fn(() => Promise.resolve(null)),
  cleanupExpiredSessions: vi.fn(() => Promise.resolve()),
}));

// Mock AI Service to prevent real network calls
vi.mock("@/services/aiService");

// Mock hook service to control hook execution
vi.mock("@/services/hook");

// Test hook behavior through agent.messages validation
describe('Hook Exit Code Output', () => {
  let agent: Agent;

  beforeEach(async () => {
    // Create Agent instance with required parameters
    agent = await Agent.create({
      callbacks: {
        onMessagesChange: vi.fn(),
        onLoadingChange: vi.fn(),
      },
    });
    
    vi.clearAllMocks();
  });

  it('should inject context for UserPromptSubmit success', async () => {
    // Mock hook execution returning exit code 0 with stdout
    const mockExecuteHooks = vi.mocked(hookService.executeHooks);
    mockExecuteHooks.mockResolvedValue([{
      success: true,
      exitCode: 0,
      stdout: 'context data',
      stderr: '',
      duration: 100,
      timedOut: false
    }]);

    // Mock AI service to return simple response
    const mockCallAgent = vi.mocked(aiService.callAgent);
    mockCallAgent.mockResolvedValue({
      content: "Response with injected context",
    });

    await agent.sendMessage('test prompt');
    
    // Verify context injection through message validation
    expect(agent.messages).toHaveLength(2);
    expect(agent.messages[1].blocks[0].content).toContain('context data');
  });

  it('should block UserPromptSubmit with exit code 2', async () => {
    // Mock hook execution returning exit code 2 with stderr
    const mockExecuteHooks = vi.mocked(hookService.executeHooks);
    mockExecuteHooks.mockResolvedValue([{
      success: false,
      exitCode: 2,
      stdout: '',
      stderr: 'Invalid prompt format',
      duration: 100,
      timedOut: false
    }]);

    await agent.sendMessage('invalid prompt');
    
    // Verify error block added and user message removed
    const errorBlocks = agent.messages.filter(msg => 
      msg.blocks?.some(block => block.type === 'error')
    );
    expect(errorBlocks).toHaveLength(1);
    expect(errorBlocks[0].blocks[0].content).toBe('Invalid prompt format');
    
    // Verify user message was removed (prompt erased)
    const userMessages = agent.messages.filter(msg => msg.role === 'user');
    expect(userMessages).toHaveLength(0);
  });
});
```

All testing is contained within the test directory structure with comprehensive mocking using vitest patterns.

---

## JSON Input Schema

### Base JSON Structure

All hook events receive a consistent base structure via stdin:

```typescript
interface HookJsonInput {
  session_id: string;           // Unique session identifier
  transcript_path: string;      // Absolute path to session file
  cwd: string;                 // Current working directory  
  hook_event_name: HookEvent;  // "PreToolUse" | "PostToolUse" | "UserPromptSubmit" | "Stop" | "PermissionRequest" | "SubagentStop" | "WorktreeCreate"
  
  // Event-specific fields (optional, based on event type)
  tool_name?: string;
  tool_input?: unknown;
  tool_response?: unknown;
  prompt?: string;
  subagent_type?: string;
  name?: string;
}
```

#### PermissionRequest Event
```json
{
  "session_id": "wave_session_abc123_xyz789",
  "transcript_path": "/home/user/.wave/sessions/session_xyz789.json",
  "cwd": "/home/user/project",
  "hook_event_name": "PermissionRequest",
  "tool_name": "Write",
  "tool_input": {
    "file_path": "/home/user/project/src/index.ts",
    "content": "console.log('Hello World');"
  }
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
