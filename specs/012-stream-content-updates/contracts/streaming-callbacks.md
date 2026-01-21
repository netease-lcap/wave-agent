# Streaming Callbacks API Contract

## Interface: MessageManagerCallbacks (Enhanced)

**Package**: agent-sdk  
**File**: `src/managers/messageManager.ts`

### New Streaming Callbacks

#### onAssistantContentUpdated
Triggered when assistant message content is updated during streaming.

```typescript
onAssistantContentUpdated?: (chunk: string, accumulated: string) => void;
```

**Parameters**:
- `chunk: string` - Incremental content (new chunk received from streaming API)
- `accumulated: string` - Accumulated content (full message text built up so far)

**Behavior**:
- Called for each content chunk received from streaming API
- `chunk` parameter contains only the new incremental text from this update
- `accumulated` parameter contains full accumulated text built up so far
- Called only during active streaming, not for completed messages
- Natural rate limiting by OpenAI API (typically 1-5fps)
- Agent SDK internally updates message content and triggers `onMessagesChange`

**Error Handling**:
- Callback errors do not interrupt streaming
- Errors are logged but streaming continues
- Malformed content is sanitized before callback

---

#### onToolBlockUpdated (Enhanced)
Enhanced existing callback to support streaming parameter updates and lifecycle tracking.

```typescript
onToolBlockUpdated?: (params: AgentToolBlockUpdateParams) => void;
```

**Enhanced Parameters**:
```typescript
interface AgentToolBlockUpdateParams {
  id: string;
  name: string;
  parameters: string;            // Now supports partial JSON during streaming
  parametersChunk?: string;      // New field for incremental parameter updates
  compactParams?: string;        // Updated in real-time during streaming
  result?: string;
  success?: boolean;
  error?: string;
  stage: 'start' | 'streaming' | 'running' | 'end';
  shortResult?: string;
  images?: string[];
}
```

**Enhanced Behavior**:
- **start**: Called when tool execution begins. Includes `id` and `name`.
- **streaming**: Called for each parameter chunk received. Includes `parametersChunk` and accumulated `parameters`.
- **running**: Called for long operations when no new chunks exist.
- **end**: Called exactly once when tool execution finishes. Includes final `result` or `error`.
- `compactParams` computed by: `this.generateCompactParams(extractStreamingParams(parameters))`
- Agent SDK manages streaming state internally

---

#### onAssistantMessageAdded (Modified)
Modified to remove arguments for separation of concerns.

```typescript
onAssistantMessageAdded?: () => void;
```

**Breaking Change**:
- Previous: `onAssistantMessageAdded?: (content?: string, toolCalls?: ChatCompletionMessageFunctionToolCall[]) => void`
- New: `onAssistantMessageAdded?: () => void`

**Rationale**:
- Content updates now handled by `onAssistantContentUpdated`
- Tool call updates handled by `onToolBlockUpdated`
- This callback now only signals message slot creation
- Agent SDK internally creates new message and triggers `onMessagesChange`

**Behavior**:
- Called when new assistant message starts streaming
- No arguments provided - just a signal
- Agent SDK internally creates new message and calls existing `onMessagesChange`
- UI should prepare for incoming streaming content through `onMessagesChange`

## Interface: CallAgentOptions (Enhanced)

**Package**: agent-sdk  
**File**: `src/services/aiService.ts`

### New Streaming Support

```typescript
export interface CallAgentOptions {
  // ... existing options
  
  // New streaming callbacks
  onContentUpdate?: (content: string) => void;   // Direct content callback
  onToolUpdate?: (toolCall: { id: string; name: string; parameters: string }) => void; // Direct tool callback
}
```

**Streaming Behavior**:
- No backward compatibility concerns - purely additive feature

## CLI Integration Contracts

### CLI Print Integration

**Package**: code  
**File**: `src/print-cli.ts`

```typescript
// CLI printing integration with streaming callbacks
export const printCLI = (agent: Agent) => {
  // Real-time content streaming for CLI output
  agent.onAssistantContentUpdated = (chunk: string, accumulated: string) => {
    // Update CLI display with streaming content in real-time
    // Can use either chunk (for incremental display) or accumulated (for full display)
    process.stdout.clearLine(0);
    process.stdout.cursorTo(0);
    process.stdout.write(accumulated); // Display full accumulated content
  };
  
  // Existing message change handling for final state and tool updates
  agent.onMessagesChange = (messages: Message[]) => {
    // Handle final message state and tool parameter updates
  };
};
```

This contract specification ensures consistent behavior across all streaming implementations.