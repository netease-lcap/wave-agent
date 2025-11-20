# Data Model: Tool Block Stage Updates

**Feature**: Tool Block Stage Updates
**Date**: 2025-11-20
**Branch**: 013-tool-block-states

## Actual Interface Modifications

Based on codebase analysis, this feature modifies **two existing interfaces**:

### 1. UpdateToolBlockParams (packages/agent-sdk/src/utils/messageOperations.ts)
**Current fields**:
- `id: string`
- `parameters: string` 
- `result?: string`
- `success?: boolean`
- `error?: string`
- `isRunning?: boolean` ← **TO BE REMOVED**
- `name?: string`
- `shortResult?: string`
- `images?: Array<{ data: string; mediaType?: string }>`
- `compactParams?: string`
- `parametersChunk?: string`

**Changes**:
- **Add**: `stage: 'start' | 'streaming' | 'running' | 'end'`
- **Remove**: `isRunning?: boolean` (deprecated)

### 2. ToolBlock (packages/agent-sdk/src/types/messaging.ts)
**Current fields**:
- `type: "tool"`
- `content: string`
- `toolCall: { name: string; arguments: string }`
- `id?: string`
- `name?: string`
- `isRunning?: boolean` ← **TO BE REMOVED**
- `success?: boolean`
- `error?: string | Error`
- `compactParams?: string`
- `parametersChunk?: string`

**Changes**:
- **Add**: `stage: 'start' | 'streaming' | 'running' | 'end'`
- **Remove**: `isRunning?: boolean` (deprecated)

### 3. CommandOutputBlock (packages/agent-sdk/src/types/messaging.ts)
**Note**: This interface has `isRunning: boolean` (required) but is for **command output**, not tool execution. It should **remain unchanged**.

## Field Changes

### Added Field
- `stage` (required): `'start' | 'streaming' | 'running' | 'end'`
  - Provides clear lifecycle semantics for tool execution
  - Replaces the ambiguous `isRunning` boolean
  - Must be present on all tool execution events

### Removed Field  
- `isRunning` (deprecated): `boolean`
  - Ambiguous running state indicator
  - Removed from both `UpdateToolBlockParams` and `ToolBlock` interfaces
  - No longer present in any tool execution event payload

### Preserved Fields
All existing fields remain unchanged to maintain backward compatibility:
- `id` (optional): `string` - Unique identifier for the tool block
- `name` (optional): `string` - Human-readable tool name for display  
- `parameters` (required in params): `string` - Tool parameters
- `result` (optional): `string` - Final result on successful completion
- `success` (optional): `boolean` - Success status
- `error` (optional): `string | Error` - Error information on failure
- `compactParams` (optional): `string` - Compact parameter display
- `parametersChunk` (optional): `string` - Incremental parameter updates for streaming
- `images` (optional): Image data arrays
- `shortResult` (optional): `string` - Abbreviated result display

## Field Usage by Stage

| Stage | Required Fields | Optional Fields | Purpose |
|-------|----------------|-----------------|---------|
| `start` | `stage`, `id`, `name`, `parameters` | - | Announce tool execution beginning |
| `streaming` | `stage`, `id`, `name`, `parameters` | `parametersChunk`, `result` | Emit incremental parameter or result updates |
| `running` | `stage`, `id`, `name`, `parameters` | - | Indicate ongoing execution without new output |
| `end` | `stage`, `id`, `name`, `parameters` | `result` (success), `error` (failure), `success` | Signal completion with final outcome |

## Validation Rules

- Exactly one event must have `stage: 'start'` per tool execution
- Exactly one event must have `stage: 'end'` per tool execution  
- `parametersChunk` should typically be used with `stage: 'streaming'`
- `result` should typically be used with `stage: 'end'` (success case)
- `error` should typically be used with `stage: 'end'` (failure case)
- No event may contain the deprecated `isRunning` field

## Lifecycle Semantics

**State Transitions**:
1. `start` → (execution begins with tool metadata)
2. Optional: `streaming` → (incremental parameter or result updates)  
3. Optional: `running` → (ongoing work without new output)
4. `end` → (execution completes with result or error)

**Invariants**:
- Always begins with exactly one `start` event
- Always ends with exactly one `end` event
- Zero or more `streaming` and `running` events between start and end
- Events delivered in chronological execution order

## Migration Impact

**Breaking Changes**:
- Removal of `isRunning` field from all tool execution events
- Required `stage` field on all tool execution events

**Preserved Compatibility**:
- Callback function signature remains unchanged
- All other field names and types preserved
- Existing `CommandOutputBlock` interface unchanged (for command output, not tools)
- Result and error handling semantics maintained

## Type Definitions

### Updated UpdateToolBlockParams
```typescript
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
```

### Updated ToolBlock
```typescript
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