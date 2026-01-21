# Research: SDK Usage Tracking and Callback System

**Date**: 2025-11-11  
**Phase**: 0 - Research & Technical Decisions

## Technical Decisions

### Decision: Reuse Existing Callback System
**Rationale**: The agent-sdk already has a callback infrastructure in place through `AgentCallbacks` which extends `MessageManagerCallbacks`, `BackgroundBashManagerCallbacks`, and `McpManagerCallbacks`. Extending this system for usage tracking avoids duplicating event handling logic and maintains consistency with existing patterns.

**Alternatives considered**: 
- Create separate usage callback system - rejected due to code duplication
- Use event emitter pattern - rejected as it would require additional dependencies and break existing patterns

### Decision: Extend Message Type with Usage Field
**Rationale**: Adding usage field directly to Message type ensures usage data is automatically persisted with session files and provides natural association between AI operations and their costs. The existing `Message` interface already supports complex block structures.

**Alternatives considered**:
- Separate usage storage mechanism - rejected as it would require additional file I/O operations
- In-memory only tracking - rejected as it doesn't meet persistence requirements from FR-007

### Decision: Use OpenAI Usage Type Format
**Rationale**: The `aiService.ts` already returns OpenAI usage data format (`{ prompt_tokens, completion_tokens, total_tokens }`). Using this standardized format maintains consistency and is already understood by developers using OpenAI APIs.

**Alternatives considered**:
- Custom usage format - rejected as it would create additional complexity and mapping
- Simple token count numbers - rejected as it lacks operation type distinction and model information

### Decision: Maintain Usage Array Directly
**Rationale**: Store a separate `Usage[]` array that gets updated directly when AI operations complete. This approach is simpler, more performant, and avoids scanning messages for aggregation. The array represents the complete session usage history.

**Alternatives considered**:
- Calculate on-demand from message metadata - rejected due to performance overhead of scanning all messages
- Pre-calculate totals on each operation - rejected due to race condition risks and complexity

### Decision: Add Model Information to Usage Data
**Rationale**: CLI exit summary requires per-model token aggregation (FR-013). Extending usage data with model information enables proper grouping while maintaining OpenAI compatibility.

**Implementation**: Extend usage type to include `model?: string` field for model identification.

### Decision: Callback Integration Points
**Rationale**: Usage callbacks should be triggered after successful AI operations in `AIManager.sendAIMessage()` and compression operations. This ensures callbacks receive complete operation data.

**Integration points**:
- After `callAgent()` completes successfully in `AIManager`
- After `compressMessages()` completes successfully in `AIManager`
- Usage data embedded in assistant messages via `MessageManager`

## Implementation Approach

### Current Callback System Analysis
The agent-sdk uses callback patterns where:
1. `AgentCallbacks` interface extends multiple manager callback interfaces
2. Callbacks are passed down to managers during initialization
3. Managers trigger callbacks at specific lifecycle events
4. Error handling isolates callback failures from core operations

### Message Type Extension Strategy
```typescript
interface Message {
  // ... existing fields
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
    model?: string;          // New field for model identification
    operation_type?: 'agent' | 'compress';  // New field for operation tracking
  };
}
```

### Session Integration
Usage data will be automatically included in session file saves through the existing session management system in `services/session.ts`, requiring no additional persistence logic.

### CLI Exit Handler Integration
The CLI packages (`packages/code/src/cli.tsx` and `packages/code/src/print-cli.ts`) already have cleanup functions that handle graceful shutdown. Token summary display will be integrated into these existing cleanup paths.

## Performance Considerations

### Callback Execution
- Usage callbacks will be async to prevent blocking main operations
- Error handling will log issues but continue normal operation (following existing pattern)
- Target <100ms execution time for callback notification (SC-001)

### Memory Usage
- Usage data per operation is minimal (~150 bytes including model info)
- Direct usage array storage for fast access without calculation
- Large sessions (>1000 operations) may have ~150KB usage array overhead

### File I/O Impact
- Usage data included in existing session saves (no additional writes)
- Session file size increase estimated at <15% for typical usage patterns

## Risk Mitigation

### Callback Error Handling
- Wrap all callback invocations in try-catch blocks (following existing pattern in managers)
- Log callback errors for debugging without throwing
- Continue normal SDK operation even if all callbacks fail

### Data Consistency
- Usage data only recorded for successful operations (FR-012)
- Failed operations skip usage tracking to maintain accuracy
- Session file corruption handled by existing session recovery mechanisms

### CLI Exit Handling
- Token summary generation wrapped in try-catch to ensure exit proceeds
- Summary display timeout to prevent hanging processes
- Graceful degradation if usage data is corrupted or missing