# Research Report: Real-Time Content Streaming

**Phase 0 Research Completed**: 2025-11-19  
**Status**: All technical unknowns resolved

## Research Summary

This research phase investigated four critical technical areas for implementing real-time streaming content updates in the Wave Agent codebase. All research has been completed and technical approaches have been validated.

## Research Findings

### 1. OpenAI Streaming API Integration

**Decision**: Enhance existing `callAgent` function with optional streaming support using callback-based architecture

**Rationale**: 
- Simple additive approach with new optional callbacks
- Integrates seamlessly with existing `MessageManagerCallbacks` pattern
- Supports both content streaming and tool call streaming with proper accumulation
- Provides abort controller management for stream interruption

**Alternatives Considered**: 
- Separate streaming function → Rejected due to code duplication
- Replace existing function → Rejected to keep changes minimal
- WebSocket-based streaming → Rejected as OpenAI uses HTTP streams

**Implementation Pattern**:
```typescript
// Add streaming flag to callAgent options
export interface CallAgentOptions {
  // ... existing options
  streaming?: boolean;
  onContentUpdate?: (content: string) => void;
  onToolUpdate?: (toolCall: PartialToolCall) => void;
}

// Content accumulation from choice.delta.content
let contentBuffer = "";
if (choice.delta.content) {
  contentBuffer += choice.delta.content;
  options.onContentUpdate?.(contentBuffer);
}
```

### 2. Incomplete JSON Parsing for Tool Parameters

**Decision**: Create `streamingHelpers.ts` utility with regex-based parameter extraction

**Rationale**:
- Simple regex patterns to extract complete key-value pairs from incomplete JSON
- Handles string, number, boolean, and null values safely
- Lightweight approach with predictable performance characteristics
- Properly handles escape sequences in string values

**Alternatives Considered**:
- Complex progressive JSON parsers → Rejected as over-engineered
- Third-party JSON streaming libraries → Rejected due to complexity overhead
- Custom tokenizer → Rejected due to development complexity

**Implementation Approach**:
```typescript
// Extract complete parameters using targeted regex patterns
export function extractStreamingParams(
  incompleteJson: string,
): Record<string, string | number | boolean | null> {
  // Use separate patterns for each data type:
  // - String: "key": "value" (with escape handling)
  // - Number: "key": 123.45
  // - Boolean: "key": true/false  
  // - Null: "key": null
  
  // Returns only fully formed key-value pairs
}
```

**Key Benefits**:
- Extracts only complete parameters, ignoring incomplete ones
- No complex state management or caching needed
- Robust handling of escaped characters in strings
- Predictable performance characteristics

### 3. React/Ink Real-Time Rendering Patterns

**Decision**: Simple direct state updates without throttling for streaming content display

**Rationale**:
- OpenAI streaming frequency is naturally low at 1-5fps, eliminating performance concerns
- Direct state updates provide immediate responsiveness without complexity
- No need for throttling, batching, or complex performance optimizations
- Standard React state management patterns are sufficient

**Alternatives Considered**:
- 60fps throttled updates → Rejected as over-engineered for actual stream frequency
- Complex batching mechanisms → Rejected due to unnecessary complexity
- Virtual scrolling → Rejected as unnecessary for CLI interface

**Implementation Strategy**:
```typescript
// Leverage existing onMessagesChange callback during streaming
// No separate streaming state or manual message updates needed

onAssistantContentUpdated: (chunk, accumulated) => {
  // Internal: Agent SDK updates the current message content
  // Then triggers existing onMessagesChange callback
  // UI automatically reflects the updated messages
},

// Existing callback gets triggered during streaming
onMessagesChange: (messages) => {
  if (!isExpandedRef.current) {
    setMessages(messages); // Standard message update flow
  }
},
```

**Performance Benefits**:
- Zero optimization overhead - simpler and more reliable
- Immediate visual feedback as content arrives
- Natural rate limiting by OpenAI API (1-5fps)
- Standard React rendering performance is adequate

### 4. Content Snapshot Mechanism for View Mode Transitions

**Decision**: Simple state update prevention using `isExpandedRef` check

**Rationale**:
- Just stop calling `setMessages` in `onMessagesChange` when `isExpandedRef.current` is true
- No complex copying, caching, or lifecycle management needed
- Leverages existing `isExpandedRef` pattern already in codebase
- Zero performance overhead and maximum simplicity

**Alternatives Considered**:
- Complex deep copying mechanisms → Rejected as unnecessary 
- Snapshot state management → Rejected due to added complexity
- Separate expanded mode state → Rejected as over-engineered

**Implementation Strategy**:
```typescript
// Simple conditional update in onMessagesChange
const onMessagesChange = (messages: Message[]) => {
  if (!isExpandedRef.current) {
    setMessages(messages);
  }
  // When expanded: do nothing, UI stays frozen at current state
};
```

**Benefits**:
- Zero performance overhead
- No memory management needed  
- Leverages existing `isExpandedRef` pattern
- Maximum simplicity and reliability

## Technical Architecture Decisions

### Callback Enhancement Pattern
```typescript
export interface MessageManagerCallbacks {
  // New streaming callbacks
  onAssistantContentUpdated?: (chunk: string, accumulated: string) => void;
  onToolBlockUpdated?: (params: AgentToolBlockUpdateParams) => void;
  
  // Modified: Remove arguments for separation of concerns
  onAssistantMessageAdded?: () => void;
  
  // ... existing callbacks unchanged
}
```

### View Mode Integration
```typescript
// Simple useChat context with view mode control
const displayMessages = messages; // Always use current messages

// Callback filtering based on view mode  
onAssistantContentUpdated: (chunk, accumulated) => {
  // Agent SDK updates message internally and triggers onMessagesChange
  // UI feedback only - no direct state updates needed
},
```


## Implementation Readiness

✅ **All technical unknowns resolved**  
✅ **Architecture patterns validated**  
✅ **Simple approach confirmed**  
✅ **Integration points with existing code identified**  
✅ **Testing strategies defined**  

**Next Phase**: Proceed to Phase 1 Design & Contracts with confidence in technical feasibility.

## Risk Mitigation

**Performance Risk**: Natural OpenAI API rate limiting (1-5fps) eliminates rendering performance concerns  
**Memory Risk**: No complex copying or snapshot state - zero memory overhead approach  
**Compatibility Risk**: Simple additive callbacks with no breaking changes  
**Complexity Risk**: Simple conditional updates require minimal implementation changes