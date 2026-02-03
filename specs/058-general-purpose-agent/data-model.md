# Data Model: General-Purpose Agent

## Entities

### General-Purpose Subagent
- **Type**: `SubagentConfiguration` (Existing interface in `agent-sdk`)
- **Fields**:
  - `name`: `"general-purpose"`
  - `description`: A description highlighting its strengths in research and implementation.
  - `systemPrompt`: The detailed prompt defining its behavior and constraints.
  - `tools`: Omitted (Defaults to full tool access)
  - `model`: `"fastModel"` (Consistent with `Explore`)
  - `filePath`: `"<builtin:general-purpose>"`
  - `scope`: `"builtin"`
  - `priority`: `3` (Lowest priority, allows user overrides)

## Relationships
- **Main Agent** -> **Task Tool** -> **General-Purpose Subagent**: The main agent uses the `Task` tool to delegate work to the `general-purpose` subagent.
- **General-Purpose Subagent** -> **Tools**: The subagent has access to all registered tools in the system.

## Validation Rules
- The `name` must be exactly `"general-purpose"` for the `Task` tool to identify it.
- The `tools` field is omitted to grant full access by default.
- The `scope` must be `"builtin"` to ensure it is treated as a system-level agent.
