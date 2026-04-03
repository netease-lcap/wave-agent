# Tool API Contract: Agent Tool

## Tool Definition

**Name**: `Agent`
**Type**: Function Tool
**Purpose**: Delegate specialized tasks to configured subagents

## Input Schema

```json
{
  "type": "object",
  "properties": {
    "description": {
      "type": "string",
      "description": "A short (3-5 word) description of the task"
    },
    "prompt": {
      "type": "string", 
      "description": "The task for the agent to perform"
    },
    "subagent_type": {
      "type": "string",
      "description": "The type of specialized agent to use for this task"
    },
    "run_in_background": {
      "type": "boolean",
      "description": "Set to true to run this command in the background. Use Read to read the output later."
    }
  },
  "required": [
    "description",
    "prompt", 
    "subagent_type"
  ],
  "additionalProperties": false,
  "$schema": "http://json-schema.org/draft-07/schema#"
}
```

## Output Schema

Uses existing `ToolResult` interface without extensions:

### Success Response
```json
{
  "success": true,
  "content": "[Last assistant message content from subagent]",
  "shortResult": "Agent completed (2 tools, 150 tokens)"
}
```

### Error Response
```json
{
  "success": false,
  "content": "",
  "error": "Subagent 'unknown-type' not found. Available: code-reviewer, documentation-writer, test-generator",
  "shortResult": "Agent not found"
}
```

## Content Format

### Success Content
The `content` field contains the actual output from the subagent's last assistant message - exactly what the subagent produced as its final response.

### ShortResult Format
The `shortResult` is updated dynamically during execution via the `onShortResultUpdate` callback.

- **Running**: `"ToolA, ToolB (3 tools, 500 tokens)"`
- **Success**: `"Agent completed (3 tools, 750 tokens)"`
- **Error**: `"Delegation error"` or `"Agent not found"`

## Error Conditions

| Condition | Error Message |
|-----------|---------------|
| No subagents configured | "No subagents available for delegation" |
| Invalid subagent_type | "No agent found matching '[name]'. Available: [list]" |
| Subagent initialization failed | "Failed to initialize subagent: [details]" |
| Task execution timeout | "Subagent task timed out after [duration]ms" |
| Circular delegation detected | "Circular delegation prevented: [chain]" |
| Invalid tool access | "Subagent lacks permission for required tools: [tools]" |

## Execution Flow

1. **Input Validation**: Validate required fields and types
2. **Subagent Selection**: Match `subagent_type` to configured subagents
3. **Instance Creation**: Create new SubagentInstance with isolated context
4. **Activity Reporting**: Register `onUpdate` callback to update `shortResult`
5. **Task Execution**: Execute task using subagent's aiManager
6. **Result Collection**: Gather results from subagent's message manager
7. **Cleanup**: Call `subagentManager.cleanupInstance(instance.subagentId)`
8. **Response Formation**: Format response with success/error status

## Integration Points

### With SubagentManager
```typescript
interface SubagentManager {
  loadConfigurations(): Promise<SubagentConfiguration[]>;
  findSubagent(name: string): Promise<SubagentConfiguration | null>;
  createInstance(
    configuration: SubagentConfiguration,
    parameters: {
      description: string;
      prompt: string;
      subagent_type: string;
    },
    runInBackground?: boolean,
    onUpdate?: () => void
  ): Promise<SubagentInstance>;
  executeAgent(
    instance: SubagentInstance,
    prompt: string,
    abortSignal?: AbortSignal,
    runInBackground?: boolean
  ): Promise<string>;
}
```

### With ToolContext
```typescript
interface ToolContext {
  onShortResultUpdate?: (shortResult: string) => void;
  subagentManager: SubagentManager;
  abortSignal?: AbortSignal;
}
```

## Performance Requirements

- **Selection Time**: <500ms for subagent matching and selection
- **Initialization Time**: <2000ms for subagent instance creation  
- **Total Overhead**: <150% of equivalent main agent task time
- **Memory Usage**: Isolated instances cleaned up immediately after task completion

## Security Considerations

- **Tool Isolation**: Subagents only access configured tools
- **Context Isolation**: No access to main conversation history
- **Circular Prevention**: Always deny `Agent` tool in subagents to prevent infinite recursion
- **Configuration Validation**: YAML parsing with safe loader only