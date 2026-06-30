# Quickstart: Task Management Tools

This feature provides a set of tools for managing tasks during your session. Tasks are persisted locally and can be used to track progress, manage dependencies, and organize complex workflows.

## Available Tools

### 1. TaskCreate
Create a new task to track a specific objective.

**Usage**:
```json
{
  "subject": "Implement user authentication",
  "description": "Add login and signup endpoints with JWT support",
  "activeForm": "Implementing user authentication"
}
```

### 2. TaskList
Get an overview of all tasks in your current session.

**Usage**:
```json
{}
```

### 3. TaskGet
Retrieve full details, including dependencies and metadata, for a specific task.

**Usage**:
```json
{
  "taskId": "your-task-id-here"
}
```

### 4. TaskUpdate
Update the status, details, or dependencies of a task.

**Usage (Mark as In Progress)**:
```json
{
  "taskId": "your-task-id-here",
  "status": "in_progress"
}
```

**Usage (Add Dependency)**:
```json
{
  "taskId": "task-b",
  "addBlockedBy": ["task-a"]
}
```

## Task Statuses
- `pending`: Task is created but not yet started.
- `in_progress`: Task is currently being worked on.
- `completed`: Task is finished.
- `deleted`: Task is removed from active tracking.

## Storage
Tasks are stored as individual JSON files in:
`~/.wave/tasks/{sessionId}/{taskId}.json`

This allows for easy inspection and session-based isolation of your work.
