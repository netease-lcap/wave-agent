# Subagent Message Callbacks API Contract

**Package**: agent-sdk  
**File**: `src/managers/subagentManager.ts`  
**Interface**: SubagentManagerCallbacks

## Interface Definition

Creates dedicated `SubagentManagerCallbacks` interface for subagent-specific callbacks, separate from MessageManagerCallbacks to provide clean architectural separation.

## Primary Purpose: Progress Reporting

While these callbacks provide granular access to subagent events, their primary use in the Wave CLI is to update the `shortResult` of the `Agent` tool block in real-time. This provides users with feedback on subagent activity (e.g., tool execution and token usage) without persisting the full subagent message history in the CLI memory.

## New Callback Definitions

### onSubagentUserMessageAdded

**Purpose**: Notify when a subagent adds a user message

**Signature**:
```typescript
onSubagentUserMessageAdded?: (subagentId: string, params: UserMessageParams) => void;
```

**Parameters**:
- `subagentId: string` - Unique identifier for the subagent instance
- `params: UserMessageParams` - User message parameters (content, metadata, etc.)

**Behavior**:
- Called when subagent adds user message via `messageManager.addUserMessage()`
- Provides subagent context for monitoring and reporting

---

### onSubagentAssistantMessageAdded

**Purpose**: Notify when a subagent creates an assistant message

**Signature**:
```typescript
onSubagentAssistantMessageAdded?: (subagentId: string) => void;
```

**Parameters**:
- `subagentId: string` - Unique identifier for the subagent instance

**Behavior**:
- Called when subagent creates assistant message via `messageManager.addAssistantMessage()`
- Signals start of assistant response for loading state management

---

### onSubagentAssistantContentUpdated

**Purpose**: Notify during subagent content streaming updates

**Signature**:
```typescript
onSubagentAssistantContentUpdated?: (
  subagentId: string, 
  chunk: string, 
  accumulated: string
) => void;
```

**Parameters**:
- `subagentId: string` - Unique identifier for the subagent instance
- `chunk: string` - Incremental content (new chunk from this update)
- `accumulated: string` - Total accumulated content so far

**Behavior**:
- Called during streaming via `messageManager.updateCurrentMessageContent()`
- Provides real-time content updates with subagent context

---

### onSubagentAssistantReasoningUpdated

**Purpose**: Notify during subagent reasoning streaming updates

**Signature**:
```typescript
onSubagentAssistantReasoningUpdated?: (
  subagentId: string, 
  chunk: string, 
  accumulated: string
) => void;
```

**Parameters**:
- `subagentId: string` - Unique identifier for the subagent instance
- `chunk: string` - Incremental reasoning (new chunk from this update)
- `accumulated: string` - Total accumulated reasoning so far

**Behavior**:
- Called during streaming via `messageManager.updateCurrentMessageReasoning()`
- Provides real-time reasoning updates with subagent context

---

### onSubagentToolBlockUpdated

**Purpose**: Notify when subagent tool blocks are updated

**Signature**:
```typescript
onSubagentToolBlockUpdated?: (
  subagentId: string, 
  params: AgentToolBlockUpdateParams
) => void;
```

**Parameters**:
- `subagentId: string` - Unique identifier for the subagent instance  
- `params: AgentToolBlockUpdateParams` - Tool update parameters (name, stage, result, etc.)

**Behavior**:
- Called when subagent updates tool blocks via `messageManager.updateToolBlock()`
- Provides detailed tool execution tracking per subagent

---

### onSubagentMessagesChange

**Purpose**: Notify when the full message list for a subagent changes

**Signature**:
```typescript
onSubagentMessagesChange?: (subagentId: string, messages: Message[]) => void;
```

**Behavior**:
- Triggered whenever any message in the subagent's isolated context is added or updated.
- Useful for comprehensive monitoring of subagent state.
- In the Wave CLI, this is used to calculate the number of tools executed for the `shortResult` summary.

---

### onSubagentLatestTotalTokensChange

**Purpose**: Notify when the total token usage for a subagent changes

**Signature**:
```typescript
onSubagentLatestTotalTokensChange?: (subagentId: string, tokens: number) => void;
```

**Behavior**:
- Triggered after each AI interaction within the subagent context.
- Used in the Wave CLI to update the token usage part of the `shortResult` summary.

## Usage Examples

### Basic Subagent Monitoring
```typescript
const callbacks: SubagentManagerCallbacks = {
  onSubagentToolBlockUpdated: (subagentId, params) => {
    // Track tool execution for reporting
    if (params.stage === 'running') {
      console.log(`[${subagentId}] Running tool: ${params.name}`);
    }
  },
  
  onSubagentLatestTotalTokensChange: (subagentId, tokens) => {
    // Update token usage for reporting
    updateTokenCounter(subagentId, tokens);
  }
};
```

## Error Handling

### Callback Error Resilience
- Callback errors do not interrupt subagent execution
- Errors are logged but processing continues
- Failed callbacks don't affect main agent functionality
- Standard try-catch pattern around callback invocations

## Testing Contract

### Mock Implementation
```typescript
const mockCallbacks = {
  onSubagentToolBlockUpdated: vi.fn(),
  onSubagentLatestTotalTokensChange: vi.fn()
};

// Verify callback execution
expect(mockCallbacks.onSubagentToolBlockUpdated).toHaveBeenCalledWith(
  'subagent-123',
  expect.objectContaining({ name: 'Bash', stage: 'running' })
);
```