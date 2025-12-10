# Cache Control API Contracts

## Simplified Configuration Interface

### CacheControlConfig (Replaced)

```typescript
interface CacheControlConfig {
  cacheSystemMessage: boolean;
  cacheLastTool: boolean;
  cacheMessageInterval: number;    // New: replaces all old user message caching
}
```

**Usage**:
- `cacheMessageInterval`: Interval for periodic message caching (e.g., 20 = every 20th message)
- **REMOVED**: `cacheUserMessageCount` (deleted entirely)
- **REMOVED**: `useIntervalCaching` (no strategy selection needed)

**Validation Rules**:
- `cacheMessageInterval` must be positive integer (1-100 recommended)
- All properties are required (no optional properties)

## Simplified Default Configuration

### Updated Default Config (Breaking Change)

```typescript
const DEFAULT_CACHE_CONTROL_CONFIG: CacheControlConfig = {
  cacheSystemMessage: true,
  cacheLastTool: true,
  cacheMessageInterval: 20,        // New default: every 20th message
} as const;
```

**Breaking Changes**:
- `cacheUserMessageCount: 2` - REMOVED
- No backward compatibility properties

## Core Function Replacement

### transformMessagesForClaudeCache (Simplified)

```typescript
function transformMessagesForClaudeCache(
  messages: ChatCompletionMessageParam[],
  modelName: string
): ChatCompletionMessageParam[]
```

**Simplified Behavior**:
- **Hardcoded Strategy**: Only interval-based caching (every 20th message)
- **No Configuration**: All cache settings are hardcoded  
- **Direct Processing**: Uses `findIntervalMessageIndices` directly
- **Clean Logic**: No configuration parameters or validation needed

**Simplified Internal Logic**:
1. Validate inputs and model compatibility
2. Apply interval-based caching to messages at specific positions
3. Apply cache control to system messages and tools (unchanged)

## New Core Function

### findIntervalMessageIndices (Replacement)

```typescript
function findIntervalMessageIndex(
  messages: ChatCompletionMessageParam[]
): number
```

**Usage**:
- Replaces `findRecentUserMessageIndices` (deleted)
- Implements hardcoded sliding window message position interval logic (every 20th message)
- Returns **single** message index at latest interval position (20, 40, 60, etc.) or -1 if none

**Algorithm**:
```typescript
function findIntervalMessageIndex(
  messages: ChatCompletionMessageParam[]
): number {
  if (!Array.isArray(messages) || messages.length === 0) {
    return -1;
  }

  let latestIntervalIndex = -1;
  const interval = 20; // Hardcoded

  for (let i = 0; i < messages.length; i++) {
    const messagePosition = i + 1; // 1-based position
    if (messagePosition % interval === 0) {
      latestIntervalIndex = i; // Keep updating to get the latest (sliding window)
    }
  }

  return latestIntervalIndex;
}
```

## Removed Functions (Breaking Changes)

### Deleted Functions

```typescript
// These functions are REMOVED entirely:

// function findRecentUserMessageIndices(...) - DELETED
// function addCacheControlToRecentUserMessages(...) - DELETED
// function shouldUseIntervalCaching(...) - DELETED (no strategy selection)
// function migrateLegacyConfig(...) - DELETED (no backward compatibility)
```

**Migration Required**:
- Code using `addCacheControlToRecentUserMessages` must switch to using `transformMessagesForClaudeCache`
- Code using `findRecentUserMessageIndices` must switch to `findIntervalMessageIndices`

## Simplified Message Processing

### Direct Interval Processing (Simplified)

