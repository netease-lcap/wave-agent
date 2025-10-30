# Message Manager Callbacks Contract

## Interface Extension

Extends existing `MessageManagerCallbacks` interface with subagent-specific callbacks for potential future use or advanced integrations.

## New Callback Definitions

### onSubAgentBlockAdded

**Purpose**: Notify when a new subagent session begins and block is created

**Signature**:
```typescript
onSubAgentBlockAdded?: (sessionId: string) => void;
```

**Usage**: Optional callback for advanced integrations. The standard `onMessagesChange` callback is sufficient for most use cases.

### onSubAgentBlockUpdated

**Purpose**: Notify when subagent messages change 

**Signature**:
```typescript
onSubAgentBlockUpdated?: (sessionId: string, messages: Message[]) => void;
```

**Usage**: Optional callback for advanced integrations. The standard `onMessagesChange` callback is sufficient for most use cases.

## Integration with Existing Callbacks

### Callback Execution Order
```
1. onSubAgentBlockAdded (session start)
2. onSubAgentBlockUpdated (task progress)
3. onSubAgentBlockUpdated (task completion)
4. [No explicit removal callback - cleanup on session end]
```

### Relationship to Existing Callbacks
- **Independent of main conversation callbacks**: Subagent callbacks operate separately
- **No interference with tool callbacks**: onToolBlockUpdated still works for main agent
- **Session isolation**: Each subagent session has independent callback lifecycle

## Implementation Requirements

### Callback Registration
```typescript
const messageManager = new MessageManager({
  // ... existing callbacks
  onSubAgentBlockAdded: (sessionId) => {
    uiState.addSubagentBlock(sessionId);
  },
  onSubAgentBlockUpdated: (sessionId, messages) => {
    uiState.updateSubagentBlock(sessionId, messages);
  }
});
```

### Error Handling
- Callbacks should be optional (use `?.` operator)
- Failed callbacks should not interrupt subagent execution
- Log callback errors for debugging
- Continue subagent task even if UI updates fail

### Performance Considerations
- **Debouncing**: onSubAgentBlockUpdated may be called frequently
- **Message Limiting**: Always provide max 10 messages to prevent UI overload
- **Async Handling**: Callbacks should not block subagent execution
- **Memory Management**: UI should cleanup references when session ends

## Usage Example

## Usage in Code Package

The subagent callbacks (`onSubAgentBlockAdded`, `onSubAgentBlockUpdated`) are **not required** in the code package implementation. The existing `onMessagesChange` callback already handles all message updates, including subagent blocks.

### Existing Message Flow
```typescript
// In useChat.tsx - this already handles subagent blocks
const callbacks: AgentCallbacks = {
  onMessagesChange: (newMessages) => {
    setMessages([...newMessages]); // This includes SubagentBlock messages
  },
  // ... other callbacks
};
```

### Message Rendering
The `MessageList` component already receives all messages through the `messages` prop from `useChat`, so subagent blocks will be automatically included and rendered when the agent-sdk adds them to the message array.

### UI State Management
Expansion state for subagent blocks should be managed locally in the `SubagentBlock` component or through existing UI state patterns:

```typescript
// In SubagentBlock component
const [isExpanded, setIsExpanded] = useState(false);

const toggleExpanded = useCallback(() => {
  setIsExpanded(prev => !prev);
}, []);
```

## Implementation Simplification

Since `onMessagesChange` handles all message updates:

1. **No additional callback registration needed** in code package
2. **No separate subagent state management** required in useChat
3. **Standard message rendering flow** works automatically
4. **SubagentBlock components** integrate seamlessly with existing MessageList

## Testing Contract

### Mock Implementation
```typescript
const mockCallbacks = {
  onSubAgentBlockAdded: vi.fn(),
  onSubAgentBlockUpdated: vi.fn()
};

// Test callback invocation
await taskTool.execute(taskArgs, context);
expect(mockCallbacks.onSubAgentBlockAdded).toHaveBeenCalledWith(expect.any(String));
expect(mockCallbacks.onSubAgentBlockUpdated).toHaveBeenCalledWith(
  expect.any(String),
  expect.any(Array)
);
```

### Integration Testing
- Verify callbacks called in correct order
- Confirm sessionId consistency across callbacks
- Validate message array contents and limits
- Test error scenarios (callback failures)
- Verify cleanup behavior on session end