# Research: Task Management Implementation

## Decision: Task Persistence and Tool Integration

### Chosen Approach
- **Storage**: Use `fs/promises` directly for atomic JSON file operations in `~/.wave/tasks/{taskListId}/{taskId}.json`. This matches the structure found in `~/.claude/tasks/{sessionId}/{taskId}.json`.
- **Task List ID**: Retrieve `taskListId` from the `Agent` configuration. It defaults to the `rootSessionId` of the session chain to ensure stability across message compressions.
- **Task ID**: Use simple numeric strings (e.g., `"1"`, `"2"`) for task IDs within a session, as observed in the Claude implementation.
- **Tool Registration**: Modify `packages/agent-sdk/src/managers/toolManager.ts` to remove `todoWriteTool` and add the new task tools.

### Rationale
- **Claude Compatibility**: The observed structure in `~/.claude/tasks` confirms that tasks are stored as individual JSON files named by their ID (e.g., `1.json`) inside a UUID-named session directory.
- **Schema Alignment**: The fields found in `~/.claude/tasks` (`id`, `subject`, `description`, `activeForm`, `status`, `blocks`, `blockedBy`, `owner`) perfectly match the `tmp.js` reference, validating our data model.
- **Atomic Operations**: Individual files allow for simple, atomic updates without the risk of corrupting a shared log file.

### Findings from ~/.claude/tasks
- **Directory Structure**: `~/.claude/tasks/<UUID>/<ID>.json`
- **Task ID Pattern**: Sequential numeric strings (1, 2, 3...) are used as IDs.
- **Content**: Pure JSON objects containing the task state. No metadata or timestamps were observed in the sample files, further confirming the decision to omit them.


## Decision: Task Schema and Validation

### Chosen Approach
- **Schema**: Follow the `tmp.js` schema exactly: `id`, `subject`, `description`, `status`, `activeForm`, `owner`, `blocks`, `blockedBy`, `metadata`.
- **Validation**: Use `zod` (aliased as `b` in `tmp.js`) for input validation in tool definitions.

### Rationale
- **Consistency**: Aligning with `tmp.js` ensures that the implementation matches the user's reference and expected behavior.
- **Type Safety**: `zod` provides both runtime validation and TypeScript type inference.

### Alternatives Considered
- **Simplified Schema**: Considered removing `activeForm` or `metadata`. Rejected to maintain full compatibility with the requested feature set.
