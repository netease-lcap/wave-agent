# Research: Tool Block Stage Updates

**Feature**: Tool Block Stage Updates
**Date**: 2025-11-20
**Branch**: 013-tool-block-states

## Research Summary

Codebase analysis reveals the actual structure of tool-related interfaces. This feature modifies **two existing interfaces** rather than creating new entities.

## Technical Decisions

### Decision: Interface Modification Strategy
**What was chosen**: Modify `UpdateToolBlockParams` and `ToolBlock` interfaces directly
**Rationale**: These are the actual interfaces used by the `onToolBlockUpdated` callback and tool execution system. Direct modification ensures consistency with existing patterns.
**Alternatives considered**: Considered creating new interfaces but rejected to maintain backward compatibility and avoid interface proliferation.

### Decision: Stage Field Enum Values
**What was chosen**: `start`, `streaming`, `running`, `end`
**Rationale**: These values provide clear lifecycle semantics that map directly to user requirements while fitting existing patterns:
- `start`: Initial tool announcement with metadata
- `streaming`: Incremental parameter or result updates  
- `running`: Ongoing execution status without new output
- `end`: Final result or error summary
**Alternatives considered**: Considered more granular stages but settled on these four as they cover all required use cases without overcomplication.

### Decision: Deprecated Field Removal
**What was chosen**: Remove `isRunning` field from both interfaces
**Rationale**: The new `stage` field provides richer state information. Maintaining both would create conflicting signals and ambiguity.
**Alternatives considered**: Considered keeping `isRunning` for backward compatibility but rejected due to:
- Potential confusion between boolean and enum state indicators
- Clean migration path offered by stage-based approach
- Reduced interface complexity

### Decision: CommandOutputBlock Preservation
**What was chosen**: Keep `CommandOutputBlock` interface unchanged
**Rationale**: This interface is for **system command output**, not AI tool execution, and uses `isRunning: boolean` appropriately for command status tracking.
**Alternatives considered**: Considered unifying all interfaces but rejected to maintain clear separation between AI tools and system commands.

## Implementation Patterns

### Pattern: Direct Interface Modification
**Approach**: Modify the actual `UpdateToolBlockParams` and `ToolBlock` interfaces in their respective files
**Rationale**: Ensures all tool execution code uses the same updated interfaces consistently

### Pattern: Lifecycle Guarantees
**Approach**: Maintain existing event emission patterns with guaranteed ordering:
1. Exactly one `start` event
2. Zero or more `streaming` events (if tool supports streaming)
3. Zero or more `running` events (for long operations)
4. Exactly one `end` event
**Rationale**: Consistent lifecycle ensures SDK integrators can rely on event sequencing

### Pattern: Error Handling
**Approach**: Errors communicated through `end` stage with appropriate error payload
**Rationale**: Maintains the guaranteed single `end` event contract while providing error information

## Actual Interface Locations

### Files to Modify:
1. `packages/agent-sdk/src/utils/messageOperations.ts`
   - `UpdateToolBlockParams` interface (add `stage`, remove `isRunning`)
   - `AgentToolBlockUpdateParams` type (derived from above)

2. `packages/agent-sdk/src/types/messaging.ts`
   - `ToolBlock` interface (add `stage`, remove `isRunning`)

### Files to Leave Unchanged:
1. `packages/agent-sdk/src/types/messaging.ts`
   - `CommandOutputBlock` interface (keeps `isRunning: boolean` for commands)

## Dependencies & Integration

**Existing Dependencies**:
- Current `onToolBlockUpdated` callback using `AgentToolBlockUpdateParams`
- Tool execution managers that create and update tool blocks
- Message manager that handles tool block updates
- UI components that consume tool block data

**Integration Points**:
- `packages/agent-sdk/src/utils/messageOperations.ts` - Core interface definitions
- `packages/agent-sdk/src/types/messaging.ts` - Type definitions  
- `packages/agent-sdk/src/managers/messageManager.ts` - Callback handling
- `packages/agent-sdk/src/managers/toolManager.ts` - Tool execution logic
- `packages/code/src/components/` - UI components using tool data

## Testing Strategy

**TDD Approach**:
1. Write failing tests for each stage transition using actual interfaces
2. Implement minimal interface changes
3. Verify stage sequencing guarantees
4. Test backward compatibility (except deprecated field)
5. Ensure command output functionality remains unchanged

**Test Patterns**:
- Unit tests for stage discrimination logic
- Integration tests for full tool execution lifecycle  
- UI tests for component rendering based on stage
- Regression tests for command output functionality

## Migration Impact Analysis

**Breaking Changes**:
- Removal of `isRunning` field affects all tool execution callbacks
- Required `stage` field on all tool events

**Preserved Compatibility**:
- Callback function signature unchanged
- All other field names and types preserved
- Command output functionality unchanged
- Parameter and result streaming capabilities maintained

**Migration Path**:
1. Update callback handlers to use `stage` field
2. Remove all `isRunning` checks from tool-related code
3. Add stage-based logic for precise state handling
4. Test command output functionality remains unaffected

## Risk Assessment

**Low Risk Areas**:
- Interface changes are additive (new field) and subtractive (remove deprecated field)
- Clear migration path for consumers
- Command output functionality isolated and unchanged

**Medium Risk Areas**:  
- Potential for missed `isRunning` references in tool execution code
- Need to update all existing tool callback implementations

**Mitigation Strategies**:
- Comprehensive test coverage for all stage transitions
- TypeScript compiler will catch missing `stage` field usage
- Clear documentation and examples for migration
- Phase rollout with thorough testing