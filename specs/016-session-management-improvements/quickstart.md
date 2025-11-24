# Quickstart: Session Management Improvements

**Date**: 2025-11-24  
**Status**: Implementation Ready  

## Overview

This guide provides a quick start for implementing the new session management system in Wave Agent. The improvements introduce project-based session organization, JSONL format for better performance, and UUIDv6 identifiers for time-ordered operations.

## Key Changes Summary

### Before (Current)
```
~/.wave/sessions/
├── session_abc123.json
├── session_def456.json
└── session_ghi789.json
```

### After (Improved)
```
~/.wave/projects/
├── -home-user-project-a/
│   ├── 01234567-89ab-6cde-f012-3456789abcde.jsonl
│   └── 01234567-89ab-6cde-f012-3456789abcdf.jsonl
└── -home-user-project-b/
    └── 01234567-89ab-6cde-f012-3456789abce0.jsonl
```

**Critical Implementation Detail**: 
- ✅ **DO**: Call `appendMessage()` immediately when each message is created
- ❌ **DON'T**: Collect messages in memory and batch save them  
- ❌ **DON'T**: Rewrite entire JSONL files

## Implementation Checklist

### Phase 1: Core Infrastructure

- [ ] **Install Dependencies**
  ```bash
  cd packages/agent-sdk
  pnpm add uuid@latest
  ```

- [ ] **Create Path Encoder Utility**
  - File: `packages/agent-sdk/src/utils/pathEncoder.ts`
  - Implements cross-platform directory name encoding
  - Handles symbolic link resolution and collision detection

- [ ] **Create JSONL Handler Service**
  - File: `packages/agent-sdk/src/services/jsonlHandler.ts`
  - Handles JSONL read/write operations
  - Supports streaming and validation

- [ ] **Update Session Service**
  - File: `packages/agent-sdk/src/services/session.ts`
  - Replace JSON with JSONL format
  - Update directory structure to project-based
  - Implement UUIDv6 session identifiers

### Phase 2: Integration Updates

- [ ] **Update Message Manager**
  - File: `packages/agent-sdk/src/managers/messageManager.ts`
  - Change `addMessage()` to immediately append to JSONL
  - Remove batch `saveSession()` calls
  - Implement real-time message persistence

- [ ] **Update AI Manager**
  - File: `packages/agent-sdk/src/managers/aiManager.ts`
  - Remove `saveSession()` calls from finally blocks
  - Messages are now saved automatically when added
  - Focus on message creation, not persistence

- [ ] **Update Constants**
  - File: `packages/agent-sdk/src/utils/constants.ts`
  - Change default session directory to `~/.wave/projects`

### Phase 3: Type Definitions

- [ ] **Update Session Interfaces**
  - File: `packages/agent-sdk/src/types/index.ts`
  - Add new session-related interfaces
  - Update existing `Message` interface if needed

### Phase 4: Testing

- [ ] **Unit Tests**
  - Path encoder tests: `packages/agent-sdk/tests/utils/pathEncoder.test.ts`
  - JSONL handler tests: `packages/agent-sdk/tests/services/jsonlHandler.test.ts`
  - Session service tests: Update `packages/agent-sdk/tests/services/session.test.ts`

- [ ] **Integration Tests**
  - End-to-end session workflows
  - Message persistence during AI recursion
  - Cross-platform directory encoding

## Quick Implementation Guide

### 1. Path Encoding Example

```typescript
// packages/agent-sdk/src/utils/pathEncoder.ts
import { resolve, sep } from 'path';
import { createHash } from 'crypto';
import { realpath } from 'fs/promises';

export class PathEncoder {
  async encode(originalPath: string): Promise<string> {
    // Resolve symbolic links
    const resolvedPath = await realpath(originalPath);
    
    // Convert to safe directory name
    const encoded = resolvedPath
      .replace(/^\\//g, '') // Remove leading slash
      .replace(/\\//g, '-')  // Path separators to hyphens
      .replace(/\\s+/g, '_') // Spaces to underscores
      .replace(/[<>:\"|?*]/g, '_') // Invalid chars to underscores
      .toLowerCase();
    
    // Handle length limit with hash
    if (encoded.length > 200) {
      const hash = createHash('sha256').update(resolvedPath).digest('hex').substring(0, 8);
      return `${encoded.substring(0, 190)}-${hash}`;
    }
    
    return encoded;
  }
}
```

### 2. JSONL Handler Example

```typescript
// packages/agent-sdk/src/services/jsonlHandler.ts
import { appendFile, readFile } from 'fs/promises';
import type { SessionMessage } from '../types/index.js';

export class JsonlHandler {
  // Primary method: append single message immediately
  async appendMessage(filePath: string, message: SessionMessage): Promise<void> {
    const line = JSON.stringify(message) + '\n';
    await appendFile(filePath, line, 'utf8');
  }
  
  // Batch method: append multiple messages (for initial setup)
  async appendMessages(filePath: string, messages: SessionMessage[]): Promise<void> {
    const lines = messages.map(msg => JSON.stringify(msg)).join('\n') + '\n';
    await appendFile(filePath, lines, 'utf8');
  }
  
  async read(filePath: string): Promise<SessionMessage[]> {
    const content = await readFile(filePath, 'utf8');
    return content
      .split('\n')
      .filter(line => line.trim())
      .map(line => JSON.parse(line) as SessionMessage);
  }
}
```

### 3. Updated Session Service Structure

