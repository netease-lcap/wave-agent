# Research: Subagent Message Callbacks (Simplified)

**Feature**: 015-subagent-message-callbacks  
**Date**: 2025-11-20  
**Status**: ✅ Completed

## Research Overview

This research phase investigated simple TypeScript patterns for adding basic subagent message callbacks to the Wave Agent system while maintaining 100% backward compatibility.

## Decision 1: Dedicated SubagentManagerCallbacks Interface

**Decision**: Create separate SubagentManagerCallbacks interface instead of extending MessageManagerCallbacks

**Rationale**: 
- Cleaner architectural separation between MessageManager and SubagentManager responsibilities
- Avoids mixing main agent callbacks with subagent-specific callbacks
- SubagentManager owns its callback system independently
- AgentCallbacks extends SubagentManagerCallbacks for end-to-end integration

**Alternatives Considered**:
- Adding context parameters to existing callbacks (rejected: modifies existing signatures)
- Hybrid approach with both patterns (rejected: unnecessary complexity)

## Decision 2: SubagentManager Callback Ownership

**Decision**: SubagentManager uses `callbacks: SubagentManagerCallbacks` instead of `parentCallbacks`

**Rationale**:
- SubagentManager owns its callback responsibilities rather than forwarding to MessageManager
- Cleaner separation of concerns between manager classes
- Maintains full TypeScript type safety with dedicated interfaces
- Eliminates callback forwarding complexity

**Implementation Pattern**:
```typescript
// New SubagentManager interface
interface SubagentManagerOptions {
  callbacks?: SubagentManagerCallbacks;
}

// Dedicated subagent callbacks
interface SubagentManagerCallbacks {
  onSubagentUserMessageAdded?: (subagentId: string, params: UserMessageParams) => void;
  onSubagentAssistantMessageAdded?: (subagentId: string) => void;
  onSubagentAssistantContentUpdated?: (subagentId: string, chunk: string, accumulated: string) => void;
  onSubagentToolBlockUpdated?: (subagentId: string, params: AgentToolBlockUpdateParams) => void;
}
```

## Decision 3: Basic Cleanup Strategy

**Decision**: Simple Cleanup in Existing Methods

**Rationale**:
- Use existing `SubagentManager.cleanupInstance()` method
- No special lifecycle management needed
- No WeakRef or automatic cleanup complexity
- Simple manual cleanup when subagent completes

**Implementation Strategy**:
```typescript
cleanupInstance(subagentId: string): void {
  // Existing cleanup logic
  this.instances.delete(subagentId);
  // No special callback cleanup needed
}
```

## Decision 4: No Error Handling Complexity

**Decision**: Let callback errors bubble up naturally

**Rationale**:
- No circuit breaker or error recovery needed
- No error counting or monitoring
- Simple try-catch only if absolutely necessary
- Keep implementation minimal and straightforward

## Decision 5: No Performance Optimization

**Decision**: Direct callback execution without batching

**Rationale**:
- No micro-batching for streaming events
- No performance monitoring or metrics
- No optimization for high-frequency callbacks
- Simple direct execution is sufficient

## Integration Points

### SubagentManager Changes
- Created SubagentManagerCallbacks interface with dedicated subagent callback definitions
- Refactored SubagentManager to use `callbacks: SubagentManagerCallbacks` instead of `parentCallbacks`
- Callback forwarding with subagentId context through dedicated callback system

### Agent Integration Changes
- Extended AgentCallbacks to include SubagentManagerCallbacks for end-to-end callback support
- Agent class passes subagent callbacks to SubagentManager through new interface
- Maintains backward compatibility while enabling subagent-specific event handling

### Type System Changes
- Add basic subagent callback types to `types/index.ts`
- Maintain type inference for IDE support
- Keep backward compatibility with existing signatures

## Success Metrics

- 100% backward compatibility (no breaking changes)
- Simple callback dispatch without latency requirements
- Basic functionality working without advanced features
- Clean test coverage for core callback scenarios