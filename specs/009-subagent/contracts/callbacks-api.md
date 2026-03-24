# Subagent Message Callbacks API Contract

**Package**: agent-sdk  
**File**: `src/managers/subagentManager.ts`  
**Interface**: SubagentManagerCallbacks (New)

## Interface Definition

Creates dedicated `SubagentManagerCallbacks` interface for subagent-specific callbacks, separate from MessageManagerCallbacks to provide clean architectural separation.

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
- Triggered after existing `onUserMessageAdded` callback (non-interfering)
- Provides subagent context for multi-agent UI implementations

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
- Triggered after existing `onAssistantMessageAdded` callback (non-interfering)

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
- Triggered after existing `onAssistantContentUpdated` callback (non-interfering)
- Natural rate limiting by OpenAI API (typically 1-5fps)

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
- Triggered after existing `onToolBlockUpdated` callback (non-interfering)

## Backward Compatibility Contract

### Guarantee Level: 100% Backward Compatible

1. **Existing Callback Signatures**: All existing callbacks maintain exact same signature
2. **Optional Parameters**: All new subagent callbacks are optional
3. **Non-Interfering**: New callbacks trigger after existing callbacks
4. **No Breaking Changes**: Existing functionality unchanged

### Callback Execution Order

```
1. Existing callback (e.g., onUserMessageAdded)
2. New subagent callback (e.g., onSubagentUserMessageAdded) - if registered
3. Standard onMessagesChange callback
```

## Usage Examples

### Basic Subagent Monitoring
```typescript
const callbacks: SubagentManagerCallbacks = {
  onSubagentUserMessageAdded: (subagentId, params) => {
    console.log(`[${subagentId}] User: ${params.content}`);
  },
  
  onSubagentAssistantContentUpdated: (subagentId, chunk, accumulated) => {
    updateSubagentStreamingUI(subagentId, accumulated);
  },
  
  onSubagentToolBlockUpdated: (subagentId, params) => {
    showSubagentToolProgress(subagentId, params.name, params.stage);
  }
};

// Pass to Agent which forwards to SubagentManager
const agent = await Agent.create({
  callbacks: callbacks, // AgentCallbacks extends SubagentManagerCallbacks
});
```

### Multi-Agent UI Implementation
```typescript
const callbacks: MessageManagerCallbacks = {
  // Track which subagents are active
  onSubagentAssistantMessageAdded: (subagentId) => {
    setSubagentStatus(subagentId, 'generating');
    showLoadingIndicator(subagentId);
  },
  
  // Real-time content updates per subagent
  onSubagentAssistantContentUpdated: (subagentId, chunk, accumulated) => {
    updateSubagentDisplay(subagentId, accumulated);
  },
  
  // Tool activity monitoring
  onSubagentToolBlockUpdated: (subagentId, params) => {
    updateToolActivity(subagentId, params.name, params.stage);
  }
};
```

## Error Handling

### Callback Error Resilience
- Callback errors do not interrupt subagent execution
- Errors are logged but processing continues
- Failed callbacks don't affect main agent functionality
- Standard try-catch pattern around callback invocations

### Performance Considerations
- **No Debouncing**: Direct callback execution for immediate feedback
- **Minimal Overhead**: Simple forwarding from existing callback points
- **Rate Limiting**: Natural limiting by underlying streaming rates
- **Memory Efficient**: No additional state tracking required

## Testing Contract

### Mock Implementation
```typescript
const mockCallbacks = {
  onSubagentUserMessageAdded: vi.fn(),
  onSubagentAssistantMessageAdded: vi.fn(),
  onSubagentAssistantContentUpdated: vi.fn(),
  onSubagentToolBlockUpdated: vi.fn()
};

// Verify callback execution
expect(mockCallbacks.onSubagentUserMessageAdded).toHaveBeenCalledWith(
  'subagent-123',
  expect.objectContaining({ content: 'test message' })
);
```

### Integration Testing Requirements
- Verify callbacks called with correct subagent ID
- Confirm callback execution order (existing → subagent)
- Validate parameter passing accuracy
- Test error scenarios (callback failures don't break execution)