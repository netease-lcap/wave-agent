# TypeScript Interface Contracts

**Date**: 2025-12-05  
**Branch**: `023-simplify-session-metadata`

## Core Type Definitions

### SessionFilename Interface
```typescript
/**
 * Parsed session filename components for metadata extraction
 */
interface SessionFilename {
  /** UUID session identifier */
  sessionId: string;
  /** Session type determined by filename prefix */
  sessionType: "main" | "subagent";
}
```

### Removed Interfaces
```typescript
// REMOVED: SessionMetadataLine interface - no longer needed without metadata headers
// interface SessionMetadataLine {
//   __meta__: true;
//   sessionId: string;
//   sessionType: "main" | "subagent";
//   workdir: string;
//   startedAt: string;
//   parentSessionId?: string;
//   subagentType?: string;
// }

// REMOVED: SessionMetadata interface - session listing uses inline objects
// interface SessionMetadata {
//   id: string;
//   sessionType: "main" | "subagent";
//   workdir: string;
//   lastActiveAt: Date;
//   latestTotalTokens: number;
// }
```

## Service Interface Contracts

### JsonlHandler Service Updates
```typescript
class JsonlHandler {
  /**
   * Create session file with simple filename (no metadata header)
   */
  createSession(
    sessionId: string,
    workdir: string,
    sessionType?: "main" | "subagent"
  ): Promise<string>; // Returns generated filename
  
  /**
   * Parse session metadata from filename
   */
  parseSessionFilename(filePath: string): SessionFilename;
  
  /**
   * Validate filename format
   */
  isValidSessionFilename(filename: string): boolean;
  
  /**
   * Generate simple filename for sessions
   */
  generateSessionFilename(
    sessionId: string,
    sessionType: "main" | "subagent"
  ): string;
  
  // Existing methods (unchanged)
  saveMessage(filePath: string, message: SessionMessage): Promise<void>;
  loadMessages(filePath: string): Promise<SessionMessage[]>;
  getLastMessage(filePath: string): Promise<SessionMessage | null>;
  
  // REMOVED: readMetadata function - no longer needed
  // REMOVED: hasMetadata function - no longer needed
}
```

### Session Service Updates  
```typescript
/**
 * Session listing with filename-based identification only
 * Returns inline objects instead of formal SessionMetadata interface
 */
function listSessionsFromJsonl(
  workdir: string,
  includeAllWorkdirs?: boolean,
  includeSubagentSessions?: boolean
): Promise<Array<{
  id: string;
  sessionType: "main" | "subagent";
  workdir: string;
  lastActiveAt: Date;
  latestTotalTokens: number;
}>>;

/**
 * Create new session with simple filename
 */
function createSession(
  sessionId: string,
  workdir: string,
  sessionType?: "main" | "subagent"
): Promise<void>;

/**
 * Generate filename for subagent sessions
 */
function generateSubagentFilename(sessionId: string): string;

// Existing functions (unchanged)
function generateSessionId(): string;
function loadSessionFromJsonl(sessionId: string, workdir: string): Promise<SessionData>;
function getLatestSessionFromJsonl(workdir: string): Promise<SessionData | null>;
```

## Filename Convention Contracts

### Filename Pattern Specifications
```typescript
/**
 * Simple filename format specifications
 */
const FilenameFormats = {
  /** Main session: {sessionId}.jsonl */
  MAIN_SESSION: /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.jsonl$/,
  
  /** Subagent session: subagent-{sessionId}.jsonl */
  SUBAGENT_SESSION: /^subagent-([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.jsonl$/
} as const;
```

### Validation Contracts
```typescript
/**
 * Filename validation interface
 */
interface FilenameValidator {
  /**
   * Validate session filename format
   */
  validateSessionFilename(filename: string): {
    isValid: boolean;
    sessionId?: string;
    sessionType?: "main" | "subagent";
    error?: string;
  };
  
  /**
   * Validate session ID format (UUID)
   */
  validateSessionId(sessionId: string): boolean;
}
```

## Error Handling Contracts

### Session Error Types
```typescript
/**
 * Session-specific error types
 */
class SessionFilenameError extends Error {
  constructor(
    public filename: string,
    public reason: "invalid_format" | "invalid_uuid"
  ) {
    super(`Invalid session filename: ${filename} (${reason})`);
  }
}

class SessionFormatError extends Error {
  constructor(
    public filePath: string,
    public reason: string
  ) {
    super(`Session format error for ${filePath}: ${reason}`);
  }
}
```