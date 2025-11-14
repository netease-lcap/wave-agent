# Research: Hook Output Support

**Date**: 2025-11-14  
**Phase**: 0 - Research & Analysis  

## Research Tasks Completed

### 1. Hook Output Processing Pattern Analysis

**Decision**: Use parser-first approach with exit code fallback
**Rationale**: Exit codes provide simple, universal compatibility while JSON enables advanced control. Parser should attempt JSON parsing first, then fall back to exit code interpretation.
**Alternatives considered**: 
- Exit codes only: Too limited for complex hook scenarios
- JSON only: Breaks compatibility with simple hooks

### 2. Message Block Type Integration Strategy

**Decision**: Add WarnBlock and HookBlock as new MessageBlock types in existing messaging.ts
**Rationale**: Follows established pattern used by CustomCommandBlock, maintains type safety, enables proper UI rendering and API conversion.
**Alternatives considered**: 
- Generic TextBlock with metadata: Loses type specificity and rendering control
- Separate message system: Creates unnecessary complexity

### 3. React Component Architecture for Hook UI

**Decision**: Create specialized components (WarnBlock, HookBlock, ConfirmDialog) with shared hook context
**Rationale**: Component specialization enables targeted styling and behavior while context provides centralized state management for hook interactions.
**Alternatives considered**: 
- Single generic hook component: Loses rendering flexibility and UX control
- Component-level state: Creates state synchronization issues across hook operations

### 4. Hook Output Parsing and Validation

**Decision**: Implement structured JSON schema validation with graceful degradation
**Rationale**: Structured validation ensures hook output correctness while graceful degradation maintains compatibility with malformed output.
**Alternatives considered**: 
- Simple JSON.parse with try/catch: Lacks comprehensive validation of hook-specific fields
- Strict validation with errors: Breaks hooks that produce slightly malformed but usable JSON

### 5. Permission Decision Flow Architecture

**Decision**: Implement Promise-based permission handling instead of pause/resume execution control
**Rationale**: Promise-based approach allows sendMessage execution to continue naturally while waiting for user permission decisions, eliminating complex state management and recursion context saving/restoring. UI resolves Promises directly when user makes decisions.
**Alternatives considered**: 
- Pause/resume execution: Complex state management, requires saving recursion context, harder to test and debug
- Synchronous permission requests: Blocks execution thread, poor user experience
- Event-driven state machine: Overly complex for simple permission resolution

### 6. Permission Decision UI Flow

**Decision**: Implement up/down arrow key navigation for "ask" permission decisions with Promise resolution
**Rationale**: Provides keyboard-driven workflow consistent with CLI tools, enables fast decision-making without mouse interaction. Promise resolution directly from UI components creates clean async flow.
**Alternatives considered**: 
- Mouse-only interface: Inconsistent with CLI-focused tool design
- Text-based prompts: Less intuitive than visual selection interface
- Callback-based permission handling: More complex than direct Promise resolution

### 7. Hook Output to API Conversion Strategy

**Decision**: Extend convertMessagesForAPI with warn/hook block support similar to custom_command handling
**Rationale**: Maintains consistency with existing message block conversion patterns, ensures proper AI context transmission.
**Alternatives considered**: 
- Separate conversion logic: Creates code duplication and maintenance burden
- Skip conversion: Loses hook context in AI interactions

## Implementation Approach

### Promise-Based Permission Flow
1. Hook requests permission via JSON output with "permissionDecision": "ask"
2. HookExecutor creates Promise<boolean> and PermissionRequest object
3. Promise and request passed to Agent via callback system
4. Agent notifies UI through onPermissionRequired callback
5. UI displays ConfirmDialog and captures user decision
6. User decision resolves Promise directly via request.resolve(allowed)
7. HookExecutor awaits Promise resolution and continues/stops tool execution
8. sendMessage execution never pauses - just awaits Promises when needed

### Exit Code Processing Flow
1. Hook execution completes with exit code and stdout/stderr
2. Parser attempts JSON parsing of stdout first
3. If JSON invalid, fall back to exit code interpretation:
   - Exit code 0: Success, add stdout to context (UserPromptSubmit only)
   - Exit code 2: Blocking error, process stderr per hook type
   - Other codes: Non-blocking error, show stderr to user

### JSON Output Processing Flow
1. Parse JSON from stdout with schema validation
2. Extract common fields: continue, stopReason, systemMessage
3. Extract hook-specific fields based on hookEventName
4. Route messages appropriately (Wave vs user) based on hook type and decision
5. Apply JSON precedence over exit code behavior

### UI Component Integration
1. MessageManager creates appropriate block types based on hook output
2. React components render blocks with hook-specific styling and interactions
3. Chat context manages PermissionRequest objects with Promise resolution
4. ConfirmDialog handles "ask" scenarios with keyboard navigation and direct Promise resolution
5. Agent maintains pending permissions list without complex state persistence

## Best Practices Established

### Hook Output Schema Design
- Use hookEventName field to identify hook type-specific validation
- Maintain backward compatibility with exit-code-only hooks
- Implement clear precedence rules: JSON overrides exit codes when present
- Provide meaningful error messages for malformed hook output

### UI/UX Patterns
- Use consistent styling for hook-related message blocks
- Implement keyboard-first navigation for permission decisions
- Provide clear visual feedback for hook processing states
- Maintain accessibility standards for hook interaction components  
- Use Promise-based async patterns for smooth permission resolution without execution blocking

### Testing Strategy
- Integration tests use real hook execution with temporary directories and Promise resolution
- Unit tests mock hook output parsing with comprehensive JSON scenarios and Promise patterns
- UI tests verify component behavior with Promise-based permission resolution
- Performance tests ensure hook output processing meets <100ms targets with Promise overhead included

## Dependencies and Integration Points

### Existing Systems Integration
- Hook execution system: Extend with output parsing capability and Promise-based permission handling
- Message system: Add new block types while maintaining API compatibility
- UI rendering: Integrate new components with existing message rendering flow
- API conversion: Extend convertMessagesForAPI with new block type support
- Agent callback system: Extend with Promise-based permission request handling

### New Dependencies
- JSON schema validation library (if needed beyond basic JSON.parse)
- React keyboard navigation utilities (if not already available)
- Hook output type definitions for comprehensive TypeScript support
- Promise-based permission request types (PermissionRequest interface)

## Risk Mitigation

### Backward Compatibility
- Existing hooks continue working with exit code interpretation
- New block types are additive, don't break existing message processing
- API conversion maintains existing patterns for unknown block types

### Error Handling
- Malformed JSON gracefully falls back to exit code processing
- Hook execution failures don't crash Wave main process
- Invalid hook-specific JSON fields are logged but don't block processing

### Performance
- JSON parsing is fast enough for <100ms processing targets
- Hook output processing doesn't block main UI thread
- Large hook outputs are handled efficiently without memory issues
- Promise-based permission handling adds minimal overhead (<5ms per permission request)
- No complex state persistence required, improving performance and reliability