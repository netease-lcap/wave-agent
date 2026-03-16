# Tool API Contract: Task Tool

## Tool Definition

**Name**: `Task`
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
  "shortResult": "Task completed by code-reviewer"
}
```

### Error Response
```json
{
  "success": false,
  "content": "",
  "error": "Subagent 'unknown-type' not found. Available: code-reviewer, documentation-writer, test-generator",
  "shortResult": "Task delegation failed"
}
```

## Content Format

### Success Content
The `content` field contains the actual output from the subagent's last assistant message - exactly what the subagent produced as its final response.

### ShortResult Format
- **Success**: `"Task completed by [subagent-name]"`  
- **Error**: `"Task delegation failed"` or `"Task failed: [brief error]"`

## Error Conditions

| Condition | Error Message | HTTP Code Equivalent |
|-----------|---------------|---------------------|
| No subagents configured | "No subagents available for delegation" | 404 |
| Invalid subagent_type | "Subagent '[name]' not found. Available: [list]" | 404 |
| Subagent initialization failed | "Failed to initialize subagent: [details]" | 500 |
| Task execution timeout | "Subagent task timed out after [duration]ms" | 408 |
| Circular delegation detected | "Circular delegation prevented: [chain]" | 409 |
| Invalid tool access | "Subagent lacks permission for required tools: [tools]" | 403 |

## Execution Flow

1. **Input Validation**: Validate required fields and types
2. **Subagent Selection**: 
   - If `subagent_type` matches existing subagent name exactly → use that subagent
   - Otherwise → find best match using description similarity
   - Fallback → return error with available subagents
3. **Instance Creation**: Create new SubagentInstance with isolated context
4. **Task Execution**: Execute task using subagent's aiManager
5. **Result Collection**: Gather results and cleanup resources
6. **Response Formation**: Format response with success/error status

## Integration Points

### With SubagentManager
```typescript
interface SubagentManager {
  loadConfigurations(): Promise<SubagentConfiguration[]>;
  findSubagent(name: string): Promise<SubagentConfiguration | null>;
  findBestMatch(description: string): Promise<SubagentConfiguration | null>;
  createInstance(
    config: SubagentConfiguration, 
    parameters: {
      description: string;
      prompt: string;
      subagent_type: string;
    }
  ): Promise<SubagentInstance>;
  executeTask(instance: SubagentInstance, prompt: string): Promise<string>;
}
```

### With MessageManager Callbacks
```typescript
interface MessageManagerCallbacks {
  onSubAgentBlockAdded?: (
    subagentId: string,
    parameters: {
      description: string;
      prompt: string;
      subagent_type: string;
    }
  ) => void;
  onSubAgentBlockUpdated?: (subagentId: string, messages: Message[], status: SubagentBlock["status"]) => void;
}
```

### With UI Components
- Task tool execution triggers `onSubAgentBlockAdded` callback
- Subagent message updates trigger `onSubAgentBlockUpdated` callback
- UI renders SubagentBlock component in MessageList

## Performance Requirements

- **Selection Time**: <500ms for subagent matching and selection
- **Initialization Time**: <2000ms for subagent instance creation  
- **Total Overhead**: <150% of equivalent main agent task time
- **Memory Usage**: Isolated instances cleaned up after task completion
- **Concurrent Subagents**: Support up to 5 simultaneous subagent tasks

## Security Considerations

- **Tool Isolation**: Subagents only access configured tools
- **Context Isolation**: No access to main conversation history
- **File Access**: Restricted to workspace directory and specified paths
- **Configuration Validation**: YAML parsing with safe loader only
- **Circular Prevention**: Track delegation chain to prevent infinite loops