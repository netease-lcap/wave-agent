# Data Model: Real-Time Content Streaming

**Phase 1 Design**: Simplified approach  
**Date**: 2025-11-19  
**Updated**: 2026-04-09 (PR #928 — stage field additions)

## Core Approach

The streaming content feature requires **no new data entities**. All functionality is achieved by:

1. **Leveraging Existing Message State**: Use current `Message[]` array and existing message structures
2. **Simple View Mode Control**: Use existing `isExpandedRef` pattern to control UI updates  
3. **Callback-Only Streaming**: Streaming callbacks provide real-time UI feedback without managing state
4. **Block-Level Stage Tracking**: TextBlock, ReasoningBlock, and BangBlock use `stage` fields to distinguish streaming from completed state

## No Additional Entities Needed

### ❌ ContentState - Not Required
- **Why**: Agent SDK updates existing message content directly
- **Instead**: Use existing `message.blocks[0].content` 

### ❌ ParameterState - Not Required  
- **Why**: Agent SDK updates existing tool block parameters directly
- **Instead**: Use existing `toolBlock.parameters`

### ❌ StreamingContext - Not Required
- **Why**: No complex state management needed
- **Instead**: Use existing Agent state and callbacks

### ❌ ContentSnapshot - Not Required
- **Why**: View mode freezing handled by conditional UI updates
- **Instead**: Simple `if (!isExpandedRef.current) { setMessages(messages); }`

## Implementation Pattern

```typescript
// All streaming functionality achieved with existing entities:

// 1. Content streaming - updates existing message
onAssistantContentUpdated: (chunk: string, accumulated: string) => {
  // Agent SDK updates message.blocks[0].content = accumulated
  // Then triggers existing onMessagesChange(updatedMessages)
},

// 2. Tool parameter streaming - updates existing tool block  
onToolBlockUpdated: (params: ToolBlockParams) => {
  // Agent SDK updates toolBlock.parameters = params.parameters
  // Agent SDK updates toolBlock.stage = params.stage
  // Then triggers existing onMessagesChange(updatedMessages)
},

// 3. View mode control - uses existing state
const onMessagesChange = (messages: Message[]) => {
  if (!isExpandedRef.current) {
    setMessages(messages); // Only update UI when collapsed
  }
  // When expanded: UI stays frozen at current state
};
```

## Benefits of No-Entity Approach

- **Zero Complexity**: No new data structures to maintain
- **Zero Memory Overhead**: No additional state management
- **Maximum Reliability**: Leverages existing, proven patterns
- **Clean Integration**: Works seamlessly with current architecture
- **Simple Testing**: No complex entity validation or lifecycle testing needed

## Integration with Existing Code

The streaming feature integrates entirely through:

1. **Enhanced Callbacks**: Add streaming callbacks to existing `MessageManagerCallbacks`
2. **Existing Messages**: All updates flow through current `Message[]` state
3. **Existing Patterns**: View mode control uses current `isExpandedRef` pattern  
4. **Existing Flow**: All state updates through existing `onMessagesChange`

**Result**: Real-time streaming functionality with zero new data model complexity.

## Block Stage Fields (PR #928)

### TextBlock

```typescript
interface TextBlock {
  type: "text";
  content: string;
  customCommandContent?: string;
  source?: MessageSource;
  stage?: "streaming" | "end";  // NEW: added 2026-04-09
}
```

### ReasoningBlock

```typescript
interface ReasoningBlock {
  type: "reasoning";
  content: string;
  stage?: "streaming" | "end";  // NEW: added 2026-04-09
}
```

### BangBlock

```typescript
interface BangBlock {
  type: "bang";
  command: string;
  output: string;
  stage: "running" | "end";     // REPLACES isRunning: boolean
  exitCode: number | null;
}
```

### Finalization Behavior

- `finalizeCurrentStreamingBlocks()` is called before `updateToolBlock` and `addToolBlock`
- It sets all streaming text/reasoning blocks on the last assistant message to `stage: "end"`
- This ensures streaming blocks are properly closed before tool blocks are added