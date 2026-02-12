# Data Model: Bash Builtin Subagent

## Entities

### SubagentConfiguration (Existing)
The Bash subagent will adhere to the existing `SubagentConfiguration` interface.

| Field | Type | Description |
|-------|------|-------------|
| name | string | "Bash" |
| description | string | "Command execution specialist for running bash commands..." |
| systemPrompt | string | The specialized bash execution prompt. |
| tools | string[] | `[BASH_TOOL_NAME]` |
| model | string | "inherit" |
| source | "built-in" | Indicates it's a core part of the system. |

## State Transitions
The Bash subagent is stateless. It receives a task, executes it using the provided tools, and returns the output.
