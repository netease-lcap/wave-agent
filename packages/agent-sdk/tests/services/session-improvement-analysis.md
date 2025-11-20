# Session Service Mixed Prefix Analysis and Recommendations

## Current Implementation Analysis

The current `listSessions` function in `/packages/agent-sdk/src/services/session.ts` has the following signature:
```typescript
export async function listSessions(
  workdir: string,
  includeAllWorkdirs = false,
  sessionDir?: string,
  prefix?: string,
): Promise<SessionMetadata[]>
```

### Current Behavior
- Filters files by a single prefix: `file.startsWith(`${filePrefix}_`)`
- Defaults to "session" prefix if none provided
- Cannot list multiple session types (e.g., both `session_*` and `subagent_session_*`) in a single call

## Issues Identified

### 1. **Limited Debugging Capabilities**
- Users cannot easily view all session files in a directory
- Debugging tools must make multiple API calls to get complete picture
- No way to see the full session ecosystem at once

### 2. **API Limitation for Mixed Environments**  
- Research document mentions need to filter by: `file.startsWith("session_") || file.startsWith("subagent_session_")`
- Current API requires separate calls for each prefix type
- Results must be manually combined and sorted

### 3. **Scalability Concerns**
- As more agent types are added (workflow agents, specialized agents, etc.), more prefix types will emerge
- Current approach doesn't scale well for multi-agent environments

## Recommended Solutions

### Option 1: Add Multi-Prefix Support (Recommended)

Add an overloaded version of `listSessions` that accepts multiple prefixes:

```typescript
export async function listSessions(
  workdir: string,
  includeAllWorkdirs?: boolean,
  sessionDir?: string,
  prefix?: string,
): Promise<SessionMetadata[]>;

export async function listSessions(
  workdir: string,
  includeAllWorkdirs?: boolean,
  sessionDir?: string,
  prefixes?: string[],
): Promise<SessionMetadata[]>;
```

**Implementation approach:**
```typescript
export async function listSessions(
  workdir: string,
  includeAllWorkdirs = false,
  sessionDir?: string,
  prefixOrPrefixes?: string | string[],
): Promise<SessionMetadata[]> {
  // ... existing setup code ...
  
  const prefixes = Array.isArray(prefixOrPrefixes) 
    ? prefixOrPrefixes 
    : [prefixOrPrefixes || "session"];

  for (const file of files) {
    const matchesPrefix = prefixes.some(prefix => 
      file.startsWith(`${prefix}_`) && file.endsWith(".json")
    );
    
    if (!matchesPrefix) {
      continue;
    }
    
    // ... rest of processing ...
  }
}
```

### Option 2: Add Dedicated Multi-Session Function

Create a new function specifically for listing all session types:

```typescript
export async function listAllSessionTypes(
  workdir: string,
  includeAllWorkdirs = false,
  sessionDir?: string,
  additionalPrefixes?: string[],
): Promise<SessionMetadata[]> {
  const standardPrefixes = ["session", "subagent_session"];
  const allPrefixes = [...standardPrefixes, ...(additionalPrefixes || [])];
  
  return listSessions(workdir, includeAllWorkdirs, sessionDir, allPrefixes);
}
```

### Option 3: Add Wildcard/Pattern Support

Add pattern matching support:

```typescript
export async function listSessions(
  workdir: string,
  includeAllWorkdirs = false,
  sessionDir?: string,
  pattern?: string | RegExp,
): Promise<SessionMetadata[]>
```

**Usage examples:**
```typescript
// List all session files
await listSessions(workdir, false, undefined, /.*_session_.*\.json$/);

// List standard session types
await listSessions(workdir, false, undefined, /(session|subagent_session)_.*\.json$/);
```

## Impact Assessment

### Benefits of Multi-Prefix Support
1. **Better Debugging Experience**: Single call to get all session files
2. **Reduced API Calls**: More efficient for tools that need complete view
3. **Future-Proof**: Easily extensible for new agent types
4. **Backward Compatible**: Existing code continues to work unchanged

### Minimal Changes Required
- The core filtering logic needs minor modification
- Type signatures need careful handling for overloads
- Tests need expansion (already added in this PR)

## Test Coverage Added

The new tests cover:
1. ✅ **Mixed session files scenario**: Both `session_*` and `subagent_session_*` in same directory
2. ✅ **Specific prefix filtering**: Verifies current behavior works correctly
3. ✅ **Debugging scenarios**: Manual combination of results from multiple prefix calls
4. ✅ **Edge cases**: Empty directories, no matching files, corrupted files
5. ✅ **Workdir filtering consistency**: Across different session types
6. ✅ **Prefix variations**: Edge cases like `session_.json`, `session.json`

## Recommendation

**Implement Option 1 (Multi-Prefix Support)** because:
- It's backward compatible
- Addresses the immediate need described in the research document
- Provides a clean API for future extensibility
- Minimal implementation complexity
- Comprehensive test coverage already exists

This approach will enable the filtering mentioned in the research document:
```typescript
// Current limitation - requires two calls:
const sessionFiles = await listSessions(workdir, false, undefined, "session");
const subagentFiles = await listSessions(workdir, false, undefined, "subagent_session");
const allFiles = [...sessionFiles, ...subagentFiles].sort(/* by lastActiveAt */);

// Proposed improvement - single call:
const allFiles = await listSessions(workdir, false, undefined, ["session", "subagent_session"]);
```

## Next Steps

1. Implement the multi-prefix overload in `session.ts`
2. Add tests for the new API (test framework already in place)
3. Update documentation to reflect new capabilities
4. Consider adding helper constants for common prefix combinations:
   ```typescript
   export const STANDARD_SESSION_PREFIXES = ["session", "subagent_session"] as const;
   ```