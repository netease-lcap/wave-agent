# Quickstart: Task List UI

The Task List UI provides a persistent view of your current goals and progress directly within the chat interface.

## 1. Viewing Tasks

The task list automatically appears at the bottom of the message list whenever there are active tasks in your session.

- **Location**: Below the last message, above the input prompt.
- **Content**: Shows the subject and status of each task.

### Status Indicators
- `○` **Pending**: Task is defined but not yet started.
- `●` **In Progress**: Task is currently being worked on.
- `✓` **Completed**: Task has been successfully finished.
- `✕` **Deleted**: Task has been removed from the active list.
- `🔒` **Blocked**: Task is waiting for other tasks to complete.

## 2. Task Dependencies

If a task is blocked by another task, it will show a lock icon and list the tasks it is waiting for. This helps you understand the order of operations.

## 3. How it Updates

The task list is "live". You will see it update in real-time when:
1. You ask the Agent to "create a task" or "start a new goal".
2. The Agent completes a sub-task and moves to the next one.
3. You manually update a task using the provided tools.

## 4. Example

```text
────────────────────────────────────────────────────────────────────────────────
Agent: I've started working on the data model.

TASKS
✓ Define Task entity
● Create UI event contracts
🔒 Write quickstart guide (Blocked by: Create UI event contracts)
────────────────────────────────────────────────────────────────────────────────
> _
```
