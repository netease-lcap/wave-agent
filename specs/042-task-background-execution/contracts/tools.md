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
- If `run_in_background: true`: A message containing the `task_id` and `outputPath` to a real-time log file. Background tasks do not update their `shortResult` while running to avoid UI "unknown" blocks.

---

## TaskStop Tool (New)
Terminates a running background task.

**Parameters:**
- `task_id` (string, required): The ID of the task to stop.

**Returns:**
- `success` (boolean): Whether the task was stopped.
- `message` (string): Status message.

---

## Task Completion Notifications

When a background task completes, fails, or is killed, the system injects a structured notification into the chat.

**Notification Format (as displayed to user):**
- `⬤ {summary}` with colored dot (green = completed, red = failed, yellow = killed)

**Notification Format (as sent to AI):**
- XML format matching the serialization in the original notification queue

**Triggered By:**
- `BackgroundTaskManager`: When shell process exits
- `SubagentManager`: When subagent AI loop finishes or errors
