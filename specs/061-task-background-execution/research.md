# Research: Task Background Execution

## Decision: Unified Task Management System

We will implement a unified `BackgroundTaskManager` (or extend `BackgroundBashManager` into a more generic `BackgroundTaskManager`) to handle both background shell processes and background agent subtasks.

### Rationale
- **Consistency**: Users should have a single way to interact with any background operation, whether it's a simple shell command or a complex agent task.
- **Simplicity**: A unified ID scheme (e.g., `task_1`, `task_2`) simplifies the tool interface (`TaskStop`).
- **Maintainability**: Centralizing task state management reduces duplication between `BackgroundBashManager` and `SubagentManager`.

### Findings & Technical Details

#### 1. Tool Evolution
- **`Task` Tool**: Update `packages/agent-sdk/src/tools/taskTool.ts` to support `run_in_background: boolean`.
- **`Read` Tool**: Use the existing `Read` tool to retrieve output from background tasks via the `outputPath`.
- **`TaskStop` Tool**: New tool to replace `KillBash`. It will terminate either a shell process or a subagent's AI loop.
- **`Bash` Tool**: Keep `run_in_background` but ensure it registers with the unified manager.

#### 2. Manager Changes
- **`BackgroundBashManager`**: Rename or refactor to `BackgroundTaskManager`.
- **`SubagentManager`**: Update `executeTask` to support non-blocking execution. When `run_in_background` is true, it should return a `task_id` and continue execution in the background.

#### 3. CLI Integration
- **`/tasks` Command**: Implement in `packages/agent-sdk/src/managers/slashCommandManager.ts` as a built-in command. It will fetch all tasks from the unified manager and format them for display.
- **`/bashes` Removal**: Remove from `slashCommandManager.ts` (if it exists there) or ensure it's no longer registered.

#### 4. Task Completion Notifications
- When a background task completes, fails, or is killed, the system enqueues an XML notification string.
- The notification is parsed into a `TaskNotificationBlock` and added as a user message.
- The block is rendered in the CLI as a compact status line with a colored dot.
- For the AI, the block is serialized back to XML via `convertMessagesForAPI`.

#### 5. Data Model
- **`BackgroundTask` Interface**:
  ```typescript
  interface BackgroundTask {
    id: string;
    type: 'shell' | 'subagent';
    status: 'running' | 'completed' | 'failed' | 'killed';
    startTime: number;
    endTime?: number;
    command?: string; // for shell
    description?: string; // for subagent
    output: { stdout: string; stderr: string };
    outputPath?: string; // path to real-time log file
  }
  ```

### Alternatives Considered
- **Separate Managers**: Keep `BackgroundBashManager` and `SubagentManager` separate and have the tools check both. 
  - *Rejected*: Leads to fragmented logic and makes the `/tasks` command harder to implement.
- **Extend `BackgroundShell`**: Just add subagent info to the existing shell interface.
  - *Rejected*: Semantically confusing as subagents aren't "shells".

## NEEDS CLARIFICATION Resolved
- **Task ID Scheme**: We will use a unified `task_N` prefix for all background tasks to avoid confusion with the old `bash_N` scheme, or keep `bash_N` for shells and use `subagent_N` for subagents but have them both managed by the same registry. *Decision: Use `task_N` for all to emphasize unification.*
- **Output Retrieval**: Agents will use the `Read` tool to read the `outputPath` of background tasks. This provides a unified way to access both real-time and completed task output without needing a specialized `TaskOutput` tool.
