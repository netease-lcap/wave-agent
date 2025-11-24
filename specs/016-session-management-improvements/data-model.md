# Data Model: Session Management Improvements

**Date**: 2025-11-24  
**Status**: Design Phase  

## Overview

This document defines the data entities and their relationships for the improved session management system. The new model emphasizes JSONL format, UUIDv6 identifiers, and project-based organization.

## Core Entities

### 1. Session Directory

The base directory structure that organizes all project-based sessions.

**Entity**: `SessionDirectory`

**Fields**:
- **basePath**: `string` - Base path `~/.wave/projects`
- **exists**: `boolean` - Whether directory exists on filesystem
- **permissions**: `'read' | 'write' | 'readwrite' | 'none'` - Access permissions

**Relationships**:
- Contains multiple `ProjectDirectory` entities
- Managed by session service configuration

**Validation Rules**:
- Base path must be absolute and accessible
- Directory must be writable for session creation
- Auto-created if missing with proper permissions

---

### 2. Project Directory

Encoded subdirectory representing a specific working directory for session isolation.

**Entity**: `ProjectDirectory`

**Fields**:
- **originalPath**: `string` - Original working directory path (e.g., `/home/user/project-a`)
- **encodedName**: `string` - Filesystem-safe directory name (e.g., `-home-user-project-a`)
- **encodedPath**: `string` - Full path to encoded directory (e.g., `~/.wave/projects/-home-user-project-a`)
- **pathHash**: `string?` - SHA-256 hash for collision resolution (when needed)
- **isSymbolicLink**: `boolean` - Whether original path was a symbolic link

**Relationships**:
- Belongs to one `SessionDirectory`
- Contains multiple `SessionFile` entities
- Maps to one unique working directory

**Validation Rules**:
- `originalPath` must be absolute and resolved (no symbolic links)
- `encodedName` must be filesystem-safe (alphanumeric, hyphens, underscores only)
- `encodedName` maximum length: 200 characters
- `pathHash` required when `encodedName` would exceed length limit or cause collision

**State Transitions**:
- Creation: `originalPath` → resolve symlinks → encode → validate → create directory
- Lookup: `encodedName` → find existing directory → map back to `originalPath`

---

### 3. Session File

Individual JSONL files containing message data for a specific conversation session.

**Entity**: `SessionFile`

**Fields**:
- **sessionId**: `string` - UUIDv6 identifier (also used as filename without extension)
- **filePath**: `string` - Full path to JSONL file (e.g., `/home/user/.wave/projects/-home-user-project-a/01234567-89ab-6cde-f012-3456789abcde.jsonl`)
- **workdir**: `string` - Original working directory (derived from parent `ProjectDirectory`)
- **messageCount**: `number` - Total number of messages in session
- **fileSize**: `number` - File size in bytes
- **createdAt**: `Date` - Session creation timestamp (derived from UUIDv6)
- **lastModified**: `Date` - File last modification timestamp

**Relationships**:
- Belongs to one `ProjectDirectory`
- Contains multiple `SessionMessage` entities
- Identified by UUIDv6 for time-ordering

**Validation Rules**:
- `sessionId` must be valid UUIDv6 format
- `filePath` must end with `.jsonl` extension
- `sessionId` must match filename (without extension)
- File must exist and be readable
- `messageCount` must be non-negative

**State Transitions**:
- Creation: Generate UUIDv6 → create empty JSONL file → add initial messages
- Loading: Read JSONL line-by-line → parse each message → construct session
- Updating: Append new messages as JSONL lines → update metadata
- Deletion: Remove file → cleanup empty project directories

---

### 4. Message Line

Individual lines in JSONL files representing discrete messages with timestamps.

**Entity**: `SessionMessage` (extends existing `Message` interface)

**Fields**:
- **role**: `'user' | 'assistant'` - Message role in conversation (from Message interface)
- **blocks**: `MessageBlock[]` - Array of content blocks (from Message interface)
- **timestamp**: `string` - ISO 8601 timestamp when message was created (added for JSONL format)
- **usage**: `Usage?` - Usage data for AI operations (from Message interface, assistant messages only)
- **metadata**: `Record<string, unknown>?` - Additional metadata from AI responses (from Message interface)

