# Research: Task Background Execution

## Decision: Unified Task Management System

We will implement a unified `BackgroundTaskManager` (or extend `BackgroundBashManager` into a more generic `TaskManager`) to handle both background shell processes and background agent subtasks.

### Rationale
- **Consistency**: Users should have a single way to interact with any background operation, whether it's a simple shell command or a complex agent task.
- **Simplicity**: A unified ID scheme (e.g., `task_1`, `task_2`) simplifies the tool interface (`TaskOutput`, `TaskStop`).
- **Maintainability**: Centralizing task state management reduces duplication between `BackgroundBashManager` and `SubagentManager`.

### Findings & Technical Details

#### 1. Tool Evolution
- **`Task` Tool**: Update `packages/agent-sdk/src/tools/taskTool.ts` to support `run_in_background: boolean`.
- **`TaskOutput` Tool**: New tool to replace `BashOutput`. It will query the unified manager for output.
- **`TaskStop` Tool**: New tool to replace `KillBash`. It will terminate either a shell process or a subagent's AI loop.
- **`Bash` Tool**: Keep `run_in_background` but ensure it registers with the unified manager.

#### 2. Manager Changes
- **`BackgroundBashManager`**: Rename or refactor to `BackgroundTaskManager`.
- **`SubagentManager`**: Update `executeTask` to support non-blocking execution. When `run_in_background` is true, it should return a `task_id` and continue execution in the background.

#### 3. CLI Integration
- **`/tasks` Command**: Implement in `packages/agent-sdk/src/managers/slashCommandManager.ts` as a built-in command. It will fetch all tasks from the unified manager and format them for display.
- **`/bashes` Removal**: Remove from `slashCommandManager.ts` (if it exists there) or ensure it's no longer registered.

#### 4. Data Model
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
  }
  ```

### Alternatives Considered
- **Separate Managers**: Keep `BackgroundBashManager` and `SubagentManager` separate and have the tools check both. 
  - *Rejected*: Leads to fragmented logic and makes the `/tasks` command harder to implement.
- **Extend `BackgroundShell`**: Just add subagent info to the existing shell interface.
  - *Rejected*: Semantically confusing as subagents aren't "shells".

## NEEDS CLARIFICATION Resolved
- **Task ID Scheme**: We will use a unified `task_N` prefix for all background tasks to avoid confusion with the old `bash_N` scheme, or keep `bash_N` for shells and use `subagent_N` for subagents but have them both managed by the same registry. *Decision: Use `task_N` for all to emphasize unification.*
- **Output Retrieval**: `TaskOutput` will support a `block` parameter. For subagents, "blocking" means waiting for the AI loop to finish. For shells, it means waiting for the process to exit.
