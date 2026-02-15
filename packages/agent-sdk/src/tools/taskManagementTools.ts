import { ToolPlugin, ToolContext, ToolResult } from "./types.js";
import { Task, TaskStatus } from "../types/tasks.js";
import {
  TASK_CREATE_TOOL_NAME,
  TASK_GET_TOOL_NAME,
  TASK_UPDATE_TOOL_NAME,
  TASK_LIST_TOOL_NAME,
} from "../constants/tools.js";

export const taskCreateTool: ToolPlugin = {
  name: TASK_CREATE_TOOL_NAME,
  config: {
    type: "function",
    function: {
      name: TASK_CREATE_TOOL_NAME,
      description: "Create a new task to track a goal or sub-task.",
      parameters: {
        type: "object",
        properties: {
          subject: {
            type: "string",
            description: "A short, descriptive title for the task.",
          },
          description: {
            type: "string",
            description: "Detailed description of what needs to be done.",
          },
          status: {
            type: "string",
            enum: ["pending", "in_progress", "completed", "deleted"],
            description: "Initial status of the task. Defaults to 'pending'.",
          },
          activeForm: {
            type: "string",
            description:
              "Optional identifier for the active form or UI state associated with this task.",
          },
          owner: {
            type: "string",
            description: "Optional owner of the task.",
          },
          blocks: {
            type: "array",
            items: { type: "string" },
            description: "List of task IDs that this task blocks.",
          },
          blockedBy: {
            type: "array",
            items: { type: "string" },
            description: "List of task IDs that block this task.",
          },
          metadata: {
            type: "object",
            description: "Optional metadata for the task.",
          },
        },
        required: ["subject", "description"],
      },
    },
  },
  execute: async (args, context: ToolContext): Promise<ToolResult> => {
    const taskManager = context.taskManager;
    const task: Omit<Task, "id"> = {
      subject: args.subject as string,
      description: args.description as string,
      status: (args.status as TaskStatus) || "pending",
      activeForm: args.activeForm as string,
      owner: args.owner as string,
      blocks: (args.blocks as string[]) || [],
      blockedBy: (args.blockedBy as string[]) || [],
      metadata: (args.metadata as Record<string, unknown>) || {},
    };

    const taskId = await taskManager.createTask(task);

    return {
      success: true,
      content: `Task created with ID: ${taskId}`,
      shortResult: `Created task ${taskId}: ${task.subject}`,
    };
  },
};

export const taskGetTool: ToolPlugin = {
  name: TASK_GET_TOOL_NAME,
  config: {
    type: "function",
    function: {
      name: TASK_GET_TOOL_NAME,
      description: "Get a task by ID from the task list",
      parameters: {
        type: "object",
        properties: {
          taskId: {
            type: "string",
            description: "The ID of the task to retrieve",
          },
        },
        required: ["taskId"],
      },
    },
  },
  prompt: () => `Use this tool to retrieve a task by its ID from the task list.

## When to Use This Tool

- When you need the full description and context before starting work on a task
- To understand task dependencies (what it blocks, what blocks it)
- After being assigned a task, to get complete requirements

## Output

Returns full task details:
- **subject**: Task title
- **description**: Detailed requirements and context
- **status**: 'pending', 'in_progress', or 'completed'
- **blocks**: Tasks waiting on this one to complete
- **blockedBy**: Tasks that must complete before this one can start

## Tips

- After fetching a task, verify its blockedBy list is empty before beginning work.
- Use TaskList to see all tasks in summary form.`,
  execute: async (args, context: ToolContext): Promise<ToolResult> => {
    const taskManager = context.taskManager;
    const taskId = args.taskId as string;

    const task = await taskManager.getTask(taskId);
    if (!task) {
      return {
        success: false,
        content: `Task with ID ${taskId} not found.`,
      };
    }

    return {
      success: true,
      content: JSON.stringify(task, null, 2),
    };
  },
};

