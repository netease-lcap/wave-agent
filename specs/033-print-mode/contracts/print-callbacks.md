# Print Mode Callback Contracts

## AgentCallbacks Configuration (Print Mode)

The `startPrintCli` function creates an `Agent` with a specific set of callbacks. Only main-agent callbacks are registered; subagent callbacks are omitted.

### Active Callbacks

```typescript
const callbacks: AgentCallbacks = {
  onAssistantMessageAdded: () => { /* reset state flags */ },
  onAssistantReasoningUpdated: (chunk: string) => {
    process.stdout.write(/* reasoning header + chunk */)
  },
  onAssistantContentUpdated: (chunk: string) => {
    process.stdout.write(/* response header + chunk */)
  },
  onToolBlockUpdated: (params) => {
    if (params.stage === "running") process.stdout.write(/* tool indicator */)
  },
  onErrorBlockAdded: (error: string) => {
    process.stdout.write(/* error display */)
  },
}
```

### Suppressed Callbacks (Not Registered)

```typescript
// NOT registered — subagent output is internal
// onSubagentUserMessageAdded
// onSubagentAssistantMessageAdded
// onSubagentAssistantReasoningUpdated
// onSubagentAssistantContentUpdated
// onSubagentToolBlockUpdated
```

## Output Format

```
[💭 Reasoning:\n]
[<reasoning_chunk>...]
[\n\n📝 Response:\n | \n]
[<content_chunk>...]
[\n🔧 <tool_name> <compact_params>\n...]
[\n❌ Error: <error_message>\n...]
\n
```

## Streaming Flow

```
Agent.sendMessage(prompt)
        ↓
onAssistantMessageAdded()          → reset flags
        ↓
[onAssistantReasoningUpdated(chunk)] → "💭 Reasoning:\n" + chunk (once + per-chunk)
        ↓
onAssistantContentUpdated(chunk)    → "📝 Response:\n" + chunk (once + per-chunk)
        ↓
[onToolBlockUpdated(params)]        → "🔧 <name> <params>\n" (when stage=running)
        ↓
[onErrorBlockAdded(error)]          → "❌ Error: <error>\n"
        ↓
process.stdout.write("\n")          → final newline
```
