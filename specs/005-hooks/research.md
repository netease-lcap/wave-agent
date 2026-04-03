# Research: Hooks System Implementation

**Date**: 2024-12-19  
**Feature**: Hooks Support  
**Purpose**: Resolve technical implementation decisions and patterns

## Hook Event Integration Points

### Decision: Agent Lifecycle Integration
**Rationale**: Integrate hooks directly into the existing Agent class workflow at specific lifecycle points rather than creating a separate event system.

**Integration Points Identified**:
- PreToolUse: Before tool parameter processing in agent.ts
- PostToolUse: After successful tool execution completion  
- UserPromptSubmit: At prompt intake before AI processing begins
- Stop: When AI response cycle completes (no more tool calls)

**Alternatives Considered**:
- EventEmitter-based system: Rejected due to added complexity and potential memory leaks
- Middleware pattern: Rejected as hooks are not request/response interceptors but lifecycle callbacks

## Hook Execution Strategy  

### Decision: Isolated Process Execution
**Rationale**: Execute hook commands as isolated child processes to prevent hook failures from affecting main Wave operations, enable cross-platform compatibility, and provide security isolation.

**Implementation Approach**:
- Use Node.js `child_process.spawn()` for command execution
- Set timeout limits to prevent hanging hooks
- Capture stdout/stderr for logging without blocking main thread
- Provide WAVE_PROJECT_DIR environment variable injection

**Alternatives Considered**:
- In-process execution: Rejected due to potential for hooks to crash main application
- Worker threads: Rejected as unnecessary complexity for shell command execution

## Pattern Matching Strategy

### Decision: Minimatch Library Integration  
**Rationale**: Use existing minimatch dependency (already in agent-sdk) for glob-style pattern matching, with regex support for advanced patterns.

**Pattern Support**:
- Exact string matching: `"Write"` matches only Write tool
- Glob patterns: `"*"` matches all tools
- Regex patterns: `"Edit|Write"` for multiple tools
- Case-sensitive matching to maintain precision

## Configuration Management

### Decision: JSON Settings File Extension
**Rationale**: Extend existing settings.json structure in both user (~/.wave/) and project (.wave/) locations to maintain consistency with current Wave configuration approach.

**Configuration Structure**:
```typescript
interface HookConfiguration {
  hooks: {
    [eventName: string]: Array<{
      matcher?: string; // Optional for events without tools
      hooks: Array<{
        type: "command";
        command: string;
      }>;
    }>;
  };
}
```

**Alternatives Considered**:
- Separate hook configuration files: Rejected to avoid configuration fragmentation
- YAML format: Rejected to maintain consistency with existing JSON settings

## Error Handling & Logging

### Decision: Non-blocking Failure Mode
**Rationale**: Hook execution failures should be logged but never interrupt main Wave operations, maintaining system reliability while providing visibility into hook issues.

**Error Handling Strategy**:
- Log hook execution start/completion/failure events
- Capture and log hook command output for debugging
- Continue main workflow regardless of hook success/failure
- Provide clear error messages for common configuration mistakes

**Alternatives Considered**:
- Blocking failure mode: Rejected as it could make Wave unreliable due to hook issues
- Silent failure mode: Rejected as it provides no debugging feedback to users


---

## Session System Integration

## Decision: Transcript Path via Session ID
**Rationale**: Provide hooks with access to the full conversation history by passing the absolute path to the session's JSON file, enabling context-aware hook logic.

**Implementation Approach**:
- Capture session ID in Agent instance
- Use existing `getSessionFilePath()` utility to derive transcript path
- Include `transcript_path` in the JSON data passed to hooks

## Integration Points Analysis (JSON Input)

### Available Context Data
- **Session ID**: Available in agent/manager instances
- **Tool Input/Output**: Available in `aiManager` during tool execution
- **User Prompts**: Available in `agent.ts` during prompt processing
- **Current Working Directory**: Already passed as `context.projectDir`

### Hook Trigger Locations
1. **PreToolUse**: `aiManager.ts` - Access to `toolName`, tool arguments, session context
2. **PostToolUse**: `aiManager.ts` - Access to tool result, original input, session context  
3. **UserPromptSubmit**: `agent.ts` - Access to user prompt content, session context
4. **Stop**: `aiManager.ts` - Minimal context, session ending

## Technical Approach: JSON Input Support

### Decision: JSON Data via Stdin
**Rationale**: Pass structured data to hook processes via stdin to enable complex context sharing without hitting environment variable size limits or requiring hooks to poll for state.

**Implementation Approach**:
- Extend `HookExecutionContext` with optional session and tool data
- Modify `HookExecutor` to write JSON payload to child process stdin
- Ensure non-blocking stdin handling for backward compatibility
- Use `jq` for concise testing of JSON input in hook commands

## Performance Considerations

### Decision: Asynchronous Hook Execution with Timeout
**Rationale**: Execute hooks asynchronously to minimize impact on main workflow, with configurable timeouts to prevent indefinite hanging.

**Performance Strategy**:
- Default 10-second timeout per hook command
- Parallel execution of multiple hooks for same event
- Minimal memory footprint by avoiding hook result storage
- Early termination of hooks on timeout

