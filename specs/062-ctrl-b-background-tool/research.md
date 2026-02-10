# Research: Ctrl-B Background Tool

## Decision: Intercept Ctrl-B in InputManager and background current tool via Agent

### Rationale:
- **Key Interception**: `InputManager` in `packages/code` is the central place for handling keyboard input via `ink`'s `useInput`. It already handles Ctrl-R, Ctrl-V, etc.
- **Tool Tracking**: The `Agent` class in `packages/agent-sdk` is the best place to track the currently running foreground tool because it coordinates `BackgroundTaskManager` (which runs `bash` tool), `SubagentManager` (which runs `task` tool), and `ToolManager`.
- **Backgrounding Mechanism**:
    - The requirement is to "not abort the process, just make the process continue run in background".
    - **Bash Tool**: The `bash` tool is implemented in `packages/agent-sdk/src/tools/bashTool.ts`. It uses `context.backgroundTaskManager.startShell` for background execution. For foreground execution, it uses `context.backgroundTaskManager.runShell`.
    - **Task Tool**: The `task` tool is implemented in `packages/agent-sdk/src/tools/taskTool.ts`. It delegates to `SubagentManager.executeTask`.
    - **Handoff Strategy**:
        1. When Ctrl-B is pressed, `InputManager` calls `onBackgroundCurrentTask` callback.
        2. `useChat` hook receives this and calls `agent.backgroundCurrentTask()`.
        3. `agent.backgroundCurrentTask()`:
            - Identifies the active `ForegroundTask`.
            - Calls the registered `backgroundHandler` for that task.
            - **For Bash**: `BackgroundTaskManager.runShell` (foreground) needs to be updated to support "detaching" the process so it can be "adopted" as a background task without termination.
            - **For Task**: `SubagentManager.executeTask` (foreground) needs to be updated to support transitioning an active subagent execution to the background task list.
            - Return the "Command was manually backgrounded..." result to the tool caller.

### Technical Details:
1. **Identifying `!` commands**: `Agent.executeBashCommand` adds `!${command}` to history. We can check if the current running command was triggered via this method or via `bashTool`.
2. **Tool Stages**: `agent-sdk` uses `ToolResult` to return to the AI. By returning a specific `ToolResult` when Ctrl-B is pressed, we effectively "end" the tool stage for the AI while the task continues in the background.
3. **Task ID**: `BackgroundTaskManager.generateId()` provides the unique ID needed for the result message.

## Alternatives Considered:
- **Directly moving process**: Moving a running child process from one manager to another is complex due to event listeners and stdio handling. However, since `BackgroundTaskManager` already handles both foreground and background shell execution, we can implement a "detach/adopt" mechanism within it to avoid process termination.
- **React-level tracking**: Tracking running tools in React state is possible but less robust than tracking in the `Agent` instance which is the source of truth for execution.

## Needs Clarification Resolved:
- **How to identify `!` commands?** Checked `Agent.executeBashCommand` and `InputManager.handleSubmit`. Direct bash commands are prefixed with `!` in history and run via `agent.executeBashCommand`.
- **How to transition stage to "end"?** In the tool's `execute` promise, we can resolve with a `ToolResult` when the abort signal is triggered by Ctrl-B.
