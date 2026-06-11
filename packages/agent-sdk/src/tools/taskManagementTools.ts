import { ToolPlugin, ToolContext, ToolResult } from "./types.js";
import { Task, TaskStatus } from "../types/tasks.js";
import {
  TASK_CREATE_TOOL_NAME,
  TASK_GET_TOOL_NAME,
  TASK_UPDATE_TOOL_NAME,
  TASK_LIST_TOOL_NAME,
} from "../constants/tools.js";

/**
 * Helper to record and commit a reversion snapshot for a task file.
 */
async function recordSnapshot(
  context: ToolContext,
  taskManager: { getTaskPath: (id: string) => string },
  taskId: string,
  operation: "create" | "modify" | "delete",
): Promise<string | undefined> {
  if (!context.reversionManager || !context.messageId) return undefined;
  const snapshotId = await context.reversionManager.recordSnapshot(
    context.messageId,
    taskManager.getTaskPath(taskId),
    operation,
  );
  await context.reversionManager.commitSnapshot(snapshotId);
  return snapshotId;
}

/**
 * Helper to update a target task's blocks/blockedBy array and record a reversion snapshot.
 */
async function updateTaskField(
  context: ToolContext,
  taskManager: {
    getTaskPath: (id: string) => string;
    updateTask: (task: Task) => Promise<void>;
  },
  targetTask: Task,
  field: "blocks" | "blockedBy",
  value: string[],
): Promise<void> {
  await recordSnapshot(context, taskManager, targetTask.id, "modify");
  await taskManager.updateTask({ ...targetTask, [field]: value });
}

