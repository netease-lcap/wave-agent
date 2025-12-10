# Quick Start: Cache Control Replacement Implementation

**Feature**: 029-cache-20-messages  
**Target**: Developers replacing legacy cache control with interval-based system  

## Overview

This feature completely replaces the existing "last N user messages" cache control with interval-based caching (every 20th message regardless of role). **No backward compatibility** - this is a breaking change that simplifies the codebase by removing all legacy caching logic and configuration.

**Hardcoded Strategy**: All cache behavior is hardcoded with no configuration needed:
- Last system message: Always cached
- Last tool: Always cached  
- Message intervals: Every 20th message (sliding window)

**Sliding Window Behavior**: Only the **latest** interval message gets cached. When reaching the 40th message, the 20th message cache marker is removed and only the 40th message is cached.

## Implementation Checklist

### Phase 1: Remove All Configuration Code

- [ ] Delete `CacheControlConfig` interface entirely
- [ ] Delete `DEFAULT_CACHE_CONTROL_CONFIG` constant entirely
- [ ] Delete `findRecentUserMessageIndices` function entirely  
- [ ] Delete `addCacheControlToRecentUserMessages` function entirely
- [ ] Remove recent message logic from `transformMessagesForClaudeCache`
- [ ] Remove config parameter from `transformMessagesForClaudeCache` function signature

### Phase 2: Implement Hardcoded Strategy

- [ ] Implement `findIntervalMessageIndex` function (returns single number, not array)
- [ ] Hardcode all cache behavior in `transformMessagesForClaudeCache`
- [ ] Remove all configuration validation functions
- [ ] Remove all configuration-related imports

### Phase 3: Clean Up and Simplify

- [ ] Remove all backward compatibility code
- [ ] Update tests to remove all configuration test cases
- [ ] Clean up unused imports and helper functions
- [ ] Update function calls to remove config parameters

### Phase 4: Testing

- [ ] Test interval-based cache logic only
- [ ] Validate breaking changes work as expected
- [ ] Test edge cases (empty conversations, mixed message types)
- [ ] Ensure Claude integration still works

## Key Implementation Points

### 1. Simplified Configuration Structure

```typescript
// In cacheControlUtils.ts - REPLACE existing interface entirely
export interface CacheControlConfig {
  cacheSystemMessage: boolean;           // Preserved
  cacheLastTool: boolean;               // Preserved
  cacheMessageInterval: number;     // NEW: replaces cacheUserMessageCount
}

// REPLACE default configuration entirely
export const DEFAULT_CACHE_CONTROL_CONFIG: CacheControlConfig = {
  cacheSystemMessage: true,
  cacheLastTool: true,
  cacheMessageInterval: 20,          // NEW: cache every 20th message
} as const;
```

### 2. New Interval-based Message Selection

```typescript
// NEW function - add to cacheControlUtils.ts
export function findIntervalMessageIndex(
  messages: ChatCompletionMessageParam[]
): number {
  if (!Array.isArray(messages) || messages.length === 0) {
    return -1;
  }

  let latestIntervalIndex = -1;
  const interval = 20; // Hardcoded

  for (let i = 0; i < messages.length; i++) {
    const messagePosition = i + 1; // 1-based position
    
    // Cache on interval boundaries (20th, 40th, 60th message, etc.)
    if (messagePosition % interval === 0) {
      latestIntervalIndex = i; // Keep updating to get the latest (sliding window)
    }
  }

  return latestIntervalIndex;
}
```

### 3. Simplified Message Transformation Logic

```typescript
// REPLACE existing transformMessagesForClaudeCache function
export function transformMessagesForClaudeCache(
  messages: ChatCompletionMessageParam[],
  modelName: string,
  config: CacheControlConfig = DEFAULT_CACHE_CONTROL_CONFIG,
): ChatCompletionMessageParam[] {
  // Basic validation
  if (!messages || !Array.isArray(messages) || messages.length === 0) {
    return [];
  }

  if (!isClaudeModel(modelName)) {
    return messages;
  }

  // Get messages to cache using interval logic
  const indexToCache = findIntervalMessageIndex(messages);

  const result = messages.map((message, index) => {
    // System message caching (unchanged)
    if (message.role === "system" && config.cacheSystemMessage) {
      return {
        ...message,
        content: addCacheControlToContent(message.content, true),
      };
    }

    // Interval-based message caching (NEW - simplified)
    if (indicesToCache.includes(index)) {
      return {
        ...message,
        content: addCacheControlToContent(message.content, true),
      };
    }

    return message;
  });

  return result;
}
```

