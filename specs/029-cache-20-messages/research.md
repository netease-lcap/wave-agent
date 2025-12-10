# Research: Improved Message Cache Strategy

**Date**: 2025-12-10  
**Feature**: 029-cache-20-messages  

## Current Implementation Analysis

### Cache Control System Architecture

**Decision**: Replace existing Claude cache control system in `cacheControlUtils.ts` completely  
**Rationale**: Current system uses `cacheUserMessageCount: 2` to cache the last 2 user messages. User wants interval-based caching (every 20th message) without backward compatibility, so we can simplify by removing all "recent messages" logic.  
**Alternatives considered**: Maintaining dual systems was rejected per user requirements - clean replacement preferred.

### Current "Last N Messages" Strategy - TO BE REMOVED

**Decision**: Remove all "recent window" approach code entirely  
**Rationale**: Functions like `findRecentUserMessageIndices` and `addCacheControlToRecentUserMessages` implement the old strategy and should be deleted. The `cacheUserMessageCount` property is no longer needed.  
**Alternatives considered**: Keeping as fallback was rejected - user explicitly wants no backward compatibility.

### Hardcoded Strategy (No Configuration)

**Decision**: Remove `CacheControlConfig` entirely and hardcode all cache behavior  
**Rationale**: Remove `cacheUserMessageCount` property entirely. Replace with single `cacheUserMessageInterval` property. No need for strategy selection flags since only one strategy remains.  
**Alternatives considered**: Keeping old properties was rejected per user requirements.

### Cache Control Application Method

**Decision**: Maintain existing `cache_control: { type: "ephemeral" }` marker system  
**Rationale**: Claude's cache control markers are well-established. Only the message selection logic changes, not the marker application. Existing `addCacheControlToContent` function works perfectly.  
**Alternatives considered**: New cache marker types were rejected as Claude API expects specific format.

### Interval Calculation Logic

**Decision**: Implement total message counter with modulo arithmetic for interval detection  
**Rationale**: Count all messages (user and assistant) sequentially and cache messages at positions where `(messageIndex + 1) % interval === 0`. This provides clean 20, 40, 60 pattern for total message positions.  
**Alternatives considered**: Counting only user messages was rejected - requirement is for total message positions.

## Technical Decisions

### No Configuration Needed

1. **Remove `CacheControlConfig`**: Delete interface entirely 
2. **Remove `DEFAULT_CACHE_CONTROL_CONFIG`**: Delete constant entirely
3. **Hardcode all settings**: Last system message always cached, last tool always cached, interval fixed at 20
4. **Simplify function signatures**: Remove config parameters from all functions

### Functions to Remove Completely

1. **`findRecentUserMessageIndices`**: Delete function entirely
2. **`addCacheControlToRecentUserMessages`**: Delete function entirely  
3. **Recent message logic in `transformMessagesForClaudeCache`**: Remove all backward-counting logic

### Functions to Implement

1. **`findIntervalUserMessageIndices`**: New function for forward-counting interval logic
2. **Simplified `transformMessagesForClaudeCache`**: Clean implementation with only interval logic

### Implementation Approach

1. **Clean Slate**: Remove all recent message caching code
2. **Single Strategy**: Only interval-based caching remains
3. **Simplified Logic**: No configuration validation for multiple strategies
4. **Direct Implementation**: No fallback or migration code needed

## Cache Pattern Analysis

### Old Pattern (TO BE REMOVED)

```
Messages: [U1, A1, U2, A2, U3, A3, U4, A4, U5, A5]
Cached:   [ -,  -, -,  -,  -,  -, U4,  -, U5,  -]
```

### New Pattern (ONLY IMPLEMENTATION)

```
Messages (20 total): [U1, A1, U2, A2, U3, A3, ..., U9, A9, U10, A10]
Cached:               [ -,  -,  -,  -,  -,  -, ...,  -,  -,   -,  A10]
                                                               ↑ 20th position
```

```  
Messages (40 total): [U1, A1, U2, A2, U3, A3, ..., U19, A19, U20, A20]
Cached:               [ -,  -,  -,  -,  -,  -, ...,   -,   -,   -,  A20]
                                                                    ↑ 40th position (20th removed)
```

Messages at positions 20, 40, 60, etc. get cache markers regardless of role.
**Sliding Window**: Only the **latest** interval position is cached (previous markers removed).

## Code Cleanup Requirements

1. **Delete unused functions**: Remove all recent message caching functions
2. **Simplify configuration**: Remove properties related to old strategy
3. **Clean up tests**: Remove tests for deleted functionality
4. **Update documentation**: Remove references to old caching strategy
5. **Simplified logic**: No complex configuration validation needed

## Dependencies and Integration Points

**Decision**: No new external dependencies, simplified internal dependencies  
**Rationale**: Same Claude integration, same marker application, but simpler selection logic. Fewer internal function calls and cleaner code paths.  
**Alternatives considered**: Adding new dependencies was rejected - simplification is the goal.