```typescript
// packages/agent-sdk/src/services/session.ts - Key changes
import { v6 as uuidv6 } from 'uuid';
import { join } from 'path';
import { homedir } from 'os';
import { PathEncoder } from '../utils/pathEncoder.js';
import { JsonlHandler } from './jsonlHandler.js';

const SESSION_DIR = join(homedir(), \".wave\", \"projects\"); // Changed from \"sessions\"

// IMPORTANT: Changed from saveSession() that writes entire message array
// to appendNewMessages() that writes only new messages at end of each recursion

export async function appendNewMessages(
  sessionId: string,
  newMessages: SessionMessage[],
  workdir: string,
  sessionDir?: string,
): Promise<void> {
  if (newMessages.length === 0) return;
  
  const encoder = new PathEncoder();
  const jsonlHandler = new JsonlHandler();
  
  const encodedWorkdir = await encoder.encode(workdir);
  const projectDir = join(resolveSessionDir(sessionDir), encodedWorkdir);
  const filePath = join(projectDir, `${sessionId}.jsonl`);
  
  // Add timestamps to new messages
  const messagesWithTimestamp = newMessages.map(msg => ({
    ...msg,
    timestamp: msg.timestamp || new Date().toISOString()
  }));
  
  // Append only new messages to JSONL file
  await jsonlHandler.appendNewMessages(filePath, messagesWithTimestamp);
}

export function generateSessionId(): string {
  return uuidv6(); // UUIDv6 for time ordering
}
```

### 4. AI Manager Integration (Correct Pattern)

```typescript
// packages/agent-sdk/src/managers/aiManager.ts - Key changes
export class AIManager {
  
  public async sendAIMessage(
    message: string,
    options: SendAIMessageOptions = {},
  ): Promise<Message> {
    try {
      // Add user message to in-memory array
      const userMessage = { role: 'user', blocks: [...] };
      this.messageManager.addMessage(userMessage);
      
      // Process AI response and tools
      const assistantMessage = await this.processAIResponse(...);
      this.messageManager.addMessage(assistantMessage);
      
      // Messages can be updated during tool execution
      // They stay in memory until finally block
      
      return assistantMessage;
    } catch (error) {
      this.logger?.error('AI message failed:', error);
      throw error;
    } finally {
      // CRITICAL: Save new messages at end of each recursion
      await this.messageManager.saveNewMessages();
    }
  }
}
```

```typescript
// packages/agent-sdk/src/managers/messageManager.ts - Key changes
import { generateSessionId } from '../services/session.js';

export class MessageManager {
  private sessionId: string;
  
  constructor(options: MessageManagerOptions) {
    // Use UUIDv6 instead of timestamp-based ID
    this.sessionId = generateSessionId();
  }
  
  public async saveSession(): Promise<void> {
    try {
      // Convert messages to SessionMessage format with timestamps
      const messageLines = this.messages.map(msg => ({
        ...msg,
        timestamp: new Date().toISOString()
      }));
      
      await saveSession(
        this.sessionId,
        messageLines,
        this.workdir,
        this.latestTotalTokens,
        this.sessionStartTime,
        this.sessionDir,
      );
    } catch (error) {
      this.logger?.error(\"Failed to save session:\", error);
    }
  }
}
```

## Migration Strategy

### For Developers
1. **No Data Migration Required**: Clean break approach - existing sessions remain in `~/.wave/sessions`
2. **New Sessions Only**: All new sessions use the improved system
3. **Backward Compatibility**: Old session loading still works for existing sessions

### For Users
1. **Immediate Benefits**: Better organization and performance for new sessions
2. **No Data Loss**: Existing sessions remain accessible (manual export if needed)
3. **Transparent Transition**: No user action required

## Performance Expectations

### Current vs Improved
| Operation | Current (JSON) | Improved (JSONL) | Speedup |
|-----------|----------------|------------------|----------|
| Session Creation | ~15ms | ~5ms | 3x faster |
| Message Append | ~50ms (full rewrite) | ~2ms (append new only) | 25x faster |
| Session Listing | O(n) file reads | O(n log n) sort | 2-5x faster |
| AI Recursion Save | ~50ms (full rewrite) | ~5ms (append new) | 10x faster |

### Memory Usage
| Scenario | Current | Improved | Reduction |
|----------|---------|----------|-----------|
| Large Session Loading | 50MB (full load) | 5MB (streaming) | 10x less |
| Message Append | 50MB (rewrite) | 1KB (append) | 50,000x less |

## Testing Checklist

### Unit Tests (TDD Approach)
- [ ] Path encoder handles special characters
- [ ] Path encoder respects length limits
- [ ] Path encoder resolves symbolic links
- [ ] JSONL handler appends messages correctly
- [ ] JSONL handler reads messages in order
- [ ] Session service creates project directories
- [ ] Session service generates valid UUIDv6
- [ ] UUIDv6 sorting matches chronological order

### Integration Tests
- [ ] End-to-end session creation and loading
- [ ] Message persistence during AI tool recursion
- [ ] Cross-platform directory encoding
- [ ] Performance benchmarks vs current implementation
- [ ] Error handling and recovery

### Manual Testing
- [ ] Create sessions in different working directories
- [ ] Verify project-based organization
- [ ] Test with long paths and special characters
- [ ] Verify JSONL files are human-readable
- [ ] Confirm chronological sorting by filename

## Next Steps

1. **Start with Unit Tests**: Follow TDD approach
2. **Implement Core Utilities**: PathEncoder and JsonlHandler
3. **Update Session Service**: Core session management logic
4. **Integration Testing**: End-to-end workflows
5. **Performance Validation**: Benchmark improvements
6. **Documentation**: Update API documentation

## Support

- **Research Documentation**: See `research.md` for detailed technical decisions
- **Data Model**: See `data-model.md` for entity relationships
- **API Contracts**: See `contracts/` directory for interface definitions
- **Error Handling**: Standard TypeScript error handling with proper error propagation

This quickstart provides everything needed to implement the session management improvements while maintaining compatibility with existing Wave Agent functionality.