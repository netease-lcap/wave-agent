# TypeScript Interface Contract: onToolBlockUpdated

**Feature**: Tool Block Stage Updates
**Date**: 2025-11-20
**Branch**: 013-tool-block-states

## Actual Interface Definitions

### Current Interface (Before)
```typescript
// packages/agent-sdk/src/utils/messageOperations.ts
export interface UpdateToolBlockParams {
  messages: Message[];
  id: string;
  parameters: string;
  result?: string;
  success?: boolean;
  error?: string;
  isRunning?: boolean; // DEPRECATED - ambiguous state
  name?: string;
  shortResult?: string;
  images?: Array<{ data: string; mediaType?: string }>;
  compactParams?: string;
  parametersChunk?: string;
}

// Agent specific interface (without messages parameter)
export type AgentToolBlockUpdateParams = Omit<
  UpdateToolBlockParams,
  "messages"
>;

// packages/agent-sdk/src/types/messaging.ts  
export interface ToolBlock {
  type: "tool";
  content: string;
  toolCall: { name: string; arguments: string };
  id?: string;
  name?: string;
  isRunning?: boolean; // DEPRECATED - ambiguous state
  success?: boolean;
  error?: string | Error;
  compactParams?: string;
  parametersChunk?: string;
}
```

### New Interface (After)
```typescript
// packages/agent-sdk/src/utils/messageOperations.ts
export interface UpdateToolBlockParams {
  messages: Message[];
  id: string;
  parameters: string;
  stage: 'start' | 'streaming' | 'running' | 'end'; // NEW
  result?: string;
  success?: boolean;
  error?: string;
  // isRunning?: boolean; // REMOVED
  name?: string;
  shortResult?: string;
  images?: Array<{ data: string; mediaType?: string }>;
  compactParams?: string;
  parametersChunk?: string;
}

// Agent specific interface (without messages parameter)
export type AgentToolBlockUpdateParams = Omit<
  UpdateToolBlockParams,
  "messages"
>;

// packages/agent-sdk/src/types/messaging.ts  
export interface ToolBlock {
  type: "tool";
  content: string;
  toolCall: { name: string; arguments: string };
  stage: 'start' | 'streaming' | 'running' | 'end'; // NEW
  id?: string;
  name?: string;
  // isRunning?: boolean; // REMOVED
  success?: boolean;
  error?: string | Error;
  compactParams?: string;
  parametersChunk?: string;
}
```

## Contract Guarantees

### Lifecycle Sequencing
1. **Exactly one** `stage: 'start'` event per tool execution
2. **Zero or more** `stage: 'streaming'` events (for parameter or result streaming)
3. **Zero or more** `stage: 'running'` events (for long operations without output)
4. **Exactly one** `stage: 'end'` event per tool execution

### Field Presence Rules
- `stage`: **Required** on all tool execution events
- `isRunning`: **REMOVED** - No longer present in any tool event
- `parametersChunk`: Typically used with `stage: 'streaming'`
- `result`: Typically used with `stage: 'end'` (success case)
- `error`: Typically used with `stage: 'end'` (failure case)

### Type Safety
- TypeScript discriminated union enables compile-time validation
- Consumers can use pattern matching for stage-specific handling:

```typescript
function handleToolUpdate(params: AgentToolBlockUpdateParams) {
  switch (params.stage) {
    case 'start':
      console.log(`Starting tool: ${params.name}`);
      console.log(`Parameters: ${params.parameters}`);
      break;
    case 'streaming':
      if (params.parametersChunk) {
        console.log(`Parameter chunk: ${params.parametersChunk}`);
      }
      if (params.result) {
        console.log(`Result chunk: ${params.result}`);
      }
      break;
    case 'running':
      console.log('Tool is still running...');
      break;
    case 'end':
      if (params.error) {
        console.error(`Failed: ${params.error}`);
      } else {
        console.log(`Result: ${params.result}`);
      }
      break;
  }
}
```

## Migration Guide

### For SDK Consumers
1. **Remove `isRunning` checks**: Replace with stage-based logic
2. **Handle new stages**: Implement handlers for all four stage types
3. **Update parameter handling**: Use `parametersChunk` for streaming parameter updates
4. **Update result handling**: Use incremental `result` updates during streaming
5. **Error handling**: Check `error` field only on `stage: 'end'`

### Example Migration
```typescript
// OLD (deprecated)
function oldHandler(params: AgentToolBlockUpdateParams) {
  if (params.isRunning) {
    console.log('Tool is running...');
  } else if (params.parametersChunk) {
    console.log(`Parameter update: ${params.parametersChunk}`);
  } else if (params.result) {
    console.log(`Done: ${params.result}`);
  }
}

// NEW (stage-based)
function newHandler(params: AgentToolBlockUpdateParams) {
  switch (params.stage) {
    case 'start':
      console.log(`Starting: ${params.name} with params: ${params.parameters}`);
      break;
    case 'streaming':
      if (params.parametersChunk) {
        console.log(`Param chunk: ${params.parametersChunk}`);
      }
      if (params.result) {
        console.log(`Result chunk: ${params.result}`);
      }
      break;
    case 'running':
      console.log('Still running...');
      break;
    case 'end':
      console.log(params.error ? `Failed: ${params.error}` : `Done: ${params.result}`);
      break;
  }
}
```

## Version Compatibility

**Breaking Changes**:
- Removal of `isRunning` field from all tool execution events
- Required `stage` field on all tool execution events

**Backward Compatible**:
- Callback function signature remains unchanged
- All other field names and types preserved
- Existing `CommandOutputBlock` interface unchanged (for command output, not tools)
- Parameter and result streaming capabilities maintained

## Testing Requirements

**Contract Validation Tests Must Verify**:
1. Each stage emits correct field combinations
2. No tool event contains deprecated `isRunning` field
3. Lifecycle sequencing guarantees are maintained
4. TypeScript compilation passes with strict mode
5. All existing integration tests continue to pass
6. Command output blocks (with `isRunning`) remain unchanged

## Special Considerations

### CommandOutputBlock Unchanged
```typescript
// This interface remains UNCHANGED - it's for command output, not tools
export interface CommandOutputBlock {
  type: "command_output";
  command: string;
  output: string;
  isRunning: boolean; // STAYS - required for command status
  exitCode: number | null;
}
```

**Rationale**: `CommandOutputBlock` is for system command execution, not AI tool execution, so it maintains the `isRunning` field for command status tracking.