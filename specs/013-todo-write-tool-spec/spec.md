# Spec: TodoWrite Tool

The `TodoWrite` tool is a specialized tool for task management and planning within an agent session. It allows the agent to maintain a structured list of todos, providing visibility into progress for both the agent and the user.

## Tool Overview

### TodoWrite Tool (`TodoWrite`)
Creates and updates a list of tasks.
- **Features**:
  - Each todo item has `content`, `status`, and a unique `id`.
  - Supported statuses: `pending`, `in_progress`, `completed`.
  - Enforcement of "one task in progress" rule: only one todo can be `in_progress` at a time.
  - Validation of todo items (non-empty content, valid status, unique IDs).
  - Generates a summary of progress (e.g., "2/5 tasks completed").

## Usage Guidelines
- **Proactive Planning**: Agents should use this tool at the start of complex tasks (3+ steps).
- **Real-time Updates**: Status should be updated as work progresses.
- **Granularity**: Tasks should be specific and actionable.
- **Completion**: Tasks should only be marked `completed` when fully finished and verified.

## Benefits
- **Organization**: Helps the agent stay on track during multi-step operations.
- **Transparency**: Provides the user with a clear view of what the agent is doing and what remains to be done.
- **Reliability**: Reduces the chance of skipping steps or forgetting requirements.
