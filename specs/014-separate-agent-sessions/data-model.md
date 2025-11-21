# Data Model: Separate Agent Sessions

**Status**: Implemented

## Entities

### MessageManager Configuration

The `MessageManager` configuration has been extended to support session prefixes.

```typescript
interface MessageManagerOptions {
  callbacks: MessageManagerCallbacks;
  workdir: string;
  logger?: Logger;
  sessionDir?: string;
  /**
   * Custom session filename prefix
   * @default "session"
   */
  sessionPrefix?: string;
}
```

### Session Service Signatures

The session service functions have been updated to support prefixes.

```typescript
/**
 * Generate session file path with custom prefix
 */
function getSessionFilePath(
  sessionId: string, 
  sessionDir?: string, 
  prefix?: string
): string

/**
 * Save session data with custom prefix
 */
function saveSession(
  sessionId: string,
  messages: Message[],
  workdir: string,
  latestTotalTokens: number = 0,
  startedAt?: string,
  sessionDir?: string,
  prefix?: string
): Promise<void>
```

### Session File Naming

| Entity Type | Prefix | Filename Pattern | Example |
|-------------|--------|------------------|---------|
| Agent | `session` | `session_{shortId}.json` | `session_a1b2c3d4.json` |
| Subagent | `subagent_session` | `subagent_session_{shortId}.json` | `subagent_session_a1b2c3d4.json` |

## Storage Schema

The internal JSON structure of the session file remains unchanged.

```json
{
  "id": "uuid",
  "timestamp": "iso-date",
  "version": "1.0.0",
  "messages": [...],
  "metadata": {
    "workdir": "/path/to/workdir",
    "startedAt": "iso-date",
    "lastActiveAt": "iso-date",
    "latestTotalTokens": 123
  }
}
```