```typescript
function transformMessagesForClaudeCache(
  messages: ChatCompletionMessageParam[],
  modelName: string,
  config: CacheControlConfig = DEFAULT_CACHE_CONTROL_CONFIG
): ChatCompletionMessageParam[] {
  // Basic validation
  if (!messages || !Array.isArray(messages) || messages.length === 0) {
    return [];
  }

  if (!isClaudeModel(modelName)) {
    return messages;
  }

  // Find messages to cache using interval logic
  const indexToCache = findIntervalMessageIndex(messages);
  
  // Find last system message index
  let lastSystemIndex = -1;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === "system") {
      lastSystemIndex = i;
      break;
    }
  }

  return messages.map((message, index) => {
    // Last system message caching (hardcoded: always enabled)
    if (message.role === "system" && index === lastSystemIndex) {
      return {
        ...message,
        content: addCacheControlToContent(message.content, true),
      };
    }

    // Tool caching (hardcoded: always enabled for last tool)
    if (message.role === "assistant" && message.tool_calls && index === messages.length - 1) {
      return {
        ...message,
        content: addCacheControlToContent(message.content, true),
      };
    }

    // Interval-based message caching (hardcoded: every 20th message)
    if (index === indexToCache) {
      return {
        ...message,
        content: addCacheControlToContent(message.content, true),
      };
    }

    return message;
  });
}
```

## No Configuration Validation Needed

### Hardcoded Cache Strategy

All cache behavior is now hardcoded:
- System messages: Always cached
- Last tool: Always cached
- Message intervals: Every 20th message (sliding window)

No configuration objects, validation, or default values needed.

## Error Handling (Simplified)

### Simplified Cache Control Errors

```typescript
interface CacheControlError extends Error {
  code: 'INVALID_INTERVAL' | 'INVALID_CONFIG';
  config?: CacheControlConfig;
  context?: {
    requestedInterval?: number;
    messageCount?: number;
  };
}
```

**Usage**:
- Simplified error types (removed strategy-related errors)
- Basic validation errors only
- No fallback or migration error handling

## Performance Contracts

### Simplified Performance Guarantees

- `findIntervalUserMessageIndices`: O(n) time, O(k) space where k = cache markers
- `transformMessagesForClaudeCache`: O(n) time (no strategy branching overhead)
- Memory usage: Minimal (same array with cache markers)

### Optimization Benefits

- No strategy selection overhead
- Single code path execution
- Simplified configuration processing
- Cleaner function call stack

## Testing Contracts (Simplified)

### Core Test Requirements

```typescript
describe('Interval-based cache control', () => {
  test('should cache every Nth user message');
  test('should handle conversations with < N user messages');
  test('should validate interval configuration');
  test('should handle edge cases (empty arrays, invalid messages)');
});
```

**Removed Tests**:
- No backward compatibility tests
- No strategy selection tests  
- No migration tests
- No fallback behavior tests

## Breaking Changes Summary

### Configuration Changes

```typescript
// OLD (no longer supported):
interface CacheControlConfig {
  cacheSystemMessage: boolean;
  cacheUserMessageCount: number;    // REMOVED
  cacheLastTool: boolean;
  cacheMessageInterval?: number; // REMOVED optional
  useIntervalCaching?: boolean;      // REMOVED
}

// NEW (required):
interface CacheControlConfig {
  cacheSystemMessage: boolean;
  cacheLastTool: boolean;
  cacheMessageInterval: number;   // Required, replaces old properties
}
```

### Function Changes

```typescript
// REMOVED FUNCTIONS:
// - findRecentUserMessageIndices
// - addCacheControlToRecentUserMessages
// - shouldUseIntervalCaching
// - migrateLegacyConfig

// NEW FUNCTIONS:
// - findIntervalMessageIndices (replacement)

// MODIFIED FUNCTIONS:
// - transformMessagesForClaudeCache (simplified logic)
```

### Migration Guide

1. **Update Configuration**:
   ```typescript
   // Change from:
   const oldConfig = { cacheUserMessageCount: 2 };
   
   // Change to:
   const newConfig = { cacheMessageInterval: 20 };
   ```

2. **Update Function Calls**:
   ```typescript
   // Replace:
   addCacheControlToRecentUserMessages(messages, 2);
   
   // With:
   transformMessagesForClaudeCache(messages, modelName, { cacheMessageInterval: 20 });
   ```

3. **Remove Strategy Selection**:
   ```typescript
   // Remove:
   config.useIntervalCaching = true;
   
   // No replacement needed (interval is default behavior)
   ```