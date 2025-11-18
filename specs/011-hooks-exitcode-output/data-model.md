# Data Model: Hook Exit Code Output Support

## Core Entities

### HookExecutionResult (Current Interface)
Represents the outcome of hook command execution with exit code support.

**Current Fields** (already available in codebase):
- `success: boolean` - Overall execution success status
- `exitCode?: number` - Process exit code (optional field, already exists)
- `stdout?: string` - Standard output content from hook process (optional field, already exists)
- `stderr?: string` - Standard error content from hook process (optional field, already exists)
- `duration: number` - Execution time in milliseconds
- `timedOut: boolean` - Whether execution exceeded timeout

**Enhancement Required:**
- Establish exit code interpretation semantics: 0=success, 2=blocking error, other=non-blocking error
- Implement hook output processing logic using the existing fields

**Validation Rules:**
- exitCode must be a valid integer when present
- stdout/stderr must be trimmed strings
- duration must be non-negative number
- success should align with exitCode (0 = true, non-zero = false unless timedOut)

**State Transitions:**
- Execution starts with undefined exitCode
- Process completion sets exitCode and output fields
- Timeout sets timedOut=true and success=false

### Hook Output Processing Context (New)
Represents the processing context for interpreting hook execution results.

**New Fields** (internal processing context, not an interface enhancement):
- `event: HookEvent` - The hook event type (PreToolUse, PostToolUse, UserPromptSubmit, Stop)
- `exitCode: number` - The hook process exit code
- `stdout: string` - Hook standard output
- `stderr: string` - Hook standard error

**Note**: This is a new internal processing context, separate from the existing `HookExecutionContext` which is passed TO hooks during execution.

**Validation Rules:**
- event must be valid HookEvent type
- exitCode interpretation: 0=success, 2=error (blocking only for UserPromptSubmit), other=non-blocking error

**Relationships:**
- Belongs to a HookExecutionResult
- Determines Message Operation strategy based on event type and exit code

## Hook Behavior Mapping

### Success Path (Exit Code 0)
**Entity Flow:**
1. HookExecutionResult with exitCode=0, success=true
2. Processing Context with normal execution flow
3. Message operations based on event type:
   - UserPromptSubmit: `addUserMessage(stdout)` to inject context
   - Other events: No message operations, normal execution continues

### Blocking Error Path (Exit Code 2)  
**Entity Flow:**
1. HookExecutionResult with exitCode=2, success=false
2. Processing Context with event-specific behavior:
3. Message operations with error display:
   - PreToolUse: `updateToolBlock(toolId, {result: stderr, success: false})` - shows error to Wave Agent, execution continues
   - PostToolUse: `addUserMessage(stderr)` - shows error to Wave Agent, allows AI to continue processing
   - UserPromptSubmit: `addErrorBlock(stderr)` + `removeLastUserMessage()` - blocks prompt processing, shows error to user, erases prompt
   - Stop: `addUserMessage(stderr)` - shows error to Wave Agent, execution continues

### Non-blocking Error Path (Other Exit Codes)
**Entity Flow:**
1. HookExecutionResult with exitCode≠0,2, success=false  
2. Processing Context with normal execution flow
3. User-visible error display: `addErrorBlock(stderr)` for all hook types
4. Execution continues normally

## Message Operation Strategy

### MessageManager Method Usage

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

## Persistence Model

### Session Storage
Hook execution results are reflected in the persistent session message storage:
- ToolBlocks persist hook error information in tool execution history
- ErrorBlocks persist user-visible hook errors in conversation history  
- User messages persist Stop hook errors in conversation flow

### Message Validation
All hook-generated message blocks must pass existing validation:
- ToolBlocks: valid id, name, result fields
- ErrorBlocks: non-empty content field
- User Messages: valid content structure

The data model maintains backward compatibility while extending the system to handle rich hook output semantics through the existing message block architecture.