### 4. Code to DELETE Completely

```typescript
// DELETE these functions entirely from cacheControlUtils.ts:

// export function findRecentUserMessageIndices(...) { ... }        // DELETE
// export function addCacheControlToRecentUserMessages(...) { ... } // DELETE

// DELETE these properties from CacheControlConfig:
// cacheUserMessageCount: number;     // DELETE
// useIntervalCaching?: boolean;      // DELETE

// DELETE from DEFAULT_CACHE_CONTROL_CONFIG:
// cacheUserMessageCount: 2,          // DELETE

// DELETE any recent message logic in transformMessagesForClaudeCache:
// const userMessageIndices: number[] = [];        // DELETE
// messages.forEach((msg, idx) => { ... });       // DELETE  
// const isRecentUser = userMessageIndices        // DELETE
//   .slice(-config.cacheUserMessageCount)        // DELETE
//   .includes(index);                             // DELETE
```

## Testing Strategy

### Simplified Tests Focus

1. **Interval calculation accuracy**: Verify correct message position counting and interval detection
2. **Core functionality**: Test the 19→20→39→40 message scenarios
3. **Edge cases**: Empty conversations, mixed message types, invalid intervals
4. **Breaking changes**: Ensure old configuration properties cause TypeScript errors

### Test Scenarios (Replacement)

```typescript
// REPLACE existing tests with these simplified tests
describe('Interval-based cache control (replacement)', () => {
  test('should not cache when < 20 total messages', () => {
    const messages = createTestMessages(['user', 'assistant'], 19);
    
    const result = transformMessagesForClaudeCache(messages, 'claude-3');
    expect(getMessagesCacheMarkers(result)).toHaveLength(0);
  });

  test('should cache 20th message only', () => {
    const messages = createTestMessages(['user', 'assistant'], 20);
    
    const result = transformMessagesForClaudeCache(messages, 'claude-3');
    const markers = getMessagesCacheMarkers(result);
    expect(markers).toHaveLength(1);
    expect(markers[0].messagePosition).toBe(20);
  });

  test('should maintain cache at 20th when conversation has 39 total messages', () => {
    const messages = createTestMessages(['user', 'assistant'], 39);
    
    const result = transformMessagesForClaudeCache(messages, 'claude-3');
    const markers = getMessagesCacheMarkers(result);
    expect(markers).toHaveLength(1);
    expect(markers[0].messagePosition).toBe(20);
  });

  test('should cache only 40th message (sliding window)', () => {
    const messages = createTestMessages(['user', 'assistant'], 40);
    
    const result = transformMessagesForClaudeCache(messages, 'claude-3');
    const markers = getMessagesCacheMarkers(result);
    expect(markers).toHaveLength(1); // Only latest interval cached
    expect(markers[0].messagePosition).toBe(40); // 20th marker removed
  });

  test('should verify 20th cache is removed when reaching 40th', () => {
    // Test 20 messages - should cache 20th
    const messages20 = createTestMessages(['user', 'assistant'], 20);
    const config = { 
      cacheSystemMessage: true, 
      cacheLastTool: true,
      cacheMessageInterval: 20 
    };
    
    const result20 = transformMessagesForClaudeCache(messages20, 'claude-3');
    const markers20 = getMessagesCacheMarkers(result20);
    expect(markers20).toHaveLength(1);
    expect(markers20[0].messagePosition).toBe(20);
    
    // Test 40 messages - should cache only 40th (20th removed)
    const messages40 = createTestMessages(['user', 'assistant'], 40);
    const result40 = transformMessagesForClaudeCache(messages40, 'claude-3');
    const markers40 = getMessagesCacheMarkers(result40);
    expect(markers40).toHaveLength(1);
    expect(markers40[0].messagePosition).toBe(40);
  });

  // DELETE tests for backward compatibility - not needed
  // DELETE tests for strategy selection - not needed  
  // DELETE tests for migration - not needed
});
```

