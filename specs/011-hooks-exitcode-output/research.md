# Research: Hook Exit Code Output Support

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