export const taskCreateTool: ToolPlugin = {
  name: TASK_CREATE_TOOL_NAME,
  config: {
    type: "function",
    function: {
      name: TASK_CREATE_TOOL_NAME,
      description: "Create a new task in the task list",
      parameters: {
        type: "object",
        properties: {
          subject: {
            type: "string",
            description: "A brief title for the task",
          },
          description: {
            type: "string",
            description: "What needs to be done",
          },
          activeForm: {
            type: "string",
            description:
              'Present continuous form shown in spinner when in_progress (e.g., "Running tests")',
          },
          metadata: {
            type: "object",
            description: "Arbitrary metadata to attach to the task",
          },
        },
        required: ["subject", "description"],
      },
    },
  },
  prompt:
    () => `Use this tool to create a structured task list for your current coding session. This helps you track progress, organize complex tasks, and demonstrate thoroughness to the user.
It also helps the user understand the progress of the task and overall progress of their requests.

## When to Use This Tool

Use this tool proactively in these scenarios:

- Complex multi-step tasks - When a task requires 3 or more distinct steps or actions
- Non-trivial and complex tasks - Tasks that require careful planning or multiple operations
- Plan mode - When using plan mode, create a task list to track the work
- User explicitly requests todo list - When the user directly asks you to use the todo list
- User provides multiple tasks - When users provide a list of things to be done (numbered or comma-separated)
- After receiving new instructions - Immediately capture user requirements as tasks
- When you start working on a task - Mark it as in_progress BEFORE beginning work
- After completing a task - Mark it as completed and add any new follow-up tasks discovered during implementation

## When NOT to Use This Tool

Skip using this tool when:
- There is only a single, straightforward task
- The task is trivial and tracking it provides no organizational benefit
- The task can be completed in less than 3 trivial steps
- The task is purely conversational or informational

NOTE that you should not use this tool if there is only one trivial task to do. In this case you are better off just doing the task directly.

## Task Fields

- **subject**: A brief, actionable title in imperative form (e.g., "Fix authentication bug in login flow")
- **description**: What needs to be done, including context and acceptance criteria
- **activeForm**: Present continuous form shown in spinner when task is in_progress (e.g., "Fixing authentication bug"). This is displayed to the user while you work on the task.

**IMPORTANT**: Always provide activeForm when creating tasks. The subject should be imperative ("Run tests") while activeForm should be present continuous ("Running tests"). All tasks are created with status \`pending\`.

## Tips

- Create tasks with clear, specific subjects that describe the outcome
- Include enough detail in the description for another agent to understand and complete the task
- After creating tasks, use TaskUpdate to set up dependencies (blocks/blockedBy) if needed
- Check TaskList first to avoid creating duplicate tasks`,
  execute: async (args, context: ToolContext): Promise<ToolResult> => {
    const taskManager = context.taskManager;

    const task: Omit<Task, "id"> = {
      subject: args.subject as string,
      description: args.description as string,
      status: "pending",
      activeForm: args.activeForm as string,
      owner: undefined,
      blocks: [],
      blockedBy: [],
      metadata: (args.metadata as Record<string, unknown>) || {},
    };

    const taskId = await taskManager.createTask(task);
    await recordSnapshot(context, taskManager, taskId, "create");

    return {
      success: true,
      content: `Task #${taskId} created successfully: ${task.subject}`,
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
        content: `Task not found`,
      };
    }

    // Format like Claude Code: structured text instead of raw JSON
    const lines = [
      `Task #${task.id}: ${task.subject}`,
      `Status: ${task.status}`,
      `Description: ${task.description}`,
    ];
    if (task.blockedBy.length > 0) {
      lines.push(
        `Blocked by: ${task.blockedBy.map((id) => `#${id}`).join(", ")}`,
      );
    }
    if (task.blocks.length > 0) {
      lines.push(`Blocks: ${task.blocks.map((id) => `#${id}`).join(", ")}`);
    }

    return {
      success: true,
      content: lines.join("\n"),
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
        content: `Task #${taskId} not found`,
      };
    }

    // Handle deletion — just delete the task file (like Claude Code)
    if (args.status === "deleted") {
      await recordSnapshot(context, taskManager, taskId, "delete");
      await taskManager.deleteTask(taskId);

      return {
        success: true,
        content: `Task #${taskId} deleted`,
        shortResult: `Deleted task ${taskId}`,
      };
    }

    // Build updates object — only include changed fields
    const updatedFields: string[] = [];
    const updates: {
      subject?: string;
      description?: string;
      activeForm?: string;
      status?: TaskStatus;
      owner?: string;
      metadata?: Record<string, unknown>;
    } = {};

    if (args.subject !== undefined && args.subject !== existingTask.subject) {
      updates.subject = args.subject as string;
      updatedFields.push("subject");
    }
    if (
      args.description !== undefined &&
      args.description !== existingTask.description
    ) {
      updates.description = args.description as string;
      updatedFields.push("description");
    }
    if (
      args.activeForm !== undefined &&
      args.activeForm !== existingTask.activeForm
    ) {
      updates.activeForm = args.activeForm as string;
      updatedFields.push("activeForm");
    }
    if (args.owner !== undefined && args.owner !== existingTask.owner) {
      updates.owner = args.owner as string;
      updatedFields.push("owner");
    }
    if (args.status !== undefined && args.status !== existingTask.status) {
      updates.status = args.status as TaskStatus;
      updatedFields.push("status");
    }

    // Merge metadata (null values delete keys)
    if (args.metadata !== undefined) {
      const merged = { ...(existingTask.metadata ?? {}) };
      for (const [key, value] of Object.entries(
        args.metadata as Record<string, unknown>,
      )) {
        if (value === null) {
          delete merged[key];
        } else {
          merged[key] = value;
        }
      }
      updates.metadata = merged;
      updatedFields.push("metadata");
    }

    // Apply basic field updates
    if (Object.keys(updates).length > 0) {
      await recordSnapshot(context, taskManager, taskId, "modify");
      await taskManager.updateTask({ ...existingTask, ...updates });
    }

    // Add blocks: update this task's blocks + reciprocal blockedBy on targets
    if (args.addBlocks !== undefined) {
      const blocksToAdd = (args.addBlocks as string[]).filter(
        (id) => !existingTask.blocks.includes(id),
      );
      if (blocksToAdd.length > 0) {
        await recordSnapshot(context, taskManager, taskId, "modify");
        await taskManager.updateTask({
          ...existingTask,
          ...updates,
          blocks: [...existingTask.blocks, ...blocksToAdd],
        });
        updatedFields.push("blocks");

        for (const targetId of blocksToAdd) {
          const targetTask = await taskManager.getTask(targetId);
          if (targetTask && !targetTask.blockedBy.includes(taskId)) {
            await updateTaskField(
              context,
              taskManager,
              targetTask,
              "blockedBy",
              [...targetTask.blockedBy, taskId],
            );
          }
        }
      }
    }

    // Add blockedBy: update this task's blockedBy + reciprocal blocks on targets
    if (args.addBlockedBy !== undefined) {
      const blockedByToAdd = (args.addBlockedBy as string[]).filter(
        (id) => !existingTask.blockedBy.includes(id),
      );
      if (blockedByToAdd.length > 0) {
        await recordSnapshot(context, taskManager, taskId, "modify");
        await taskManager.updateTask({
          ...existingTask,
          ...updates,
          blockedBy: [...existingTask.blockedBy, ...blockedByToAdd],
        });
        updatedFields.push("blockedBy");

        for (const targetId of blockedByToAdd) {
          const targetTask = await taskManager.getTask(targetId);
          if (targetTask && !targetTask.blocks.includes(taskId)) {
            await updateTaskField(context, taskManager, targetTask, "blocks", [
              ...targetTask.blocks,
              taskId,
            ]);
          }
        }
      }
    }

    let content = `Updated task #${taskId} ${updatedFields.join(", ")}`;
    if (updates.status === "completed") {
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
        properties: {},
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
  execute: async (_args, context: ToolContext): Promise<ToolResult> => {
    const taskManager = context.taskManager;

    // Filter out internal metadata tasks (like Claude Code)
    const allTasks = (await taskManager.listTasks()).filter(
      (t) => !(t.metadata as Record<string, unknown>)?._internal,
    );

    if (allTasks.length === 0) {
      return {
        success: true,
        content: "No tasks found",
      };
    }

    // Sort by ID numerically
    allTasks.sort((a, b) => parseInt(a.id, 10) - parseInt(b.id, 10));

    // Filter resolved blockers from blockedBy
    const completedIds = new Set(
      allTasks.filter((t) => t.status === "completed").map((t) => t.id),
    );

    const content = allTasks
      .map((t) => {
        const blockedBy = t.blockedBy.filter((id) => !completedIds.has(id));
        const owner = t.owner ? ` (${t.owner})` : "";
        const blocked =
          blockedBy.length > 0
            ? ` [blocked by ${blockedBy.map((id) => `#${id}`).join(", ")}]`
            : "";
        return `#${t.id} [${t.status}] ${t.subject}${owner}${blocked}`;
      })
      .join("\n");

    return {
      success: true,
      content,
    };
  },
};
