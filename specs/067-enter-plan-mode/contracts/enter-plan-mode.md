# Tool Contract: EnterPlanMode

## Description
Requests permission to enter plan mode for complex tasks requiring exploration and design.

## Input Schema (JSON Schema)
```json
{
  "type": "object",
  "properties": {},
  "additionalProperties": false
}
```

## Output Schema (JSON Schema)
```json
{
  "type": "object",
  "properties": {
    "message": {
      "type": "string",
      "description": "Confirmation that plan mode was entered"
    }
  },
  "required": ["message"]
}
```

## Behavior
1. **Pre-condition**: Agent identifies a task that meets the "When to Use" criteria (e.g., multi-file change, architectural decision).
2. **Action**: Agent calls `EnterPlanMode()`.
3. **User Interaction**: The system prompts the user: "Agent wants to enter plan mode. Allow?"
4. **Post-condition (Success)**:
    - `PermissionMode` is set to `plan`.
    - A new plan file is created in `~/.wave/plans/`.
    - The agent receives a confirmation message.
    - The system prompt is updated with plan mode instructions.
5. **Post-condition (Failure)**:
    - If user denies, the tool returns an error.
    - Agent remains in the previous mode.
