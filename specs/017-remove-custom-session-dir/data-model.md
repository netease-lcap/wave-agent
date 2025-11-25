# Data Model: Remove Custom Session Dir Feature

**Date**: 2025-11-25  
**Feature**: Remove Custom Session Dir Feature  
**Phase**: 1 - Design & Contracts

## Overview

This feature removal impacts several TypeScript interfaces and data structures by eliminating sessionDir configuration throughout the system. The data model changes focus on simplifying interfaces and removing optional parameters.

## Modified Interfaces

### AgentOptions (packages/agent-sdk/src/agent.ts)

**Before Removal:**
```typescript
export interface AgentOptions {
  apiKey?: string;
  baseURL?: string;
  // ... other options ...
  sessionDir?: string;  // ← TO BE REMOVED
  callbacks?: AgentCallbacks;
  // ... other options ...
}
```

**After Removal:**
```typescript  
export interface AgentOptions {
  apiKey?: string;
  baseURL?: string;
  // ... other options ...
  // sessionDir parameter completely removed
  callbacks?: AgentCallbacks;
  // ... other options ...
}
```

**Change Impact**: Breaking change for users who explicitly pass sessionDir. TypeScript will flag this as a compilation error.

### MessageManagerOptions (packages/agent-sdk/src/managers/messageManager.ts)

**Before Removal:**
```typescript
export interface MessageManagerOptions {
  callbacks: MessageManagerCallbacks;
  workdir: string;
  logger?: Logger;
  sessionDir?: string;  // ← TO BE REMOVED
  isSubagent?: boolean;
}
```

**After Removal:**
```typescript
export interface MessageManagerOptions {
  callbacks: MessageManagerCallbacks;
  workdir: string;  
  logger?: Logger;
  // sessionDir parameter completely removed
  isSubagent?: boolean;
}
```

**Change Impact**: Internal API change - no external impact as MessageManager is not directly instantiated by end users.

## Modified Function Signatures

### Session Service Functions (packages/agent-sdk/src/services/session.ts)

**Functions with sessionDir parameter to be simplified:**

1. **appendMessages**
   ```typescript
   // Before
   export async function appendMessages(
     sessionId: string,
     newMessages: Message[],
     workdir: string,
     sessionDir?: string,  // ← TO BE REMOVED
     isSubagent?: boolean,
   ): Promise<void>
   
   // After  
   export async function appendMessages(
     sessionId: string,
     newMessages: Message[],
     workdir: string,
     isSubagent?: boolean,
   ): Promise<void>
   ```

2. **loadSessionFromJsonl**
   ```typescript
   // Before
   export async function loadSessionFromJsonl(
     sessionId: string,
     workdir: string,
     sessionDir?: string,  // ← TO BE REMOVED
     isSubagent?: boolean,
   ): Promise<SessionData | null>
   
   // After
   export async function loadSessionFromJsonl(
     sessionId: string,
     workdir: string,
     isSubagent?: boolean,
   ): Promise<SessionData | null>
   ```

3. **getSessionFilePath**
   ```typescript
   // Before
   export async function getSessionFilePath(
     sessionId: string,
     workdir: string,
     sessionDir?: string,  // ← TO BE REMOVED
     isSubagent?: boolean,
   ): Promise<string>
   
   // After
   export async function getSessionFilePath(
     sessionId: string,
     workdir: string,
     isSubagent?: boolean,
   ): Promise<string>
   ```

4. **ensureSessionDir**
   ```typescript
   // Before
   export async function ensureSessionDir(sessionDir?: string): Promise<void>
   
   // After - Function simplified or potentially removed
   export async function ensureSessionDir(): Promise<void>
   // OR: Function eliminated entirely and logic inlined
   ```

5. **resolveSessionDir**
   ```typescript
   // Before  
   export function resolveSessionDir(sessionDir?: string): string {
     return sessionDir || SESSION_DIR;
   }
   
   // After - Function eliminated entirely
   // All usage replaced with SESSION_DIR constant directly
   ```

## Data Flow Changes

### Before Removal:
```
User Code: Agent.create({ sessionDir: "/custom/path" })
  ↓
AgentOptions.sessionDir → Agent constructor
  ↓  
MessageManagerOptions.sessionDir → MessageManager constructor
  ↓
MessageManager.sessionDir → session service functions
  ↓
resolveSessionDir(sessionDir) → actual path resolution
  ↓
Final path: sessionDir || SESSION_DIR
```

### After Removal:
```
User Code: Agent.create({ /* no sessionDir option */ })
  ↓
AgentOptions (no sessionDir) → Agent constructor  
  ↓
MessageManagerOptions (no sessionDir) → MessageManager constructor
  ↓
MessageManager → session service functions (no sessionDir param)
  ↓
SESSION_DIR constant used directly
  ↓  
Final path: SESSION_DIR (always ~/.wave/projects)
```

## Constants and Default Values

### Session Directory Constant (packages/agent-sdk/src/services/session.ts)

**Remains Unchanged:**
```typescript
const SESSION_DIR = join(homedir(), ".wave", "projects");
```

**Usage Changes:**
- Before: `resolveSessionDir(sessionDir)` throughout codebase
- After: `SESSION_DIR` used directly throughout codebase

## Validation Rules

### Removed Validations:
- No need to validate sessionDir parameter format
- No need to check sessionDir permissions  
- No need to resolve relative vs absolute sessionDir paths

### Preserved Validations:
- Default session directory creation (SESSION_DIR)
- Session file format validation
- Session ID format validation
- Workdir path encoding validation

## State Management Changes

### MessageManager Class:
```typescript
class MessageManager {
  // Before
  private sessionDir?: string;
  
  // After - property removed entirely
  // No sessionDir property needed
  
  constructor(options: MessageManagerOptions) {
    // Before
    this.sessionDir = options.sessionDir;
    
    // After - no sessionDir assignment
    // All path computation uses SESSION_DIR directly
  }
  
  // Path computation methods simplified
  private computeTranscriptPath(): string {
    // Before
    const sessionDir = this.sessionDir || join(homedir(), ".wave", "projects");
    
    // After  
    const sessionDir = SESSION_DIR;
    // ... rest unchanged
  }
}
```

## Breaking Change Summary

### External API Changes:
1. **AgentOptions.sessionDir** - Removed, TypeScript compilation error for users
2. **Agent.create()** - No longer accepts sessionDir parameter

### Internal API Changes:
1. **MessageManagerOptions.sessionDir** - Removed
2. **All session service function signatures** - sessionDir parameter removed
3. **resolveSessionDir function** - Eliminated entirely

### Behavioral Changes:
- All sessions now use `~/.wave/projects` exclusively
- No custom session directory configuration possible
- Existing default behavior unchanged for users not using custom sessionDir

## Migration Impact

### For End Users:
```typescript
// Before (will break after change)
const agent = await Agent.create({
  sessionDir: "/custom/sessions"  // ← TypeScript error after removal
});

// After (required usage)
const agent = await Agent.create({
  // sessionDir option no longer available
  // Sessions automatically use ~/.wave/projects
});
```

### For Internal Code:
- All internal session service calls simplified
- No sessionDir parameter passing needed
- Direct SESSION_DIR constant usage throughout