export const taskUpdateTool: ToolPlugin = {
  name: TASK_UPDATE_TOOL_NAME,
  config: {
    type: "function",
    function: {
      name: TASK_UPDATE_TOOL_NAME,
      description: "Update a task in the task list",
      parameters: {
        type: "object",
        properties: {
          taskId: {
            type: "string",
            description: "The ID of the task to update",
          },
          subject: {
            type: "string",
            description: "New subject for the task",
          },
          description: {
            type: "string",
            description: "New description for the task",
          },
          activeForm: {
            type: "string",
            description:
              'Present continuous form shown in spinner when in_progress (e.g., "Running tests")',
          },
          status: {
            type: "string",
            enum: ["pending", "in_progress", "completed", "deleted"],
            description: "New status for the task",
          },
          addBlocks: {
            type: "array",
            items: { type: "string" },
            description: "Task IDs that this task blocks",
          },
          addBlockedBy: {
            type: "array",
            items: { type: "string" },
            description: "Task IDs that block this task",
          },
          owner: {
            type: "string",
            description: "New owner for the task",
          },
          metadata: {
            type: "object",
            description:
              "Metadata keys to merge into the task. Set a key to null to delete it.",
          },
        },
        required: ["taskId"],
      },
    },
  },
  prompt: () => `Use this tool to update a task in the task list.

## When to Use This Tool

**Mark tasks as resolved:**
- When you have completed the work described in a task
- When a task is no longer needed or has been superseded
- IMPORTANT: Always mark your assigned tasks as resolved when you finish them
- After resolving, call TaskList to find your next task

- ONLY mark a task as completed when you have FULLY accomplished it
- If you encounter errors, blockers, or cannot finish, keep the task as in_progress
- When blocked, create a new task describing what needs to be resolved
- Never mark a task as completed if:
  - Tests are failing
  - Implementation is partial
  - You encountered unresolved errors
  - You couldn't find necessary files or dependencies

**Delete tasks:**
- When a task is no longer relevant or was created in error
- Setting status to \`deleted\` permanently removes the task

**Update task details:**
- When requirements change or become clearer
- When establishing dependencies between tasks

## Fields You Can Update

- **status**: The task status (see Status Workflow below)
- **subject**: Change the task title (imperative form, e.g., "Run tests")
- **description**: Change the task description
- **activeForm**: Present continuous form shown in spinner when in_progress (e.g., "Running tests")
- **owner**: Change the task owner (agent name)
- **metadata**: Merge metadata keys into the task (set a key to null to delete it)
- **addBlocks**: Mark tasks that cannot start until this one completes
- **addBlockedBy**: Mark tasks that must complete before this one can start

## Status Workflow

Status progresses: \`pending\` → \`in_progress\` → \`completed\`

Use \`deleted\` to permanently remove a task.

## Staleness

Make sure to read a task's latest state using \`TaskGet\` before updating it.

## Examples

Mark task as in progress when starting work:
\`\`\`json
{"taskId": "1", "status": "in_progress"}
\`\`\`

Mark task as completed after finishing work:
\`\`\`json
{"taskId": "1", "status": "completed"}
\`\`\`

Delete a task:
\`\`\`json
{"taskId": "1", "status": "deleted"}
\`\`\`

Claim a task by setting owner:
\`\`\`json
{"taskId": "1", "owner": "my-name"}
\`\`\`

Set up task dependencies:
\`\`\`json
{"taskId": "2", "addBlockedBy": ["1"]}
\`\`\`
`,
  execute: async (args, context: ToolContext): Promise<ToolResult> => {
    const taskManager = context.taskManager;
    const taskId = args.taskId as string;

    const existingTask = await taskManager.getTask(taskId);
    if (!existingTask) {
      return {
        success: false,
        content: `Task with ID ${taskId} not found.`,
      };
    }

    const updatedFields: string[] = [];

    const updatedTask: Task = {
      ...existingTask,
    };

    if (args.subject !== undefined && args.subject !== existingTask.subject) {
      updatedTask.subject = args.subject as string;
      updatedFields.push("subject");
    }
    if (
      args.description !== undefined &&
      args.description !== existingTask.description
    ) {
      updatedTask.description = args.description as string;
      updatedFields.push("description");
    }
    if (args.status !== undefined && args.status !== existingTask.status) {
      updatedTask.status = args.status as TaskStatus;
      updatedFields.push("status");
    }
    if (
      args.activeForm !== undefined &&
      args.activeForm !== existingTask.activeForm
    ) {
      updatedTask.activeForm = args.activeForm as string;
      updatedFields.push("activeForm");
    }
    if (args.owner !== undefined && args.owner !== existingTask.owner) {
      updatedTask.owner = args.owner as string;
      updatedFields.push("owner");
    }

    if (args.metadata !== undefined) {
      const newMetadata = { ...(existingTask.metadata || {}) };
      for (const [key, value] of Object.entries(
        args.metadata as Record<string, unknown>,
      )) {
        if (value === null) {
          delete newMetadata[key];
        } else {
          newMetadata[key] = value;
        }
      }
      updatedTask.metadata = newMetadata;
      updatedFields.push("metadata");
    }

    if (args.addBlocks !== undefined) {
      const blocksToAdd = (args.addBlocks as string[]).filter(
        (id) => !updatedTask.blocks.includes(id),
      );
      if (blocksToAdd.length > 0) {
        updatedTask.blocks = [...updatedTask.blocks, ...blocksToAdd];
        updatedFields.push("blocks");

        // Also update the blockedBy of the target tasks
        for (const targetId of blocksToAdd) {
          const targetTask = await taskManager.getTask(targetId);
          if (targetTask && !targetTask.blockedBy.includes(taskId)) {
            await taskManager.updateTask({
              ...targetTask,
              blockedBy: [...targetTask.blockedBy, taskId],
            });
          }
        }
      }
    }

    if (args.addBlockedBy !== undefined) {
      const blockedByToAdd = (args.addBlockedBy as string[]).filter(
        (id) => !updatedTask.blockedBy.includes(id),
      );
      if (blockedByToAdd.length > 0) {
        updatedTask.blockedBy = [...updatedTask.blockedBy, ...blockedByToAdd];
        updatedFields.push("blockedBy");

        // Also update the blocks of the target tasks
        for (const targetId of blockedByToAdd) {
          const targetTask = await taskManager.getTask(targetId);
          if (targetTask && !targetTask.blocks.includes(taskId)) {
            await taskManager.updateTask({
              ...targetTask,
              blocks: [...targetTask.blocks, taskId],
            });
          }
        }
      }
    }

    await taskManager.updateTask(updatedTask);

    let content = `Updated task #${taskId} ${updatedFields.join(", ")}`;
    if (updatedTask.status === "completed") {
      content += `\n\nTask completed. Call TaskList now to find your next available task or see if your work unblocked others.`;
    }

    return {
      success: true,
      content,
      shortResult: `Updated task ${taskId}`,
    };
  },
};

