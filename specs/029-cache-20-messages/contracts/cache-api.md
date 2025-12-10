# Message Cache Management API Contracts

## MessageManager Interface Extensions

### Message Count Tracking

```typescript
interface MessageCountTracker {
  getCurrentCount(): number;
  getNextCacheThreshold(): number;
  shouldCreateCache(newMessageCount: number): boolean;
  updateAfterCache(cacheIndex: number): void;
}
```

**Usage**:
- `getCurrentCount()`: Returns current total message count
- `getNextCacheThreshold()`: Returns next multiple of 20 for caching
- `shouldCreateCache()`: Determines if cache creation is needed
- `updateAfterCache()`: Updates tracking after cache creation

### Cache Management Operations

```typescript
interface CacheManager {
  createCacheMarker(
    messages: Message[], 
    cacheIndex: number, 
    sessionId: string
  ): Promise<CompressBlock>;
  
  updateCachePosition(
    messages: Message[], 
    newCacheIndex: number
  ): Message[];
  
  getCacheMarkerPosition(messages: Message[]): number | null;
}
```

**Usage**:
- `createCacheMarker()`: Creates new cache at specified message index
- `updateCachePosition()`: Moves cache marker to new position  
- `getCacheMarkerPosition()`: Finds current cache marker location

## AIManager Interface Extensions

### Compression Trigger Management

```typescript
interface CompressionTrigger {
  checkCompressionNeeded(
    messageCount: number,
    tokenCount: number
  ): {
    shouldCompress: boolean;
    reason: 'message-count' | 'token-limit' | 'none';
    targetIndex: number;
  };
}
```

**Usage**:
- Evaluates both message count and token limits
- Returns compression decision with reasoning
- Provides target index for cache creation

### Enhanced Message Operations

```typescript
interface MessageOperations {
  getMessagesToCompress(
    messages: Message[],
    options: {
      keepLastCount?: number;
      forceCacheIndex?: number; // New: force cache at specific index
    }
  ): {
    messagesToCompress: Message[];
    insertIndex: number;
    targetCacheIndex: number; // New: where cache will be placed
  };
}
```

**Usage**:
- Enhanced version of existing function
- Supports forced cache creation at specific message indices
- Returns additional metadata about cache placement

## Session Persistence Contracts

### Enhanced Session State

```typescript
interface SessionState {
  messages: Message[];
  messageCount: number; // New: explicit count tracking
  cachePositions: number[]; // New: track all cache positions
  lastCacheIndex: number; // New: most recent cache location
  sessionId: string;
}
```

**Usage**:
- Extends existing session persistence
- Tracks cache-related metadata
- Enables proper session restoration

### Session Operations

```typescript
interface SessionManager {
  loadSession(sessionId: string): Promise<SessionState>;
  saveSession(state: SessionState): Promise<void>;
  reconstructCacheState(messages: Message[]): {
    messageCount: number;
    cachePositions: number[];
    lastCacheIndex: number;
  };
}
```

**Usage**:
- Loads/saves enhanced session state
- Reconstructs cache metadata from message history
- Maintains consistency between memory and storage

## Event Contracts

### Cache Events

```typescript
interface CacheEvents {
  onCacheCreated: (event: {
    sessionId: string;
    cacheIndex: number;
    compressedMessageCount: number;
    timestamp: Date;
  }) => void;
  
  onCacheUpdated: (event: {
    sessionId: string;
    oldCacheIndex: number;
    newCacheIndex: number;
    timestamp: Date;
  }) => void;
}
```

**Usage**:
- Event notifications for cache operations
- Enables logging and monitoring
- Supports debugging and analytics

## Error Handling Contracts

### Cache Operation Errors

```typescript
interface CacheError extends Error {
  code: 'INVALID_CACHE_INDEX' | 'COMPRESSION_FAILED' | 'INVALID_MESSAGE_COUNT';
  sessionId: string;
  context: {
    messageCount?: number;
    requestedCacheIndex?: number;
    availableIndices?: number[];
  };
}
```

**Usage**:
- Structured error handling for cache operations
- Provides context for debugging
- Enables appropriate error recovery

## Configuration Contracts

### Cache Configuration

```typescript
interface CacheConfig {
  messageInterval: number; // Default: 20
  maxCacheMarkers: number; // Default: unlimited
  enableTokenBasedFallback: boolean; // Default: true
  compressionPrompt?: string; // Custom compression instructions
}
```

**Usage**:
- Configurable cache behavior
- Allows customization of intervals and limits
- Maintains backward compatibility with defaults