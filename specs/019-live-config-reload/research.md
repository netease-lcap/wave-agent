# Research: Live Configuration Reload

**Branch**: `019-live-config-reload` | **Date**: 2024-12-01  
**Purpose**: Research technical approaches for implementing live configuration reload in Wave Agent SDK

## Research Areas

### 1. File Watching API Selection

**Decision**: Use Chokidar library for file watching  
**Rationale**: 
- Robust cross-platform support with consistent behavior
- Built-in debouncing eliminates need for custom debounce implementation
- Better error handling and recovery mechanisms
- Simplified API reduces implementation complexity
- Well-tested in production environments

**Alternatives considered**:
- Node.js built-in `fs.watch()`: More complex implementation with platform inconsistencies
- `fs.watchFile()`: Polling-based with higher CPU overhead
- Manual polling: Simple but inefficient for real-time updates

**Implementation approach**: Use Chokidar's simple API with built-in debouncing and cross-platform compatibility.

### 2. Memory Storage Strategy

**Decision**: Keep AGENTS.md content in memory with file watcher updates  
**Rationale**: 
- Current system reads AGENTS.md on every agent call via `getCombinedMemoryContent()`
- Simple in-memory storage eliminates I/O overhead completely after initial load
- File watcher updates memory content when file changes, ensuring freshness
- No complex caching logic needed - just store current file content

**Alternatives considered**:
- LRU cache with invalidation: Unnecessary complexity for single file storage
- Time-based expiration: Less responsive to actual file changes
- No memory storage: Inefficient for frequent agent calls

**Implementation approach**: Single variable holding AGENTS.md content, updated by file watcher on changes.

### 3. Error Handling and Recovery

**Decision**: Hierarchical fallback system with graceful degradation  
**Rationale**:
- Production systems require 99.9% uptime despite file system failures
- Multiple fallback layers ensure continued operation under various failure modes
- Exponential backoff prevents resource exhaustion during recovery attempts

**Alternatives considered**:
- Fail-fast approach: Simple but disrupts user workflow
- Polling-only fallback: Reliable but higher resource usage
- No fallback: Unacceptable for production use

**Implementation approach**: Primary file watcher → polling fallback → memory content → empty content with comprehensive error logging.

### 4. Environment Variable Merging

**Decision**: Project-level precedence over user-level with shallow merging  
**Rationale**:
- Follows existing Wave Agent pattern where project `.wave/settings.json` overrides user `~/.wave/settings.json`
- Shallow merging appropriate for scalar environment variables
- Consistent with industry standard precedence: Runtime > Project > User > System

**Alternatives considered**:
- Deep merging: Unnecessary complexity for key-value pairs
- User precedence: Conflicts with existing hook configuration patterns
- No merging: Limits configuration flexibility

**Implementation approach**: Extend existing `loadMergedHooksConfig()` pattern to include env field merging with runtime validation using the new `WaveConfiguration` interface.

### 5. Debouncing Strategy

**Decision**: 300ms debouncing with burst handling for rapid file changes  
**Rationale**:
- Text editors often save files multiple times in quick succession
- 300ms provides good balance between responsiveness and stability
- Event coalescing prevents processing duplicate changes
- Handles common editor patterns (atomic saves, temp file creation)

**Alternatives considered**:
- No debouncing: System instability during rapid changes
- Throttling: Less effective for burst modifications
- Longer delays (1000ms+): Poor user experience

**Implementation approach**: Debounced event handler with maximum delay protection and temp file filtering.

## Integration Strategy

### Extend Existing Services

**Decision**: Modify existing agent-sdk services rather than create new packages  
**Rationale**:
- Follows Wave Agent constitution principle of package-first architecture
- Leverages existing patterns in `hook.ts` and `memory.ts` services
- Maintains backward compatibility with current hook system

**Implementation files**:
- `packages/agent-sdk/src/services/hook.ts`: Add env field loading and watching
- `packages/agent-sdk/src/services/memory.ts`: Add in-memory storage and watcher integration  
- `packages/agent-sdk/src/managers/hookManager.ts`: Add live reload coordination
- `packages/agent-sdk/src/types/hooks.ts`: Rename HookConfiguration to WaveConfiguration and add env field

### Type System Evolution

**Decision**: Extend existing `HookConfiguration` interface rather than create new types  
**Rationale**:
- Follows constitution principle IX of evolving existing types
- Maintains semantic consistency with current configuration structure
- Reduces cognitive overhead for developers

**Type changes**:
```typescript
// Rename to better express complete configuration
interface WaveConfiguration {
  hooks?: Partial<Record<HookEvent, HookEventConfig[]>>;
  env?: Record<string, string>; // New field
}
```

### Testing Approach

**Decision**: Follow existing TDD patterns with comprehensive file watcher testing  
**Rationale**:
- Aligns with constitution requirement for test-driven development
- File watchers require special testing considerations for timing and file system operations
- Use temporary directories and fake timers for deterministic testing

**Test structure**:
- Unit tests for individual components (caching, merging, debouncing)
- Integration tests for file watcher behavior with real file operations  
- Performance tests for memory usage and response times

## Performance Expectations

Based on research findings:

- **File change detection**: <50ms typical response time
- **Memory usage**: <1MB for typical configurations including stored content
- **I/O reduction**: 100% elimination of file reads after initial load
- **CPU overhead**: <1% during idle periods
- **Memory cache hit rate**: 100% after initial load (content always in memory)

## Risk Mitigation

1. **File system limits**: Monitor watcher count, implement pooling for high file counts
2. **Platform differences**: Test thoroughly on Linux, macOS, Windows with platform-specific handling
3. **Race conditions**: Use file locking and version-based processing
4. **Memory leaks**: Implement proper cleanup and resource management
5. **Configuration corruption**: Validate JSON integrity and provide recovery mechanisms

This research provides the foundation for implementing a robust, performant live configuration reload system that integrates seamlessly with the existing Wave Agent SDK architecture.