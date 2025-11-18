import type { ToolPlugin, ToolResult } from "./types.js";

interface TodoItem {
  content: string;
  status: "pending" | "in_progress" | "completed";
  id: string;
}

/**
 * TodoWrite tool for creating and managing structured task lists
 */
export const todoWriteTool: ToolPlugin = {
  name: "TodoWrite",
  config: {
    type: "function",
    function: {
      name: "TodoWrite",
      description: `Use this tool to create and manage a structured task list for your current coding session. This helps you track progress, organize complex tasks, and demonstrate thoroughness to the user.
It also helps the user understand the progress of the task and overall progress of their requests.

## When to Use This Tool
Use this tool proactively in these scenarios:

1. Complex multi-step tasks - When a task requires 3 or more distinct steps or actions
2. Non-trivial and complex tasks - Tasks that require careful planning or multiple operations
3. User explicitly requests todo list - When the user directly asks you to use the todo list
4. User provides multiple tasks - When users provide a list of things to be done (numbered or comma-separated)
5. After receiving new instructions - Immediately capture user requirements as todos
6. When you start working on a task - Mark it as in_progress BEFORE beginning work. Ideally you should only have one todo as in_progress at a time
7. After completing a task - Mark it as completed and add any new follow-up tasks discovered during implementation

## When NOT to Use This Tool

Skip using this tool when:
1. There is only a single, straightforward task
2. The task is trivial and tracking it provides no organizational benefit
3. The task can be completed in less than 3 trivial steps
4. The task is purely conversational or informational

NOTE that you should not use this tool if there is only one trivial task to do. In this case you are better off just doing the task directly.

## Task States and Management

1. **Task States**: Use these states to track progress:
   - pending: Task not yet started
   - in_progress: Currently working on (limit to ONE task at a time)
   - completed: Task finished successfully

2. **Task Management**:
   - Update task status in real-time as you work
   - Mark tasks complete IMMEDIATELY after finishing (don't batch completions)
   - Only have ONE task in_progress at any time
   - Complete current tasks before starting new ones
   - Remove tasks that are no longer relevant from the list entirely

3. **Task Completion Requirements**:
   - ONLY mark a task as completed when you have FULLY accomplished it
   - If you encounter errors, blockers, or cannot finish, keep the task as in_progress
   - When blocked, create a new task describing what needs to be resolved
   - Never mark a task as completed if:
     - Tests are failing
     - Implementation is partial
     - You encountered unresolved errors
     - You couldn't find necessary files or dependencies

4. **Task Breakdown**:
   - Create specific, actionable items
   - Break complex tasks into smaller, manageable steps
   - Use clear, descriptive task names

When in doubt, use this tool. Being proactive with task management demonstrates attentiveness and ensures you complete all requirements successfully.`,
      parameters: {
        type: "object",
        properties: {
          todos: {
            type: "array",
            items: {
              type: "object",
              properties: {
                content: {
                  type: "string",
                  minLength: 1,
                },
                status: {
                  type: "string",
                  enum: ["pending", "in_progress", "completed"],
                },
                id: {
                  type: "string",
                },
              },
              required: ["content", "status", "id"],
              additionalProperties: false,
            },
            description: "The updated todo list",
          },
        },
        required: ["todos"],
        additionalProperties: false,
      },
    },
  },

  execute: async (args: Record<string, unknown>): Promise<ToolResult> => {
    try {
      // Validate arguments
      const { todos } = args as { todos?: TodoItem[] };

      if (!todos || !Array.isArray(todos)) {
        return {
          success: false,
          content: "",
          error: "todos parameter must be an array",
          shortResult: "Invalid todos format",
        };
      }

      // Validate each task item
      for (const [index, todo] of todos.entries()) {
        if (!todo || typeof todo !== "object") {
          return {
            success: false,
            content: "",
            error: `Todo item at index ${index} must be an object`,
            shortResult: "Invalid todo item",
          };
        }

        if (
          !todo.content ||
          typeof todo.content !== "string" ||
          todo.content.trim().length === 0
        ) {
          return {
            success: false,
            content: "",
            error: `Todo item at index ${index} must have non-empty content`,
            shortResult: "Invalid todo content",
          };
        }

        if (!["pending", "in_progress", "completed"].includes(todo.status)) {
          return {
            success: false,
            content: "",
            error: `Todo item at index ${index} has invalid status: ${todo.status}`,
            shortResult: "Invalid todo status",
          };
        }

        if (
          !todo.id ||
          typeof todo.id !== "string" ||
          todo.id.trim().length === 0
        ) {
          return {
            success: false,
            content: "",
            error: `Todo item at index ${index} must have a non-empty id`,
            shortResult: "Invalid todo id",
          };
        }
      }

      // Check for duplicate IDs
      const ids = todos.map((todo) => todo.id);
      const duplicateIds = ids.filter((id, index) => ids.indexOf(id) !== index);
      if (duplicateIds.length > 0) {
        return {
          success: false,
          content: "",
          error: `Duplicate todo IDs found: ${duplicateIds.join(", ")}`,
          shortResult: "Duplicate todo IDs",
        };
      }

      // Check that only one task is in_progress
      const inProgressTodos = todos.filter(
        (todo) => todo.status === "in_progress",
      );
      if (inProgressTodos.length > 1) {
        return {
          success: false,
          content: "",
          error: `Only one todo can be in_progress at a time. Found ${inProgressTodos.length} in_progress todos`,
          shortResult: "Multiple in_progress todos",
        };
      }

      const completedCount = todos.filter(
        (t) => t.status === "completed",
      ).length;
      const totalCount = todos.length;

      let shortResult = `${completedCount}/${totalCount} done`;

      if (totalCount > 0) {
        const symbols = {
          pending: "[ ]",
          in_progress: "[>]",
          completed: "[x]",
        };

        // Show all todos in the shortResult
        for (const todo of todos) {
          shortResult += `\n${symbols[todo.status]} ${todo.content}`;
        }
      }

      return {
        success: true,
        content: `Todo list updated: ${completedCount}/${totalCount} completed`,
        shortResult: shortResult,
      };
    } catch (error) {
      return {
        success: false,
        content: "",
        error: error instanceof Error ? error.message : String(error),
        shortResult: "Todo list update failed",
      };
    }
  },
};
