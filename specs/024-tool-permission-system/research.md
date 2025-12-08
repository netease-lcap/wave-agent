# Research Report: Tool Permission System

## Decision: Tool Execution Interception Pattern

**What was chosen**: Individual tool modification pattern, inserting permission checks within each restricted tool's execute method after validation/diff generation but before the actual operation.

**Why chosen**: 
- Follows user requirement exactly: "canUseTool should be inserted in tool's execute function, after validation and diff, before real operation"
- Ensures permission check happens at the precise moment specified (after validation/diff, before real operation)
- Each tool controls its own permission check timing
- Validation and diff generation remain unchanged in existing flow

**Alternatives considered**:
- ToolManager-level interception: Rejected because validation/diff happens inside plugin.execute(), causing permission checks to occur before validation
- AOP/proxy pattern: Rejected as overly complex for this use case
- Agent-level interception: Rejected as it would miss direct tool calls and timing requirements

## Decision: Permission Callback Architecture

**What was chosen**: Optional `canUseTool` callback in `AgentOptions` with Promise-based API returning `{behavior: 'allow'} | {behavior: 'deny', message: string}`.

**Why chosen**:
- Provides flexibility for custom implementations
- Non-blocking async design allows for complex authorization workflows  
- Simple interface reduces implementation complexity
- Follows existing callback pattern in agent-sdk (AgentCallbacks)

**Alternatives considered**:
- Synchronous callback: Rejected due to potential blocking operations
- Event-based system: Rejected as overly complex for this use case
- Plugin-based permissions: Rejected to maintain simplicity

## Decision: CLI Permission Mode Integration

**What was chosen**: Add `permissionMode` field to `AgentOptions` interface, set via new `--dangerously-skip-permissions` CLI flag.

**Why chosen**:
- Leverages existing CLI option parsing with yargs
- Clear flag naming indicates dangerous operation
- Minimal changes to existing CLI structure
- Follows established pattern of configuration through AgentOptions

**Alternatives considered**:
- Environment variable: Rejected for less discoverability
- Separate config file: Rejected as overkill for single boolean flag
- Runtime toggling: Rejected due to security implications

## Decision: Confirmation Component Design  

**What was chosen**: React/Ink component with two-state interface: "Yes" button and text input field, navigable with arrow keys, ESC to cancel.

**Why chosen**:
- Follows Ink component patterns already established in codebase
- Provides both simple confirmation and alternative instruction paths
- Keyboard navigation standard for CLI applications
- ESC cancellation is intuitive user experience

**Alternatives considered**:
- Simple Y/N prompt: Rejected due to requirement for alternative instructions
- Modal dialog: Rejected as not applicable to CLI environment  
- Multi-step wizard: Rejected as overly complex for single decision

## Decision: Restricted Tools List

**What was chosen**: Hardcoded list of restricted tools: `Edit`, `MultiEdit`, `Delete`, `Bash`, `Write` based on their write/execute capabilities.

**Why chosen**:
- Clear security boundary based on operation type
- Matches user specification exactly
- Read-only tools (Read, Grep, LS, Glob) explicitly excluded per requirements
- Simple to implement and understand

**Alternatives considered**:
- Tool metadata flags: Rejected to avoid modifying existing tool definitions
- Dynamic capability detection: Rejected as overly complex
- User-configurable list: Rejected for this initial implementation

## Decision: Sequential Confirmation Architecture for Multiple Tool Calls

**What was chosen**: Queue-based approach with confirmation queue state management for handling multiple tool calls that require sequential confirmation prompts.

**Why chosen**:
- Provides clear state management for multiple pending confirmations
- Scalable and handles any number of tool calls efficiently  
- Separates concerns between tool execution and confirmation UI
- Robust for handling cancellations, denials, and alternative instructions
- Maintains user control while batching results back to AI

**Alternatives considered**:
- Single state blocking approach: Rejected as it would block execution flow and complicate state management
- Promise chain approach: Rejected as it would create complex dependency chains difficult to debug
- Event-driven approach: Rejected as overly complex for this specific use case

**Implementation Details**:
```typescript
// useChat context state management
const [confirmationQueue, setConfirmationQueue] = useState<Array<{
  toolName: string;
  resolver: (decision: PermissionDecision) => void;
  reject: () => void;
}>>([]);
const [currentConfirmation, setCurrentConfirmation] = useState<QueueItem | null>(null);

// Sequential processing
const processNextConfirmation = () => {
  if (confirmationQueue.length > 0) {
    const next = confirmationQueue[0];
    setCurrentConfirmation(next);
    setIsConfirmationVisible(true);
    setConfirmationQueue(prev => prev.slice(1));
  }
};
```

---

## Decision: Permission Manager Implementation

**What was chosen**: New `PermissionManager` class to handle permission logic, integrated into `ToolManager` via dependency injection.

**Why chosen**:
- Follows existing manager pattern in agent-sdk
- Separates permission concerns from tool execution
- Testable in isolation
- Allows for future extension without modifying core execution paths

**Alternatives considered**:
- Inline permission logic in ToolManager: Rejected due to single responsibility principle
- Static utility functions: Rejected as state management needed
- Tool-level permission plugins: Rejected for complexity

## Implementation Insights

1. **Tool Execution Flow**: Current flow is `ToolManager.execute()` → `plugin.execute()` [validation + diff + operation]. New flow becomes `ToolManager.execute()` → `plugin.execute()` [validation + diff + **permission check** + operation].

2. **Permission Context Injection**: ToolContext interface needs extension to include permission-related fields (permissionMode, canUseToolCallback, permissionManager helper).

3. **Individual Tool Updates**: Each restricted tool (Edit, MultiEdit, Delete, Bash, Write) requires modification to insert permission check after validation/diff but before real operation.

4. **Error Handling**: Permission denials should return standard `ToolResult` with `success: false` to maintain consistent interface.

5. **Testing Strategy**: Mock permission checks for tool tests, separate permission logic tests, integration tests for CLI confirmation flow.

6. **Backward Compatibility**: All existing AgentOptions continue to work. New permission fields in ToolContext are optional.

7. **Security Boundary**: Read-only tools (Read, Grep, LS, Glob) don't get permission checks, write tools get individual permission integration.

8. **Multiple Tool Call Handling**: When AI returns multiple tool calls, each restricted tool gets queued for sequential confirmation. Queue-based state management ensures proper order and handles user decisions (allow/deny/alternative) while batching all results back to AI after completion.

9. **Queue Management**: Confirmation queue processes tools sequentially, maintaining current confirmation state and automatically advancing to next queued tool after each user decision. System continues processing even when individual tools are denied or have alternative instructions provided.