# Data Model: SDK Usage Tracking and Callback System

**Date**: 2025-11-11  
**Phase**: 1 - Design & Contracts  

## Core Entities

### Usage Statistics
Represents token consumption data from AI operations, extending OpenAI's Usage format.

**Structure**:
```typescript
interface Usage {
  prompt_tokens: number;        // Tokens used in prompts
  completion_tokens: number;    // Tokens generated in completions  
  total_tokens: number;         // Sum of prompt + completion tokens
  model?: string;               // Model used for the operation (e.g., "gpt-4", "gpt-3.5-turbo")
  operation_type?: 'agent' | 'compress';  // Type of operation that generated usage
}
```

**Source**: OpenAI API response, enhanced with model and operation tracking  
**Persistence**: Stored in Agent usage array and embedded within Message blocks in session files  
**Validation**:
- `prompt_tokens >= 0`
- `completion_tokens >= 0`  
- `total_tokens === prompt_tokens + completion_tokens`
- `model` matches known OpenAI model patterns
- `operation_type` is either 'agent' or 'compress'

**Relationships**:
- One-to-one with Message (each assistant message may have usage data)
- One-to-many with Agent usage array (Agent stores all Usage objects)
- Direct access via Agent.usages getter

### Usage Callback
Function interface for receiving usage notifications when AI operations complete.

**Structure**:
```typescript
interface UsageCallback {
  (usages: Usage[]): void | Promise<void>;
}
```

**Properties**:
- Receives array of all usage data from current session
- Called after each successful AI operation (agent call or compression)
- Async execution supported, errors isolated from core operations

**Lifecycle**:
1. Registered via `AgentCallbacks.onUsagesChange`
2. Triggered after `callAgent()` completes successfully
3. Triggered after `compressMessages()` completes successfully  
4. Receives complete usage array from Agent.usages

### Message Usage Metadata
Extension to existing Message entity to store per-operation usage data.

**Enhanced Message Structure**:
```typescript
interface Message {
  role: "user" | "assistant";
  blocks: MessageBlock[];
  usage?: Usage;                // New field - usage data for this message's AI operation
}
```

**Storage Rules**:
- Only assistant messages contain usage data
- Usage data corresponds to the AI operation that generated the message
- Persisted automatically through existing session save mechanism
- Also stored directly in Agent usage array for fast access

**State Transitions**:
1. **Created**: Message created without usage data
2. **Populated**: Usage data added after successful AI operation and pushed to Agent usage array
3. **Persisted**: Message with usage saved to session file
4. **Accessible**: Usage data available via Agent.usages getter

## Agent Usage Array Model

### Direct Usage Storage
Agent class maintains a `Usage[]` array that gets updated directly when AI operations complete.

**Agent Structure Enhancement**:
```typescript
class Agent {
  private _usages: Usage[] = [];
  
  public get usages(): Usage[] {
    return [...this._usages];  // Return copy to prevent external modification
  }
  
  private addUsage(usage: Usage): void {
    this._usages.push(usage);
  }
}
```

**Update Pattern**:
1. AI operation completes successfully
2. Usage data extracted from API response
3. Usage object pushed to Agent._usages array
4. Callbacks triggered with complete usage array
5. Usage data also embedded in message for persistence

**Benefits**:
- O(1) access time for usage data retrieval
- No scanning or aggregation required  
- Simple append-only operation
- Direct array access for callbacks

### CLI Summary Calculation
Per-model token aggregation calculated from Agent usage array for display when CLI terminates.

**Summary Calculation**:
```typescript
function calculateTokenSummary(usages: Usage[]): Map<string, TokenSummary> {
  const summaryMap = new Map<string, TokenSummary>();
  
  usages.forEach(usage => {
    const model = usage.model || 'unknown';
    
    if (!summaryMap.has(model)) {
      summaryMap.set(model, {
        model,
        prompt_tokens: 0,
        completion_tokens: 0,
        total_tokens: 0,
        operations: { agent_calls: 0, compressions: 0 }
      });
    }
    
    const summary = summaryMap.get(model)!;
    summary.prompt_tokens += usage.prompt_tokens;
    summary.completion_tokens += usage.completion_tokens;
    summary.total_tokens += usage.total_tokens;
    
    if (usage.operation_type === 'agent') {
      summary.operations.agent_calls++;
    } else if (usage.operation_type === 'compress') {
      summary.operations.compressions++;
    }
  });
  
  return summaryMap;
}
```

**Summary Structure**:
```typescript
interface TokenSummary {
  model: string;
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
  operations: {
    agent_calls: number;
    compressions: number;
  };
}
```

**Display Format**:
```
Token Usage Summary:
==================
Model: gpt-4
  Prompt tokens: 1,250
  Completion tokens: 2,100  
  Total tokens: 3,350
  Operations: 5 agent calls, 2 compressions

Model: gpt-3.5-turbo-16k
  Prompt tokens: 450
  Completion tokens: 200
  Total tokens: 650
  Operations: 0 agent calls, 3 compressions
```

## Error Handling Model

### Callback Error Isolation
Usage callback failures must not impact core SDK operations.

**Error Handling Pattern**:
```typescript
private async triggerUsageCallbacks(usages: Usage[]): Promise<void> {
  if (this.callbacks.onUsagesChange) {
    try {
      await this.callbacks.onUsagesChange(usages);
    } catch (error) {
      this.logger?.error('Usage callback failed:', error);
      // Continue normal operation
    }
  }
}
```

### Data Consistency Rules
- Usage tracking only occurs for successful AI operations (FR-012)
- Failed API calls do not generate usage data
- Corrupted usage data in messages is skipped during aggregation
- Missing usage data does not prevent callback execution (empty array sent)

## Integration Points

### Callback System Integration
Usage callbacks integrate with existing `AgentCallbacks` pattern:

```typescript
export interface AgentCallbacks 
  extends MessageManagerCallbacks,
          BackgroundBashManagerCallbacks,
          McpManagerCallbacks {
  onUsagesChange?: (usages: Usage[]) => void | Promise<void>;  // New callback
}
```

### Session Persistence Integration
Usage data flows through Agent usage array and existing session save/load mechanism:
1. AI operation completes → usage data added to Agent._usages array and message
2. Session auto-save → usage data persisted to file via message
3. Session restore → usage data loaded with messages and restored to Agent._usages array
4. `get usages()` called → usage data returned directly from array

### CLI Integration Points
Token summary integrates with existing cleanup functions:
- `packages/code/src/cli.tsx` - Interactive CLI cleanup
- `packages/code/src/plain-cli.ts` - Plain mode cleanup
- Both exit paths display summary before process termination