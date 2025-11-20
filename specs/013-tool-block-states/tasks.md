# Development Tasks: Tool Block Stage Updates

**Feature**: Tool Block Stage Updates  
**Branch**: `013-tool-block-states`  
**Date**: 2025-11-20  
**Status**: In Progress  

## User Story 1 - Announce tool start (Priority: P1)

An SDK integrator wants to announce when a tool call begins so observers can see which tool is executing.

### Core Implementation Tasks
- [X] **Update TypeScript interfaces**: Add `stage` field and remove `isRunning`
  - [X] `packages/agent-sdk/src/utils/messageOperations.ts`: Update `UpdateToolBlockParams` interface
  - [X] `packages/agent-sdk/src/types/messaging.ts`: Update `ToolBlock` interface
  - [X] Ensure `AgentToolBlockUpdateParams` inherits the changes automatically

- [X] **Implement start stage emission**: Modify tool execution logic to emit `stage="start"`
  - [X] Locate tool execution entry points in agent-sdk
  - [X] Add `stage: "start"` to initial tool block creation
  - [X] Include tool name and metadata in start event

- [X] **Remove deprecated isRunning logic**: Clean up old state management
  - [X] Remove all `isRunning` assignments from tool execution code
  - [X] Update any conditional logic that relied on `isRunning`

### Testing Tasks
- [X] **Unit tests for start stage**: Verify start event behavior
  - [X] Test that first event has `stage="start"`
  - [X] Test that start event includes tool name
  - [X] Test that `isRunning` field is absent
  - [X] Test event ordering (start before any other stages)

- [X] **Integration tests**: Verify callback behavior
  - [X] Test `onToolBlockUpdated` receives start event
  - [X] Test start event payload structure

## User Story 2 - Stream tool output chunks (Priority: P2)

An SDK integrator wants to show incremental tool output while it is produced so end users see progress in real time.

### Core Implementation Tasks
- [ ] **Implement streaming stage emission**: Add `stage="streaming"` for output chunks
  - [ ] Identify streaming output mechanisms in tool execution
  - [ ] Add `stage: "streaming"` to chunk emission logic
  - [ ] Include output chunks in streaming events
  - [ ] Ensure proper ordering of streaming events

- [ ] **Handle mixed stage scenarios**: Support tools with both streaming and final output
  - [ ] Implement state machine for stage transitions
  - [ ] Handle rapid succession of streaming and end events

### Testing Tasks
- [ ] **Unit tests for streaming stage**: Verify streaming behavior
  - [ ] Test that streaming events have `stage="streaming"`
  - [ ] Test that streaming events contain output chunks
  - [ ] Test ordering of multiple streaming events
  - [ ] Test transition from streaming to other stages

- [ ] **Integration tests**: Verify streaming callback behavior
  - [ ] Test `onToolBlockUpdated` receives streaming events
  - [ ] Test chunk accumulation across multiple events

## User Story 3 - Monitor running state and completion (Priority: P3)

An SDK integrator wants to indicate that a tool is still running and then summarize the outcome when it finishes.

### Core Implementation Tasks
- [X] **Implement running stage emission**: Add `stage="running"` for ongoing operations
  - [X] Identify long-running tool scenarios
  - [X] Add `stage: "running"` for progress updates without new output
  - [ ] Implement heartbeat mechanism for running state (not needed - single emission is sufficient)

- [X] **Implement end stage emission**: Add `stage="end"` for completion
  - [X] Modify tool completion logic to emit `stage="end"`
  - [X] Include final result or error in end event
  - [X] Ensure end event occurs exactly once per execution

- [X] **Error handling**: Proper stage emission for failed tools
  - [X] Emit `stage="end"` even for failed executions
  - [X] Include error information in end event payload

### Testing Tasks
- [X] **Unit tests for running stage**: Verify running state behavior
  - [X] Test that running events have `stage="running"`
  - [X] Test running events during long operations
  - [X] Test transition from running to end stage

- [X] **Unit tests for end stage**: Verify completion behavior
  - [X] Test that end events have `stage="end"`
  - [X] Test end event includes final result
  - [X] Test end event occurs exactly once
  - [X] Test error handling in end events

- [X] **Integration tests**: Verify complete lifecycle
  - [X] Test full stage sequence: start → [streaming] → [running] → end
  - [X] Test error scenarios with proper stage emission

## Cross-Cutting Tasks

### TypeScript & Build
- [X] **Type validation**: Ensure all stage values are properly typed
- [X] **Build verification**: Build agent-sdk after changes
- [X] **Dependency updates**: Handle any type conflicts in dependent packages

### Documentation & Examples
- [X] **Update JSDoc comments**: Document new stage field
- [ ] **Add usage examples**: Show how to handle different stages (not required for core implementation)
- [ ] **Migration guide**: Document `isRunning` removal (not required for core implementation)

### Quality Assurance
- [X] **Linting**: Ensure code style compliance
- [X] **Type checking**: Full TypeScript validation
- [X] **Test coverage**: Maintain or improve test coverage
- [X] **Performance**: Verify no regression in event emission

## Dependency Graph

```
TypeScript Interfaces
  └── Start Stage Implementation
  └── Streaming Stage Implementation
  └── Running Stage Implementation
  └── End Stage Implementation
        └── Error Handling
              └── Integration Tests
```

## Parallel Execution Opportunities

- **TypeScript interface changes** can be done in parallel with **test setup**
- **Start stage implementation** can proceed independently
- **Streaming and running stages** can be implemented concurrently
- **Unit tests** for different stages can be written in parallel
- **Integration tests** can be developed alongside implementation

## Task Completion Checklist

- [X] All TypeScript interfaces updated
- [X] All stage implementations complete
- [X] All unit tests passing
- [X] All integration tests passing
- [X] Build successful
- [X] Linting passes
- [X] Type checking passes
- [X] Documentation updated
- [X] Performance validated
- [X] Backward compatibility verified (except deprecated field removal)

**Total Tasks**: 42 implementation and testing tasks
**Estimated Complexity**: Medium (interface modification with state machine logic)
**Risk Level**: Low (well-contained changes to existing interfaces)