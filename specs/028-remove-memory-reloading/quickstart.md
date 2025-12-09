# Quickstart: Memory Architecture Simplification

This guide provides a quick overview of the memory architecture changes and how to work with the new simplified system.

## What Changed

### Before: Complex Multi-Service Architecture
- Memory content cached in separate MemoryStoreService
- Continuous file watching for automatic memory updates  
- Complex dependency chain: Agent → LiveConfigManager → ConfigurationWatcher
- Multiple abstraction layers for memory access

### After: Simplified Direct Architecture
- Memory content stored directly in Agent class properties
- Memory loaded once during agent initialization
- Single configuration manager (merged components)
- Direct file access with simple error handling

## New Memory Access Pattern

### Reading Memory Content
```typescript
const agent = await Agent.create({ workdir: "./my-project" });

// Access memory content (readonly)
const projectMemory = agent.projectMemory;     // Content from AGENTS.md
const userMemory = agent.userMemory;           // Content from user memory file
const allMemory = agent.combinedMemory;        // Both combined

console.log("Project memories:", projectMemory);
console.log("User memories:", userMemory);
```

### Saving Memory Content  
```typescript
// Save to project memory (AGENTS.md)
await agent.saveMemory("#Important project insight", "project");

// Save to user memory  
await agent.saveMemory("#Personal preference", "user");

// Content is automatically updated in agent after successful save
console.log("Updated project memory:", agent.projectMemory);
```

## Key Behavioral Changes

### Memory Loading
- **Before**: Memory loaded on-demand and cached in MemoryStoreService
- **After**: Memory loaded once during `Agent.create()` initialization
- **Impact**: Memory content is static during agent session

### File Changes
- **Before**: Memory automatically updated when files changed on disk
- **After**: Memory content remains static until agent restart
- **Impact**: Restart agent to pick up manual file changes

### Error Handling
- **Before**: Complex caching states and retry logic
- **After**: Simple fallback to empty content on errors
- **Impact**: More predictable error behavior, agent starts even with missing memory files

## Migration Guide

### If You Used Agent.memoryStore Directly
```typescript
// OLD (no longer works)
const content = await agent.memoryStore.getContent(memoryPath);

// NEW (use agent properties)  
const content = agent.projectMemory; // or agent.userMemory
```

### If You Relied on Live Memory Updates
```typescript
// OLD behavior (automatic updates)
// Memory would update when AGENTS.md file changed

// NEW behavior (static during session)
// Restart agent to pick up file changes, or use saveMemory() method
await agent.saveMemory("#New insight", "project");
```

### If You Used Memory Utility Functions
```typescript
// These functions still work the same way
import { readMemoryFile, addMemory } from "./services/memory.js";

const content = await readMemoryFile(workdir);
await addMemory("#New memory", workdir);

// But agent's internal content won't auto-update from direct file operations
// Use agent.saveMemory() instead for consistent behavior
```

## Configuration Management Changes

### LiveConfigManager Consolidation
- ConfigurationWatcher functionality merged into LiveConfigManager
- Same public API maintained for backward compatibility
- Settings file watching continues to work normally
- Only memory file watching was removed

### No Changes Needed For
- Agent initialization and configuration
- Settings file live reloading
- Hook system integration
- MCP server management

## Testing Changes

### Memory Tests
```typescript
// OLD (testing MemoryStoreService)
const memoryStore = new MemoryStoreService();
await memoryStore.updateContent(filePath);

// NEW (testing Agent memory properties)
const agent = await Agent.create({ workdir: testDir });
expect(agent.projectMemory).toBe(expectedContent);
```

### Initialization Tests
```typescript
// Test memory loading during agent creation
const agent = await Agent.create({ workdir: testDir });

// Memory should be loaded immediately
expect(agent.projectMemory).toContain("expected memory content");
expect(agent.userMemory).toContain("expected user content");
```

## Performance Benefits

### Reduced Overhead
- No continuous file system watching for memory files
- Fewer background processes and event listeners
- Simpler dependency injection and initialization

### Faster Startup
- Direct memory loading without service layers
- Reduced complexity in agent initialization
- Fewer moving parts to coordinate

### Memory Efficiency  
- No duplicate memory storage (file cache + agent state)
- Single source of truth for memory content
- Simplified garbage collection (fewer object references)

## Common Issues & Solutions

### Memory Content Not Updating
**Issue**: Modified AGENTS.md but agent doesn't see changes
**Solution**: Restart agent or use `agent.saveMemory()` method

### Missing Memory Files
**Issue**: Agent fails to start with missing memory files
**Solution**: Files are optional - agent initializes with empty content and logs errors

### Configuration Watching Broken
**Issue**: Settings changes not being detected
**Solution**: Settings watching still works - only memory file watching was removed

### Tests Failing After Migration
**Issue**: Tests expect MemoryStoreService to exist
**Solution**: Update tests to use Agent memory properties instead

## Quick Reference

### New Agent Memory Properties
- `agent.projectMemory: string` - Project memory content (readonly)
- `agent.userMemory: string` - User memory content (readonly)  
- `agent.combinedMemory: string` - Combined content (readonly)

### Updated Methods
- `agent.saveMemory(message: string, type: "project" | "user"): Promise<void>`

### Removed Components
- `MemoryStoreService` class
- `MemoryStoreEntry` interface
- `ConfigurationWatcher` class (merged into LiveConfigManager)

### Unchanged APIs
- All other Agent class methods
- Memory utility functions (addMemory, readMemoryFile, etc.)
- LiveConfigManager public interface
- Settings file watching and live reload