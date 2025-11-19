# Data Model: Real-Time Content Streaming

**Phase 1 Design**: Simplified approach  
**Date**: 2025-11-19

## Core Approach

The streaming content feature requires **no new data entities**. All functionality is achieved by:

1. **Leveraging Existing Message State**: Use current `Message[]` array and existing message structures
2. **Simple View Mode Control**: Use existing `isExpandedRef` pattern to control UI updates  
3. **Callback-Only Streaming**: Streaming callbacks provide real-time UI feedback without managing state

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