**Relationships**:
- Belongs to one `SessionFile`
- Represents one line in JSONL format
- Extends existing `Message` interface with timestamp for JSONL storage

**Validation Rules**:
- `role` must be valid enumerated value
- `blocks` must contain at least one block for user messages
- `timestamp` must be valid ISO 8601 format
- `blocks` must be valid array (can be empty)
- Each line must be valid JSON

**JSONL Format**:
```json
{"role":"user","blocks":[{"type":"text","content":"Hello"}],"timestamp":"2024-11-24T06:23:16.633Z"}
{"role":"assistant","blocks":[{"type":"text","content":"Hi there"}],"timestamp":"2024-11-24T06:23:17.145Z","usage":{"inputTokens":5,"outputTokens":3}}
```

---

### 5. Session Metadata

Derived metadata about sessions used for listing and management operations.

**Entity**: `SessionMetadata`

**Fields**:
- **id**: `string` - UUIDv6 session identifier
- **workdir**: `string` - Original working directory path
- **startedAt**: `Date` - Session start time (derived from UUIDv6)
- **lastActiveAt**: `Date` - Last message timestamp (from file modification time)
- **messageCount**: `number` - Total number of messages
- **fileSize**: `number` - JSONL file size in bytes

**Relationships**:
- Derived from `SessionFile` and `SessionMessage` entities
- Used for session listing and filtering operations
- Maps to session performance metrics

**Validation Rules**:
- `id` must be valid UUIDv6
- `startedAt` must be <= `lastActiveAt`
- `messageCount` must be >= 0
- `fileSize` must be >= 0

---

## Entity Relationships Diagram

```
SessionDirectory (1)
    └── ProjectDirectory (N)
        ├── originalPath: /home/user/project-a
        ├── encodedName: -home-user-project-a
        └── SessionFile (N)
            ├── sessionId: UUIDv6
            ├── filePath: .../project-a/uuid.jsonl
            └── SessionMessage (N)
                ├── role: user|assistant
                ├── blocks: MessageBlock[]
                ├── timestamp: ISO8601
                ├── usage?: Usage
                └── metadata?: Record<string, unknown>
```

**Notes**:
- Path encoding/decoding is handled algorithmically, no persistent mapping needed
- Session discovery uses filesystem scanning of `~/.wave/projects/` directory
- Original working directory paths are derived from encoded folder names on-demand

## Migration Considerations

### From Current JSON Format

**Current Structure**:
```typescript
interface SessionData {
  id: string;
  version: string;
  messages: Message[];
  metadata: {
    workdir: string;
    startedAt: string;
    lastActiveAt: string;
    latestTotalTokens: number;
  };
}
```

**Migration Strategy**:
1. **Clean Break**: No automatic conversion (performance benefits justify)
2. **New Structure**: Each message becomes a JSONL line with timestamp
3. **Metadata Elimination**: Remove session-level metadata, derive from UUIDv6 and file system
4. **Token Tracking**: Move token usage to separate tracking system if needed

### Backward Compatibility

**Design Decision**: No backward compatibility for session data
- **Rationale**: Performance improvements and architectural benefits outweigh compatibility costs
- **User Impact**: Previous sessions remain accessible in `~/.wave/sessions` but not integrated
- **Alternative**: Manual export tool could be created if needed

## Performance Characteristics

### Time Complexity
- **Session Creation**: O(1) - Direct file creation with UUIDv6
- **Message Append**: O(1) - JSONL line append operation
- **Session Listing**: O(n log n) - Directory scan + UUIDv6 sort
- **Latest Session**: O(n) - Directory scan, no file I/O needed
- **Session Loading**: O(m) - Stream processing, where m = message count

### Space Complexity
- **Memory Usage**: O(1) for streaming operations, O(m) for full session loading
- **Disk Usage**: Linear with message count, no duplication overhead
- **Directory Structure**: O(p) where p = number of unique project directories

This data model provides the foundation for a performant, scalable session management system that maintains compatibility with existing Wave agent message structures while enabling significant performance improvements through JSONL format and UUIDv6 organization.