# Subagent Callbacks Quickstart (Simplified)

**Feature**: 015-subagent-message-callbacks  
**Target**: Developers using Wave Agent SDK  
**Level**: Beginner to Intermediate

## Overview

This feature adds simple subagent-specific callbacks to track individual message events from subagents without modifying any existing functionality.

## Key Benefits

- **Zero Breaking Changes**: All existing callbacks work exactly the same
- **Simple Addition**: Just add new optional subagent callbacks alongside existing ones
- **Clean Separation**: Main agent events vs subagent events clearly separated
- **Easy Migration**: Start using new callbacks when you need them

## Basic Usage

### Step 1: Using Existing Callbacks (No Changes)

Your existing code continues to work exactly as before:

```typescript
const messageManager = new MessageManager({
  callbacks: {
    onUserMessageAdded: (params) => {
      console.log('User message:', params.content);
    },
    onAssistantContentUpdated: (chunk, accumulated) => {
      updateUI(accumulated);
    }
  }
});
```

### Step 2: Add Subagent Callbacks (Optional)

Add new subagent-specific callbacks alongside existing ones:

```typescript
const messageManager = new MessageManager({
  callbacks: {
    // Existing callbacks - handle main agent events
    onUserMessageAdded: (params) => {
      console.log('Main agent message:', params.content);
    },
    
    // New callbacks - handle subagent events
    onSubagentUserMessageAdded: (subagentId, params) => {
      console.log(`Subagent ${subagentId} message:`, params.content);
    },
    
    onSubagentAssistantContentUpdated: (subagentId, chunk, accumulated) => {
      updateSubagentUI(subagentId, accumulated);
    }
  }
});
```

## Available Subagent Callbacks

### onSubagentUserMessageAdded
Triggered when a subagent receives a user message.

```typescript
onSubagentUserMessageAdded?: (subagentId: string, params: UserMessageParams) => void
```

### onSubagentAssistantMessageAdded  
Triggered when a subagent creates a new assistant message.

```typescript
onSubagentAssistantMessageAdded?: (subagentId: string) => void
```

### onSubagentAssistantContentUpdated
Triggered during subagent content streaming.

```typescript
onSubagentAssistantContentUpdated?: (
  subagentId: string, 
  chunk: string, 
  accumulated: string
) => void
```

### onSubagentToolBlockUpdated
Triggered when a subagent tool is updated.

```typescript
onSubagentToolBlockUpdated?: (
  subagentId: string, 
  params: AgentToolBlockUpdateParams
) => void
```

## Common Patterns

### Multi-Agent Chat Interface

```typescript
const callbacks = {
  // Main agent messages
  onAssistantContentUpdated: (chunk, accumulated) => {
    updateChatBubble('main', accumulated);
  },
  
  // Subagent messages  
  onSubagentAssistantContentUpdated: (subagentId, chunk, accumulated) => {
    updateChatBubble(subagentId, accumulated);
  }
};
```

### Subagent Activity Monitoring

```typescript
const callbacks = {
  onSubagentUserMessageAdded: (subagentId, params) => {
    showSubagentActivity(subagentId, 'processing', params.content);
  },
  
  onSubagentAssistantContentUpdated: (subagentId, chunk, accumulated) => {
    showSubagentActivity(subagentId, 'responding', accumulated);
  }
};
```

### Debug Logging

```typescript
const callbacks = {
  // Main agent logging (unchanged)
  onUserMessageAdded: (params) => {
    logger.info('Main user message:', params);
  },
  
  // Subagent logging (new)
  onSubagentUserMessageAdded: (subagentId, params) => {
    logger.info(`Subagent ${subagentId} user message:`, params);
  }
};
```

## Migration Guide

### From Existing Code
No migration needed! Your existing code works exactly the same.

### Adding Subagent Support
1. Keep all existing callbacks as-is
2. Add new `onSubagent*` callbacks for subagent events
3. Implement UI updates for subagent-specific events

### Example Migration

**Before** (works unchanged):
```typescript
const callbacks = {
  onAssistantContentUpdated: (chunk, accumulated) => {
    updateChatUI(accumulated);
  }
};
```

**After** (enhanced with subagent support):
```typescript
const callbacks = {
  // Keep existing callback
  onAssistantContentUpdated: (chunk, accumulated) => {
    updateChatUI('main', accumulated);
  },
  
  // Add subagent callback
  onSubagentAssistantContentUpdated: (subagentId, chunk, accumulated) => {
    updateChatUI(subagentId, accumulated);
  }
};
```

## Best Practices

### 1. Keep Existing Logic Intact
Don't modify existing callback implementations - just add new subagent callbacks alongside them.

### 2. Use SubagentId for UI State
Use the `subagentId` parameter to maintain separate UI state for each subagent:

```typescript
const subagentStates = new Map();

const callbacks = {
  onSubagentAssistantContentUpdated: (subagentId, chunk, accumulated) => {
    subagentStates.set(subagentId, accumulated);
    renderSubagentBubble(subagentId, accumulated);
  }
};
```

### 3. Simple Error Handling
Since callbacks are optional, simple error handling is sufficient:

```typescript
const callbacks = {
  onSubagentUserMessageAdded: (subagentId, params) => {
    try {
      processSubagentMessage(subagentId, params);
    } catch (error) {
      console.error(`Error processing subagent ${subagentId}:`, error);
    }
  }
};
```

## Testing

### Unit Tests
Test callbacks by mocking the MessageManager:

```typescript
const mockCallbacks = {
  onSubagentUserMessageAdded: vi.fn()
};

// Test that callback is called with correct parameters
expect(mockCallbacks.onSubagentUserMessageAdded)
  .toHaveBeenCalledWith('subagent-123', expectedParams);
```

### Integration Tests
Test the full callback flow with actual subagent instances.

## Performance Notes

- Callbacks execute directly without batching or optimization
- No performance overhead for existing functionality
- New callbacks only add minimal execution cost when used

## Troubleshooting

### Callbacks Not Firing
- Ensure callbacks are properly registered in MessageManager options
- Verify SubagentManager is creating instances correctly
- Check that subagent events are actually occurring

### Type Errors
- Ensure you're using the latest type definitions
- All subagent callbacks are optional - no required changes

## Summary

This feature provides a simple, non-breaking way to monitor subagent message events. Just add the new optional callbacks alongside your existing ones when you need subagent-specific functionality.