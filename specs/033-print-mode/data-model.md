# Data Model: Print Mode

## Entities

### PrintCliCallbacks (Configuration)

The set of `AgentCallbacks` used by print mode. No new types — this documents which callbacks are active.

| Callback | Active | Output | Description |
|----------|--------|--------|-------------|
| `onAssistantMessageAdded` | Yes | None | Resets reasoning/content state flags |
| `onAssistantReasoningUpdated` | Yes | `💭 Reasoning:\n` + chunk | Main agent reasoning |
| `onAssistantContentUpdated` | Yes | `📝 Response:\n` + chunk | Main agent response text |
| `onToolBlockUpdated` | Yes | `🔧 <name> <params>\n` | Tool call indicator |
| `onErrorBlockAdded` | Yes | `❌ Error: <msg>\n` | Error display |
| `onSubagentUserMessageAdded` | No | — | Suppressed: contains system prompts |
| `onSubagentAssistantMessageAdded` | No | — | Suppressed: internal state |
| `onSubagentAssistantReasoningUpdated` | No | — | Suppressed: internal reasoning |
| `onSubagentAssistantContentUpdated` | No | — | Suppressed: internal content |
| `onSubagentToolBlockUpdated` | No | — | Suppressed: internal tool calls |

### StreamingState

Internal state tracking for the main agent's output stream.

| Field | Type | Description |
|-------|------|-------------|
| `isReasoning` | `boolean` | Whether the main agent is currently streaming reasoning |
| `isContent` | `boolean` | Whether the main agent is currently streaming content |

## Relationships

- `PrintCliCallbacks` uses `StreamingState` to track when to emit headers (`💭 Reasoning:`, `📝 Response:`).
- Suppressed callbacks are simply omitted from the callbacks object — no sentinel values needed.

## Validation Rules

- `onSubagentUserMessageAdded` MUST NOT be registered in print mode (FR-002).
- `onSubagentAssistantReasoningUpdated` MUST NOT be registered in print mode (FR-003).
- `onSubagentAssistantContentUpdated` MUST NOT be registered in print mode (FR-004).
