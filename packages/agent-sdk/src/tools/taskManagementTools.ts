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
    const sessionId = context.sessionId;
    const taskManager = context.taskManager;
    if (!sessionId) {
      return {
        success: false,
        content: "Session ID not found in context.",
      };
    }

    if (!taskManager) {
      return {
        success: false,
        content: "TaskManager not found in context.",
      };
    }

    const taskId = await taskManager.getNextTaskId(sessionId);
    const task: Task = {
      id: taskId,
      subject: args.subject as string,
      description: args.description as string,
      status: (args.status as TaskStatus) || "pending",
      activeForm: args.activeForm as string,
      owner: args.owner as string,
      blocks: (args.blocks as string[]) || [],
      blockedBy: (args.blockedBy as string[]) || [],
      metadata: (args.metadata as Record<string, unknown>) || {},
    };

    await taskManager.createTask(sessionId, task);

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
      description: "Retrieve details of a specific task by its ID.",
      parameters: {
        type: "object",
        properties: {
          id: {
            type: "string",
            description: "The ID of the task to retrieve.",
          },
        },
        required: ["id"],
      },
    },
  },
  execute: async (args, context: ToolContext): Promise<ToolResult> => {
    const sessionId = context.sessionId;
    const taskManager = context.taskManager;
    if (!sessionId) {
      return {
        success: false,
        content: "Session ID not found in context.",
      };
    }

    if (!taskManager) {
      return {
        success: false,
        content: "TaskManager not found in context.",
      };
    }

    const task = await taskManager.getTask(sessionId, args.id as string);
    if (!task) {
      return {
        success: false,
        content: `Task with ID ${args.id} not found.`,
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
      description: "Update an existing task.",
      parameters: {
        type: "object",
        properties: {
          id: {
            type: "string",
            description: "The ID of the task to update.",
          },
          subject: {
            type: "string",
            description: "Updated subject.",
          },
          description: {
            type: "string",
            description: "Updated description.",
          },
          status: {
            type: "string",
            enum: ["pending", "in_progress", "completed", "deleted"],
            description: "Updated status.",
          },
          activeForm: {
            type: "string",
            description: "Updated active form.",
          },
          owner: {
            type: "string",
            description: "Updated owner.",
          },
          blocks: {
            type: "array",
            items: { type: "string" },
            description: "Updated list of blocked task IDs.",
          },
          blockedBy: {
            type: "array",
            items: { type: "string" },
            description: "Updated list of blocking task IDs.",
          },
          metadata: {
            type: "object",
            description: "Updated metadata.",
          },
        },
        required: ["id"],
      },
    },
  },
  execute: async (args, context: ToolContext): Promise<ToolResult> => {
    const sessionId = context.sessionId;
    const taskManager = context.taskManager;
    if (!sessionId) {
      return {
        success: false,
        content: "Session ID not found in context.",
      };
    }

    if (!taskManager) {
      return {
        success: false,
        content: "TaskManager not found in context.",
      };
    }

    const existingTask = await taskManager.getTask(
      sessionId,
      args.id as string,
    );
    if (!existingTask) {
      return {
        success: false,
        content: `Task with ID ${args.id} not found.`,
      };
    }

    const updatedTask: Task = {
      ...existingTask,
      subject: (args.subject as string) ?? existingTask.subject,
      description: (args.description as string) ?? existingTask.description,
      status: (args.status as TaskStatus) ?? existingTask.status,
      activeForm: (args.activeForm as string) ?? existingTask.activeForm,
      owner: (args.owner as string) ?? existingTask.owner,
      blocks: (args.blocks as string[]) ?? existingTask.blocks,
      blockedBy: (args.blockedBy as string[]) ?? existingTask.blockedBy,
      metadata:
        (args.metadata as Record<string, unknown>) ?? existingTask.metadata,
    };

    await taskManager.updateTask(sessionId, updatedTask);

    return {
      success: true,
      content: `Task ${args.id} updated successfully.`,
      shortResult: `Updated task ${args.id}`,
    };
  },
};

export const taskListTool: ToolPlugin = {
  name: TASK_LIST_TOOL_NAME,
  config: {
    type: "function",
    function: {
      name: TASK_LIST_TOOL_NAME,
      description: "List all tasks for the current session.",
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
  execute: async (args, context: ToolContext): Promise<ToolResult> => {
    const sessionId = context.sessionId;
    const taskManager = context.taskManager;
    if (!sessionId) {
      return {
        success: false,
        content: "Session ID not found in context.",
      };
    }

    if (!taskManager) {
      return {
        success: false,
        content: "TaskManager not found in context.",
      };
    }

    let tasks = await taskManager.listTasks(sessionId);
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
