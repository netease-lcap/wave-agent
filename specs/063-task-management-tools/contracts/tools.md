# Task Management Tool Contracts

## TaskCreate
Creates a new task in the current session.

**Input Schema (Zod)**:
```typescript
{
  subject: z.string().describe("A brief title for the task"),
  description: z.string().describe("A detailed description of what needs to be done"),
  activeForm: z.string().optional().describe('Present continuous form shown in spinner when in_progress (e.g., "Running tests")'),
  metadata: z.record(z.string(), z.unknown()).optional().describe("Arbitrary metadata to attach to the task")
}
```

**Output Schema**:
```typescript
{
  task: {
    id: string,
    subject: string
  }
}
```

---

## TaskGet
Retrieves full details for a specific task.

**Input Schema**:
```typescript
{
  taskId: z.string().describe("The ID of the task to retrieve")
}
```

**Output Schema**:
```typescript
{
  task: {
    id: string,
    subject: string,
    description: string,
    status: "pending" | "in_progress" | "completed" | "deleted",
    activeForm?: string,
    owner?: string,
    blocks: string[],
    blockedBy: string[],
    metadata: Record<string, any>
  } | null
}
```

---

## TaskUpdate
Updates an existing task's properties.

**Input Schema**:
```typescript
{
  taskId: z.string().describe("The ID of the task to update"),
  subject: z.string().optional(),
  description: z.string().optional(),
  activeForm: z.string().optional(),
  status: z.enum(["pending", "in_progress", "completed", "deleted"]).optional(),
  addBlocks: z.array(z.string()).optional(),
  addBlockedBy: z.array(z.string()).optional(),
  owner: z.string().optional(),
  metadata: z.record(z.string(), z.unknown()).optional()
}
```

**Output Schema**:
```typescript
{
  success: boolean,
  task?: { id: string, status: string }
}
```

---

## TaskList
Lists all tasks for the current session.

**Input Schema**:
```typescript
{}
```

**Output Schema**:
```typescript
{
  tasks: Array<{
    id: string,
    subject: string,
    status: string,
    owner?: string,
    blockedBy: string[]
  }>
}
```
