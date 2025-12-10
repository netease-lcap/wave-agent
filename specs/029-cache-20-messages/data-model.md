# Data Model: Improved Message Cache Strategy

**Date**: 2025-12-10  
**Feature**: 029-cache-20-messages  

## Core Implementation

### Hardcoded Cache Strategy

Simple hardcoded behavior with no configuration or complex entities needed:

**Fixed Behavior**:
- Last system message: Always cached
- Last tool: Always cached  
- Message interval: Fixed at 20 (every 20th message gets cached)
- Sliding window: Only latest interval message is cached

**Simple Algorithm**:
```typescript
function findIntervalMessageIndex(messages: ChatCompletionMessageParam[]): number {
  let latestIntervalIndex = -1;
  
  for (let i = 0; i < messages.length; i++) {
    if ((i + 1) % 20 === 0) {  // 1-based position check
      latestIntervalIndex = i;  // Keep latest interval position
    }
  }
  
  return latestIntervalIndex; // Returns single index or -1
}
```

## Function Signatures

### Main Function
```typescript
function transformMessagesForClaudeCache(
  messages: ChatCompletionMessageParam[],
  modelName: string
): ChatCompletionMessageParam[]
```

### Helper Function
```typescript
function findIntervalMessageIndex(
  messages: ChatCompletionMessageParam[]
): number  // Returns single index or -1
```

### Removed Functions
- `findRecentUserMessageIndices` - DELETED
- `addCacheControlToRecentUserMessages` - DELETED

## Implementation Notes

### What Gets Deleted
- `CacheControlConfig` interface - DELETED entirely
- `DEFAULT_CACHE_CONTROL_CONFIG` constant - DELETED entirely  
- All configuration validation functions - DELETED entirely
- All configuration parameters from function signatures - DELETED

### What Gets Hardcoded
- Last system message: Always apply cache control
- Last tool message: Always apply cache control
- Message interval: Fixed at 20 (every 20th message)
- Cache strategy: Sliding window (only latest interval cached)

### Simple Flow
1. **Input**: Array of messages + model name
2. **Process**: Find latest message at position 20, 40, 60, etc.
3. **Output**: Messages with cache markers applied to last system, last tool, and latest interval message

No complex entities, state tracking, or configuration management needed.