# API Contract: Built-in Subagent Loading

## Modified Functions

### loadSubagentConfigurations()

**Location**: `packages/agent-sdk/src/utils/subagentParser.ts`

**Signature**: 
```typescript
export async function loadSubagentConfigurations(
  workdir: string,
): Promise<SubagentConfiguration[]>
```

**Behavior Changes**:
- **Before**: Loaded only project and user subagents from filesystem
- **After**: Includes built-in subagents with priority 3

**Return Value**: Array of SubagentConfiguration sorted by priority (ascending), then name

**Priority Order**: 
1. Project configs (priority 1)
2. User configs (priority 2)  
3. Built-in configs (priority 3)

## New Functions

### getBuiltinSubagents()

**Location**: `packages/agent-sdk/src/utils/builtinSubagents.ts`

**Signature**:
```typescript
export function getBuiltinSubagents(): SubagentConfiguration[]
```

**Returns**: Array of hardcoded built-in subagent configurations

**Configurations Included**:
- Explore agent (codebase exploration specialist)

### createBuiltinConfiguration()

**Location**: `packages/agent-sdk/src/utils/builtinSubagents.ts`

**Signature**:
```typescript
function createBuiltinConfiguration(
  name: string,
  description: string,
  systemPrompt: string,
  tools: string[],
  model?: string
): SubagentConfiguration
```

**Purpose**: Create hardcoded built-in subagent configurations

**Model Handling**: "fastModel" string gets special treatment in SubagentManager (similar to "inherit")

## Interface Extensions

### SubagentConfiguration.scope

**Extended Type**: 
```typescript
scope: "project" | "user" | "builtin"
```

**Migration**: Type assertion used for backward compatibility - no runtime changes needed

## Error Handling

**Missing Built-ins**: Graceful degradation if built-in definitions fail to load

**Tool Conflicts**: Invalid tools in disallowedTools list are ignored with warning