**Alternatives Considered**:
- Synchronous execution: Rejected due to potential for significant workflow delays
- No timeout limits: Rejected as hanging hooks could accumulate and consume resources

---

## Hook Exit Code Output Support (2025-11-15)

## Decision: Exit Code Interpretation Strategy

**What was chosen**: Event-specific three-tier exit code system:
- Exit code 0: Success (stdout handling varies by hook type)
- Exit code 2: Error with event-specific behavior (blocking only for UserPromptSubmit, shows to agent for other events)
- Other exit codes: Non-blocking error (shows stderr to user, continues execution)

**Rationale**: UserPromptSubmit hooks validate user input and should block invalid prompts. PreToolUse/PostToolUse/Stop hooks provide feedback to Wave Agent for handling while allowing execution to continue. This provides appropriate control flow for different hook purposes.

**Alternatives considered**: 
- All exit code 2 errors block execution - rejected as unnecessarily restrictive for tool feedback hooks
- Boolean success/failure only - rejected as insufficient granularity for error routing
- Configuration-based exit code interpretation - rejected as over-engineered

## Decision: Hook Output Processing Architecture

**What was chosen**: Extend existing HookExecutionResult with enhanced processing in HookManager, delegate message creation to MessageManager.

**Rationale**: Maintains separation of concerns - HookManager handles hook execution and result interpretation, MessageManager handles message creation and storage. This approach leverages existing message block patterns.

**Alternatives considered**:
- Hook service directly creates messages - rejected due to tight coupling
- New HookOutputManager - rejected as unnecessary abstraction
- Event-driven architecture - rejected as over-complex for this feature

## Decision: Message Block Strategy for Hook Output

**What was chosen**: Use existing MessageManager methods (addUserMessage, addErrorBlock, updateToolBlock) without enhancing block types. Hook output is processed and routed through appropriate existing message operations.

**Rationale**: Leverages existing message infrastructure without modifications. Clean separation between hook processing logic and message creation. No changes needed to block types or API conversion logic.

**Alternatives considered**:
- Enhanced ToolBlock with hook-specific fields - rejected as unnecessary complexity
- New HookBlock type - rejected when existing operations suffice
- Separate hook message types - rejected due to API conversion complexity

## Decision: Testing Strategy for Hook Behavior Validation

**What was chosen**: Test hook behaviors through agent.messages validation patterns. For tests in `packages/agent-sdk/tests/agent/`, mock all services (hook execution, file IO, network operations) to avoid real operations. No files will be created in examples directories.

**Rationale**: Testing the observable effects (message state changes) rather than internal implementation details ensures correct behavior from user perspective. Mocking services in agent-sdk tests prevents real IO operations and ensures fast, reliable test execution. All testing will be contained within the test directory structure.

**Alternatives considered**:
- Real hook execution in agent tests - rejected as tests should avoid real IO/network
- Creating example files - rejected per user guidance to not create files in examples
- Test internal manager state - rejected as tests would be brittle to implementation changes

## Decision: Backward Compatibility Approach

**What was chosen**: Extend existing interfaces with optional properties, maintain current hook execution flow, add new behavior only when exit codes are present.

**Rationale**: Ensures existing hooks continue to work unchanged while enabling new functionality. Graceful degradation when exit code information is not available.

**Alternatives considered**:
- Breaking changes to hook interfaces - rejected due to user impact
- Separate new hook system - rejected due to code duplication
- Feature flags for hook behavior - rejected as unnecessary complexity

## Decision: Error Display Routing Strategy

**What was chosen**: Hook type and exit code determine error routing with event-specific blocking:
- PreToolUse errors (exit 2): Display via ToolBlock result field using `updateToolBlock` - shows to Wave Agent, blocks tool execution
- PostToolUse errors (exit 2): Display to agent via `addUserMessage` - shows to Wave Agent, allows AI to continue processing
- Stop errors (exit 2): Display to agent via `addUserMessage` - shows to Wave Agent, execution continues
- UserPromptSubmit errors (exit 2): Display to user via `addErrorBlock` - blocks prompt processing, erases prompt
- All non-blocking errors (any hook, exit ≠0,2): Display to user via `addErrorBlock`

**Rationale**: Only UserPromptSubmit hooks should block execution since they validate user input. Tool and Stop hooks provide feedback to Wave Agent for handling while allowing workflow to continue. Non-blocking errors always go to user for awareness.

**Alternatives considered**:
- All exit code 2 errors block execution - rejected as unnecessarily restrictive for tool feedback
- All errors to user - rejected as reduces agent's ability to handle tool/workflow issues
- Configuration-based routing - rejected as adds unnecessary complexity

## Decision: Performance and Timeout Handling

**What was chosen**: Maintain existing hook timeout behavior, add exit code processing within current performance constraints, target <200ms for output processing.

**Rationale**: Hook execution time is already controlled by existing timeout mechanisms. Exit code processing is lightweight and shouldn't significantly impact performance.

**Alternatives considered**:
- Separate timeouts for output processing - rejected as unnecessary
- Async output processing - rejected as adds complexity without clear benefit
- Output processing optimization - rejected as premature optimization