export const taskListTool: ToolPlugin = {
  name: TASK_LIST_TOOL_NAME,
  config: {
    type: "function",
    function: {
      name: TASK_LIST_TOOL_NAME,
      description: "List all tasks in the task list",
      parameters: {
        type: "object",
        properties: {
          status: {
            type: "string",
            enum: ["pending", "in_progress", "completed", "deleted"],
            description: "Optional filter by status.",
          },
        },
      },
    },
  },
  prompt: () => `Use this tool to list all tasks in the task list.

## When to Use This Tool

- To see what tasks are available to work on (status: 'pending', no owner, not blocked)
- To check overall progress on the project
- To find tasks that are blocked and need dependencies resolved
- After completing a task, to check for newly unblocked work or claim the next available task
- **Prefer working on tasks in ID order** (lowest ID first) when multiple tasks are available, as earlier tasks often set up context for later ones

## Output

Returns a summary of each task:
- **id**: Task identifier (use with TaskGet, TaskUpdate)
- **subject**: Brief description of the task
- **status**: 'pending', 'in_progress', or 'completed'
- **owner**: Agent ID if assigned, empty if available
- **blockedBy**: List of open task IDs that must be resolved first (tasks with blockedBy cannot be claimed until dependencies resolve)

Use TaskGet with a specific task ID to view full details including description and comments.`,
  execute: async (args, context: ToolContext): Promise<ToolResult> => {
    const taskManager = context.taskManager;

    let tasks = await taskManager.listTasks();
    if (args.status) {
      tasks = tasks.filter((t) => t.status === args.status);
    }

    if (tasks.length === 0) {
      return {
        success: true,
        content: "No tasks found.",
      };
    }

    // Sort by ID numerically
    tasks.sort((a, b) => parseInt(a.id, 10) - parseInt(b.id, 10));

    const content = tasks
      .map((t) => `[${t.id}] ${t.subject} (${t.status})`)
      .join("\n");

    return {
      success: true,
      content,
    };
  },
};
