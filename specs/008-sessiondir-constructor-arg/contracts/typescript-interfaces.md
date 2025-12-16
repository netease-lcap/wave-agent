# TypeScript Contracts: SessionDir Constructor Argument

**Date**: 2025-11-11  
**Feature**: SessionDir Constructor Argument  
**Purpose**: Define TypeScript interfaces and function signatures for sessionDir functionality

## Interface Extensions

### AgentOptions Interface

```typescript
/**
 * Configuration options for Agent instances
 * 
 * IMPORTANT: This interface is used by both Agent constructor and Agent.create()
 * Any changes to this interface must be compatible with both methods.
 */
export interface AgentOptions {
  // New: Optional session directory configuration
  /** 
   * Optional custom directory for session file storage
   * @default join(homedir(), ".wave", "sessions")
   * @example "/path/to/custom/sessions"
   */
  sessionDir?: string;

  // Existing configuration (unchanged)
  apiKey?: string;
  baseURL?: string;
  agentModel?: string;
  fastModel?: string;
  tokenLimit?: number;
  callbacks?: AgentCallbacks;
  restoreSessionId?: string;
  continueLastSession?: boolean;
  logger?: Logger;
  messages?: Message[];
  workdir?: string;
  systemPrompt?: string;
}
```

### MessageManager Interface Extensions

```typescript
/**
 * Configuration options for MessageManager instances
 */
export interface MessageManagerOptions {
  callbacks: MessageManagerCallbacks;
  workdir: string;
  logger?: Logger;
  
  // New: Optional session directory override
  /** 
   * Custom session directory path
   * @default join(homedir(), ".wave", "sessions")
   */
  sessionDir?: string;
}
```

## Function Signature Updates

### Session Service Functions

All session service functions will be updated to accept optional sessionDir parameter:

```typescript
/**
 * Save session data to configurable directory
 */
export async function saveSession(
  sessionId: string,
  messages: Message[],
  workdir: string,
  latestTotalTokens: number = 0,
  startedAt?: string,
  sessionDir?: string // New optional parameter
): Promise<void>

/**
 * Load session data from configurable directory  
 */
export async function loadSession(
  sessionId: string,
  sessionDir?: string // New optional parameter
): Promise<SessionData | null>

/**
 * Get most recent session from configurable directory
 */
export async function getLatestSession(
  workdir: string,
  sessionDir?: string // New optional parameter  
): Promise<SessionData | null>

/**
 * List all sessions in configurable directory
 */
export async function listSessions(
  workdir: string,
  sessionDir?: string // New optional parameter
): Promise<SessionMetadata[]>

/**
 * Delete session from configurable directory
 */
export async function deleteSession(
  sessionId: string,
  sessionDir?: string // New optional parameter
): Promise<boolean>

/**
 * Clean up expired sessions in configurable directory
 */
export async function cleanupExpiredSessions(
  workdir: string,
  sessionDir?: string // New optional parameter
): Promise<number>

/**
 * Check if session exists in configurable directory
 */
export async function sessionExists(
  sessionId: string,
  sessionDir?: string // New optional parameter
): Promise<boolean>

/**
 * Generate session file path for configurable directory
 */
export function getSessionFilePath(
  sessionId: string,
  sessionDir?: string // New optional parameter
): string
```

### Internal Helper Functions

```typescript
/**
 * Resolve session directory path with fallback to default
 * @param sessionDir Optional custom session directory
 * @returns Resolved absolute path to session directory
 */
function resolveSessionDir(sessionDir?: string): string

/**
 * Ensure session directory exists (updated to accept custom path)
 * @param sessionDir Optional custom session directory  
 */
async function ensureSessionDir(sessionDir?: string): Promise<void>
```

## Error Handling Contracts

### New Error Types

```typescript
/**
 * Session directory configuration error
 */
export class SessionDirError extends Error {
  constructor(
    message: string,
    public readonly sessionDir: string,
    public readonly operation: string
  ) {
    super(message);
    this.name = 'SessionDirError';
  }
}
```

### Error Scenarios

Common error cases that should be handled:

- **Invalid Path**: sessionDir contains invalid characters or path structure
- **Permission Denied**: Cannot create or access the specified directory  
- **Disk Full**: Insufficient space to create session directory or files
- **Read-only Filesystem**: Cannot write to the specified location

All session directory errors are thrown as `SessionDirError` with descriptive messages.

## Usage Examples

### Basic Usage (Backward Compatible)

```typescript
// Existing usage - no changes required
const agent = await Agent.create({
  apiKey: 'key',
  baseURL: 'url'
});
// Sessions stored in default ~/.wave/sessions/
```

### Custom Session Directory

```typescript
// New usage - custom session directory
const agent = await Agent.create({
  apiKey: 'key', 
  baseURL: 'url',
  sessionDir: '/path/to/custom/sessions'
});
// Sessions stored in /path/to/custom/sessions/
```

### Dynamic Session Directory

```typescript
// Application-specific session isolation
const appSessionDir = path.join(process.cwd(), 'app-sessions');
const agent = await Agent.create({
  apiKey: 'key',
  baseURL: 'url', 
  sessionDir: appSessionDir
});
```

## Implementation Contract Requirements

1. **Backward Compatibility**: All existing Agent constructor calls must continue working without modification
2. **Default Behavior**: When sessionDir is not specified, behavior must be identical to current implementation  
3. **Parameter Threading**: sessionDir parameter must be passed through all session operation call chains
4. **Error Consistency**: Error messages and handling should be consistent between default and custom directories
5. **Path Resolution**: Relative paths in sessionDir should be resolved to absolute paths
6. **Directory Creation**: Custom sessionDir should be created automatically if it doesn't exist