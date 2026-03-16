# Data Model: Support Plan Mode

## Entities

### PermissionMode (Enum/Type)
Represents the current restriction level of the system.
- **Fields**:
  - `default`: Standard mode with manual confirmation for restricted tools.
  - `acceptEdits`: Automatically accepts file modifications in the Safe Zone.
  - `plan`: Read-only mode for the codebase, with write access only to a specific plan file.

### PlanFile (Entity)
Represents a plan file created during Plan Mode.
- **Fields**:
  - `path`: Absolute path to the plan file (e.g., `~/.wave/plans/gentle-breeze.md`).
  - `name`: Human-readable name (adjective-noun). This name is deterministic within a session chain, generated using the `rootSessionId` as a seed.
  - `createdAt`: Timestamp of creation.

## State Transitions
- **default -> acceptEdits**: Triggered by Shift+Tab.
- **acceptEdits -> plan**: Triggered by Shift+Tab. Determines or reuses a `PlanFile` based on the `rootSessionId`.
- **plan -> default**: Triggered by Shift+Tab.
