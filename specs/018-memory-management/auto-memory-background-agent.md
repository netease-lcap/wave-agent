# Auto Memory Background Agent

This document describes Claude Code's implementation of auto-memory extraction using background agents.

## Overview

Auto-memory is a persistent, file-based memory system that allows the agent to remember information across sessions. A background agent (forked subagent) helps extract and save memories at the end of each turn.

## Architecture

### Memory Storage

- **Location**: `~/.claude/projects/<sanitized-git-root>/memory/`
- **Entrypoint**: `MEMORY.md` (index file, max 200 lines loaded into context)
- **Topic files**: Individual memory files (e.g., `user_role.md`, `debugging.md`)

### Background Agent Pattern

The auto-memory system uses a **forked agent** pattern:

1. **Forked Agent** (`runForkedAgent`): A perfect fork of the main conversation that shares the parent's prompt cache
2. **Tool Restrictions**: Read/Grep/Glob unrestricted, read-only Bash, Edit/Write only for auto-memory paths
3. **Async Execution**: Runs at the end of each query loop via `handleStopHooks`

## Implementation

### Key Files

```
src/
├── services/
│   ├── extractMemories/
│   │   ├── extractMemories.ts    # Turn-end memory extraction
│   │   └── prompts.ts            # Extraction prompts
│   └── autoDream/
│       ├── autoDream.ts          # Periodic consolidation
│       └── consolidationPrompt.ts
├── memdir/
│   ├── memdir.ts                 # Memory prompt builder
│   ├── paths.ts                  # Path resolution
│   ├── memoryScan.ts             # File scanning
│   └── memoryTypes.ts            # Type taxonomy
└── utils/
    └── forkedAgent.ts            # Forked agent runner
```

### Extract Memories Flow

```typescript
// src/services/extractMemories/extractMemories.ts

// 1. Initialize at startup
initExtractMemories()

// 2. Called at end of each query loop
executeExtractMemories(context, appendSystemMessage)

// 3. Internal flow:
//    - Check if main agent already wrote memories (skip if so)
//    - Throttle: only run every N turns (tengu_bramble_lintel gate)
//    - Run forked agent with restricted tools
//    - Advance cursor to track processed messages
```

### Tool Permissions

The forked agent has restricted tool access via `createAutoMemCanUseTool`:

```typescript
// Allow unrestricted
- FILE_READ_TOOL_NAME
- GREP_TOOL_NAME
- GLOB_TOOL_NAME

// Allow read-only
- BASH_TOOL_NAME (isReadOnly commands only)

// Allow only for auto-memory paths
- FILE_EDIT_TOOL_NAME
- FILE_WRITE_TOOL_NAME
```

### Mutual Exclusion

If the main agent writes memories directly during the conversation:

```typescript
// Check for memory writes since last extraction
if (hasMemoryWritesSince(messages, lastMemoryMessageUuid)) {
  // Skip forked agent, advance cursor
  lastMemoryMessageUuid = messages.at(-1)?.uuid
  return
}
```

This prevents duplicate work when the main agent handles memory saving.

## Configuration

### Feature Gates (GrowthBook)

| Gate | Purpose |
|------|---------|
| `tengu_passport_quail` | Enable extract memories |
| `tengu_bramble_lintel` | Throttle turns between runs (default: 1) |
| `tengu_moth_copse` | Skip MEMORY.md index |

### Environment Variables

| Variable | Effect |
|----------|--------|
| `CLAUDE_CODE_DISABLE_AUTO_MEMORY=1` | Disable auto-memory entirely |
| `CLAUDE_CODE_SIMPLE=1` | Disable (bare mode) |

### Settings

```json
// settings.json
{
  "autoMemoryEnabled": false  // Disable auto-memory
}
```

## Memory Types

The system uses a closed four-type taxonomy:

| Type | Description |
|------|-------------|
| **User** | Facts about user (role, preferences) |
| **Project** | Architecture, conventions, key paths |
| **Feedback** | Corrections, behaviors to avoid/repeat |
| **Reference** | External systems, dashboards, channels |

**What NOT to save**:
- Derivable from current project state (code patterns, git history)
- Session-specific context (current task, temp state)
- Hypothetical conclusions

## Auto-Dream (Consolidation)

Separate from turn-end extraction, a periodic consolidation process:

```typescript
// src/services/autoDream/autoDream.ts

// Gates: time + session count
minHours: 24      // Hours since last consolidation
minSessions: 5    // Sessions since last consolidation

// Flow:
// 1. Time gate passes
// 2. Session count gate passes
// 3. Acquire lock
// 4. Run forked agent with consolidation prompt
// 5. Rollback lock on failure
```

## Wave Implementation Considerations

### 1. Forked Agent Pattern

We need a similar mechanism to run a subagent at turn end:

```typescript
// Conceptual API
interface ForkedAgentOptions {
  promptMessages: Message[]
  cacheSafeParams: CacheSafeParams  // Share prompt cache
  canUseTool: CanUseToolFn          // Restrict tools
  maxTurns: number                  // Prevent runaway
  skipTranscript: boolean           // Don't record to main transcript
}
```

### 2. Tool Restriction System

Need a `canUseTool` callback system to restrict subagent tools:

```typescript
type CanUseToolFn = (
  tool: Tool,
  input: Record<string, unknown>
) => Promise<PermissionResult>
```

### 3. Cursor Tracking

Track which messages have been processed:

```typescript
let lastMemoryMessageUuid: string | undefined

// On successful extraction
lastMemoryMessageUuid = messages.at(-1)?.uuid
```

### 4. Throttling

Avoid running every turn:

```typescript
let turnsSinceLastExtraction = 0
const threshold = getFeatureValue('throttle_gate', 1)

turnsSinceLastExtraction++
if (turnsSinceLastExtraction < threshold) return
turnsSinceLastExtraction = 0
```

## References

- Claude Code source: `/home/liuyiqi/github/claude-code/src/services/extractMemories/`
- Memory types: `src/memdir/memoryTypes.ts`
- Path resolution: `src/memdir/paths.ts`
- Forked agent: `src/utils/forkedAgent.ts`
