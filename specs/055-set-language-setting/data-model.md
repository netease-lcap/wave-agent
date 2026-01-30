# Data Model: Set Language Setting

## Entities

### WaveConfiguration (Updated)
The root configuration structure for Wave Agent.

| Field | Type | Description | Validation |
|-------|------|-------------|------------|
| `language` | `string` (optional) | The preferred language for agent communication. | Must be a string if present. |

## State Transitions

### Language Resolution
1. **Input**: `AgentOptions.language` (if added), `settings.json` (user/project).
2. **Process**:
   - Check `AgentOptions.language` (highest priority).
   - Check merged `WaveConfiguration.language` from `settings.json`.
3. **Output**: Resolved language string or `undefined`.

### Prompt Injection
1. **Input**: Resolved language string.
2. **Process**: If language is provided, format the language instruction block. If no language is provided, do nothing.
3. **Output**: Formatted string to be appended to the system prompt, or empty string.
