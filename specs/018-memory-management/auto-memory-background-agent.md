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

## Wave Implementation

### 1. ForkedAgentManager

Auto-memory uses `ForkedAgentManager` — an independent manager for forked agent lifecycle, decoupled from `BackgroundTaskManager`.

```typescript
// packages/agent-sdk/src/managers/forkedAgentManager.ts

// Fire-and-forget execution at turn end
await this.forkedAgentManager.forkAndExecute(
  "general-purpose",
  messages,           // Full conversation history
  {
    description: "Auto-memory extraction background agent",
    allowedTools: [
      "Read", "Glob", "Grep",
      `Write(${memoryDir}/**/*)`,
      `Edit(${memoryDir}/**/*)`,
    ],
    model: "fastModel",
    permissionModeOverride: "dontAsk",
  },
  extractionPrompt,   // The extraction prompt
);
```

Key properties:
- **Does NOT interact with `BackgroundTaskManager`** — no task entries, no UI notifications
- **Own log files** at `os.tmpdir()/wave-forked-agent-<id>.log`
- **Fire-and-forget** — returns immediately, caller is not blocked
- **Provides `stop()`, `cleanup()`, `getActiveForks()`** for lifecycle management

### 2. AutoMemoryService Flow

```typescript
// packages/agent-sdk/src/services/autoMemoryService.ts

// 1. OnTurnEnd called after each conversation turn
async onTurnEnd(workdir: string) {
  // Throttle: check frequency
  if (turnsSinceLastExtraction < frequency) return;

  // Mutual exclusion: skip if main agent wrote memories
  if (hasManualMemoryWrite(recentMessages, memoryDir)) return;

  // Fire-and-forget forked agent extraction
  await forkedAgentManager.forkAndExecute(...);
}
```

### 3. DI Registration

`ForkedAgentManager` is registered in `containerSetup.ts` after `SubagentManager`:

```typescript
// packages/agent-sdk/src/utils/containerSetup.ts
const subagentManager = new SubagentManager(container, {...});
container.register("SubagentManager", subagentManager);

const forkedAgentManager = new ForkedAgentManager(container);
container.register("ForkedAgentManager", forkedAgentManager);
```

`AutoMemoryService` retrieves it from the container:

```typescript
private get forkedAgentManager(): ForkedAgentManager {
  return this.container.get<ForkedAgentManager>("ForkedAgentManager")!;
}
```

### 4. Agent Lifecycle

`ForkedAgentManager` is stored on the `Agent` class and cleaned up on `destroy()`:

```typescript
// packages/agent-sdk/src/agent.ts
this.forkedAgentManager = this.container.get("ForkedAgentManager")!;

// In destroy():
this.forkedAgentManager.cleanup();
```

## References

- Claude Code source: `/home/liuyiqi/github/claude-code/src/services/extractMemories/`
- Memory types: `src/memdir/memoryTypes.ts`
- Path resolution: `src/memdir/paths.ts`
- Forked agent: `src/utils/forkedAgent.ts`
- Wave `ForkedAgentManager`: `packages/agent-sdk/src/managers/forkedAgentManager.ts`
- Wave `AutoMemoryService`: `packages/agent-sdk/src/services/autoMemoryService.ts`
- Wave DI setup: `packages/agent-sdk/src/utils/containerSetup.ts`
