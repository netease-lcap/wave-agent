# Hook Output Processing Contract

Simplified approach using existing MessageManager methods for hook exit code output support.

## Core Interfaces

### IHookOutputProcessor

Process hook execution results using existing message operations.

**Methods:**
- `processHookOutput(event, result, context, messageManager)` - Process hook execution results
- `shouldBlock(exitCode)` - Determine if hook result should block further execution (returns true for exitCode === 2)

### HookExecutionResult (Current Interface)

Uses the existing interface - no changes needed to interface definition.

**Current Fields** (already available in codebase):
- `success: boolean` - Overall execution success status
- `exitCode?: number` - Process exit code (optional field, already exists)
- `stdout?: string` - Standard output content from hook process (optional field, already exists)  
- `stderr?: string` - Standard error content from hook process (optional field, already exists)
- `duration: number` - Execution time in milliseconds
- `timedOut: boolean` - Whether execution exceeded timeout

**Implementation Enhancement:**
- Establish exit code interpretation: 0=success, 2=blocking error, other=non-blocking error
- Implement processing logic for stdout/stderr based on exit codes

### HookProcessingResult

Indicates actions taken via MessageManager operations.

**Fields:**
- `action` - Action taken based on hook result:
  - `'continue'` - Normal execution continues
  - `'block-tool'` - Tool execution blocked (PreToolUse)
  - `'block-prompt'` - Prompt processing blocked (UserPromptSubmit)
  - `'block-stop'` - Stop operation blocked (Stop)
  - `'context-injected'` - Context injected (UserPromptSubmit success)
  - `'error-displayed'` - Error displayed to user/agent

- `metadata` - Processing metadata:
  - `exitCode: number` - Hook exit code
  - `event: HookEvent` - Hook event type
  - `blocked: boolean` - Whether execution was blocked
  - `messageOperationUsed` - MessageManager method used: `'addUserMessage'` | `'addErrorBlock'` | `'updateToolBlock'` | `'none'`

## Message Manager Integration

Uses existing MessageManager methods - no enhancements needed.

### Integration Methods

**Context Injection:**
- **Purpose**: UserPromptSubmit success - inject stdout as context
- **Implementation**: `messageManager.addUserMessage(stdout)`

**Tool Result Updates:**
- **Purpose**: Tool blocking/feedback - update tool block with hook result
- **Implementation**: `messageManager.updateToolBlock({toolId, result: stderr/combined, success: false})`

**User Error Display:**
- **Purpose**: Show hook errors to user
- **Implementation**: `messageManager.addErrorBlock(stderr)`

**User Message Removal:**
- **Purpose**: Remove last user message (for UserPromptSubmit blocking errors)  
- **Implementation**: `messageManager.removeLastUserMessage()` - **NEW METHOD REQUIRED**

**Agent Feedback:**
- **Purpose**: Provide hook feedback to agent
- **Implementation**: `messageManager.addUserMessage(stderr)`

## Hook Event Processing Patterns

Simple routing using existing MessageManager methods.

### UserPromptSubmit
- **Exit Code 0**: `messageManager.addUserMessage(stdout)` - inject context
- **Exit Code 2**: `messageManager.addErrorBlock(stderr)` + `messageManager.removeLastUserMessage()` - user-visible blocking error, erase prompt
- **Other Exit Codes**: `messageManager.addErrorBlock(stderr)` - user-visible non-blocking error

### PreToolUse
- **Exit Code 0**: Continue (no message operations)
- **Exit Code 2**: `messageManager.updateToolBlock({result: stderr, success: false})` - block tool execution
- **Other Exit Codes**: `messageManager.addErrorBlock(stderr)` - user-visible non-blocking error

### PostToolUse
- **Exit Code 0**: Continue (no message operations)
- **Exit Code 2**: `messageManager.updateToolBlock({result: original + stderr, success: false})` - append hook error to tool result
- **Other Exit Codes**: `messageManager.addErrorBlock(stderr)` - user-visible non-blocking error

### Stop
- **Exit Code 0**: Continue (no message operations)
- **Exit Code 2**: `messageManager.addUserMessage(stderr)` - provide agent feedback, block stop operation
- **Other Exit Codes**: `messageManager.addErrorBlock(stderr)` - user-visible non-blocking error

## Implementation Strategy

1. **No Message Block Enhancements**: Use existing ToolBlock, ErrorBlock, and User Message structures
2. **Existing MessageManager Methods**: Leverage `addUserMessage`, `addErrorBlock`, `updateToolBlock`
3. **Simple Exit Code Routing**: 0=success, 2=blocking, other=non-blocking
4. **Event-Specific Behavior**: Different message operations based on hook event type and exit code
5. **Backward Compatibility**: All changes are additive to existing interfaces