### Tests to DELETE

```typescript
// DELETE these test categories entirely:
// describe('Recent message caching (legacy)')     // DELETE
// describe('Configuration migration')             // DELETE  
// describe('Strategy selection')                  // DELETE
// describe('Backward compatibility')              // DELETE
// test('should maintain legacy behavior')         // DELETE
// test('should migrate old configurations')       // DELETE
```

## No Configuration Needed

### Hardcoded Cache Strategy

```typescript
// No configuration object needed - all behavior is hardcoded:
// - Last system message: Always cached
// - Last tool: Always cached  
// - Message interval: Fixed at 20 (every 20th message)

// Usage:
const result = transformMessagesForClaudeCache(messages, 'claude-3');
```

### Configurations That Cause Errors (Breaking Changes)

```typescript
// These will cause TypeScript compilation errors:
const oldConfig = {
  cacheSystemMessage: true,
  cacheUserMessageCount: 2,        // ERROR: Property does not exist
  cacheLastTool: true
};

const legacyConfig = {
  cacheSystemMessage: true,
  cacheLastTool: true,
  useIntervalCaching: false,       // ERROR: Property does not exist
  cacheUserMessageInterval: 20
};
```

## Breaking Changes Migration

### Required Code Changes

1. **Update Configuration Objects**:
   ```typescript
   // Change from:
   const oldConfig = {
     cacheSystemMessage: true,
     cacheUserMessageCount: 2,     // REMOVE
     cacheLastTool: true
   };
   
   // Change to:
   const newConfig = {
     cacheSystemMessage: true,
     cacheLastTool: true,
     cacheUserMessageInterval: 20  // ADD
   };
   ```

2. **Replace Function Calls**:
   ```typescript
   // Replace:
   const cached = addCacheControlToRecentUserMessages(messages, 2);
   
   // With:
   const cached = transformMessagesForClaudeCache(messages, 'claude-3', {
     cacheSystemMessage: true,
     cacheLastTool: true,
     cacheUserMessageInterval: 20
   });
   ```

3. **Update Imports** (if importing specific functions):
   ```typescript
   // Remove:
   import { addCacheControlToRecentUserMessages } from './cacheControlUtils';
   
   // Use instead:
   import { transformMessagesForClaudeCache } from './cacheControlUtils';
   ```

## Development Workflow

1. **Delete old code first**: Remove all legacy functions and properties to avoid confusion
2. **Implement new logic**: Add interval-based functions and configuration
3. **Update defaults**: Change default configuration to use interval caching
4. **Replace tests**: Remove old tests, add new interval-focused tests
5. **Test thoroughly**: Focus on the 19/20/39/40 message scenarios
6. **Update consuming code**: Fix any code that uses the old API

## Common Issues & Solutions

### Issue: TypeScript Errors After Update
**Symptoms**: Compilation errors about missing properties  
**Solution**: Update all configuration objects to use new `cacheUserMessageInterval` property

### Issue: Function Not Found Errors  
**Symptoms**: Runtime errors about deleted functions  
**Solution**: Replace calls to deleted functions with `transformMessagesForClaudeCache`

### Issue: Cache Behavior Changed Unexpectedly
**Symptoms**: Different caching patterns than before  
**Solution**: Expected - this is a breaking change. Verify new interval logic is working correctly

### Issue: Tests Failing After Update
**Symptoms**: Existing tests fail due to removed functionality  
**Solution**: Replace or delete tests that relied on legacy behavior

## Success Criteria

- [ ] All legacy cache control code removed from codebase
- [ ] TypeScript compilation passes with new configuration structure
- [ ] Conversations with < 20 total messages have no cache markers
- [ ] Conversations with exactly 20 total messages have cache marker on 20th message  
- [ ] Conversations with 39 total messages maintain cache marker only on 20th message
- [ ] Conversations with 40 total messages have cache marker **only** on 40th message (20th removed - sliding window)
- [ ] Claude integration continues to work with new cache markers
- [ ] All consuming code updated to use new API
- [ ] Test suite passes with simplified test scenarios