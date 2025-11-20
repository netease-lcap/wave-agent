# Research: Separate Agent Sessions

## Decisions

### 1. Session Filename Prefix Configuration
**Decision**: Modify `MessageManager` to accept an optional `sessionPrefix` configuration, defaulting to `"session"`.
**Rationale**: This allows flexible configuration of the session filename prefix without changing the core session ID generation logic. It satisfies FR-001, FR-002, and FR-004.

### 2. Subagent Session Prefix
**Decision**: `SubagentManager` will initialize its subagent `MessageManager` instances with `sessionPrefix: "subagent_session"`.
**Rationale**: This explicitly distinguishes subagent sessions from main agent sessions, satisfying FR-003 and FR-007.

### 3. Session Service Update
**Decision**: Update `getSessionFilePath` and `saveSession` in `packages/agent-sdk/src/services/session.ts` to accept an optional `prefix` parameter.
**Rationale**: This is the low-level implementation required to support variable filename prefixes (FR-005). The default will remain `"session"` to preserve backward compatibility.

### 4. Session ID Handling
**Decision**: The `sessionId` itself will remain a UUID. The prefix is only used for the filename.
**Rationale**: Changing the internal `sessionId` format might have side effects in other parts of the system (e.g., memory, logs). Keeping it as a UUID and only changing the storage filename is safer and cleaner.

## Alternatives Considered

### A. Encoding Prefix in Session ID
**Idea**: Generate session IDs like `subagent_session_UUID`.
**Rejected**: This mixes identity with storage concerns. It would require parsing the ID to extract the UUID part if needed, and might break existing logic that expects UUID format.

### B. Separate Directory for Subagents
**Idea**: Store subagent sessions in a `subagents/` subdirectory.
**Rejected**: The requirement specifically asked for different *filenames* (`subagent_session_...`). Keeping them in the same directory (flat structure) but with different prefixes is simpler for listing and management, as requested in the spec.

## Implementation Details

### `packages/agent-sdk/src/services/session.ts`

Current:
```typescript
export function getSessionFilePath(sessionId: string, sessionDir?: string): string {
  const shortId = sessionId.split("_")[2] || sessionId.slice(-8);
  const resolvedDir = resolveSessionDir(sessionDir);
  return join(resolvedDir, `session_${shortId}.json`);
}
```

Proposed:
```typescript
export function getSessionFilePath(sessionId: string, sessionDir?: string, prefix: string = "session"): string {
  const shortId = sessionId.split("_")[2] || sessionId.slice(-8);
  const resolvedDir = resolveSessionDir(sessionDir);
  return join(resolvedDir, `${prefix}_${shortId}.json`);
}
```

### `packages/agent-sdk/src/managers/messageManager.ts`

Add `sessionPrefix` to `MessageManagerOptions` and class properties. Pass it to `saveSession` and `getSessionFilePath`.

### `packages/agent-sdk/src/managers/subagentManager.ts`

Pass `sessionPrefix: "subagent_session"` when creating `MessageManager`.

### 5. Session Loading and Listing
**Decision**: 
- Update `listSessions` to accept files starting with `subagent_session_` in addition to `session_`.
- Update `loadSession` to attempt loading with the default prefix first. If not found, it should try the `subagent_session` prefix (or scan for the ID).
- **Refined Approach**: `loadSession` will accept an optional `prefix`. If not provided, it defaults to "session". If that fails, it could optionally try "subagent_session" or fail.
- However, for robustness, `loadSession` could check for file existence with "session" prefix, then "subagent_session" prefix.
- `listSessions` currently filters by `startsWith("session_")`. This MUST be updated to allow `subagent_session_` (which also contains "session_", but `startsWith` is strict).
- Actually `subagent_session_` does NOT start with `session_`.
- So `listSessions` filter needs to be: `file.startsWith("session_") || file.startsWith("subagent_session_")`.

**Rationale**: Ensures FR-006 is met.

