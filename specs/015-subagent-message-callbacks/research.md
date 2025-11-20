# Research: Subagent Message Callbacks (Simplified)

**Feature**: 015-subagent-message-callbacks  
**Date**: 2025-11-20  
**Status**: Complete

## Research Overview

This research phase investigated simple TypeScript patterns for adding basic subagent message callbacks to the Wave Agent system while maintaining 100% backward compatibility.

## Decision 1: Simple Additive Callback Pattern

**Decision**: Add New Subagent-Specific Callbacks Only

**Rationale**: 
- Maintains complete backward compatibility by never modifying existing callback signatures
- Provides clean dedicated subagent callbacks for new functionality
- No complex context parameters or smart dispatch logic needed
- Straightforward implementation without advanced features

**Alternatives Considered**:
- Adding context parameters to existing callbacks (rejected: modifies existing signatures)
- Hybrid approach with both patterns (rejected: unnecessary complexity)

## Decision 2: Simple Interface Extension

**Decision**: Pure Additive Interface Extension

**Rationale**:
- Extends `MessageManagerCallbacks` with new optional subagent-specific callbacks only
- Existing callbacks work exactly as before with zero changes
- Simple parallel callback system for subagent events
- Maintains full TypeScript type inference

**Implementation Pattern**:
```typescript
// Extended interface (backward compatible)
interface MessageManagerCallbacks {
  // Existing callbacks (unchanged)
  onUserMessageAdded?: (params: UserMessageParams) => void;
  onAssistantContentUpdated?: (chunk: string, accumulated: string) => void;
  
  // New subagent callbacks
  onSubagentUserMessageAdded?: (subagentId: string, params: UserMessageParams) => void;
  onSubagentAssistantContentUpdated?: (subagentId: string, chunk: string, accumulated: string) => void;
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

### MessageManager Changes
- Extend `MessageManagerCallbacks` interface with basic subagent callbacks
- Add simple context parameter to existing callback executions
- Direct callback execution without smart dispatch

### SubagentManager Changes
- Create simple callback forwarding for each subagent instance
- Forward callbacks with subagentId context
- Use existing cleanup methods

### Type System Changes
- Add basic subagent callback types to `types/index.ts`
- Maintain type inference for IDE support
- Keep backward compatibility with existing signatures

## Success Metrics

- 100% backward compatibility (no breaking changes)
- Simple callback dispatch without latency requirements
- Basic functionality working without advanced features
- Clean test coverage for core callback scenarios