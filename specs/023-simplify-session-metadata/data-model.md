# Data Model: Simplify Session Metadata Storage

**Date**: 2025-12-05  
**Branch**: `023-simplify-session-metadata`

## Core Entities

### SessionFilename
Represents the simple filename structure that encodes minimal session metadata.

**Fields**:
- `sessionId: string` - UUID identifier for the session
- `sessionType: "main" | "subagent"` - Session type determined by filename prefix presence

**Format Pattern**: 
- Main sessions: `{sessionId}.jsonl`
- Subagent sessions: `subagent-{sessionId}.jsonl`

**Validation Rules**:
- sessionId must be valid UUID format
- sessionType determined by presence/absence of "subagent-" prefix

### SessionMessage (Existing - No Changes)
Represents individual messages stored in session files.

**Fields**:
- `timestamp: string` - ISO 8601 timestamp
- `role: "user" | "assistant"` - Message sender role
- `blocks: MessageBlock[]` - Message content blocks
- `usage?: TokenUsage` - Optional token usage information
- `metadata?: Record<string, unknown>` - Optional metadata

**Storage**: JSONL format, one message per line, no metadata header

**Removed Interfaces**:
- ~~`SessionMetadataLine`~~ - Completely removed, no longer needed without metadata headers
- ~~`SessionMetadata`~~ - Completely removed, session listing uses inline objects instead

## State Transitions

### Session Creation Flow

```
1. Generate sessionId (UUID)
2. Create simple filename:
   - Main: {sessionId}.jsonl
   - Subagent: subagent-{sessionId}.jsonl
3. Create file without metadata header
4. Append first message directly to file
```

### Session Listing Flow

```
1. Read directory contents
2. Filter .jsonl files
3. Parse filename to extract metadata:
   - sessionId from filename (remove .jsonl and subagent- prefix if present)
   - sessionType from prefix presence (subagent- prefix = "subagent", no prefix = "main")
4. Read last message for lastActiveAt and tokens
5. Return inline objects with session data (no formal interface needed)
```

## Filename Parsing Logic

### Simple Filename Structure

```typescript
interface ParsedFilename {
  sessionId: string;
  sessionType: "main" | "subagent";  
}

// Parsing logic:
// "subagent-{uuid}.jsonl" -> sessionType: "subagent", sessionId: uuid  
// "{uuid}.jsonl" -> sessionType: "main", sessionId: uuid
```

### Validation Rules

**Filename Validation**:
- Must end with .jsonl extension
- SessionId must be valid UUID format  
- Subagent sessions must start with "subagent-" prefix
- Main sessions must NOT start with "subagent-" prefix

## Storage Optimization

### File Content Structure

**Session Files**:
```jsonl
{"timestamp":"2025-12-05T10:30:00Z","role":"user","blocks":[...]}
{"timestamp":"2025-12-05T10:31:00Z","role":"assistant","blocks":[...]}
```

### Directory Structure (Unchanged)
```
~/.wave/projects/
├── {workdir-hash}/
│   ├── {sessionId}.jsonl
│   └── subagent-{sessionId}.jsonl
```

## Backward Compatibility

### File Format Compatibility
- New format files: No metadata header, direct message content, enhanced filename
- Legacy format files: Continue to work unchanged with existing readMetadata approach
- No migration: Mixed environments operate seamlessly with dual handling

### API Compatibility  
- Session restoration by sessionId: Works with both formats
- Session listing: Returns unified SessionMetadata regardless of file format
- Message operations: Unaffected by header presence/absence
- No breaking changes: All existing functionality preserved

## Performance Characteristics

### Session Listing Performance
- **New format files**: 1 file I/O operation per session (last message only)
- **Legacy format files**: 2 file I/O operations per session (metadata + last message)
- **Mixed environments**: Average performance between formats based on ratio

### Memory Usage
- Reduced metadata storage in files (removes ~100-200 bytes per session)
- Filename parsing requires minimal memory allocation
- No additional caching structures needed