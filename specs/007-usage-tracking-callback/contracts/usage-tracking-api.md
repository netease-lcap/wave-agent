# Usage Tracking API Contract

**Version**: 1.0.0  
**Date**: 2025-11-11  

## Type Definitions

### Core Usage Type
Based on OpenAI Usage format with extensions for tracking requirements.

```typescript
interface Usage {
  /** Tokens used in the prompt */
  prompt_tokens: number;
  
  /** Tokens generated in the completion */
  completion_tokens: number;
  
  /** Total tokens used (prompt + completion) */
  total_tokens: number;
  
  /** Model identifier (e.g., "gpt-4", "gpt-3.5-turbo-16k") */
  model?: string;
  
  /** Type of operation that generated this usage */
  operation_type?: 'agent' | 'compress';
}
```

### Usage Callback Interface
Function signature for receiving usage notifications.

```typescript
type UsageCallback = (usages: Usage[]) => void | Promise<void>;
```

**Parameters**:
- `usages`: Complete array of Usage objects from Agent._usages array
- Return type supports both sync and async implementations
- Errors in callback execution are isolated from core operations

### Extended Message Interface
Enhancement to existing Message type for usage storage.

```typescript
interface Message {
  role: "user" | "assistant";
  blocks: MessageBlock[];
  usage?: Usage;  // New optional field for assistant messages
}
```

**Usage Rules**:
- Only assistant messages may contain usage data
- Usage data corresponds to the AI operation that generated the message
- Field is optional - user messages and messages without AI operations have no usage data

## Agent API Extensions

### Callback Registration
Usage callbacks registered through existing AgentCallbacks pattern.

```typescript
interface AgentCallbacks {
  // ... existing callbacks
  onUsagesChange?: UsageCallback;
}
```

**Usage**:
```typescript
const agent = await Agent.create({
  callbacks: {
    onUsagesChange: (usages) => {
      console.log('Total usage:', usages.reduce((sum, u) => sum + u.total_tokens, 0));
    }
  }
});
```

### Usage Data Retrieval
Direct access to Agent usage array.

```typescript
class Agent {
  private _usages: Usage[] = [];
  
  /**
   * Get current session usage statistics
   * @returns Array of all Usage objects from this session
   */
  public get usages(): Usage[] {
    return [...this._usages];  // Return copy to prevent external modification
  }
}
```

**Return Value**:
- Empty array if no AI operations have occurred
- Complete array of Usage objects in chronological order
- Direct access without calculation or aggregation

## Callback Execution Contract

### Trigger Points
Usage callbacks are triggered at these specific lifecycle events:

1. **After Agent Call Completion**
   - Triggered when `callAgent()` completes successfully
   - Includes usage data from the completed agent operation
   - Array contains complete Agent._usages array (all session usage)

2. **After Message Compression Completion**  
   - Triggered when `compressMessages()` completes successfully
   - Includes usage data from the compression operation
   - Array contains complete Agent._usages array (all session usage)

### Error Handling Contract
Callback errors must not impact core SDK functionality:

```typescript
// Pseudo-implementation of error isolation
async function triggerUsageCallbacks(usages: Usage[]): Promise<void> {
  if (this.callbacks.onUsagesChange) {
    try {
      await this.callbacks.onUsagesChange(usages);
    } catch (error) {
      this.logger?.error('Usage callback failed:', error);
      // Core operation continues normally
    }
  }
}
```

**Guarantees**:
- Callback failures logged but do not throw
- Core AI operations complete successfully even if callbacks fail
- Multiple callback registrations not supported (last registration wins)

## Session Persistence Contract

### Usage Data Storage
Usage data automatically persisted through existing session mechanism:

```typescript
// Message storage format in session files
{
  "role": "assistant",
  "blocks": [...],
  "usage": {
    "prompt_tokens": 150,
    "completion_tokens": 75,
    "total_tokens": 225,
    "model": "gpt-4",
    "operation_type": "agent"
  }
}
```

### Session Restoration
Usage data restored when loading existing sessions:
- Usage data loaded with messages during session restoration
- Agent._usages array rebuilt from message usage data during restore
- `get usages()` method works immediately after session restoration
- Callbacks not triggered during session loading (only for new operations)

## CLI Integration Contract

### Exit Summary Display
CLI applications display usage summary on termination:

```typescript
// Summary format specification
interface TokenSummaryDisplay {
  title: "Token Usage Summary:";
  separator: "==================";
  entries: Array<{
    model: string;
    prompt_tokens: number;
    completion_tokens: number; 
    total_tokens: number;
    agent_calls: number;
    compressions: number;
  }>;
}
```

**Display Conditions**:
- Summary shown only if session contains usage data
- Displayed before process exit in both interactive and print CLI modes
- Summary generation failures do not prevent exit
- Maximum 500ms timeout for summary display

**Output Example**:
```
Token Usage Summary:
==================
Model: gpt-4
  Prompt tokens: 1,250
  Completion tokens: 2,100
  Total tokens: 3,350
  Operations: 5 agent calls, 2 compressions
```

## Backwards Compatibility

### Existing API Preservation
- All existing Agent methods and callbacks remain unchanged
- New usage tracking is additive only
- Applications not using usage callbacks see no behavior change
- Session files without usage data continue to load normally

### Migration Path
- Existing sessions load without usage data (empty `get usages()` results)
- New operations in restored sessions begin generating usage data
- No migration required for existing applications