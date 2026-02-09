# API Contracts: Task Management Tools

## Task Tool (Update)
Delegates a task to a subagent, now with background support.

**Parameters:**
- `description` (string, required): What to accomplish.
- `prompt` (string, required): Instructions for the subagent.
- `subagent_type` (string, required): Name of the subagent.
- `run_in_background` (boolean, optional, default: false): Whether to run asynchronously.

**Returns:**
- If `run_in_background: false`: The subagent's text response.
- If `run_in_background: true`: A message containing the `task_id`.

---

## TaskOutput Tool (New)
Retrieves output from a background task.

**Parameters:**
- `task_id` (string, required): The ID of the task.
- `block` (boolean, optional, default: true): Wait for completion.
- `timeout` (number, optional, default: 30000): Max wait time in ms.

**Returns:**
- `stdout` (string): Accumulated output.
- `stderr` (string): Accumulated errors.
- `status` (string): Current task status.

---

## TaskStop Tool (New)
Terminates a running background task.

**Parameters:**
- `task_id` (string, required): The ID of the task to stop.

**Returns:**
- `success` (boolean): Whether the task was stopped.
- `message` (string): Status message.
